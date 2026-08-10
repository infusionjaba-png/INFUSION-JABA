/**
 * Short Catha order IDs — easy to say, type, and match on receipts / M-Pesa.
 *
 * Menu:  M482917
 * POS:   P482917
 *
 * Format: letter + last 5 digits of timestamp + 1 random digit (7 chars).
 */
export type CathaOrderIdSource = "menu" | "pos"

export function createCathaOrderId(source: CathaOrderIdSource): string {
  const prefix = source === "menu" ? "M" : "P"
  const timePart = Date.now().toString().slice(-5)
  const rand = String(Math.floor(Math.random() * 10))
  return `${prefix}${timePart}${rand}`
}

/** True for new short IDs (and still accept legacy TXN… / base36 ids). */
export function isShortCathaOrderId(id: string): boolean {
  return /^[MP]\d{6}$/i.test(String(id || "").trim())
}
