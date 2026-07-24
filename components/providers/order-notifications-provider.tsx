"use client"

import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from "react"
import { useSession } from "next-auth/react"
import { usePathname } from "next/navigation"
import { Order, CartItem } from "@/types/menu"
import {
  OrderNotification,
  OrderNotificationStack,
  OrderNotificationStackItem,
} from "@/components/orders/order-notification"
import { WaiterCallNotification } from "@/components/orders/waiter-call-notification"
import type { WaiterCall } from "@/lib/waiter-call"

// ─── Acknowledgement helpers ──────────────────────────────────────────────────
const ACK_KEY = "catha_notified_orders"
const WAITER_CHIME_KEY = "catha_chimed_waiter_calls"
const NOTIFY_WINDOW_MS = 10 * 60 * 1000 // orders sent in last 10 min
const MAX_VISIBLE = 3

function loadAcked(key = ACK_KEY): Set<string> {
  if (typeof window === "undefined") return new Set()
  try {
    const stored = localStorage.getItem(key)
    if (stored) return new Set(JSON.parse(stored) as string[])
  } catch {}
  return new Set()
}

function saveAcked(set: Set<string>, key = ACK_KEY) {
  if (typeof window === "undefined") return
  try {
    const arr = [...set].slice(-200)
    localStorage.setItem(key, JSON.stringify(arr))
  } catch {}
}

/** Normalize API line items so unitPrice is always finite when possible. */
function normalizePopupItems(
  items: unknown,
  menuPriceById: Record<string, number>
): CartItem[] {
  if (!Array.isArray(items)) return []
  return items.map((it: any, idx: number) => {
    const id = String(it?.productId ?? it?.id ?? it?.skuId ?? "")
    let unitPrice = Number(it?.unitPrice ?? it?.price)
    if (!Number.isFinite(unitPrice) && id && Number.isFinite(menuPriceById[id])) {
      console.warn(
        `[order-notifications] Missing unit price for "${id}"; using menu price`
      )
      unitPrice = menuPriceById[id]
    }
    if (!Number.isFinite(unitPrice)) {
      console.warn(
        `[order-notifications] Missing unit price for line`,
        id || it?.name
      )
      unitPrice = NaN
    }
    return {
      id: id || `line-${idx}`,
      name: String(it?.name || ""),
      quantity: Number(it?.quantity) || 0,
      unitPrice,
      image: typeof it?.image === "string" ? it.image : "",
    }
  })
}

function normalizePopupOrder(
  o: any,
  menuPriceById: Record<string, number>
): Order {
  const items = normalizePopupItems(o.items, menuPriceById)
  const computed = items.reduce((sum, it) => {
    const line = it.quantity * it.unitPrice
    return sum + (Number.isFinite(line) ? line : 0)
  }, 0)
  const total = Number(o.total)
  const createdRaw = o.createdAt ?? o.lastSentAt ?? Date.now()
  const createdAt =
    typeof createdRaw === "number"
      ? createdRaw
      : new Date(createdRaw).getTime() || Date.now()
  return {
    ...o,
    items,
    total: Number.isFinite(total) ? total : computed,
    tableId: String(o.tableId ?? o.tableNumber ?? ""),
    tableNumber: o.tableNumber != null ? String(o.tableNumber) : undefined,
    createdAt,
  } as Order
}

// ─── Context ──────────────────────────────────────────────────────────────────
interface OrderNotificationsContextType {
  soundEnabled: boolean
  setSoundEnabled: (enabled: boolean) => void
  soundUnlocked: boolean
  unlockSound: () => void
}

const OrderNotificationsContext = createContext<OrderNotificationsContextType | undefined>(undefined)

export function useOrderNotifications() {
  return useContext(OrderNotificationsContext)
}

const SOUND_UNLOCK_KEY = "catha_notify_sound_unlocked"

function loadSoundUnlocked(): boolean {
  if (typeof window === "undefined") return false
  try {
    return sessionStorage.getItem(SOUND_UNLOCK_KEY) === "1"
  } catch {
    return false
  }
}

