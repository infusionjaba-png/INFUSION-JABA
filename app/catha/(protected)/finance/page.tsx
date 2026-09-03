"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useSession } from "next-auth/react"
import { Header } from "@/components/layout/header"
import { useAdaptivePoll } from "@/hooks/use-adaptive-poll"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Wallet2,
  ShoppingBag,
  Smartphone,
  ShieldCheck,
  Download,
  Loader2,
  RefreshCw,
  TrendingUp,
  AlertCircle,
} from "lucide-react"
import { toast } from "sonner"
import { hasCathaPermission, normalizePermissions } from "@/lib/catha-permissions-model"
import type { FinanceDashboardSnapshot } from "@/lib/catha-finance-dashboard"

function formatKes(amount: number): string {
  return `KES ${amount.toLocaleString("en-KE", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

function todayNairobiIso(): string {
  const nairobi = new Date(Date.now() + 3 * 60 * 60 * 1000)
  const y = nairobi.getUTCFullYear()
  const m = String(nairobi.getUTCMonth() + 1).padStart(2, "0")
  const d = String(nairobi.getUTCDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

function formatDisplayDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`)
  return d.toLocaleDateString("en-KE", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  })
}

export default function FinanceDashboardPage() {
  const { data: session } = useSession()
  const canView = useMemo(() => {
    const role = (session?.user as { role?: string })?.role
    const perms = normalizePermissions((session?.user as { permissions?: unknown })?.permissions)
    const r = (role ?? "").toUpperCase()
    if (r === "SUPER_ADMIN" || r === "ADMIN") return true
    if (hasCathaPermission(perms, "reports", "view")) return true
    if (hasCathaPermission(perms, "mpesa", "view")) return true
    return false
  }, [session?.user])

  const [selectedDate, setSelectedDate] = useState(todayNairobiIso())
  const [data, setData] = useState<FinanceDashboardSnapshot | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!canView) return
    try {
      setLoading(true)
      const res = await fetch(
        `/api/catha/finance/dashboard?date=${encodeURIComponent(selectedDate)}`,
        { cache: "no-store" }
      )
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || "Failed to load finance dashboard")
      setData(json)
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Failed to load"
      toast.error(message)
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [canView, selectedDate])

  useEffect(() => {
    if (session === undefined) return
    if (!canView) {
      setLoading(false)
      return
    }
    void load()
  }, [session, canView, load])

  useAdaptivePoll(!!canView && session !== undefined, load, {
    activeMs: 60_000,
    hiddenMs: null,
    immediate: false,
  })

  const handleExportCsv = () => {
    window.open(
      `/api/catha/finance/dashboard?date=${encodeURIComponent(selectedDate)}&format=csv`,
      "_blank"
    )
  }

  if (session !== undefined && !canView) {
    return (
      <div className="flex flex-col min-h-screen">
        <Header title="Finance" subtitle="Payments & reconciliation" />
        <div className="p-6">
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">
              You do not have permission to view the finance dashboard.
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  const snap = data

  return (
    <div className="flex flex-col min-h-screen">
      <Header
        title="Finance"
        subtitle="Payment recovery, M-Pesa activity, and daily reconciliation"
      />
      <div className="p-4 sm:p-6 space-y-6 max-w-5xl mx-auto w-full">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
          <div className="space-y-1">
            <p className="text-sm font-medium text-muted-foreground">Reconciliation date</p>
            <div className="flex items-center gap-2">
              <Input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="w-auto"
              />
              <Button type="button" variant="outline" size="icon" onClick={() => void load()} disabled={loading}>
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              </Button>
            </div>
            {snap && (
              <p className="text-xs text-muted-foreground">{formatDisplayDate(snap.date)} · Africa/Nairobi</p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={handleExportCsv}>
              <Download className="h-4 w-4 mr-1.5" />
              Export CSV
            </Button>
          </div>
        </div>

        {loading && !snap ? (
          <div className="flex justify-center py-20 text-muted-foreground text-sm">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            Loading finance data…
          </div>
        ) : snap ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <ShoppingBag className="h-4 w-4 text-indigo-600" />
                    Today&apos;s Orders
                  </CardTitle>
                  <CardDescription>Orders created on {snap.date}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Orders</span>
                    <span className="font-semibold tabular-nums">{snap.orders.total}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Paid</span>
                    <span className="font-semibold text-emerald-700 tabular-nums">{snap.orders.paid}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Pending</span>
                    <span className="font-semibold text-amber-700 tabular-nums">{snap.orders.pending}</span>
                  </div>
                  {snap.orders.partiallyPaid > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Partially paid</span>
                      <span className="font-semibold tabular-nums">{snap.orders.partiallyPaid}</span>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="border-violet-200/80 bg-violet-50/30">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-violet-600" />
                    Recovery & Outstanding
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Recovered revenue</span>
                    <span className="font-bold text-violet-800 tabular-nums">
                      {formatKes(snap.recoveredRevenue)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Outstanding (today)</span>
                    <span className="font-semibold text-amber-800 tabular-nums">
                      {formatKes(snap.outstandingBalance)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center pt-1">
                    <span className="text-muted-foreground">Pending approval</span>
                    <Badge
                      variant="outline"
                      className={
                        snap.pendingApproval > 0
                          ? "bg-amber-100 text-amber-900 border-amber-300"
                          : ""
                      }
                    >
                      {snap.pendingApproval}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Smartphone className="h-4 w-4 text-green-600" />
                  M-Pesa linked today
                </CardTitle>
                <CardDescription>By how payments were attached to orders</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3 sm:grid-cols-3">
                  {[
                    {
                      label: "Automatic",
                      sub: "STK / callbacks",
                      bucket: snap.mpesa.automatic,
                      color: "text-emerald-700",
                    },
                    {
                      label: "Manual",
                      sub: "Approved recovery",
                      bucket: snap.mpesa.manual,
                      color: "text-violet-700",
                    },
                    {
                      label: "Linked existing",
                      sub: "Staff link picker",
                      bucket: snap.mpesa.linkedExisting,
                      color: "text-sky-700",
                    },
                  ].map((row) => (
                    <div
                      key={row.label}
                      className="rounded-lg border bg-muted/20 p-3 space-y-1"
                    >
                      <p className={`text-xs font-semibold ${row.color}`}>{row.label}</p>
                      <p className="text-[10px] text-muted-foreground">{row.sub}</p>
                      <p className="text-lg font-bold tabular-nums">{formatKes(row.bucket.amount)}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {row.bucket.count} payment{row.bucket.count === 1 ? "" : "s"}
                      </p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card id="reconciliation">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Wallet2 className="h-4 w-4" />
                  End of day reconciliation
                </CardTitle>
                <CardDescription>{formatDisplayDate(snap.date)}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2">
                  <div>
                    <p className="text-muted-foreground text-xs">Orders</p>
                    <p className="font-semibold tabular-nums">{snap.orders.total}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Automatic</p>
                    <p className="font-semibold tabular-nums">{snap.mpesa.automatic.count}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Manual</p>
                    <p className="font-semibold tabular-nums">{snap.mpesa.manual.count}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Existing linked</p>
                    <p className="font-semibold tabular-nums">{snap.mpesa.linkedExisting.count}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Pending approval</p>
                    <p className="font-semibold tabular-nums">{snap.pendingApproval}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Rejected</p>
                    <p className="font-semibold tabular-nums">{snap.rejectedToday}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Outstanding</p>
                    <p className="font-semibold tabular-nums">{formatKes(snap.outstandingBalance)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Recovered</p>
                    <p className="font-semibold tabular-nums">{formatKes(snap.recoveredRevenue)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Quick actions</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col sm:flex-row flex-wrap gap-2">
                <Button asChild variant="default" className="bg-amber-600 hover:bg-amber-700">
                  <Link href="/catha/manual-mpesa-review">
                    <ShieldCheck className="h-4 w-4 mr-1.5" />
                    Review pending
                    {snap.pendingApproval > 0 && (
                      <Badge className="ml-2 bg-white/20 text-white">{snap.pendingApproval}</Badge>
                    )}
                  </Link>
                </Button>
                <Button asChild variant="outline">
                  <Link href="/catha/mpesa-transactions">
                    <Smartphone className="h-4 w-4 mr-1.5" />
                    M-Pesa transactions
                  </Link>
                </Button>
                <Button asChild variant="outline">
                  <Link href="/catha/orders">
                    <ShoppingBag className="h-4 w-4 mr-1.5" />
                    Orders
                  </Link>
                </Button>
                <Button type="button" variant="outline" onClick={handleExportCsv}>
                  <Download className="h-4 w-4 mr-1.5" />
                  Export CSV
                </Button>
              </CardContent>
            </Card>

            {snap.pendingApproval > 0 && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-950">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <p>
                  {snap.pendingApproval} manual M-Pesa{" "}
                  {snap.pendingApproval === 1 ? "entry awaits" : "entries await"} manager approval.{" "}
                  <Link href="/catha/manual-mpesa-review" className="font-semibold underline">
                    Review now
                  </Link>
                </p>
              </div>
            )}
          </>
        ) : (
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              No finance data available for this date.
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
