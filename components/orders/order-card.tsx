"use client"

import { useState } from "react"
import { CheckSquare, Square, Eye, Printer, Trash2, Wallet2, Edit2, Plus, MoreVertical, RefreshCw, CheckCircle2 } from "lucide-react"
import { StatusBadge } from "./status-badge"
import { PaymentBadge } from "./payment-badge"
import { ActionButton } from "./action-button"
import { OrderMetaRow } from "./order-meta-row"
import { formatMoneyKsh, formatTime, getStatusLabel } from "@/lib/order-utils"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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

interface OrderServer {
  id?: string
  name?: string
}

interface Order {
  id: string
  timestamp: Date | string
  status: string
  paymentStatus?: string
  items: OrderItem[]
  subtotal: number | null
  vat: number | null
  total: number | null
  customerName?: string
  customerPhone?: string | null
  paymentMethod?: string | null
  amountReceived?: number | null
  /** From API: remaining balance for M-Pesa partial pay */
  balanceDue?: number | null
  paymentReceiptSmsStatus?: string | null
  paymentReceiptSmsSentAt?: Date | string | null
  receiptCode?: string | null
  server?: OrderServer | null
  waiter?: string
  cashier?: string
  orderSource?: "menu" | "pos" | "online" | null
  servedAt?: string | Date | null
  table?: string | number | null
}

interface OrderCardProps<T = any> {
  order: Order
  originalOrder?: T
  isSelected: boolean
  onSelect: (id: string) => void
  onView: (order: T) => void
  onPrint: (order: T) => void
  onDelete?: (order: T) => void
  onPay?: (order: T) => void
  onServe?: (order: T) => void
  onEdit?: (order: T) => void
  onAddItems?: (order: T) => void
  onResendMessage?: (order: T) => void
}

