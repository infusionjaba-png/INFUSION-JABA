import { Order, OrderStatus, PaymentStatus, PaymentMethod, type CartItem } from "@/types/menu"
import { createCathaOrderId } from "@/lib/catha-order-id"

/** Minimal fields allowed by POST /api/menu-orders (strict schema). */
function menuOrderCreateApiPayload(o: Order) {
  return {
    orderId: o.orderId,
    tableId: o.tableId,
    tableNumber: o.tableNumber,
    customerNumber: o.customerNumber ?? null,
    guestSessionId: o.guestSessionId ?? null,
    customerPhone: o.customerPhone ?? null,
    status: o.status,
    paymentMethod: o.paymentMethod ?? null,
    items: o.items.map((i) => ({
      id: i.id,
      quantity: i.quantity,
    })),
    receivedBy: o.receivedBy,
    cancelledReason: o.cancelledReason,
  }
}

function menuOrderPutApiPayload(orderId: string, patch: Partial<Order> & Record<string, unknown>) {
  const body: Record<string, unknown> = { orderId }
  if (patch.status != null) body.status = patch.status
  if (patch.paymentStatus != null) body.paymentStatus = patch.paymentStatus
  if (patch.paymentMethod != null) body.paymentMethod = patch.paymentMethod
  if (patch.customerPhone != null) body.customerPhone = patch.customerPhone
  if ((patch as any).mpesaReceiptNumber != null) body.mpesaReceiptNumber = (patch as any).mpesaReceiptNumber
  if (patch.items && Array.isArray(patch.items)) {
    body.items = patch.items.map((i: CartItem) => ({ id: i.id, quantity: i.quantity }))
  }
  return body
}

type OrderUpdateCallback = (orders: Order[]) => void

const LEGACY_STATUS_MAP: Record<string, OrderStatus> = {
  PENDING: "draft",
  IN_PROGRESS: "sent",
  RECEIVED: "sent",
  CANCELLED: "cancelled",
}

function mapServerLineItemsToCart(serverItems: unknown, fallback: CartItem[] = []): CartItem[] {
  if (!Array.isArray(serverItems) || serverItems.length === 0) return fallback
  return serverItems.map((it: any, idx: number) => {
    const id = String(it.productId ?? it.id ?? it.skuId ?? "")
    const prev =
      (id ? fallback.find((x) => x.id === id) : undefined) ||
      fallback[idx]
    const unitPrice = Number(
      it.unitPrice ?? it.price ?? prev?.unitPrice ?? 0
    )
    return {
      id: id || prev?.id || `line-${idx}`,
      name: String(it.name || prev?.name || ""),
      quantity: Number(it.quantity) || 0,
      unitPrice: Number.isFinite(unitPrice) ? unitPrice : 0,
      image: prev?.image || (typeof it.image === "string" ? it.image : "") || "",
      notes: prev?.notes,
    }
  })
}

function normalizeCartItems(items: unknown): CartItem[] {
  if (!Array.isArray(items)) return []
  return mapServerLineItemsToCart(items, [])
}

function normalizeOrder(o: any): Order {
  const status = typeof o.status === "string" && LEGACY_STATUS_MAP[o.status]
    ? LEGACY_STATUS_MAP[o.status]
    : (o.status || "draft")
  const paymentStatus: PaymentStatus =
    o.paymentStatus === "PAID" ? "PAID" : "UNPAID"
  const effectiveStatus: OrderStatus =
    paymentStatus === "PAID" ? "paid" : status

  return {
    ...o,
    status: effectiveStatus,
    paymentStatus,
    paymentMethod: (o.paymentMethod as PaymentMethod) ?? undefined,
    customerNumber: o.customerNumber ?? o.customerPart ?? null,
    guestSessionId: o.guestSessionId ?? null,
    lastSentAt: o.lastSentAt ?? undefined,
    servedAt:
      o.servedAt == null
        ? undefined
        : typeof o.servedAt === "number"
          ? o.servedAt
          : new Date(o.servedAt).getTime(),
    servedBy: o.servedBy ?? undefined,
    updatedAt: o.updatedAt ?? o.createdAt ?? Date.now(),
    items: normalizeCartItems(o.items),
    total: Number(o.total) || 0,
    staffEditedAt:
      o.staffEditedAt == null
        ? null
        : typeof o.staffEditedAt === "number"
          ? o.staffEditedAt
          : new Date(o.staffEditedAt).getTime(),
    staffEditNotice: o.staffEditNotice ?? null,
  }
}

