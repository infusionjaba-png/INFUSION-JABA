"use client"

import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
  Suspense,
  useRef,
} from "react"
import { useSearchParams } from "next/navigation"
import { Search, History, QrCode, X, TableIcon, ClipboardList, SlidersHorizontal } from "lucide-react"
import { ProductCard } from "@/components/menu/product-card"
import { CartDrawer } from "@/components/menu/cart-drawer"
import { CategoryTabs } from "@/components/menu/category-tabs"
import { PopularRow } from "@/components/menu/PopularRow"
import { ProductSheet } from "@/components/menu/ProductSheet"
import { StickyCartBar } from "@/components/menu/StickyCartBar"
import { PaymentModal } from "@/components/menu/payment-modal"
import { OrderTracking } from "@/components/menu/order-tracking"
import { OrderHistoryDrawer } from "@/components/menu/order-history-drawer"
import { ActiveOrdersDrawer } from "@/components/menu/active-orders-drawer"
import { CallWaiterSheet } from "@/components/menu/call-waiter-sheet"
import { CustomerNumberModal } from "@/components/menu/customer-number-modal"
import { formatOrderLabel } from "@/components/menu/order-display"
import { enrichMenuItem, findServingSiblings } from "@/components/menu/product-meta"
import { orderStore } from "@/lib/orderStore"
import { MenuItem, CartItem, Order, MenuCategory } from "@/types/menu"
import { useDebounce } from "@/hooks/use-debounce"
import { useWaiterCallCooldown } from "@/hooks/use-waiter-call-cooldown"
import { cn } from "@/lib/utils"
import { normalizeKenyaPhone } from "@/lib/phone-utils"
import styles from "./menu.module.css"

function pouringHeadline(): string {
  if (typeof window === "undefined") return "What are we pouring tonight?"
  const hour = new Date().getHours()
  return hour >= 18 ? "Good evening at Infusion Jaba" : "What are we pouring tonight?"
}

const GUEST_SESSION_KEY = "menu_guest_session"
const MENU_TABLE_KEY = "menu_table"