export function OrderCard<T = any>({
  order,
  originalOrder,
  isSelected,
  onSelect,
  onView,
  onPrint,
  onDelete,
  onPay,
  onServe,
  onEdit,
  onAddItems,
  onResendMessage,
}: OrderCardProps<T>) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const status = getStatusLabel(order.paymentStatus || order.status)
  const messageStatus = String(order.paymentReceiptSmsStatus || "").toUpperCase()
  const messageSent = messageStatus === "SENT"
  const serverName = order.server?.name || order.waiter || order.cashier || "—"
  const customerDisplay = order.customerPhone || order.customerName || "—"
  const displayItems = (Array.isArray(order.items) ? order.items : []).slice(0, 2)
  const remainingItems = (Array.isArray(order.items) ? order.items : []).length - 2
  const isServedWaitingPayment =
    Boolean(order.servedAt) && (status === "NOT_PAID" || status === "PARTIALLY_PAID")
  const tableLabel =
    order.table != null && String(order.table).trim() && String(order.table).trim() !== "—"
      ? String(order.table).replace(/^table\s*/i, "").trim()
      : null
  
  // Use originalOrder for callbacks if provided, otherwise use order
  const callbackOrder = (originalOrder ?? order) as T

  const handleDelete = () => {
    setShowDeleteConfirm(true)
  }

  const confirmDelete = () => {
    onDelete?.(callbackOrder)
    setShowDeleteConfirm(false)
  }

  return (
    <>
      <div className="group relative bg-white border border-[#e5e7eb] rounded-xl sm:rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.1)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.15)] transition-all duration-200 hover:-translate-y-0.5 overflow-hidden">
        {/* Status indicator bar (left side) */}
        {status === "PAID" && <div className="absolute top-0 left-0 bottom-0 w-1 bg-[#16a34a]" />}
        {status === "OVERPAID" && <div className="absolute top-0 left-0 bottom-0 w-1 bg-[#7c3aed]" />}
        {status === "PARTIALLY_PAID" && <div className="absolute top-0 left-0 bottom-0 w-1 bg-[#f59e0b]" />}
        {status === "NOT_PAID" && <div className="absolute top-0 left-0 bottom-0 w-1 bg-[#ef4444]" />}

        {/* 1) Header row */}
        <div className="px-3 sm:px-5 pt-3 sm:pt-5 pb-2.5 sm:pb-4 border-b border-[#e5e7eb]">
          <div className="flex items-center justify-between mb-2 sm:mb-3">
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              <button
                onClick={() => onSelect(order.id)}
                className="p-0.5 rounded hover:bg-gray-100 transition-colors shrink-0"
              >
                {isSelected ? (
                  <CheckSquare className="h-4 w-4 text-[#2563eb]" />
                ) : (
                  <Square className="h-4 w-4 text-[#64748b]" />
                )}
              </button>
              {tableLabel && (
                <span className="inline-flex items-center rounded-lg bg-[#0f172a] text-white text-xs sm:text-sm font-bold px-2.5 py-1 shrink-0 tracking-wide">
                  T{tableLabel}
                </span>
              )}
              <span className="font-mono text-xs sm:text-sm font-semibold text-[#0f172a] truncate">#{order.id}</span>
            </div>
            <span className="text-[10px] sm:text-xs text-[#64748b] font-medium shrink-0">{formatTime(order.timestamp)}</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <StatusBadge status={status} />
            {isServedWaitingPayment && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-orange-100 text-orange-800">
                <span className="h-1.5 w-1.5 rounded-full bg-orange-500" />
                Served · waiting payment
              </span>
            )}
            {order.orderSource && (
              <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                order.orderSource === "menu" ? "bg-amber-100 text-amber-800" :
                order.orderSource === "online" ? "bg-blue-100 text-blue-800" :
                "bg-slate-100 text-slate-600"
              }`}>
                {order.orderSource === "menu" ? "Menu" : order.orderSource === "online" ? "Online" : "POS"}
              </span>
            )}
          </div>
        </div>

        {/* 2) Item preview */}
        <div className="px-3 sm:px-5 py-2.5 sm:py-4 space-y-0.5 sm:space-y-1">
          {displayItems.length > 0 ? (
            <>
              {displayItems.map((item, idx) => (
                <div key={idx} className="text-xs sm:text-sm text-[#0f172a] truncate">
                  {item.quantity}x {item.name}
                </div>
              ))}
              {remainingItems > 0 && (
                <div className="text-[10px] sm:text-xs text-[#64748b]">+{remainingItems} more items</div>
              )}
            </>
          ) : (
            <div className="text-xs sm:text-sm text-[#64748b]">No items</div>
          )}
        </div>

        {/* 3) Amount block - THE STAR */}
        <div className="px-3 sm:px-5 pb-2.5 sm:pb-4 border-b border-[#e5e7eb]">
          <div className="mb-1 sm:mb-1.5">
            <div className="text-lg sm:text-[22px] font-bold text-[#0f172a] leading-none tabular-nums">
              {formatMoneyKsh(order.total)}
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3 text-[10px] sm:text-xs text-[#64748b]">
            <span>Subtotal: {formatMoneyKsh(order.subtotal)}</span>
            <span>•</span>
            <span>VAT: {formatMoneyKsh(order.vat)}</span>
          </div>
          {(status === "NOT_PAID" || status === "PARTIALLY_PAID") && order.total && (
            <div className="mt-1 sm:mt-1.5 text-[10px] sm:text-xs text-[#64748b]">
              Due:{" "}
              {formatMoneyKsh(
                order.balanceDue != null && Number.isFinite(Number(order.balanceDue))
                  ? Number(order.balanceDue)
                  : status === "PARTIALLY_PAID" && order.amountReceived != null
                    ? Math.max(0, (order.total ?? 0) - (order.amountReceived ?? 0))
                    : order.total
              )}
            </div>
          )}
        </div>

        {/* 4) Meta rows */}
        <div className="px-3 sm:px-5 py-2.5 sm:py-4 space-y-1.5 sm:space-y-2 border-b border-[#e5e7eb]">
          <OrderMetaRow
            left="Customer:"
            right={
              <span className={`truncate max-w-[100px] sm:max-w-[120px] ${order.customerPhone ? 'font-mono text-[10px] sm:text-xs' : ''}`} title={customerDisplay}>
                {customerDisplay}
              </span>
            }
          />
          <OrderMetaRow
            left="Payment:"
            right={<PaymentBadge method={order.paymentMethod} />}
          />
          <OrderMetaRow
            left="Message:"
            right={
              <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${messageSent ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                {messageSent ? "Sent" : "Not sent"}
              </span>
            }
          />
          <OrderMetaRow
            left="Server:"
            right={
              <span className="truncate max-w-[100px] sm:max-w-[120px]" title={serverName}>
                {serverName}
              </span>
            }
          />
          {(status === "PAID" || status === "PARTIALLY_PAID") && order.amountReceived != null && order.amountReceived > 0 && (
            <OrderMetaRow
              left="Received:"
              right={formatMoneyKsh(order.amountReceived)}
            />
          )}
          {order.receiptCode && (
            <OrderMetaRow
              left="Receipt #:"
              right={
                <span className="font-mono font-bold text-[#10b981] tracking-wider">
                  {order.receiptCode}
                </span>
              }
            />
          )}
        </div>

        {/* 5) Actions */}
        <div className="px-3 sm:px-5 py-2.5 sm:py-4 bg-[#f8fafc]">
          <div className="flex items-center gap-1.5 sm:gap-2">
            {onServe && (status === "NOT_PAID" || status === "PARTIALLY_PAID") && !order.servedAt && (
              <Button
                type="button"
                onClick={() => onServe(callbackOrder)}
                className="flex-1 h-8 sm:h-10 text-xs sm:text-sm rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-semibold"
              >
                <CheckCircle2 className="h-4 w-4 mr-1.5" />
                Served
              </Button>
            )}
            {(status === "NOT_PAID" || status === "PARTIALLY_PAID") && onPay && (
              <ActionButton
                variant={onServe && !order.servedAt ? "secondary" : "primary"}
                icon={Wallet2}
                onClick={() => onPay(callbackOrder)}
                className="flex-1 h-8 sm:h-10 text-xs sm:text-sm"
              >
                Pay
              </ActionButton>
            )}
            {(status === "PAID" || status === "OVERPAID") && (
              <ActionButton
                variant="primary"
                icon={Eye}
                onClick={() => onView(callbackOrder)}
                className="flex-1 h-8 sm:h-10 text-xs sm:text-sm"
              >
                View
              </ActionButton>
            )}
            <ActionButton
              variant="secondary"
              icon={Printer}
              onClick={() => onPrint(callbackOrder)}
              className="h-8 sm:h-10 text-xs sm:text-sm px-2 sm:px-3"
            >
              <span className="hidden sm:inline">Print</span>
            </ActionButton>
            {(status === "PAID" || status === "OVERPAID") && (
              <ActionButton
                variant="secondary"
                icon={Eye}
                onClick={() => onView(callbackOrder)}
                className="h-8 sm:h-10 text-xs sm:text-sm hidden sm:flex"
              >
                View
              </ActionButton>
            )}
            {(onEdit || onAddItems || onResendMessage) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 w-8 sm:h-10 sm:w-10 rounded-lg sm:rounded-xl border-[#e5e7eb] text-[#0f172a] hover:bg-[#f3f4f6] p-0"
                  >
                    <MoreVertical className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {onResendMessage && (
                    <DropdownMenuItem onClick={() => onResendMessage(callbackOrder)}>
                      <RefreshCw className="h-4 w-4 mr-2" />
                      Resend SMS
                    </DropdownMenuItem>
                  )}
                  {onEdit && (
                    <DropdownMenuItem onClick={() => onEdit(callbackOrder)}>
                      <Edit2 className="h-4 w-4 mr-2" />
                      Edit Order
                    </DropdownMenuItem>
                  )}
                  {onAddItems && (
                    <DropdownMenuItem onClick={() => onAddItems(callbackOrder)}>
                      <Plus className="h-4 w-4 mr-2" />
                      Add Items
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {onDelete && (
              <ActionButton
                variant="danger"
                icon={Trash2}
                onClick={handleDelete}
                className="h-8 w-8 sm:h-10 sm:w-10 p-0"
              >
                <span className="sr-only">Delete</span>
              </ActionButton>
            )}
          </div>
        </div>
      </div>

      {/* Delete confirmation dialog */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Order?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete order #{order.id}? This action cannot be undone.
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