class OrderStore {
  private orders: Order[] = []
  private subscribers: Set<OrderUpdateCallback> = new Set()
  private storageKey = "bar_menu_orders"
  private alertedStorageKey = "bar_alerted_orders"
  private syncedPaidStorageKey = "bar_synced_paid_orders"
  private alertedOrderIds: Set<string> = new Set()
  private syncedPaidOrderIds: Set<string> = new Set()

  private loadAlertedFromStorage() {
    if (typeof window === "undefined") return
    try {
      const stored = localStorage.getItem(this.alertedStorageKey)
      if (stored) this.alertedOrderIds = new Set(JSON.parse(stored) as string[])
    } catch {}
    try {
      const stored2 = localStorage.getItem(this.syncedPaidStorageKey)
      if (stored2) this.syncedPaidOrderIds = new Set(JSON.parse(stored2) as string[])
    } catch {}
  }

  private saveAlertedToStorage() {
    if (typeof window === "undefined") return
    try {
      const arr = [...this.alertedOrderIds].slice(-500)
      localStorage.setItem(this.alertedStorageKey, JSON.stringify(arr))
    } catch {}
    try {
      const arr2 = [...this.syncedPaidOrderIds].slice(-500)
      localStorage.setItem(this.syncedPaidStorageKey, JSON.stringify(arr2))
    } catch {}
  }

  constructor() {
    this.loadFromStorage()
    this.loadAlertedFromStorage()
    if (typeof window !== "undefined") {
      this.loadFromMongoDB()
      window.addEventListener("storage", this.handleStorageChange.bind(this))
      setInterval(() => this.loadFromMongoDB(), 2000)
    }
  }

