import type { Filter } from 'mongodb'

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export type OrdersListSourceFilter = 'all' | 'menu' | 'online' | 'pos'

export type OrdersListQuery = {
  q: string
  paymentMethod: 'all' | 'glovo' | 'mpesa' | 'card'
  paymentStatus: 'all' | 'PAID' | 'PARTIALLY_PAID' | 'NOT_PAID'
  lifecycle: 'all' | 'cancelled'
  /** Channel: QR /menu, website checkout, or POS counter */
  orderSource?: OrdersListSourceFilter
}

/**
 * Unpaid ecommerce rows in `orders` are legacy orphans (checkout now uses `ecommerce_checkout_sessions`).
 * They must not appear on the main Catha orders list — only real paid / in-flight venue orders belong there.
 */
export const CATHA_ORDERS_MAIN_LIST_EXCLUSION: Filter<Record<string, unknown>> = {
  $nor: [
    {
      type: 'ecommerce',
      $or: [
        { paymentStatus: 'NOT_PAID' },
        { paymentStatus: { $exists: false } },
        { paymentStatus: null },
        { paymentStatus: '' },
      ],
    },
  ],
}

/** AND-merge toolbar filters with the global main-list exclusion. */
export function mergeCathaOrdersMainListFilter(
  toolbarFilter: Filter<Record<string, unknown>>
): Filter<Record<string, unknown>> {
  if (!toolbarFilter || Object.keys(toolbarFilter).length === 0) {
    return CATHA_ORDERS_MAIN_LIST_EXCLUSION
  }
  return { $and: [CATHA_ORDERS_MAIN_LIST_EXCLUSION, toolbarFilter] }
}

/** QR table menu rounds (explicit source or legacy customer cashier rows). */
export function menuOrdersSourceMatch(): Filter<Record<string, unknown>> {
  return {
    $or: [
      { orderSource: 'menu' },
      {
        $and: [
          { type: { $ne: 'ecommerce' } },
          { orderSource: { $nin: ['pos', 'online', 'ecommerce', 'glovo', 'kiosk'] } },
          { cashier: 'Customer' },
          { customerPhone: { $exists: true, $nin: [null, ''] } },
        ],
      },
    ],
  }
}

/** Website / online client checkout. */
export function onlineOrdersSourceMatch(): Filter<Record<string, unknown>> {
  return {
    $or: [
      { type: 'ecommerce' },
      { orderSource: { $in: ['online', 'ecommerce'] } },
    ],
  }
}

/** Counter POS (and other venue) — everything that is not menu or online. */
export function posOrdersSourceMatch(): Filter<Record<string, unknown>> {
  return {
    $nor: [menuOrdersSourceMatch(), onlineOrdersSourceMatch()],
  }
}

/** Digits-only variants so 07… / 254… / +254… all hit stored phones. */
export function phoneSearchVariants(raw: string): string[] {
  const digits = raw.replace(/\D/g, '')
  if (digits.length < 7) return []
  const out = new Set<string>([digits])
  if (digits.startsWith('0') && digits.length === 10) {
    out.add(`254${digits.slice(1)}`)
    out.add(`+254${digits.slice(1)}`)
  }
  if (digits.startsWith('254') && digits.length === 12) {
    out.add(`0${digits.slice(3)}`)
    out.add(`+${digits}`)
  }
  if (digits.length >= 9) {
    const last9 = digits.slice(-9)
    out.add(last9)
    out.add(`0${last9}`)
    out.add(`254${last9}`)
    out.add(`+254${last9}`)
  }
  return [...out]
}

/** Table number from "5", "T5", "table 5", etc. */
export function parseTableSearchToken(raw: string): number | null {
  const m = raw.trim().match(/^(?:t(?:able)?[\s#:-]*)?(\d{1,4})$/i)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) ? n : null
}

/**
 * Mongo filter for Catha orders list (search + toolbar filters). Used with count + find + sort + skip/limit.
 */
export function buildOrdersListMongoFilter(query: OrdersListQuery): Filter<Record<string, unknown>> {
  const parts: Filter<Record<string, unknown>>[] = []

  const t = query.q.trim()
  if (t) {
    const esc = escapeRegex(t)
    const searchOr: Filter<Record<string, unknown>>[] = [
      { id: { $regex: esc, $options: 'i' } },
      { customerName: { $regex: esc, $options: 'i' } },
      { customerPhone: { $regex: esc, $options: 'i' } },
      { cashier: { $regex: esc, $options: 'i' } },
      { waiter: { $regex: esc, $options: 'i' } },
      { glovoOrderNumber: { $regex: esc, $options: 'i' } },
      { mpesaReceiptNumber: { $regex: esc, $options: 'i' } },
      { 'linkedPayments.receiptNumber': { $regex: esc, $options: 'i' } },
      { 'items.name': { $regex: esc, $options: 'i' } },
    ]

    const tableNum = parseTableSearchToken(t)
    if (tableNum != null) {
      // Table may be stored as number or string depending on source (POS vs menu).
      searchOr.push({ table: tableNum })
      searchOr.push({ table: String(tableNum) })
      searchOr.push({ table: { $regex: new RegExp(`^(?:table\\s*)?${tableNum}$`, 'i') } })
    }

    for (const variant of phoneSearchVariants(t)) {
      const vEsc = escapeRegex(variant)
      searchOr.push({ customerPhone: { $regex: vEsc, $options: 'i' } })
    }

    parts.push({ $or: searchOr })
  }

  if (query.lifecycle === 'cancelled') {
    parts.push({ status: { $in: ['cancelled', 'voided'] } })
  }

  if (query.paymentMethod !== 'all') {
    parts.push({
      paymentMethod: { $regex: new RegExp(`^${escapeRegex(query.paymentMethod)}$`, 'i') },
    })
  }

  if (query.paymentStatus !== 'all') {
    if (query.paymentStatus === 'PARTIALLY_PAID') {
      parts.push({ paymentStatus: 'PARTIALLY_PAID' })
    } else if (query.paymentStatus === 'PAID') {
      parts.push({
        $or: [
          { paymentStatus: { $in: ['PAID', 'COMPLETED', 'OVERPAID'] } },
          {
            $and: [{ status: 'completed' }, { paymentStatus: { $ne: 'PARTIALLY_PAID' } }],
          },
        ],
      })
    } else if (query.paymentStatus === 'NOT_PAID') {
      parts.push({
        $nor: [
          { paymentStatus: 'PARTIALLY_PAID' },
          { paymentStatus: 'PAID' },
          { paymentStatus: 'OVERPAID' },
          { paymentStatus: 'COMPLETED' },
          { status: 'completed' },
        ],
      })
    }
  }

  const source = query.orderSource || 'all'
  if (source === 'menu') {
    parts.push(menuOrdersSourceMatch())
  } else if (source === 'online') {
    parts.push(onlineOrdersSourceMatch())
  } else if (source === 'pos') {
    parts.push(posOrdersSourceMatch())
  }

  if (parts.length === 0) return {}
  if (parts.length === 1) return parts[0]!
  return { $and: parts }
}
