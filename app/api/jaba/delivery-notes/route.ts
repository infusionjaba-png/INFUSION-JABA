import { randomBytes } from 'crypto'
import { NextResponse } from 'next/server'
import clientPromise from '@/lib/mongodb'
import { generateUniquePublicShortToken } from '@/lib/jaba-delivery-note-public-token'
import { requireJabaAction } from '@/lib/api-jaba-permissions'
import { auth } from '@/lib/auth-jaba'
import { getJabaPublicBaseUrl } from '@/lib/jaba-app-url'
import {
  buildClientDeliveryNoteSms,
  buildDistributionCreatedSmsBody,
  buildDistributionDeliveredSmsBody,
  type DistributionSmsItem,
  normalizePhoneNumbers,
  sendJabaSmsStrict,
  sendJabaSmsForEvent,
} from '@/lib/jaba-sms'
import { getUserByEmail } from '@/lib/models/user'
import { requireDeleteOtp } from '@/lib/jaba-delete-otp-guard'
import {
  deriveFifoDeliveryNotePayload,
  JabaFifoAllocationError,
  roundMoneyKes,
} from '@/lib/jaba-delivery-note-fifo-allocation'

export const runtime = 'nodejs'

/**
 * Multi-document transaction defaults: snapshot reads + majority journal write.
 * Note: two concurrent creates only `insertOne` delivery notes — MongoDB will not
 * write-conflict on existing packaging / note docs, so extreme double-submit can still
 * over-allocate until slot-level reservations exist. Retries on TransientTransactionError
 * are still recommended for callers.
 */
const JABA_DN_TXN_OPTIONS = {
  readConcern: { level: 'snapshot' as const },
  writeConcern: { w: 'majority' as const, j: true },
}

async function jabaActorDisplayName(): Promise<string> {
  const session = await auth()
  const email = session?.user?.email?.trim()
  if (!email) return 'Jaba user'
  const u = await getUserByEmail(email)
  const fromDb = u?.name?.trim()
  const fromSession = session?.user?.name?.trim()
  return fromDb || fromSession || email
}

class ApiError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.status = status
  }
}

/** Never expose link tokens to authenticated list/detail JSON. */
function stripDeliveryNoteSecrets<T extends Record<string, unknown>>(note: T): Omit<T, 'viewToken' | 'publicShortToken'> {
  const { viewToken: _v, publicShortToken: _p, ...rest } = note
  return rest as Omit<T, 'viewToken' | 'publicShortToken'>
}

type DeliveredSmsPayload = {
  noteId: string
  distributorName: string
  items: DistributionSmsItem[]
  driver?: string
  driverPhone?: string
}

