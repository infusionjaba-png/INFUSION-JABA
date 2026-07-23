/** Shared types + helpers for the Call Waiter flow */

export const WAITER_CALL_REASONS = [
  {
    id: "bill",
    label: "Bring the bill",
    confirmedLabel: "Bringing the bill",
  },
  {
    id: "drinks",
    label: "More drinks",
    confirmedLabel: "More drinks",
  },
  {
    id: "issue",
    label: "Order issue",
    confirmedLabel: "Order issue",
  },
  {
    id: "other",
    label: "Something else",
    confirmedLabel: "Something else",
  },
] as const

export type WaiterCallReasonId = (typeof WAITER_CALL_REASONS)[number]["id"]

export type WaiterCallStatus = "pending" | "acknowledged" | "cancelled"

export interface WaiterCall {
  id: string
  callId: string
  tableNumber: string
  tableId: string
  reason: WaiterCallReasonId
  reasonLabel: string
  confirmedLabel: string
  customerPhone?: string | null
  orderId?: string | null
  status: WaiterCallStatus
  createdAt: number
  acknowledgedAt?: number | null
  cancelledAt?: number | null
}

export const WAITER_CALL_COOLDOWN_MS = 3 * 60 * 1000
export const WAITER_CALL_SHEET_AUTO_DISMISS_MS = 4_000
const COOLDOWN_STORAGE_KEY = "menu_waiter_call_cooldown"
export const WAITER_CALL_COOLDOWN_EVENT = "menu:waiter-call-cooldown"

export function reasonMeta(id: WaiterCallReasonId) {
  return WAITER_CALL_REASONS.find((r) => r.id === id) ?? WAITER_CALL_REASONS[0]
}

export function formatCallTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    })
  } catch {
    return ""
  }
}

export function formatCountdown(remainingMs: number): string {
  const totalSec = Math.max(0, Math.ceil(remainingMs / 1000))
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${String(s).padStart(2, "0")}`
}

function readCooldownMap(): Record<string, number> {
  if (typeof window === "undefined") return {}
  try {
    const raw = sessionStorage.getItem(COOLDOWN_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, number>
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch {
    return {}
  }
}

function writeCooldownMap(map: Record<string, number>) {
  if (typeof window === "undefined") return
  try {
    sessionStorage.setItem(COOLDOWN_STORAGE_KEY, JSON.stringify(map))
  } catch {}
  window.dispatchEvent(new CustomEvent(WAITER_CALL_COOLDOWN_EVENT))
}

export function getCooldownUntil(tableKey: string): number | null {
  if (!tableKey) return null
  const until = readCooldownMap()[tableKey]
  if (!until || until <= Date.now()) return null
  return until
}

export function startCooldown(tableKey: string, durationMs = WAITER_CALL_COOLDOWN_MS): number {
  const until = Date.now() + durationMs
  const map = readCooldownMap()
  map[tableKey] = until
  writeCooldownMap(map)
  return until
}

export function clearCooldown(tableKey: string) {
  const map = readCooldownMap()
  if (!(tableKey in map)) return
  delete map[tableKey]
  writeCooldownMap(map)
}

export function tableDisplay(table: string | number | null | undefined): string {
  const n = String(table ?? "")
    .replace(/^table\s*/i, "")
    .trim()
  return n || "—"
}