function saveSoundUnlocked() {
  if (typeof window === "undefined") return
  try {
    sessionStorage.setItem(SOUND_UNLOCK_KEY, "1")
  } catch {}
}

function playTonePair(
  freqs: [number, number],
  peaks: [number, number],
  gap = 0.14
) {
  if (typeof window === "undefined") return
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext
    const ctx = new Ctx()
    const now = ctx.currentTime

    const tone = (freq: number, start: number, dur: number, peak: number) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = "sine"
      osc.frequency.value = freq
      osc.connect(gain)
      gain.connect(ctx.destination)
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(peak, start + 0.03)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + dur)
      osc.start(start)
      osc.stop(start + dur + 0.02)
    }

    tone(freqs[0], now, 0.22, peaks[0])
    tone(freqs[1], now + gap, 0.28, peaks[1])
    setTimeout(() => ctx.close().catch(() => {}), 800)
  } catch {}
}

/** Soft two-tone chime for new orders (not a harsh beep). */
function playSoftChime() {
  playTonePair([523.25, 659.25], [0.12, 0.1]) // C5 → E5
}

/** Softer, lower chime for waiter calls — distinct from new-order sound. */
function playWaiterChime() {
  playTonePair([392.0, 493.88], [0.07, 0.055], 0.18) // G4 → B4, quieter
}

