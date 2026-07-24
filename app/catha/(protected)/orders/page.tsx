 "use client"

import { useState, useEffect, useCallback, useRef, useMemo } from "react"

import { Header } from "@/components/layout/header"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { type Transaction } from "@/lib/dummy-data"
import { Receipt, Download, TrendingUp, ShoppingBag, Wallet2, Edit2, Plus, CheckSquare, Square, Search, X, Minus, Eye, Trash2, Banknote, Smartphone, Users, Printer, LayoutGrid, TableIcon, Filter, MoreVertical, UtensilsCrossed, ShoppingCart, CheckCircle2, Loader2, Truck, RefreshCw, ChevronLeft, ChevronRight, CreditCard, XCircle, AlertTriangle } from "lucide-react"
import { normalizeKenyaPhone, getPhoneValidationError } from "@/lib/phone-utils"
import { normalizeMpesaStatus } from "@/lib/mpesa-status"
import { toast } from "sonner"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { products } from "@/lib/dummy-data"
import { useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { useCathaPermissions } from "@/hooks/use-catha-permissions"
import { OrderCard } from "@/components/orders/order-card"
import { OrderCardMobile } from "@/components/orders/order-card-mobile"
import { UserChip } from "@/components/orders/user-chip"
import { getStatusLabel } from "@/lib/order-utils"
import { ReceiptModal, type ReceiptOrder } from "@/components/receipt"
import { summarizeCathaOrderPayments } from "@/lib/catha-order-payments"
import { canManageOrderMpesaPayments, canManuallyAddMpesaTransaction, normalizePermissions } from "@/lib/catha-permissions-model"
import type { OrdersDashboardSummary } from "@/lib/catha-orders-dashboard-summary"
import { Textarea } from "@/components/ui/textarea"

const ORDERS_PAGE_SIZE = 72

function menuOrderSource(tx: Transaction): "menu" | "pos" | string {
  return (
    (tx as any).orderSource ||
    ((tx as any).cashier === "Customer" && (tx as any).customerPhone ? "menu" : "pos")
  )
}

function isMenuUnpaid(tx: Transaction): boolean {
  if (tx.status === "completed" || tx.status === "cancelled") return false
  const pay = String((tx as any).paymentStatus || tx.status || "").toUpperCase()
  return pay !== "PAID" && pay !== "COMPLETED" && pay !== "OVERPAID"
}

/** Needs Accept — highest pin priority. */
function isUnacceptedMenuOrder(tx: Transaction): boolean {
  const waiter = (tx as any).waiter as string | undefined
  return (
    isMenuUnpaid(tx) &&
    menuOrderSource(tx) === "menu" &&
    (!waiter || waiter === "Customer")
  )
}

/** Accepted, waiting for Served click — stay pinned until served. */
function isAwaitingServeMenuOrder(tx: Transaction): boolean {
  const waiter = (tx as any).waiter as string | undefined
  const servedAt = (tx as any).servedAt
  return (
    isMenuUnpaid(tx) &&
    menuOrderSource(tx) === "menu" &&
    !!waiter &&
    waiter !== "Customer" &&
    !servedAt
  )
}

/** 2 = needs Accept, 1 = needs Served, 0 = normal */
function menuAttentionRank(tx: Transaction): number {
  if (isUnacceptedMenuOrder(tx)) return 2
  if (isAwaitingServeMenuOrder(tx)) return 1
  return 0
}

function sortOrdersUnacceptedFirst(list: Transaction[]): Transaction[] {
  return list.slice().sort((a, b) => {
    const aTop = menuAttentionRank(a)
    const bTop = menuAttentionRank(b)
    if (aTop !== bTop) return bTop - aTop
    const at = a.timestamp instanceof Date ? a.timestamp.getTime() : new Date(a.timestamp as any).getTime()
    const bt = b.timestamp instanceof Date ? b.timestamp.getTime() : new Date(b.timestamp as any).getTime()
    return (Number.isFinite(bt) ? bt : 0) - (Number.isFinite(at) ? at : 0)
  })
}

function formatTableLabel(table: unknown): string | null {
  if (table == null || table === "") return null
  const s = String(table).trim()
  if (!s || s === "—") return null
  return s.replace(/^table\s*/i, "")
}

function linkedMpesaPaymentTitle(p: { linkSource?: string | null }) {
  if (p.linkSource === "manual") return "Manual M-Pesa Transaction Added"
  if (p.linkSource === "automatic") return "Payment linked automatically"
  return "M-Pesa payment linked"
}

type ManualTxLookup =
  | { status: "invalid"; transactionCode: string }
  | {
      status: "already_linked"
      transactionCode: string
      orderId: string
      amount: number
      linkedBy: string
      linkedAt: string
      linkSource?: string | null
      orderTable?: number | null
      customerName?: string | null
    }
  | {
      status: "exists_unlinked"
      transactionCode: string
      transactionId: string
      amount: number
      phoneMasked: string | null
      receivedAt: string
      remainingUnallocated: number
      allocatedTotal?: number
      transactionType?: string | null
      importedFromSafaricom?: boolean
    }
  | { status: "not_found"; transactionCode: string }

function formatLookupWhen(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  const now = new Date()
  const time = d.toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" })
  if (d.toDateString() === now.toDateString()) return `Today ${time}`
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday ${time}`
  return d.toLocaleString("en-KE", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function patchOrderFromMpesaLinkResponse(data: any) {
  if (!data?.summary) return {}
  const ps = data.summary.paymentStatus as string
  const settled = ps === "PAID" || ps === "OVERPAID"
  const patch: Record<string, unknown> = {
    linkedPayments: data.linkedPayments ?? [],
    totalLinkedPayments: data.summary.totalLinkedPayments,
    balanceDue: data.summary.balanceDue,
    overpaymentAmount: data.summary.overpaymentAmount,
    paymentStatus:
      ps === "PAID"
        ? "PAID"
        : ps === "OVERPAID"
          ? "OVERPAID"
          : ps === "PARTIALLY_PAID"
            ? "PARTIALLY_PAID"
            : "NOT_PAID",
    status: settled ? "completed" : "pending",
    mpesaReceiptNumber: data.mpesaReceiptNumber ?? null,
    mpesaTransactionId: data.transactionId ?? null,
    paymentMethod: "mpesa",
    linkedAt: data.linkedAt ? new Date(data.linkedAt) : null,
    linkedBy: data.linkedBy ?? null,
  }
  // Keep customerPhone from existing order state — never take it from M-Pesa link response / payer metadata.
  if (data.customerName != null && String(data.customerName).trim() !== "") {
    patch.customerName = data.customerName
  }
  return patch
}

// ====== REUSABLE TABLE COMPONENTS ======

// Status Badge - Clean, consistent status display
function StatusBadge({ status }: { status: string }) {
  const config = {
    completed: { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200", label: "Completed" },
    pending: { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200", label: "Pending" },
    cancelled: { bg: "bg-red-50", text: "text-red-700", border: "border-red-200", label: "Cancelled" },
  }[status] || { bg: "bg-slate-50", text: "text-slate-700", border: "border-slate-200", label: status }
  
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${config.bg} ${config.text} border ${config.border}`}>
      {config.label}
    </span>
  )
}