  private async loadFromMongoDB() {
    if (typeof window === "undefined") return
    try {
      const params = new URLSearchParams()
      const localIds = this.orders.map((o) => o.orderId).filter(Boolean)
      if (localIds.length > 0) {
        params.set("orderIds", [...new Set(localIds)].slice(0, 40).join(","))
      }

      try {
        const cust = sessionStorage.getItem("menu_customer_number")?.trim()
        if (cust) params.set("customerNumber", cust)
        const guest = sessionStorage.getItem("menu_guest_session")?.trim()
        const table = sessionStorage.getItem("menu_table")?.trim()
        if (guest && table) {
          params.set("guestSessionId", guest)
          params.set("tableId", table)
        }
      } catch {
        /* sessionStorage may be blocked */
      }

      if (![...params.keys()].length) return

      // Prefer public scoped poll (works for /menu guests). Staff pages may still
      // hit the auth route as a fallback when public returns empty.
      let formattedOrders: Order[] | null = null
      const publicRes = await fetch(`/api/menu-orders?${params.toString()}`, {
        cache: "no-store",
      })
      if (publicRes.ok) {
        const orders = await publicRes.json()
        if (Array.isArray(orders)) {
          formattedOrders = orders.map((o: any) =>
            normalizeOrder({
              ...o,
              createdAt:
                typeof o.createdAt === "number"
                  ? o.createdAt
                  : new Date(o.createdAt).getTime(),
            })
          )
        }
      } else if (publicRes.status === 401 || publicRes.status === 403) {
        const response = await fetch("/api/catha/menu-orders", { cache: "no-store" })
        if (!response.ok) return
        const orders = await response.json()
        if (!Array.isArray(orders)) return
        formattedOrders = orders.map((o: any) =>
          normalizeOrder({
            ...o,
            createdAt:
              typeof o.createdAt === "number"
                ? o.createdAt
                : new Date(o.createdAt).getTime(),
          })
        )
      } else {
        return
      }

      if (!formattedOrders) return

      const prevById = new Map(this.orders.map((o) => [o.orderId, o]))
      const staffEdited: Order[] = []
      const nextById = new Map(prevById)

      for (const server of formattedOrders) {
        const prev = prevById.get(server.orderId)
        const prevEdit = prev?.staffEditedAt ?? null
        const nextEdit = server.staffEditedAt ?? null
        if (
          nextEdit != null &&
          nextEdit !== prevEdit &&
          // Avoid alerting on first hydrate from empty local state for old edits
          prev != null
        ) {
          staffEdited.push(server)
        }
        nextById.set(
          server.orderId,
          normalizeOrder({
            ...(prev || {}),
            ...server,
            // Prefer server lines/total when staff edited
            items: server.items?.length ? server.items : prev?.items || server.items,
            total: server.total ?? prev?.total,
          })
        )
      }

      const merged = [...nextById.values()]
      if (JSON.stringify(this.orders) !== JSON.stringify(merged)) {
        this.orders = merged
        this.saveToStorage()
        this.notifySubscribers()
      }

      for (const order of staffEdited) {
        try {
          window.dispatchEvent(
            new CustomEvent("menu-order-staff-edited", { detail: order })
          )
        } catch {}
      }

      for (const order of merged) {
        // Re-alert bar for sent/active orders that never made it through
        if (
          (order.status === "sent" || order.status === "active") &&
          !this.alertedOrderIds.has(order.orderId)
        ) {
          this.alertBar(order)
        }

        // Sync payment status for paid orders whose admin record hasn't been updated yet
        if (order.status === "paid" && !this.syncedPaidOrderIds.has(order.orderId)) {
          this.syncedPaidOrderIds.add(order.orderId)
          this.saveAlertedToStorage()
          this.syncPaymentToAdmin(order)
        }
      }
    } catch {
      // Silently fail
    }
  }

  private handleStorageChange(e: StorageEvent) {
    if (e.key === this.storageKey && e.newValue) {
      try {
        const newOrders = JSON.parse(e.newValue).map((o: any) =>
          normalizeOrder({ ...o, createdAt: o.createdAt || Date.now() })
        )
        if (JSON.stringify(this.orders) !== JSON.stringify(newOrders)) {
          this.orders = newOrders
          this.notifySubscribers()
        }
      } catch {}
    }
  }

  private loadFromStorage() {
    if (typeof window === "undefined") return
    try {
      const stored = localStorage.getItem(this.storageKey)
      if (stored) {
        this.orders = JSON.parse(stored).map((o: any) =>
          normalizeOrder({ ...o, createdAt: o.createdAt || Date.now() })
        )
      }
    } catch {}
  }

