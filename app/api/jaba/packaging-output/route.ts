import { NextResponse } from 'next/server'
import clientPromise from '@/lib/mongodb'
import { requireJabaAction } from '@/lib/api-jaba-permissions'
import {
  JABA_FLAVOUR_LINES_COLLECTION,
  sumPackagedLitresForFlavourLine,
} from '@/lib/jaba-flavour-lines'
import {
  findPrimaryPackagingMaterials,
  findPrimaryBottleMaterialForSize,
  findPrimaryStickerMaterialForSize,
  normalizeFlavourLabel,
} from '@/lib/jaba-packaging-materials'
import { buildPackagingSmsBody, sendJabaSmsForEvent } from '@/lib/jaba-sms'
import { requireDeleteOtp } from '@/lib/jaba-delete-otp-guard'
import {
  normalizeQty,
  getTotalContainerUnits,
  computePackagedLitresFromContainers,
} from '@/lib/jaba-packaging-calculations'
import {
  executeMultiFlavourPackagingTransaction,
  PackagingApiError,
} from '@/lib/jaba-packaging-multi-save'
import type { MongoClient } from 'mongodb'

export const runtime = 'nodejs'

const JABA_PACKAGING_IDEMPOTENCY = 'jaba_packaging_idempotency'

class ApiError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.status = status
  }
}

async function generatePackagingLine(
  db: any,
  batchId: string,
  batchNumber: string,
  packagingDate: string | Date
): Promise<string> {
  const year =
    packagingDate instanceof Date
      ? packagingDate.getFullYear()
      : new Date(packagingDate).getFullYear() || new Date().getFullYear()
  const existingCount = await db.collection('jaba_packagingOutput').countDocuments({ batchId: String(batchId) })
  const lineNo = String(existingCount + 1).padStart(2, '0')
  return `${year}-${String(batchNumber).trim()}-L${lineNo}`
}

async function ensurePackagingIdempotencyIndex(db: any) {
  try {
    await db.collection(JABA_PACKAGING_IDEMPOTENCY).createIndex({ key: 1 }, { unique: true })
  } catch {
    /* index may already exist */
  }
}

type IdempotencyReserve = 'fresh' | { replay: Record<string, unknown> } | 'blocked'

async function reservePackagingIdempotencyKey(
  db: any,
  key: string,
  batchId: string
): Promise<IdempotencyReserve> {
  try {
    await db.collection(JABA_PACKAGING_IDEMPOTENCY).insertOne({
      key,
      batchId: String(batchId),
      createdAt: new Date(),
    })
    return 'fresh'
  } catch (e: any) {
    if (e?.code !== 11000) throw e
    const doc = await db.collection(JABA_PACKAGING_IDEMPOTENCY).findOne({ key })
    if (doc?.result) return { replay: doc.result as Record<string, unknown> }
    return 'blocked'
  }
}

