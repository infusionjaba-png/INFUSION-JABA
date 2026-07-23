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

// ─── Acknowledgement helpers ──────────────────────────────────────────────────
const ACK_KEY = "catha_notified_orders"
const NOTIFY_WINDOW_MS = 10 * 60 * 1000 // orders sent in last 10 min
const MAX_VISIBLE = 3

function loadAcked(): Set<string> {
  if (typeof window === "undefined") return new Set()
  try {
    const stored = localStorage.getItem(ACK_KEY)
    if (stored) return new Set(JSON.parse(stored) as string[])
  } catch {}
  return new Set()
}

function saveAcked(set: Set<string>) {
  if (typeof window === "undefined") return
  try {
    const arr = [...set].slice(-200)
    localStorage.setItem(ACK_KEY, JSON.stringify(arr))
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
}

const OrderNotificationsContext = createContext<OrderNotificationsContextType | undefined>(undefined)

export function useOrderNotifications() {
  return useContext(OrderNotificationsContext)
}

/** Soft two-tone chime (not a harsh beep). */
function playSoftChime() {
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

    tone(523.25, now, 0.22, 0.12) // C5
    tone(659.25, now + 0.14, 0.28, 0.1) // E5
    setTimeout(() => ctx.close().catch(() => {}), 800)
  } catch {}
}

// ─── Provider ─────────────────────────────────────────────────────────────────
export function OrderNotificationsProvider({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession()
  const pathname = usePathname()
  const [newOrderPopups, setNewOrderPopups] = useState<Order[]>([])
  const [soundEnabled, setSoundEnabled] = useState(true)
  const [showAll, setShowAll] = useState(false)
  const [menuPriceById, setMenuPriceById] = useState<Record<string, number>>({})

  const isAuthenticated = status === "authenticated" && !!session?.user
  const isMenuPage = pathname?.startsWith("/menu")
  const isJabaPage = pathname?.startsWith("/jaba")
  const shouldShowNotifications = isAuthenticated && !isMenuPage && !isJabaPage

  const ackedRef = useRef<Set<string>>(new Set())
  const initializedRef = useRef(false)
  const menuPricesRef = useRef<Record<string, number>>({})

  const playSound = useCallback(() => {
    if (!soundEnabled) return
    playSoftChime()
  }, [soundEnabled])

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
      await fetch("/api/catha/menu-orders", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, status: "active", receivedBy: serverName }),
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

  /** Accept only — card animates out itself via onDismiss. */
  const handleAcceptOrder = useCallback(async (orderId: string) => {
    await acceptOrder(orderId)
  }, [acceptOrder])

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

  const visible = showAll
    ? newOrderPopups
    : newOrderPopups.slice(0, MAX_VISIBLE)
  const overflowCount = showAll
    ? 0
    : Math.max(0, newOrderPopups.length - MAX_VISIBLE)

  return (
    <OrderNotificationsContext.Provider value={{ soundEnabled, setSoundEnabled }}>
      {children}
      {shouldShowNotifications && newOrderPopups.length > 0 && (
        <OrderNotificationStack
          overflowCount={overflowCount}
          onExpandOverflow={() => setShowAll(true)}
        >
          {visible.map((order) => (
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