  private saveToStorage() {
    if (typeof window === "undefined") return
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.orders))
    } catch {}
  }

  private notifySubscribers() {
    const orders = [...this.orders]
    this.subscribers.forEach((cb) => {
      try {
        cb(orders)
      } catch {}
    })
  }

  subscribe(callback: OrderUpdateCallback): () => void {
    this.subscribers.add(callback)
    callback([...this.orders])
    return () => this.subscribers.delete(callback)
  }

  getOrders(): Order[] {
    return [...this.orders]
  }

  getOrder(orderId: string): Order | undefined {
    return this.orders.find((o) => o.orderId === orderId)
  }

  /** Get the single unpaid/draft order for (tableNumber, customerNumber) or (tableNumber, guestSessionId).
   *  When a customerNumber is supplied we search ALL tables so returning customers always find their unpaid order. */
  getActiveUnpaidOrder(
    tableNumber: string,
    customerNumber: string | null,
    guestSessionId: string | null
  ): Order | undefined {
    return this.orders.find((o) => {
      if (o.paymentStatus === "PAID") return false
      if (o.status === "cancelled") return false

      if (customerNumber != null && customerNumber !== "") {
        // Customer-wide: match on phone number regardless of table
        return o.customerNumber === customerNumber
      }
      // Guest: still requires table match
      if (o.tableId !== tableNumber && String(o.tableNumber) !== tableNumber)
        return false
      return o.guestSessionId === guestSessionId
    })
  }

  async createOrder(
    order: Omit<Order, "orderId" | "createdAt">
  ): Promise<Order> {
    const newOrder: Order = {
      ...order,
      orderId: this.generateOrderId(),
      createdAt: Date.now(),
    }

    const response = await fetch("/api/menu-orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(menuOrderCreateApiPayload(newOrder)),
    })
    if (!response.ok) {
      const errBody = await response.json().catch(() => null)
      throw new Error(
        (errBody && (errBody.error || errBody.message)) ||
          `Failed to save (${response.status})`
      )
    }
    const saved = await response.json().catch(() => null)
    const merged: Order = saved
      ? normalizeOrder({
          ...newOrder,
          ...saved,
          items: Array.isArray(saved.items)
            ? mapServerLineItemsToCart(saved.items, newOrder.items)
            : newOrder.items,
          total:
            typeof saved.total === "number" ? saved.total : newOrder.total,
          createdAt: newOrder.createdAt,
        })
      : newOrder

    // Alert bar when order is sent, active, or paid — not for drafts
    if (merged.status === "sent" || merged.status === "active" || merged.status === "paid") {
      await this.alertBar(merged)
    }

    this.orders.push(merged)
    this.saveToStorage()
    this.notifySubscribers()
    return merged
  }

  async updateOrder(orderId: string, patch: Partial<Order>): Promise<Order | null> {
    const index = this.orders.findIndex((o) => o.orderId === orderId)
    if (index === -1) return null

    const previous = this.orders[index]
    const updated = { ...previous, ...patch, updatedAt: Date.now() }

    const response = await fetch("/api/menu-orders", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(menuOrderPutApiPayload(orderId, patch)),
    })
    if (!response.ok) {
      const errBody = await response.json().catch(() => null)
      throw new Error(
        (errBody && (errBody.error || errBody.message)) ||
          `Failed to update (${response.status})`
      )
    }
    const data = await response.json().catch(() => null)
    const saved = data?.order
    const normalized = saved
      ? normalizeOrder({
          ...updated,
          ...saved,
          items: Array.isArray(saved.items)
            ? mapServerLineItemsToCart(saved.items, updated.items)
            : updated.items,
          total: typeof saved.total === "number" ? saved.total : updated.total,
        })
      : updated

    this.orders[index] = normalized
    this.saveToStorage()
    this.notifySubscribers()

    if (patch.status === "sent" || patch.status === "active") {
      await this.alertBar(normalized)
    }
    if (patch.status === "paid" || patch.paymentStatus === "PAID") {
      await this.syncPaymentToAdmin(normalized)
    }
    return normalized
  }

  /** Push a payment status update to the admin orders collection */
  private async syncPaymentToAdmin(order: Order): Promise<void> {
    try {
      const receipt = (order as any).mpesaReceiptNumber ?? undefined
      const paidPhone = order.customerPhone ?? order.customerNumber ?? null
      // First try to UPDATE the existing admin order (cash → M-Pesa switch or cash confirmed paid)
      const res = await fetch(`/api/catha/orders`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: order.orderId,
          status: "completed",
          paymentStatus: "PAID",
          paymentMethod: order.paymentMethod ?? "cash",
          customerPhone: paidPhone,
          ...(receipt ? { mpesaReceiptNumber: receipt } : {}),
        }),
      })

      if (!res.ok) {
        // Admin order might not exist yet — create it via alertBar (bypass alerted guard)
        this.alertedOrderIds.delete(order.orderId)
        await this.alertBar(order)
      }
    } catch (e) {
      console.error("Error syncing payment to admin:", e)
    }
  }

  private async alertBar(order: Order): Promise<void> {
    // Guard: each order is only ever sent to the bar once (persisted across reloads)
    if (this.alertedOrderIds.has(order.orderId)) return
    // NOTE: only mark as alerted AFTER successful POST so failures are retried
    try {
      const payMethod = order.paymentMethod ?? (order.paymentStatus === "PAID" ? "mpesa" : "cash")
      const paidPhone = order.customerPhone ?? order.customerNumber ?? null
      const barOrder = {
        id: order.orderId,
        table: parseInt(order.tableId) || order.tableId,
        customerPhone: paidPhone,
        items: order.items.map((item: any) => ({
          productId: item.id || item.productId || item.name,
          name: item.name,
          quantity: item.quantity,
          price: item.unitPrice || item.price,
        })),
        // Prices are VAT-inclusive in this app; do not derive or add VAT on top.
        subtotal: order.total,
        vat: 0,
        total: order.total,
        paymentMethod: payMethod,
        paymentStatus: order.paymentStatus,
        paymentNote:
          payMethod === "mpesa"
            ? `Paid via M-Pesa (${paidPhone ?? ""})`
            : "To be paid in cash",
        cashier: "Customer",
        waiter: "Customer",
        orderSource: "menu",
        timestamp: new Date(order.createdAt),
        status: order.paymentStatus === "PAID" ? "completed" : "pending",
        ...((order as any).mpesaReceiptNumber ? { mpesaReceiptNumber: (order as any).mpesaReceiptNumber } : {}),
      }
      const res = await fetch("/api/catha/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(barOrder),
      })
      // Only mark alerted when the request succeeded (2xx) so we retry on failure
      if (res.ok) {
        this.alertedOrderIds.add(order.orderId)
        this.saveAlertedToStorage()

        // Notify admin: customer wants to pay cash — server can go collect
        if (payMethod === "cash") {
          fetch("/api/catha/cash-payment-requests", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              orderId: order.orderId,
              tableNumber: order.tableId || order.tableNumber,
              amount: order.total,
            }),
          }).catch(() => {})
        }
      }
    } catch (e) {
      console.error("Error alerting bar — will retry:", e)
    }
  }

  private generateOrderId(): string {
    return createCathaOrderId("menu")
  }

  getActiveOrders(): Order[] {
    return this.orders.filter(
      (o) =>
        o.paymentStatus !== "PAID" &&
        o.status !== "cancelled"
    )
  }

  getOrdersByTable(tableId: string): Order[] {
    return this.orders.filter(
      (o) => o.tableId === tableId || String(o.tableNumber) === tableId
    )
  }

  getOrdersByCustomer(tableId: string, customerNumber: string | null, guestSessionId: string | null): Order[] {
    return this.orders
      .filter((o) => {
        if (customerNumber != null && customerNumber !== "") {
          // Customer-wide: all orders for this phone number, any table
          return o.customerNumber === customerNumber
        }
        // Guest: table-scoped
        return (
          (o.tableId === tableId || String(o.tableNumber) === tableId) &&
          o.guestSessionId === guestSessionId
        )
      })
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
  }
}

let orderStoreInstance: OrderStore | null = null

export const orderStore = (() => {
  if (typeof window === "undefined") {
    return {
      subscribe: () => () => {},
      getOrders: () => [],
      getOrder: () => undefined,
      createOrder: async () => ({} as Order),
      updateOrder: async () => null,
      getActiveOrders: () => [],
      getOrdersByTable: () => [],
      getActiveUnpaidOrder: () => undefined,
      getOrdersByCustomer: () => [],
    } as unknown as OrderStore
  }
  if (!orderStoreInstance) orderStoreInstance = new OrderStore()
  return orderStoreInstance
})()
