"use client"

import React, { useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
import {
  CheckCircle2,
  Clock,
  XCircle,
  Package,
  ArrowLeft,
  Plus,
  CreditCard,
  Banknote,
  Smartphone,
} from "lucide-react"
import { Order } from "@/types/menu"
import { orderStore } from "@/lib/orderStore"
import { cn } from "@/lib/utils"

interface OrderTrackingProps {
  orderId: string
  onClose?: () => void
  onBack?: () => void
  onAddItems?: (order: Order) => void
  onPayNow?: (order: Order) => void
}

const statusConfig: Record<
  string,
  { label: string; icon: React.ReactNode; pill: string; dot: string }
> = {
  draft: {
    label: "Draft",
    icon: <Clock className="h-3.5 w-3.5" />,
    pill: "bg-[rgba(242,232,216,0.08)] text-[rgba(242,232,216,0.65)] border-[rgba(242,232,216,0.14)]",
    dot: "bg-[rgba(242,232,216,0.65)]",
  },
  active: {
    label: "Active",
    icon: <Package className="h-3.5 w-3.5" />,
    pill: "bg-[rgba(185,138,68,0.12)] text-[#b98a44] border-[rgba(242,232,216,0.14)]",
    dot: "bg-[#b98a44]",
  },
  sent: {
    label: "Sent to Bar",
    icon: <Package className="h-3.5 w-3.5" />,
    pill: "bg-[rgba(217,132,59,0.14)] text-[#D9843B] border-[rgba(242,232,216,0.14)]",
    dot: "bg-[#D9843B] animate-pulse",
  },
  paid: {
    label: "Paid",
    icon: <CheckCircle2 className="h-3.5 w-3.5" />,
    pill: "bg-[rgba(185,138,68,0.14)] text-[#b98a44] border-[rgba(242,232,216,0.14)]",
    dot: "bg-[#b98a44]",
  },
  cancelled: {
    label: "Cancelled",
    icon: <XCircle className="h-3.5 w-3.5" />,
    pill: "bg-[rgba(94,31,31,0.25)] text-[#c07070] border-[rgba(94,31,31,0.4)]",
    dot: "bg-[#c07070]",
  },
  PENDING: {
    label: "Pending",
    icon: <Clock className="h-3.5 w-3.5" />,
    pill: "bg-[rgba(200,114,42,0.12)] text-[#D9843B] border-[rgba(200,114,42,0.25)]",
    dot: "bg-[#D9843B]",
  },
  IN_PROGRESS: {
    label: "In Progress",
    icon: <Package className="h-3.5 w-3.5" />,
    pill: "bg-[rgba(185,138,68,0.12)] text-[#b98a44] border-[rgba(242,232,216,0.14)]",
    dot: "bg-[#b98a44]",
  },
  RECEIVED: {
    label: "Received",
    icon: <CheckCircle2 className="h-3.5 w-3.5" />,
    pill: "bg-[rgba(185,138,68,0.14)] text-[#b98a44] border-[rgba(242,232,216,0.14)]",
    dot: "bg-[#b98a44]",
  },
  CANCELLED: {
    label: "Cancelled",
    icon: <XCircle className="h-3.5 w-3.5" />,
    pill: "bg-[rgba(94,31,31,0.25)] text-[#c07070] border-[rgba(94,31,31,0.4)]",
    dot: "bg-[#c07070]",
  },
}

export function OrderTracking({
  orderId,
  onClose,
  onBack,
  onAddItems,
  onPayNow,
}: OrderTrackingProps) {
  const [order, setOrder] = useState<Order | null>(null)

  useEffect(() => {
    const update = () => setOrder(orderStore.getOrder(orderId) || null)
    update()
    return orderStore.subscribe(update)
  }, [orderId])

  if (!order) {
    return (
      <div className="rounded-[1.15rem] bg-[#261E17] border border-[rgba(242,232,216,0.14)] p-8 text-center">
        <p className="text-[rgba(242,232,216,0.65)] text-sm">Order not found</p>
      </div>
    )
  }

  const status = statusConfig[order.status] ?? statusConfig.draft
  const isUnpaid = order.paymentStatus === "UNPAID"
  const isCashOrder = order.paymentMethod === "cash"
  const orderSubtotal = order.items.reduce((s, i) => s + i.unitPrice * i.quantity, 0)
  const orderTotal = orderSubtotal

  return (
    <div className="rounded-[1.15rem] bg-[#261E17] border border-[rgba(242,232,216,0.14)] overflow-hidden">
      {/* Status banner */}
      <div className="px-5 pt-5 pb-4 border-b border-[rgba(242,232,216,0.14)]">
        {(onBack || onClose) && (
          <button
            onClick={onBack || onClose}
            className="flex items-center gap-1.5 text-[rgba(242,232,216,0.65)] hover:text-[rgba(242,232,216,0.8)] text-sm mb-4 transition-colors duration-500"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
        )}

        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[#b98a44] text-[10px] font-semibold uppercase tracking-[0.18em] mb-1">
              Order ID
            </p>
            <p className="text-[#F5EBDC] font-mono text-sm font-bold">
              #{order.orderId.slice(-10)}
            </p>
          </div>
          <span
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[12px] font-semibold border",
              status.pill
            )}
          >
            <span className={cn("h-1.5 w-1.5 rounded-full flex-shrink-0", status.dot)} />
            {status.label}
          </span>
        </div>

        {order.staffEditedAt ? (
          <div
            role="status"
            className="mt-4 rounded-xl border border-[rgba(217,132,59,0.35)] bg-[rgba(217,132,59,0.12)] px-3 py-2.5 text-[12px] text-[#F5EBDC] leading-snug"
          >
            <p className="font-semibold text-[#D9843B] mb-0.5">Updated by staff</p>
            <p className="text-[rgba(242,232,216,0.8)]">
              {order.staffEditNotice ||
                "Staff changed your order. Review items and total below."}
            </p>
          </div>
        ) : null}
      </div>

      {/* Info grid */}
      <div className="px-5 py-4 grid grid-cols-3 gap-3 border-b border-[rgba(242,232,216,0.14)]">
        <div>
          <p className="text-[rgba(242,232,216,0.65)] text-[10px] font-semibold uppercase tracking-wider mb-1">Table</p>
          <p className="text-[#F5EBDC] font-bold text-sm">#{order.tableId}</p>
        </div>
        <div>
          <p className="text-[rgba(242,232,216,0.65)] text-[10px] font-semibold uppercase tracking-wider mb-1">Total</p>
          <p className="text-[#D9843B] font-bold text-sm tabular-nums">KES {orderTotal.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
        </div>
        <div>
          <p className="text-[rgba(242,232,216,0.65)] text-[10px] font-semibold uppercase tracking-wider mb-1">Payment</p>
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "font-bold text-sm",
                order.paymentStatus === "PAID" ? "text-[#b98a44]" : "text-[#D9843B]"
              )}
            >
              {order.paymentStatus === "PAID" ? "PAID" : "NOT PAID"}
            </span>
            {order.paymentStatus !== "PAID" && order.paymentMethod === "cash" && (
              <span className="text-[rgba(242,232,216,0.65)] text-xs">· Cash</span>
            )}
          </div>
        </div>
      </div>

      {/* Payment method banner — explicit NOT PAID + Pay via M-Pesa option */}
      {order.paymentMethod === "cash" && order.paymentStatus !== "PAID" && (
        <div className="mx-5 mt-4 space-y-3">
          <div className="p-3.5 rounded-2xl bg-[rgba(217,132,59,0.1)] border border-[rgba(242,232,216,0.14)] flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Banknote className="h-5 w-5 text-[#D9843B] flex-shrink-0" />
              <div>
                <p className="text-[#D9843B] text-sm font-bold">Pay at the Teller</p>
                <p className="text-[rgba(242,232,216,0.65)] text-xs mt-0.5">Please have KES {orderTotal.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ready</p>
              </div>
            </div>
            <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-[rgba(217,132,59,0.2)] text-[#D9843B] border border-[rgba(242,232,216,0.14)] shrink-0">
              NOT PAID
            </span>
          </div>
          {onPayNow && (
            <button
              onClick={() => onPayNow(order)}
              className="w-full h-11 rounded-xl font-semibold text-sm bg-[rgba(185,138,68,0.12)] border border-[rgba(242,232,216,0.14)] hover:bg-[rgba(185,138,68,0.18)] text-[#b98a44] flex items-center justify-center gap-2 active:scale-[0.98] transition-all duration-500"
            >
              <Smartphone className="h-4 w-4" strokeWidth={2.5} />
              Pay via M-Pesa · KES {orderTotal.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </button>
          )}
        </div>
      )}
      {order.paymentMethod === "mpesa" && order.paymentStatus === "PAID" && (
        <div className="mx-5 mt-4 p-3.5 rounded-2xl bg-[rgba(185,138,68,0.1)] border border-[rgba(242,232,216,0.14)] flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Smartphone className="h-5 w-5 text-[#b98a44] flex-shrink-0" />
            <div>
              <p className="text-[#b98a44] text-sm font-bold">Paid via M-Pesa ✓</p>
              {(order as any).mpesaReceiptNumber && (
                <p className="text-[rgba(185,138,68,0.65)] text-xs font-mono mt-0.5 tracking-wider">
                  Receipt: {(order as any).mpesaReceiptNumber}
                </p>
              )}
            </div>
          </div>
          {(order as any).mpesaReceiptNumber && (
            <span className="text-[#b98a44] font-mono text-xs font-bold bg-[rgba(185,138,68,0.18)] px-2.5 py-1 rounded-full border border-[rgba(242,232,216,0.14)] shrink-0">
              {(order as any).mpesaReceiptNumber}
            </span>
          )}
        </div>
      )}

      {/* Items list */}
      <div className="px-5 py-4 border-b border-[rgba(242,232,216,0.14)]">
        <p className="text-[#b98a44] text-[10px] font-semibold uppercase tracking-[0.18em] mb-3">Items</p>
        <div className="space-y-2">
          {order.items.map((item, idx) => (
            <div key={idx} className="flex justify-between items-center">
              <span className="text-[rgba(242,232,216,0.65)] text-sm">
                <span className="font-semibold text-[#F5EBDC]">{item.quantity}×</span>{" "}
                {item.name}
              </span>
              <span className="text-[rgba(242,232,216,0.65)] text-sm font-semibold tabular-nums">
                KES {(item.unitPrice * item.quantity).toLocaleString()}
              </span>
            </div>
          ))}
        </div>
        {/* Totals */}
        <div className="mt-4 rounded-xl bg-[#382C21] border border-[rgba(242,232,216,0.14)] overflow-hidden">
          <div className="flex justify-between items-center px-3 py-2 border-b border-[rgba(242,232,216,0.10)]">
            <span className="text-[rgba(242,232,216,0.65)] text-sm">Subtotal</span>
            <span className="text-[rgba(242,232,216,0.65)] text-sm font-semibold tabular-nums">KES {orderSubtotal.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
          <div className="flex justify-between items-center px-3 py-2.5">
            <span className="text-[#F5EBDC] text-sm font-bold">Total</span>
            <span className="text-[#D9843B] text-base font-extrabold tabular-nums">KES {orderTotal.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
        </div>
      </div>

      {/* Success banner */}
      {order.status === "RECEIVED" && (
        <div className="mx-5 my-4 p-4 rounded-2xl bg-[rgba(185,138,68,0.1)] border border-[rgba(242,232,216,0.14)] flex items-center gap-3">
          <CheckCircle2 className="h-5 w-5 text-[#b98a44] flex-shrink-0" />
          <p className="text-[#b98a44] text-sm font-semibold">Your order has been received!</p>
        </div>
      )}

      {/* Actions */}
      {(isUnpaid || onAddItems) && (
        <div className="px-5 pb-5 pt-3 flex flex-col gap-2">
          {isUnpaid && !isCashOrder && onPayNow && (
            <button
              onClick={() => onPayNow(order)}
              className="w-full h-12 rounded-xl font-bold text-[14px] bg-gradient-to-r from-[#c8722a] to-[#e09040] text-[#412402] flex items-center justify-center gap-2 active:scale-[0.98] transition-all duration-500 shadow-[0_8px_24px_rgba(200,114,42,0.28)]"
            >
              <CreditCard className="h-4 w-4" strokeWidth={2.5} />
              Pay Now · KES {orderTotal.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </button>
          )}
          {onAddItems && (
            <button
              onClick={() => onAddItems(order)}
              className="w-full h-11 rounded-xl text-sm font-semibold text-[rgba(242,232,216,0.65)] bg-[#261E17] hover:bg-[#382C21] border border-[rgba(242,232,216,0.14)] transition-colors duration-500 flex items-center justify-center gap-1.5"
            >
              <Plus className="h-4 w-4" />
              Add More Items
            </button>
          )}
        </div>
      )}
    </div>
  )
}
