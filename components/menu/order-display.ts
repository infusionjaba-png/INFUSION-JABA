import { Order } from "@/types/menu"

/** Short display like #M482917 (new) or #0042 (legacy) */
export function formatOrderLabel(order: Order): string {
  const id = String(order.orderId || "").trim()
  if (/^[MP]\d{6}$/i.test(id)) {
    return `#${id.toUpperCase()}`
  }
  const digits = id.replace(/\D/g, "")
  const slice = (digits || id).slice(-4).padStart(4, "0")
  return `#${slice}`
}

export function formatOrderTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).toLowerCase()
}

/** Chronological round index (oldest unpaid/sent = Round 1). */
export function roundNumberForOrder(order: Order, allOrders: Order[]): number {
  const chrono = [...allOrders].sort(
    (a, b) =>
      (a.lastSentAt ?? a.createdAt) - (b.lastSentAt ?? b.createdAt)
  )
  const idx = chrono.findIndex((o) => o.orderId === order.orderId)
  return idx >= 0 ? idx + 1 : 1
}

/** e.g. "Round 1 · 3:16 pm" */
export function formatRoundLabel(order: Order, round: number): string {
  const sentAt = order.lastSentAt ?? order.createdAt
  return `Round ${round} · ${formatOrderTime(sentAt)}`
}

export function tabTotal(orders: Order[]): number {
  return orders.reduce((sum, o) => sum + orderTotal(o), 0)
}

export function orderItemCount(order: Order): number {
  return order.items.reduce((s, i) => s + i.quantity, 0)
}

export function orderTotal(order: Order): number {
  if (typeof order.total === "number" && order.total > 0) return order.total
  return order.items.reduce((s, i) => s + i.unitPrice * i.quantity, 0)
}

export function itemsSummary(order: Order): string {
  return order.items.map((i) => `${i.quantity}× ${i.name}`).join(" · ")
}

/** Tracker step index: 0 Sent, 1 Preparing, 2 Served, 3 Paid */
export function trackerStep(order: Order): number {
  if (order.paymentStatus === "PAID" || order.status === "paid") return 3
  // Served only after explicit staff Serve (menu_orders.servedAt). Bare "active" was old Accept.
  if (order.status === "active" && order.servedAt) return 2
  if (order.status === "active") return 1
  if (order.status === "sent") return 1
  return 0
}

export function statusPillLabel(order: Order): string {
  const step = trackerStep(order)
  return ["Sent", "Preparing", "Served", "Paid"][step] ?? "Sent"
}

export type DayGroup = { key: string; label: string; orders: Order[] }

export function groupOrdersByDay(orders: Order[]): DayGroup[] {
  const sorted = [...orders].sort((a, b) => b.createdAt - a.createdAt)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  const map = new Map<string, DayGroup>()

  for (const order of sorted) {
    const d = new Date(order.createdAt)
    d.setHours(0, 0, 0, 0)
    let key: string
    let label: string
    if (d.getTime() === today.getTime()) {
      key = "today"
      label = "TODAY"
    } else if (d.getTime() === yesterday.getTime()) {
      key = "yesterday"
      label = "YESTERDAY"
    } else {
      key = d.toISOString().slice(0, 10)
      label = d
        .toLocaleDateString("en-GB", { day: "numeric", month: "short" })
        .toUpperCase()
    }
    const group = map.get(key) ?? { key, label, orders: [] }
    group.orders.push(order)
    map.set(key, group)
  }

  return Array.from(map.values())
}

export function relativeDayLabel(ts: number): string {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  if (d.getTime() === today.getTime()) return "Today"
  if (d.getTime() === yesterday.getTime()) return "Yesterday"
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })
}

export function maskPhone(phone?: string | null): string {
  if (!phone) return "····"
  const digits = phone.replace(/\D/g, "")
  if (digits.length < 4) return "····"
  return `····${digits.slice(-4)}`
}