// POST create delivery note
export async function POST(request: Request) {
  const authResult = await requireJabaAction('distribution.create', 'add')
  if ('response' in authResult) return authResult.response

  try {
    const body = await request.json()
    const {
      noteId,
      distributorId,
      distributorName,
      items,
      vehicle,
      driver,
      driverPhone,
      notes,
      date,
    } = body

    // Validate required fields
    if (!noteId || !distributorId || !distributorName || !items || items.length === 0) {
      return NextResponse.json(
        { error: 'Missing required fields: noteId, distributorId, distributorName, and items are required' },
        { status: 400 }
      )
    }

    // Validate items have quantities
    const itemsWithQuantities = items.filter((item: any) => item.quantity > 0)
    if (itemsWithQuantities.length === 0) {
      return NextResponse.json(
        { error: 'At least one item must have a quantity greater than 0' },
        { status: 400 }
      )
    }

    // Initialize database connection FIRST
    const client = await clientPromise
    const db = client.db('infusion_jaba')
    const mongoSession = client.startSession()
    try {
      let createdNote: any = null
      await mongoSession.withTransaction(async () => {
        console.log('[Delivery Notes API] Validating stock availability for delivery note:', noteId)

        const packagingOutputs = await db.collection('jaba_packagingOutput').find({}, { session: mongoSession }).toArray()
        const allBatches = await db.collection('jaba_batches').find({}, { session: mongoSession }).toArray()
        const existingDeliveryNotes = await db.collection('jaba_deliveryNotes').find({}, { session: mongoSession }).toArray()

        const staffLines = itemsWithQuantities.map((item: any) => ({
          flavor: String(item.flavor || '').trim(),
          productType: item.productType != null ? String(item.productType) : undefined,
          productName: item.productName != null ? String(item.productName) : undefined,
          size: String(item.size || '').trim(),
          flavourLineId: item.flavourLineId != null ? String(item.flavourLineId) : undefined,
          quantity: Number(item.quantity) || 0,
          pricePerUnit: Number(item.pricePerUnit) || 0,
        }))

        let derived: ReturnType<typeof deriveFifoDeliveryNotePayload>
        try {
          derived = deriveFifoDeliveryNotePayload({
            staffLines,
            packagingOutputs,
            batches: allBatches,
            deliveryNotes: existingDeliveryNotes,
            excludeNoteId: null,
          })
        } catch (e: unknown) {
          if (e instanceof JabaFifoAllocationError) {
            throw new ApiError(e.message, e.status)
          }
          throw e
        }

        const existing = await db.collection('jaba_deliveryNotes').findOne({ noteId: noteId.trim() }, { session: mongoSession })
        if (existing) throw new ApiError('Delivery note with this ID already exists', 400)

        const totalCost = derived.totalCost

        const viewToken = randomBytes(24).toString('hex')
        const publicShortToken = await generateUniquePublicShortToken(db, 16, mongoSession)

        const deliveryNoteData = {
          noteId: noteId.trim(),
          viewToken,
          publicShortToken,
          distributorId: distributorId.trim(),
          distributorName: distributorName.trim(),
          items: derived.items.map((item) => ({
            finishedGoodId: item.finishedGoodId,
            productName: item.productName || '',
            flavor: item.flavor || '',
            productType: item.productType || '',
            size: item.size,
            batchNumber: item.batchNumber || '',
            batchId: item.batchId || undefined,
            packageNumber: item.packageNumber || '',
            packagingOutputId: item.packagingOutputId,
            flavourLineId: item.flavourLineId ? String(item.flavourLineId) : undefined,
            quantity: Number(item.quantity),
            pricePerUnit: roundMoneyKes(Number(item.pricePerUnit) || 0),
            totalCost: roundMoneyKes(item.totalCost),
          })),
          fifoAllocationVersion: 1,
          fifoAllocationTrace: derived.allocationTrace,
          totalCost: roundMoneyKes(totalCost),
          vehicle: vehicle?.trim() || undefined,
          driver: driver?.trim() || undefined,
          driverPhone: driverPhone?.trim() || undefined,
          notes: notes?.trim() || undefined,
          date: date ? new Date(date) : new Date(),
          status: 'Pending',
          paymentStatus: 'Unpaid',
          paymentDate: undefined,
          createdAt: new Date(),
          updatedAt: new Date(),
        }

        const result = await db.collection('jaba_deliveryNotes').insertOne(deliveryNoteData, { session: mongoSession })
        createdNote = {
          ...deliveryNoteData,
          _id: result.insertedId.toString(),
          id: result.insertedId.toString(),
        }
      }, JABA_DN_TXN_OPTIONS)

      console.log(`[Delivery Notes API] ✅ Delivery note created successfully: ${noteId}`)
      const dispatchedBy = await jabaActorDisplayName()
      const distributionSms = buildDistributionCreatedSmsBody({
        noteId: noteId.trim(),
        distributorName: distributorName.trim(),
        items: createdNote?.items || itemsWithQuantities,
        dispatchedBy,
        driver: typeof driver === 'string' ? driver : undefined,
        driverPhone: typeof driverPhone === 'string' ? driverPhone : undefined,
        vehicle: typeof vehicle === 'string' ? vehicle : undefined,
      })
      await sendJabaSmsForEvent('distributionCreated', distributionSms)

      const shortForLink = createdNote?.publicShortToken as string | undefined
      if (shortForLink) {
        const baseUrl = getJabaPublicBaseUrl()
        const viewUrl = `${baseUrl}/dn/${shortForLink}`
        const clientSms = buildClientDeliveryNoteSms({
          noteId: noteId.trim(),
          distributorName: distributorName.trim(),
          viewUrl,
        })
        let clientPhones: string[] = []
        try {
          const { ObjectId } = await import('mongodb')
          const did = String(distributorId).trim()
          if (ObjectId.isValid(did)) {
            const dist = await db.collection('jaba_distributors').findOne({ _id: new ObjectId(did) })
            if (dist?.phone) {
              clientPhones = normalizePhoneNumbers(dist.phone)
            }
          }
        } catch (e) {
          console.error('[Delivery Notes API] Distributor phone lookup failed:', e)
        }
        if (clientPhones.length > 0) {
          try {
            await sendJabaSmsStrict(clientSms, clientPhones)
            console.log(`[Delivery Notes API] Client delivery link SMS sent to ${clientPhones.length} number(s)`)
          } catch (e) {
            console.error('[Delivery Notes API] Client SMS failed:', e)
          }
        } else {
          console.log('[Delivery Notes API] Skipped client SMS: no valid distributor phone on file')
        }
      }

      return NextResponse.json(
        { success: true, deliveryNote: stripDeliveryNoteSecrets(createdNote as Record<string, unknown>) },
        { status: 201 }
      )
    } finally {
      await mongoSession.endSession()
    }
  } catch (error: any) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    if (error instanceof JabaFifoAllocationError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('[Delivery Notes API] ❌ Error creating delivery note:', error)
    console.error('[Delivery Notes API] Error details:', {
      message: error.message,
      stack: error.stack,
      name: error.name,
    })
    return NextResponse.json(
      {
        error: 'Failed to create delivery note',
        details: error.message || String(error),
      },
      { status: 500 }
    )
  }
}

