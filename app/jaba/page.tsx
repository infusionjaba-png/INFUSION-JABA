"use client"

import { useState, useEffect, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from "recharts"
import { Plus, Truck, Package, TrendingUp, Factory, ArrowRight, AlertTriangle, FileText, Boxes, Loader2 } from "lucide-react"
import Link from "next/link"
import { cn } from "@/lib/utils"
import { useAdaptivePoll } from "@/hooks/use-adaptive-poll"

interface DashboardData {
  dashboardStats: {
    totalBatches: number
    batchesThisMonth: number
    batchesToday: number
    totalLitresManufactured: number
    litresProducedToday: number
    batchesAwaitingPackaging: number
    finishedGoodsStock: {
      "500ml": number
      "1L": number
      "2L": number
    }
    currentRawMaterials: number
    lowStockMaterials: number
    pendingDistributions: number
    completedDistributions: number
  }
  recentBatches: Array<{
    id: string
    batchNumber: string
    flavor: string
    status: string
    totalLitres: number
    outputSummary: {
      totalBottles: number
      remainingLitres: number
      breakdown: Array<any>
    }
  }>
  recentDeliveries: Array<{
    id: string
    distributorName: string
    batchNumber: string
    items: Array<{ size: string; quantity: number }>
    driver: string
  }>
  lowStockMaterials: Array<{
    id: string
    name: string
    currentStock: number
    unit: string
    minStock: number
  }>
  dailyProductionData: Array<{
    date: string
    litres: number
    batches: number
  }>
  weeklyProductionData: Array<{
    day: string
    litres: number
    batches: number
  }>
  materialUsageTrends: Array<{
    date: string
    usage: number
  }>
  weeklyDistributionData: Array<{
    date: string
    deliveries: number
    quantity: number
  }>
}

export default function JabaDashboard() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchDashboardData = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const response = await fetch('/api/jaba/dashboard')
      if (!response.ok) {
        throw new Error('Failed to fetch dashboard data')
      }
      const result = await response.json()
      setData(result)
    } catch (err: any) {
      console.error('Error fetching dashboard data:', err)
      setError(err.message || 'Failed to load dashboard data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchDashboardData()
  }, [fetchDashboardData])

  // Was 30s always-on; now 60s while visible, paused when hidden.
  useAdaptivePoll(true, fetchDashboardData, {
    activeMs: 60_000,
    hiddenMs: null,
    immediate: false,
  })

  const getStatusColor = (status: string) => {
    switch (status) {
      case "Completed":
        return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
      case "Ready for Distribution":
        return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
      case "QC Pending":
        return "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400"
      case "Processing":
        return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
      default:
        return "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300"
    }
  }

  if (loading) {
    return (
      <>
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border bg-card/95 px-6 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-card/80">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Production Dashboard</h1>
            <p className="text-sm text-muted-foreground">Loading...</p>
          </div>
        </header>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="h-8 w-8 animate-spin text-red-600" />
            <p className="text-muted-foreground">Loading dashboard data...</p>
          </div>
        </div>
      </>
    )
  }

  if (error || !data) {
    return (
      <>
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border bg-card/95 px-6 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-card/80">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Production Dashboard</h1>
            <p className="text-sm text-muted-foreground">Error loading data</p>
          </div>
        </header>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="flex flex-col items-center gap-4">
            <AlertTriangle className="h-8 w-8 text-red-600" />
            <p className="text-red-600">{error || 'Failed to load dashboard data'}</p>
            <Button onClick={() => window.location.reload()}>Retry</Button>
          </div>
        </div>
      </>
    )
  }

  const { dashboardStats, recentBatches, recentDeliveries, lowStockMaterials, dailyProductionData, weeklyProductionData, materialUsageTrends, weeklyDistributionData } = data

  return (
    <>
      {/* Header */}
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border bg-card/95 px-4 md:px-6 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-card/80">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Production Dashboard</h1>
          <p className="text-sm text-muted-foreground">Welcome back, Marcus Johnson</p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/jaba/batches/add">
            <Button className="bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800 shadow-lg shadow-red-500/30">
              <Plus className="mr-2 h-4 w-4" />
              Add Batch
            </Button>
          </Link>
        </div>
      </header>

      <div className="p-4 md:p-6 space-y-6 max-w-full overflow-x-hidden">
        {/* Top KPIs */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="border-border bg-card">
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Total Batches</p>
                  <p className="mt-1 text-2xl font-bold text-card-foreground">{dashboardStats.totalBatches}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{dashboardStats.batchesThisMonth} this month</p>
                </div>
                <div className="rounded-lg p-2.5 bg-red-600/10">
                  <Factory className="h-5 w-5 text-red-600" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border bg-card">
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Total Litres Manufactured</p>
                  <p className="mt-1 text-2xl font-bold text-card-foreground">{dashboardStats.totalLitresManufactured.toLocaleString()}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{dashboardStats.litresProducedToday}L produced today</p>
                </div>
                <div className="rounded-lg p-2.5 bg-green-600/10">
                  <TrendingUp className="h-5 w-5 text-green-600" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border bg-card">
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Awaiting packaging</p>
                  <p className="mt-1 text-2xl font-bold text-card-foreground">{dashboardStats.batchesAwaitingPackaging}</p>
                  <p className="mt-1 text-xs text-muted-foreground">Batches not yet sent to packaging</p>
                </div>
                <div className="rounded-lg p-2.5 bg-red-600/10">
                  <Package className="h-5 w-5 text-red-600" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border bg-card">
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Finished Goods Stock</p>
                  <p className="mt-1 text-2xl font-bold text-card-foreground">
                    {dashboardStats.finishedGoodsStock["500ml"] + dashboardStats.finishedGoodsStock["1L"] + dashboardStats.finishedGoodsStock["2L"]}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {dashboardStats.finishedGoodsStock["500ml"]}×500ml, {dashboardStats.finishedGoodsStock["1L"]}×1L, {dashboardStats.finishedGoodsStock["2L"]}×2L
                  </p>
                </div>
                <div className="rounded-lg p-2.5 bg-green-600/10">
                  <Boxes className="h-5 w-5 text-green-600" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Secondary KPIs */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Card className="border-border bg-card">
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Raw Materials</p>
                  <p className="mt-1 text-2xl font-bold text-card-foreground">{dashboardStats.currentRawMaterials}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {dashboardStats.lowStockMaterials} low stock alerts
                  </p>
                </div>
                <div className="rounded-lg p-2.5 bg-red-600/10">
                  <Package className="h-5 w-5 text-red-600" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border bg-card">
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Pending Distribution</p>
                  <p className="mt-1 text-2xl font-bold text-card-foreground">{dashboardStats.pendingDistributions}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{dashboardStats.completedDistributions} completed</p>
                </div>
                <div className="rounded-lg p-2.5 bg-red-600/10">
                  <Truck className="h-5 w-5 text-red-600" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border bg-card">
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Batches Today</p>
                  <p className="mt-1 text-2xl font-bold text-card-foreground">{dashboardStats.batchesToday}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{dashboardStats.litresProducedToday}L produced</p>
                </div>
                <div className="rounded-lg p-2.5 bg-green-600/10">
                  <TrendingUp className="h-5 w-5 text-green-600" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Quick Actions */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Link href="/jaba/batches/add">
            <Card className="border-border bg-card hover:shadow-lg transition-all cursor-pointer group">
              <CardContent className="p-5">
                <div className="flex items-center gap-4">
                  <div className="rounded-lg p-2.5 bg-red-600/10 group-hover:bg-red-600/20 transition-colors">
                    <Plus className="h-5 w-5 text-red-600" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-card-foreground">Add Batch</h3>
                    <p className="text-sm text-muted-foreground">Create new production batch</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </Link>

          <Link href="/jaba/distribution/create">
            <Card className="border-border bg-card hover:shadow-lg transition-all cursor-pointer group">
              <CardContent className="p-5">
                <div className="flex items-center gap-4">
                  <div className="rounded-lg p-2.5 bg-green-600/10 group-hover:bg-green-600/20 transition-colors">
                    <FileText className="h-5 w-5 text-green-600" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-card-foreground">Create Delivery Note</h3>
                    <p className="text-sm text-muted-foreground">Generate delivery note</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </Link>

          <Link href="/jaba/raw-materials/add">
            <Card className="border-border bg-card hover:shadow-lg transition-all cursor-pointer group">
              <CardContent className="p-5">
                <div className="flex items-center gap-4">
                  <div className="rounded-lg p-2.5 bg-red-600/10 group-hover:bg-red-600/20 transition-colors">
                    <Plus className="h-5 w-5 text-red-600" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-card-foreground">Add Raw Material</h3>
                    <p className="text-sm text-muted-foreground">Register new material</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </Link>

          <Link href="/jaba/reports/batches">
            <Card className="border-border bg-card hover:shadow-lg transition-all cursor-pointer group">
              <CardContent className="p-5">
                <div className="flex items-center gap-4">
                  <div className="rounded-lg p-2.5 bg-slate-900/10 group-hover:bg-slate-900/20 transition-colors">
                    <FileText className="h-5 w-5 text-slate-900 dark:text-slate-100" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-card-foreground">Generate Report</h3>
                    <p className="text-sm text-muted-foreground">Production reports</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </Link>
        </div>

        {/* Charts Row */}
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Daily Production Chart */}
          <Card className="border-border bg-card">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-lg font-semibold text-card-foreground">Daily Production (Litres)</CardTitle>
              <p className="text-sm text-muted-foreground">Last 7 days</p>
            </CardHeader>
            <CardContent className="pt-4">
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={dailyProductionData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="productionGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" className="dark:stroke-slate-800" vertical={false} />
                    <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: "#71717a", fontSize: 12 }} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fill: "#71717a", fontSize: 12 }} tickFormatter={(value) => `${value}L`} />
                    <Tooltip contentStyle={{ backgroundColor: "#1c1c28", border: "1px solid #2a2a3c", borderRadius: "8px", color: "#fafafa" }} />
                    <Area type="monotone" dataKey="litres" stroke="#ef4444" strokeWidth={2} fill="url(#productionGradient)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Weekly Production Summary */}
          <Card className="border-border bg-card">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-lg font-semibold text-card-foreground">Weekly Production Summary</CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={weeklyProductionData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" className="dark:stroke-slate-800" vertical={false} />
                    <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: "#71717a", fontSize: 12 }} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fill: "#71717a", fontSize: 12 }} />
                    <Tooltip contentStyle={{ backgroundColor: "#1c1c28", border: "1px solid #2a2a3c", borderRadius: "8px", color: "#fafafa" }} />
                    <Bar dataKey="litres" fill="#ef4444" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* More Charts Row */}
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Material Usage Trends */}
          <Card className="border-border bg-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg font-semibold text-card-foreground">Material Usage Trends</CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              <div className="h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={materialUsageTrends} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="usageGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" className="dark:stroke-slate-800" vertical={false} />
                    <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: "#71717a", fontSize: 11 }} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fill: "#71717a", fontSize: 11 }} />
                    <Tooltip contentStyle={{ backgroundColor: "#1c1c28", border: "1px solid #2a2a3c", borderRadius: "8px", color: "#fafafa" }} />
                    <Area type="monotone" dataKey="usage" stroke="#10b981" strokeWidth={2} fill="url(#usageGradient)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Distribution Deliveries */}
          <Card className="border-border bg-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg font-semibold text-card-foreground">Distribution Deliveries</CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              <div className="h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={weeklyDistributionData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" className="dark:stroke-slate-800" vertical={false} />
                    <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: "#71717a", fontSize: 11 }} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fill: "#71717a", fontSize: 11 }} />
                    <Tooltip contentStyle={{ backgroundColor: "#1c1c28", border: "1px solid #2a2a3c", borderRadius: "8px", color: "#fafafa" }} />
                    <Bar dataKey="deliveries" fill="#10b981" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tables Row */}
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Recent Batches */}
          <Card className="border-border bg-card">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="flex items-center gap-2 text-lg font-semibold text-card-foreground">
                Recent Batches
              </CardTitle>
              <Link href="/jaba/batches">
                <Button variant="ghost" size="sm">
                  View All
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
            </CardHeader>
            <CardContent>
              <div className="rounded-lg border border-border overflow-hidden">
                {/* Mobile: stacked cards */}
                <div className="md:hidden space-y-3">
                  {recentBatches.length > 0 ? (
                    recentBatches.map((batch) => (
                      <div
                        key={batch.id}
                        className="rounded-xl border border-slate-200/70 dark:border-slate-700/70 bg-card shadow-sm p-3 space-y-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <p className="text-sm font-semibold text-card-foreground">
                              Batch {batch.batchNumber}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {batch.flavor}
                            </p>
                          </div>
                          <Badge className={cn("text-[10px]", getStatusColor(batch.status))}>
                            {batch.status}
                          </Badge>
                        </div>
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>{batch.outputSummary.totalBottles} bottles</span>
                          <span>{batch.totalLitres}L</span>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-center text-sm text-muted-foreground py-4">
                      No batches found
                    </p>
                  )}
                </div>

                {/* Desktop: table */}
                <div className="hidden md:block overflow-x-auto">
                  <Table className="min-w-[560px]">
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead className="font-semibold">Batch No.</TableHead>
                      <TableHead className="font-semibold">Flavor</TableHead>
                      <TableHead className="font-semibold">Status</TableHead>
                      <TableHead className="font-semibold">Output</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recentBatches.length > 0 ? (
                      recentBatches.map((batch) => (
                        <TableRow key={batch.id}>
                          <TableCell className="font-medium">{batch.batchNumber}</TableCell>
                          <TableCell>{batch.flavor}</TableCell>
                          <TableCell>
                            <Badge className={cn("font-medium", getStatusColor(batch.status))}>
                              {batch.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {batch.outputSummary.totalBottles} bottles • {batch.totalLitres}L
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                          No batches found
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Recent Deliveries */}
          <Card className="border-border bg-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg font-semibold text-card-foreground">Recent Deliveries</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="rounded-lg border border-border overflow-hidden">
                {/* Mobile: stacked cards */}
                <div className="md:hidden space-y-3">
                  {recentDeliveries.length > 0 ? (
                    recentDeliveries.map((note) => (
                      <div
                        key={note.id}
                        className="rounded-xl border border-slate-200/70 dark:border-slate-700/70 bg-card shadow-sm p-3 space-y-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <p className="text-sm font-semibold text-card-foreground">
                              {note.distributorName}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Batch {note.batchNumber}
                            </p>
                          </div>
                          <Badge variant="outline" className="text-[10px]">
                            {note.driver || "N/A"}
                          </Badge>
                        </div>
                        <div className="text-xs text-muted-foreground space-y-1">
                          {note.items && note.items.length > 0 ? (
                            note.items.map((item, idx) => (
                              <p key={idx}>
                                {item.quantity}×{item.size}
                              </p>
                            ))
                          ) : (
                            <p>No items</p>
                          )}
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-center text-sm text-muted-foreground py-4">
                      No deliveries found
                    </p>
                  )}
                </div>

                {/* Desktop: table */}
                <div className="hidden md:block overflow-x-auto">
                  <Table className="min-w-[560px]">
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead className="font-semibold">Distributor</TableHead>
                      <TableHead className="font-semibold">Batch</TableHead>
                      <TableHead className="font-semibold">Quantities</TableHead>
                      <TableHead className="font-semibold">Driver</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recentDeliveries.length > 0 ? (
                      recentDeliveries.map((note) => (
                        <TableRow key={note.id}>
                          <TableCell>{note.distributorName}</TableCell>
                          <TableCell className="text-muted-foreground">{note.batchNumber}</TableCell>
                          <TableCell className="text-muted-foreground">
                            {note.items && note.items.length > 0 ? (
                              note.items.map((item, idx) => (
                                <span key={idx} className="text-xs block">{item.quantity}×{item.size}</span>
                              ))
                            ) : (
                              <span className="text-xs">No items</span>
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground">{note.driver || "N/A"}</TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                          No deliveries found
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Low Stock Materials */}
        {lowStockMaterials.length > 0 && (
          <Card className="border-border bg-card">
            <CardHeader className="flex flex-row items-center gap-2 pb-3">
              <AlertTriangle className="h-5 w-5 text-red-600" />
              <CardTitle className="text-lg font-semibold text-card-foreground">Low Stock Materials</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="rounded-lg border border-border overflow-hidden">
                {/* Mobile: stacked cards */}
                <div className="md:hidden space-y-3">
                  {lowStockMaterials.length > 0 ? (
                    lowStockMaterials.map((material) => (
                      <div
                        key={material.id}
                        className="rounded-xl border border-red-200/70 dark:border-red-800/70 bg-red-50 dark:bg-red-950/20 shadow-sm p-3 space-y-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-semibold text-card-foreground">
                            {material.name}
                          </p>
                          <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 text-[10px]">
                            Low Stock
                          </Badge>
                        </div>
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>
                            Current: {material.currentStock} {material.unit}
                          </span>
                          <span>
                            Min: {material.minStock} {material.unit}
                          </span>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-center text-sm text-muted-foreground py-4">
                      All materials are well stocked
                    </p>
                  )}
                </div>

                {/* Desktop: table */}
                <div className="hidden md:block overflow-x-auto">
                  <Table className="min-w-[560px]">
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead className="font-semibold">Material</TableHead>
                      <TableHead className="font-semibold">Current Qty</TableHead>
                      <TableHead className="font-semibold">Reorder Level</TableHead>
                      <TableHead className="font-semibold">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lowStockMaterials.length > 0 ? (
                      lowStockMaterials.map((material) => (
                        <TableRow key={material.id}>
                          <TableCell className="font-medium">{material.name}</TableCell>
                          <TableCell className="text-muted-foreground">{material.currentStock} {material.unit}</TableCell>
                          <TableCell className="text-muted-foreground">{material.minStock} {material.unit}</TableCell>
                          <TableCell>
                            <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">
                              Low Stock
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                          All materials are well stocked
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  )
}
