"use client"

import { useState } from "react"
import { Printer, MoreVertical, Wallet2, Eye, Edit2, Plus, Trash2, RefreshCw, CheckCircle2 } from "lucide-react"
import { formatMoneyKsh, formatTime, getStatusLabel } from "@/lib/order-utils"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

interface OrderItem {
  name: string
  quantity: number
  price: number
}

interface Order {
  id: string
  timestamp: Date | string
  status: string
  paymentStatus?: string
  items: OrderItem[]
  total: number | null
  customerName?: string
  customerPhone?: string | null
  paymentMethod?: string | null
  orderSource?: "menu" | "pos" | "online" | null
  balanceDue?: number | null
  amountReceived?: number | null
  paymentReceiptSmsStatus?: string | null
  servedAt?: string | Date | null
  table?: string | number | null
}

interface OrderCardMobileProps<T = any> {
  order: Order
  originalOrder?: T
  onView: (order: T) => void
  onPrint: (order: T) => void
  onDelete?: (order: T) => void
  onPay?: (order: T) => void
  onServe?: (order: T) => void
  onEdit?: (order: T) => void
  onAddItems?: (order: T) => void
  onResendMessage?: (order: T) => void
}

function PaymentChip({ method }: { method: string | null }) {
  const label = !method ? "—" : method.toLowerCase() === "mpesa" ? "M-Pesa" : method.charAt(0).toUpperCase() + method.slice(1)
  return (
    <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium bg-[#f1f5f9] text-[#64748b]">
      {label}
    </span>
  )
}

function StatusPill({ status }: { status: string }) {
  const config: Record<string, { bg: string; text: string }> = {
    PAID: { bg: "bg-emerald-50", text: "text-emerald-700" },
    OVERPAID: { bg: "bg-violet-50", text: "text-violet-800" },
    PARTIALLY_PAID: { bg: "bg-amber-50", text: "text-amber-700" },
    NOT_PAID: { bg: "bg-red-50", text: "text-red-700" },
  }
  const cfg = config[status] || { bg: "bg-slate-100", text: "text-slate-600" }
  const label =
    status === "NOT_PAID"
      ? "Not paid"
      : status === "PARTIALLY_PAID"
        ? "Partially paid"
        : status === "OVERPAID"
          ? "Overpaid"
          : "Paid"
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ${cfg.bg} ${cfg.text}`}>
      {label}
    </span>
  )
}

export function OrderCardMobile<T = any>({
  order,
  originalOrder,
  onView,
  onPrint,
  onDelete,
  onPay,
  onServe,
  onEdit,
  onAddItems,
  onResendMessage,
}: OrderCardMobileProps<T>) {
  const [moreOpen, setMoreOpen] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const status = getStatusLabel(order.paymentStatus || order.status)
  const messageSent = String(order.paymentReceiptSmsStatus || "").toUpperCase() === "SENT"
  const callbackOrder = (originalOrder ?? order) as T
  const customerDisplay = order.customerPhone || order.customerName || "Walk-in"
  const safeItems = Array.isArray(order.items) ? order.items : []
  const itemSummary = safeItems
    .slice(0, 2)
    .map((i) => `${i.quantity}x ${i.name}`)
    .join(" · ")
  const hasMoreItems = safeItems.length > 2
  const isServedWaitingPayment =
    Boolean(order.servedAt) && (status === "NOT_PAID" || status === "PARTIALLY_PAID")
  const tableLabel =
    order.table != null && String(order.table).trim() && String(order.table).trim() !== "—"
      ? String(order.table).replace(/^table\s*/i, "").trim()
      : null

  const handleDelete = () => {
    setMoreOpen(false)
    setShowDeleteConfirm(true)
  }

  const confirmDelete = () => {
    onDelete?.(callbackOrder)
    setShowDeleteConfirm(false)
  }

  return (
    <>
      <div className="bg-white rounded-xl border border-[#e5e7eb] shadow-sm overflow-hidden">
        {/* Row 1: Order ID + time */}
        <div className="flex items-center justify-between px-4 pt-3 pb-1 gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {tableLabel && (
              <span className="inline-flex items-center rounded-md bg-[#0f172a] text-white text-xs font-bold px-2 py-0.5 shrink-0">
                T{tableLabel}
              </span>
            )}
            <span className="font-mono text-sm font-semibold text-[#0f172a] truncate">#{order.id}</span>
          </div>
          <span className="text-xs text-[#64748b] shrink-0">{formatTime(order.timestamp)}</span>
        </div>
        {/* Row 2: Customer + status + source */}
        <div className="flex items-center justify-between gap-2 px-4 pb-2">
          <span className="text-xs text-[#475569] truncate max-w-[100px]">{customerDisplay}</span>
          <div className="flex items-center gap-1.5 shrink-0">
            {order.orderSource && (
              <span className={`inline-flex px-1.5 py-0.5 rounded text-[9px] font-semibold ${
                order.orderSource === "menu" ? "bg-amber-100 text-amber-800" :
                order.orderSource === "online" ? "bg-blue-100 text-blue-800" :
                "bg-slate-100 text-slate-600"
              }`}>
                {order.orderSource === "menu" ? "Menu" : order.orderSource === "online" ? "Online" : "POS"}
              </span>
            )}
            {isServedWaitingPayment && (
              <span className="inline-flex px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-orange-100 text-orange-800">
                Served
              </span>
            )}
            <StatusPill status={status} />
          </div>
        </div>
        {/* Row 3: Item summary */}
        <div className="px-4 pb-2">
          <p className="text-xs text-[#94a3b8] truncate">
            {itemSummary}
            {hasMoreItems && ` +${safeItems.length - 2} more`}
          </p>
        </div>
        {/* Row 4: Total + payment chip */}
        <div className="flex items-center justify-between gap-2 px-4 pb-3">
          <div className="min-w-0">
            <span className="text-base font-bold text-[#0f172a] tabular-nums block">
              {formatMoneyKsh(order.total)}
            </span>
            {status === "PARTIALLY_PAID" && (
              <p className="text-[10px] text-amber-700 font-medium mt-0.5">
                Paid {formatMoneyKsh(order.amountReceived ?? 0)} · Balance{" "}
                {formatMoneyKsh(
                  order.balanceDue != null && Number.isFinite(Number(order.balanceDue))
                    ? Number(order.balanceDue)
                    : Math.max(0, (order.total ?? 0) - (order.amountReceived ?? 0))
                )}
              </p>
            )}
          </div>
          <PaymentChip method={order.paymentMethod ?? null} />
        </div>
        <div className="px-4 pb-3">
          <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${messageSent ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
            Message: {messageSent ? "Sent" : "Not sent"}
          </span>
        </div>

        <div className="h-px bg-[#e5e7eb]" />

        {/* Actions row */}
        <div className="flex items-center gap-2 px-4 py-3 bg-[#f8fafc]/50">
          {onServe && (status === "NOT_PAID" || status === "PARTIALLY_PAID") && !order.servedAt && (
            <Button
              size="sm"
              className="flex-1 h-9 bg-orange-500 hover:bg-orange-600 text-white font-semibold text-sm"
              onClick={() => onServe(callbackOrder)}
            >
              <CheckCircle2 className="h-4 w-4 mr-2" />
              Served
            </Button>
          )}
          {(status === "NOT_PAID" || status === "PARTIALLY_PAID") && onPay && (
            <Button
              size="sm"
              variant={onServe && !order.servedAt ? "outline" : "default"}
              className={
                onServe && !order.servedAt
                  ? "flex-1 h-9 font-semibold text-sm border-[#e5e7eb]"
                  : "flex-1 h-9 bg-primary hover:bg-primary/90 text-white font-semibold text-sm"
              }
              onClick={() => onPay(callbackOrder)}
            >
              <Wallet2 className="h-4 w-4 mr-2" />
              Pay
            </Button>
          )}
          {(status === "PAID" || status === "OVERPAID") && (
            <Button
              size="sm"
              variant="default"
              className="flex-1 h-9 bg-primary hover:bg-primary/90 text-white font-semibold text-sm"
              onClick={() => onView(callbackOrder)}
            >
              <Eye className="h-4 w-4 mr-2" />
              View
            </Button>
          )}
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9 shrink-0 border-[#e5e7eb]"
            onClick={() => onPrint(callbackOrder)}
          >
            <Printer className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9 shrink-0 border-[#e5e7eb]"
            onClick={() => setMoreOpen(true)}
          >
            <MoreVertical className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* More actions bottom sheet */}
      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="rounded-t-2xl h-auto max-h-[70vh] pt-12">
          <SheetHeader className="text-left pb-2">
            <SheetTitle className="text-base">Order #{order.id}</SheetTitle>
          </SheetHeader>
          <div className="space-y-1 py-2">
            <Button
              variant="ghost"
              className="w-full justify-start gap-3 h-12 text-[#0f172a]"
              onClick={() => {
                setMoreOpen(false)
                onView(callbackOrder)
              }}
            >
              <Eye className="h-4 w-4" />
              View full order
            </Button>
            <Button
              variant="ghost"
              className="w-full justify-start gap-3 h-12 text-[#0f172a]"
              onClick={() => {
                setMoreOpen(false)
                onPrint(callbackOrder)
              }}
            >
              <Printer className="h-4 w-4" />
              Print receipt
            </Button>
            {onEdit && (
              <Button
                variant="ghost"
                className="w-full justify-start gap-3 h-12 text-[#0f172a]"
                onClick={() => {
                  setMoreOpen(false)
                  onEdit(callbackOrder)
                }}
              >
                <Edit2 className="h-4 w-4" />
                Edit order
              </Button>
            )}
            {onResendMessage && (
              <Button
                variant="ghost"
                className="w-full justify-start gap-3 h-12 text-[#0f172a]"
                onClick={() => {
                  setMoreOpen(false)
                  onResendMessage(callbackOrder)
                }}
              >
                <RefreshCw className="h-4 w-4" />
                Resend SMS
              </Button>
            )}
            {onAddItems && (
              <Button
                variant="ghost"
                className="w-full justify-start gap-3 h-12 text-[#0f172a]"
                onClick={() => {
                  setMoreOpen(false)
                  onAddItems(callbackOrder)
                }}
              >
                <Plus className="h-4 w-4" />
                Add items
              </Button>
            )}
            {onDelete && (
              <>
                <div className="h-px bg-[#e5e7eb] my-2" />
                <Button
                  variant="ghost"
                  className="w-full justify-start gap-3 h-12 text-[#dc2626] hover:text-[#dc2626] hover:bg-red-50"
                  onClick={handleDelete}
                >
                  <Trash2 className="h-4 w-4" />
                  Delete order
                </Button>
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete order?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete order #{order.id}? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-[#dc2626] hover:bg-[#b91c1c]">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