// ─── Provider ─────────────────────────────────────────────────────────────────
export function OrderNotificationsProvider({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession()
  const pathname = usePathname()
  const [newOrderPopups, setNewOrderPopups] = useState<Order[]>([])
  const [waiterCallPopups, setWaiterCallPopups] = useState<WaiterCall[]>([])
  const [soundEnabled, setSoundEnabled] = useState(true)
  const [soundUnlocked, setSoundUnlocked] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [menuPriceById, setMenuPriceById] = useState<Record<string, number>>({})

  const isAuthenticated = status === "authenticated" && !!session?.user
  const isMenuPage = pathname?.startsWith("/menu")
  const isJabaPage = pathname?.startsWith("/jaba")
  const shouldShowNotifications = isAuthenticated && !isMenuPage && !isJabaPage

  const ackedRef = useRef<Set<string>>(new Set())
  /** Session-only: dismissed without "On it" — don't re-popup every 3s */
  const waiterDismissedRef = useRef<Set<string>>(new Set())
  /** Persist chime IDs so refresh doesn't re-ding the same call */
  const waiterChimedRef = useRef<Set<string>>(new Set())
  const initializedRef = useRef(false)
  const waiterInitializedRef = useRef(false)
  const menuPricesRef = useRef<Record<string, number>>({})

  useEffect(() => {
    setSoundUnlocked(loadSoundUnlocked())
  }, [])

  const unlockSound = useCallback(() => {
    saveSoundUnlocked()
    setSoundUnlocked(true)
    setSoundEnabled(true)
    // User gesture unlocks autoplay — play the softer waiter chime as confirmation
    playWaiterChime()
  }, [])

  const playSound = useCallback(() => {
    if (!soundEnabled || !soundUnlocked) return
    playSoftChime()
  }, [soundEnabled, soundUnlocked])

  const playWaiterSound = useCallback(() => {
    if (!soundEnabled || !soundUnlocked) return
    playWaiterChime()
  }, [soundEnabled, soundUnlocked])

  // Warm a product-id → menu price map for NaN fallback
  useEffect(() => {
    if (!shouldShowNotifications) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch("/api/catha/inventory?visibleOnly=true", {
          cache: "no-store",
        })
        if (!res.ok || cancelled) return
        const data = await res.json()
        const list = Array.isArray(data?.products)
          ? data.products
          : Array.isArray(data)
            ? data
            : data?.items || []
        const map: Record<string, number> = {}
        for (const p of list) {
          const id = String(p?.id ?? p?._id ?? "")
          const price = Number(p?.price ?? p?.sellingPrice)
          if (id && Number.isFinite(price)) map[id] = price
        }
        if (!cancelled) {
          menuPricesRef.current = map
          setMenuPriceById(map)
        }
      } catch {}
    })()
    return () => {
      cancelled = true
    }
  }, [shouldShowNotifications])

  const acceptOrder = useCallback(async (orderId: string) => {
    const serverName = (session?.user as any)?.name ?? "Server"
    try {
      // Accept = claim only (Preparing). Served is a separate staff action.
      await fetch("/api/catha/menu-orders", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, receivedBy: serverName }),
      })
      await fetch("/api/catha/orders", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: orderId, waiter: serverName }),
      })
    } catch {}
  }, [session?.user])

  const handleDismissPopup = useCallback((orderId: string) => {
    setNewOrderPopups((prev) => prev.filter((o) => o.orderId !== orderId))
  }, [])

  const handleDismissWaiterCall = useCallback((callId: string) => {
    waiterDismissedRef.current.add(callId)
    setWaiterCallPopups((prev) => prev.filter((c) => c.callId !== callId))
  }, [])

  /** Accept only — card animates out itself via onDismiss. */
  const handleAcceptOrder = useCallback(async (orderId: string) => {
    await acceptOrder(orderId)
  }, [acceptOrder])

  const handleAcknowledgeWaiterCall = useCallback(async (callId: string) => {
    try {
      await fetch("/api/catha/waiter-calls", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callId, status: "acknowledged" }),
      })
    } catch {}
  }, [])

  const handleViewOrder = useCallback((orderId: string) => {
    if (typeof window !== "undefined") {
      window.location.href = `/catha/orders#menu-order-${orderId}`
    }
    handleDismissPopup(orderId)
  }, [handleDismissPopup])

  useEffect(() => {
    if (!shouldShowNotifications) return

    if (!initializedRef.current) {
      ackedRef.current = loadAcked()
      initializedRef.current = true
    }

    const poll = async () => {
      try {
        const res = await fetch("/api/catha/menu-orders", { cache: "no-store" })
        if (!res.ok) return
        const orders: any[] = await res.json()

        const now = Date.now()
        const newOrders: Order[] = []

        for (const o of orders) {
          if (o.status !== "sent" && o.status !== "paid" && o.status !== "active") continue

          const sentAt =
            typeof o.lastSentAt === "number"
              ? o.lastSentAt
              : o.lastSentAt
                ? new Date(o.lastSentAt).getTime()
                : null

          if (!sentAt || now - sentAt > NOTIFY_WINDOW_MS) continue
          if (ackedRef.current.has(o.orderId)) continue

          ackedRef.current.add(o.orderId)

          if (o.status === "sent" || o.status === "paid") {
            newOrders.push(normalizePopupOrder(o, menuPricesRef.current))
          }
        }

        if (newOrders.length > 0) {
          saveAcked(ackedRef.current)
          setNewOrderPopups((prev) => {
            const existingIds = new Set(prev.map((x) => x.orderId))
            const toAdd = newOrders.filter((o) => !existingIds.has(o.orderId))
            // Newest on top
            return toAdd.length > 0 ? [...toAdd.reverse(), ...prev] : prev
          })
          playSound()
        }
      } catch {}
    }

    poll()
    const interval = setInterval(poll, 3000)
    return () => clearInterval(interval)
  }, [shouldShowNotifications, playSound])

  // Poll waiter calls (distinct softer chime)
  useEffect(() => {
    if (!shouldShowNotifications) return

    if (!waiterInitializedRef.current) {
      waiterChimedRef.current = loadAcked(WAITER_CHIME_KEY)
      // Migrate / clear old suppress-forever key so pending calls can surface again
      try {
        localStorage.removeItem("catha_notified_waiter_calls")
      } catch {}
      waiterInitializedRef.current = true
    }

    const poll = async () => {
      try {
        const res = await fetch("/api/catha/waiter-calls?status=pending", {
          cache: "no-store",
        })
        if (!res.ok) {
          if (process.env.NODE_ENV === "development") {
            console.warn(
              `[waiter-calls] poll failed: ${res.status}`,
              await res.text().catch(() => "")
            )
          }
          return
        }
        const calls: WaiterCall[] = await res.json()
        if (!Array.isArray(calls)) return

        const pending = calls.filter((c) => {
          const id = c.callId || c.id
          if (!id) return false
          if (c.status !== "pending") return false
          if (waiterDismissedRef.current.has(id)) return false
          return true
        })

        const pendingIds = new Set(pending.map((c) => c.callId || c.id))
        const toChime: WaiterCall[] = []
        for (const call of pending) {
          const id = call.callId || call.id
          if (!id || waiterChimedRef.current.has(id)) continue
          waiterChimedRef.current.add(id)
          toChime.push(call)
        }

        if (toChime.length > 0) {
          saveAcked(waiterChimedRef.current, WAITER_CHIME_KEY)
          playWaiterSound()
        }

        setWaiterCallPopups((prev) => {
          const byId = new Map(prev.map((c) => [c.callId, c]))
          for (const call of pending) {
            const id = call.callId || call.id
            if (!id) continue
            if (!byId.has(id)) byId.set(id, { ...call, callId: id })
          }
          // Drop anything no longer pending on the server
          for (const id of [...byId.keys()]) {
            if (!pendingIds.has(id)) byId.delete(id)
          }
          const next = [...byId.values()].sort((a, b) => b.createdAt - a.createdAt)
          if (
            next.length === prev.length &&
            next.every((c, i) => c.callId === prev[i]?.callId)
          ) {
            return prev
          }
          return next
        })
      } catch (err) {
        if (process.env.NODE_ENV === "development") {
          console.warn("[waiter-calls] poll error", err)
        }
      }
    }

    poll()
    const interval = setInterval(poll, 3000)
    return () => clearInterval(interval)
  }, [shouldShowNotifications, playWaiterSound])

  const combinedCount = newOrderPopups.length + waiterCallPopups.length
  // Prefer waiter calls (urgent) in the visible stack, then fill with orders
  const waiterVisible = showAll
    ? waiterCallPopups
    : waiterCallPopups.slice(0, MAX_VISIBLE)
  const visibleOrderSlots = showAll
    ? newOrderPopups.length
    : Math.max(0, MAX_VISIBLE - waiterVisible.length)
  const ordersToShow = showAll
    ? newOrderPopups
    : newOrderPopups.slice(0, visibleOrderSlots)
  const overflowCount = showAll
    ? 0
    : Math.max(0, combinedCount - MAX_VISIBLE)

  return (
    <OrderNotificationsContext.Provider
      value={{ soundEnabled, setSoundEnabled, soundUnlocked, unlockSound }}
    >
      {children}
      {shouldShowNotifications && combinedCount > 0 && (
        <OrderNotificationStack
          overflowCount={overflowCount}
          onExpandOverflow={() => setShowAll(true)}
        >
          {waiterVisible.map((call, index) => (
            <OrderNotificationStackItem key={`wc-${call.callId}`}>
              <WaiterCallNotification
                call={call}
                onDismiss={() => handleDismissWaiterCall(call.callId)}
                onAcknowledge={() => handleAcknowledgeWaiterCall(call.callId)}
                showEnableSound={!soundUnlocked && index === 0}
                onEnableSound={unlockSound}
              />
            </OrderNotificationStackItem>
          ))}
          {ordersToShow.map((order) => (
            <OrderNotificationStackItem key={order.orderId}>
              <OrderNotification
                order={order}
                menuPriceById={menuPriceById}
                onDismiss={() => handleDismissPopup(order.orderId)}
                onView={() => handleViewOrder(order.orderId)}
                onAccept={() => handleAcceptOrder(order.orderId)}
              />
            </OrderNotificationStackItem>
          ))}
        </OrderNotificationStack>
      )}
    </OrderNotificationsContext.Provider>
  )
}