function getOrCreateGuestSessionId(): string {
  if (typeof window === "undefined") return ""
  let id = sessionStorage.getItem(GUEST_SESSION_KEY)
  if (!id) {
    id = `g-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    sessionStorage.setItem(GUEST_SESSION_KEY, id)
  }
  return id
}

function MenuContent() {
  const searchParams = useSearchParams()
  const tableFromQuery = searchParams.get("t") || searchParams.get("table")
  const tableRef = useRef<string | null>(null)

  const [tableNumber, setTableNumber] = useState<string>("")
  const [manualTableInput, setManualTableInput] = useState("")
  const [manualTableError, setManualTableError] = useState("")
  const [customerNumber, setCustomerNumber] = useState<string | null>(null)
  const [guestSessionId, setGuestSessionId] = useState<string | null>(null)
  const [customerNumberResolved, setCustomerNumberResolved] = useState(false)
  const [showCustomerModal, setShowCustomerModal] = useState(false)
  const [selectedCategory, setSelectedCategory] = useState<string>("all")
  const [searchQuery, setSearchQuery] = useState("")
  const [searchFocused, setSearchFocused] = useState(false)
  const [headerScrolled, setHeaderScrolled] = useState(false)
  const [headline, setHeadline] = useState("What are we pouring tonight?")
  const [cart, setCart] = useState<CartItem[]>([])
  const [cartOpen, setCartOpen] = useState(false)
  const [productSheetOpen, setProductSheetOpen] = useState(false)
  const [selectedItem, setSelectedItem] = useState<MenuItem | null>(null)
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [placedOrderId, setPlacedOrderId] = useState<string | null>(null)
  const [showOrderTracking, setShowOrderTracking] = useState(false)
  const [activeOrder, setActiveOrder] = useState<Order | null>(null)
  const [activeOrdersOpen, setActiveOrdersOpen] = useState(false)
  const [callWaiterOpen, setCallWaiterOpen] = useState(false)
  const [callWaiterOrderId, setCallWaiterOrderId] = useState<string | null>(null)
  const [orderSentConfirm, setOrderSentConfirm] = useState<{
    orderLabel: string
    tableNumber: string
  } | null>(null)
  const [sendingOrder, setSendingOrder] = useState(false)
  const [menuItems, setMenuItems] = useState<MenuItem[]>([])
  const [menuCategories, setMenuCategories] = useState<MenuCategory[]>([])
  const [menuLoading, setMenuLoading] = useState(true)
  const jabaSectionRef = useRef<HTMLDivElement>(null)
  const allDrinksRef = useRef<HTMLDivElement>(null)
  /** Local cart is source of truth while ordering — only hydrate once from draft. */
  const cartHydratedRef = useRef(false)
  const cartSyncGenRef = useRef(0)
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingSyncItemsRef = useRef<CartItem[] | null>(null)

  const debouncedSearch = useDebounce(searchQuery, 150)
  const waiterCooldown = useWaiterCallCooldown(tableNumber || null)

  const hasJaba = menuItems.some((i) => i.isJaba)

  useEffect(() => {
    setHeadline(pouringHeadline())
  }, [])

  useEffect(() => {
    const onScroll = () => setHeaderScrolled(window.scrollY > 48)
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  const categoryCounts = useMemo(() => {
    const map: Record<string, number> = {}
    for (const item of menuItems) {
      const key = item.category || "other"
      map[key] = (map[key] || 0) + 1
    }
    return map
  }, [menuItems])

  useEffect(() => {
    document.title = "Menu | Catha Lounge"
  }, [])

  const handleJabaClick = () => {
    setSelectedCategory("all")
    setSearchQuery("")
    setTimeout(() => {
      jabaSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    }, 50)
  }

  // Fetch real products from inventory
  useEffect(() => {
    fetch("/api/catha/inventory?visibleOnly=true")
      .then((r) => r.json())
      .then((data) => {
        if (!data.products) return
        const items: MenuItem[] = data.products.map((p: any) =>
          enrichMenuItem({
            id: p.id,
            name: p.name,
            price: Number(p.price) || 0,
            image: p.image,
            category: p.category,
            stock: p.stock,
            size: p.size,
            unit: p.unit,
            isJaba: p.isJaba === true,
            brand: p.brand,
          })
        )

        const seenCats = new Set<string>()
        const cats: MenuCategory[] = []
        data.products.forEach((p: any) => {
          const catId = p.category?.toLowerCase().replace(/\s+/g, "-") || "other"
          const catName = p.category ? p.category.charAt(0).toUpperCase() + p.category.slice(1) : "Other"
          if (!seenCats.has(catId)) {
            seenCats.add(catId)
            cats.push({ id: catId, name: catName })
          }
        })

        setMenuItems(items)
        setMenuCategories(cats)
      })
      .catch(console.error)
      .finally(() => setMenuLoading(false))
  }, [])

  // Parse table from URL
  useEffect(() => {
    if (tableFromQuery) {
      const t = String(tableFromQuery).trim()
      setTableNumber(t)
      tableRef.current = t
      if (typeof window !== "undefined") {
        sessionStorage.setItem(MENU_TABLE_KEY, t)
      }
    } else if (typeof window !== "undefined") {
      const stored = sessionStorage.getItem(MENU_TABLE_KEY)
      if (stored) {
        setTableNumber(stored)
        tableRef.current = stored
      }
    }
  }, [tableFromQuery])

  // Restore phone from session
  useEffect(() => {
    if (typeof window === "undefined") return
    const cust = sessionStorage.getItem("menu_customer_number")
    if (cust) {
      setCustomerNumber(cust)
      setGuestSessionId(null)
      setCustomerNumberResolved(true)
    }
  }, [])

  // Auto-show phone modal as soon as we have a table but no resolved customer yet
  useEffect(() => {
    if (tableNumber && !customerNumberResolved) {
      setShowCustomerModal(true)
    }
  }, [tableNumber, customerNumberResolved])

  // Track active unpaid order. Hydrate cart from draft ONCE — never overwrite
  // local cart on every store notify (that caused add/remove flicker).
  useEffect(() => {
    if (!tableNumber || !customerNumberResolved) return

    cartHydratedRef.current = false

    const refreshActiveOrder = () => {
      const cust = customerNumber ?? null
      const guest = customerNumber == null ? guestSessionId : null
      const order = orderStore.getActiveUnpaidOrder(tableNumber, cust, guest)
      setActiveOrder(order ?? null)

      if (!cartHydratedRef.current) {
        cartHydratedRef.current = true
        if (order?.status === "draft" && Array.isArray(order.items) && order.items.length > 0) {
          setCart(order.items)
        }
        return
      }

      // After hydrate: only react to terminal transitions (sent / paid / gone)
      if (!order) {
        // Unpaid order vanished (paid/cancelled). Don't clear mid-sync drafts.
        const stillDrafting = orderStore.getOrders().some(
          (o) =>
            o.status === "draft" &&
            (cust ? o.customerNumber === cust : o.guestSessionId === guest)
        )
        if (!stillDrafting && pendingSyncItemsRef.current == null) {
          setCart([])
        }
        return
      }

      if (order.status === "sent" || order.status === "active" || order.status === "paid") {
        setCart((prev) => {
          const orderItemIds = new Set(order.items.map((i) => i.id))
          const hasNewItems = prev.some((i) => !orderItemIds.has(i.id))
          return hasNewItems ? prev.filter((i) => !orderItemIds.has(i.id)) : []
        })
      }
    }

    refreshActiveOrder()
    const unsub = orderStore.subscribe(refreshActiveOrder)
    return () => {
      unsub()
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current)
    }
  }, [tableNumber, customerNumber, guestSessionId, customerNumberResolved])

  const handleCustomerContinue = useCallback((cust: string) => {
    setCustomerNumber(cust)
    setGuestSessionId(null)
    sessionStorage.setItem("menu_customer_number", cust)
    sessionStorage.removeItem("menu_is_guest")
    setCustomerNumberResolved(true)
    setShowCustomerModal(false)
  }, [])

  const filteredProducts = useMemo(() => {
    let filtered = menuItems
    if (selectedCategory !== "all") {
      filtered = filtered.filter((p) => p.category === selectedCategory)
    }
    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase()
      filtered = filtered.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q)
      )
    }
    return filtered
  }, [menuItems, selectedCategory, debouncedSearch])

  const subtotal = useMemo(
    () => cart.reduce((sum, i) => sum + (Number(i.unitPrice) || 0) * (Number(i.quantity) || 0), 0),
    [cart]
  )
  // Prices are VAT-inclusive in this app; do not add tax on top.
  const vat = 0
  const total = subtotal

  const flushCartSync = useCallback(
    async (items: CartItem[]) => {
      if (!tableNumber || !customerNumberResolved) return

      const gen = ++cartSyncGenRef.current
      const cust = customerNumber ?? null
      const guest = customerNumber == null ? guestSessionId : null
      const existing = orderStore.getActiveUnpaidOrder(tableNumber, cust, guest)

      // Never modify an order that's already been sent to / accepted by the bar.
      if (existing && (existing.status === "sent" || existing.status === "active")) {
        return
      }

      const newTotal = items.reduce(
        (s, i) => s + (Number(i.unitPrice) || 0) * (Number(i.quantity) || 0),
        0
      )

      try {
        if (existing) {
          if (items.length === 0) {
            // Empty draft — keep draft row but clear lines; don't fight UI
            await orderStore.updateOrder(existing.orderId, {
              items: [],
              total: 0,
            })
          } else {
            await orderStore.updateOrder(existing.orderId, {
              items,
              total: newTotal,
            })
          }
          if (gen !== cartSyncGenRef.current) return
          const latest = orderStore.getActiveUnpaidOrder(tableNumber, cust, guest)
          setActiveOrder(latest ?? null)
        } else if (items.length > 0) {
          const order = await orderStore.createOrder({
            tableId: tableNumber,
            tableNumber,
            customerNumber: cust,
            guestSessionId: guest,
            status: "draft",
            paymentStatus: "UNPAID",
            items,
            total: newTotal,
          })
          if (gen !== cartSyncGenRef.current) return
          setActiveOrder(order)
        }
      } finally {
        if (gen === cartSyncGenRef.current) {
          pendingSyncItemsRef.current = null
        }
      }
    },
    [tableNumber, customerNumber, guestSessionId, customerNumberResolved]
  )

  const syncCartToOrder = useCallback(
    (items: CartItem[]) => {
      pendingSyncItemsRef.current = items
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current)
      syncTimerRef.current = setTimeout(() => {
        const payload = pendingSyncItemsRef.current
        if (payload) void flushCartSync(payload)
      }, 280)
    },
    [flushCartSync]
  )

  const handleAddToCart = useCallback(
    (item: MenuItem) => {
      if (!tableNumber) return

      if (!customerNumberResolved) {
        setShowCustomerModal(true)
        return
      }

      setCart((prev) => {
        const existing = prev.find((i) => i.id === item.id)
        const next = existing
          ? prev.map((i) =>
              i.id === item.id ? { ...i, quantity: i.quantity + 1 } : i
            )
          : [
              ...prev,
              {
                id: item.id,
                name: item.name,
                quantity: 1,
                unitPrice: Number(item.price) || 0,
                image: item.image,
              },
            ]
        syncCartToOrder(next)
        return next
      })
    },
    [tableNumber, customerNumberResolved, syncCartToOrder]
  )

  const handleUpdateQuantity = useCallback(
    (id: string, quantity: number) => {
      setCart((prev) => {
        if (quantity <= 0) {
          const next = prev.filter((i) => i.id !== id)
          syncCartToOrder(next)
          return next
        }
        const next = prev.map((i) =>
          i.id === id ? { ...i, quantity } : i
        )
        syncCartToOrder(next)
        return next
      })
    },
    [syncCartToOrder]
  )

  const handleRemoveItem = useCallback(
    (id: string) => {
      setCart((prev) => {
        const next = prev.filter((i) => i.id !== id)
        syncCartToOrder(next)
        return next
      })
    },
    [syncCartToOrder]
  )

  // Send Order → send to bar (unpaid), show confirmation in cart sheet
  const handleSendNow = useCallback(async () => {
    if (!tableNumber || cart.length === 0 || sendingOrder) return
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current)
    const payload = pendingSyncItemsRef.current ?? cart
    await flushCartSync(payload)

    setSendingOrder(true)
    try {
      const cust = customerNumber ?? null
      const guest = customerNumber == null ? guestSessionId : null
      const resolvedActiveOrder =
        activeOrder ?? orderStore.getActiveUnpaidOrder(tableNumber, cust, guest)
      const isSentOrder =
        resolvedActiveOrder &&
        (resolvedActiveOrder.status === "sent" || resolvedActiveOrder.status === "active")

      let sent: Order | null = null

      if (resolvedActiveOrder && !isSentOrder) {
        sent = await orderStore.updateOrder(resolvedActiveOrder.orderId, {
          status: "sent" as const,
          paymentMethod: "cash" as const,
          lastSentAt: Date.now(),
        })
      } else {
        sent = await orderStore.createOrder({
          tableId: tableNumber,
          tableNumber,
          customerNumber: cust,
          guestSessionId: null,
          status: "sent",
          paymentStatus: "UNPAID",
          paymentMethod: "cash",
          items: cart,
          total,
          lastSentAt: Date.now(),
        })
      }

      if (sent) {
        setCart([])
        setPlacedOrderId(sent.orderId)
        setOrderSentConfirm({
          orderLabel: formatOrderLabel(sent),
          tableNumber,
        })
      }
    } finally {
      setSendingOrder(false)
    }
  }, [
    tableNumber,
    cart,
    sendingOrder,
    flushCartSync,
    customerNumber,
    guestSessionId,
    activeOrder,
    total,
  ])

  const handleTrackOrder = useCallback(() => {
    setOrderSentConfirm(null)
    setCartOpen(false)
    setActiveOrdersOpen(true)
  }, [])

  // When order already at bar and customer wants to switch from cash → M-Pesa
  const handlePayMpesa = useCallback(() => {
    setCartOpen(false)
    setShowPaymentModal(true)
  }, [])

  const handleReorder = useCallback(
    (order: Order) => {
      if (!tableNumber) return
      if (!customerNumberResolved) {
        setShowCustomerModal(true)
        return
      }
      setCart((prev) => {
        const next = [...prev]
        for (const item of order.items) {
          const existing = next.find((i) => i.id === item.id)
          if (existing) {
            existing.quantity += item.quantity
          } else {
            next.push({ ...item })
          }
        }
        syncCartToOrder(next)
        return next
      })
      setCartOpen(true)
    },
    [tableNumber, customerNumberResolved, syncCartToOrder]
  )

  const handlePaymentSuccess = useCallback(async (
    method: "mpesa" | "cash",
    mpesaReceiptNumber?: string
  ) => {
    const cust = customerNumber ?? null
    const guest = customerNumber == null ? guestSessionId : null
    const normalizedCustomerPhone = normalizeKenyaPhone(customerNumber ?? "") ?? customerNumber ?? null
    const resolvedActiveOrder = activeOrder ?? orderStore.getActiveUnpaidOrder(tableNumber, cust, guest)

    // If activeOrder is already sent/active, the cart is a NEW order — always create fresh
    const isSentOrder = resolvedActiveOrder &&
      (resolvedActiveOrder.status === "sent" || resolvedActiveOrder.status === "active")

    if (resolvedActiveOrder && !isSentOrder) {
      // Existing draft order — update it
      const patch =
        method === "mpesa"
          ? {
              paymentStatus: "PAID" as const,
              status: "paid" as const,
              paymentMethod: "mpesa" as const,
              lastSentAt: Date.now(),
              mpesaReceiptNumber: mpesaReceiptNumber ?? undefined,
              customerPhone: normalizedCustomerPhone ?? undefined,
            } as any
          : { status: "sent" as const, paymentMethod: "cash" as const, lastSentAt: Date.now() }
      await orderStore.updateOrder(resolvedActiveOrder.orderId, patch)
      setPlacedOrderId(resolvedActiveOrder.orderId)
      // Always clear cart — the order is now sent/paid, it lives in Orders
      setCart([])
      if (method === "mpesa") setActiveOrder(null)
    } else if (resolvedActiveOrder && isSentOrder && method === "mpesa" && cart.length === 0) {
      // Pay existing sent cash order via M-Pesa (cash → M-Pesa switch from order tracking)
      await orderStore.updateOrder(resolvedActiveOrder.orderId, {
        paymentStatus: "PAID" as const,
        status: "paid" as const,
        paymentMethod: "mpesa" as const,
        lastSentAt: Date.now(),
        mpesaReceiptNumber: mpesaReceiptNumber ?? undefined,
        customerPhone: normalizedCustomerPhone ?? undefined,
      } as any)
      setPlacedOrderId(resolvedActiveOrder.orderId)
      setActiveOrder(null)
    } else if (isSentOrder && cart.length > 0) {
      // Cart has new items on top of an existing sent order → brand new order
      const order = await orderStore.createOrder({
        tableId: tableNumber,
        tableNumber,
        customerNumber: cust,
        guestSessionId: null,
        status: method === "mpesa" ? "paid" : "sent",
        paymentStatus: method === "mpesa" ? "PAID" : "UNPAID",
        paymentMethod: method,
        customerPhone: method === "mpesa" ? normalizedCustomerPhone ?? undefined : undefined,
        items: cart,
        total,
        lastSentAt: Date.now(),
        ...(mpesaReceiptNumber ? { mpesaReceiptNumber } : {}),
      } as any)
      setPlacedOrderId(order.orderId)
      setCart([])
    } else if (cart.length > 0) {
      const order = await orderStore.createOrder({
        tableId: tableNumber,
        tableNumber,
        customerNumber: cust,
        guestSessionId: null,
        status: method === "mpesa" ? "paid" : "sent",
        paymentStatus: method === "mpesa" ? "PAID" : "UNPAID",
        paymentMethod: method,
        customerPhone: method === "mpesa" ? normalizedCustomerPhone ?? undefined : undefined,
        items: cart,
        total,
        lastSentAt: Date.now(),
        ...(mpesaReceiptNumber ? { mpesaReceiptNumber } : {}),
      } as any)
      setPlacedOrderId(order.orderId)
      // Always clear cart after sending
      setCart([])
      if (method === "mpesa") setActiveOrder(null)
    }

    setShowPaymentModal(false)
    setCartOpen(false)
    // Paid orders land in history; unpaid/sent stay trackable via Active Orders
    if (method === "mpesa") {
      setShowOrderTracking(false)
      setActiveOrdersOpen(true)
    } else {
      setShowOrderTracking(true)
    }
  }, [activeOrder, cart, customerNumber, guestSessionId, tableNumber, total])

  const handleItemClick = useCallback((item: MenuItem) => {
    setSelectedItem(item)
    setProductSheetOpen(true)
  }, [])

  const getItemQuantity = useCallback(
    (itemId: string) => cart.find((i) => i.id === itemId)?.quantity ?? 0,
    [cart]
  )

  const handleConfirmFromSheet = useCallback(
    (item: MenuItem, quantity: number) => {
      if (!tableNumber) return
      if (!customerNumberResolved) {
        setShowCustomerModal(true)
        return
      }
      setCart((prev) => {
        const existing = prev.find((i) => i.id === item.id)
        let next: CartItem[]
        if (quantity <= 0) {
          next = prev.filter((i) => i.id !== item.id)
        } else if (existing) {
          next = prev.map((i) =>
            i.id === item.id ? { ...i, quantity, unitPrice: Number(item.price) || i.unitPrice } : i
          )
        } else {
          next = [
            ...prev,
            {
              id: item.id,
              name: item.name,
              quantity,
              unitPrice: Number(item.price) || 0,
              image: item.image,
            },
          ]
        }
        syncCartToOrder(next)
        return next
      })
    },
    [tableNumber, customerNumberResolved, syncCartToOrder]
  )

  const handleRemoveFromSheet = useCallback(
    (itemId: string) => {
      handleRemoveItem(itemId)
    },
    [handleRemoveItem]
  )

  const sheetServings = useMemo(() => {
    if (!selectedItem) return []
    return findServingSiblings(selectedItem, menuItems)
  }, [selectedItem, menuItems])

  const allOrders = useMemo(() => {
    if (!tableNumber || !customerNumberResolved) return []
    return orderStore.getOrdersByCustomer(
      tableNumber,
      customerNumber,
      guestSessionId
    )
  }, [tableNumber, customerNumber, guestSessionId, customerNumberResolved, activeOrder])

  // Unpaid / active orders sent to bar (not yet paid, not draft, not cancelled)
  const activeOrders = useMemo(
    () => allOrders.filter(
      (o) => o.paymentStatus === "UNPAID" && (o.status === "sent" || o.status === "active") 
    ),
    [allOrders]
  )

  // History = only fully paid orders
  const historyOrders = useMemo(
    () => allOrders.filter((o) => o.paymentStatus === "PAID" || o.status === "paid"),
    [allOrders]
  )

  const cartItemCount = cart.reduce((s, i) => s + i.quantity, 0)

  // ─── No table: QR scan prompt + manual entry ─────────────────────────────
  if (!tableNumber) {
    const handleManualTable = (e: React.FormEvent) => {
      e.preventDefault()
      const t = manualTableInput.trim()
      if (!t || !/^\d+$/.test(t)) {
        setManualTableError("Enter a valid table number (digits only)")
        return
      }
      setManualTableError("")
      setTableNumber(t)
      tableRef.current = t
      if (typeof window !== "undefined") {
        sessionStorage.setItem(MENU_TABLE_KEY, t)
      }
    }

    return (
      <div className={styles.gate}>
        <div className={styles.gateCard}>
          <div className="text-center space-y-4">
            <div className={styles.gateIcon}>
              <QrCode className="h-10 w-10" />
            </div>
            <div>
              <p className={cn(styles.eyebrow, "mb-2")}>Table Service</p>
              <h1 className={cn(styles.display, "text-3xl")}>Scan your table QR</h1>
              <p className="text-[rgba(242,232,216,0.65)] mt-3 text-sm leading-relaxed">
                Point your camera at the QR code on your table to start ordering
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 my-8">
            <div className="flex-1">
              <div className={styles.hairline} />
            </div>
            <span className={styles.eyebrow}>or</span>
            <div className="flex-1">
              <div className={styles.hairline} />
            </div>
          </div>

          <form onSubmit={handleManualTable} className="space-y-3">
            <div className="space-y-1.5">
              <label className={cn(styles.eyebrow, "block")}>
                Enter your table number
              </label>
              <div className="relative">
                <TableIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[rgba(242,232,216,0.45)] pointer-events-none" />
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  placeholder="e.g. 12"
                  value={manualTableInput}
                  onChange={(e) => {
                    setManualTableInput(e.target.value.replace(/\D/g, ""))
                    setManualTableError("")
                  }}
                  className={styles.gateInput}
                />
              </div>
              {manualTableError && (
                <p className="text-[#c07070] text-xs pl-1">{manualTableError}</p>
              )}
            </div>
            <button
              type="submit"
              disabled={!manualTableInput.trim()}
              className={styles.primaryBtn}
            >
              Go to Menu
            </button>
          </form>
        </div>
      </div>
    )
  }

  // ─── Order tracking screen ────────────────────────────────────────────────
  if (showOrderTracking && placedOrderId) {
    const currentOrder = orderStore.getOrder(placedOrderId)
    return (
      <div className={styles.page}>
        <div className="max-w-2xl mx-auto px-4 py-6 space-y-6 relative z-[1]">
          <button
            onClick={() => {
              setShowOrderTracking(false)
              setPlacedOrderId(null)
            }}
            className={styles.trackingBack}
          >
            ← Back to Menu
          </button>
          <div className="text-center space-y-2">
            <p className={styles.eyebrow}>Order Status</p>
            <h1 className={cn(styles.display, "text-3xl")}>Order sent</h1>
            <p className="text-[rgba(242,232,216,0.65)] text-sm">
              Your order has been received and is being prepared
            </p>
          </div>
          {currentOrder && (
            <OrderTracking
              orderId={placedOrderId}
              onBack={() => {
                setShowOrderTracking(false)
                setPlacedOrderId(null)
              }}
              onAddItems={(order) => {
                setActiveOrder(order)
                setCart(order.items)
                setShowOrderTracking(false)
                setCartOpen(true)
              }}
              onPayNow={() => {
                setActiveOrder(currentOrder)
                setShowOrderTracking(false)
                setShowPaymentModal(true)
              }}
            />
          )}
        </div>
      </div>
    )
  }

  // ─── Main menu view ───────────────────────────────────────────────────────
  return (
    <div className={styles.page}>

      <header className={cn(styles.header, headerScrolled && styles.headerScrolled)}>
        <div className={styles.headerInner}>
          <div className={styles.utilityRow}>
            <div className={styles.logoMark} aria-label="Infusion Jaba">
              IJ
            </div>

            <div className={styles.utilityActions}>
              <OrderHistoryDrawer
                orders={historyOrders}
                onReorder={handleReorder}
              >
                <button
                  title="Order History"
                  className={styles.iconBtn}
                  type="button"
                >
                  <History className="h-4 w-4" />
                </button>
              </OrderHistoryDrawer>

              <ActiveOrdersDrawer
                orders={activeOrders}
                historyOrders={historyOrders}
                open={activeOrdersOpen}
                onOpenChange={setActiveOrdersOpen}
                onPayNow={(order) => {
                  setActiveOrder(order)
                  setShowPaymentModal(true)
                }}
                onCallWaiter={(order) => {
                  if (waiterCooldown.cooling) return
                  setCallWaiterOrderId(order.orderId)
                  setActiveOrdersOpen(false)
                  setCallWaiterOpen(true)
                }}
                callWaiterDisabled={waiterCooldown.cooling}
                callWaiterLabel={waiterCooldown.label}
                onReorder={handleReorder}
              >
                <button
                  title="My Orders"
                  type="button"
                  className={cn(styles.iconBtn, activeOrders.length > 0 && styles.iconBtnActive)}
                >
                  <ClipboardList className="h-4 w-4" />
                  {activeOrders.length > 0 && (
                    <span className={styles.badge}>
                      {activeOrders.length}
                    </span>
                  )}
                </button>
              </ActiveOrdersDrawer>
            </div>
          </div>

          <div className={cn(styles.heroBlock, headerScrolled && styles.heroBlockCollapsed)}>
            <p className={styles.heroEyebrow}>
              <span className={cn(styles.heroDot, styles.goldShimmer)} />
              Table {tableNumber}
              {customerNumber ? ` · ${customerNumber}` : ""}
            </p>
            <h1 className={styles.headline}>{headline}</h1>
          </div>

          <div className={styles.searchWrap}>
            <div className={styles.searchField}>
              <span className={styles.searchIconLeft}>
                <Search className="h-4 w-4" />
              </span>
              <input
                type="text"
                placeholder="Search drinks or brands…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setSearchFocused(false)}
                className={styles.searchInput}
              />
              <span className={styles.searchIconRight}>
                {searchQuery ? (
                  <button
                    type="button"
                    className={styles.searchClear}
                    onClick={() => setSearchQuery("")}
                    aria-label="Clear search"
                  >
                    <X className="h-4 w-4" />
                  </button>
                ) : (
                  <SlidersHorizontal className="h-4 w-4" aria-hidden />
                )}
              </span>
            </div>
          </div>

          <div className={styles.chipsSlot}>
            <CategoryTabs
              categories={menuCategories}
              selectedCategory={selectedCategory}
              onCategoryChange={setSelectedCategory}
              hasJaba={hasJaba}
              onJabaClick={handleJabaClick}
              counts={categoryCounts}
              totalCount={menuItems.length}
            />
          </div>
        </div>
      </header>

      {!menuLoading && selectedCategory === "all" && !debouncedSearch && (
        <div ref={jabaSectionRef} className="pt-1 relative z-[1]">
          <PopularRow
            items={menuItems}
            onItemClick={handleItemClick}
            onAddItem={handleAddToCart}
            onSeeAll={() => {
              allDrinksRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
            }}
          />
        </div>
      )}

      <div
        ref={allDrinksRef}
        className="max-w-screen-xl mx-auto px-4 sm:px-6 lg:px-8 pb-36 pt-4 relative z-[1]"
      >
        {!debouncedSearch && (
          <div className={styles.sectionLabel}>
            <p className={styles.sectionLabelText}>
              {selectedCategory === "all"
                ? "All drinks"
                : menuCategories.find((c) => c.id === selectedCategory)?.name ?? selectedCategory}
            </p>
          </div>
        )}

        {menuLoading ? (
          <div className={styles.grid}>
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className={styles.skeleton} />
            ))}
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}>
              <Search className="h-7 w-7 text-[#D9843B]" />
            </div>
            <p className={cn(styles.display, "text-xl")}>No drinks found</p>
            <p className="text-[rgba(242,232,216,0.65)] text-sm mt-2">Try a different search or category</p>
          </div>
        ) : (
          <div className={styles.grid}>
            {filteredProducts.map((item) => (
              <ProductCard
                key={item.id}
                item={item}
                quantity={getItemQuantity(item.id)}
                onAdd={handleAddToCart}
                onUpdateQuantity={handleUpdateQuantity}
                onClick={handleItemClick}
              />
            ))}
          </div>
        )}
      </div>

      <StickyCartBar
        items={cart}
        total={total}
        onOpenCart={() => setCartOpen(true)}
        hidden={cartOpen || productSheetOpen || showPaymentModal || activeOrdersOpen}
      />

      {selectedItem && (
        <ProductSheet
          open={productSheetOpen}
          onOpenChange={setProductSheetOpen}
          item={selectedItem}
          quantity={getItemQuantity(selectedItem.id)}
          servings={sheetServings}
          onSelectServing={(opt) => setSelectedItem(opt)}
          onConfirm={handleConfirmFromSheet}
          onRemoveFromOrder={handleRemoveFromSheet}
        />
      )}

      <CartDrawer
        open={cartOpen || !!orderSentConfirm}
        onOpenChange={(open) => {
          if (!open && orderSentConfirm) {
            handleTrackOrder()
            return
          }
          setCartOpen(open)
        }}
        items={cart}
        tableNumber={tableNumber}
        customerNumber={customerNumber}
        onUpdateQuantity={handleUpdateQuantity}
        onRemove={handleRemoveItem}
        onSendNow={handleSendNow}
        onPayMpesa={handlePayMpesa}
        total={total}
        subtotal={subtotal}
        vat={vat}
        existingOrderId={activeOrder?.orderId}
        isAddingToExisting={!!activeOrder}
        activeOrderStatus={activeOrder?.status}
        activeOrderPaymentMethod={activeOrder?.paymentMethod}
        activeOrderTotal={activeOrder?.total}
        sentConfirmation={orderSentConfirm}
        onTrackOrder={handleTrackOrder}
        sending={sendingOrder}
      />

      <CustomerNumberModal
        open={showCustomerModal}
        onContinue={handleCustomerContinue}
      />

      <CallWaiterSheet
        open={callWaiterOpen}
        onOpenChange={(open) => {
          setCallWaiterOpen(open)
          if (!open) setCallWaiterOrderId(null)
        }}
        tableNumber={tableNumber}
        customerPhone={customerNumber}
        orderId={callWaiterOrderId ?? activeOrder?.orderId ?? null}
      />

      <PaymentModal
        open={showPaymentModal}
        onOpenChange={setShowPaymentModal}
        amount={activeOrder?.total ?? total}
        phone={customerNumber ?? ""}
        orderMeta={
          activeOrder
            ? `Order ${formatOrderLabel(activeOrder)}${
                tableNumber ? ` · Table ${tableNumber}` : ""
              }`
            : tableNumber
              ? `Table ${tableNumber}`
              : undefined
        }
        onSuccess={handlePaymentSuccess}
        skipToMpesa={
          !!(activeOrder?.status === "sent" || activeOrder?.status === "active")
        }
        mpesaOnly={
          !!(activeOrder?.status === "sent" || activeOrder?.status === "active")
        }
      />
    </div>
  )
}

export default function MenuPage() {
  return (
    <Suspense
      fallback={
        <div className={styles.loader}>
          <div className={styles.spinner} />
          <p className="text-[rgba(242,232,216,0.65)] text-sm">Loading menu...</p>
        </div>
      }
    >
      <MenuContent />
    </Suspense>
  )
}
