/**
 * Catha POS order payment math: multiple M-Pesa links, partial pay, overpay.
 * Used by API routes and client UI — keep logic identical.
 */

export type CathaPaymentStatus = "NOT_PAID" | "PARTIALLY_PAID" | "PAID" | "OVERPAID"

export interface LinkedMpesaPayment {
  method: "mpesa"
  transactionId: string
  receiptNumber: string | null
  amount: number
  phone: string | null
  /** Payer name when available (e.g. C2B customer_name) */
  payerName?: string | null
  /** M-Pesa transaction status at link time (e.g. COMPLETED) */
  mpesaStatus?: string | null
  /** When the payment was recorded by M-Pesa / gateway */
  transactionDate?: string | Date | null
  linkedAt: string | Date
  linkedBy: string
  /** How this payment was attached: automatic callback, staff link picker, or manual code entry */
  linkSource?: 'automatic' | 'staff_link' | 'manual' | null
  /** Optional reason/notes (manual entry) */
  notes?: string | null
  verifiedAt?: string | Date | null
}

export interface OrderPaymentSummary {
  orderTotal: number
  totalLinkedPayments: number
  balanceDue: number
  overpaymentAmount: number
  paymentStatus: CathaPaymentStatus
}

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** Normalize legacy single mpesaTransactionId into a synthetic linked row for display/math only */
export function getEffectiveLinkedPayments(order: {
  linkedPayments?: LinkedMpesaPayment[] | null
  mpesaTransactionId?: string | null
  mpesaReceiptNumber?: string | null
  total?: number
  linkedAt?: Date | string | null
  linkedBy?: string | null
}): LinkedMpesaPayment[] {
  const raw = Array.isArray(order.linkedPayments) ? order.linkedPayments : []
  const cleaned = raw
    .filter((p) => p && p.method === "mpesa" && String(p.transactionId || "").trim())
    .map((p) => ({
      method: "mpesa" as const,
      transactionId: String(p.transactionId).trim(),
      receiptNumber: p.receiptNumber != null ? String(p.receiptNumber) : null,
      amount: num(p.amount),
      phone: p.phone != null ? String(p.phone) : null,
      payerName: p.payerName != null ? String(p.payerName) : null,
      mpesaStatus: p.mpesaStatus != null ? String(p.mpesaStatus) : null,
      transactionDate: p.transactionDate ?? null,
      linkedAt: p.linkedAt ?? new Date().toISOString(),
      linkedBy: String(p.linkedBy || "System"),
      linkSource: p.linkSource ?? null,
      notes: p.notes != null ? String(p.notes) : null,
      verifiedAt: p.verifiedAt ?? null,
    }))

  if (cleaned.length > 0) return cleaned

  const legacyId = order.mpesaTransactionId ? String(order.mpesaTransactionId).trim() : ""
  if (!legacyId) return []

  return [
    {
      method: "mpesa",
      transactionId: legacyId,
      receiptNumber: order.mpesaReceiptNumber != null ? String(order.mpesaReceiptNumber) : null,
      amount: num(order.total),
      phone: null,
      payerName: null,
      mpesaStatus: null,
      transactionDate: null,
      linkedAt: order.linkedAt ?? new Date().toISOString(),
      linkedBy: String(order.linkedBy || "System"),
    },
  ]
}

export function summarizeCathaOrderPayments(order: {
  total?: number
  linkedPayments?: LinkedMpesaPayment[] | null
  mpesaTransactionId?: string | null
  mpesaReceiptNumber?: string | null
  linkedAt?: Date | string | null
  linkedBy?: string | null
  /** Non-M-Pesa cash received (legacy) — counts toward total received */
  cashAmount?: number | null
}): OrderPaymentSummary {
  const orderTotal = Math.max(0, num(order.total))
  const fromLinks = getEffectiveLinkedPayments(order).reduce((s, p) => s + num(p.amount), 0)
  const cashExtra = num(order.cashAmount)
  const totalLinkedPayments = fromLinks + cashExtra

  const balanceDue = Math.max(0, orderTotal - totalLinkedPayments)
  const overpaymentAmount = Math.max(0, totalLinkedPayments - orderTotal)

  let paymentStatus: CathaPaymentStatus
  if (totalLinkedPayments <= 0) paymentStatus = "NOT_PAID"
  else if (totalLinkedPayments < orderTotal) paymentStatus = "PARTIALLY_PAID"
  else if (totalLinkedPayments > orderTotal) paymentStatus = "OVERPAID"
  else paymentStatus = "PAID"

  return {
    orderTotal,
    totalLinkedPayments,
    balanceDue,
    overpaymentAmount,
    paymentStatus,
  }
}

/** API/FE payload: consistent payment fields + ISO dates for linked payments */
export function formatCathaOrderForApi(order: Record<string, any>) {
  const summary = summarizeCathaOrderPayments(order)
  const linked = getEffectiveLinkedPayments(order).map((p) => {
    const txD = p.transactionDate
    let transactionDateOut: string | null = null
    if (txD != null) {
      try {
        transactionDateOut =
          typeof txD === 'string'
            ? new Date(txD).toISOString()
            : txD instanceof Date
              ? txD.toISOString()
              : new Date(txD as string).toISOString()
      } catch {
        transactionDateOut = null
      }
    }
    return {
      ...p,
      transactionDate: transactionDateOut,
      linkedAt: (() => {
        if (p.linkedAt == null) return null
        if (typeof p.linkedAt === 'string') return p.linkedAt
        try {
          const d = p.linkedAt instanceof Date ? p.linkedAt : new Date(p.linkedAt as string)
          return Number.isNaN(d.getTime()) ? null : d.toISOString()
        } catch {
          return null
        }
      })(),
    }
  })

  const psDb = String(order.paymentStatus || '').toUpperCase()
  const paymentStatusOut =
    summary.paymentStatus === 'PAID'
      ? 'PAID'
      : summary.paymentStatus === 'OVERPAID'
        ? 'OVERPAID'
        : summary.paymentStatus === 'PARTIALLY_PAID'
          ? 'PARTIALLY_PAID'
          : psDb === 'PAID'
            ? 'PAID'
            : psDb === 'OVERPAID'
              ? 'OVERPAID'
              : psDb === 'PARTIALLY_PAID'
                ? 'PARTIALLY_PAID'
                : 'NOT_PAID'

  return {
    linkedPayments: linked,
    totalLinkedPayments: summary.totalLinkedPayments,
    balanceDue: summary.balanceDue,
    overpaymentAmount: summary.overpaymentAmount,
    paymentStatus: paymentStatusOut,
  }
}
