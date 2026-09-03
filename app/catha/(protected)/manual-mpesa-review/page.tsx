"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useSession } from "next-auth/react"
import { Header } from "@/components/layout/header"
import { useAdaptivePoll } from "@/hooks/use-adaptive-poll"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Loader2, ShieldCheck, CheckCircle2, XCircle, Clock, RefreshCw } from "lucide-react"
import { toast } from "sonner"
import {
  canApproveManualMpesaVerifications,
  normalizePermissions,
} from "@/lib/catha-permissions-model"
import { useRouter } from "next/navigation"

type PendingVerification = {
  id: string
  orderId: string
  transactionCode: string
  amount: number
  phone: string | null
  notes: string | null
  enteredBy: string
  enteredAt: string
  orderTable?: number | null
  customerName?: string | null
}

function formatRelativeWhen(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  const mins = Math.round((Date.now() - d.getTime()) / 60000)
  if (mins < 1) return "Just now"
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`
  return d.toLocaleString("en-KE", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export default function ManualMpesaReviewPage() {
  const router = useRouter()
  const { data: session } = useSession()
  const canApprove = useMemo(
    () =>
      canApproveManualMpesaVerifications(
        normalizePermissions((session?.user as { permissions?: unknown })?.permissions),
        (session?.user as { role?: string })?.role
      ),
    [session?.user]
  )

  const [pending, setPending] = useState<PendingVerification[]>([])
  const [loading, setLoading] = useState(true)
  const [actingId, setActingId] = useState<string | null>(null)
  const [rejectTarget, setRejectTarget] = useState<PendingVerification | null>(null)
  const [rejectReason, setRejectReason] = useState("")

  const loadPending = useCallback(async () => {
    if (!canApprove) return
    try {
      setLoading(true)
      const res = await fetch("/api/catha/orders/manual-mpesa/pending", { cache: "no-store" })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || "Failed to load queue")
      setPending(Array.isArray(data.pending) ? data.pending : [])
    } catch (e: any) {
      toast.error(e?.message || "Failed to load pending verifications")
      setPending([])
    } finally {
      setLoading(false)
    }
  }, [canApprove])

  useEffect(() => {
    if (session === undefined) return
    if (!canApprove) {
      setLoading(false)
      return
    }
    loadPending()
  }, [session, canApprove, loadPending])

  useAdaptivePoll(!!canApprove && session !== undefined, loadPending, {
    activeMs: 60_000,
    hiddenMs: null,
    immediate: false,
  })

  const handleApprove = async (row: PendingVerification) => {
    setActingId(row.id)
    try {
      const res = await fetch(`/api/catha/orders/manual-mpesa/${encodeURIComponent(row.id)}/approve`, {
        method: "POST",
        cache: "no-store",
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || "Approval failed")
      toast.success(`Approved ${row.transactionCode} — linked to order ${row.orderId}`)
      setPending((prev) => prev.filter((p) => p.id !== row.id))
    } catch (e: any) {
      toast.error(e?.message || "Failed to approve")
    } finally {
      setActingId(null)
    }
  }

  const handleReject = async () => {
    if (!rejectTarget) return
    setActingId(rejectTarget.id)
    try {
      const res = await fetch(
        `/api/catha/orders/manual-mpesa/${encodeURIComponent(rejectTarget.id)}/reject`,
        {
          method: "POST",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: rejectReason.trim() || undefined }),
        }
      )
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || "Rejection failed")
      toast.message(`Rejected ${rejectTarget.transactionCode}`)
      setPending((prev) => prev.filter((p) => p.id !== rejectTarget.id))
      setRejectTarget(null)
      setRejectReason("")
    } catch (e: any) {
      toast.error(e?.message || "Failed to reject")
    } finally {
      setActingId(null)
    }
  }

  if (session !== undefined && !canApprove) {
    return (
      <div className="flex flex-col min-h-screen">
        <Header title="Manual M-Pesa Review" subtitle="Manager approval queue" />
        <div className="p-6">
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">
              Only managers (Admin / Super Admin) can approve manual M-Pesa verifications.
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col min-h-screen">
      <Header
        title="Manual M-Pesa Review"
        subtitle="Approve or reject pending manual payment entries before they are linked"
      />
      <div className="p-4 sm:p-6 space-y-4 max-w-4xl mx-auto w-full">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-amber-600" />
            <Badge variant="outline" className="text-amber-800 border-amber-300 bg-amber-50">
              {loading ? "…" : `${pending.length} pending`}
            </Badge>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => void loadPending()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {loading && pending.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            Loading queue…
          </div>
        ) : pending.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">No pending reviews</CardTitle>
              <CardDescription>
                Manual M-Pesa entries submitted by staff will appear here for approval.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <div className="space-y-3">
            {pending.map((row) => (
              <Card key={row.id} className="border-amber-200/80 shadow-sm">
                <CardContent className="pt-5 pb-4 space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-mono font-bold text-lg tracking-wide">{row.transactionCode}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatRelativeWhen(row.enteredAt)} · {row.enteredBy}
                      </p>
                    </div>
                    <Badge className="bg-amber-100 text-amber-900 border-amber-300">Pending</Badge>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 text-xs">
                    <div>
                      <p className="text-muted-foreground">Order</p>
                      <button
                        type="button"
                        className="font-mono font-semibold text-primary hover:underline"
                        onClick={() => router.push(`/catha/orders?search=${encodeURIComponent(row.orderId)}`)}
                      >
                        {row.orderId}
                      </button>
                    </div>
                    {row.orderTable != null && (
                      <div>
                        <p className="text-muted-foreground">Table</p>
                        <p className="font-medium">{row.orderTable}</p>
                      </div>
                    )}
                    {row.customerName && (
                      <div>
                        <p className="text-muted-foreground">Customer</p>
                        <p className="font-medium truncate">{row.customerName}</p>
                      </div>
                    )}
                    <div>
                      <p className="text-muted-foreground">Amount</p>
                      <p className="font-mono font-semibold">KES {row.amount.toFixed(2)}</p>
                    </div>
                  </div>
                  {row.notes && (
                    <div className="rounded-md bg-slate-50 border border-slate-200 px-3 py-2 text-xs">
                      <p className="text-muted-foreground font-medium">Reason</p>
                      <p className="text-slate-800 mt-0.5">{row.notes}</p>
                    </div>
                  )}
                  <div className="flex flex-col sm:flex-row gap-2 pt-1">
                    <Button
                      type="button"
                      className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white"
                      disabled={actingId === row.id}
                      onClick={() => void handleApprove(row)}
                    >
                      {actingId === row.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <>
                          <CheckCircle2 className="h-4 w-4 mr-1.5" />
                          Approve
                        </>
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="flex-1 border-red-200 text-red-700 hover:bg-red-50"
                      disabled={actingId === row.id}
                      onClick={() => {
                        setRejectTarget(row)
                        setRejectReason("")
                      }}
                    >
                      <XCircle className="h-4 w-4 mr-1.5" />
                      Reject
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Dialog open={!!rejectTarget} onOpenChange={(open) => !open && setRejectTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reject manual entry</DialogTitle>
            <DialogDescription>
              {rejectTarget
                ? `Reject ${rejectTarget.transactionCode} for order ${rejectTarget.orderId}? No payment will be linked.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="reject-reason">Reason (optional)</Label>
            <Textarea
              id="reject-reason"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="e.g. Duplicate entry, incorrect amount"
              className="min-h-[80px] text-sm"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setRejectTarget(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={!!actingId}
              onClick={() => void handleReject()}
            >
              {actingId ? <Loader2 className="h-4 w-4 animate-spin" /> : "Reject"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
