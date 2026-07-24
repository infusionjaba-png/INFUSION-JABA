"use client"

import React from "react"
import {
  Drawer,
  DrawerContent,
  DrawerTrigger,
} from "@/components/ui/drawer"
import { Bell, Check, ClipboardList, Receipt, ChevronDown } from "lucide-react"
import { Order } from "@/types/menu"
import { cn } from "@/lib/utils"
import styles from "./order-lifecycle.module.css"
import {
  formatOrderLabel,
  formatOrderTime,
  formatRoundLabel,
  orderItemCount,
  orderTotal,
  roundNumberForOrder,
  tabTotal,
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
  round,
}: {
  order: Order
  round: number
}) {
  const [expanded, setExpanded] = React.useState(false)
  const step = trackerStep(order)
  const count = orderItemCount(order)
  const total = orderTotal(order)

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
          <p className={styles.orderTitle}>{formatRoundLabel(order, round)}</p>
          <p className={styles.meta}>
            {count} {count === 1 ? "item" : "items"}
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

      <div className={styles.footer}>
        <span className={styles.total}>
          KES {total.toLocaleString()}
        </span>
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
  /** Settle the whole tab (all unpaid rounds) */
  onPayTab?: () => void
  /** Table-level call — not tied to a round */
  onCallWaiter?: () => void
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
  onPayTab,
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
  const due = React.useMemo(() => tabTotal(orders), [orders])
  const cooling = !!callWaiterDisabled

  const rounds = React.useMemo(() => {
    const newestFirst = [...orders].sort(
      (a, b) => (b.lastSentAt ?? b.createdAt) - (a.lastSentAt ?? a.createdAt)
    )
    return newestFirst.map((order) => ({
      order,
      round: roundNumberForOrder(order, orders),
    }))
  }, [orders])

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

        <div className={cn(styles.body, count > 0 && styles.bodyWithTab)}>
          <section>
            <div className={styles.sectionHeader}>
              <div className={styles.sectionHeaderLeft}>
                <ClipboardList className={styles.sectionIcon} size={16} strokeWidth={2.25} />
                <h2 className={styles.sectionLabel}>Your tab</h2>
              </div>
              <span className={styles.sectionCount}>
                {count === 0
                  ? "Nothing open"
                  : `${count} ${count === 1 ? "round" : "rounds"}`}
              </span>
            </div>
            {count === 0 ? (
              <div className={styles.empty}>
                <div className={styles.emptyIcon}>
                  <ClipboardList className="h-7 w-7" />
                </div>
                <p className={styles.emptyTitle}>No open tab</p>
                <p className={styles.emptySub}>
                  Send drinks to the bar — they&apos;ll land here until you pay once
                </p>
              </div>
            ) : (
              <div className={styles.stack}>
                {rounds.map(({ order, round }) => (
                  <ActiveOrderCard
                    key={order.orderId}
                    order={order}
                    round={round}
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
                    Completed tabs will appear here
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

        {count > 0 && (
          <div className={styles.tabFooter}>
            <div className={styles.tabDueRow}>
              <span className={styles.tabDueLabel}>Total due</span>
              <span className={styles.tabDueAmount}>
                KES {due.toLocaleString()}
              </span>
            </div>
            <div className={styles.tabActions}>
              <button
                type="button"
                className={cn(
                  styles.tabGhostBtn,
                  cooling && styles.ghostBtnCalled,
                  cooling && styles.ghostBtnDisabled
                )}
                disabled={cooling}
                onClick={() => {
                  if (cooling) return
                  onCallWaiter?.()
                }}
              >
                <Bell className="h-4 w-4" strokeWidth={2.25} />
                {callWaiterLabel ?? (cooling ? "Waiter called ✓" : "Call waiter")}
              </button>
              {onPayTab && (
                <button
                  type="button"
                  className={styles.tabPayBtn}
                  onClick={() => {
                    onPayTab()
                    setOpen(false)
                  }}
                >
                  Pay tab
                </button>
              )}
            </div>
          </div>
        )}
      </DrawerContent>
    </Drawer>
  )
}
