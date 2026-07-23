"use client"

import React from "react"
import {
  Drawer,
  DrawerContent,
  DrawerTrigger,
} from "@/components/ui/drawer"
import { Check, ClipboardList, Receipt, ChevronDown } from "lucide-react"
import { Order } from "@/types/menu"
import { cn } from "@/lib/utils"
import styles from "./order-lifecycle.module.css"
import {
  formatOrderLabel,
  formatOrderTime,
  orderItemCount,
  orderTotal,
  trackerStep,
  statusPillLabel,
  groupOrdersByDay,
  relativeDayLabel,
  maskPhone,
} from "./order-display"

const STEPS = ["Sent", "Preparing", "Served", "Paid"] as const

function StatusTracker({ step }: { step: number }) {
  const fillPct = step <= 0 ? 0 : (step / (STEPS.length - 1)) * 100

  return (
    <div className={styles.tracker}>
      <div className={styles.trackerLine} aria-hidden>
        <div className={styles.trackerLineFill} style={{ width: `${fillPct}%` }} />
      </div>
      {STEPS.map((label, i) => {
        const done = i < step
        const current = i === step
        const reached = i <= step
        return (
          <div key={label} className={styles.trackerStep}>
            <div
              className={cn(
                styles.dot,
                done && styles.dotDone,
                current && styles.dotCurrent,
                !done && !current && styles.dotPending
              )}
            >
              {done && <Check className="h-3 w-3" strokeWidth={3} />}
            </div>
            <span
              className={cn(
                styles.stepLabel,
                reached ? styles.stepLabelReached : styles.stepLabelPending
              )}
            >
              {label}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function ActiveOrderCard({
  order,
  onPayNow,
  onCallWaiter,
  callWaiterDisabled,
  callWaiterLabel,
}: {
  order: Order
  onPayNow?: (order: Order) => void
  onCallWaiter?: (order: Order) => void
  callWaiterDisabled?: boolean
  callWaiterLabel?: string
}) {
  const [expanded, setExpanded] = React.useState(false)
  const step = trackerStep(order)
  const count = orderItemCount(order)
  const total = orderTotal(order)
  const sentAt = order.lastSentAt ?? order.createdAt
  const cooling = !!callWaiterDisabled

  return (
    <div
      className={styles.card}
      onClick={() => setExpanded((v) => !v)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          setExpanded((v) => !v)
        }
      }}
    >
      <div className={styles.cardHeader}>
        <div>
          <p className={styles.orderTitle}>Order {formatOrderLabel(order)}</p>
          <p className={styles.meta}>
            Sent {formatOrderTime(sentAt)} · {count} {count === 1 ? "item" : "items"}
          </p>
        </div>
        <span className={styles.pill} key={statusPillLabel(order)}>
          {statusPillLabel(order)}
        </span>
      </div>

      <StatusTracker step={step} />

      <div className={styles.itemsBox}>
        {order.items.map((item, i) => (
          <div key={`${item.id}-${i}`} className={styles.itemsBoxRow}>
            <span className={styles.itemsBoxLine}>
              {item.quantity}× {item.name}
            </span>
            {expanded && (
              <span className={styles.itemLine}>
                KES {(item.unitPrice * item.quantity).toLocaleString()}
              </span>
            )}
          </div>
        ))}
      </div>

      <div className={styles.footer} onClick={(e) => e.stopPropagation()}>
        <span className={styles.total}>
          KES {total.toLocaleString()}
        </span>
        <div className={styles.actions}>
          <button
            type="button"
            className={cn(
              styles.ghostBtn,
              cooling && styles.ghostBtnCalled,
              cooling && styles.ghostBtnDisabled
            )}
            disabled={cooling}
            onClick={() => {
              if (cooling) return
              onCallWaiter?.(order)
            }}
          >
            {callWaiterLabel ?? (cooling ? "Waiter called ✓" : "Call waiter")}
          </button>
          {onPayNow && step < 3 && (
            <button
              type="button"
              className={styles.payBtn}
              onClick={() => onPayNow(order)}
            >
              Pay now
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function HistoryReceipt({
  order,
  onReorder,
}: {
  order: Order
  onReorder?: (order: Order) => void
}) {
  const [open, setOpen] = React.useState(false)
  const total = orderTotal(order)
  const count = orderItemCount(order)
  const method =
    order.paymentMethod === "mpesa"
      ? "M-Pesa"
      : order.paymentMethod === "cash"
        ? "Cash"
        : "Paid"
  const paidAt = order.updatedAt ?? order.createdAt

  return (
    <div className={styles.receipt}>
      <button
        type="button"
        className={styles.receiptHeader}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <div className={styles.receiptIcon}>
          <Receipt className="h-4 w-4" />
        </div>
        <div className={styles.receiptMid}>
          <div className={styles.receiptTitleRow}>
            <span className={styles.orderTitle}>Order {formatOrderLabel(order)}</span>
            <span className={styles.paidBadge}>
              Paid · {method}
            </span>
          </div>
          <p className={styles.meta}>
            {relativeDayLabel(order.createdAt)} · {formatOrderTime(order.createdAt)} ·{" "}
            {count} {count === 1 ? "item" : "items"}
          </p>
        </div>
        <div className={styles.receiptRight}>
          <span className={styles.total}>KES {total.toLocaleString()}</span>
          <ChevronDown
            className={cn(styles.chevron, open && styles.chevronOpen)}
            size={16}
          />
        </div>
      </button>

      {open && (
        <div className={styles.receiptBody}>
          <div className={styles.receiptLines}>
            {order.items.map((item, i) => (
              <div key={`${item.id}-${i}`} className={styles.receiptLine}>
                <div>
                  <p className={styles.itemName}>{item.name}</p>
                  <p className={styles.itemMeta}>
                    {item.quantity}× KES {item.unitPrice.toLocaleString()}
                  </p>
                </div>
                <span className={styles.itemLine}>
                  KES {(item.unitPrice * item.quantity).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
          <div className={styles.subtotalRow}>
            <span>Subtotal</span>
            <span>KES {total.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
          <div className={styles.totalRow}>
            <span>Total</span>
            <span className={styles.totalRowAmt}>KES {total.toLocaleString()}</span>
          </div>
          <p className={styles.paymentLine}>
            {method}
            {order.paymentMethod === "mpesa" && ` ${maskPhone(order.customerPhone ?? order.customerNumber)}`}
            {" · "}
            {formatOrderTime(paidAt)}
          </p>
          {onReorder && (
            <button
              type="button"
              className={styles.reorderBtn}
              onClick={() => onReorder(order)}
            >
              Reorder
            </button>
          )}
        </div>
      )}
    </div>
  )
}

interface ActiveOrdersDrawerProps {
  orders: Order[]
  historyOrders?: Order[]
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onSelectOrder?: (order: Order) => void
  onPayNow?: (order: Order) => void
  onCallWaiter?: (order: Order) => void
  callWaiterDisabled?: boolean
  callWaiterLabel?: string
  onReorder?: (order: Order) => void
  children?: React.ReactNode
}

export function ActiveOrdersDrawer({
  orders,
  historyOrders = [],
  open: controlledOpen,
  onOpenChange,
  onPayNow,
  onCallWaiter,
  callWaiterDisabled,
  callWaiterLabel,
  onReorder,
  children,
}: ActiveOrdersDrawerProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false)
  const open = controlledOpen ?? uncontrolledOpen
  const setOpen = onOpenChange ?? setUncontrolledOpen
  const count = orders.length
  const sorted = React.useMemo(
    () => [...orders].sort((a, b) => (b.lastSentAt ?? b.createdAt) - (a.lastSentAt ?? a.createdAt)),
    [orders]
  )
  const historyGroups = React.useMemo(
    () => groupOrdersByDay(historyOrders),
    [historyOrders]
  )

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        {children ?? (
          <button
            type="button"
            className="relative h-10 w-10 rounded-xl bg-[#382C21] border border-[rgba(242,232,216,0.14)] hover:bg-[#403428] flex items-center justify-center transition-colors"
          >
            <ClipboardList className="h-5 w-5 text-[#D9843B]" />
            {count > 0 && (
              <span className="absolute -top-1 -right-1 h-4 min-w-[16px] px-1 rounded-full bg-[#D9843B] text-[#412402] text-[9px] font-bold flex items-center justify-center">
                {count}
              </span>
            )}
          </button>
        )}
      </DrawerTrigger>

      <DrawerContent className={cn(styles.sheet, "bg-transparent")}>
        <div className={styles.handle}>
          <div className={styles.handleBar} />
        </div>

        <div className={styles.body}>
          <section>
            <div className={styles.sectionHeader}>
              <div className={styles.sectionHeaderLeft}>
                <ClipboardList className={styles.sectionIcon} size={16} strokeWidth={2.25} />
                <h2 className={styles.sectionLabel}>Active orders</h2>
              </div>
              <span className={styles.sectionCount}>
                {count} in progress
              </span>
            </div>
            {count === 0 ? (
              <div className={styles.empty}>
                <div className={styles.emptyIcon}>
                  <ClipboardList className="h-7 w-7" />
                </div>
                <p className={styles.emptyTitle}>No active orders</p>
                <p className={styles.emptySub}>
                  Orders you&apos;ve sent will appear here until paid
                </p>
              </div>
            ) : (
              <div className={styles.stack}>
                {sorted.map((order) => (
                  <ActiveOrderCard
                    key={order.orderId}
                    order={order}
                    onPayNow={(o) => {
                      onPayNow?.(o)
                      setOpen(false)
                    }}
                    onCallWaiter={onCallWaiter}
                    callWaiterDisabled={callWaiterDisabled}
                    callWaiterLabel={callWaiterLabel}
                  />
                ))}
              </div>
            )}
          </section>

          <hr className={styles.sectionBreak} />

          <section>
            <div className={styles.sectionHeader}>
              <div className={styles.sectionHeaderLeft}>
                <Receipt className={styles.sectionIcon} size={16} strokeWidth={2.25} />
                <h2 className={styles.sectionLabel}>Order history</h2>
              </div>
              <span className={styles.sectionCount}>
                {historyOrders.length} paid
              </span>
            </div>
            {historyOrders.length === 0 ? (
              <div className={styles.emptyInline}>
                <div className={styles.emptyInlineIcon}>
                  <Receipt className="h-4 w-4" />
                </div>
                <div>
                  <p className={styles.emptyInlineTitle}>No paid orders yet</p>
                  <p className={styles.emptyInlineSub}>
                    Completed orders will appear here
                  </p>
                </div>
              </div>
            ) : (
              historyGroups.map((group) => (
                <div key={group.key}>
                  <p className={styles.dayLabel}>{group.label}</p>
                  <div className={styles.stack}>
                    {group.orders.map((order) => (
                      <HistoryReceipt
                        key={order.orderId}
                        order={order}
                        onReorder={(o) => {
                          onReorder?.(o)
                          setOpen(false)
                        }}
                      />
                    ))}
                  </div>
                </div>
              ))
            )}
          </section>
        </div>
      </DrawerContent>
    </Drawer>
  )
}
