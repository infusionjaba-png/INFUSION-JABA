/**
 * Format money amount in Kenyan Shillings
 */
export function formatMoneyKsh(amount: number | string | null | undefined): string {
  if (amount == null || amount === "") return "—"
  const n = typeof amount === "number" ? amount : Number(amount)
  if (!Number.isFinite(n)) return "—"
  return `KSh ${n.toFixed(2)}`
}

/**
 * Format time from date
 */
export function formatTime(date: Date | string | null | undefined): string {
  if (!date) return "—"
  const d = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" })
}

/**
 * Get payment status label: paid | partially paid | not paid | overpaid
 */
export function getStatusLabel(
  status: string | null | undefined
): "PAID" | "PARTIALLY_PAID" | "NOT_PAID" | "OVERPAID" {
  if (status == null || status === "") return "NOT_PAID"
  const s = String(status).toUpperCase()
  if (s === "OVERPAID") return "OVERPAID"
  if (s === "PAID" || s === "COMPLETED") return "PAID"
  if (s === "PARTIALLY_PAID" || s === "PARTIAL") return "PARTIALLY_PAID"
  if (s === "NOT_PAID" || s === "FAILED") return "NOT_PAID"
  // PENDING = not paid
  return "NOT_PAID"
}

/**
 * Get user initials from name or email
 */
export function getUserInitials(name?: string | null, email?: string | null): string {
  if (name) {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2)
  }
  if (email) {
    return email[0].toUpperCase()
  }
  return "U"
}
