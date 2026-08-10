import type { Db } from 'mongodb'
import { filterInventoryStockLineItems } from '@/lib/catha-order-inventory-lines'
import { ECOMMERCE_CHECKOUT_SESSIONS_COLLECTION } from '@/lib/ecommerce-checkout-session-constants'
import { logEcommerceRecoveryCritical } from '@/lib/ecommerce-stock-reservation'
import { maybeSendOnlineOrderSms } from '@/lib/catha-online-order-sms'

export type EcommerceCheckoutSessionSnapshot = {
  customerName: string
  customerEmail: string
  deliveryAddress: string
  city: string
  postalCode: string
  deliveryNotes: string
  deliveryOption: string | null
  items: unknown[]
  subtotal: number
  vat: number
  deliveryFee: number
  total: number
  discountTotal?: number
}

export type EcommerceCheckoutSessionDoc = {
  id: string
  status: string
  shopUserId: string
  customerPhone: string
  amountExpected: number
  snapshot: EcommerceCheckoutSessionSnapshot
  orderId?: string | null
  mpesaCheckoutRequestId?: string | null
  createdAt?: Date
  updatedAt?: Date
  /** Stock was deducted at session creation and must not be deducted again at payment. */
  reservationHoldActive?: boolean
  reservationExpiresAt?: Date | null
  reservationConsumedAt?: Date | null
  needsAdminReview?: boolean
  adminReviewReason?: string | null
}

function newEcommerceOrderId(): string {
  return `ECO${Date.now().toString().slice(-8)}`
}

/**
 * Idempotent: duplicate callbacks / retries must not create duplicate orders.
 * Uses unique sparse index on `orders.sourceCheckoutSessionId` + pre-insert find.
 */
export async function createPaidEcommerceOrderFromCheckoutSession(
  db: Db,
  session: EcommerceCheckoutSessionDoc,
  opts: {
    mpesaReceiptNumber: string | null
    checkoutRequestId: string
    txnAmount: number
  }
): Promise<
  | { ok: true; orderId: string; duplicate: boolean }
  | { ok: false; reason: string; detail?: string }
