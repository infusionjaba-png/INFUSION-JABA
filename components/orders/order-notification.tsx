"use client"

import React, { useState } from "react"
import { Bell, MapPin, X, Check } from "lucide-react"
import { Order } from "@/types/menu"
import { cn } from "@/lib/utils"
import { formatDistanceToNow } from "date-fns"
import styles from "./order-notification.module.css"

interface OrderNotificationProps {
  order: Order
  onDismiss: () => void
  onView: () => void
  onAccept: () => void | Promise<void>
  /** Optional menu price lookup by product id (fallback when line price missing) */
  menuPriceById?: Record<string, number>
}

function formatKes(amount: number): string {
  if (!Number.isFinite(amount)) return "—"
  return `KES ${Math.round(amount).toLocaleString()}`
}

/** Strip stray pagination-like fragments (e.g. "1/35") from item names. */
function cleanItemName(name: string): string {
  return String(name || "")
    .replace(/\s+\d+\s*\/\s*\d+\s*$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim()
}

function resolveUnitPrice(
  item: {
    id?: string
    productId?: string
    skuId?: string
    unitPrice?: number
    price?: number
  },
  menuPriceById?: Record<string, number>
): number | null {
  const direct = Number(item.unitPrice ?? item.price)
  if (Number.isFinite(direct) && direct >= 0) return direct

  const id = String(item.id ?? item.productId ?? item.skuId ?? "")
  if (id && menuPriceById && Number.isFinite(menuPriceById[id])) {
    console.warn(
      `[order-notification] Missing unit price for "${id}"; falling back to menu price`
    )
    return menuPriceById[id]
  }

  console.warn(
    `[order-notification] Missing unit price for line item`,
    item.id ?? item.productId ?? item.name
  )
  return null
}

function paymentMethodLabel(method?: string | null): string {
  const m = (method || "").toLowerCase()
  if (m === "cash") return "Cash at till"
  if (m === "mpesa" || m === "m-pesa") return "M-Pesa"
  if (m === "card") return "Card"
  if (m === "glovo") return "Glovo"
  if (m) return m.charAt(0).toUpperCase() + m.slice(1)
  return "Cash at till"
}

function isPaid(order: Order): boolean {
  if (order.paymentStatus === "PAID" || order.status === "paid") return true
  const m = (order.paymentMethod || "").toLowerCase()
  // Glovo arrives pre-paid; M-Pesa only if status already marked paid above
  return m === "glovo"
}

function tableLabel(order: Order): string {
  const raw = order.tableId || order.tableNumber || ""
  const n = String(raw).replace(/^table\s*/i, "").trim()
  if (!n) return "Table —"
  return `Table ${n}`
}

function orderCode(order: Order): string {
  const id = order.orderId || ""
  const short = id.slice(-8).toUpperCase()
  return short ? `#${short}` : "#—"
}

export function OrderNotification({
  order,
  onDismiss,
  onView,
  onAccept,
  menuPriceById,
}: OrderNotificationProps) {
  const [exiting, setExiting] = useState(false)
  const [accepted, setAccepted] = useState(false)

  const itemCount = order.items.reduce(
    (sum, item) => sum + (Number(item.quantity) || 0),
    0
  )
  const timeAgo = formatDistanceToNow(new Date(order.createdAt), {
    addSuffix: false,
  })
  const timeLabel =
    timeAgo === "less than a minute" || timeAgo === "0 seconds"
      ? "Just now"
      : timeAgo

  const paid = isPaid(order)
  const visibleItems = order.items.slice(0, 4)
  const hiddenCount = Math.max(0, order.items.length - 4)

  const total = Number(order.total)
  const totalLabel = Number.isFinite(total) ? formatKes(total) : "—"

  const dismiss = () => {
    if (exiting) return
    setExiting(true)
    setTimeout(onDismiss, 280)
  }

  const handleAccept = async () => {
    if (accepted || exiting) return
    setAccepted(true)
    try {
      await onAccept()
    } finally {
      setTimeout(() => {
        setExiting(true)
        setTimeout(onDismiss, 280)
      }, 480)
    }
  }

  return (
    <div
      className={cn(styles.card, exiting ? styles.exit : styles.enter)}
      role="alertdialog"
      aria-label="New order"
    >
      <div className={styles.brandEdge} aria-hidden />
      <div className={styles.body}>
        <div className={styles.header}>
          <div className={styles.bellWrap}>
            <Bell className={styles.bellIcon} strokeWidth={2.25} />
          </div>
          <div className={styles.headerText}>
            <h3 className={styles.title}>New order</h3>
            <p className={styles.meta}>
              {timeLabel} · {orderCode(order)}
            </p>
          </div>
          <button
            type="button"
            className={styles.dismiss}
            aria-label="Dismiss"
            onClick={dismiss}
          >
            <X className="h-4 w-4" strokeWidth={2.25} />
          </button>
        </div>

        <div className={styles.tableRow}>
          <div className={styles.tableHeadline}>
            <MapPin className={styles.pinIcon} strokeWidth={2.5} />
            <h4 className={styles.tableName}>{tableLabel(order)}</h4>
          </div>
          <div className={styles.chips}>
            <span className={styles.chipMethod}>
              {paymentMethodLabel(order.paymentMethod)}
            </span>
            <span className={styles.chipStatus}>
              {paid ? "Paid" : "Unpaid"}
            </span>
          </div>
        </div>

        <div className={styles.items}>
          {visibleItems.map((item, idx) => {
            const qty = Number(item.quantity) || 0
            const unit = resolveUnitPrice(item as any, menuPriceById)
            const line =
              unit != null && Number.isFinite(qty * unit) ? qty * unit : null
            return (
              <div key={`${(item as any).id ?? idx}-${idx}`} className={styles.itemRow}>
                <span className={styles.itemName}>
                  {qty}× {cleanItemName(item.name)}
                </span>
                <span className={styles.itemPrice}>
                  {line != null ? formatKes(line) : "—"}
                </span>
              </div>
            )
          })}
          {hiddenCount > 0 && (
            <div className={styles.moreItems}>
              +{hiddenCount} more item{hiddenCount === 1 ? "" : "s"}
            </div>
          )}
        </div>

        <div className={styles.totalRow}>
          <span className={styles.totalLabel}>
            Total · {itemCount} item{itemCount === 1 ? "" : "s"}
          </span>
          <span className={styles.totalAmount}>{totalLabel}</span>
        </div>

        <div className={styles.actions}>
          <button
            type="button"
            className={cn(styles.accept, accepted && styles.acceptDone)}
            onClick={handleAccept}
            disabled={accepted}
          >
            <Check className="h-4 w-4" strokeWidth={2.5} />
            {accepted ? "Accepted" : "Accept order"}
          </button>
          <button type="button" className={styles.view} onClick={onView}>
            View
          </button>
        </div>
      </div>
    </div>
  )
}

/** Stack shell + overflow link used by the provider */
export function OrderNotificationStack({
  children,
  overflowCount,
  onExpandOverflow,
}: {
  children: React.ReactNode
  overflowCount: number
  onExpandOverflow?: () => void
}) {
  return (
    <div className={styles.stack}>
      {children}
      {overflowCount > 0 && (
        <button
          type="button"
          className={styles.moreOrders}
          onClick={onExpandOverflow}
        >
          +{overflowCount} more order{overflowCount === 1 ? "" : "s"}
        </button>
      )}
    </div>
  )
}

export function OrderNotificationStackItem({
  children,
}: {
  children: React.ReactNode
}) {
  return <div className={styles.stackItem}>{children}</div>
}