async function handleMultiFlavourPackagingPost(
  body: Record<string, unknown>,
  client: MongoClient,
  db: any,
  ObjectId: typeof import('mongodb').ObjectId,
  idempotencyKey: string
) {
  const batchId = String(body.batchId || '')
  const batchNumber = String(body.batchNumber || '')
  const packagingDate = body.packagingDate
  const supervisor = body.supervisor
  const teamMembers = body.teamMembers
  const safetyChecks = Boolean(body.safetyChecks)
  const packagingLines = body.packagingLines as Array<Record<string, unknown>>

  if (!batchId || !batchNumber || !packagingDate || !supervisor) {
    return NextResponse.json(
      {
        error:
          'Missing required fields for multi-flavour packaging: batchId, batchNumber, packagingDate, supervisor.',
      },
      { status: 400 }
    )
  }

  const finalPackageNumber =
    (typeof body.packageNumber === 'string' && body.packageNumber.trim()) ||
    (() => {
      const currentYear = new Date().getFullYear()
      const randomNum = String(Math.floor(Math.random() * 99999)).padStart(5, '0')
      return `PKG-${currentYear}-${randomNum}`
    })()

  const batch = await db.collection('jaba_batches').findOne({ _id: new ObjectId(batchId) })
  if (!batch) {
    return NextResponse.json({ error: 'Batch not found' }, { status: 404 })
  }

  const hasFlavourLines =
    !batch.parentBatchId &&
    (await db.collection(JABA_FLAVOUR_LINES_COLLECTION).countDocuments({ parentBatchId: batchId })) > 0

  if (!hasFlavourLines) {
    return NextResponse.json(
      { error: 'Multi-flavour packaging is only for batches that have flavour lines allocated.' },
      { status: 400 }
    )
  }

  let idempotencyReserved: 'fresh' | null = null
  if (idempotencyKey) {
    const slot = await reservePackagingIdempotencyKey(db, idempotencyKey, batchId)
    if (typeof slot === 'object' && 'replay' in slot) {
      return NextResponse.json(
        { ...(slot.replay as Record<string, unknown>), idempotentReplay: true },
        { status: 201 }
      )
    }
    if (slot === 'blocked') {
      return NextResponse.json(
        { error: 'This packaging save is already being processed. Wait a moment or use a new session.' },
        { status: 409 }
      )
    }
    idempotencyReserved = 'fresh'
  }

  try {
    const result = await executeMultiFlavourPackagingTransaction({
      client,
      db,
      ObjectId,
      batchId,
      batchNumber,
      finalPackageNumber,
      packagingDate: packagingDate as string | Date,
      supervisor: String(supervisor),
      teamMembers,
      safetyChecks,
      batch: batch as Record<string, unknown>,
      lineInputs: packagingLines,
    })

    const allContainers = packagingLines.flatMap((l) => (Array.isArray(l.containers) ? l.containers : []))
    const flavourNames = result.packagingDocs
      .map((d) => String(d.flavourName || '').trim())
      .filter(Boolean)
    const flavourLabel = flavourNames.length > 0 ? flavourNames.join(' · ') : 'Batch'

    let packagingSms: string
    try {
      packagingSms = buildPackagingSmsBody({
        batchNumber: batchNumber.trim(),
        containers: allContainers,
        flavourLabel,
      })
    } catch (smsBodyErr) {
      console.error('[Packaging Output API] SMS summary build failed (multi):', smsBodyErr)
      const litresStr = Number.isFinite(Number(result.totalLitresPacked))
        ? Number(result.totalLitresPacked).toFixed(2)
        : '0.00'
      packagingSms = `PACKAGING COMPLETE\n\nBatch No: ${batchNumber.trim()}\n\nTotal session: ${litresStr}L`
    }
    await sendJabaSmsForEvent('packagingCreated', packagingSms)

    const responsePayload = {
      success: true,
      multiFlavour: true,
      packagingSessionGroupId: result.sessionGroupId,
      packageNumber: finalPackageNumber.trim(),
      totalLitresPacked: result.totalLitresPacked,
      packagingOutputs: result.packagingDocs.map((d, i) => ({
        ...d,
        _id: result.createdIds[i],
        id: result.createdIds[i],
      })),
      remainingLitresByFlavourLine: result.remainingByFlavourLineId,
      packaging: {
        _id: result.createdIds[0],
        id: result.createdIds[0],
        packageNumber: finalPackageNumber.trim(),
        remainingLitres: result.remainingByFlavourLineId[packagingLines[0]?.flavourLineId as string] ?? 0,
      },
    }

    if (idempotencyKey && idempotencyReserved === 'fresh') {
      await db.collection(JABA_PACKAGING_IDEMPOTENCY).updateOne(
        { key: idempotencyKey },
        { $set: { result: responsePayload, completedAt: new Date() } }
      )
    }

    return NextResponse.json(responsePayload, { status: 201 })
  } catch (err: unknown) {
    if (idempotencyKey && idempotencyReserved === 'fresh') {
      await db.collection(JABA_PACKAGING_IDEMPOTENCY).deleteOne({ key: idempotencyKey })
    }
    if (err instanceof PackagingApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    throw err
  }
}

// POST create packaging output
export async function POST(request: Request) {
  const authResult = await requireJabaAction('production.packaging', 'add')
  if ('response' in authResult) return authResult.response

  try {
    const body = await request.json()
    const idempotencyKey =
      typeof body.idempotencyKey === 'string' && body.idempotencyKey.trim()
        ? body.idempotencyKey.trim()
        : ''

    const client = await clientPromise
    const db = client.db('infusion_jaba')
    const { ObjectId } = await import('mongodb')
    await ensurePackagingIdempotencyIndex(db)

    const packagingLinesRaw = body.packagingLines
    if (Array.isArray(packagingLinesRaw) && packagingLinesRaw.length >= 1) {
      return await handleMultiFlavourPackagingPost(body, client, db, ObjectId, idempotencyKey)
    }

    let singleIdempotencyReserved: 'fresh' | null = null

    const {
      batchId,
      batchNumber,
      packageNumber,
      volumeAllocated,
      packagingDate,
      supervisor,
      teamMembers,
      containers,
      totalPackedLitres,
      defects,
      defectReasons,
      machineEfficiency,
      safetyChecks,
      flavourLineId: flavourLineIdRaw,
    } = body

    const flavourLineId =
      typeof flavourLineIdRaw === 'string' && flavourLineIdRaw.trim() ? flavourLineIdRaw.trim() : ''

    // Validate required fields
    if (!batchId || !batchNumber || !volumeAllocated || !packagingDate || !supervisor) {
      return NextResponse.json(
        { error: 'Missing required fields: batchId, batchNumber, packageNumber, volumeAllocated, packagingDate, and supervisor are required' },
        { status: 400 }
      )
    }

    // Generate package number if not provided
    const finalPackageNumber = packageNumber || (() => {
      const currentYear = new Date().getFullYear()
      const randomNum = String(Math.floor(Math.random() * 99999)).padStart(5, "0")
      return `PKG-${currentYear}-${randomNum}`
    })()

    console.log('[Packaging Output API] Creating packaging session for batch:', batchNumber)
    console.log('[Packaging Output API] Package number received:', packageNumber)
    console.log('[Packaging Output API] Final package number to save:', finalPackageNumber)

    const finalPackagingLine = await generatePackagingLine(db, batchId, batchNumber, packagingDate)

    // Get batch to calculate remaining litres
    const batch = await db.collection('jaba_batches').findOne({ _id: new ObjectId(batchId) })
    if (!batch) {
      return NextResponse.json(
        { error: 'Batch not found' },
        { status: 404 }
      )
    }

    for (const c of containers || []) {
      if (normalizeQty((c as any)?.quantity) < 0) {
        return NextResponse.json({ error: 'Container quantities cannot be negative.' }, { status: 400 })
      }
    }

    const packagedLitres =
      totalPackedLitres !== undefined && totalPackedLitres !== null && totalPackedLitres !== ''
        ? Number(totalPackedLitres)
        : computePackagedLitresFromContainers(containers || [])
    const allocatedVolume = Number(volumeAllocated) || 0
    if (allocatedVolume <= 0) {
      return NextResponse.json({ error: 'Volume allocated must be greater than 0.' }, { status: 400 })
    }
    if (packagedLitres <= 0) {
      return NextResponse.json({ error: 'Packed litres must be greater than 0.' }, { status: 400 })
    }
    if (packagedLitres > allocatedVolume + 1e-6) {
      return NextResponse.json(
        {
          error: `Packed litres (${packagedLitres.toFixed(2)}L) cannot exceed allocated volume (${allocatedVolume.toFixed(2)}L).`,
        },
        { status: 400 }
      )
    }

    const hasFlavourLines =
      !batch.parentBatchId &&
      (await db.collection(JABA_FLAVOUR_LINES_COLLECTION).countDocuments({ parentBatchId: batchId })) > 0

    if (hasFlavourLines && !flavourLineId) {
      return NextResponse.json(
        { error: 'This batch is split into flavour lines. Select a flavour line before packaging.' },
        { status: 400 }
      )
    }

    let newRemaining: number | null = null
    let lineAllocated: number | null = null
    let flavourLineDoc: any = null

    if (flavourLineId) {
      flavourLineDoc = await db.collection(JABA_FLAVOUR_LINES_COLLECTION).findOne({ _id: new ObjectId(flavourLineId) })
      if (!flavourLineDoc) {
        return NextResponse.json({ error: 'Flavour line not found' }, { status: 404 })
      }
      if (String(flavourLineDoc.parentBatchId) !== String(batchId)) {
        return NextResponse.json({ error: 'Flavour line does not belong to this batch' }, { status: 400 })
      }
      const priorOutputs = await db.collection('jaba_packagingOutput').find({ flavourLineId }).toArray()
      const priorLitres = sumPackagedLitresForFlavourLine(priorOutputs, { flavourLineId })
      const alloc = Number(flavourLineDoc.allocatedLitres) || 0
      lineAllocated = alloc
      if (priorLitres + packagedLitres > alloc + 1e-6) {
        return NextResponse.json(
          {
            error: `Packaging would exceed this flavour line allocation (${alloc.toFixed(2)}L). Already packaged ${priorLitres.toFixed(2)}L, session adds ${packagedLitres.toFixed(2)}L.`,
          },
          { status: 400 }
        )
      }
      newRemaining = Math.max(0, alloc - priorLitres - packagedLitres)
    } else {
      const currentRemaining = batch.outputSummary?.remainingLitres || batch.totalLitres
      if (packagedLitres > Number(currentRemaining) + 1e-6) {
        return NextResponse.json(
          {
            error: `Packaging would exceed remaining batch volume (${Number(currentRemaining).toFixed(2)}L). Session adds ${packagedLitres.toFixed(2)}L.`,
          },
          { status: 400 }
        )
      }
      newRemaining = currentRemaining - packagedLitres
    }

    // Prepare packaging output document
    const packagingData: Record<string, unknown> = {
      batchId: batchId,
      batchNumber: batchNumber.trim(),
      packageNumber: finalPackageNumber.trim(),
      volumeAllocated: Number(volumeAllocated),
      packagedLitres: packagedLitres,
      packagingDate: new Date(packagingDate),
      packagingLine: finalPackagingLine,
      supervisor: supervisor.trim(),
      teamMembers: teamMembers || [],
      containers: containers || [],
      defects: Number(defects) || 0,
      defectReasons: defectReasons?.trim() || '',
      machineEfficiency: machineEfficiency ? Number(machineEfficiency) : undefined,
      safetyChecks: safetyChecks || false,
      createdAt: new Date(),
    }

    if (flavourLineId && flavourLineDoc) {
      packagingData.flavourLineId = flavourLineId
      packagingData.flavourName = String(flavourLineDoc.flavourName || '')
    }

    const totalUnitsPacked = getTotalContainerUnits(containers || [])
    if (totalUnitsPacked <= 0) {
      return NextResponse.json(
        { error: 'No container quantity entered. Add at least one packaged bottle.' },
        { status: 400 }
      )
    }

    if (idempotencyKey) {
      const slot = await reservePackagingIdempotencyKey(db, idempotencyKey, String(batchId))
      if (typeof slot === 'object' && 'replay' in slot) {
        return NextResponse.json(
          { ...(slot.replay as Record<string, unknown>), idempotentReplay: true },
          { status: 201 }
        )
      }
      if (slot === 'blocked') {
        return NextResponse.json(
          { error: 'This packaging save is already being processed. Wait a moment or use a new session.' },
          { status: 409 }
        )
      }
      singleIdempotencyReserved = 'fresh'
    }

    const rawMaterialsCollection = db.collection('jaba_rawMaterials')
    const mongoSession = client.startSession()
    let createdPackagingId = ''
    let txRemainingLitres = Math.max(0, newRemaining ?? 0)

    const resolvedFlavourName = normalizeFlavourLabel(
      flavourLineDoc?.flavourName ||
        flavourLineDoc?.flavor ||
        batch.flavourName ||
        batch.flavor ||
        batch.flavour ||
        ''
    )
    const stickerMustMatchFlavour = resolvedFlavourName.length > 0

    try {
      await mongoSession.withTransaction(async () => {
        const fmtSize = (size: string, customSize?: string) => (size === 'custom' ? `${customSize ?? ''}ml` : size)

        // Group quantities by container "size spec", then resolve the correct raw materials per size.
        const sizeSpecToUnits = new Map<
          string,
          {
            size: string
            customSize?: string
            units: number
          }
        >()

        for (const c of containers || []) {
          const units = normalizeQty((c as any).quantity)
          if (units <= 0) continue

          const size = String((c as any).size || '')
          const customSize = (c as any).customSize ? String((c as any).customSize) : undefined
          const specKey = size === 'custom' ? `custom:${customSize ?? ''}` : size

          const existing = sizeSpecToUnits.get(specKey)
          if (existing) {
            existing.units += units
          } else {
            sizeSpecToUnits.set(specKey, { size, customSize, units })
          }
        }

        const bottleRequirementsById = new Map<string, { doc: any; units: number }>()
        const stickerRequirementsById = new Map<string, { doc: any; units: number }>()
        const packingMaterialLines: Array<{
          flavourName: string
          containerSize: string
          customSizeMl?: string
          quantityPacked: number
          stickersUsed: number
          stickerMaterialId: string
          stickerMaterialName: string
          bottleMaterialId: string
          bottleMaterialName: string
          bottlesUsed: number
        }> = []

        for (const spec of sizeSpecToUnits.values()) {
          const [bottleMaterial, stickerMaterial] = await Promise.all([
            findPrimaryBottleMaterialForSize(rawMaterialsCollection, {
              size: spec.size,
              customSize: spec.customSize,
              session: mongoSession,
            }),
            findPrimaryStickerMaterialForSize(rawMaterialsCollection, {
              size: spec.size,
              customSize: spec.customSize,
              flavourName: resolvedFlavourName || undefined,
              requireFlavorSpecific: stickerMustMatchFlavour,
              session: mongoSession,
            }),
          ])

          if (!bottleMaterial) {
            throw new ApiError(
              `No bottle raw material found for size ${fmtSize(spec.size, spec.customSize)}. Add an item like "250ml Bottles", "500ml Bottles", "1L Bottles", "2L Bottles" in Raw Materials.`,
              400
            )
          }
          if (!stickerMaterial) {
            const hint = stickerMustMatchFlavour
              ? ` For flavour "${resolvedFlavourName}", create a Packaging raw material such as "${fmtSize(spec.size, spec.customSize)} ${resolvedFlavourName} Stickers" (or set field packagingStickerFlavor on the sticker row).`
              : ` Add an item like "${fmtSize(spec.size, spec.customSize)} Stickers" or "Labels" in Raw Materials before packaging.`
            throw new ApiError(
              `No sticker raw material found for size ${fmtSize(spec.size, spec.customSize)}.${hint}`,
              400
            )
          }

          const bottleId = String(bottleMaterial._id)
          const stickerId = String(stickerMaterial._id)

          const existingBottle = bottleRequirementsById.get(bottleId)
          if (existingBottle) existingBottle.units += spec.units
          else bottleRequirementsById.set(bottleId, { doc: bottleMaterial, units: spec.units })

          const existingSticker = stickerRequirementsById.get(stickerId)
          if (existingSticker) existingSticker.units += spec.units
          else stickerRequirementsById.set(stickerId, { doc: stickerMaterial, units: spec.units })

          packingMaterialLines.push({
            flavourName: resolvedFlavourName || String(batch.flavor || batch.flavour || '—'),
            containerSize: spec.size,
            customSizeMl: spec.size === 'custom' ? spec.customSize : undefined,
            quantityPacked: spec.units,
            stickersUsed: spec.units,
            stickerMaterialId: stickerId,
            stickerMaterialName: String(stickerMaterial.name || 'Stickers'),
            bottleMaterialId: bottleId,
            bottleMaterialName: String(bottleMaterial.name || 'Bottles'),
            bottlesUsed: spec.units,
          })
        }

        // Validate stock before deducting (still inside the transaction).
        for (const req of bottleRequirementsById.values()) {
          const stock = Number(req.doc.currentStock) || 0
          if (stock < req.units) {
            throw new ApiError(
              `Insufficient bottle stock: need ${req.units.toLocaleString()}, available ${stock.toLocaleString()} (${String(
                req.doc.name || 'bottles'
              )}).`,
              400
            )
          }
        }
        for (const req of stickerRequirementsById.values()) {
          const stock = Number(req.doc.currentStock) || 0
          if (stock < req.units) {
            throw new ApiError(
              `Insufficient sticker stock: need ${req.units.toLocaleString()}, available ${stock.toLocaleString()} (${String(
                req.doc.name || 'stickers'
              )}).`,
              400
            )
          }
        }

        const materialsUsed: any[] = []
        for (const [materialId, req] of bottleRequirementsById.entries()) {
          materialsUsed.push({
            materialId,
            name: String(req.doc.name || 'Bottles'),
            type: 'bottles',
            quantity: req.units,
            flavourName: resolvedFlavourName || undefined,
          })
        }
        for (const [materialId, req] of stickerRequirementsById.entries()) {
          materialsUsed.push({
            materialId,
            name: String(req.doc.name || 'Stickers'),
            type: 'stickers',
            quantity: req.units,
            flavourName: resolvedFlavourName || undefined,
          })
        }

        ;(packagingData as any).materialsUsed = materialsUsed
        ;(packagingData as any).packingMaterialLines = packingMaterialLines
        ;(packagingData as any).packedFlavourName = resolvedFlavourName || undefined

        // Re-read current batch inside transaction for concurrency-safe update.
        const txBatch = await db.collection('jaba_batches').findOne({ _id: new ObjectId(batchId) }, { session: mongoSession })
        if (!txBatch) throw new ApiError('Batch not found', 404)

        if (flavourLineId) {
          const txLine = await db.collection(JABA_FLAVOUR_LINES_COLLECTION).findOne({ _id: new ObjectId(flavourLineId) }, { session: mongoSession })
          if (!txLine) throw new ApiError('Flavour line not found', 404)
          const txPriorOutputs = await db.collection('jaba_packagingOutput').find({ flavourLineId }, { session: mongoSession }).toArray()
          const txPriorLitres = sumPackagedLitresForFlavourLine(txPriorOutputs, { flavourLineId })
          const txAlloc = Number(txLine.allocatedLitres) || 0
          if (txPriorLitres + packagedLitres > txAlloc + 1e-6) {
            throw new ApiError(
              `Packaging would exceed this flavour line allocation (${txAlloc.toFixed(2)}L). Already packaged ${txPriorLitres.toFixed(2)}L, session adds ${packagedLitres.toFixed(2)}L.`,
              400
            )
          }
          txRemainingLitres = Math.max(0, txAlloc - txPriorLitres - packagedLitres)
        } else {
          const txRemaining = Number(txBatch.outputSummary?.remainingLitres ?? txBatch.totalLitres) || 0
          if (packagedLitres > txRemaining + 1e-6) {
            throw new ApiError(
              `Packaging would exceed remaining batch volume (${txRemaining.toFixed(2)}L). Session adds ${packagedLitres.toFixed(2)}L.`,
              400
            )
          }
          txRemainingLitres = Math.max(0, txRemaining - packagedLitres)
        }

        const packagingInsert = await db.collection('jaba_packagingOutput').insertOne(packagingData, { session: mongoSession })
        createdPackagingId = packagingInsert.insertedId.toString()

        const bottleAdds = containers.reduce(
          (sum: number, c: any) => sum + Math.max(0, parseFloat(c.quantity) || 0),
          0
        )

        // Deduct bottles and stickers using conditional $inc to keep it concurrency-safe.
        for (const [_, req] of bottleRequirementsById.entries()) {
          const qty = req.units
          const bottleDeduct = await rawMaterialsCollection.updateOne(
            { _id: req.doc._id, currentStock: { $gte: qty } },
            { $inc: { currentStock: -qty }, $set: { updatedAt: new Date() } },
            { session: mongoSession }
          )
          if (bottleDeduct.modifiedCount !== 1) {
            throw new ApiError('Raw material stock changed during packaging. Please refresh and try again.', 409)
          }
        }

        for (const [_, req] of stickerRequirementsById.entries()) {
          const qty = req.units
          const stickerDeduct = await rawMaterialsCollection.updateOne(
            { _id: req.doc._id, currentStock: { $gte: qty } },
            { $inc: { currentStock: -qty }, $set: { updatedAt: new Date() } },
            { session: mongoSession }
          )
          if (stickerDeduct.modifiedCount !== 1) {
            throw new ApiError('Raw material stock changed during packaging. Please refresh and try again.', 409)
          }
        }

        const packagingMovementTs = new Date()
        const packagingMovementDocs: Record<string, unknown>[] = []
        const pushPackagingMovement = (req: { doc: any; units: number }, materialType: 'bottles' | 'stickers') => {
          const qty = req.units
          const before = Number(req.doc.currentStock) || 0
          packagingMovementDocs.push({
            type: 'DEDUCTION',
            reason: 'PACKAGING',
            batchId,
            batchNumber: String(batchNumber).trim(),
            packagingOutputId: createdPackagingId,
            packageNumber: finalPackageNumber.trim(),
            materialType,
            materialId: String(req.doc._id),
            materialName: String(req.doc.name || materialType),
            quantity: qty,
            unit: String(req.doc.unit || 'pcs'),
            beforeStock: before,
            afterStock: before - qty,
            userId: 'system',
            timestamp: packagingMovementTs,
            createdAt: packagingMovementTs,
          })
        }
        for (const req of bottleRequirementsById.values()) pushPackagingMovement(req, 'bottles')
        for (const req of stickerRequirementsById.values()) pushPackagingMovement(req, 'stickers')
        if (packagingMovementDocs.length > 0) {
          await db.collection('jaba_inventory_movements').insertMany(packagingMovementDocs, { session: mongoSession })
        }

        const updateData: Record<string, unknown> = {
          'outputSummary.totalBottles': (txBatch.outputSummary?.totalBottles || 0) + bottleAdds,
          updatedAt: new Date(),
        }

        if (flavourLineId) {
          if (
            txBatch.status === 'QC Passed - Ready for Packaging' ||
            txBatch.status === 'Ready for Packaging' ||
            txBatch.status === 'Partially Allocated' ||
            txBatch.status === 'Fully Allocated'
          ) {
            updateData.status = 'Partially Packaged'
          }
        } else {
          updateData['outputSummary.remainingLitres'] = txRemainingLitres
          if (txRemainingLitres <= 0) {
            updateData.status = 'Ready for Distribution'
          } else if (
            txBatch.status === 'QC Passed - Ready for Packaging' ||
            txBatch.status === 'Ready for Packaging'
          ) {
            updateData.status = 'Partially Packaged'
          }
        }

        containers.forEach((container: any) => {
          const qty = Math.max(0, parseFloat(container.quantity) || 0)
          if (container.size === '250ml') updateData.bottles250ml = (txBatch.bottles250ml || 0) + qty
          else if (container.size === '500ml') updateData.bottles500ml = (txBatch.bottles500ml || 0) + qty
          else if (container.size === '1L') updateData.bottles1L = (txBatch.bottles1L || 0) + qty
          else if (container.size === '2L') updateData.bottles2L = (txBatch.bottles2L || 0) + qty
        })

        await db.collection('jaba_batches').updateOne(
          { _id: new ObjectId(batchId) },
          { $set: updateData },
          { session: mongoSession }
        )
      })
    } finally {
      await mongoSession.endSession()
    }

    console.log(`[Packaging Output API] Packaging session created (ID: ${createdPackagingId}, Package Number: ${finalPackageNumber})`)
    const bch = String(batchNumber ?? '').trim()
    const litresStr = Number.isFinite(Number(packagedLitres)) ? Number(packagedLitres).toFixed(2) : '0.00'
    let packagingSms: string
    try {
      const flavourLabel =
        String((packagingData as { flavourName?: string }).flavourName || '').trim() ||
        String((batch as { flavor?: string; flavour?: string }).flavor || (batch as { flavour?: string }).flavour || '').trim() ||
        'Batch'
      packagingSms = buildPackagingSmsBody({
        batchNumber: bch,
        containers: Array.isArray(containers) ? containers : [],
        flavourLabel,
      })
    } catch (smsBodyErr) {
      console.error('[Packaging Output API] SMS summary build failed, using short message:', smsBodyErr)
      packagingSms = `PACKAGING COMPLETE\n\nBatch No: ${bch}\n\nTotal session: ${litresStr}L`
    }
    await sendJabaSmsForEvent('packagingCreated', packagingSms)

    const responsePayload = {
      success: true,
      packaging: {
        ...packagingData,
        _id: createdPackagingId,
        id: createdPackagingId,
        remainingLitres: txRemainingLitres,
        remainingOnFlavourLineLitres: flavourLineId ? txRemainingLitres : undefined,
        flavourAllocatedLitres: lineAllocated ?? undefined,
      },
    }

    if (idempotencyKey && singleIdempotencyReserved === 'fresh') {
      await db.collection(JABA_PACKAGING_IDEMPOTENCY).updateOne(
        { key: idempotencyKey },
        { $set: { result: responsePayload, completedAt: new Date() } }
      )
    }

    return NextResponse.json(responsePayload, { status: 201 })
  } catch (error: any) {
    if (idempotencyKey && singleIdempotencyReserved === 'fresh') {
      await db.collection(JABA_PACKAGING_IDEMPOTENCY).deleteOne({ key: idempotencyKey }).catch(() => {})
    }
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    if (error instanceof PackagingApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('[Packaging Output API] Error creating packaging output:', error)
    return NextResponse.json(
      {
        error: 'Failed to create packaging output',
        details: error.message || String(error),
      },
      { status: 500 }
    )
  }
}

// GET packaging outputs
export async function GET(request: Request) {
  const authResult = await requireJabaAction('production.packaging', 'view')
  if ('response' in authResult) return authResult.response

  try {
    console.log('[Packaging Output API] GET request received')
    const { searchParams } = new URL(request.url)
    const batchId = searchParams.get('batchId')
    console.log('[Packaging Output API] BatchId filter:', batchId || 'none')

    const client = await clientPromise
    const db = client.db('infusion_jaba')

    const query: any = {}
    if (batchId) {
      query.batchId = batchId
    }

    const packagingOutputs = await db
      .collection('jaba_packagingOutput')
      .find(query)
      .sort({ createdAt: -1, packagingDate: -1 })
      .toArray()

    const formattedOutputs = packagingOutputs.map(output => ({
      ...output,
      _id: output._id.toString(),
      id: output._id.toString(),
      packagingDate: output.packagingDate instanceof Date ? output.packagingDate.toISOString() : output.packagingDate,
      createdAt: output.createdAt instanceof Date ? output.createdAt.toISOString() : output.createdAt,
    }))

    return NextResponse.json({ packagingOutputs: formattedOutputs })
  } catch (error: any) {
    console.error('[Packaging Output API] Error fetching packaging outputs:', error)
    console.error('[Packaging Output API] Error stack:', error.stack)
    return NextResponse.json(
      {
        error: 'Failed to fetch packaging outputs',
        details: error.message || String(error),
      },
      { status: 500 }
    )
  }
}

// DELETE packaging output and restore packaging materials stock
export async function DELETE(request: Request) {
  const authResult = await requireJabaAction('production.packaging', 'delete')
  if ('response' in authResult) return authResult.response

  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    if (!id) {
      return NextResponse.json({ error: 'Packaging output id is required' }, { status: 400 })
    }
    const otpCheck = await requireDeleteOtp(request, 'delete_packaging', id)
    if ('response' in otpCheck) return otpCheck.response

    const client = await clientPromise
    const db = client.db('infusion_jaba')
    const { ObjectId } = await import('mongodb')

    const packagingOutput = await db.collection('jaba_packagingOutput').findOne({ _id: new ObjectId(id) })
    if (!packagingOutput) {
      return NextResponse.json({ error: 'Packaging output not found' }, { status: 404 })
    }

    const containers = Array.isArray(packagingOutput.containers) ? packagingOutput.containers : []
    const totalUnitsPacked = getTotalContainerUnits(containers as any[])
    const rawMaterialsCollection = db.collection('jaba_rawMaterials')

    // Prefer exact materials used for this session; fallback by name if old records don't have metadata.
    const materialsUsed = Array.isArray((packagingOutput as any).materialsUsed)
      ? (packagingOutput as any).materialsUsed
      : []

    const reversalTs = new Date()
    if (materialsUsed.length > 0) {
      for (const materialUse of materialsUsed) {
        const qty = normalizeQty(materialUse.quantity)
        if (!materialUse.materialId || qty <= 0) continue
        const mid = new ObjectId(String(materialUse.materialId))
        const beforeDoc = await rawMaterialsCollection.findOne({ _id: mid })
        const before = beforeDoc ? Number(beforeDoc.currentStock) || 0 : 0
        await rawMaterialsCollection.updateOne(
          { _id: mid },
          { $inc: { currentStock: qty }, $set: { updatedAt: new Date() } }
        )
        const after = before + qty
        await db.collection('jaba_inventory_movements').insertOne({
          type: 'ADJUSTMENT',
          reason: 'PACKAGING_DELETED',
          batchId: String(packagingOutput.batchId || ''),
          batchNumber: String(packagingOutput.batchNumber || ''),
          packagingOutputId: id,
          packageNumber: String(packagingOutput.packageNumber || ''),
          materialId: String(materialUse.materialId),
          materialName: String(materialUse.name || 'Material'),
          quantity: qty,
          unit: String((beforeDoc as { unit?: string })?.unit || 'pcs'),
          beforeStock: before,
          afterStock: after,
          userId: 'system',
          timestamp: reversalTs,
          createdAt: reversalTs,
        })
      }
    } else if (totalUnitsPacked > 0) {
      const { bottleMaterial, stickerMaterial } = await findPrimaryPackagingMaterials(rawMaterialsCollection)
      if (bottleMaterial) {
        await rawMaterialsCollection.updateOne(
          { _id: bottleMaterial._id },
          { $inc: { currentStock: totalUnitsPacked }, $set: { updatedAt: new Date() } }
        )
      }
      if (stickerMaterial) {
        await rawMaterialsCollection.updateOne(
          { _id: stickerMaterial._id },
          { $inc: { currentStock: totalUnitsPacked }, $set: { updatedAt: new Date() } }
        )
      }
    }

    // Reverse batch packed counters and remaining litres.
    const batchId = String(packagingOutput.batchId || '')
    if (batchId) {
      const batch = await db.collection('jaba_batches').findOne({ _id: new ObjectId(batchId) })
      if (batch) {
        const packagedLitres = Number(packagingOutput.packagedLitres) || 0
        const updateData: Record<string, unknown> = {
          updatedAt: new Date(),
          'outputSummary.totalBottles': Math.max(0, (Number(batch.outputSummary?.totalBottles) || 0) - totalUnitsPacked),
        }

        if (!(packagingOutput as any).flavourLineId) {
          updateData['outputSummary.remainingLitres'] =
            Math.max(0, (Number(batch.outputSummary?.remainingLitres) || 0) + packagedLitres)
          if (batch.status === 'Ready for Distribution') {
            updateData.status = 'Partially Packaged'
          }
        }

        for (const container of containers as any[]) {
          const qty = normalizeQty(container.quantity)
          if (container.size === '250ml') {
            updateData.bottles250ml = Math.max(0, (Number(batch.bottles250ml) || 0) - qty)
          } else if (container.size === '500ml') {
            updateData.bottles500ml = Math.max(0, (Number(batch.bottles500ml) || 0) - qty)
          } else if (container.size === '1L') {
            updateData.bottles1L = Math.max(0, (Number(batch.bottles1L) || 0) - qty)
          } else if (container.size === '2L') {
            updateData.bottles2L = Math.max(0, (Number(batch.bottles2L) || 0) - qty)
          }
        }

        await db.collection('jaba_batches').updateOne(
          { _id: new ObjectId(batchId) },
          { $set: updateData }
        )
      }
    }

    await db.collection('jaba_packagingOutput').deleteOne({ _id: new ObjectId(id) })

    return NextResponse.json({
      success: true,
      message: 'Packaging session deleted and packaging materials stock restored.',
    })
  } catch (error: any) {
    console.error('[Packaging Output API] Error deleting packaging output:', error)
    return NextResponse.json(
      {
        error: 'Failed to delete packaging output',
        details: error.message || String(error),
      },
      { status: 500 }
    )
  }
}