> {
  const sessions = db.collection(ECOMMERCE_CHECKOUT_SESSIONS_COLLECTION)
  const orders = db.collection('orders')

  if (session.orderId && typeof session.orderId === 'string') {
    const existing = await orders.findOne({ id: session.orderId })
    if (existing) {
      console.log('[ecommerce-checkout] idempotent hit — session already has order', {
        sessionId: session.id,
        orderId: session.orderId,
      })
      return { ok: true, orderId: session.orderId, duplicate: true }
    }
  }

  const existingBySession = await orders.findOne({ sourceCheckoutSessionId: session.id })
  if (existingBySession?.id) {
    await sessions.updateOne(
      { id: session.id },
      {
        $set: {
          orderId: existingBySession.id,
          status: 'converted',
          reservationHoldActive: false,
          reservationConsumedAt: new Date(),
          updatedAt: new Date(),
        },
      }
    )
    console.log('[ecommerce-checkout] idempotent hit — unique order for session exists', {
      sessionId: session.id,
      orderId: existingBySession.id,
    })
    return { ok: true, orderId: existingBySession.id, duplicate: true }
  }

  const expected = Number(session.amountExpected ?? session.snapshot?.total ?? 0)
  if (
    Number.isFinite(expected) &&
    Number.isFinite(opts.txnAmount) &&
    Math.abs(Number(opts.txnAmount) - expected) > 0.02
  ) {
    console.error('[ecommerce-checkout] amount mismatch — refusing order create', {
      sessionId: session.id,
      txnAmount: opts.txnAmount,
      expected,
    })
    logEcommerceRecoveryCritical({
      event: 'mpesa_amount_mismatch_checkout_session',
      sessionId: session.id,
      txnAmount: opts.txnAmount,
      expected,
    })
    await sessions.updateOne(
      { id: session.id },
      {
        $set: {
          needsAdminReview: true,
          adminReviewReason: 'amount_mismatch_at_fulfillment',
          updatedAt: new Date(),
        },
      }
    )
    return { ok: false, reason: 'amount_mismatch', detail: 'Transaction amount does not match checkout session.' }
  }

  const snap = session.snapshot
  const inventoryItems = filterInventoryStockLineItems(snap.items)

  if (inventoryItems.length > 0 && session.reservationHoldActive !== true) {
    logEcommerceRecoveryCritical({
      event: 'paid_checkout_missing_reservation',
      sessionId: session.id,
      message:
        'M-Pesa success for session with inventory but no active reservation — refusing auto order create; admin must reconcile stock/payment.',
    })
    await sessions.updateOne(
      { id: session.id },
      {
        $set: {
          needsAdminReview: true,
          adminReviewReason: 'missing_reservation_at_payment',
          updatedAt: new Date(),
        },
      }
    )
    return { ok: false, reason: 'missing_reservation', detail: 'Checkout stock reservation missing; staff review required.' }
  }

  const orderId = newEcommerceOrderId()
  const now = new Date()
  const order = {
    id: orderId,
    type: 'ecommerce' as const,
    orderSource: 'online' as const,
    sourceCheckoutSessionId: session.id,
    customerName: snap.customerName,
    customerPhone: session.customerPhone,
    customerEmail: snap.customerEmail,
    deliveryAddress: snap.deliveryAddress,
    city: snap.city,
    postalCode: snap.postalCode,
    deliveryNotes: snap.deliveryNotes,
    deliveryOption: snap.deliveryOption,
    items: snap.items,
    subtotal: snap.subtotal,
    vat: snap.vat,
    deliveryFee: snap.deliveryFee,
    total: snap.total,
    paymentMethod: 'mpesa',
    paymentStatus: 'PAID' as const,
    mpesaReceiptNumber: opts.mpesaReceiptNumber,
    status: 'completed' as const,
    mpesaCheckoutRequestId: opts.checkoutRequestId,
    timestamp: now,
    createdAt: now,
    updatedAt: now,
    /** Stock was already deducted when the checkout session was created (reservation). */
    stockDeducted: inventoryItems.length > 0,
    stockDeductedAt: inventoryItems.length > 0 ? (session.createdAt instanceof Date ? session.createdAt : now) : null,
    stockReleasedAt: null as Date | null,
  }

  try {
    await orders.insertOne(order)
  } catch (e: unknown) {
    const code = (e as { code?: number })?.code
    if (code === 11000) {
      const dup = await orders.findOne({ sourceCheckoutSessionId: session.id })
      if (dup?.id) {
        console.warn('[ecommerce-checkout] duplicate insert prevented by index', {
          sessionId: session.id,
          orderId: dup.id,
        })
        return { ok: true, orderId: dup.id, duplicate: true }
      }
    }
    logEcommerceRecoveryCritical({
      event: 'order_insert_failed_after_payment',
      sessionId: session.id,
      mpesaReceiptNumber: opts.mpesaReceiptNumber,
      checkoutRequestId: opts.checkoutRequestId,
      error: (e as Error)?.message,
    })
    await sessions.updateOne(
      { id: session.id },
      {
        $set: {
          needsAdminReview: true,
          adminReviewReason: 'order_insert_failed',
          fulfillmentError: 'order_insert_failed',
          fulfillmentDetail: (e as Error)?.message ?? null,
          updatedAt: new Date(),
        },
      }
    )
    return { ok: false, reason: 'order_insert_failed', detail: (e as Error)?.message }
  }

  await sessions.updateOne(
    { id: session.id },
    {
      $set: {
        status: 'converted',
        orderId,
        mpesaReceiptNumber: opts.mpesaReceiptNumber,
        reservationConsumedAt: now,
        reservationHoldActive: false,
        updatedAt: new Date(),
      },
    }
  )

  await maybeSendOnlineOrderSms(db, {
    id: orderId,
    total: snap.total,
    customerPhone: session.customerPhone,
    tableNumber: snap.deliveryOption || 'E-commerce',
  })

  console.log('[ecommerce-checkout] order created from paid session', {
    sessionId: session.id,
    orderId,
    checkoutRequestId: opts.checkoutRequestId,
  })

  return { ok: true, orderId, duplicate: false }
}

export async function ensureEcommerceCheckoutOrderIndexes(db: Db): Promise<void> {
  try {
    await db.collection('orders').createIndex({ sourceCheckoutSessionId: 1 }, { unique: true, sparse: true })
  } catch (e: unknown) {
    const code = (e as { code?: number })?.code
    if (code !== 85 && code !== 86) {
      console.warn('[ecommerce-checkout] ensureEcommerceCheckoutOrderIndexes:', (e as Error)?.message)
    }
  }
}