// GET delivery notes
export async function GET(request: Request) {
  const authResult = await requireJabaAction('distribution.main', 'view')
  if ('response' in authResult) return authResult.response

  try {
    const { searchParams } = new URL(request.url)
    const distributorId = searchParams.get('distributorId')
    const status = searchParams.get('status')
    const batchNumber = searchParams.get('batchNumber')?.trim()

    const client = await clientPromise
    const db = client.db('infusion_jaba')

    const query: any = {}
    if (distributorId) {
      query.distributorId = distributorId
    }
    if (status) {
      query.status = status
    }
    if (batchNumber) {
      query['items.batchNumber'] = batchNumber
    }

    const deliveryNotes = await db.collection('jaba_deliveryNotes')
      .find(query)
      .sort({ date: -1, createdAt: -1 })
      .toArray()

    const formattedNotes = deliveryNotes.map((note) =>
      stripDeliveryNoteSecrets({
        ...note,
        _id: note._id.toString(),
        id: note._id.toString(),
        date: note.date instanceof Date ? note.date.toISOString() : note.date,
        createdAt: note.createdAt instanceof Date ? note.createdAt.toISOString() : note.createdAt,
        updatedAt: note.updatedAt instanceof Date ? note.updatedAt.toISOString() : note.updatedAt,
      } as Record<string, unknown>)
    )

    return NextResponse.json({ deliveryNotes: formattedNotes })
  } catch (error: any) {
    console.error('[Delivery Notes API] ❌ Error fetching delivery notes:', error)
    return NextResponse.json(
      {
        error: 'Failed to fetch delivery notes',
        details: error.message || String(error),
      },
      { status: 500 }
    )
  }
}

