import type { Db } from 'mongodb'
import { normalizePhoneNumbers, sendJabaSmsStrict } from '@/lib/jaba-sms'
import { summarizeCathaOrderPayments } from '@/lib/catha-order-payments'

const STUCK_SENDING_MS = 2 * 60_000

function buildCathaPaymentReceiptMessage(orderId: string, forceUnique = false): string {
  const receiptLink =
    process.env.CATHA_RECEIPT_LINK_BASE?.trim() ||
    `https://infusionjaba.co.ke/r/${encodeURIComponent(orderId)}`
  const base = `Payment received. Your order at Catha Lounge is confirmed.\nReceipt: ${receiptLink}\n\nThank you for visiting us.`
  // Manual resends need a unique body so providers/gateways don't silently drop duplicates.
  if (forceUnique) {
    return `${base}\nRef: ${Date.now().toString(36)}`
  }
  return base
}

function isOrderSettledForSms(order: Record<string, unknown>): boolean {
  const status = String(order.status || '').toLowerCase()
  const paymentStatus = String(order.paymentStatus || '').toUpperCase()
  const summary = summarizeCathaOrderPayments(order as any)
  const explicitPaid =
    paymentStatus === 'PAID' ||
    paymentStatus === 'OVERPAID' ||
    paymentStatus === 'COMPLETED'
  const computedPaid = summary.paymentStatus === 'PAID' || summary.paymentStatus === 'OVERPAID'
  // Completed cash/mpesa rows, or paid even if status string is still pending in legacy data.
  if (status === 'completed' && (explicitPaid || computedPaid)) return true
  if (explicitPaid && (status === 'completed' || status === 'paid' || status === 'pending')) {
    // Paid POS rows sometimes stay pending briefly; still allow receipt SMS.
    return computedPaid || explicitPaid
  }
  return false
}

export async function maybeSendCathaPaymentReceiptSms(
  db: Db,
  orderId: string,
  options?: { force?: boolean; phoneOverride?: string | null }
): Promise<{ sent: boolean; reason?: string; phone?: string | null }> {
  const force = options?.force === true
  const order = await db.collection('orders').findOne({ id: orderId })
  if (!order) return { sent: false, reason: 'order_not_found' }

  if (!force && !isOrderSettledForSms(order as Record<string, unknown>)) {
    return { sent: false, reason: 'order_not_settled' }
  }
  // Manual resend: still require a completed/paid-looking order so we don't spam open tabs.
  if (force && !isOrderSettledForSms(order as Record<string, unknown>)) {
    const status = String(order.status || '').toLowerCase()
    if (status !== 'completed') {
      return {
        sent: false,
        reason: `order_not_settled (status=${status || 'n/a'}, paymentStatus=${String(order.paymentStatus || 'n/a')})`,
      }
    }
  }

  const normalized = normalizePhoneNumbers(
    options?.phoneOverride ?? order.customerPhone ?? ''
  )
  const targetPhone = normalized[0] || null
  if (!targetPhone) {
    return {
      sent: false,
      reason: 'no_valid_customer_phone',
      phone: String(order.customerPhone || options?.phoneOverride || '') || null,
    }
  }

  const stuckCutoff = new Date(Date.now() - STUCK_SENDING_MS)
  const claimFilter = force
    ? // Manual resend must always be allowed to take the lock.
      { id: orderId }
    : {
        id: orderId,
        $or: [
          { paymentReceiptSmsStatus: { $nin: ['SENDING', 'SENT'] } },
          {
            paymentReceiptSmsStatus: 'SENDING',
            paymentReceiptSmsSentAt: { $lte: stuckCutoff },
          },
          {
            paymentReceiptSmsStatus: 'SENDING',
            $or: [
              { paymentReceiptSmsSentAt: { $exists: false } },
              { paymentReceiptSmsSentAt: null },
            ],
          },
        ],
      }

  const claim = await db.collection('orders').updateOne(claimFilter, {
    $set: {
      paymentReceiptSmsSentAt: new Date(),
      paymentReceiptSmsPhone: targetPhone,
      paymentReceiptSmsStatus: 'SENDING',
      updatedAt: new Date(),
    },
  })
  if (claim.matchedCount === 0) {
    return { sent: false, reason: 'already_sent_or_in_progress', phone: targetPhone }
  }

  const message = buildCathaPaymentReceiptMessage(orderId, force)
  try {
    await sendJabaSmsStrict(message, [targetPhone], { allowDuplicateCheck: false })
    await db.collection('orders').updateOne(
      { id: orderId },
      {
        $set: {
          paymentReceiptSmsStatus: 'SENT',
          paymentReceiptSmsLastError: null,
          updatedAt: new Date(),
        },
      }
    )
    return { sent: true, phone: targetPhone }
  } catch (error: any) {
    const errMsg = String(error?.message || 'sms_send_failed')
    await db.collection('orders').updateOne(
      { id: orderId },
      {
        $set: {
          paymentReceiptSmsStatus: 'FAILED',
          paymentReceiptSmsLastError: errMsg,
          updatedAt: new Date(),
        },
        $unset: {
          paymentReceiptSmsSentAt: '',
        },
      }
    )
    return { sent: false, reason: errMsg, phone: targetPhone }
  }
}
