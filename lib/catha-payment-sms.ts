import type { Db } from 'mongodb'
import { normalizePhoneNumbers, sendJabaSmsStrict } from '@/lib/jaba-sms'
import { summarizeCathaOrderPayments } from '@/lib/catha-order-payments'

const STUCK_SENDING_MS = 2 * 60_000

function buildCathaPaymentReceiptMessage(orderId: string): string {
  const receiptLink =
    process.env.CATHA_RECEIPT_LINK_BASE?.trim() ||
    `https://infusionjaba.co.ke/r/${encodeURIComponent(orderId)}`
  return `Payment received. Your order at Catha Lounge is confirmed.\nReceipt: ${receiptLink}\n\nThank you for visiting us.`
}

export async function maybeSendCathaPaymentReceiptSms(
  db: Db,
  orderId: string,
  options?: { force?: boolean }
): Promise<{ sent: boolean; reason?: string }> {
  const force = options?.force === true
  const order = await db.collection('orders').findOne({ id: orderId })
  if (!order) return { sent: false, reason: 'order_not_found' }

  const status = String(order.status || '').toLowerCase()
  const paymentStatus = String(order.paymentStatus || '').toUpperCase()
  const summary = summarizeCathaOrderPayments(order as any)
  const explicitPaid = paymentStatus === 'PAID' || paymentStatus === 'OVERPAID'
  const computedPaid = summary.paymentStatus === 'PAID' || summary.paymentStatus === 'OVERPAID'
  const isSettled = status === 'completed' && (explicitPaid || computedPaid)
  if (!isSettled) return { sent: false, reason: 'order_not_settled' }

  const normalized = normalizePhoneNumbers(order.customerPhone ?? '')
  const targetPhone = normalized[0] || null
  if (!targetPhone) return { sent: false, reason: 'no_valid_customer_phone' }

  const stuckCutoff = new Date(Date.now() - STUCK_SENDING_MS)
  const claim = await db.collection('orders').updateOne(
    force
      ? {
          id: orderId,
          // Force resend still avoids duplicate concurrent send (unless stuck).
          $or: [
            { paymentReceiptSmsStatus: { $ne: 'SENDING' } },
            { paymentReceiptSmsSentAt: { $lte: stuckCutoff } },
            { paymentReceiptSmsSentAt: { $exists: false } },
            { paymentReceiptSmsSentAt: null },
          ],
        }
      : {
          id: orderId,
          $or: [
            // Fresh / failed / legacy rows.
            { paymentReceiptSmsStatus: { $nin: ['SENDING', 'SENT'] } },
            // Reclaim rows abandoned mid-send (common when the serverless invoke is killed).
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
        },
    {
      $set: {
        paymentReceiptSmsSentAt: new Date(),
        paymentReceiptSmsPhone: targetPhone,
        paymentReceiptSmsStatus: 'SENDING',
        updatedAt: new Date(),
      },
    }
  )
  if (claim.matchedCount === 0) return { sent: false, reason: 'already_sent_or_in_progress' }

  const message = buildCathaPaymentReceiptMessage(orderId)
  try {
    await sendJabaSmsStrict(message, [targetPhone])
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
    return { sent: true }
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
    return { sent: false, reason: errMsg }
  }
}