// PUT update delivery note (for payment status, status, or full update)
export async function PUT(request: Request) {
  const authResult = await requireJabaAction('distribution.main', 'edit')
  if ('response' in authResult) return authResult.response

  try {
    const body = await request.json()
    const { 
      id, 
      paymentStatus, 
      paymentDate, 
      paymentAmount,
      paymentReason,
      status,
      // Full update fields
      noteId,
      distributorId,
      distributorName,
      items,
      vehicle,
      driver,
      driverPhone,
      notes,
      totalCost,
    } = body

    if (!id) {
      return NextResponse.json(
        { error: 'Delivery note ID is required' },
        { status: 400 }
      )
    }
    const otpCheck = await requireDeleteOtp(request, 'delete_delivery_note', id)
    if ('response' in otpCheck) return otpCheck.response

    const client = await clientPromise
    const db = client.db('infusion_jaba')
    const { ObjectId } = await import('mongodb')

    const mongoSession = client.startSession()
    try {
      let updatedNote: any = null
      const pendingDeliveredSms: { payload: DeliveredSmsPayload | null } = { payload: null }
      await mongoSession.withTransaction(async () => {
        const existing = await db.collection('jaba_deliveryNotes').findOne({ _id: new ObjectId(id) }, { session: mongoSession })
        if (!existing) throw new ApiError('Delivery note not found', 404)
        const previousStatus = String(existing.status || '').toLowerCase()

        const updateData: any = { updatedAt: new Date() }

        // Handle full update (when items are provided)
        if (items && Array.isArray(items)) {
          const itemsWithQuantities = items.filter((item: any) => item.quantity > 0)
          if (itemsWithQuantities.length === 0) {
            throw new ApiError('At least one item must have a quantity greater than 0', 400)
          }

          const packagingOutputs = await db.collection('jaba_packagingOutput').find({}, { session: mongoSession }).toArray()
          const allBatches = await db.collection('jaba_batches').find({}, { session: mongoSession }).toArray()
          const allDeliveryNotes = await db.collection('jaba_deliveryNotes').find({}, { session: mongoSession }).toArray()

          const staffLines = itemsWithQuantities.map((item: any) => ({
            flavor: String(item.flavor || '').trim(),
            productType: item.productType != null ? String(item.productType) : undefined,
            productName: item.productName != null ? String(item.productName) : undefined,
            size: String(item.size || '').trim(),
            flavourLineId: item.flavourLineId != null ? String(item.flavourLineId) : undefined,
            quantity: Number(item.quantity) || 0,
            pricePerUnit: Number(item.pricePerUnit) || 0,
          }))

          let derivedPut: ReturnType<typeof deriveFifoDeliveryNotePayload>
          try {
            derivedPut = deriveFifoDeliveryNotePayload({
              staffLines,
              packagingOutputs,
              batches: allBatches,
              deliveryNotes: allDeliveryNotes,
              excludeNoteId: id,
            })
          } catch (e: unknown) {
            if (e instanceof JabaFifoAllocationError) {
              throw new ApiError(e.message, e.status)
            }
            throw e
          }

          updateData.noteId = noteId?.trim() || existing.noteId
          updateData.distributorId = distributorId?.trim() || existing.distributorId
          updateData.distributorName = distributorName?.trim() || existing.distributorName
          updateData.items = derivedPut.items.map((item) => ({
            finishedGoodId: item.finishedGoodId,
            productName: item.productName || '',
            flavor: item.flavor || '',
            productType: item.productType || '',
            size: item.size,
            batchNumber: item.batchNumber || '',
            batchId: item.batchId || undefined,
            packageNumber: item.packageNumber || '',
            packagingOutputId: item.packagingOutputId,
            flavourLineId: item.flavourLineId ? String(item.flavourLineId) : undefined,
            quantity: Number(item.quantity),
            pricePerUnit: roundMoneyKes(Number(item.pricePerUnit) || 0),
            totalCost: roundMoneyKes(item.totalCost),
          }))
          updateData.fifoAllocationVersion = 1
          updateData.fifoAllocationTrace = derivedPut.allocationTrace
          updateData.totalCost = roundMoneyKes(derivedPut.totalCost)
          updateData.vehicle = vehicle?.trim() || undefined
          updateData.driver = driver?.trim() || undefined
          updateData.driverPhone = driverPhone?.trim() || undefined
          updateData.notes = notes?.trim() || undefined
        }

        // Handle payment status update
        if (paymentStatus !== undefined) {
          updateData.paymentStatus = paymentStatus
          if ((paymentStatus === 'Paid' || paymentStatus === 'Partial') && !paymentDate) {
            updateData.paymentDate = new Date()
          } else if ((paymentStatus === 'Paid' || paymentStatus === 'Partial') && paymentDate) {
            updateData.paymentDate = new Date(paymentDate)
          } else if (paymentStatus === 'Unpaid') {
            updateData.paymentDate = undefined
          }
        }

        if (paymentAmount !== undefined) {
          const parsedPaymentAmount = Number(paymentAmount)
          if (!Number.isFinite(parsedPaymentAmount) || parsedPaymentAmount < 0) {
            throw new ApiError('Payment amount must be a valid non-negative number', 400)
          }
          updateData.paymentAmount = roundMoneyKes(parsedPaymentAmount)
        }

        if (paymentReason !== undefined) {
          const normalizedReason = String(paymentReason || '').trim()
          if (normalizedReason.length === 0) {
            throw new ApiError('Payment note is required', 400)
          }
          updateData.paymentReason = normalizedReason
        }

        if (status !== undefined) updateData.status = status

        if (!existing.publicShortToken) {
          updateData.publicShortToken = await generateUniquePublicShortToken(db, 16, mongoSession)
        }

        await db.collection('jaba_deliveryNotes').updateOne(
          { _id: new ObjectId(id) },
          { $set: updateData },
          { session: mongoSession }
        )

        const updated = await db.collection('jaba_deliveryNotes').findOne({ _id: new ObjectId(id) }, { session: mongoSession })
        const nextStatus = String(updated?.status || '').toLowerCase()
        if (previousStatus !== 'delivered' && nextStatus === 'delivered') {
          pendingDeliveredSms.payload = {
            noteId: String(updated?.noteId || id),
            distributorName: String(updated?.distributorName || ''),
            items: (Array.isArray(updated?.items) ? updated.items : []) as DistributionSmsItem[],
            driver: updated?.driver ? String(updated.driver) : undefined,
            driverPhone: updated?.driverPhone ? String(updated.driverPhone) : undefined,
          }
        }
        updatedNote = {
          ...updated,
          _id: updated!._id.toString(),
          id: updated!._id.toString(),
          date: updated!.date instanceof Date ? updated!.date.toISOString() : updated!.date,
          createdAt: updated!.createdAt instanceof Date ? updated!.createdAt.toISOString() : updated!.createdAt,
          updatedAt: updated!.updatedAt instanceof Date ? updated!.updatedAt.toISOString() : updated!.updatedAt,
          paymentDate: updated!.paymentDate instanceof Date ? updated!.paymentDate.toISOString() : updated!.paymentDate,
        }
      }, JABA_DN_TXN_OPTIONS)

      const deliveredPayload = pendingDeliveredSms.payload
      if (deliveredPayload) {
        const markedBy = await jabaActorDisplayName()
        const deliveredSms = buildDistributionDeliveredSmsBody({
          noteId: deliveredPayload.noteId,
          distributorName: deliveredPayload.distributorName,
          items: deliveredPayload.items,
          driver: deliveredPayload.driver,
          driverPhone: deliveredPayload.driverPhone,
          markedBy,
        })
        await sendJabaSmsForEvent('distributionDelivered', deliveredSms)
      }

      console.log(`[Delivery Notes API] ✅ Delivery note updated: ${id}`)
      return NextResponse.json({
        success: true,
        deliveryNote: stripDeliveryNoteSecrets(updatedNote as Record<string, unknown>),
      })
    } finally {
      await mongoSession.endSession()
    }
  } catch (error: any) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    if (error instanceof JabaFifoAllocationError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('[Delivery Notes API] ❌ Error updating delivery note:', error)
    return NextResponse.json(
      {
        error: 'Failed to update delivery note',
        details: error.message || String(error),
      },
      { status: 500 }
    )
  }
}

// DELETE delivery note
export async function DELETE(request: Request) {
  const authResult = await requireJabaAction('distribution.main', 'delete')
  if ('response' in authResult) return authResult.response

  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json(
        { error: 'Delivery note ID is required' },
        { status: 400 }
      )
    }

    const client = await clientPromise
    const db = client.db('infusion_jaba')
    const { ObjectId } = await import('mongodb')

    // Check if delivery note exists
    const existing = await db.collection('jaba_deliveryNotes').findOne({ 
      _id: new ObjectId(id) 
    })

    if (!existing) {
      return NextResponse.json(
        { error: 'Delivery note not found' },
        { status: 404 }
      )
    }

    // Delete delivery note
    await db.collection('jaba_deliveryNotes').deleteOne({ 
      _id: new ObjectId(id) 
    })

    console.log(`[Delivery Notes API] ✅ Delivery note deleted: ${id}`)

    return NextResponse.json({
      success: true,
      message: 'Delivery note deleted successfully'
    })
  } catch (error: any) {
    console.error('[Delivery Notes API] ❌ Error deleting delivery note:', error)
    return NextResponse.json(
      {
        error: 'Failed to delete delivery note',
        details: error.message || String(error),
      },
      { status: 500 }
    )
  }
}