// Payment Badge - Simplified payment method display
function PaymentBadge({ method }: { method: string | null }) {
  const config: Record<string, { icon: React.ReactNode; label: string; bg: string; text: string }> = {
    cash: { icon: <Banknote className="h-3 w-3" />, label: "Cash", bg: "bg-emerald-50", text: "text-emerald-700" },
    mpesa: { icon: <Smartphone className="h-3 w-3" />, label: "M-Pesa", bg: "bg-green-50", text: "text-green-700" },
    glovo: { icon: <Truck className="h-3 w-3" />, label: "Glovo", bg: "bg-orange-50", text: "text-orange-700" },
    card: { icon: <CreditCard className="h-3 w-3" />, label: "Card", bg: "bg-blue-50", text: "text-blue-700" },
  }
  const cfg = config[method?.toLowerCase() || ""] || { icon: null, label: method || "—", bg: "bg-slate-50", text: "text-slate-600" }
  
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium ${cfg.bg} ${cfg.text}`}>
      {cfg.icon}
      {cfg.label}
    </span>
  )
}

function getMessageDeliveryState(order: any): {
  label: string
  className: string
  title: string
} {
  const status = String(order?.paymentReceiptSmsStatus || "").toUpperCase()
  if (status === "SENT") {
    return {
      label: "Sent",
      className: "bg-emerald-50 text-emerald-700 border-emerald-200",
      title: "Payment receipt message sent",
    }
  }
  if (status === "SENDING") {
    return {
      label: "Sending",
      className: "bg-amber-50 text-amber-700 border-amber-200",
      title: "Payment receipt message is being sent",
    }
  }
  if (status === "FAILED") {
    return {
      label: "Failed",
      className: "bg-red-50 text-red-700 border-red-200",
      title: order?.paymentReceiptSmsLastError
        ? `Message failed: ${order.paymentReceiptSmsLastError}`
        : "Payment receipt message failed",
    }
  }
  return {
    label: "Not sent",
    className: "bg-slate-100 text-slate-600 border-slate-200",
    title: "Payment receipt message not sent",
  }
}

// Icon Button - Consistent action buttons
function IconButton({ 
  icon, 
  onClick, 
  title, 
  variant = "default" 
}: { 
  icon: React.ReactNode; 
  onClick: () => void; 
  title: string;
  variant?: "default" | "primary";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`h-8 w-8 inline-flex items-center justify-center rounded-lg transition-all ${
        variant === "primary" 
          ? "bg-[#2563eb] text-white hover:bg-[#1d4ed8] shadow-sm" 
          : "text-slate-500 hover:text-slate-700 hover:bg-slate-100"
      }`}
    >
      {icon}
    </button>
  )
}

// Row Action Menu - Dropdown for secondary actions
function RowActionMenu({ 
  order,
  onPay,
  onEdit,
  onAddItems,
  onResendSms,
  onDelete,
}: { 
  order: Transaction;
  onPay?: () => void;
  onEdit?: () => void;
  onAddItems?: () => void;
  onResendSms?: () => void;
  onDelete: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="h-8 w-8 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-all"
        >
          <MoreVertical className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {onPay && (
          <DropdownMenuItem onClick={onPay} className="cursor-pointer">
            <Wallet2 className="h-4 w-4 mr-2 text-emerald-600" />
            <span>Process Payment</span>
          </DropdownMenuItem>
        )}
        {onEdit && (
          <DropdownMenuItem onClick={onEdit} className="cursor-pointer">
            <Edit2 className="h-4 w-4 mr-2 text-amber-600" />
            <span>Edit Order</span>
          </DropdownMenuItem>
        )}
        {onAddItems && (
          <DropdownMenuItem onClick={onAddItems} className="cursor-pointer">
            <Plus className="h-4 w-4 mr-2 text-blue-600" />
            <span>Add Items</span>
          </DropdownMenuItem>
        )}
        {onResendSms && (
          <DropdownMenuItem onClick={onResendSms} className="cursor-pointer">
            <RefreshCw className="h-4 w-4 mr-2 text-indigo-600" />
            <span>Resend SMS</span>
          </DropdownMenuItem>
        )}
        {(onPay || onEdit || onAddItems || onResendSms) && <DropdownMenuSeparator />}
        <DropdownMenuItem onClick={onDelete} variant="destructive" className="cursor-pointer">
          <Trash2 className="h-4 w-4 mr-2" />
          <span>Delete Order</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default function OrdersPage() {
  const router = useRouter()
  const { data: session } = useSession()
  const { canEdit, canDelete } = useCathaPermissions("orders")
  const canManageMpesa = useMemo(
    () =>
      canManageOrderMpesaPayments(
        normalizePermissions((session?.user as { permissions?: unknown })?.permissions),
        (session?.user as { role?: string })?.role
      ),
    [session?.user]
  )
  const canManualMpesa = useMemo(
    () =>
      canManuallyAddMpesaTransaction(
        normalizePermissions((session?.user as { permissions?: unknown })?.permissions),
        (session?.user as { role?: string })?.role
      ),
    [session?.user]
  )
  const [mounted, setMounted] = useState(false)
  const [view, setView] = useState<"table" | "cards">("cards")
  const [searchQuery, setSearchQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState<"all" | "PAID" | "PARTIALLY_PAID" | "NOT_PAID">("all")
  const [paymentFilter, setPaymentFilter] = useState<"all" | "glovo" | "card" | "mpesa">("all")
  const [lifecycleFilter, setLifecycleFilter] = useState<"all" | "cancelled">("all")
  const [orders, setOrders] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [editingOrder, setEditingOrder] = useState<Transaction | null>(null)
  const [viewingOrder, setViewingOrder] = useState<Transaction | null>(null)
  const [draftStatus, setDraftStatus] = useState<Transaction["status"] | "">("")
  const [draftPayment, setDraftPayment] = useState<"glovo" | "card" | "mpesa" | "">("")
  const [draftItems, setDraftItems] = useState<Transaction["items"]>([])
  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set())
  const [addingItemsToOrder, setAddingItemsToOrder] = useState<Transaction | null>(null)
  const [newItems, setNewItems] = useState<{ productId: string; quantity: number }[]>([])
  const [addItemsSearchQuery, setAddItemsSearchQuery] = useState("")
  const [processingPayment, setProcessingPayment] = useState<Transaction | null>(null)
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<"glovo" | "card" | "mpesa" | "">("")
  const [glovoOrderNumber, setGlovoOrderNumber] = useState("")
  const [isProcessingGlovoPayment, setIsProcessingGlovoPayment] = useState(false)
  const [showCardDialog, setShowCardDialog] = useState(false)
  const [cardTransactionReference, setCardTransactionReference] = useState("")
  const [isProcessingCardPayment, setIsProcessingCardPayment] = useState(false)
  const [mpesaFlowTab, setMpesaFlowTab] = useState<"link" | "request" | "manual">("link")
  const [mpesaExactAmountSearch, setMpesaExactAmountSearch] = useState("")
  const [mpesaLinkCandidates, setMpesaLinkCandidates] = useState<any[]>([])
  const [loadingMpesaCandidates, setLoadingMpesaCandidates] = useState(false)
  const [selectedMpesaTransactionId, setSelectedMpesaTransactionId] = useState<string | null>(null)
  const [mpesaAllocationInput, setMpesaAllocationInput] = useState("")
  const [linkingMpesaTransaction, setLinkingMpesaTransaction] = useState(false)
  const [mpesaRequestStatus, setMpesaRequestStatus] = useState<"idle" | "sent" | "waiting" | "paid" | "failed">("idle")
  const [printingOrder, setPrintingOrder] = useState<Transaction | null>(null)
  // M-Pesa STK push states
  const [showMpesaDialog, setShowMpesaDialog] = useState(false)
  const [mpesaPhoneNumber, setMpesaPhoneNumber] = useState("")
  const [paymentCustomerPhone, setPaymentCustomerPhone] = useState("")
  const [mpesaProcessing, setMpesaProcessing] = useState(false)
  const [pendingMpesaOrderId, setPendingMpesaOrderId] = useState<string | null>(null)
  const [mpesaError, setMpesaError] = useState<{ message: string; status: string } | null>(null)
  const [mpesaCheckoutRequestId, setMpesaCheckoutRequestId] = useState<string | null>(null)
  const [manualTxCode, setManualTxCode] = useState("")
  const [manualTxPhone, setManualTxPhone] = useState("")
  const [manualTxAmount, setManualTxAmount] = useState("")
  const [manualTxDate, setManualTxDate] = useState("")
  const [manualTxNotes, setManualTxNotes] = useState("")
  const [manualTxSubmitting, setManualTxSubmitting] = useState(false)
  const [manualTxLookup, setManualTxLookup] = useState<ManualTxLookup | null>(null)
  const [manualTxLookupLoading, setManualTxLookupLoading] = useState(false)
  const [debouncedManualTxCode, setDebouncedManualTxCode] = useState("")
  const [manualTxConfirmed, setManualTxConfirmed] = useState(false)
  const mpesaPollIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const mpesaCandidatesLoadModeRef = useRef<"recent" | "exact">("recent")
  const [filterSheetOpen, setFilterSheetOpen] = useState(false)
  const [changeNotesDraft, setChangeNotesDraft] = useState("")
  const [markingChangeGiven, setMarkingChangeGiven] = useState(false)
  const [unlinkingTxId, setUnlinkingTxId] = useState<string | null>(null)
  const [ordersPage, setOrdersPage] = useState(1)
  const [totalMatching, setTotalMatching] = useState(0)
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [dashboardSummary, setDashboardSummary] = useState<OrdersDashboardSummary>({
    totalOrders: 0,
    totalItems: 0,
    paidOrders: 0,
    partiallyPaidOrders: 0,
    notPaidOrders: 0,
  })

  // Ensure component is mounted on client to prevent hydration mismatches
  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (typeof window === "undefined") return
    const p = new URLSearchParams(window.location.search)
    if (p.get("filter") === "cancelled") setLifecycleFilter("cancelled")
  }, [])

  useEffect(() => {
    const t = window.setTimeout(() => {
      setDebouncedSearch(searchQuery.trim())
      setOrdersPage(1)
    }, 350)
    return () => clearTimeout(t)
  }, [searchQuery])

  useEffect(() => {
    setOrdersPage(1)
  }, [statusFilter, paymentFilter, lifecycleFilter])

  useEffect(() => {
    setSelectedOrders(new Set())
  }, [ordersPage])

  const hasScrolledRef = useRef(false)
  const isFetchingRef = useRef(false)
  const hasFetchedOrdersOnceRef = useRef(false)
  const pauseUntilRef = useRef(0) // On 500/401, pause polling to avoid aggressive retries

  const fetchDashboardSummary = useCallback(async () => {
    try {
      const res = await fetch("/api/catha/orders?summaryOnly=1", { cache: "no-store" })
      if (!res.ok) return
      const data = await res.json()
      if (data && typeof data.totalOrders === "number") {
        setDashboardSummary(data)
      }
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    if (!mounted) return
    fetchDashboardSummary()
    const iv = setInterval(fetchDashboardSummary, 30_000)
    return () => clearInterval(iv)
  }, [mounted, fetchDashboardSummary])

  const mapOrderRow = useCallback((o: any): Transaction => {
    const rawItems = Array.isArray(o.items) ? o.items : []
    const tsRaw = o.timestamp ?? o.createdAt
    const timestamp =
      tsRaw instanceof Date
        ? tsRaw
        : tsRaw
          ? new Date(tsRaw)
          : new Date()
    const safeTimestamp = Number.isNaN(timestamp.getTime()) ? new Date() : timestamp
    const numOr = (v: unknown, fallback = 0) => {
      const n = Number(v)
      return Number.isFinite(n) ? n : fallback
    }
    const numOrNull = (v: unknown) => {
      if (v == null || v === "") return null
      const n = Number(v)
      return Number.isFinite(n) ? n : null
    }
    return {
    ...o,
    timestamp: safeTimestamp,
    paymentStatus: (() => {
      if (
        o.paymentStatus === "PAID" ||
        o.paymentStatus === "PARTIALLY_PAID" ||
        o.paymentStatus === "OVERPAID"
      )
        return o.paymentStatus
      if (o.status === "completed") return "PAID"
      const received = numOr(o.cashAmount ?? o.amountReceived, 0)
      const total = numOr(o.total, 0)
      if (received > 0 && received < total) return "PARTIALLY_PAID"
      if (o.paymentStatus === "NOT_PAID") return "NOT_PAID"
      return "NOT_PAID"
    })(),
    linkedPayments: Array.isArray(o.linkedPayments) ? o.linkedPayments : [],
    totalLinkedPayments: numOrNull(o.totalLinkedPayments),
    balanceDue: numOrNull(o.balanceDue),
    overpaymentAmount: numOrNull(o.overpaymentAmount),
    changeGiven: o.changeGiven === true,
    changeGivenAt: o.changeGivenAt || null,
    changeGivenBy: o.changeGivenBy || null,
    changeNotes: o.changeNotes || null,
    mpesaReceiptNumber: o.mpesaReceiptNumber || null,
    glovoOrderNumber: o.glovoOrderNumber || null,
    cashAmount: numOrNull(o.cashAmount),
    cashBalance: numOrNull(o.cashBalance),
    subtotal: numOr(o.subtotal, 0),
    vat: numOr(o.vat, 0),
    total: numOr(o.total, 0),
    servedAt: o.servedAt || null,
    servedBy: o.servedBy || null,
    items: rawItems.map((item: any) => ({
      ...item,
      name: item?.name || "Unknown",
      price: numOr(item?.price, 0),
      quantity: numOr(item?.quantity, 0),
    })),
  }
  }, [])

  const fetchOrders = useCallback(async () => {
    if (isFetchingRef.current) return
    if (Date.now() < pauseUntilRef.current) return

    try {
      isFetchingRef.current = true
      if (!hasFetchedOrdersOnceRef.current) setLoading(true)

      const params = new URLSearchParams()
      params.set("paged", "1")
      params.set("limit", String(ORDERS_PAGE_SIZE))
      params.set("skip", String((ordersPage - 1) * ORDERS_PAGE_SIZE))
      if (debouncedSearch) params.set("q", debouncedSearch)
      if (paymentFilter !== "all") params.set("paymentMethod", paymentFilter)
      if (statusFilter !== "all") params.set("paymentStatus", statusFilter)
      if (lifecycleFilter === "cancelled") params.set("lifecycle", "cancelled")

      const response = await fetch(`/api/catha/orders?${params.toString()}`, {
        cache: "no-store",
      })
      if (!response.ok) {
        if (response.status === 401 || response.status >= 500) {
          pauseUntilRef.current = Date.now() + 15_000
        }
        throw new Error("Failed to fetch orders")
      }
      const data = await response.json()
      if (data?.error) {
        pauseUntilRef.current = Date.now() + 15_000
        throw new Error(data.error)
      }
      const rawOrders = Array.isArray(data.orders) ? data.orders : []
      const total = typeof data.total === "number" ? data.total : rawOrders.length

      const processedOrders = sortOrdersUnacceptedFirst(
        (rawOrders
          .map((row: any) => {
            try {
              return mapOrderRow(row)
            } catch (err) {
              console.error("Failed to map order row", row?.id, err)
              return null
            }
          })
          .filter(Boolean)
          .filter(
            (o: Transaction, idx: number, arr: Transaction[]) =>
              arr.findIndex((x: Transaction) => x.id === o.id) === idx,
          ) as Transaction[]),
      )

      setTotalMatching(total)
      setOrders((prevOrders) => {
        const hasChanged =
          prevOrders.length !== processedOrders.length ||
          processedOrders.some((next: Transaction) => {
            const prev = prevOrders.find((o) => o.id === next.id)
            if (!prev) return true
            return (
              prev.status !== next.status ||
              (prev as any).paymentStatus !== (next as any).paymentStatus ||
              prev.total !== next.total ||
              (prev as any).amountReceived !== (next as any).amountReceived ||
              (prev as any).balanceDue !== (next as any).balanceDue ||
              (prev as any).totalLinkedPayments !== (next as any).totalLinkedPayments ||
              (prev as any).changeGiven !== (next as any).changeGiven ||
              JSON.stringify((prev as any).linkedPayments || []) !==
                JSON.stringify((next as any).linkedPayments || []) ||
              (Array.isArray(prev.items) ? prev.items.length : 0) !==
                (Array.isArray(next.items) ? next.items.length : 0) ||
              (prev as any).servedAt !== (next as any).servedAt ||
              (prev as any).waiter !== (next as any).waiter
            )
          })
        return hasChanged ? processedOrders : prevOrders
      })
      hasFetchedOrdersOnceRef.current = true
    } catch (error) {
      console.error("Error fetching orders:", error)
      setOrders((prevOrders) => {
        if (!hasFetchedOrdersOnceRef.current) {
          return []
        }
        return prevOrders
      })
      if (!hasFetchedOrdersOnceRef.current) {
        setTotalMatching(0)
      }
    } finally {
      isFetchingRef.current = false
      setLoading(false)
    }
  }, [ordersPage, debouncedSearch, statusFilter, paymentFilter, lifecycleFilter, mapOrderRow])

  useEffect(() => {
    if (!mounted) return

    let cancelled = false
    ;(async () => {
      try {
        // Pull orphan /menu rounds (created before admin sync) onto this board once per load.
        await fetch("/api/catha/menu-orders/sync-to-orders", {
          method: "POST",
          cache: "no-store",
        })
      } catch {
        /* ignore — list still loads from orders */
      }
      if (!cancelled) fetchOrders()
    })()

    const interval = setInterval(() => {
      fetchOrders()
    }, 2000)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [mounted, fetchOrders])

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(totalMatching / ORDERS_PAGE_SIZE))
    if (totalMatching > 0 && ordersPage > maxPage) {
      setOrdersPage(maxPage)
    }
  }, [totalMatching, ordersPage])

  useEffect(() => {
    setViewingOrder((prev) => {
      if (!prev) return prev
      const fresh = orders.find((o) => o.id === prev.id)
      return fresh ? ({ ...fresh } as Transaction) : prev
    })
  }, [orders])

  // Handle scroll to order from notification hash anchor - only run once
  useEffect(() => {
    if (!mounted || typeof window === 'undefined' || hasScrolledRef.current) return
    
    const hash = window.location.hash
    if (hash && hash.startsWith('#menu-order-')) {
      hasScrolledRef.current = true
      const orderId = hash.replace('#menu-order-', '')
      
      // Scroll to order after a short delay to ensure DOM is ready
      setTimeout(() => {
        const element = document.getElementById(`menu-order-${orderId}`)
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' })
          // Highlight the order briefly
          element.classList.add('ring-4', 'ring-orange-500', 'ring-offset-2')
          setTimeout(() => {
            element.classList.remove('ring-4', 'ring-orange-500', 'ring-offset-2')
          }, 3000)
        }
      }, 1000) // Increased delay to ensure orders are loaded
    }
  }, [mounted]) // Removed orders dependency to prevent re-running

  const totalOrders = dashboardSummary.totalOrders
  const totalItems = dashboardSummary.totalItems
  const paidOrders = dashboardSummary.paidOrders
  const partiallyPaidOrders = dashboardSummary.partiallyPaidOrders
  const notPaidOrders = dashboardSummary.notPaidOrders
  const unpaidOrders = notPaidOrders + partiallyPaidOrders

  const totalPages = Math.max(1, Math.ceil(totalMatching / ORDERS_PAGE_SIZE))
  const rangeStart = totalMatching === 0 ? 0 : (ordersPage - 1) * ORDERS_PAGE_SIZE + 1
  const rangeEnd = Math.min(ordersPage * ORDERS_PAGE_SIZE, totalMatching)

  const handleViewClick = (order: Transaction) => {
    setViewingOrder(order)
  }

  const handleEditClick = (order: Transaction) => {
    if (order.status === "completed") {
      alert("Cannot edit completed orders")
      return
    }
    
    // Store order data in sessionStorage for POS page to load
    if (typeof window !== "undefined") {
      sessionStorage.setItem("editOrder", JSON.stringify({
        id: order.id,
        table: order.table,
        items: order.items,
        cashier: order.cashier,
        waiter: order.waiter,
        paymentMethod: order.paymentMethod,
        mpesaReceiptNumber: (order as any).mpesaReceiptNumber,
        glovoOrderNumber: (order as any).glovoOrderNumber,
        status: order.status,
        subtotal: order.subtotal,
        vat: order.vat,
        total: order.total,
      }))
      
      // Navigate to POS page
      router.push("/catha/pos?edit=true")
    }
  }

  const handleSaveEdit = async () => {
    if (!editingOrder || !draftStatus || !draftPayment) return

    // Recalculate totals based on draft items
    const newSubtotal = draftItems.reduce((sum, item) => sum + item.price * item.quantity, 0)
    const newVat = 0
    const newTotal = newSubtotal

    try {
      const response = await fetch('/api/catha/orders', {
        method: 'PUT',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingOrder.id,
          status: draftStatus,
          paymentMethod: draftPayment,
          items: draftItems,
          subtotal: newSubtotal,
          vat: newVat,
          total: newTotal,
        }),
      })

      if (!response.ok) throw new Error('Failed to update order')

      setOrders((prev) =>
        prev.map((o) =>
          o.id === editingOrder.id
            ? {
                ...o,
                status: draftStatus,
                paymentMethod: draftPayment,
                items: draftItems,
                subtotal: newSubtotal,
                vat: newVat,
                total: newTotal,
              }
            : o,
        ),
      )
      setEditingOrder(null)
      setDraftItems([])
    } catch (error) {
      console.error('Error updating order:', error)
      alert('Failed to update order')
    }
  }

  const handleRemoveItemFromEdit = (index: number) => {
    setDraftItems((prev) => prev.filter((_, i) => i !== index))
  }

  const handleUpdateItemQuantity = (index: number, newQuantity: number) => {
    if (newQuantity <= 0) {
      handleRemoveItemFromEdit(index)
      return
    }
    setDraftItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, quantity: newQuantity } : item)),
    )
  }

  const handleAddItemsClick = (order: Transaction) => {
    if (order.status !== "pending") {
      alert("You can only add items to pending orders")
      return
    }
    setAddingItemsToOrder(order)
    // Initialize with existing items from the order
    const existingItems = order.items.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
    }))
    setNewItems(existingItems)
  }

  const handleAddItemToOrder = (productId: string) => {
    const product = products.find((p) => p.id === productId)
    if (!product) {
      console.warn(`Product with ID ${productId} not found`)
      return
    }

    setNewItems((prev) => {
      const existing = prev.find((i) => i.productId === productId)
      if (existing) {
        return prev.map((i) =>
          i.productId === productId ? { ...i, quantity: i.quantity + 1 } : i,
        )
      }
      return [...prev, { productId, quantity: 1 }]
    })
  }

  const handleSaveItemsToOrder = async () => {
    if (!addingItemsToOrder || newItems.length === 0) return

    // Convert newItems to full item objects with product details
    const updatedItems = newItems
      .map((item) => {
        const product = products.find((p) => p.id === item.productId)
        if (!product) {
          console.warn(`Product with ID ${item.productId} not found, skipping`)
          return null
        }
        return {
          productId: item.productId,
          name: product.name,
          quantity: item.quantity,
          price: product.price,
        }
      })
      .filter((item): item is NonNullable<typeof item> => item !== null)
    
    if (updatedItems.length === 0) {
      alert('No valid products to add')
      return
    }

    const newSubtotal = updatedItems.reduce((sum, i) => sum + i.price * i.quantity, 0)
    const newVat = 0
    const newTotal = newSubtotal

    try {
      const response = await fetch('/api/catha/orders', {
        method: 'PUT',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: addingItemsToOrder.id,
          items: updatedItems,
          subtotal: newSubtotal,
          vat: newVat,
          total: newTotal,
        }),
      })

      if (!response.ok) throw new Error('Failed to update order')

      setOrders((prev) => prev.map((o) => (o.id === addingItemsToOrder.id ? {
        ...o,
        items: updatedItems,
        subtotal: newSubtotal,
        vat: newVat,
        total: newTotal,
      } : o)))
      setAddingItemsToOrder(null)
      setNewItems([])
      setAddItemsSearchQuery("")
    } catch (error) {
      console.error('Error updating order:', error)
      alert('Failed to update order')
    }
  }

  const toggleOrderSelection = (orderId: string) => {
    setSelectedOrders((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(orderId)) {
        newSet.delete(orderId)
      } else {
        newSet.add(orderId)
      }
      return newSet
    })
  }

  const handleBulkPayment = async (paymentMethod: "card" | "mpesa") => {
    if (selectedOrders.size === 0) {
      alert("Please select at least one order to pay")
      return
    }

    const selectedOrderIds = Array.from(selectedOrders)
    const totalAmount = orders
      .filter((o) => selectedOrderIds.includes(o.id))
      .reduce((sum, o) => sum + o.total, 0)

    if (confirm(`Pay ${selectedOrderIds.length} order(s) totaling Ksh ${totalAmount.toFixed(2)} by ${paymentMethod}?`)) {
      try {
        await Promise.all(
          selectedOrderIds.map((id) =>
            fetch('/api/catha/orders', {
              method: 'PUT',
              cache: 'no-store',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id, status: 'completed', paymentMethod, paymentStatus: 'PAID' }),
            })
          )
        )

        setOrders((prev) =>
          prev.map((o) =>
            selectedOrderIds.includes(o.id)
              ? { ...o, status: "completed", paymentMethod, paymentStatus: "PAID" as const }
              : o,
          ),
        )
        setSelectedOrders(new Set())
        alert(`Successfully paid ${selectedOrderIds.length} order(s)!`)
      } catch (error) {
        console.error('Error processing payments:', error)
        alert('Failed to process payments')
      }
    }
  }

  const handlePaymentClick = (order: Transaction) => {
    if (order.status === "completed") {
      alert("This order is already paid")
      return
    }
    const paySum = summarizeCathaOrderPayments(order as any)
    setProcessingPayment(order)
    setSelectedPaymentMethod("")
    setGlovoOrderNumber("")
    setCardTransactionReference("")
    setShowCardDialog(false)
    setMpesaFlowTab("link")
    const hint = paySum.balanceDue > 0 ? paySum.balanceDue : paySum.orderTotal
    setMpesaExactAmountSearch(hint > 0 ? String(hint.toFixed(2)) : "")
    setMpesaLinkCandidates([])
    setSelectedMpesaTransactionId(null)
    setMpesaAllocationInput("")
    setManualTxCode("")
    setManualTxPhone(String((order as any).customerPhone || ""))
    setManualTxAmount(hint > 0 ? hint.toFixed(2) : "")
    setManualTxDate(new Date().toISOString().slice(0, 10))
    setManualTxNotes("")
    setManualTxLookup(null)
    setManualTxLookupLoading(false)
    setDebouncedManualTxCode("")
    setManualTxConfirmed(false)
    const existingPhone = String((order as any).customerPhone || "")
    setMpesaPhoneNumber(existingPhone)
    setPaymentCustomerPhone(existingPhone)
    setMpesaRequestStatus("idle")
  }

  const syncPaymentPhones = (value: string) => {
    setPaymentCustomerPhone(value)
    setMpesaPhoneNumber(value)
  }

  const markOrderPaid = async (orderId: string, method: "glovo" | "card" | "mpesa", extra: Record<string, unknown> = {}) => {
    const payload: Record<string, unknown> = {
      id: orderId,
      paymentMethod: method,
      status: "completed",
      paymentStatus: "PAID",
      ...extra,
    }
    const res = await fetch('/api/catha/orders', {
      method: 'PUT',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      let message = "Failed to update order payment"
      try {
        const data = await res.json()
        if (typeof data?.error === "string" && data.error.trim()) {
          message = data.error
        }
      } catch {
        // ignore parse failure
      }
      throw new Error(message)
    }
    // Sync menu order
    try {
      await fetch('/api/catha/menu-orders', {
        method: 'PUT',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, paymentStatus: 'PAID', status: 'paid' }),
      })
    } catch { /* non-critical */ }
    setOrders((prev) =>
      prev.map((o) =>
        o.id === orderId
          ? { ...o, status: "completed", paymentMethod: method, paymentStatus: "PAID", ...extra }
          : o,
      ),
    )
  }

  const loadMpesaLinkCandidates = useCallback(
    async (mode: "recent" | "exact", amount?: number) => {
      if (!processingPayment) return
      try {
        setLoadingMpesaCandidates(true)
        mpesaCandidatesLoadModeRef.current = mode
        let url = "/api/mpesa/transactions?linkableOnly=1&"
        if (mode === "recent") {
          url += "recentLimit=80"
        } else if (amount != null && !Number.isNaN(amount)) {
          url += `exactAmount=${encodeURIComponent(String(amount))}`
        } else {
          url += "recentLimit=80"
        }
        const response = await fetch(url, { cache: "no-store" })
        const data = await response.json()
        const txs = Array.isArray(data?.transactions) ? data.transactions : []
        setMpesaLinkCandidates(txs)
      } catch {
        setMpesaLinkCandidates([])
      } finally {
        setLoadingMpesaCandidates(false)
      }
    },
    [processingPayment]
  )

  const loadMpesaLinkBySearch = useCallback(
    async (query: string) => {
      if (!processingPayment || !query.trim()) return
      try {
        setLoadingMpesaCandidates(true)
        mpesaCandidatesLoadModeRef.current = "recent"
        const url = `/api/mpesa/transactions?linkableOnly=1&search=${encodeURIComponent(query.trim())}&recentLimit=40`
        const response = await fetch(url, { cache: "no-store" })
        const data = await response.json()
        const txs = Array.isArray(data?.transactions) ? data.transactions : []
        setMpesaLinkCandidates(txs)
      } catch {
        setMpesaLinkCandidates([])
      } finally {
        setLoadingMpesaCandidates(false)
      }
    },
    [processingPayment]
  )

  useEffect(() => {
    const t = window.setTimeout(() => {
      setDebouncedManualTxCode(manualTxCode.trim().toUpperCase().replace(/\s+/g, ""))
    }, 400)
    return () => clearTimeout(t)
  }, [manualTxCode])

  useEffect(() => {
    if (mpesaFlowTab !== "manual" || !processingPayment || !canManualMpesa) return
    const code = debouncedManualTxCode
    if (code.length < 3) {
      setManualTxLookup(null)
      setManualTxLookupLoading(false)
      setManualTxConfirmed(false)
      return
    }

    let cancelled = false
    setManualTxLookupLoading(true)
    setManualTxConfirmed(false)

    ;(async () => {
      try {
        const url = `/api/catha/orders/manual-mpesa/lookup?code=${encodeURIComponent(code)}&orderId=${encodeURIComponent(processingPayment.id)}`
        const res = await fetch(url, { cache: "no-store" })
        const data = (await res.json()) as ManualTxLookup
        if (cancelled) return
        if (!res.ok) {
          setManualTxLookup(null)
          return
        }
        setManualTxLookup(data)
        if (data.status === "exists_unlinked") {
          const live = summarizeCathaOrderPayments(processingPayment as any)
          const rem = Math.max(0, Number(data.remainingUnallocated || 0))
          const def = live.balanceDue > 0.005 ? Math.min(live.balanceDue, rem) : rem
          if (def > 0) setManualTxAmount(def.toFixed(2))
        }
      } catch {
        if (!cancelled) setManualTxLookup(null)
      } finally {
        if (!cancelled) setManualTxLookupLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [debouncedManualTxCode, processingPayment?.id, mpesaFlowTab, canManualMpesa])

  useEffect(() => {
    if (!processingPayment || selectedPaymentMethod !== "mpesa" || mpesaFlowTab !== "link") return
    loadMpesaLinkCandidates("recent")
  }, [processingPayment, selectedPaymentMethod, mpesaFlowTab, loadMpesaLinkCandidates])

  const handleLinkMpesaTransaction = async () => {
    if (!processingPayment || !selectedMpesaTransactionId) {
      toast.error("Select a valid M-Pesa transaction first.")
      return
    }
    const allocNum = Number(mpesaAllocationInput)
    if (!Number.isFinite(allocNum) || allocNum <= 0) {
      toast.error("Enter a valid allocation amount (KSh) greater than zero.")
      return
    }
    const txRow = mpesaLinkCandidates.find((t) => t.id === selectedMpesaTransactionId)
    const rem = txRow != null ? Number(txRow.remainingUnallocated ?? txRow.amount ?? 0) : null
    if (rem != null && Number.isFinite(rem) && allocNum > rem + 0.005) {
      toast.error(`Allocation exceeds remaining transaction balance (KSh ${rem.toFixed(2)}).`)
      return
    }
    setLinkingMpesaTransaction(true)
    try {
      const response = await fetch("/api/catha/orders/link-mpesa", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: processingPayment.id,
          transactionId: selectedMpesaTransactionId,
          allocatedAmount: allocNum,
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data?.error || "Failed to link transaction")

      const patch = patchOrderFromMpesaLinkResponse(data)
      setOrders((prev) =>
        prev.map((o) =>
          o.id === processingPayment.id ? ({ ...o, ...patch } as Transaction) : o
        )
      )
      const paidFull =
        data?.summary?.paymentStatus === "PAID" || data?.summary?.paymentStatus === "OVERPAID"
      if (paidFull) {
        toast.success(`Order ${processingPayment.id} fully paid via M-Pesa`)
        setProcessingPayment(null)
        setSelectedPaymentMethod("")
        setSelectedMpesaTransactionId(null)
        setMpesaAllocationInput("")
      } else {
        toast.success(`M-Pesa payment linked — balance KSh ${Number(data?.summary?.balanceDue ?? 0).toFixed(2)} remaining`)
        const updated = { ...processingPayment, ...patch } as Transaction
        setProcessingPayment(updated)
        setSelectedMpesaTransactionId(null)
        setMpesaAllocationInput("")
        const bal = Number(data?.summary?.balanceDue ?? 0)
        setMpesaExactAmountSearch(bal > 0 ? bal.toFixed(2) : "")
        loadMpesaLinkCandidates("recent")
      }
    } catch (error: any) {
      toast.error(error?.message || "Failed to link M-Pesa transaction")
    } finally {
      setLinkingMpesaTransaction(false)
    }
  }

  const handleUseSuggestLink = async (lookup?: Extract<ManualTxLookup, { status: "exists_unlinked" }>) => {
    const row =
      lookup ??
      (manualTxLookup?.status === "exists_unlinked" ? manualTxLookup : null)
    if (!row || !processingPayment) return
    const receipt = row.transactionCode || manualTxCode.trim()
    setMpesaFlowTab("link")
    setSelectedMpesaTransactionId(row.transactionId)
    const live = summarizeCathaOrderPayments(processingPayment as any)
    const rem = Math.max(0, Number(row.remainingUnallocated || 0))
    const def = live.balanceDue > 0.005 ? Math.min(live.balanceDue, rem) : rem
    setMpesaAllocationInput(def > 0 ? def.toFixed(2) : "")
    await loadMpesaLinkBySearch(receipt)
    toast.message("Confirm the allocation on Link Existing Transaction.")
  }

  const handleManualMpesaSubmit = async () => {
    if (!processingPayment || manualTxSubmitting) return
    const code = manualTxCode.trim().toUpperCase().replace(/\s+/g, "")
    if (!code) {
      toast.error("Transaction code is required.")
      return
    }
    const amountNum = Number(manualTxAmount)
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      toast.error("Enter a valid amount greater than zero.")
      return
    }
    const live = summarizeCathaOrderPayments(processingPayment as any)
    if (amountNum > live.balanceDue + 0.005) {
      toast.error(`Amount exceeds remaining balance (KSh ${live.balanceDue.toFixed(2)}).`)
      return
    }
    if (manualTxPhone.trim()) {
      const phoneErr = getPhoneValidationError(manualTxPhone)
      if (phoneErr) {
        toast.error(phoneErr)
        return
      }
    }
    setManualTxSubmitting(true)
    try {
      const phoneNorm = manualTxPhone.trim() ? normalizeKenyaPhone(manualTxPhone.trim()) : null
      const response = await fetch("/api/catha/orders/manual-mpesa", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: processingPayment.id,
          transactionCode: code,
          amount: amountNum,
          phone: phoneNorm,
          paymentDate: manualTxDate || undefined,
          notes: manualTxNotes.trim() || undefined,
        }),
      })
      const data = await response.json()
      if (!response.ok) {
        if (data?.code === "SUGGEST_LINK" && data?.suggestLink) {
          setManualTxLookup({
            status: "exists_unlinked",
            transactionCode: code,
            transactionId: data.suggestLink.transactionId,
            amount: Number(data.suggestLink.amount || 0),
            phoneMasked: null,
            receivedAt: new Date().toISOString(),
            remainingUnallocated: Number(data.suggestLink.remainingUnallocated || 0),
            allocatedTotal: 0,
            importedFromSafaricom: true,
          })
          toast.error(data.error || "Use Link Existing Transaction instead.")
          return
        }
        throw new Error(data?.error || "Failed to submit for approval")
      }

      if (data?.pending) {
        const baseMessage =
          data?.message ||
          `Submitted for manager approval${data?.verification?.id ? ` (${data.verification.id})` : ""}`
        if (data?.approvalSmsSent) {
          toast.success(`${baseMessage} Manager approval SMS sent.`)
        } else if (data?.approvalSmsReason === "disabled") {
          toast.success(`${baseMessage} Enable approval SMS in Settings to notify managers.`)
        } else if (data?.approvalSmsReason === "no_recipients") {
          toast.success(`${baseMessage} Add manager numbers under Manual M-Pesa approval in Settings.`)
        } else if (data?.approvalSmsReason) {
          toast.warning(`${baseMessage} Approval SMS was not sent: ${data.approvalSmsReason}`)
        } else {
          toast.success(baseMessage)
        }
        setProcessingPayment(null)
        setSelectedPaymentMethod("")
        setManualTxCode("")
        setManualTxAmount("")
        setManualTxNotes("")
        setManualTxLookup(null)
        setManualTxConfirmed(false)
        return
      }

      const patch = patchOrderFromMpesaLinkResponse(data)
      setOrders((prev) =>
        prev.map((o) =>
          o.id === processingPayment.id ? ({ ...o, ...patch } as Transaction) : o
        )
      )
      const paidFull =
        data?.summary?.paymentStatus === "PAID" || data?.summary?.paymentStatus === "OVERPAID"
      if (paidFull) {
        toast.success(`Order ${processingPayment.id} fully paid via manual M-Pesa entry`)
        setProcessingPayment(null)
        setSelectedPaymentMethod("")
        setManualTxCode("")
        setManualTxAmount("")
        setManualTxNotes("")
      } else {
        toast.success(
          `Manual M-Pesa payment linked — balance KSh ${Number(data?.summary?.balanceDue ?? 0).toFixed(2)} remaining`
        )
        const updated = { ...processingPayment, ...patch } as Transaction
        setProcessingPayment(updated)
        const bal = Number(data?.summary?.balanceDue ?? 0)
        setManualTxAmount(bal > 0 ? bal.toFixed(2) : "")
        setManualTxCode("")
        setManualTxNotes("")
      }
    } catch (error: any) {
      toast.error(error?.message || "Failed to verify and link transaction")
    } finally {
      setManualTxSubmitting(false)
    }
  }

  const handleConfirmGlovoPayment = async () => {
    if (!processingPayment || isProcessingGlovoPayment) return
    const normalizedGlovoOrderNumber = glovoOrderNumber.trim()
    if (!normalizedGlovoOrderNumber) {
      toast.error("Glovo order number is required.")
      return
    }
    setIsProcessingGlovoPayment(true)
    try {
      const phoneNorm =
        normalizeKenyaPhone(paymentCustomerPhone.trim()) || normalizeKenyaPhone(mpesaPhoneNumber.trim())
      await markOrderPaid(processingPayment.id, "glovo", {
        glovoOrderNumber: normalizedGlovoOrderNumber,
        ...(phoneNorm ? { customerPhone: phoneNorm } : {}),
      })
      toast.success(`Order ${processingPayment.id} paid via Glovo`)
      setProcessingPayment(null)
      setSelectedPaymentMethod("")
      setGlovoOrderNumber("")
    } catch {
      toast.error("Failed to process Glovo payment.")
    } finally {
      setIsProcessingGlovoPayment(false)
    }
  }

  const handleConfirmCardPayment = async () => {
    if (!processingPayment || isProcessingCardPayment) return
    const reference = cardTransactionReference.trim()
    if (!reference) {
      toast.error("Card transaction reference is required.")
      return
    }
    setIsProcessingCardPayment(true)
    try {
      const phoneNorm =
        normalizeKenyaPhone(paymentCustomerPhone.trim()) || normalizeKenyaPhone(mpesaPhoneNumber.trim())
      const staffUser =
        (session?.user as any)?.name ||
        (session?.user as any)?.email ||
        "System"
      await markOrderPaid(processingPayment.id, "card", {
        paymentReference: reference,
        reference,
        cardTransactionReference: reference,
        paidAmount: Number(processingPayment.total || 0),
        paidAt: new Date().toISOString(),
        paidBy: String(staffUser),
        ...(phoneNorm ? { customerPhone: phoneNorm } : {}),
      })
      toast.success(`Order ${processingPayment.id} paid via Card`)
      setShowCardDialog(false)
      setProcessingPayment(null)
      setSelectedPaymentMethod("")
      setCardTransactionReference("")
    } catch {
      toast.error("Failed to process Card payment.")
    } finally {
      setIsProcessingCardPayment(false)
    }
  }

  const handleProcessPayment = async () => {
    if (!processingPayment || !selectedPaymentMethod) {
      alert("Please select a payment method")
      return
    }

    // M-Pesa: open STK push dialog (don't process here)
    if (selectedPaymentMethod === "mpesa") {
      setShowMpesaDialog(true)
      setMpesaFlowTab("request")
      return
    }
    if (selectedPaymentMethod === "card") {
      setShowCardDialog(true)
      return
    }
    await handleConfirmGlovoPayment()
  }

  // M-Pesa polling — same logic as POS
  useEffect(() => {
    if (!pendingMpesaOrderId) return

    let isStopped = false
    const currentOrderId = pendingMpesaOrderId
    const currentCheckoutId = mpesaCheckoutRequestId

    const stopPolling = () => {
      isStopped = true
      if (mpesaPollIntervalRef.current) {
        clearTimeout(mpesaPollIntervalRef.current)
        mpesaPollIntervalRef.current = null
      }
      toast.dismiss("mpesa-push")
    }

    const startTime = Date.now()
    const POLL_CAP_MS = 180_000
    const FAST_PHASE_MS = 30_000
    const FAST_INTERVAL = 2000
    const SLOW_INTERVAL = 5000

    const checkPaymentStatus = async () => {
      if (isStopped) return
      try {
        const searchQuery = currentCheckoutId || currentOrderId
        const response = await fetch(`/api/mpesa/transactions?search=${searchQuery}`, { cache: 'no-store' })
        const data = await response.json()

        if (data.success && data.transactions && data.transactions.length > 0) {
          const transaction = data.transactions.find((tx: any) =>
            tx.accountReference === currentOrderId ||
            (currentCheckoutId && tx.checkoutRequestId === currentCheckoutId)
          ) || data.transactions[0]

          const status = normalizeMpesaStatus(transaction.status)
          const isTerminal = status !== 'PENDING'
          if (isTerminal) stopPolling()

          if (status === 'COMPLETED' && transaction.id) {
            setMpesaRequestStatus("paid")
            const linkRes = await fetch("/api/catha/orders/link-mpesa", {
              method: "POST",
              cache: "no-store",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ orderId: currentOrderId, transactionId: transaction.id, linkSource: "stk" }),
            })
            const linkData = await linkRes.json()
            if (linkRes.ok) {
              const patch = patchOrderFromMpesaLinkResponse(linkData)
              setOrders((prev) =>
                prev.map((o) => (o.id === currentOrderId ? ({ ...o, ...patch } as Transaction) : o))
              )
              const ps = linkData?.summary?.paymentStatus as string | undefined
              const done = ps === "PAID" || ps === "OVERPAID"
              toast.success(
                done
                  ? ps === "OVERPAID"
                    ? "M-Pesa payment confirmed — order settled (overpayment recorded)"
                    : "M-Pesa payment confirmed — order fully paid"
                  : "M-Pesa payment received — balance may remain; link or send another payment."
              )
              if (done) {
                setShowMpesaDialog(false)
                setMpesaPhoneNumber("")
                setPaymentCustomerPhone("")
                setMpesaError(null)
                setPendingMpesaOrderId(null)
                setMpesaCheckoutRequestId(null)
                setMpesaProcessing(false)
                setProcessingPayment(null)
                setSelectedPaymentMethod("")
              } else {
                setShowMpesaDialog(false)
                setMpesaPhoneNumber("")
                setMpesaError(null)
                setPendingMpesaOrderId(null)
                setMpesaCheckoutRequestId(null)
                setMpesaProcessing(false)
                setProcessingPayment((prev) =>
                  prev && prev.id === currentOrderId ? ({ ...prev, ...patch } as Transaction) : prev
                )
                setMpesaFlowTab("link")
              }
            } else {
              toast.error(linkData?.error || "Payment received but linking failed — use Link Transaction.")
              setShowMpesaDialog(false)
              setMpesaPhoneNumber("")
              setPaymentCustomerPhone("")
              setMpesaError(null)
              setPendingMpesaOrderId(null)
              setMpesaCheckoutRequestId(null)
              setMpesaProcessing(false)
              setProcessingPayment(null)
              setSelectedPaymentMethod("")
            }
          } else if (status === 'CANCELLED' || status === 'FAILED') {
            setMpesaRequestStatus("failed")
            const errMsg = transaction.resultDesc ||
              (status === 'CANCELLED'
                ? "Payment was cancelled by the customer. Please try again."
                : "Payment failed. Please check the phone and try again.")
            setMpesaError({ message: errMsg, status })
            setPendingMpesaOrderId(null)
            setMpesaProcessing(false)
          }
        }
      } catch { /* ignore poll errors */ }
    }

    const scheduleNext = () => {
      if (isStopped) return
      const elapsed = Date.now() - startTime
      if (elapsed >= POLL_CAP_MS) {
        stopPolling()
        setMpesaRequestStatus("failed")
        setMpesaError({ message: "Payment confirmation timeout (3 minutes). Please check the phone or try again.", status: 'TIMEOUT' })
        setPendingMpesaOrderId(null)
        setMpesaProcessing(false)
        return
      }
      const delay = elapsed < FAST_PHASE_MS ? FAST_INTERVAL : SLOW_INTERVAL
      mpesaPollIntervalRef.current = window.setTimeout(poll, delay)
    }

    const poll = () => {
      if (isStopped) return
      checkPaymentStatus().finally(() => {
        if (isStopped) return
        scheduleNext()
      })
    }
    poll()

    return () => {
      isStopped = true
      if (mpesaPollIntervalRef.current) {
        clearTimeout(mpesaPollIntervalRef.current)
        mpesaPollIntervalRef.current = null
      }
    }
  }, [pendingMpesaOrderId, mpesaCheckoutRequestId])

  const handleMpesaPayment = async () => {
    if (!mpesaPhoneNumber.trim() || !processingPayment) {
      toast.error("Please enter a phone number")
      return
    }
    const phoneNorm = normalizeKenyaPhone(mpesaPhoneNumber.trim())
    if (!phoneNorm) {
      toast.error("Please enter a valid Kenya phone number in the M-Pesa field")
      return
    }
    setMpesaError(null)
    setMpesaProcessing(true)
    setMpesaRequestStatus("sent")
    try {
      toast.loading("Initiating M-Pesa payment...", { id: "mpesa-push" })
      const putRes = await fetch("/api/catha/orders", {
        method: "PUT",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: processingPayment.id, customerPhone: phoneNorm }),
      })
      if (!putRes.ok) {
        const err = await putRes.json().catch(() => ({}))
        throw new Error(err?.error || "Could not save customer phone on order")
      }
      setOrders((prev) =>
        prev.map((o) => (o.id === processingPayment.id ? { ...o, customerPhone: phoneNorm } as Transaction : o))
      )
      const paySnapshot = summarizeCathaOrderPayments({
        ...processingPayment,
        customerPhone: phoneNorm,
      } as any)
      const stkAmount = Math.max(
        0.01,
        paySnapshot.balanceDue > 0.005 ? paySnapshot.balanceDue : Number(processingPayment.total) || 0
      )
      const stkResponse = await fetch('/api/mpesa/stk-push', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phoneNumber: phoneNorm,
          amount: stkAmount,
          accountReference: processingPayment.id,
          transactionDesc: `Payment for order ${processingPayment.id}`,
        }),
      })
      const stkData = await stkResponse.json()
      if (stkData.success) {
        setMpesaRequestStatus("waiting")
        toast.loading("Payment request sent! Waiting for confirmation...", { id: "mpesa-push" })
        setPendingMpesaOrderId(processingPayment.id)
        setMpesaCheckoutRequestId(stkData.data?.checkoutRequestID || null)
      } else {
        toast.dismiss("mpesa-push")
        setMpesaError({ message: stkData.error || "Failed to initiate payment. Please try again.", status: 'INITIATION_FAILED' })
        setMpesaProcessing(false)
        setMpesaRequestStatus("failed")
      }
    } catch (error: any) {
      toast.dismiss("mpesa-push")
      setMpesaError({ message: error.message || "Failed to process M-Pesa payment.", status: 'ERROR' })
      setMpesaProcessing(false)
      setMpesaRequestStatus("failed")
    }
  }

  const handleAcceptMenuOrder = async (orderId: string) => {
    const serverName = (session?.user as any)?.name ?? "Server"
    try {
      // Accept = claim for Preparing. Does not mark Served yet.
      await fetch("/api/catha/menu-orders", {
        method: "PUT",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, receivedBy: serverName }),
      })
      await fetch("/api/catha/orders", {
        method: "PUT",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: orderId, waiter: serverName }),
      })
      setOrders((prev) =>
        sortOrdersUnacceptedFirst(
          prev.map((o) => (o.id === orderId ? { ...o, waiter: serverName } : o)),
        ),
      )
    } catch {
      console.error("Failed to accept order")
    }
  }

  const handleServeMenuOrder = async (orderId: string) => {
    const serverName = (session?.user as any)?.name ?? "Server"
    try {
      toast.loading("Marking served…", { id: "serve-order" })
      await fetch("/api/catha/menu-orders", {
        method: "PUT",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId,
          status: "active",
          receivedBy: serverName,
          servedAt: new Date().toISOString(),
          servedBy: serverName,
        }),
      })
      const servedAt = new Date().toISOString()
      await fetch("/api/catha/orders", {
        method: "PUT",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: orderId,
          waiter: serverName,
          servedAt,
          servedBy: serverName,
        }),
      })
      setOrders((prev) =>
        sortOrdersUnacceptedFirst(
          prev.map((o) =>
            o.id === orderId
              ? { ...o, waiter: serverName, servedAt, servedBy: serverName }
              : o
          ),
        ),
      )
      toast.success("Marked served — guest tab updated", { id: "serve-order" })
    } catch {
      console.error("Failed to mark order served")
      toast.error("Could not mark served", { id: "serve-order" })
    }
  }

  const handleUnlinkMpesaFromOrder = async (orderId: string, transactionId: string) => {
    if (!confirm("Remove this M-Pesa link from the order? Totals will be recalculated.")) return
    setUnlinkingTxId(transactionId)
    try {
      const res = await fetch("/api/catha/orders/unlink-mpesa", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, transactionId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || "Unlink failed")
      toast.success("M-Pesa link removed")
      try {
        const freshRes = await fetch(`/api/catha/orders?id=${encodeURIComponent(orderId)}`, {
          cache: "no-store",
        })
        if (freshRes.ok) {
          const j = await freshRes.json()
          setProcessingPayment((prev) =>
            prev && prev.id === orderId ? (mapOrderRow(j) as Transaction) : prev
          )
        }
      } catch {
        /* ignore */
      }
      await fetchOrders()
    } catch (e: any) {
      toast.error(e?.message || "Failed to unlink")
    } finally {
      setUnlinkingTxId(null)
    }
  }

  const handleMarkChangeGivenSubmit = async (orderId: string) => {
    setMarkingChangeGiven(true)
    try {
      const res = await fetch("/api/catha/orders/mark-change-given", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, changeNotes: changeNotesDraft.trim() || undefined }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || "Update failed")
      toast.success("Change marked as given")
      setChangeNotesDraft("")
      await fetchOrders()
    } catch (e: any) {
      toast.error(e?.message || "Failed to save")
    } finally {
      setMarkingChangeGiven(false)
    }
  }

  const handleResendReceiptSms = async (order: Transaction) => {
    try {
      toast.loading(`Resending receipt SMS for ${order.id}...`, { id: `resend-sms-${order.id}` })
      const res = await fetch("/api/catha/orders/resend-receipt-sms", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: order.id }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data?.success !== true) {
        throw new Error(data?.reason || data?.error || "Failed to resend receipt SMS")
      }

      if (data?.order) {
        const next = mapOrderRow(data.order) as Transaction
        setOrders((prev) => prev.map((o) => (o.id === next.id ? next : o)))
      } else {
        await fetchOrders()
      }
      toast.success(`Receipt SMS sent for ${order.id}`, { id: `resend-sms-${order.id}` })
    } catch (e: any) {
      toast.error(e?.message || "Failed to resend receipt SMS", { id: `resend-sms-${order.id}` })
    }
  }

  const handleDeleteOrder = async (order: Transaction) => {
    if (!confirm(`Are you sure you want to delete order ${order.id}? This action cannot be undone.`)) {
      return
    }

    try {
      const response = await fetch(`/api/catha/orders?id=${order.id}`, {
        method: 'DELETE',
        cache: 'no-store',
      })

      if (!response.ok) throw new Error('Failed to delete order')

      await fetchOrders()
      alert(`Order ${order.id} deleted successfully`)
    } catch (error) {
      console.error('Error deleting order:', error)
      alert('Failed to delete order')
    }
  }

  const handlePrintOrder = (order: Transaction) => {
    setPrintingOrder(order)
  }

  const getPaymentBadgeClasses = (method: string) => {
    const m = method.toLowerCase()

    switch (m) {
      case "cash":
        return "bg-emerald-50 text-emerald-700 border-emerald-200"
      case "card":
        return "bg-blue-50 text-blue-700 border-blue-200"
      case "mpesa":
      case "m-pesa":
        return "bg-purple-50 text-purple-700 border-purple-200"
      case "glovo":
        return "bg-orange-50 text-orange-700 border-orange-200"
      default:
        return "bg-muted text-muted-foreground border-border"
    }
  }

  const statusChipCounts = { all: totalOrders, PAID: paidOrders, PARTIALLY_PAID: partiallyPaidOrders, NOT_PAID: notPaidOrders }

  return (
    <>
      {/* ========== MOBILE ONLY (< md) ========== */}
      <div className="md:hidden min-h-screen bg-[#F7F9FC]">
        <div className="sticky top-0 z-20 bg-white border-b border-[#e5e7eb] shadow-sm">
          <div className="grid grid-cols-[56px_1fr_44px] items-center h-14 px-2">
            <div className="w-11 h-11" />
            <h1 className="text-center text-lg font-semibold text-[#0f172a]">Orders</h1>
            <div className="flex justify-end">
              {mounted && session?.user && (
                <UserChip compact name={session.user.name} email={session.user.email} role={session.user.role} />
              )}
            </div>
          </div>
          <p className="text-[11px] text-[#94a3b8] text-center pb-2 -mt-1">
            {totalMatching} match{totalMatching === 1 ? "" : "es"}
            {totalPages > 1 ? ` · page ${ordersPage}/${totalPages}` : ""}
          </p>
          <div className="px-4 pb-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#94a3b8]" />
              <Input
                placeholder="Search orders..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 h-10 rounded-xl bg-[#f8fafc] border-[#e5e7eb] text-sm w-full"
              />
            </div>
          </div>
          <div className="flex gap-2 overflow-x-auto px-4 pb-3 scrollbar-hide">
            {(["all", "PAID", "PARTIALLY_PAID", "NOT_PAID"] as const).map((status) => (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold flex-shrink-0 transition-all ${
                  statusFilter === status ? "bg-primary text-white shadow-sm" : "bg-white border border-[#e5e7eb] text-[#64748b]"
                }`}
              >
                {status === "all" ? "All" : status === "PAID" ? "Paid" : status === "PARTIALLY_PAID" ? "Partially paid" : "Not paid"} ({statusChipCounts[status]})
              </button>
            ))}
          </div>
        </div>
        <div className="p-4 grid grid-cols-2 gap-3">
          <div className="bg-white rounded-xl border border-[#e5e7eb] p-4 shadow-sm">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#94a3b8] mb-1">Total Orders</p>
            <p className="text-2xl font-bold text-[#0f172a]">{totalOrders}</p>
            <p className="text-[11px] text-[#64748b] mt-0.5">Today</p>
            <div className="mt-2 flex justify-end">
              <div className="h-8 w-8 rounded-lg bg-[#ecfdf5] flex items-center justify-center">
                <Receipt className="h-4 w-4 text-primary" />
              </div>
            </div>
          </div>
          <div className="bg-white rounded-xl border border-[#e5e7eb] p-4 shadow-sm">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#94a3b8] mb-2">Payment Split</p>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  Paid
                </span>
                <span className="text-sm font-bold text-[#0f172a]">{paidOrders}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs">
                  <span className="h-2 w-2 rounded-full bg-amber-500" />
                  Partially paid
                </span>
                <span className="text-sm font-bold text-[#0f172a]">{partiallyPaidOrders}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs">
                  <span className="h-2 w-2 rounded-full bg-amber-500" />
                  Not paid
                </span>
                <span className="text-sm font-bold text-[#0f172a]">{notPaidOrders}</span>
              </div>
            </div>
          </div>
        </div>
        <div className="px-4 pb-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs text-[#64748b] px-2 py-1 rounded-lg bg-white border border-[#e5e7eb]">
              {statusFilter === "all" ? "All statuses" : statusFilter === "PAID" ? "Paid" : statusFilter === "PARTIALLY_PAID" ? "Partially paid" : "Not paid"}
            </span>
            <span className="text-xs text-[#64748b] px-2 py-1 rounded-lg bg-white border border-[#e5e7eb]">
              {paymentFilter === "all" ? "All payments" : paymentFilter.charAt(0).toUpperCase() + paymentFilter.slice(1)}
            </span>
            <Button variant="outline" size="sm" className="h-8 w-8 p-0 rounded-lg border-[#e5e7eb]" onClick={() => setFilterSheetOpen(true)}>
              <Filter className="h-4 w-4" />
            </Button>
          </div>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" />
            </div>
          ) : orders.length === 0 ? (
            <div className="bg-white rounded-xl border border-[#e5e7eb] p-8 text-center">
              <Receipt className="h-12 w-12 text-[#94a3b8] mx-auto mb-3" />
              <p className="text-sm font-medium text-[#64748b]">No orders found</p>
              <p className="text-xs text-[#94a3b8] mt-2">
                {dashboardSummary.totalOrders === 0
                  ? "Run the seed script if this is a fresh database."
                  : "Try another search or filter."}
              </p>
            </div>
          ) : (
            <>
            <div className="space-y-3">
              {orders.map((tx) => {
                const orderSource = (tx as any).orderSource || ((tx as any).cashier === "Customer" && (tx as any).customerPhone ? "menu" : "pos")
                const isMenuSource = orderSource === "menu"
                const waiterName = (tx as any).waiter as string | undefined
                const servedAt = (tx as any).servedAt as string | Date | null | undefined
                const tableLabel = formatTableLabel(tx.table)
                const orderData = {
                  id: tx.id,
                  timestamp: tx.timestamp,
                  status: tx.status,
                  paymentStatus: getStatusLabel((tx as any).paymentStatus || tx.status),
                  items: (Array.isArray(tx.items) ? tx.items : []).map((item) => ({ name: item.name || "Unknown", quantity: item.quantity || 0, price: item.price || 0 })),
                  total: tx.total ?? null,
                  customerName: (tx as any).customerName || undefined,
                  customerPhone: (tx as any).customerPhone || null,
                  paymentMethod: tx.paymentMethod || null,
                  orderSource,
                  servedAt: servedAt ?? null,
                  table: tableLabel,
                  amountReceived:
                    (tx as any).totalLinkedPayments ?? (tx as any).cashAmount ?? (tx as any).amountReceived ?? null,
                  balanceDue: (tx as any).balanceDue ?? null,
                  paymentReceiptSmsStatus: (tx as any).paymentReceiptSmsStatus ?? null,
                  paymentReceiptSmsSentAt: (tx as any).paymentReceiptSmsSentAt ?? null,
                }
                // Accept only shows when not yet accepted (waiter still "Customer")
                const payLabel = getStatusLabel((tx as any).paymentStatus || tx.status)
                const unpaid = payLabel === "NOT_PAID" || payLabel === "PARTIALLY_PAID"
                const isPendingMenuOrder =
                  unpaid &&
                  isMenuSource &&
                  (!waiterName || waiterName === "Customer")
                const canServeMenuOrder =
                  unpaid &&
                  isMenuSource &&
                  !!waiterName &&
                  waiterName !== "Customer" &&
                  !servedAt
                return (
                  <div key={tx.id} className="relative">
                    {isPendingMenuOrder && (
                      <div className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-t-xl bg-gradient-to-r from-orange-500 to-amber-500 -mb-1">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="inline-flex items-center justify-center min-w-[2.75rem] h-8 rounded-lg bg-white text-orange-700 text-sm font-black px-2 shrink-0">
                            {tableLabel ? `T${tableLabel}` : "T—"}
                          </span>
                          <div className="min-w-0">
                            <p className="text-white text-xs font-bold uppercase tracking-wide">New order — Accept</p>
                            {(tx as any).customerPhone && (
                              <p className="text-white/80 text-[10px] font-mono truncate">{(tx as any).customerPhone}</p>
                            )}
                          </div>
                        </div>
                        <button
                          onClick={() => handleAcceptMenuOrder(tx.id)}
                          className="flex items-center gap-1.5 bg-white text-orange-700 text-xs font-bold px-3 py-1.5 rounded-full transition-all active:scale-95 shrink-0 shadow-sm"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Accept
                        </button>
                      </div>
                    )}
                    {canServeMenuOrder && (
                      <div className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-t-xl bg-gradient-to-r from-amber-600 to-orange-500 -mb-1">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="inline-flex items-center justify-center min-w-[2.75rem] h-8 rounded-lg bg-white text-orange-800 text-sm font-black px-2 shrink-0">
                            {tableLabel ? `T${tableLabel}` : "T—"}
                          </span>
                          <p className="text-white text-xs font-bold uppercase tracking-wide truncate">
                            Preparing — tap Served
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleServeMenuOrder(tx.id)}
                          className="flex items-center gap-1.5 bg-white text-orange-700 text-xs font-bold px-3 py-1.5 rounded-full transition-all active:scale-95 flex-shrink-0 shadow-sm"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Served
                        </button>
                      </div>
                    )}
                    <OrderCardMobile
                      order={orderData}
                      originalOrder={tx}
                      onView={handleViewClick}
                      onPrint={handlePrintOrder}
                      onDelete={canDelete ? handleDeleteOrder : undefined}
                      onPay={tx.status !== "completed" ? handlePaymentClick : undefined}
                      onServe={canServeMenuOrder ? () => handleServeMenuOrder(tx.id) : undefined}
                      onEdit={canEdit && tx.status !== "completed" ? handleEditClick : undefined}
                      onAddItems={canEdit && tx.status === "pending" ? handleAddItemsClick : undefined}
                      onResendMessage={tx.status === "completed" && Boolean((tx as any).customerPhone) ? handleResendReceiptSms : undefined}
                    />
                  </div>
                )
              })}
            </div>
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-3 mt-4">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9 rounded-xl border-[#e5e7eb]"
                  disabled={ordersPage <= 1}
                  onClick={() => setOrdersPage((p) => Math.max(1, p - 1))}
                  aria-label="Previous page"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-xs text-[#64748b] tabular-nums">
                  {rangeStart}–{rangeEnd} of {totalMatching}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9 rounded-xl border-[#e5e7eb]"
                  disabled={ordersPage >= totalPages}
                  onClick={() => setOrdersPage((p) => Math.min(totalPages, p + 1))}
                  aria-label="Next page"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            )}
            </>
          )}
        </div>
      </div>

      {/* ========== DESKTOP / LARGER SCREENS (md+) - ONE scroll (main) ========== */}
      <div className="hidden md:block bg-[#f8fafc] min-h-0">
        {/* Header - sticky so it stays visible when main scrolls */}
        <div className="sticky top-0 z-10 bg-white border-b border-slate-200/60 px-6 py-4 nest-hub-max:py-2 nest-hub-max:px-4 shrink-0">
          <div className="flex items-center justify-between nest-hub-max:mb-2">
            <div>
              <h1 className="text-2xl font-semibold text-[#0f172a] nest-hub-max:text-xl">Orders</h1>
              <p className="text-sm text-[#64748b] mt-1 nest-hub-max:mt-0.5 nest-hub-max:text-xs nest-hub-max:font-medium nest-hub-max:text-slate-600">Today</p>
            </div>
            {mounted && session?.user && (
              <UserChip
                name={session.user.name}
                email={session.user.email}
                role={session.user.role}
              />
            )}
          </div>
          
          {/* Search and filters - compact + horizontal scroll on tablet zone */}
          <div className="flex flex-wrap items-center gap-3 nest-hub-max:flex-nowrap nest-hub-max:gap-2 nest-hub-max:overflow-x-auto nest-hub-max:scrollbar-hide nest-hub-max:pb-1">
            <div className="relative flex-1 min-w-[200px] nest-hub-max:min-w-[140px] nest-hub-max:flex-shrink-0">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#64748b]" />
              <Input
                placeholder="Search orders, customer, items..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 h-10 bg-white border-[#e5e7eb] nest-hub-max:h-9 nest-hub-max:text-sm"
              />
            </div>
            
            {/* Status filter pills - compact on tablet */}
            <div className="flex items-center gap-2 nest-hub-max:gap-1.5 nest-hub-max:flex-shrink-0">
              {(["all", "PAID", "PARTIALLY_PAID", "NOT_PAID"] as const).map((status) => (
                <button
                  key={status}
                  onClick={() => setStatusFilter(status)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all nest-hub-max:px-2 nest-hub-max:py-1 nest-hub-max:text-[11px] nest-hub-max:rounded-md ${
                    statusFilter === status
                      ? "bg-[#2563eb] text-white"
                      : "bg-white border border-[#e5e7eb] text-[#64748b] hover:bg-[#f3f4f6]"
                  }`}
                >
                  {status === "all" ? "All" : status === "PAID" ? "Paid" : status === "PARTIALLY_PAID" ? "Partially paid" : "Not paid"}
                </button>
              ))}
            </div>
            
            {/* Payment filter pills - compact on tablet */}
            <div className="flex items-center gap-2 nest-hub-max:gap-1.5 nest-hub-max:flex-shrink-0">
              {(["all", "glovo", "mpesa", "card"] as const).map((method) => (
                <button
                  key={method}
                  onClick={() => setPaymentFilter(method)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all nest-hub-max:px-2 nest-hub-max:py-1 nest-hub-max:text-[11px] nest-hub-max:rounded-md ${
                    paymentFilter === method
                      ? "bg-[#2563eb] text-white"
                      : "bg-white border border-[#e5e7eb] text-[#64748b] hover:bg-[#f3f4f6]"
                  }`}
                >
                  {method === "all" ? "All" : method.charAt(0).toUpperCase() + method.slice(1)}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="p-6 space-y-6 nest-hub-max:p-3 nest-hub-max:space-y-2">
          {/* Top summary row */}
          <div className="flex items-center justify-between gap-4 nest-hub-max:gap-2 nest-hub-max:shrink-0">
            <div className="flex items-center gap-3 nest-hub-max:gap-2">
              <div className="h-10 w-10 rounded-2xl bg-primary/10 flex items-center justify-center nest-hub-max:h-8 nest-hub-max:w-8 nest-hub-max:rounded-xl">
                <Receipt className="h-5 w-5 text-primary nest-hub-max:h-4 nest-hub-max:w-4" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-foreground nest-hub-max:text-base nest-hub-max:font-semibold nest-hub-max:text-slate-800">Order Overview</h2>
                <p className="text-sm text-muted-foreground nest-hub-max:text-xs nest-hub-max:font-medium nest-hub-max:text-slate-600">
                  Sorted by most recent first · {totalMatching} match{totalMatching === 1 ? "" : "es"}
                  {totalPages > 1 ? ` · page ${ordersPage} of ${totalPages}` : ""}
                </p>
              </div>
            </div>
            <div className="flex gap-2 nest-hub-max:gap-1.5">
              {selectedOrders.size > 0 && (
                <div className="flex gap-2 items-center">
                  <span className="text-sm font-semibold text-foreground">
                    {selectedOrders.size} selected
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleBulkPayment("card")}
                    className="bg-sky-50 text-sky-700 border-sky-300 hover:bg-sky-100"
                  >
                    Pay Card
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleBulkPayment("mpesa")}
                    className="bg-purple-50 text-purple-700 border-purple-300 hover:bg-purple-100"
                  >
                    Pay M-Pesa
                  </Button>
                </div>
              )}
            <Button variant="outline" className="gap-2 bg-transparent nest-hub-max:h-9 nest-hub-max:text-sm nest-hub-max:px-2.5">
              <Download className="h-4 w-4 nest-hub-max:h-3.5 nest-hub-max:w-3.5" />
              Export
            </Button>
            </div>
          </div>

          {/* Key stats - compact on tablet */}
          <div className="grid gap-4 md:grid-cols-3 nest-hub-max:gap-2 nest-hub-max:grid-cols-3 nest-hub-max:shrink-0">
            <Card className="border border-border shadow-sm bg-background nest-hub-max:border-slate-200">
              <CardContent className="flex items-center justify-between p-5 nest-hub-max:p-3">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2 font-semibold nest-hub-max:mb-1 nest-hub-max:text-[10px] nest-hub-max:font-semibold nest-hub-max:text-slate-600">Total Orders</p>
                  <p className="text-3xl font-black text-primary nest-hub-max:text-xl nest-hub-max:font-bold">{totalOrders}</p>
                </div>
                <div className="rounded-lg bg-primary/10 p-3 border border-primary/20 nest-hub-max:p-2 nest-hub-max:rounded-md">
                  <ShoppingBag className="h-6 w-6 text-primary nest-hub-max:h-4 nest-hub-max:w-4" />
                </div>
              </CardContent>
            </Card>
            <Card className="border border-border shadow-sm bg-background nest-hub-max:border-slate-200">
              <CardContent className="p-5 nest-hub-max:p-3">
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-4 font-semibold nest-hub-max:mb-2 nest-hub-max:text-[10px] nest-hub-max:font-semibold nest-hub-max:text-slate-600">Payment Status</p>
                <div className="space-y-3 nest-hub-max:space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5 nest-hub-max:gap-1.5">
                      <span className="h-3 w-3 rounded-full bg-emerald-500 shadow-sm nest-hub-max:h-2 nest-hub-max:w-2" />
                      <span className="text-sm font-semibold text-foreground nest-hub-max:text-xs nest-hub-max:font-semibold nest-hub-max:text-slate-800">Paid</span>
                    </div>
                    <span className="text-2xl font-black text-emerald-600 nest-hub-max:text-lg nest-hub-max:font-bold">{paidOrders}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5 nest-hub-max:gap-1.5">
                      <span className="h-3 w-3 rounded-full bg-amber-500 shadow-sm nest-hub-max:h-2 nest-hub-max:w-2" />
                      <span className="text-sm font-semibold text-foreground nest-hub-max:text-xs nest-hub-max:font-semibold nest-hub-max:text-slate-800">Unpaid</span>
                    </div>
                    <span className="text-2xl font-black text-amber-600 nest-hub-max:text-lg nest-hub-max:font-bold">{unpaidOrders}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="border border-border shadow-sm bg-background nest-hub-max:border-slate-200">
              <CardContent className="flex items-center justify-between p-5 nest-hub-max:p-3">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2 font-semibold nest-hub-max:mb-1 nest-hub-max:text-[10px] nest-hub-max:font-semibold nest-hub-max:text-slate-600">Total Items Sold</p>
                  <p className="text-3xl font-black text-primary nest-hub-max:text-xl nest-hub-max:font-bold">{totalItems}</p>
                </div>
                <div className="rounded-lg bg-primary/10 p-3 border border-primary/20 nest-hub-max:p-2 nest-hub-max:rounded-md">
                  <Wallet2 className="h-6 w-6 text-primary nest-hub-max:h-4 nest-hub-max:w-4" />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Orders Section - normal flow, no nested scroll */}
          <Card className="border border-[#e5e7eb] shadow-sm nest-hub-max:gap-0 nest-hub-max:py-0">
            {/* Modern Premium Toolbar */}
            <div className="bg-white border-b border-[#e5e7eb] nest-hub-max:bg-white/80 nest-hub-max:border-slate-200 nest-hub-max:shrink-0">
              {/* Desktop Layout - hidden on Nest Hub Max */}
              <div className="hidden md:flex nest-hub-max:!hidden items-center justify-between px-5 py-4 gap-4">
                {/* Left: Title + Subtitle */}
                <div className="flex-shrink-0">
                  <h2 className="text-xl font-semibold text-[#0f172a]">All Orders</h2>
                  <p className="text-sm text-[#64748b] mt-0.5">Manage orders, payments, and receipts.</p>
                </div>

                {/* Right: Toolbar Controls */}
                <div className="flex items-center gap-3">
                  {/* Search */}
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#94a3b8]" />
                    <Input
                      placeholder="Search by order #, customer, phone…"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="h-10 w-[280px] pl-10 pr-4 text-sm rounded-xl border-[#e5e7eb] bg-[#f8fafc] focus:bg-white focus:border-[#2563eb] transition-colors"
                    />
                  </div>

                  {/* Status Filter */}
                  {mounted ? (
                    <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
                      <SelectTrigger className="h-10 w-[140px] rounded-xl border-[#e5e7eb] bg-white text-sm font-medium">
                        <SelectValue placeholder="All statuses" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All statuses</SelectItem>
                        <SelectItem value="PAID">
                          <span className="flex items-center gap-2">
                            <span className="h-2 w-2 rounded-full bg-[#16a34a]" />
                            Paid
                          </span>
                        </SelectItem>
                        <SelectItem value="PARTIALLY_PAID">
                          <span className="flex items-center gap-2">
                            <span className="h-2 w-2 rounded-full bg-[#f59e0b]" />
                            Partially paid
                          </span>
                        </SelectItem>
                        <SelectItem value="NOT_PAID">
                          <span className="flex items-center gap-2">
                            <span className="h-2 w-2 rounded-full bg-[#ef4444]" />
                            Not Paid
                          </span>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <div className="h-10 w-[140px] rounded-xl border border-[#e5e7eb] bg-[#f8fafc] animate-pulse" />
                  )}

                  {/* Payment Filter */}
                  {mounted ? (
                    <Select value={paymentFilter} onValueChange={(v) => setPaymentFilter(v as any)}>
                      <SelectTrigger className="h-10 w-[140px] rounded-xl border-[#e5e7eb] bg-white text-sm font-medium">
                        <SelectValue placeholder="All payments" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All payments</SelectItem>
                        <SelectItem value="glovo">
                          <span className="flex items-center gap-2">
                            <Truck className="h-3.5 w-3.5 text-[#ea580c]" />
                            Glovo
                          </span>
                        </SelectItem>
                        <SelectItem value="mpesa">
                          <span className="flex items-center gap-2">
                            <Smartphone className="h-3.5 w-3.5 text-[#7c3aed]" />
                            M-Pesa
                          </span>
                        </SelectItem>
                        <SelectItem value="card">
                          <span className="flex items-center gap-2">
                            Card
                          </span>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <div className="h-10 w-[140px] rounded-xl border border-[#e5e7eb] bg-[#f8fafc] animate-pulse" />
                  )}

                  {/* View Toggle - Segmented Control */}
                  <div className="flex items-center bg-[#f1f5f9] rounded-full p-1">
                    <button
                      type="button"
                      onClick={() => setView("table")}
                      className={`flex items-center gap-1.5 px-3.5 py-2 rounded-full text-sm font-medium transition-all ${
                        view === "table"
                          ? "bg-white text-[#0f172a] shadow-sm"
                          : "text-[#64748b] hover:text-[#0f172a]"
                      }`}
                    >
                      <TableIcon className="h-4 w-4" />
                      Table
                    </button>
                    <button
                      type="button"
                      onClick={() => setView("cards")}
                      className={`flex items-center gap-1.5 px-3.5 py-2 rounded-full text-sm font-medium transition-all ${
                        view === "cards"
                          ? "bg-white text-[#0f172a] shadow-sm"
                          : "text-[#64748b] hover:text-[#0f172a]"
                      }`}
                    >
                      <LayoutGrid className="h-4 w-4" />
                      Cards
                    </button>
                  </div>
                </div>
              </div>

              {/* Nest Hub Max / Tablet Landscape - 2-row compact toolbar */}
              <div className="hidden nest-hub-max:grid nest-hub-max:grid-rows-[auto_auto] nest-hub-max:gap-2 nest-hub-max:px-4 nest-hub-max:py-3">
                {/* Row 1: Title (left) | View toggle + Export (right) */}
                <div className="grid grid-cols-[1fr_auto] items-center gap-2">
                  <div>
                    <h2 className="text-xl font-semibold text-[#0f172a] nest-hub-max:text-lg">All Orders</h2>
                    <p className="text-sm text-[#64748b] nest-hub-max:text-xs nest-hub-max:font-medium nest-hub-max:text-slate-600">Manage orders, payments, and receipts.</p>
                  </div>
                  <div className="flex items-center gap-2 h-10">
                    <div className="flex items-center bg-[#f1f5f9] rounded-full p-1 h-10">
                      <button
                        type="button"
                        onClick={() => setView("table")}
                        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-sm font-medium transition-all h-8 ${
                          view === "table"
                            ? "bg-white text-[#0f172a] shadow-sm"
                            : "text-[#64748b] hover:text-[#0f172a]"
                        }`}
                      >
                        <TableIcon className="h-3.5 w-3.5" />
                        Table
                      </button>
                      <button
                        type="button"
                        onClick={() => setView("cards")}
                        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-sm font-medium transition-all h-8 ${
                          view === "cards"
                            ? "bg-white text-[#0f172a] shadow-sm"
                            : "text-[#64748b] hover:text-[#0f172a]"
                        }`}
                      >
                        <LayoutGrid className="h-3.5 w-3.5" />
                        Cards
                      </button>
                    </div>
                    <Button variant="outline" size="sm" className="h-9 gap-1.5 px-2.5 text-sm shrink-0">
                      <Download className="h-3.5 w-3.5" />
                      Export
                    </Button>
                  </div>
                </div>
                {/* Row 2: Search (1fr) | Status | Payment */}
                <div className="grid grid-cols-[1fr_auto_auto] items-center gap-2">
                  <div className="relative min-w-0">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#94a3b8]" />
                    <Input
                      placeholder="Search by order #, customer, phone…"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="h-10 min-h-[40px] pl-10 pr-4 text-sm rounded-xl border-slate-200 bg-white/80 focus:bg-white focus:border-[#2563eb] transition-colors w-full"
                    />
                  </div>
                  {mounted ? (
                    <>
                      <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
                        <SelectTrigger className="h-10 min-h-[40px] w-[120px] rounded-xl border-slate-200 bg-white/80 text-sm font-medium shrink-0">
                          <SelectValue placeholder="All statuses" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All statuses</SelectItem>
                          <SelectItem value="PAID">
                            <span className="flex items-center gap-2">
                              <span className="h-2 w-2 rounded-full bg-[#16a34a]" />
                              Paid
                            </span>
                          </SelectItem>
                          <SelectItem value="PARTIALLY_PAID">
                            <span className="flex items-center gap-2">
                              <span className="h-2 w-2 rounded-full bg-[#f59e0b]" />
                              Partially paid
                            </span>
                          </SelectItem>
                          <SelectItem value="NOT_PAID">
                            <span className="flex items-center gap-2">
                              <span className="h-2 w-2 rounded-full bg-[#ef4444]" />
                              Not Paid
                            </span>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <Select value={paymentFilter} onValueChange={(v) => setPaymentFilter(v as any)}>
                        <SelectTrigger className="h-10 min-h-[40px] w-[110px] rounded-xl border-slate-200 bg-white/80 text-sm font-medium shrink-0">
                          <SelectValue placeholder="All payments" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All payments</SelectItem>
                          <SelectItem value="glovo">
                            <span className="flex items-center gap-2">
                              <Truck className="h-3.5 w-3.5 text-[#ea580c]" />
                              Glovo
                            </span>
                          </SelectItem>
                          <SelectItem value="mpesa">
                            <span className="flex items-center gap-2">
                              <Smartphone className="h-3.5 w-3.5 text-[#7c3aed]" />
                              M-Pesa
                            </span>
                          </SelectItem>
                          <SelectItem value="card">
                            <span className="flex items-center gap-2">Card</span>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </>
                  ) : (
                    <>
                      <div className="h-10 w-[120px] rounded-xl border border-slate-200 bg-slate-100 animate-pulse shrink-0" />
                      <div className="h-10 w-[110px] rounded-xl border border-slate-200 bg-slate-100 animate-pulse shrink-0" />
                    </>
                  )}
                </div>
              </div>

              {/* Mobile Layout */}
              <div className="md:hidden px-4 py-3 space-y-3">
                {/* Row 1: Title + View Toggle */}
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-[#0f172a]">All Orders</h2>
                    <p className="text-xs text-[#64748b]">Manage orders & payments</p>
                  </div>
                  <div className="flex items-center bg-[#f1f5f9] rounded-full p-0.5">
                    <button
                      type="button"
                      onClick={() => setView("table")}
                      className={`p-2 rounded-full transition-all ${
                        view === "table"
                          ? "bg-white text-[#0f172a] shadow-sm"
                          : "text-[#64748b]"
                      }`}
                    >
                      <TableIcon className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setView("cards")}
                      className={`p-2 rounded-full transition-all ${
                        view === "cards"
                          ? "bg-white text-[#0f172a] shadow-sm"
                          : "text-[#64748b]"
                      }`}
                    >
                      <LayoutGrid className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {/* Row 2: Search */}
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#94a3b8]" />
                  <Input
                    placeholder="Search orders…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="h-10 w-full pl-10 pr-4 text-sm rounded-xl border-[#e5e7eb] bg-[#f8fafc] focus:bg-white"
                  />
                </div>

                {/* Row 3: Filters */}
                <div className="grid grid-cols-2 gap-2">
                  {mounted ? (
                    <>
                      <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
                        <SelectTrigger className="h-10 rounded-xl border-[#e5e7eb] bg-white text-sm">
                          <SelectValue placeholder="Status" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All statuses</SelectItem>
                          <SelectItem value="PAID">Paid</SelectItem>
                          <SelectItem value="PARTIALLY_PAID">Partially paid</SelectItem>
                          <SelectItem value="NOT_PAID">Not paid</SelectItem>
                        </SelectContent>
                      </Select>
                      <Select value={paymentFilter} onValueChange={(v) => setPaymentFilter(v as any)}>
                        <SelectTrigger className="h-10 rounded-xl border-[#e5e7eb] bg-white text-sm">
                          <SelectValue placeholder="Payment" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All payments</SelectItem>
                          <SelectItem value="glovo">Glovo</SelectItem>
                          <SelectItem value="mpesa">M-Pesa</SelectItem>
                          <SelectItem value="card">Card</SelectItem>
                        </SelectContent>
                      </Select>
                    </>
                  ) : (
                    <>
                      <div className="h-10 rounded-xl border border-[#e5e7eb] bg-[#f8fafc] animate-pulse" />
                      <div className="h-10 rounded-xl border border-[#e5e7eb] bg-[#f8fafc] animate-pulse" />
                    </>
                  )}
                </div>
              </div>

              {/* Summary Strip - Quick Stats - compact on tablet */}
              <div className="px-5 py-2.5 bg-[#f8fafc] border-t border-[#e5e7eb] flex flex-wrap items-center gap-x-6 gap-y-2 w-full min-w-0 text-xs overflow-x-auto nest-hub-max:px-4 nest-hub-max:py-1.5 nest-hub-max:gap-x-4 nest-hub-max:shrink-0">
                <div className="flex items-center gap-1.5 whitespace-nowrap">
                  <span className="h-2 w-2 rounded-full bg-[#16a34a]" />
                  <span className="text-[#64748b]">Paid:</span>
                  <span className="font-semibold text-[#0f172a]">{paidOrders}</span>
                </div>
                <div className="flex items-center gap-1.5 whitespace-nowrap">
                  <span className="h-2 w-2 rounded-full bg-[#f59e0b]" />
                  <span className="text-[#64748b]">Partially paid:</span>
                  <span className="font-semibold text-[#0f172a]">{partiallyPaidOrders}</span>
                </div>
                <div className="flex items-center gap-1.5 whitespace-nowrap">
                  <span className="h-2 w-2 rounded-full bg-[#ef4444]" />
                  <span className="text-[#64748b]">Not paid:</span>
                  <span className="font-semibold text-[#0f172a]">{notPaidOrders}</span>
                </div>
                <div className="h-4 w-px bg-[#e5e7eb]" />
                <div className="flex items-center gap-1.5 whitespace-nowrap">
                  <span className="text-[#64748b]">Showing:</span>
                  <span className="font-semibold text-[#0f172a] tabular-nums">
                    {rangeStart}–{rangeEnd} of {totalMatching}
                  </span>
                </div>
                {totalPages > 1 && (
                  <div className="flex items-center gap-1 ml-auto shrink-0">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 rounded-lg border-[#e5e7eb] nest-hub-max:h-7"
                      disabled={ordersPage <= 1}
                      onClick={() => setOrdersPage((p) => Math.max(1, p - 1))}
                      aria-label="Previous page"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="text-[11px] text-[#64748b] tabular-nums min-w-[4.5rem] text-center">
                      {ordersPage}/{totalPages}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 rounded-lg border-[#e5e7eb] nest-hub-max:h-7"
                      disabled={ordersPage >= totalPages}
                      onClick={() => setOrdersPage((p) => Math.min(totalPages, p + 1))}
                      aria-label="Next page"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
            </div>
            <CardContent className="p-4 nest-hub-max:p-3">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="text-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
                    <p className="text-sm text-muted-foreground">Loading orders...</p>
                  </div>
                </div>
              ) : orders.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <Receipt className="h-12 w-12 text-muted-foreground mb-4" />
                  <p className="text-lg font-semibold text-foreground mb-2">No orders found</p>
                  <p className="text-sm text-muted-foreground text-center">
                    {dashboardSummary.totalOrders === 0
                      ? "No orders in the database. Run the seed script to add sample orders."
                      : "No orders match your current filters or search."}
                  </p>
                </div>
              ) : view === "table" ? (
                /* ============ PREMIUM REDESIGNED TABLE ============ */
                <div className="overflow-x-auto rounded-2xl border border-[#e5e7eb] bg-white shadow-sm">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-[#f8fafc] border-b border-[#e5e7eb] hover:bg-[#f8fafc]">
                        <TableHead className="w-12 px-4 py-3">
                          <button
                            onClick={() => {
                              if (selectedOrders.size === orders.length) {
                                setSelectedOrders(new Set())
                              } else {
                                setSelectedOrders(new Set(orders.map((o) => o.id)))
                              }
                            }}
                            className="flex items-center justify-center p-1 rounded hover:bg-white/80 transition-colors"
                          >
                            {selectedOrders.size === orders.length && orders.length > 0 ? (
                              <CheckSquare className="h-4 w-4 text-[#2563eb]" />
                            ) : (
                              <Square className="h-4 w-4 text-slate-400" />
                            )}
                          </button>
                        </TableHead>
                        <TableHead className="px-4 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Order</TableHead>
                        <TableHead className="px-4 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Time</TableHead>
                        <TableHead className="px-4 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Service</TableHead>
                        <TableHead className="px-4 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Staff</TableHead>
                        <TableHead className="px-4 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Payment</TableHead>
                        <TableHead className="px-4 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider text-center">Message</TableHead>
                        <TableHead className="px-4 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider text-right">Total</TableHead>
                        <TableHead className="px-4 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider text-center">Status</TableHead>
                        <TableHead className="px-4 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {orders.map((tx) => {
                        const lineItems = Array.isArray(tx.items) ? tx.items : []
                        const itemCount = lineItems.reduce((sum, i) => sum + (Number(i.quantity) || 0), 0)
                        const customerName = (tx as any).customerName || null
                        const customerPhone = (tx as any).customerPhone || null
                        const payStatus = getStatusLabel((tx as any).paymentStatus || tx.status)
                        const isPaid = payStatus === "PAID"
                        const isPartiallyPaid = payStatus === "PARTIALLY_PAID"
                        const cashAmount = Number((tx as any).cashAmount)
                        const cashBalance = Number((tx as any).cashBalance)
                        const total = Number(tx.total) || 0
                        const messageDelivery = getMessageDeliveryState(tx as any)
                        const ts =
                          tx.timestamp instanceof Date
                            ? tx.timestamp
                            : tx.timestamp
                              ? new Date(tx.timestamp)
                              : null
                        const tsOk = ts && !Number.isNaN(ts.getTime())
                        
                        let paymentDetail = ""
                        if (isPaid && String(tx.paymentMethod || "").toLowerCase() === "cash" && Number.isFinite(cashAmount)) {
                          paymentDetail = `Rec: KSh ${cashAmount.toFixed(2)}`
                          if (Number.isFinite(cashBalance) && cashBalance > 0) {
                            paymentDetail += ` • Chg: KSh ${cashBalance.toFixed(2)}`
                          }
                        } else if (isPaid && String(tx.paymentMethod || "").toLowerCase() === "mpesa" && tx.mpesaReceiptNumber) {
                          paymentDetail = `#${tx.mpesaReceiptNumber}`
                        } else if (isPaid && String(tx.paymentMethod || "").toLowerCase() === "glovo" && (tx as any).glovoOrderNumber) {
                          paymentDetail = `Glovo #${(tx as any).glovoOrderNumber}`
                        } else if (isPaid && String(tx.paymentMethod || "").toLowerCase() === "card" && ((tx as any).cardTransactionReference || (tx as any).paymentReference || (tx as any).reference)) {
                          const ref = (tx as any).cardTransactionReference || (tx as any).paymentReference || (tx as any).reference
                          paymentDetail = `Card #${String(ref)}`
                        } else if (isPartiallyPaid && Number.isFinite(cashAmount)) {
                          paymentDetail = `Rec: KSh ${cashAmount.toFixed(2)} • Due: KSh ${Math.max(0, total - cashAmount).toFixed(2)}`
                        } else if (payStatus === "NOT_PAID") {
                          paymentDetail = "Not paid"
                        }
                        
                        return (
                          <TableRow 
                            key={tx.id} 
                            className="border-b border-[#f1f5f9] hover:bg-[#f9fafb] transition-colors"
                          >
                            {/* Checkbox */}
                            <TableCell className="px-4 py-3">
                              <button
                                onClick={() => toggleOrderSelection(tx.id)}
                                className="flex items-center justify-center p-1 rounded hover:bg-slate-100 transition-colors"
                              >
                                {selectedOrders.has(tx.id) ? (
                                  <CheckSquare className="h-4 w-4 text-[#2563eb]" />
                                ) : (
                                  <Square className="h-4 w-4 text-slate-300 hover:text-slate-500 transition-colors" />
                                )}
                              </button>
                            </TableCell>
                            
                            {/* Order (2-line: Order # + Customer) */}
                            <TableCell className="px-4 py-3">
                              <div className="flex flex-col gap-0.5">
                                <span className="font-mono text-sm font-semibold text-slate-900">#{tx.id}</span>
                                {(customerName || customerPhone) && (
                                  <span className="text-xs text-slate-500 truncate max-w-[180px]">
                                    {customerName}{customerName && customerPhone && " • "}{customerPhone}
                                  </span>
                                )}
                              </div>
                            </TableCell>
                            
                            {/* Time (date + time stacked) */}
                            <TableCell className="px-4 py-3">
                              <div className="flex flex-col gap-0.5">
                                <span className="text-sm text-slate-700">
                                  {tsOk
                                    ? ts!.toLocaleDateString("en-KE", { day: "numeric", month: "short" })
                                    : "—"}
                                </span>
                                <span className="text-xs text-slate-400">
                                  {tsOk
                                    ? ts!.toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" })
                                    : "—"}
                                </span>
                              </div>
                            </TableCell>
                            
                            {/* Service (Type + Table badge if inhouse) */}
                            <TableCell className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-md ${
                                  tx.table ? "bg-violet-50 text-violet-700" : "bg-slate-100 text-slate-600"
                                }`}>
                                  {tx.table ? <UtensilsCrossed className="h-3 w-3" /> : <ShoppingCart className="h-3 w-3" />}
                                  {tx.table ? "Inhouse" : "Takeout"}
                                </span>
                                {tx.table && (
                                  <span className="text-xs font-medium text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                                    T{tx.table}
                                  </span>
                                )}
                              </div>
                            </TableCell>
                            
                            {/* Staff (Waiter + Cashier stacked) */}
                            <TableCell className="px-4 py-3">
                              <div className="flex flex-col gap-0.5 text-sm">
                                {tx.waiter && (
                                  <span className="text-slate-700">{tx.waiter}</span>
                                )}
                                {tx.cashier && tx.cashier !== tx.waiter && (
                                  <span className="text-xs text-slate-400">{tx.cashier}</span>
                                )}
                                {!tx.waiter && !tx.cashier && (
                                  <span className="text-slate-400">—</span>
                                )}
                              </div>
                            </TableCell>
                            
                            {/* Payment (method + small secondary info) */}
                            <TableCell className="px-4 py-3">
                              <div className="flex flex-col gap-1">
                                <PaymentBadge method={tx.paymentMethod} />
                                {paymentDetail && (
                                  <span className="text-[11px] text-slate-400 truncate max-w-[140px]">
                                    {paymentDetail}
                                  </span>
                                )}
                              </div>
                            </TableCell>

                            {/* Message delivery (receipt sms) */}
                            <TableCell className="px-4 py-3 text-center">
                              <span
                                title={messageDelivery.title}
                                className={`inline-flex items-center rounded-full border px-2 py-1 text-[11px] font-medium ${messageDelivery.className}`}
                              >
                                {messageDelivery.label}
                              </span>
                            </TableCell>
                            
                            {/* Total (biggest in row, right aligned) */}
                            <TableCell className="px-4 py-3 text-right">
                              <div className="flex flex-col items-end gap-0.5">
                                <span className="text-lg font-bold text-slate-900 tabular-nums">
                                  KSh {(tx.total ?? 0).toLocaleString("en-KE", { minimumFractionDigits: 2 })}
                                </span>
                                <span className="text-[11px] text-slate-400">
                                  {itemCount} item{itemCount !== 1 ? "s" : ""}
                                </span>
                              </div>
                            </TableCell>
                            
                            {/* Status (badge) */}
                            <TableCell className="px-4 py-3 text-center">
                              <StatusBadge status={tx.status} />
                            </TableCell>
                            
                            {/* Actions (2 quick + More menu) */}
                            <TableCell className="px-4 py-3">
                              <div className="flex items-center justify-end gap-1">
                                <IconButton 
                                  icon={<Eye className="h-4 w-4" />} 
                                  onClick={() => handleViewClick(tx)} 
                                  title="View order"
                                />
                                <IconButton 
                                  icon={<Printer className="h-4 w-4" />} 
                                  onClick={() => handlePrintOrder(tx)} 
                                  title="Print receipt"
                                />
                                <RowActionMenu
                                  order={tx}
                                  onPay={tx.status !== "completed" ? () => handlePaymentClick(tx) : undefined}
                                  onEdit={tx.status !== "completed" ? () => handleEditClick(tx) : undefined}
                                  onAddItems={tx.status === "pending" ? () => handleAddItemsClick(tx) : undefined}
                                  onResendSms={tx.status === "completed" && Boolean((tx as any).customerPhone) ? () => handleResendReceiptSms(tx) : undefined}
                                  onDelete={() => handleDeleteOrder(tx)}
                                />
                              </div>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 nest-hub-max:gap-2 nest-hub-max:grid-cols-2">
                  {orders.map((tx) => {
                    const orderSource = (tx as any).orderSource || ((tx as any).cashier === "Customer" && (tx as any).customerPhone ? "menu" : "pos")
                    const isMenuSource = orderSource === "menu"
                    const waiterName = (tx as any).waiter as string | undefined
                    const servedAt = (tx as any).servedAt as string | Date | null | undefined
                    const tableLabel = formatTableLabel(tx.table)
                    const orderData = {
                      id: tx.id,
                      timestamp: tx.timestamp,
                      status: tx.status,
                      paymentStatus: getStatusLabel((tx as any).paymentStatus || tx.status),
                      items: (Array.isArray(tx.items) ? tx.items : []).map((item) => ({
                        name: item.name || "Unknown",
                        quantity: item.quantity || 0,
                        price: item.price || 0,
                      })),
                      subtotal: tx.subtotal ?? null,
                      vat: tx.vat ?? null,
                      total: tx.total ?? null,
                      customerName: (tx as any).customerName || undefined,
                      customerPhone: (tx as any).customerPhone || null,
                      paymentMethod: tx.paymentMethod || null,
                      orderSource,
                      servedAt: servedAt ?? null,
                      table: tableLabel,
                      amountReceived:
                        (tx as any).totalLinkedPayments ??
                        (tx as any).cashAmount ??
                        (tx as any).amountReceived ??
                        null,
                      balanceDue: (tx as any).balanceDue ?? null,
                      receiptCode: tx.mpesaReceiptNumber || (tx as any).receiptCode || null,
                      server: tx.waiter ? { name: tx.waiter } : tx.cashier ? { name: tx.cashier } : null,
                      waiter: tx.waiter,
                      cashier: tx.cashier,
                      paymentReceiptSmsStatus: (tx as any).paymentReceiptSmsStatus ?? null,
                      paymentReceiptSmsSentAt: (tx as any).paymentReceiptSmsSentAt ?? null,
                    }
                    
                    // Accept only shows when not yet accepted (waiter still "Customer")
                    const payLabel = getStatusLabel((tx as any).paymentStatus || tx.status)
                    const unpaid = payLabel === "NOT_PAID" || payLabel === "PARTIALLY_PAID"
                    const isPendingMenuOrder =
                      unpaid &&
                      isMenuSource &&
                      (!waiterName || waiterName === "Customer")
                    const canServeMenuOrder =
                      unpaid &&
                      isMenuSource &&
                      !!waiterName &&
                      waiterName !== "Customer" &&
                      !servedAt
                    return (
                      <div key={tx.id} className="relative">
                        {isPendingMenuOrder && (
                          <div className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-t-xl bg-gradient-to-r from-orange-500 to-amber-500 -mb-1 z-10 relative">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="inline-flex items-center justify-center min-w-[3rem] h-9 rounded-lg bg-white text-orange-700 text-base font-black px-2.5 shrink-0">
                                {tableLabel ? `T${tableLabel}` : "T—"}
                              </span>
                              <div className="min-w-0">
                                <p className="text-white text-xs font-bold">New order — Accept</p>
                                {(tx as any).customerPhone && (
                                  <p className="text-white/80 text-[10px] font-mono truncate">{(tx as any).customerPhone}</p>
                                )}
                              </div>
                            </div>
                            <button
                              onClick={() => handleAcceptMenuOrder(tx.id)}
                              className="flex items-center gap-1 bg-white text-orange-700 text-xs font-bold px-3 py-1.5 rounded-full transition-all active:scale-95 flex-shrink-0 shadow-sm"
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              Accept
                            </button>
                          </div>
                        )}
                        {canServeMenuOrder && (
                          <div className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-t-xl bg-gradient-to-r from-amber-600 to-orange-500 -mb-1 z-10 relative">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="inline-flex items-center justify-center min-w-[3rem] h-9 rounded-lg bg-white text-orange-800 text-base font-black px-2.5 shrink-0">
                                {tableLabel ? `T${tableLabel}` : "T—"}
                              </span>
                              <p className="text-white text-xs font-bold truncate">
                                Preparing — tap Served
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleServeMenuOrder(tx.id)}
                              className="flex items-center gap-1 bg-white text-orange-700 text-xs font-bold px-3 py-1.5 rounded-full transition-all active:scale-95 flex-shrink-0 shadow-sm"
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              Served
                            </button>
                          </div>
                        )}
                        <OrderCard
                          order={orderData}
                          originalOrder={tx}
                          isSelected={selectedOrders.has(tx.id)}
                          onSelect={toggleOrderSelection}
                          onView={handleViewClick}
                          onPrint={handlePrintOrder}
                          onDelete={canDelete ? handleDeleteOrder : undefined}
                          onPay={tx.status !== "completed" ? handlePaymentClick : undefined}
                          onServe={canServeMenuOrder ? () => handleServeMenuOrder(tx.id) : undefined}
                          onEdit={canEdit && tx.status !== "completed" ? handleEditClick : undefined}
                          onAddItems={canEdit && tx.status === "pending" ? handleAddItemsClick : undefined}
                          onResendMessage={tx.status === "completed" && Boolean((tx as any).customerPhone) ? handleResendReceiptSms : undefined}
                        />
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
        </div>

      {/* Filter bottom sheet (mobile only) */}
      <Sheet open={filterSheetOpen} onOpenChange={setFilterSheetOpen}>
        <SheetContent
          side="bottom"
          className="rounded-t-3xl h-auto max-h-[88vh] p-0 gap-0 md:hidden border-0 shadow-[0_-8px_30px_rgba(0,0,0,0.12)]"
        >
          {/* Drag handle + header area for close button */}
          <div className="flex flex-col items-center pt-2 pb-1 shrink-0">
            <div className="w-10 h-1 rounded-full bg-[#cbd5e1]" />
          </div>
          <div className="px-5 pt-1 pb-8 overflow-y-auto">
            <h2 className="text-base font-semibold text-[#0f172a] mb-5">Filters</h2>
            <div className="space-y-5">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-[#94a3b8] mb-3">Status</p>
                <div className="flex flex-wrap gap-2">
                  {(["all", "PAID", "PARTIALLY_PAID", "NOT_PAID"] as const).map((s) => (
                    <button
                      key={s}
                      onClick={() => { setStatusFilter(s); setFilterSheetOpen(false) }}
                      className={`min-h-[44px] px-4 py-2.5 rounded-xl text-sm font-semibold transition-all touch-manipulation ${
                        statusFilter === s
                          ? "bg-primary text-white shadow-sm"
                          : "bg-white border-2 border-[#e2e8f0] text-[#475569] active:bg-[#f8fafc]"
                      }`}
                    >
                      {s === "all" ? "All statuses" : s === "PAID" ? "Paid" : s === "PARTIALLY_PAID" ? "Partially paid" : "Not paid"}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-[#94a3b8] mb-3">Payment</p>
                <div className="flex flex-wrap gap-2">
                  {(["all", "glovo", "mpesa", "card"] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => { setPaymentFilter(m); setFilterSheetOpen(false) }}
                      className={`min-h-[44px] px-4 py-2.5 rounded-xl text-sm font-semibold transition-all touch-manipulation ${
                        paymentFilter === m
                          ? "bg-primary text-white shadow-sm"
                          : "bg-white border-2 border-[#e2e8f0] text-[#475569] active:bg-[#f8fafc]"
                      }`}
                    >
                      {m === "all" ? "All payments" : m.charAt(0).toUpperCase() + m.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-[#94a3b8] mb-3">Date</p>
                <div className="flex flex-wrap gap-2">
                  <button className="min-h-[44px] px-4 py-2.5 rounded-xl text-sm font-semibold bg-primary text-white shadow-sm touch-manipulation">
                    Today
                  </button>
                  <button className="min-h-[44px] px-4 py-2.5 rounded-xl text-sm font-semibold bg-white border-2 border-[#e2e8f0] text-[#475569] active:bg-[#f8fafc] touch-manipulation">
                    Yesterday
                  </button>
                </div>
              </div>
            </div>
            <div className="flex gap-3 mt-6 pt-4 border-t border-[#e5e7eb]">
              <Button
                variant="outline"
                className="flex-1 h-12 rounded-xl font-semibold border-2 border-[#e2e8f0] text-[#475569]"
                onClick={() => { setStatusFilter("all"); setPaymentFilter("all"); setFilterSheetOpen(false) }}
              >
                Reset
              </Button>
              <Button
                className="flex-1 h-12 rounded-xl font-semibold bg-primary hover:bg-primary/90"
                onClick={() => setFilterSheetOpen(false)}
              >
                Apply
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Add Items Modal */}
      {addingItemsToOrder && (
        <Dialog
          open={!!addingItemsToOrder}
          onOpenChange={(open) => {
            if (!open) {
              setAddingItemsToOrder(null)
              setAddItemsSearchQuery("")
              setNewItems([])
            }
          }}
        >
          <DialogContent className="max-w-4xl max-h-[95vh] w-[95vw] sm:w-full flex flex-col overflow-hidden p-0">
            <DialogHeader className="px-6 pt-6 pb-4 border-b flex-shrink-0">
              <DialogTitle className="text-lg sm:text-xl font-bold">Add Items to Order #{addingItemsToOrder.id}</DialogTitle>
            </DialogHeader>
            <div className="flex-1 flex flex-col gap-3 sm:gap-4 overflow-hidden px-6 py-4">
              {/* Search Bar */}
              <div className="relative flex-shrink-0">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search products by name or barcode..."
                  value={addItemsSearchQuery}
                  onChange={(e) => setAddItemsSearchQuery(e.target.value)}
                  className="pl-10 h-10 sm:h-11 text-sm sm:text-base"
                />
    </div>

              <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_1.5fr] gap-3 sm:gap-4 overflow-hidden min-h-0">
                {/* Products Grid */}
                <div className="flex flex-col overflow-hidden min-h-0">
                  <div className="mb-2 flex items-center justify-between flex-shrink-0">
                    <Label className="text-xs sm:text-sm font-semibold">Select Products</Label>
                    <span className="text-[10px] sm:text-xs text-muted-foreground">
                      {products.filter((p) => {
                        const query = addItemsSearchQuery.toLowerCase()
                        return (
                          query === "" ||
                          p.name.toLowerCase().includes(query) ||
                          p.barcode.toLowerCase().includes(query)
                        )
                      }).length}{" "}
                      products
                    </span>
                  </div>
                  <div className="flex-1 overflow-y-auto border rounded-lg p-3 sm:p-4 bg-muted/30 min-h-0">
                    <div className="grid grid-cols-1 gap-2.5 sm:gap-3">
                      {products
                        .filter((p) => {
                          const query = addItemsSearchQuery.toLowerCase()
                          return (
                            query === "" ||
                            p.name.toLowerCase().includes(query) ||
                            p.barcode.toLowerCase().includes(query)
                          )
                        })
                        .map((product) => {
                          const itemInCart = newItems.find((i) => i.productId === product.id)
                          return (
                            <button
                              key={product.id}
                              onClick={() => handleAddItemToOrder(product.id)}
                              className={`flex flex-col p-3 sm:p-4 rounded-lg border transition-all text-left w-full ${
                                itemInCart
                                  ? "border-primary bg-primary/10 hover:bg-primary/15 shadow-sm"
                                  : "border-border hover:border-primary/50 hover:bg-background hover:shadow-sm"
                              }`}
                            >
                              <div className="flex items-start justify-between gap-3 mb-2">
                                <div className="flex-1 min-w-0">
                                  <div className="font-bold text-sm sm:text-base text-foreground leading-tight mb-1 line-clamp-2">
                                    {product.name}
                                  </div>
                                  {product.barcode && (
                                    <div className="text-[10px] sm:text-xs text-muted-foreground/70 font-mono">
                                      {product.barcode}
                                    </div>
                                  )}
                                </div>
                                {itemInCart && (
                                  <div className="flex items-center gap-1.5 bg-primary text-primary-foreground px-2.5 py-1 rounded-full text-xs font-bold flex-shrink-0">
                                    <span>{itemInCart.quantity}</span>
                                    <Plus className="h-3 w-3" />
                                  </div>
                                )}
                              </div>
                              <div className="flex items-center justify-between pt-2 border-t border-border/50">
                                <div className="text-[10px] sm:text-xs text-muted-foreground uppercase tracking-wide">
                                  {product.category}
                                </div>
                                <div className="text-sm sm:text-base font-bold text-primary">
                                  Ksh {product.price.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </div>
                              </div>
                            </button>
                          )
                        })}
                    </div>
                  </div>
                </div>

                {/* Selected Items Summary */}
                <div className="flex flex-col overflow-hidden min-h-0">
                  <div className="mb-2 flex items-center justify-between flex-shrink-0">
                    <div className="flex-1 min-w-0 pr-2">
                      <Label className="text-xs sm:text-sm font-semibold">Order Items</Label>
                      <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5 truncate">
                        {newItems.length} item{newItems.length !== 1 ? "s" : ""} • Click products to add more
                      </p>
                    </div>
                    {newItems.length > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          // Reset to only existing items
                          if (addingItemsToOrder) {
                            const existingItems = addingItemsToOrder.items.map((item) => ({
                              productId: item.productId,
                              quantity: item.quantity,
                            }))
                            setNewItems(existingItems)
                          } else {
                            setNewItems([])
                          }
                        }}
                        className="h-7 text-[10px] sm:text-xs text-muted-foreground hover:text-destructive flex-shrink-0"
                      >
                        <X className="h-3 w-3 mr-1" />
                        <span className="hidden sm:inline">Reset</span>
                      </Button>
                    )}
                  </div>
                  <div className="flex-1 overflow-y-auto border rounded-lg p-2 sm:p-3 bg-muted/30 min-h-0">
                    {newItems.length === 0 ? (
                      <div className="flex flex-col items-center justify-center h-full text-center py-8">
                        <ShoppingBag className="h-12 w-12 text-muted-foreground/50 mb-3" />
                        <p className="text-sm text-muted-foreground">No items selected</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Click on products to add them to the order
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {newItems
                          .map((item) => {
                            const product = products.find((p) => p.id === item.productId)
                            if (!product) {
                              console.warn(`Product with ID ${item.productId} not found`)
                              return null
                            }
                            const itemTotal = product.price * item.quantity
                            return (
                              <div
                                key={item.productId}
                                className="flex flex-col p-3 sm:p-4 rounded-lg border border-border bg-background gap-3"
                              >
                              {/* Product Name - Prominent */}
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex-1 min-w-0">
                                  <div className="font-bold text-sm sm:text-base text-foreground leading-tight mb-1 line-clamp-2">
                                    {product.name}
                                  </div>
                                  <div className="text-[10px] sm:text-xs text-muted-foreground">
                                    {product.category}
                                  </div>
                                </div>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 w-7 p-0 text-destructive hover:text-destructive hover:bg-destructive/10 flex-shrink-0"
                                  onClick={() => {
                                    setNewItems((prev) => prev.filter((i) => i.productId !== item.productId))
                                  }}
                                >
                                  <X className="h-4 w-4" />
                                </Button>
                              </div>

                              {/* Quantity, Price, and Controls */}
                              <div className="flex items-center justify-between pt-2 border-t border-border/50">
                                <div className="flex items-center gap-2">
                                  <div className="text-xs sm:text-sm text-muted-foreground">
                                    {item.quantity} × Ksh {product.price.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <div className="text-right mr-2">
                                    <div className="text-sm sm:text-base font-bold text-primary">
                                      Ksh {itemTotal.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </div>
                                    <div className="text-[10px] text-muted-foreground">Item Total</div>
                                  </div>
                                  <div className="flex items-center gap-1">
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-7 w-7 p-0"
                                      onClick={() => {
                                        setNewItems((prev) =>
                                          prev.map((i) =>
                                            i.productId === item.productId
                                              ? { ...i, quantity: Math.max(1, i.quantity - 1) }
                                              : i,
                                          ),
                                        )
                                      }}
                                    >
                                      <Minus className="h-3.5 w-3.5" />
                                    </Button>
                                    <span className="w-10 text-center text-sm font-bold">{item.quantity}</span>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-7 w-7 p-0"
                                      onClick={() => {
                                        setNewItems((prev) =>
                                          prev.map((i) =>
                                            i.productId === item.productId
                                              ? { ...i, quantity: i.quantity + 1 }
                                              : i,
                                          ),
                                        )
                                      }}
                                    >
                                      <Plus className="h-3.5 w-3.5" />
                                    </Button>
                                  </div>
                                </div>
                              </div>
                            </div>
                          )
                        })
                          .filter((item) => item !== null)}
                        <div className="mt-4 pt-4 border-t space-y-2">
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Subtotal</span>
                            <span className="font-semibold">
                              Ksh{" "}
                              {newItems
                                .reduce((sum, item) => {
                                  const product = products.find((p) => p.id === item.productId)
                                  if (!product) return sum
                                  return sum + product.price * item.quantity
                                }, 0)
                                .toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                          </div>
                          {/* VAT is already included in item prices; no separate tax line */}
                          <div className="flex justify-between pt-2 border-t font-bold text-base">
                            <span>Total</span>
                            <span className="text-primary">
                              Ksh{" "}
                              {newItems
                                .reduce((sum, item) => {
                                  const product = products.find((p) => p.id === item.productId)
                                  if (!product) return sum
                                  return sum + product.price * item.quantity
                                }, 0)
                                .toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row justify-end gap-2 sm:gap-3 pt-3 sm:pt-4 border-t px-6 pb-4 sm:pb-6 flex-shrink-0 bg-muted/20">
              <Button
                variant="outline"
                size="sm"
                className="w-full sm:w-auto text-xs sm:text-sm"
                onClick={() => {
                  setAddingItemsToOrder(null)
                  setAddItemsSearchQuery("")
                  setNewItems([])
                }}
              >
                Cancel
              </Button>
              <Button
                onClick={handleSaveItemsToOrder}
                disabled={newItems.length === 0}
                size="sm"
                className="w-full sm:w-auto min-w-32 bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white text-xs sm:text-sm"
              >
                <Plus className="h-3.5 w-3.5 sm:h-4 sm:w-4 mr-1.5 sm:mr-2" />
                Save {newItems.length > 0 ? `(${newItems.reduce((sum, i) => sum + i.quantity, 0)} items)` : "Items"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* View Order Modal */}
      {viewingOrder && (
        <Dialog open={!!viewingOrder} onOpenChange={(open) => !open && setViewingOrder(null)}>
          <DialogContent className="max-w-2xl max-h-[95vh] overflow-hidden flex flex-col p-0">
            <DialogHeader className="px-6 pt-6 pb-4 border-b">
              <DialogTitle className="text-lg font-bold">Order #{viewingOrder.id}</DialogTitle>
            </DialogHeader>
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              {/* Order Info - Compact */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-3 bg-muted/30 rounded-lg text-xs">
                <div>
                  <Label className="text-[10px] text-muted-foreground uppercase">Table</Label>
                  <p className="text-xs font-semibold mt-0.5">Table {viewingOrder.table}</p>
                </div>
                <div>
                  <Label className="text-[10px] text-muted-foreground uppercase">Date</Label>
                  <p className="text-xs font-semibold mt-0.5">
                    {viewingOrder.timestamp.toLocaleDateString()}
                  </p>
                </div>
                <div>
                  <Label className="text-[10px] text-muted-foreground uppercase">Time</Label>
                  <p className="text-xs font-semibold mt-0.5">
                    {viewingOrder.timestamp.toLocaleTimeString("en-KE", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
                <div>
                  <Label className="text-[10px] text-muted-foreground uppercase">Waiter</Label>
                  <p className="text-xs font-semibold mt-0.5 truncate">{viewingOrder.waiter}</p>
                </div>
                <div>
                  <Label className="text-[10px] text-muted-foreground uppercase">Cashier</Label>
                  <p className="text-xs font-semibold mt-0.5 truncate">{viewingOrder.cashier}</p>
                </div>
                <div>
                  <Label className="text-[10px] text-muted-foreground uppercase">Status</Label>
                  <div className="mt-0.5">
                    <Badge
                      className={`text-[10px] px-2 py-0.5 ${
                        viewingOrder.status === "completed"
                          ? "bg-emerald-100 text-emerald-800 border-emerald-300"
                          : viewingOrder.status === "cancelled"
                            ? "bg-red-100 text-red-800 border-red-300"
                            : "bg-amber-100 text-amber-800 border-amber-300"
                      }`}
                    >
                      {viewingOrder.status}
                    </Badge>
                  </div>
                </div>
              </div>

              {/* Payment Method Badge */}
              <div className="flex items-center gap-2">
                <Label className="text-xs text-muted-foreground">Payment:</Label>
                <span
                  className={`inline-flex items-center justify-center px-2.5 py-1 rounded-full text-[10px] font-semibold ${getPaymentBadgeClasses(
                    viewingOrder.paymentMethod,
                  )}`}
                >
                  {viewingOrder.paymentMethod?.toLowerCase() === "mpesa"
                    ? "Paid via M-Pesa"
                    : viewingOrder.paymentMethod?.toLowerCase() === "glovo"
                    ? "Paid via Glovo"
                    : (viewingOrder.paymentMethod || "—").toLowerCase()}
                </span>
              </div>
              {viewingOrder.paymentMethod?.toLowerCase() === "mpesa" && viewingOrder.mpesaReceiptNumber && (
                <p className="text-xs text-green-700 font-medium">Latest M-Pesa ref: {viewingOrder.mpesaReceiptNumber}</p>
              )}
              {viewingOrder.paymentMethod?.toLowerCase() === "glovo" && (viewingOrder as any).glovoOrderNumber && (
                <p className="text-xs text-orange-700 font-medium">Glovo Order #: {(viewingOrder as any).glovoOrderNumber}</p>
              )}

              {viewingOrder.paymentMethod?.toLowerCase() === "mpesa" && (() => {
                const vsum = summarizeCathaOrderPayments(viewingOrder as any)
                const links = ((viewingOrder as any).linkedPayments as any[]) || []
                return (
                  <div className="rounded-lg border border-green-200 bg-green-50/50 p-3 space-y-2 text-xs">
                    <p className="text-sm font-semibold text-green-900">Payment summary</p>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                      <span className="text-muted-foreground">Order total</span>
                      <span className="font-mono font-medium text-right">KSh {vsum.orderTotal.toFixed(2)}</span>
                      <span className="text-muted-foreground">Total paid</span>
                      <span className="font-mono font-medium text-right">KSh {vsum.totalLinkedPayments.toFixed(2)}</span>
                      <span className="text-muted-foreground">Balance due</span>
                      <span className="font-mono font-medium text-right text-amber-800">KSh {vsum.balanceDue.toFixed(2)}</span>
                      {vsum.overpaymentAmount > 0 && (
                        <>
                          <span className="text-muted-foreground">Excess / change to give</span>
                          <span className="font-mono font-medium text-right text-violet-800">KSh {vsum.overpaymentAmount.toFixed(2)}</span>
                        </>
                      )}
                    </div>
                    <div className="flex items-center justify-between pt-1 border-t border-green-200/80">
                      <span className="text-muted-foreground">Payment status</span>
                      <Badge className="text-[10px]">
                        {vsum.paymentStatus === "PAID"
                          ? "Paid"
                          : vsum.paymentStatus === "OVERPAID"
                            ? "Overpaid"
                            : vsum.paymentStatus === "PARTIALLY_PAID"
                              ? "Partially paid"
                              : "Unpaid"}
                      </Badge>
                    </div>
                    {vsum.overpaymentAmount > 0 && (
                      <div className="rounded-md bg-white/80 border border-violet-200 p-2 space-y-2">
                        <p className="font-semibold text-violet-900">
                          Change given: {(viewingOrder as any).changeGiven ? "Yes" : "No"}
                        </p>
                        {(viewingOrder as any).changeGiven && (viewingOrder as any).changeGivenAt && (
                          <p className="text-[10px] text-muted-foreground">
                            {new Date((viewingOrder as any).changeGivenAt).toLocaleString()} by {(viewingOrder as any).changeGivenBy || "—"}
                          </p>
                        )}
                        {canManageMpesa && !(viewingOrder as any).changeGiven && (
                          <>
                            <Textarea
                              placeholder="Optional notes (e.g. handed 500 cash)"
                              value={changeNotesDraft}
                              onChange={(e) => setChangeNotesDraft(e.target.value)}
                              className="min-h-[52px] text-xs"
                            />
                            <Button
                              type="button"
                              size="sm"
                              className="w-full bg-violet-600 hover:bg-violet-700 text-white"
                              disabled={markingChangeGiven}
                              onClick={() => handleMarkChangeGivenSubmit(viewingOrder.id)}
                            >
                              {markingChangeGiven ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Mark change as given"}
                            </Button>
                          </>
                        )}
                      </div>
                    )}
                    {links.length > 0 && (
                      <div className="space-y-1.5">
                        <p className="font-semibold text-green-900">Linked M-Pesa payments</p>
                        <div className="max-h-40 overflow-y-auto space-y-2">
                          {links.map((p: any) => (
                            <div
                              key={p.transactionId}
                              className="flex flex-wrap items-start justify-between gap-2 rounded border border-green-100 bg-white p-2"
                            >
                              <div className="space-y-0.5 min-w-0">
                                <p className="text-[10px] font-semibold text-green-900">
                                  {linkedMpesaPaymentTitle(p)}
                                </p>
                                <p className="font-mono font-medium truncate">{p.receiptNumber || p.transactionId}</p>
                                <p>
                                  KSh {Number(p.amount || 0).toFixed(2)}
                                  {p.phone ? ` · ${p.phone}` : ""}
                                  {p.payerName ? ` · ${p.payerName}` : ""}
                                </p>
                                <p className="text-[10px] text-muted-foreground">
                                  {p.linkSource === "manual" ? (
                                    <>
                                      Added by {p.linkedBy || "—"}
                                      {p.linkedAt
                                        ? ` · ${new Date(p.linkedAt).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" })}`
                                        : ""}
                                    </>
                                  ) : (
                                    <>
                                      {p.mpesaStatus ? `${p.mpesaStatus} · ` : ""}
                                      {p.transactionDate
                                        ? new Date(p.transactionDate).toLocaleString()
                                        : p.linkedAt
                                          ? new Date(p.linkedAt).toLocaleString()
                                          : "—"}{" "}
                                      · {p.linkedBy || "—"}
                                    </>
                                  )}
                                </p>
                                {p.linkSource === "manual" && p.notes && (
                                  <p className="text-[10px] text-amber-900">
                                    Reason: {p.notes}
                                  </p>
                                )}
                              </div>
                              {canManageMpesa && viewingOrder.status !== "cancelled" && (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-7 text-[10px] shrink-0"
                                  disabled={unlinkingTxId === p.transactionId}
                                  onClick={() => handleUnlinkMpesaFromOrder(viewingOrder.id, String(p.transactionId))}
                                >
                                  {unlinkingTxId === p.transactionId ? <Loader2 className="h-3 w-3 animate-spin" /> : "Unlink"}
                                </Button>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })()}

              {/* Items List - Compact */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Items ({viewingOrder.items.length})</Label>
                <div className="border rounded-lg divide-y max-h-64 overflow-y-auto">
                  {viewingOrder.items.map((item, idx) => (
                    <div
                      key={`${item.productId}-${idx}`}
                      className="p-2.5 flex items-center justify-between hover:bg-muted/30"
                    >
                      <div className="flex-1 min-w-0 pr-2">
                        <p className="font-semibold text-xs truncate">
                          <span className="text-primary mr-1.5">{item.quantity}x</span>
                          {item.name}
                        </p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          Ksh {item.price.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} each
                        </p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="font-bold text-primary text-xs">
                          Ksh {(item.price * item.quantity).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </p>
                        <p className="text-[9px] text-muted-foreground">Item Total</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Totals - Compact */}
              <div className="space-y-1.5 rounded-lg border border-border/70 bg-muted/40 p-3">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span className="font-semibold text-gray-800">
                    Ksh {viewingOrder.subtotal.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
                {/* VAT is already included in item prices; no separate tax line */}
                <div className="flex justify-between pt-1.5 border-t border-border/50 mt-1.5 text-sm">
                  <span className="font-bold text-gray-800">Total</span>
                  <span className="font-bold text-primary">
                    Ksh {viewingOrder.total.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row justify-between gap-2 px-6 py-4 border-t bg-muted/20">
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs"
                  onClick={() => handlePrintOrder(viewingOrder)}
                >
                  <Printer className="h-3.5 w-3.5 mr-1.5" />
                  Print
                </Button>
                {viewingOrder.status === "pending" && (
                  <>
                    <Button
                      variant="default"
                      size="sm"
                      className="bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white text-xs"
                      onClick={() => {
                        setViewingOrder(null)
                        handlePaymentClick(viewingOrder)
                      }}
                    >
                      <Wallet2 className="h-3.5 w-3.5 mr-1.5" />
                      Process Payment
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs"
                      onClick={() => {
                        setViewingOrder(null)
                        handleAddItemsClick(viewingOrder)
                      }}
                    >
                      <Plus className="h-3.5 w-3.5 mr-1.5" />
                      Add Items
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs"
                      onClick={() => {
                        setViewingOrder(null)
                        handleEditClick(viewingOrder)
                      }}
                    >
                      <Edit2 className="h-3.5 w-3.5 mr-1.5" />
                      Edit
                    </Button>
                  </>
                )}
                {viewingOrder.status !== "completed" && viewingOrder.status !== "pending" && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs"
                    onClick={() => {
                      setViewingOrder(null)
                      handleEditClick(viewingOrder)
                    }}
                  >
                    <Edit2 className="h-3.5 w-3.5 mr-1.5" />
                    Edit
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs border-red-200 text-red-600 hover:bg-red-50"
                  onClick={() => {
                    setViewingOrder(null)
                    handleDeleteOrder(viewingOrder)
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                  Delete
                </Button>
              </div>
              <Button variant="outline" size="sm" className="text-xs" onClick={() => setViewingOrder(null)}>
                Close
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Edit Order Modal */}
      {editingOrder && (
        <Dialog open={!!editingOrder} onOpenChange={(open) => !open && setEditingOrder(null)}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-xl font-bold">Edit Order #{editingOrder.id}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Status</Label>
                  <Select value={draftStatus} onValueChange={(v) => setDraftStatus(v as Transaction["status"])}>
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="completed">Completed</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="cancelled">Cancelled</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Payment Method</Label>
                  <Select
                    value={draftPayment}
                    onValueChange={(v) => setDraftPayment(v as "glovo" | "card" | "mpesa")}
                  >
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue placeholder="Payment" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="glovo">Glovo</SelectItem>
                      <SelectItem value="card">Card</SelectItem>
                      <SelectItem value="mpesa">M-Pesa</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Editable Items List */}
              <div className="space-y-2">
                <Label className="text-sm font-semibold">Items ({draftItems.length})</Label>
                <div className="border rounded-lg divide-y max-h-64 overflow-y-auto">
                  {draftItems.length === 0 ? (
                    <div className="p-4 text-center text-sm text-muted-foreground">No items in this order</div>
                  ) : (
                    draftItems.map((item, idx) => (
                      <div key={`${item.productId}-${idx}`} className="p-3 flex items-center justify-between hover:bg-muted/50">
                        <div className="flex-1">
                          <p className="font-semibold text-sm">
                            {item.quantity}x {item.name}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            Ksh {item.price.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} each
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 w-7 p-0"
                              onClick={() => handleUpdateItemQuantity(idx, item.quantity - 1)}
                            >
                              <Minus className="h-3 w-3" />
                            </Button>
                            <span className="w-10 text-center text-sm font-semibold">{item.quantity}</span>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 w-7 p-0"
                              onClick={() => handleUpdateItemQuantity(idx, item.quantity + 1)}
                            >
                              <Plus className="h-3 w-3" />
                            </Button>
                          </div>
                          <div className="text-right min-w-[100px]">
                            <p className="font-bold text-primary text-sm">
                              Ksh {(item.price * item.quantity).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </p>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                            onClick={() => handleRemoveItemFromEdit(idx)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Updated Totals */}
              <div className="space-y-2 rounded-lg border border-border/70 bg-muted/40 p-4">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span className="font-semibold text-gray-800">
                    Ksh{" "}
                    {draftItems
                      .reduce((sum, item) => sum + item.price * item.quantity, 0)
                      .toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
                {/* VAT is already included in item prices; no separate tax line */}
                <div className="flex justify-between pt-2 border-t border-border/50 mt-2 text-base">
                  <span className="font-bold text-gray-800">Total</span>
                  <span className="font-bold text-primary">
                    Ksh{" "}
                    {draftItems
                      .reduce((sum, item) => sum + item.price * item.quantity, 0)
                      .toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button variant="outline" onClick={() => {
                setEditingOrder(null)
                setDraftItems([])
              }}>
                Cancel
              </Button>
              <Button onClick={handleSaveEdit} disabled={!draftStatus || !draftPayment || draftItems.length === 0}>
                Save Changes
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Receipt Modal - Clean Premium Design */}
      <ReceiptModal
        order={printingOrder ? (() => {
          const po = printingOrder as any
          const s = summarizeCathaOrderPayments(po)
          const psLabel =
            s.paymentStatus === "PAID"
              ? "Paid"
              : s.paymentStatus === "OVERPAID"
                ? "Overpaid"
                : s.paymentStatus === "PARTIALLY_PAID"
                  ? "Partially paid"
                  : "Unpaid"
          return {
            id: printingOrder.id,
            timestamp: printingOrder.timestamp,
            status: printingOrder.status,
            table: printingOrder.table,
            customerName: po.customerName,
            waiter: printingOrder.waiter,
            cashier: printingOrder.cashier,
            paymentMethod: printingOrder.paymentMethod,
            mpesaReceiptNumber: printingOrder.mpesaReceiptNumber,
            glovoOrderNumber: po.glovoOrderNumber,
            items: printingOrder.items.map((item) => ({
              name: item.name,
              quantity: item.quantity,
              price: item.price ?? 0,
            })),
            subtotal: printingOrder.subtotal,
            vat: printingOrder.vat,
            total: printingOrder.total,
            cashAmount: po.cashAmount,
            cashBalance: po.cashBalance,
            totalLinkedPayments: s.totalLinkedPayments,
            balanceDue: s.balanceDue,
            overpaymentAmount: s.overpaymentAmount,
            changeGiven: po.changeGiven === true,
            paymentStatusLabel: psLabel,
          }
        })() : null}
        open={!!printingOrder}
        onClose={() => setPrintingOrder(null)}
        businessName="catha lounge"
        businessSubtitle="Restaurant & Bar"
        showQRCode={true}
      />

      {/* Process Payment Modal */}
      {processingPayment && (
        <Dialog
          open={!!processingPayment}
          onOpenChange={(open) => {
            if (!open) {
              setProcessingPayment(null)
              setSelectedPaymentMethod("")
              setGlovoOrderNumber("")
              setPaymentCustomerPhone("")
              setMpesaPhoneNumber("")
            }
          }}
        >
          <DialogContent className="w-[96vw] max-w-md sm:max-w-2xl max-h-[92vh] overflow-hidden flex flex-col p-0 gap-0">
            <DialogHeader className="px-4 sm:px-6 pt-4 sm:pt-5 pb-4 border-b bg-muted/20 space-y-3">
              <div className="flex items-start justify-between gap-3 pr-6">
                <div className="min-w-0 space-y-1">
                  <DialogTitle className="text-lg sm:text-xl font-bold leading-tight">
                    Process Payment
                  </DialogTitle>
                  <p className="text-sm text-muted-foreground font-mono truncate">
                    Order #{processingPayment.id}
                  </p>
                </div>
                {(() => {
                  const live = summarizeCathaOrderPayments(processingPayment as any)
                  const due = live.balanceDue > 0.005 ? live.balanceDue : 0
                  const paid =
                    live.paymentStatus === "PAID" ||
                    live.paymentStatus === "OVERPAID" ||
                    live.paymentStatus === "PARTIALLY_PAID"
                  return (
                    <div className="shrink-0 text-right">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
                        {paid && due <= 0 ? "Settled" : "Balance due"}
                      </p>
                      <p className={`text-xl sm:text-2xl font-bold tabular-nums ${due > 0 ? "text-amber-700" : "text-emerald-600"}`}>
                        KSh {due > 0 ? due.toFixed(2) : live.orderTotal.toFixed(2)}
                      </p>
                    </div>
                  )
                })()}
              </div>
            </DialogHeader>
            <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-5">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <div className="rounded-lg border bg-background px-3 py-2.5">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Order total</p>
                  <p className="text-base font-bold tabular-nums">
                    KSh {processingPayment.total.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                </div>
                <div className="rounded-lg border bg-background px-3 py-2.5">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Subtotal</p>
                  <p className="text-base font-semibold tabular-nums text-muted-foreground">
                    KSh {processingPayment.subtotal.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                </div>
                {(() => {
                  const live = summarizeCathaOrderPayments(processingPayment as any)
                  return (
                    <div className="rounded-lg border bg-background px-3 py-2.5 col-span-2 sm:col-span-1">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Linked</p>
                      <p className="text-base font-semibold tabular-nums text-emerald-700">
                        KSh {live.totalLinkedPayments.toFixed(2)}
                      </p>
                    </div>
                  )
                })()}
              </div>

              <div className="space-y-2">
                <Label htmlFor="orders-payment-customer-phone" className="text-sm font-medium">
                  Customer phone <span className="text-muted-foreground font-normal">(optional)</span>
                </Label>
                <Input
                  id="orders-payment-customer-phone"
                  type="tel"
                  placeholder="07… / 01… / +254…"
                  value={paymentCustomerPhone}
                  onChange={(e) => syncPaymentPhones(e.target.value)}
                  className="h-10 text-sm"
                />
              </div>

              <div className="space-y-2.5">
                <Label className="text-sm font-medium">Payment method</Label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedPaymentMethod("glovo")
                    }}
                    className={`flex flex-col items-center gap-1.5 rounded-xl border-2 px-2 py-3 transition-all ${
                      selectedPaymentMethod === "glovo"
                        ? "border-orange-500 bg-orange-50 shadow-sm"
                        : "border-border hover:border-orange-200 hover:bg-muted/40 bg-background"
                    }`}
                  >
                    <Truck className={`h-5 w-5 ${selectedPaymentMethod === "glovo" ? "text-orange-600" : "text-muted-foreground"}`} />
                    <span className={`text-xs font-semibold ${selectedPaymentMethod === "glovo" ? "text-orange-700" : "text-foreground"}`}>
                      Glovo
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedPaymentMethod("card")}
                    className={`flex flex-col items-center gap-1.5 rounded-xl border-2 px-2 py-3 transition-all ${
                      selectedPaymentMethod === "card"
                        ? "border-blue-500 bg-blue-50 shadow-sm"
                        : "border-border hover:border-blue-200 hover:bg-muted/40 bg-background"
                    }`}
                  >
                    <CreditCard className={`h-5 w-5 ${selectedPaymentMethod === "card" ? "text-blue-600" : "text-muted-foreground"}`} />
                    <span className={`text-xs font-semibold ${selectedPaymentMethod === "card" ? "text-blue-700" : "text-foreground"}`}>
                      Card
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedPaymentMethod("mpesa")}
                    className={`flex flex-col items-center gap-1.5 rounded-xl border-2 px-2 py-3 transition-all ${
                      selectedPaymentMethod === "mpesa"
                        ? "border-emerald-500 bg-emerald-50 shadow-sm"
                        : "border-border hover:border-emerald-200 hover:bg-muted/40 bg-background"
                    }`}
                  >
                    <Smartphone className={`h-5 w-5 ${selectedPaymentMethod === "mpesa" ? "text-emerald-600" : "text-muted-foreground"}`} />
                    <span className={`text-xs font-semibold ${selectedPaymentMethod === "mpesa" ? "text-emerald-700" : "text-foreground"}`}>
                      M-Pesa
                    </span>
                  </button>
                </div>
              </div>

              {selectedPaymentMethod === "glovo" && (
                <div className="rounded-xl border bg-orange-50/40 p-4 space-y-2">
                  <Label className="text-sm font-medium">Glovo order number</Label>
                  <Input
                    type="text"
                    value={glovoOrderNumber}
                    onChange={(e) => setGlovoOrderNumber(e.target.value)}
                    placeholder="Enter Glovo order number"
                    className="h-10 text-sm font-medium bg-background"
                  />
                  {!glovoOrderNumber.trim() && <p className="text-xs text-red-600">Required before confirming.</p>}
                </div>
              )}

              {selectedPaymentMethod === "mpesa" && (
                <div className="space-y-4 rounded-xl border border-emerald-200/80 bg-emerald-50/30 p-3 sm:p-4">
                  <div
                    className={`grid gap-1 rounded-lg bg-background/80 p-1 border ${canManualMpesa ? "grid-cols-3" : "grid-cols-2"}`}
                    role="tablist"
                    aria-label="M-Pesa payment options"
                  >
                    <button
                      type="button"
                      role="tab"
                      aria-selected={mpesaFlowTab === "link"}
                      className={`rounded-md px-2 py-2.5 text-xs sm:text-sm font-medium transition-all ${
                        mpesaFlowTab === "link"
                          ? "bg-emerald-600 text-white shadow-sm"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                      }`}
                      onClick={() => setMpesaFlowTab("link")}
                    >
                      Link existing
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={mpesaFlowTab === "request"}
                      className={`rounded-md px-2 py-2.5 text-xs sm:text-sm font-medium transition-all ${
                        mpesaFlowTab === "request"
                          ? "bg-emerald-600 text-white shadow-sm"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                      }`}
                      onClick={() => setMpesaFlowTab("request")}
                    >
                      Send STK
                    </button>
                    {canManualMpesa && (
                      <button
                        type="button"
                        role="tab"
                        aria-selected={mpesaFlowTab === "manual"}
                        className={`rounded-md px-2 py-2.5 text-xs sm:text-sm font-medium transition-all ${
                          mpesaFlowTab === "manual"
                            ? "bg-emerald-600 text-white shadow-sm"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                        }`}
                        onClick={() => setMpesaFlowTab("manual")}
                      >
                        Manual entry
                      </button>
                    )}
                  </div>

                  {mpesaFlowTab === "link" && (() => {
                    const live = summarizeCathaOrderPayments(processingPayment as any)
                    const linkedRows = ((processingPayment as any).linkedPayments as any[]) || []
                    const linkedIds = new Set(
                      linkedRows.map((p) => (p?.transactionId != null ? String(p.transactionId) : "")).filter(Boolean)
                    )
                    const candidateTxs = mpesaLinkCandidates.filter(
                      (tx) =>
                        tx.status === "COMPLETED" &&
                        tx.id &&
                        !linkedIds.has(String(tx.id))
                    )
                    return (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <div className="rounded-lg border bg-background px-3 py-2">
                          <p className="text-[10px] uppercase text-muted-foreground">Total</p>
                          <p className="font-bold tabular-nums text-sm">KSh {live.orderTotal.toFixed(2)}</p>
                        </div>
                        <div className="rounded-lg border bg-background px-3 py-2">
                          <p className="text-[10px] uppercase text-muted-foreground">Linked</p>
                          <p className="font-bold tabular-nums text-sm text-emerald-700">KSh {live.totalLinkedPayments.toFixed(2)}</p>
                        </div>
                        <div className="rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2">
                          <p className="text-[10px] uppercase text-amber-800/80">Due</p>
                          <p className="font-bold tabular-nums text-sm text-amber-900">KSh {live.balanceDue.toFixed(2)}</p>
                        </div>
                        <div className="rounded-lg border bg-background px-3 py-2 col-span-2 sm:col-span-1">
                          <p className="text-[10px] uppercase text-muted-foreground">Status</p>
                          <p className="font-semibold text-sm">
                            {live.paymentStatus === "PAID"
                              ? "Paid"
                              : live.paymentStatus === "OVERPAID"
                                ? "Overpaid"
                                : live.paymentStatus === "PARTIALLY_PAID"
                                  ? "Partial"
                                  : "Unpaid"}
                          </p>
                        </div>
                      </div>
                      {live.overpaymentAmount > 0 && (
                        <p className="text-xs text-violet-800 bg-violet-50 border border-violet-200 rounded-lg px-3 py-2">
                          Excess paid: KSh {live.overpaymentAmount.toFixed(2)}
                        </p>
                      )}
                      {linkedRows.length > 0 && (
                        <div className="rounded-lg border bg-background p-3 space-y-2">
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                            Already linked ({linkedRows.length})
                          </p>
                          <div className="max-h-32 overflow-y-auto space-y-2">
                            {linkedRows.map((p: any) => (
                              <div
                                key={String(p.transactionId)}
                                className="flex items-start justify-between gap-2 rounded-lg border px-3 py-2 text-xs bg-muted/20"
                              >
                                <div className="min-w-0 space-y-0.5">
                                  <p className="font-semibold truncate">
                                    {p.receiptNumber || p.transactionId}
                                  </p>
                                  <p className="text-muted-foreground">
                                    KSh {Number(p.amount || 0).toFixed(2)}
                                    {p.phone ? ` · ${p.phone}` : ""}
                                  </p>
                                  <p className="text-[10px] text-muted-foreground">{linkedMpesaPaymentTitle(p)}</p>
                                  {p.linkSource === "manual" && p.notes && (
                                    <p className="text-[10px] text-amber-900">Reason: {p.notes}</p>
                                  )}
                                </div>
                                {canManageMpesa && processingPayment.status !== "cancelled" && (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 text-[10px] shrink-0"
                                    disabled={unlinkingTxId === p.transactionId}
                                    onClick={() =>
                                      handleUnlinkMpesaFromOrder(processingPayment.id, String(p.transactionId))
                                    }
                                  >
                                    {unlinkingTxId === p.transactionId ? (
                                      <Loader2 className="h-3 w-3 animate-spin" />
                                    ) : (
                                      "Remove"
                                    )}
                                  </Button>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      <div className="rounded-lg border bg-background p-3 space-y-3">
                        <div className="flex items-center justify-between gap-2">
                          <Label className="text-sm font-medium">Amount for this order</Label>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-8 text-xs"
                            onClick={() => loadMpesaLinkCandidates("recent")}
                            disabled={loadingMpesaCandidates}
                          >
                            <RefreshCw className={`h-3.5 w-3.5 mr-1 ${loadingMpesaCandidates ? "animate-spin" : ""}`} />
                            Refresh list
                          </Button>
                        </div>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          className="h-11 text-base font-mono tabular-nums"
                          value={mpesaAllocationInput}
                          onChange={(e) => setMpesaAllocationInput(e.target.value)}
                          placeholder={live.balanceDue > 0 ? live.balanceDue.toFixed(2) : "0.00"}
                        />
                        <p className="text-[11px] text-muted-foreground leading-relaxed">
                          Split one M-Pesa payment across orders. Cannot exceed the transaction&apos;s remaining balance.
                        </p>
                      </div>
                      <div className="rounded-lg border bg-background p-3 space-y-2">
                        <Label className="text-xs font-medium text-muted-foreground">
                          Filter by exact amount (optional)
                        </Label>
                        <div className="flex gap-2">
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            className="h-10 font-mono"
                            value={mpesaExactAmountSearch}
                            onChange={(e) => setMpesaExactAmountSearch(e.target.value)}
                            placeholder="e.g. 90"
                          />
                          <Button
                            type="button"
                            variant="secondary"
                            className="shrink-0"
                            onClick={() => loadMpesaLinkCandidates("exact", Number(mpesaExactAmountSearch))}
                            disabled={!mpesaExactAmountSearch.trim() || Number.isNaN(Number(mpesaExactAmountSearch))}
                          >
                            <Search className="h-4 w-4 sm:mr-1" />
                            <span className="hidden sm:inline">Search</span>
                          </Button>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                          Select transaction
                        </p>
                        <div className="max-h-56 overflow-y-auto space-y-2 pr-0.5">
                        {!loadingMpesaCandidates && candidateTxs.length === 0 && (
                          <p className="text-sm text-muted-foreground text-center py-6 px-2 rounded-lg border border-dashed">
                            {mpesaCandidatesLoadModeRef.current === "exact"
                              ? `No transactions with KSh ${Number(mpesaExactAmountSearch || 0).toFixed(2)} and spare balance.`
                              : "No transactions with spare balance. Refresh or search by amount."}
                          </p>
                        )}
                        {loadingMpesaCandidates && (
                          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Loading transactions…
                          </div>
                        )}
                        {candidateTxs.map((tx) => {
                          const rem = Number(tx.remainingUnallocated ?? tx.amount ?? 0)
                          const alloc = Number(tx.allocatedTotal ?? 0)
                          const isSelected = selectedMpesaTransactionId === tx.id
                          const receipt = tx.mpesaReceiptNumber || tx.mpesaRef || tx.transactionId || "—"
                          const statusLabel =
                            tx.allocationStatus === "full"
                              ? "Full"
                              : tx.allocationStatus === "partial"
                                ? "Partial"
                                : "Open"
                          const otherOrders =
                            Array.isArray(tx.linkedOrderIds) && tx.linkedOrderIds.length > 0
                              ? tx.linkedOrderIds.join(", ")
                              : null
                          return (
                            <label
                              key={tx.id}
                              className={`block rounded-xl border-2 p-3 cursor-pointer transition-all ${
                                isSelected
                                  ? "border-emerald-500 bg-emerald-50/60 shadow-sm"
                                  : "border-border bg-background hover:border-emerald-300"
                              }`}
                            >
                              <div className="flex items-start gap-3">
                                <input
                                  type="radio"
                                  name="selected-mpesa-transaction"
                                  className="mt-1.5 h-4 w-4 accent-emerald-600"
                                  checked={isSelected}
                                  onChange={() => {
                                    setSelectedMpesaTransactionId(tx.id)
                                    const live = summarizeCathaOrderPayments(processingPayment as any)
                                    const rem = Math.max(0, Number(tx.remainingUnallocated ?? tx.amount ?? 0))
                                    const due = Math.max(0, live.balanceDue)
                                    const def = due > 0.005 ? Math.min(due, rem) : rem
                                    setMpesaAllocationInput(def > 0 ? def.toFixed(2) : "")
                                  }}
                                />
                                <div className="flex-1 min-w-0 space-y-1">
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <p className="font-mono font-bold text-sm">{receipt}</p>
                                    <Badge variant="outline" className="text-[10px] shrink-0">
                                      {statusLabel}
                                    </Badge>
                                  </div>
                                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                                    <span>KSh {Number(tx.amount || 0).toFixed(2)} total</span>
                                    <span className="font-semibold text-amber-800">KSh {rem.toFixed(2)} left</span>
                                  </div>
                                  <div className="flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
                                    {tx.phoneNumber && (
                                      <span>{tx.phoneNumber}</span>
                                    )}
                                    {tx.createdAt && (
                                      <span>{new Date(tx.createdAt).toLocaleString("en-KE", { dateStyle: "short", timeStyle: "short" })}</span>
                                    )}
                                  </div>
                                  {(alloc > 0 || otherOrders) && (
                                    <p className="text-[10px] text-muted-foreground">
                                      Allocated KSh {alloc.toFixed(2)}
                                      {otherOrders ? ` · Orders: ${otherOrders}` : ""}
                                    </p>
                                  )}
                                </div>
                              </div>
                            </label>
                          )
                        })}
                        </div>
                      </div>
                    </div>
                    )
                  })()}

                  {mpesaFlowTab === "request" && (
                    <div className="space-y-3 rounded-lg border bg-background p-4">
                      <Label htmlFor="orders-mpesa-request-phone" className="text-sm font-medium">
                        Customer phone for STK push
                      </Label>
                      <Input
                        id="orders-mpesa-request-phone"
                        type="tel"
                        placeholder="0712345678, 0113794000, or +254…"
                        value={mpesaPhoneNumber}
                        onChange={(e) => syncPaymentPhones(e.target.value)}
                        className="h-11 text-base"
                      />
                      <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2 text-sm">
                        <span className="text-muted-foreground">STK status</span>
                        <span className="font-medium capitalize">
                          {mpesaRequestStatus === "idle"
                            ? "Ready"
                            : mpesaRequestStatus === "sent"
                              ? "Request sent"
                              : mpesaRequestStatus === "waiting"
                                ? "Waiting for payment"
                                : mpesaRequestStatus === "paid"
                                  ? "Paid"
                                  : "Failed"}
                        </span>
                      </div>
                    </div>
                  )}

                  {mpesaFlowTab === "manual" && canManualMpesa && (() => {
                    const live = summarizeCathaOrderPayments(processingPayment as any)
                    const codeReady = manualTxCode.trim().replace(/\s+/g, "").length >= 3
                    return (
                    <div className="space-y-4 rounded-lg border bg-background p-4">
                      <p className="text-sm text-muted-foreground leading-relaxed">
                        Recover a payment when Safaricom completed it but the callback failed. Submitted entries go to manager approval.
                      </p>
                      <div className="space-y-1.5">
                        <Label htmlFor="manual-tx-code" className="text-sm font-medium">
                          Transaction code <span className="text-red-600">*</span>
                        </Label>
                        <Input
                          id="manual-tx-code"
                          type="text"
                          placeholder="UG3GD9SAQE"
                          value={manualTxCode}
                          onChange={(e) => {
                            setManualTxCode(e.target.value.toUpperCase().replace(/\s+/g, ""))
                            setManualTxConfirmed(false)
                          }}
                          onBlur={() => {
                            const c = manualTxCode.trim().replace(/\s+/g, "")
                            if (c.length >= 3) setDebouncedManualTxCode(c)
                          }}
                          className="h-11 font-mono uppercase text-base tracking-wide"
                        />
                      </div>

                      {codeReady && manualTxLookupLoading && (
                        <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-600">
                          <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                          <Search className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                          Checking linked payments and M-Pesa transactions…
                        </div>
                      )}

                      {codeReady && !manualTxLookupLoading && manualTxLookup?.status === "already_linked" && (
                        <div className="rounded-md border border-red-300 bg-red-50 p-3 space-y-2 text-xs">
                          <div className="flex items-center gap-2 font-semibold text-red-900">
                            <XCircle className="h-4 w-4 shrink-0" />
                            Already Linked
                          </div>
                          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-red-950/90">
                            <span className="text-red-800/80">Transaction</span>
                            <span className="font-mono font-medium text-right">{manualTxLookup.transactionCode}</span>
                            <span className="text-red-800/80">Order</span>
                            <span className="font-mono font-medium text-right">{manualTxLookup.orderId}</span>
                            {manualTxLookup.orderTable != null && (
                              <>
                                <span className="text-red-800/80">Table</span>
                                <span className="font-medium text-right">{manualTxLookup.orderTable}</span>
                              </>
                            )}
                            {manualTxLookup.customerName && (
                              <>
                                <span className="text-red-800/80">Customer</span>
                                <span className="font-medium text-right truncate">{manualTxLookup.customerName}</span>
                              </>
                            )}
                            <span className="text-red-800/80">Amount</span>
                            <span className="font-mono font-medium text-right">KES {manualTxLookup.amount.toFixed(2)}</span>
                            <span className="text-red-800/80">Linked by</span>
                            <span className="font-medium text-right">{manualTxLookup.linkedBy}</span>
                            <span className="text-red-800/80">Linked</span>
                            <span className="font-medium text-right">{formatLookupWhen(manualTxLookup.linkedAt)}</span>
                          </div>
                        </div>
                      )}

                      {codeReady && !manualTxLookupLoading && manualTxLookup?.status === "exists_unlinked" && (() => {
                        const alloc = Number(manualTxLookup.allocatedTotal ?? 0)
                        const total = Number(manualTxLookup.amount || 0)
                        const rem = Number(manualTxLookup.remainingUnallocated || 0)
                        const pct = total > 0 ? Math.min(100, (alloc / total) * 100) : 0
                        return (
                        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 space-y-2.5 text-xs">
                          <div className="flex items-center gap-2 font-semibold text-amber-950">
                            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
                            Existing Payment Found
                          </div>
                          {manualTxLookup.importedFromSafaricom !== false && (
                            <p className="text-emerald-800 font-medium flex items-center gap-1">
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              Imported from Safaricom
                            </p>
                          )}
                          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-amber-950/90">
                            <span className="text-amber-900/80">Transaction</span>
                            <span className="font-mono font-medium text-right">{manualTxLookup.transactionCode}</span>
                            <span className="text-amber-900/80">Amount</span>
                            <span className="font-mono font-medium text-right">KES {total.toFixed(2)}</span>
                            {manualTxLookup.phoneMasked && (
                              <>
                                <span className="text-amber-900/80">Phone</span>
                                <span className="font-mono font-medium text-right">{manualTxLookup.phoneMasked}</span>
                              </>
                            )}
                            <span className="text-amber-900/80">Received</span>
                            <span className="font-medium text-right">{formatLookupWhen(manualTxLookup.receivedAt)}</span>
                            <span className="text-amber-900/80">Status</span>
                            <span className="font-semibold text-right text-amber-800">Unlinked</span>
                          </div>
                          {total > 0 && (
                            <div className="rounded-md bg-white/80 border border-amber-200 p-2.5 space-y-1.5">
                              <div className="flex justify-between text-[10px] font-medium text-amber-950">
                                <span>KES {total.toFixed(2)}</span>
                              </div>
                              <div className="h-2 rounded-full bg-amber-100 overflow-hidden">
                                <div
                                  className="h-full bg-amber-500 rounded-full transition-all"
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                              <div className="flex justify-between gap-2 text-[10px]">
                                <span className="text-amber-900/80">
                                  Allocated KES {alloc.toFixed(2)}
                                </span>
                                <span className="font-semibold text-amber-900">
                                  Remaining KES {rem.toFixed(2)}
                                </span>
                              </div>
                            </div>
                          )}
                          <Button
                            type="button"
                            size="sm"
                            className="w-full bg-amber-600 hover:bg-amber-700 text-white"
                            onClick={() => void handleUseSuggestLink(manualTxLookup)}
                          >
                            Link Existing
                          </Button>
                        </div>
                        )
                      })()}

                      {codeReady && !manualTxLookupLoading && manualTxLookup?.status === "not_found" && (
                        <div className="rounded-md border border-slate-200 bg-slate-50 p-3 space-y-2.5 text-xs">
                          <div className="flex items-center gap-2 font-semibold text-slate-800">
                            <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-slate-300 text-[10px] text-slate-700">○</span>
                            Transaction not found
                          </div>
                          <p className="text-slate-600 leading-snug">
                            This payment does not exist in imported M-Pesa transactions. You may create a manual payment.
                          </p>
                          {!manualTxConfirmed ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="w-full"
                              onClick={() => setManualTxConfirmed(true)}
                            >
                              Continue
                            </Button>
                          ) : (
                            <p className="text-[10px] text-emerald-700 font-medium">Ready to create manual payment.</p>
                          )}
                        </div>
                      )}

                      <div className="space-y-1.5">
                        <Label htmlFor="manual-tx-phone" className="text-xs font-medium">
                          Customer Phone (optional)
                        </Label>
                        <Input
                          id="manual-tx-phone"
                          type="tel"
                          placeholder="0712345678 or +254…"
                          value={manualTxPhone}
                          onChange={(e) => setManualTxPhone(e.target.value)}
                          className="h-10"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="manual-tx-amount" className="text-xs font-semibold">
                          Amount <span className="text-red-600">*</span>
                        </Label>
                        <Input
                          id="manual-tx-amount"
                          type="number"
                          step="0.01"
                          min="0"
                          value={manualTxAmount}
                          onChange={(e) => setManualTxAmount(e.target.value)}
                          className="h-10 font-mono"
                        />
                        <p className="text-[10px] text-muted-foreground">
                          Balance remaining: KSh {live.balanceDue.toFixed(2)}
                        </p>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="manual-tx-date" className="text-xs font-medium">
                          Payment Date
                        </Label>
                        <Input
                          id="manual-tx-date"
                          type="date"
                          value={manualTxDate}
                          onChange={(e) => setManualTxDate(e.target.value)}
                          className="h-10"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="manual-tx-notes" className="text-xs font-medium">
                          Notes (optional)
                        </Label>
                        <Textarea
                          id="manual-tx-notes"
                          placeholder="Reason for manual entry (e.g. callback timeout)"
                          value={manualTxNotes}
                          onChange={(e) => setManualTxNotes(e.target.value)}
                          className="min-h-[72px] text-xs"
                        />
                      </div>
                    </div>
                    )
                  })()}
                </div>
              )}
            </div>
            <div className="px-4 sm:px-6 py-3.5 border-t bg-muted/30 flex flex-col-reverse sm:flex-row sm:justify-between sm:items-center gap-2 sm:gap-3">
              <Button variant="ghost" className="sm:mr-auto" onClick={() => {
                setProcessingPayment(null)
                setSelectedPaymentMethod("")
                setGlovoOrderNumber("")
                setCardTransactionReference("")
                setShowCardDialog(false)
                setPaymentCustomerPhone("")
                setMpesaPhoneNumber("")
                setManualTxCode("")
                setManualTxAmount("")
                setManualTxNotes("")
                setManualTxLookup(null)
                setManualTxConfirmed(false)
              }}>
                Cancel
              </Button>
              {selectedPaymentMethod === "mpesa" && mpesaFlowTab === "link" ? (
                <Button
                  onClick={handleLinkMpesaTransaction}
                  disabled={
                    !selectedMpesaTransactionId ||
                    linkingMpesaTransaction ||
                    !mpesaAllocationInput.trim() ||
                    Number(mpesaAllocationInput) <= 0
                  }
                  className="w-full sm:w-auto bg-emerald-600 hover:bg-emerald-700 text-white h-11"
                >
                  {linkingMpesaTransaction ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Linking…</> : <><Smartphone className="h-4 w-4 mr-2" />Link M-Pesa payment</>}
                </Button>
              ) : selectedPaymentMethod === "mpesa" && mpesaFlowTab === "manual" && canManualMpesa ? (
                <Button
                  onClick={() => void handleManualMpesaSubmit()}
                  disabled={
                    manualTxSubmitting ||
                    !manualTxCode.trim() ||
                    !manualTxAmount.trim() ||
                    Number(manualTxAmount) <= 0 ||
                    manualTxLookupLoading ||
                    manualTxLookup?.status === "already_linked" ||
                    manualTxLookup?.status === "exists_unlinked" ||
                    (manualTxLookup?.status === "not_found" && !manualTxConfirmed) ||
                    (manualTxCode.trim().replace(/\s+/g, "").length >= 3 &&
                      !manualTxLookup &&
                      !manualTxLookupLoading)
                  }
                  className="w-full sm:w-auto bg-emerald-600 hover:bg-emerald-700 text-white h-11"
                >
                  {manualTxSubmitting ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Submitting…</>
                  ) : (
                    <><CheckCircle2 className="h-4 w-4 mr-2" />Submit for approval</>
                  )}
                </Button>
              ) : (
                <Button
                  onClick={handleProcessPayment}
                  disabled={
                    !selectedPaymentMethod ||
                    (selectedPaymentMethod === "glovo" && (!glovoOrderNumber.trim() || isProcessingGlovoPayment))
                  }
                  className="w-full sm:w-auto bg-emerald-600 hover:bg-emerald-700 text-white h-11"
                >
                  {selectedPaymentMethod === "mpesa" ? (
                    <><Smartphone className="h-4 w-4 mr-2" />Send STK request</>
                  ) : selectedPaymentMethod === "card" ? (
                    <><CreditCard className="h-4 w-4 mr-2" />Continue card payment</>
                  ) : (
                    <><Truck className="h-4 w-4 mr-2" />Confirm Glovo payment</>
                  )}
                </Button>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Card Payment Dialog */}
      {showCardDialog && processingPayment && (
        <Dialog
          open={showCardDialog}
          onOpenChange={(open) => {
            if (!open && isProcessingCardPayment) return
            if (!open) {
              setShowCardDialog(false)
              setCardTransactionReference("")
            }
          }}
        >
          <DialogContent className="w-[96vw] max-w-md sm:max-w-lg max-h-[90vh] overflow-hidden flex flex-col p-0 gap-0">
            <DialogHeader className="px-4 sm:px-6 pt-4 sm:pt-5 pb-3 border-b">
              <DialogTitle className="text-2xl font-bold flex items-center gap-3">
                <div className="h-12 w-12 rounded-full bg-blue-100 flex items-center justify-center">
                  <CreditCard className="h-6 w-6 text-blue-600" />
                </div>
                Card Payment
              </DialogTitle>
              <DialogDescription>
                Enter card transaction details to complete this order payment.
              </DialogDescription>
            </DialogHeader>
            <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-4">
              <div className="bg-muted/50 rounded-lg p-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Total Amount:</span>
                  <span className="font-bold text-primary">
                    Ksh {processingPayment.total.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="card-transaction-reference">Card Transaction Reference</Label>
                <Input
                  id="card-transaction-reference"
                  type="text"
                  value={cardTransactionReference}
                  onChange={(e) => setCardTransactionReference(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && cardTransactionReference.trim() && !isProcessingCardPayment) {
                      handleConfirmCardPayment()
                    }
                  }}
                  placeholder="Enter card transaction reference"
                  autoFocus
                  className="text-base font-medium"
                />
                {!cardTransactionReference.trim() && (
                  <p className="text-xs text-red-600">Card transaction reference is required.</p>
                )}
              </div>
            </div>
            <div className="px-4 sm:px-6 py-3 border-t bg-background flex gap-3 justify-end">
              <Button
                variant="outline"
                onClick={() => {
                  setShowCardDialog(false)
                  setCardTransactionReference("")
                }}
                disabled={isProcessingCardPayment}
              >
                Cancel
              </Button>
              <Button
                onClick={handleConfirmCardPayment}
                disabled={!cardTransactionReference.trim() || isProcessingCardPayment}
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                {isProcessingCardPayment ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Processing...</>
                ) : (
                  <><CreditCard className="h-4 w-4 mr-2" />Complete Payment</>
                )}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* M-Pesa STK Push Dialog */}
      {showMpesaDialog && (
        <Dialog
          open={showMpesaDialog}
          onOpenChange={(open) => {
            if (!open && (pendingMpesaOrderId || mpesaError)) return
            if (!open) {
              setShowMpesaDialog(false)
              setMpesaError(null)
              setMpesaCheckoutRequestId(null)
            }
          }}
        >
          <DialogContent className="w-[96vw] max-w-md sm:max-w-lg max-h-[90vh] overflow-hidden flex flex-col p-0 gap-0">
            <DialogHeader className="px-4 sm:px-6 pt-4 sm:pt-5 pb-3 border-b">
              <DialogTitle className="text-2xl font-bold flex items-center gap-3">
                <div className="h-12 w-12 rounded-full bg-green-100 flex items-center justify-center">
                  <Smartphone className="h-6 w-6 text-green-600" />
                </div>
                M-Pesa Payment
              </DialogTitle>
              <DialogDescription>
                {mpesaError
                  ? "Payment error — review the message below and retry or cancel."
                  : "Enter the customer's phone number to send an M-Pesa payment request"}
              </DialogDescription>
            </DialogHeader>
            <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-4">
              {mpesaError && (
                <div className="bg-red-50 border-2 border-red-200 rounded-lg p-4 flex items-start gap-3">
                  <div className="h-5 w-5 rounded-full bg-red-500 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="text-white text-xs font-bold">!</span>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-red-800 mb-1">
                      {mpesaError.status === 'CANCELLED' ? 'Payment Cancelled'
                        : mpesaError.status === 'FAILED' ? 'Payment Failed'
                        : mpesaError.status === 'TIMEOUT' ? 'Payment Timeout'
                        : 'Payment Error'}
                    </p>
                    <p className="text-sm text-red-700">{mpesaError.message}</p>
                  </div>
                </div>
              )}

              {pendingMpesaOrderId && !mpesaError && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <p className="text-sm text-amber-800 flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin flex-shrink-0" />
                    Waiting for M-Pesa confirmation… Please check the customer's phone.
                  </p>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="orders-mpesa-phone">Customer Phone Number</Label>
                <Input
                  id="orders-mpesa-phone"
                  type="tel"
                  placeholder="0712345678, 0113794000, or +254…"
                  value={mpesaPhoneNumber}
                  onChange={(e) => syncPaymentPhones(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && mpesaPhoneNumber.trim() && !mpesaProcessing && !pendingMpesaOrderId) {
                      handleMpesaPayment()
                    }
                  }}
                  autoFocus={!mpesaError}
                  disabled={mpesaProcessing || !!pendingMpesaOrderId}
                  className="text-lg"
                />
                <p className="text-xs text-muted-foreground">Format: 07…, 01… (e.g. 0113794000), or +254…</p>
              </div>

              <div className="bg-muted/50 rounded-lg p-3 space-y-1">
                {(() => {
                  const s = summarizeCathaOrderPayments(processingPayment as any)
                  const due = s.balanceDue > 0.005 ? s.balanceDue : Number(processingPayment?.total) || 0
                  return (
                    <>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Order total:</span>
                        <span className="font-semibold">
                          Ksh {(processingPayment?.total ?? 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </div>
                      {s.totalLinkedPayments > 0 && (
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span>Paid so far</span>
                          <span className="font-mono">KSh {s.totalLinkedPayments.toFixed(2)}</span>
                        </div>
                      )}
                      <div className="flex justify-between text-sm pt-1 border-t border-border/60">
                        <span className="text-muted-foreground">STK amount (remaining):</span>
                        <span className="font-bold text-primary">
                          Ksh {due.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </div>
                    </>
                  )
                })()}
              </div>

              <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 pt-1 pb-1">
                {mpesaError ? (
                  <>
                    <Button
                      onClick={() => { setMpesaError(null); setMpesaCheckoutRequestId(null) }}
                      className="flex-1 h-12 text-base font-semibold bg-green-600 hover:bg-green-700 text-white"
                    >
                      <Smartphone className="h-5 w-5 mr-2" />
                      Retry Payment
                    </Button>
                    <Button
                      onClick={() => {
                        setShowMpesaDialog(false)
                        setMpesaError(null)
                        setPendingMpesaOrderId(null)
                        setMpesaCheckoutRequestId(null)
                        setMpesaProcessing(false)
                        toast.dismiss("mpesa-push")
                      }}
                      variant="outline"
                      className="h-12 text-base font-semibold"
                    >
                      Cancel
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      onClick={handleMpesaPayment}
                      disabled={!mpesaPhoneNumber.trim() || mpesaProcessing || !!pendingMpesaOrderId}
                      className="flex-1 h-12 text-base font-semibold bg-green-600 hover:bg-green-700 text-white disabled:opacity-50"
                    >
                      {mpesaProcessing ? (
                        <span className="flex items-center gap-2"><Loader2 className="h-5 w-5 animate-spin" />Processing...</span>
                      ) : pendingMpesaOrderId ? (
                        <span className="flex items-center gap-2"><Loader2 className="h-5 w-5 animate-spin" />Waiting for Payment...</span>
                      ) : (
                        <><Smartphone className="h-5 w-5 mr-2" />Send Payment Request</>
                      )}
                    </Button>
                    <Button
                      onClick={() => {
                        setShowMpesaDialog(false)
                        setMpesaError(null)
                        setPendingMpesaOrderId(null)
                        setMpesaCheckoutRequestId(null)
                        setMpesaProcessing(false)
                        if (mpesaPollIntervalRef.current) {
                          clearInterval(mpesaPollIntervalRef.current)
                          mpesaPollIntervalRef.current = null
                        }
                        toast.dismiss("mpesa-push")
                      }}
                      variant="outline"
                      disabled={mpesaProcessing && !pendingMpesaOrderId && !mpesaError}
                      className="h-12 text-base font-semibold"
                    >
                      Cancel
                    </Button>
                  </>
                )}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}
