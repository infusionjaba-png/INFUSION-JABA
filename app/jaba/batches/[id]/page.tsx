"use client"

import { use, useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ArrowLeft, FileText, Package, Truck, Hash, Calendar, User, Clock, Thermometer, TrendingDown, CheckCircle2, XCircle, AlertCircle, Download, Factory, FlaskConical, BarChart3, MapPin, Loader2, Warehouse } from "lucide-react"
import Link from "next/link"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

export default function BatchDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [batch, setBatch] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [packagingOutputs, setPackagingOutputs] = useState<any[]>([])
  const [deliveryNotes, setDeliveryNotes] = useState<any[]>([])

  useEffect(() => {
    const fetchBatchData = async () => {
      try {
        setLoading(true)
        setError(null)

        const batchResponse = await fetch(`/api/jaba/batches/${id}`)
        if (!batchResponse.ok) {
          throw new Error('Failed to fetch batch')
        }
        const batchData = await batchResponse.json()
        setBatch(batchData.batch)
        setPackagingOutputs(Array.isArray(batchData.packagingOutputs) ? batchData.packagingOutputs : [])
        setDeliveryNotes(Array.isArray(batchData.relatedDeliveryNotes) ? batchData.relatedDeliveryNotes : [])

        // Fallback only if API didn't include related collections (older deploys)
        if (!Array.isArray(batchData.packagingOutputs)) {
          try {
            const packagingResponse = await fetch(`/api/jaba/packaging-output?batchId=${id}`)
            if (packagingResponse.ok) {
              const packagingData = await packagingResponse.json()
              setPackagingOutputs(packagingData.packagingOutputs || [])
            }
          } catch (e) {
            console.error('Error fetching packaging outputs:', e)
          }
        }

        if (!Array.isArray(batchData.relatedDeliveryNotes) && batchData.batch?.batchNumber) {
          try {
            const deliveryResponse = await fetch(
              `/api/jaba/delivery-notes?batchNumber=${encodeURIComponent(batchData.batch.batchNumber)}`
            )
            if (deliveryResponse.ok) {
              const deliveryData = await deliveryResponse.json()
              const relatedDeliveries =
                deliveryData.deliveryNotes?.filter(
                  (dn: any) =>
                    dn.items?.some((item: any) => item.batchNumber === batchData.batch?.batchNumber)
                ) || []
              setDeliveryNotes(relatedDeliveries)
            }
          } catch (e) {
            console.error('Error fetching delivery notes:', e)
          }
        }
      } catch (err: any) {
        console.error('Error fetching batch:', err)
        setError(err.message || 'Failed to load batch')
        toast.error('Failed to load batch details')
      } finally {
        setLoading(false)
      }
    }

    if (id) {
      fetchBatchData()
    }
  }, [id])

  if (loading) {
    return (
      <>
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border bg-gradient-to-r from-slate-50 to-white dark:from-slate-900 dark:to-slate-950 px-6 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-card/80">
          <div className="flex items-center gap-4">
            <Link href="/jaba/batches">
              <button className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors">
                <ArrowLeft className="h-5 w-5 text-slate-700 dark:text-slate-300" />
              </button>
            </Link>
            <div>
              <h1 className="text-xl font-bold text-foreground">Loading Batch...</h1>
            </div>
          </div>
        </header>
        <div className="p-6">
          <Card>
            <CardContent className="p-12 text-center">
              <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-slate-400" />
              <p className="text-lg font-semibold text-slate-600 dark:text-slate-400">Loading batch details...</p>
            </CardContent>
          </Card>
        </div>
      </>
    )
  }

  if (error || !batch) {
    return (
      <>
        <div className="p-6">
          <Card className="border-red-200 dark:border-red-900/50 bg-gradient-to-br from-red-50 to-rose-50 dark:from-red-950/30 dark:to-rose-950/20 shadow-lg">
            <CardContent className="p-12 text-center">
              <div className="flex flex-col items-center gap-4">
                <div className="p-4 rounded-full bg-red-100 dark:bg-red-900/40 border-2 border-red-200 dark:border-red-900/30">
                  <AlertCircle className="h-8 w-8 text-red-600 dark:text-red-400" />
                </div>
                <p className="text-lg font-semibold text-red-900 dark:text-red-100">
                  {error || "Batch not found"}
                </p>
                <Link href="/jaba/batches">
                  <button className="mt-2 px-4 py-2 rounded-lg bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800 text-white font-semibold shadow-lg shadow-red-500/30 transition-all">
                    Back to Batches
                  </button>
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      </>
    )
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case "Completed":
        return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 border-green-200 dark:border-green-900/30"
      case "Ready for Distribution":
        return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 border-blue-200 dark:border-blue-900/30"
      case "QC Pending":
        return "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 border-amber-200 dark:border-amber-900/30"
      case "Processing":
        return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-900/30"
      default:
        return "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-700"
    }
  }

  // Helper function to parse date strings
  const parseDate = (date: any): Date => {
    if (date instanceof Date) return date
    if (typeof date === 'string') return new Date(date)
    return new Date()
  }

  const totalMaterialCost = batch.ingredients?.reduce((sum: number, ing: any) => sum + (ing.totalCost || 0), 0) || 0
  const batchDate = parseDate(batch.date)
  const totalBottles = Number(batch.outputSummary?.totalBottles ?? 0)
  const flavourLineLookup = new Map<string, string>()
  ;(batch.flavourOutputs || []).forEach((row: any) => {
    const rowId = String(row?._id || row?.id || "")
    if (!rowId) return
    flavourLineLookup.set(rowId, String(row?.flavourName || row?.flavor || row?.batchNumber || "Unknown flavour"))
  })
  const baseFlavourLabel = String(batch.displayFlavorLabel || batch.flavor || "Unflavoured")
  const resolveFlavourLabel = (flavourLineId?: string, fallbackFlavour?: string) => {
    const lineId = String(flavourLineId || "")
    if (lineId && flavourLineLookup.has(lineId)) return flavourLineLookup.get(lineId)!
    if (fallbackFlavour) return String(fallbackFlavour)
    return baseFlavourLabel
  }

  const packagingByFlavour = new Map<string, { key: string; flavour: string; sessions: number; litres: number; units: number; bySize: Record<string, number> }>()
  packagingOutputs.forEach((po: any) => {
    const key = String(po.flavourLineId || po.flavourName || po.flavor || "__base__")
    const flavour = resolveFlavourLabel(po.flavourLineId, po.flavourName || po.flavor)
    const existing = packagingByFlavour.get(key) || { key, flavour, sessions: 0, litres: 0, units: 0, bySize: {} }
    existing.sessions += 1
    existing.litres += Number(po.packagedLitres) || 0
    ;(Array.isArray(po.containers) ? po.containers : []).forEach((c: any) => {
      const size = String(c?.size || "other")
      const qty = Number(c?.quantity) || 0
      existing.units += qty
      existing.bySize[size] = (existing.bySize[size] || 0) + qty
    })
    packagingByFlavour.set(key, existing)
  })
  const packagingFlavourRows = Array.from(packagingByFlavour.values()).sort((a, b) => b.litres - a.litres)

  const distributionByFlavour = new Map<
    string,
    { key: string; flavour: string; notes: number; units: number; bySize: Record<string, number> }
  >()
  deliveryNotes.forEach((note: any) => {
    const seenInNote = new Set<string>()
    ;(note.items || []).forEach((item: any) => {
      if (item.batchNumber !== batch.batchNumber) return
      const key = String(item.flavourLineId || item.flavor || "__base__")
      const flavour = resolveFlavourLabel(item.flavourLineId, item.flavor)
      const sizeKey = String(item.size || item.containerSize || "other")
      const qty = Number(item.quantity) || 0
      const existing =
        distributionByFlavour.get(key) || { key, flavour, notes: 0, units: 0, bySize: {} }
      existing.units += qty
      existing.bySize[sizeKey] = (existing.bySize[sizeKey] || 0) + qty
      if (!seenInNote.has(key)) {
        existing.notes += 1
        seenInNote.add(key)
      }
      distributionByFlavour.set(key, existing)
    })
  })
  const distributionFlavourRows = Array.from(distributionByFlavour.values()).sort((a, b) => b.units - a.units)

  /** Packaged bottles not yet distributed, per flavour (and by bottle size when data allows) */
  const storageFlavourRows = (() => {
    const keys = new Set<string>([...packagingByFlavour.keys(), ...distributionByFlavour.keys()])
    const rows: Array<{
      key: string
      flavour: string
      packagedBottles: number
      distributedBottles: number
      inStorageBottles: number
      packagedLitres: number
      bySize: Record<string, number>
    }> = []
    keys.forEach((key) => {
      const pack = packagingByFlavour.get(key)
      const dist = distributionByFlavour.get(key)
      const flavour =
        pack?.flavour ||
        dist?.flavour ||
        resolveFlavourLabel(key === "__base__" ? undefined : key, undefined)
      const packagedBottles = pack?.units ?? 0
      const distributedBottles = dist?.units ?? 0
      const inStorageBottles = Math.max(0, packagedBottles - distributedBottles)
      const packagedLitres = pack?.litres ?? 0
      const bySize: Record<string, number> = {}
      const distHasBySize = Object.keys(dist?.bySize || {}).length > 0
      const sizeKeys = new Set([
        ...Object.keys(pack?.bySize || {}),
        ...Object.keys(dist?.bySize || {}),
      ])
      sizeKeys.forEach((sz) => {
        const p = pack?.bySize?.[sz] ?? 0
        const d = dist?.bySize?.[sz] ?? 0
        let left = 0
        if (distributedBottles === 0) {
          left = p
        } else if (distHasBySize) {
          left = Math.max(0, p - d)
        }
        // If distribution has totals but no per-size lines, do not infer splits (avoids wrong per-size rows)
        if (left > 0) bySize[sz] = left
      })
      rows.push({
        key,
        flavour,
        packagedBottles,
        distributedBottles,
        inStorageBottles,
        packagedLitres,
        bySize,
      })
    })
    return rows.sort((a, b) => b.inStorageBottles - a.inStorageBottles)
  })()
  const totalStorageBottles = storageFlavourRows.reduce((s, r) => s + r.inStorageBottles, 0)

  return (
    <>
      <header className="sticky top-0 z-30 flex min-h-16 flex-col gap-3 border-b border-border bg-gradient-to-r from-violet-50 via-white to-fuchsia-50 px-4 py-3 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-card/80 dark:from-slate-900 dark:via-slate-900 dark:to-violet-950/30 sm:px-6 md:h-16 md:flex-row md:items-center md:justify-between md:py-0">
        <div className="flex min-w-0 items-center gap-3 sm:gap-4">
          <Link href="/jaba/batches">
            <button className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors">
              <ArrowLeft className="h-5 w-5 text-slate-700 dark:text-slate-300" />
            </button>
          </Link>
          <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
            <div className="rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-600 p-2 shadow-lg">
              <Hash className="h-5 w-5 text-white" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-bold text-foreground sm:text-xl">{batch.batchNumber}</h1>
              <p className="truncate text-xs font-medium text-muted-foreground sm:text-sm">
                {batch.displayFlavorLabel || batch.flavor} • {batch.productCategory}
                {batch.batchType === "flavoured" && (
                  <span className="ml-2 rounded-md border border-violet-300 px-1.5 py-0.5 text-xs text-violet-800 dark:text-violet-200">
                    Flavoured output
                  </span>
                )}
              </p>
            </div>
          </div>
        </div>
        <Badge className={cn("w-fit font-semibold text-xs border-2 px-3 py-1.5 sm:text-sm", getStatusColor(batch.status))}>
          {batch.status}
        </Badge>
      </header>

      <div className="p-6 bg-gradient-to-br from-slate-50 via-background to-slate-50 dark:from-slate-950 dark:via-background dark:to-slate-950 min-h-screen">
        <Card className="mb-6 overflow-hidden border-violet-200/80 bg-gradient-to-r from-violet-50 via-fuchsia-50/60 to-indigo-50/70 shadow-md dark:border-violet-900/50 dark:from-violet-950/30 dark:via-fuchsia-950/20 dark:to-indigo-950/20">
          <CardContent className="p-4 sm:p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-violet-700 dark:text-violet-300">Flavour profile</p>
                <h2 className="mt-1 truncate text-xl font-bold text-slate-900 dark:text-slate-100">
                  {batch.displayFlavorLabel || batch.flavor}
                </h2>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                  Batch type: <span className="font-semibold">{batch.batchType || "standard"}</span>
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="rounded-lg border border-violet-200/70 bg-white/80 px-3 py-2 dark:border-violet-900/60 dark:bg-slate-900/60">
                  <p className="text-[11px] text-muted-foreground">Produced</p>
                  <p className="text-sm font-bold text-slate-900 dark:text-slate-100">{Number(batch.totalLitres || 0).toFixed(2)}L</p>
                </div>
                <div className="rounded-lg border border-indigo-200/70 bg-white/80 px-3 py-2 dark:border-indigo-900/60 dark:bg-slate-900/60">
                  <p className="text-[11px] text-muted-foreground">Bottles</p>
                  <p className="text-sm font-bold text-slate-900 dark:text-slate-100">{totalBottles.toLocaleString()}</p>
                </div>
                <div className="rounded-lg border border-fuchsia-200/70 bg-white/80 px-3 py-2 dark:border-fuchsia-900/60 dark:bg-slate-900/60">
                  <p className="text-[11px] text-muted-foreground">Supervisor</p>
                  <p className="truncate text-sm font-bold text-slate-900 dark:text-slate-100">{batch.supervisor || "N/A"}</p>
                </div>
                <div className="rounded-lg border border-slate-200/80 bg-white/80 px-3 py-2 dark:border-slate-700 dark:bg-slate-900/60">
                  <p className="text-[11px] text-muted-foreground">Status</p>
                  <p className="truncate text-sm font-bold text-slate-900 dark:text-slate-100">{batch.status || "—"}</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {(batch.flavourOutputs?.length > 0 ||
          batch.parentBatch ||
          batch.batchType === "neutral" ||
          batch.legacyFlavourFirstBatch) && (
          <Card className="mb-6 border-violet-200/80 bg-gradient-to-br from-white to-violet-50/50 shadow-sm dark:border-violet-900/40 dark:from-slate-900 dark:to-violet-950/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg flex items-center gap-2 text-slate-900 dark:text-slate-100">
                <FlaskConical className="h-5 w-5 text-violet-600" />
                Flavour traceability
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {batch.parentBatch && (
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/40 p-4">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Neutral parent batch</p>
                  <Link
                    href={`/jaba/batches/${batch.parentBatch.id}`}
                    className="text-base font-semibold text-violet-700 dark:text-violet-300 hover:underline"
                  >
                    {batch.parentBatch.batchNumber}
                  </Link>
                  <p className="text-sm text-muted-foreground mt-1">
                    {batch.parentBatch.flavor} · Produced {batch.parentBatch.totalLitres}L · Remaining neutral{" "}
                    {(batch.parentBatch.neutralRemainingLitres ?? batch.parentBatch.outputSummary?.remainingLitres ?? 0).toFixed(2)}L
                  </p>
                </div>
              )}
              {!batch.parentBatch && batch.batchType === "neutral" && (
                <div className="grid gap-3 sm:grid-cols-3 text-sm">
                  <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
                    <p className="text-xs text-muted-foreground mb-0.5">Neutral produced</p>
                    <p className="text-lg font-bold text-slate-900 dark:text-slate-100">{batch.totalLitres}L</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
                    <p className="text-xs text-muted-foreground mb-0.5">Allocated to flavours</p>
                    <p className="text-lg font-bold text-slate-900 dark:text-slate-100">
                      {(batch.infusedAllocatedLitres ?? 0).toFixed(2)}L
                    </p>
                  </div>
                  <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
                    <p className="text-xs text-muted-foreground mb-0.5">Remaining neutral</p>
                    <p className="text-lg font-bold text-slate-900 dark:text-slate-100">
                      {(batch.neutralRemainingLitres ?? batch.outputSummary?.remainingLitres ?? 0).toFixed(2)}L
                    </p>
                  </div>
                </div>
              )}
              {batch.legacyFlavourFirstBatch && (
                <p className="text-xs text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 rounded-md px-3 py-2">
                  Legacy batch: flavour was assigned at creation. New production should use neutral base batches, then Infuse on the batch list.
                </p>
              )}
              {batch.flavourOutputs?.length > 0 && (
                <div>
                  <p className="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-200">Flavoured outputs</p>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {batch.flavourOutputs.map((row: any) => (
                      <div
                        key={row._id || row.id}
                        className="rounded-xl border border-violet-200/80 bg-gradient-to-br from-violet-50 to-fuchsia-50/50 p-3 shadow-sm dark:border-violet-900/40 dark:from-violet-950/30 dark:to-fuchsia-950/20"
                      >
                        <p className="text-[11px] uppercase tracking-wide text-violet-700 dark:text-violet-300">Flavour line</p>
                        <Link
                          href={`/jaba/batches/${row._id || row.id}`}
                          className="mt-1 inline-block font-mono text-sm font-semibold text-violet-800 hover:underline dark:text-violet-200"
                        >
                          {row.lineCode || row.batchNumber || "—"}
                        </Link>
                        <p className="mt-2 text-sm font-medium text-slate-900 dark:text-slate-100">{row.flavor || "N/A"}</p>
                        <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                          <span>Volume</span>
                          <span className="font-semibold text-slate-900 dark:text-slate-100">
                            {`${Number(row.allocatedLitres ?? row.infusedQuantityLitres ?? row.totalLitres ?? 0).toFixed(2)}L`}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                          <span>Infused</span>
                          <span>{row.infusionDate ? parseDate(row.infusionDate).toLocaleDateString() : "—"}</span>
                        </div>
                        <Badge variant="outline" className="mt-3 text-[11px]">
                          {row.status}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Summary Cards */}
        <div className="mb-6 grid gap-3 sm:gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Card className="border-blue-200 dark:border-blue-900/50 bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-900/20 shadow-lg hover:shadow-xl transition-shadow">
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <p className="text-sm font-medium text-blue-700 dark:text-blue-300 mb-1">Total Bottles</p>
                  <p className="text-3xl font-bold text-blue-900 dark:text-blue-100">{totalBottles.toLocaleString()}</p>
                  <div className="flex items-center gap-2 text-xs text-blue-600 dark:text-blue-400 mt-2">
                    <Package className="h-3 w-3" />
                    <span>Produced</span>
                  </div>
                </div>
                <div className="rounded-xl p-3 bg-blue-100 dark:bg-blue-900/40 border border-blue-200 dark:border-blue-800/50">
                  <Package className="h-6 w-6 text-blue-600 dark:text-blue-400" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-green-200 dark:border-green-900/50 bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-950/30 dark:to-emerald-900/20 shadow-lg hover:shadow-xl transition-shadow">
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <p className="text-sm font-medium text-green-700 dark:text-green-300 mb-1">Total Litres</p>
                  <p className="text-3xl font-bold text-green-900 dark:text-green-100">{batch.totalLitres}L</p>
                  <div className="flex items-center gap-2 text-xs text-green-600 dark:text-green-400 mt-2">
                    <FlaskConical className="h-3 w-3" />
                    <span>Volume</span>
                  </div>
                </div>
                <div className="rounded-xl p-3 bg-green-100 dark:bg-green-900/40 border border-green-200 dark:border-green-800/50">
                  <FlaskConical className="h-6 w-6 text-green-600 dark:text-green-400" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-purple-200 dark:border-purple-900/50 bg-gradient-to-br from-purple-50 to-violet-50 dark:from-purple-950/30 dark:to-violet-900/20 shadow-lg hover:shadow-xl transition-shadow">
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <p className="text-sm font-medium text-purple-700 dark:text-purple-300 mb-1">Material Cost</p>
                  <p className="text-3xl font-bold text-purple-900 dark:text-purple-100">${totalMaterialCost.toFixed(0)}</p>
                  <div className="flex items-center gap-2 text-xs text-purple-600 dark:text-purple-400 mt-2">
                    <BarChart3 className="h-3 w-3" />
                    <span>Total</span>
                  </div>
                </div>
                <div className="rounded-xl p-3 bg-purple-100 dark:bg-purple-900/40 border border-purple-200 dark:border-purple-800/50">
                  <BarChart3 className="h-6 w-6 text-purple-600 dark:text-purple-400" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-200 dark:border-slate-800 bg-gradient-to-br from-slate-50 to-slate-100/80 dark:from-slate-900/40 dark:to-slate-950/40 shadow-lg hover:shadow-xl transition-shadow">
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Workflow status</p>
                  <p className="text-lg font-bold text-slate-900 dark:text-slate-100 leading-snug break-words">{batch.status}</p>
                  <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400 mt-2">
                    <BarChart3 className="h-3 w-3 shrink-0" />
                    <span>Production pipeline</span>
                  </div>
                </div>
                <div className="rounded-xl p-3 border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/60">
                  <BarChart3 className="h-6 w-6 text-slate-600 dark:text-slate-400" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="overview" className="space-y-6">
          <TabsList className="h-auto w-full flex-wrap justify-start gap-1.5 border-2 border-slate-200 bg-gradient-to-r from-slate-100 to-slate-50 p-1.5 dark:border-slate-700 dark:from-slate-800 dark:to-slate-900">
            <TabsTrigger value="overview" className="data-[state=active]:bg-white data-[state=active]:shadow-md dark:data-[state=active]:bg-slate-900 px-3 py-2 text-xs sm:px-4 sm:text-sm">
              <BarChart3 className="h-4 w-4 mr-2" />
              Overview
            </TabsTrigger>
            <TabsTrigger value="packaging" className="data-[state=active]:bg-white data-[state=active]:shadow-md dark:data-[state=active]:bg-slate-900 px-3 py-2 text-xs sm:px-4 sm:text-sm">
              <Package className="h-4 w-4 mr-2" />
              Packaging
            </TabsTrigger>
            <TabsTrigger value="storage" className="data-[state=active]:bg-white data-[state=active]:shadow-md dark:data-[state=active]:bg-slate-900 px-3 py-2 text-xs sm:px-4 sm:text-sm">
              <Warehouse className="h-4 w-4 mr-2" />
              Storage
            </TabsTrigger>
            <TabsTrigger value="materials" className="data-[state=active]:bg-white data-[state=active]:shadow-md dark:data-[state=active]:bg-slate-900 px-3 py-2 text-xs sm:px-4 sm:text-sm">
              <Factory className="h-4 w-4 mr-2" />
              Materials
            </TabsTrigger>
            <TabsTrigger value="distribution" className="data-[state=active]:bg-white data-[state=active]:shadow-md dark:data-[state=active]:bg-slate-900 px-3 py-2 text-xs sm:px-4 sm:text-sm">
              <Truck className="h-4 w-4 mr-2" />
              Distribution
            </TabsTrigger>
            <TabsTrigger value="documents" className="data-[state=active]:bg-white data-[state=active]:shadow-md dark:data-[state=active]:bg-slate-900 px-3 py-2 text-xs sm:px-4 sm:text-sm">
              <FileText className="h-4 w-4 mr-2" />
              Documents
            </TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-6">
            <div className="grid gap-6 md:grid-cols-2">
              <Card className="border-blue-200 dark:border-blue-900/50 bg-gradient-to-br from-blue-50/50 to-indigo-50/30 dark:from-blue-950/20 dark:to-indigo-950/10 shadow-lg">
                <CardHeader className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/20 border-b border-blue-200 dark:border-blue-900/50">
                  <CardTitle className="text-lg font-bold text-card-foreground flex items-center gap-2">
                    <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/30">
                      <Hash className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                    </div>
                    Batch Information
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-6 space-y-4">
                  <div className="flex justify-between items-center py-2 border-b border-slate-200 dark:border-slate-800">
                    <span className="text-sm font-medium text-slate-600 dark:text-slate-400 flex items-center gap-2">
                      <Hash className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                      Batch Number:
                    </span>
                    <span className="font-bold text-slate-900 dark:text-slate-100">{batch.batchNumber}</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b border-slate-200 dark:border-slate-800">
                    <span className="text-sm font-medium text-slate-600 dark:text-slate-400 flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                      Date:
                    </span>
                    <span className="font-semibold text-slate-900 dark:text-slate-100">{batchDate.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b border-slate-200 dark:border-slate-800">
                    <span className="text-sm font-medium text-slate-600 dark:text-slate-400 flex items-center gap-2">
                      <Package className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                      Product Category:
                    </span>
                    <span className="font-semibold text-slate-900 dark:text-slate-100">{batch.productCategory}</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b border-slate-200 dark:border-slate-800">
                    <span className="text-sm font-medium text-slate-600 dark:text-slate-400 flex items-center gap-2">
                      <FlaskConical className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                      Flavor:
                    </span>
                    <span className="font-semibold text-slate-900 dark:text-slate-100">{batch.flavor}</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b border-slate-200 dark:border-slate-800">
                    <span className="text-sm font-medium text-slate-600 dark:text-slate-400 flex items-center gap-2">
                      <User className="h-4 w-4 text-green-600 dark:text-green-400" />
                      Supervisor:
                    </span>
                    <span className="font-semibold text-slate-900 dark:text-slate-100">{batch.supervisor}</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b border-slate-200 dark:border-slate-800">
                    <span className="text-sm font-medium text-slate-600 dark:text-slate-400 flex items-center gap-2">
                      <Clock className="h-4 w-4 text-orange-600 dark:text-orange-400" />
                      Shift:
                    </span>
                    <span className="font-semibold text-slate-900 dark:text-slate-100">{batch.shift}</span>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-purple-200 dark:border-purple-900/50 bg-gradient-to-br from-purple-50/50 to-violet-50/30 dark:from-purple-950/20 dark:to-violet-950/10 shadow-lg">
                <CardHeader className="bg-gradient-to-r from-purple-50 to-violet-50 dark:from-purple-950/30 dark:to-violet-950/20 border-b border-purple-200 dark:border-purple-900/50">
                  <CardTitle className="text-lg font-bold text-card-foreground flex items-center gap-2">
                    <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-900/30">
                      <Factory className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                    </div>
                    Production Details
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-6 space-y-4">
                  {/* Expected vs Actual Production */}
                  <div className="p-4 rounded-lg bg-gradient-to-r from-purple-50 to-violet-50 dark:from-purple-950/30 dark:to-violet-950/20 border-2 border-purple-200 dark:border-purple-900/50 mb-4">
                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-2">
                          <FlaskConical className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                          Expected Volume:
                        </span>
                        <div className="flex items-center gap-2">
                          {!batch.expectedLitres && batch.status === "Processed" && (
                            <span className="text-xs text-amber-600 dark:text-amber-400 italic">(Not recorded - batch created before this feature)</span>
                          )}
                          <span className="font-bold text-lg text-blue-700 dark:text-blue-400">
                            {batch.expectedLitres ? `${batch.expectedLitres}L` : (batch.status === "Processing" ? `${batch.totalLitres}L` : "N/A")}
                          </span>
                        </div>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-2">
                          <FlaskConical className="h-4 w-4 text-green-600 dark:text-green-400" />
                          Actual Produced:
                        </span>
                        <span className="font-bold text-lg text-green-700 dark:text-green-400">
                          {batch.totalLitres}L
                        </span>
                      </div>
                      {(() => {
                        // For processed batches, if expectedLitres doesn't exist, we can't calculate variance
                        // But if it exists, show the comparison
                        const expected = batch.expectedLitres
                        const actual = batch.totalLitres || 0
                        
                        if (!expected && batch.status === "Processed") {
                          return (
                            <div className="pt-2 border-t border-purple-200 dark:border-purple-800">
                              <p className="text-xs text-amber-600 dark:text-amber-400 italic">
                                Expected volume was not recorded for this batch. Variance cannot be calculated.
                              </p>
                            </div>
                          )
                        }
                        
                        if (expected) {
                          const difference = actual - expected
                          const hasVariance = Math.abs(difference) > 0.01
                          
                          if (hasVariance) {
                            return (
                              <>
                                <div className="flex justify-between items-center pt-2 border-t border-purple-200 dark:border-purple-800">
                                  <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                                    Variance:
                                  </span>
                                  <span className={cn(
                                    "font-bold text-base",
                                    difference < 0 
                                      ? "text-amber-700 dark:text-amber-400"
                                      : "text-blue-700 dark:text-blue-400"
                                  )}>
                                    {difference > 0 ? '+' : ''}{difference.toFixed(2)}L
                                    <span className="text-xs font-normal ml-1">
                                      ({((difference / expected) * 100).toFixed(1)}%)
                                    </span>
                                  </span>
                                </div>
                                {batch.productionVarianceReason && (
                                  <div className="pt-2 border-t border-purple-200 dark:border-purple-800">
                                    <p className="text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Reason for Variance:</p>
                                    <p className="text-sm text-slate-700 dark:text-slate-300 bg-white/50 dark:bg-slate-900/50 p-2 rounded border border-purple-200 dark:border-purple-800">
                                      {batch.productionVarianceReason}
                                    </p>
                                  </div>
                                )}
                              </>
                            )
                          } else {
                            return (
                              <div className="pt-2 border-t border-purple-200 dark:border-purple-800">
                                <p className="text-xs text-green-600 dark:text-green-400 font-semibold">
                                  ✓ Production matches expected volume
                                </p>
                              </div>
                            )
                          }
                        }
                        return null
                      })()}
                    </div>
                  </div>
                  {batch.productionStartTime && (
                    <div className="flex justify-between items-center py-2 border-b border-slate-200 dark:border-slate-800">
                      <span className="text-sm font-medium text-slate-600 dark:text-slate-400 flex items-center gap-2">
                        <Clock className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                        Start Time:
                      </span>
                      <span className="font-semibold text-slate-900 dark:text-slate-100">{parseDate(batch.productionStartTime).toLocaleTimeString()}</span>
                    </div>
                  )}
                  {batch.productionEndTime && (
                    <div className="flex justify-between items-center py-2 border-b border-slate-200 dark:border-slate-800">
                      <span className="text-sm font-medium text-slate-600 dark:text-slate-400 flex items-center gap-2">
                        <Clock className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                        End Time:
                      </span>
                      <span className="font-semibold text-slate-900 dark:text-slate-100">{parseDate(batch.productionEndTime).toLocaleTimeString()}</span>
                    </div>
                  )}
                  {batch.mixingDuration && (
                    <div className="flex justify-between items-center py-2 border-b border-slate-200 dark:border-slate-800">
                      <span className="text-sm font-medium text-slate-600 dark:text-slate-400 flex items-center gap-2">
                        <Clock className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                        Mixing Duration:
                      </span>
                      <span className="font-semibold text-slate-900 dark:text-slate-100">{batch.mixingDuration} min</span>
                    </div>
                  )}
                  {batch.processingHours && (
                    <div className="flex justify-between items-center py-2 border-b border-slate-200 dark:border-slate-800">
                      <span className="text-sm font-medium text-slate-600 dark:text-slate-400 flex items-center gap-2">
                        <Clock className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
                        Processing Hours:
                      </span>
                      <span className="font-semibold text-slate-900 dark:text-slate-100">{batch.processingHours}h</span>
                    </div>
                  )}
                  {batch.temperature && (
                    <div className="flex justify-between items-center py-2 border-b border-slate-200 dark:border-slate-800">
                      <span className="text-sm font-medium text-slate-600 dark:text-slate-400 flex items-center gap-2">
                        <Thermometer className="h-4 w-4 text-red-600 dark:text-red-400" />
                        Temperature:
                      </span>
                      <span className="font-semibold text-slate-900 dark:text-slate-100">{batch.temperature}°C</span>
                    </div>
                  )}
                  {batch.expectedLoss && (
                    <div className="flex justify-between items-center py-2 border-b border-slate-200 dark:border-slate-800">
                      <span className="text-sm font-medium text-slate-600 dark:text-slate-400 flex items-center gap-2">
                        <TrendingDown className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                        Expected Loss:
                      </span>
                      <span className="font-semibold text-slate-900 dark:text-slate-100">{batch.expectedLoss.toFixed(2)}%</span>
                    </div>
                  )}
                  {batch.actualLoss && (
                    <div className="flex justify-between items-center py-2">
                      <span className="text-sm font-medium text-slate-600 dark:text-slate-400 flex items-center gap-2">
                        <TrendingDown className="h-4 w-4 text-orange-600 dark:text-orange-400" />
                        Actual Loss:
                      </span>
                      <span className="font-semibold text-slate-900 dark:text-slate-100">{batch.actualLoss.toFixed(2)}%</span>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            <Card className="border-green-200 dark:border-green-900/50 bg-gradient-to-br from-green-50/50 to-emerald-50/30 dark:from-green-950/20 dark:to-emerald-950/10 shadow-lg">
              <CardHeader className="bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-950/30 dark:to-emerald-950/20 border-b border-green-200 dark:border-green-900/50">
                <CardTitle className="text-lg font-bold text-card-foreground flex items-center gap-2">
                  <div className="p-2 rounded-lg bg-green-100 dark:bg-green-950/40 border border-green-200 dark:border-green-900/30">
                    <Package className="h-5 w-5 text-green-600 dark:text-green-400" />
                  </div>
                  <div className="flex flex-col">
                    <span>Output Summary</span>
                    <span className="text-xs font-normal text-muted-foreground mt-0.5">
                      Packaging status and remaining inventory
                    </span>
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                <div className="space-y-4">
                  {packagingFlavourRows.length > 0 && (
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {packagingFlavourRows.map((row) => (
                        <div key={row.key} className="rounded-lg border border-emerald-200/80 bg-white/80 p-3 dark:border-emerald-900/40 dark:bg-slate-900/60">
                          <p className="text-xs text-muted-foreground">Flavour</p>
                          <p className="text-sm font-bold text-slate-900 dark:text-slate-100">{row.flavour}</p>
                          <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                            <div>
                              <p className="text-muted-foreground">Sessions</p>
                              <p className="font-semibold">{row.sessions}</p>
                            </div>
                            <div>
                              <p className="text-muted-foreground">Packed</p>
                              <p className="font-semibold">{row.litres.toFixed(2)}L</p>
                            </div>
                            <div>
                              <p className="text-muted-foreground">Units</p>
                              <p className="font-semibold">{row.units.toLocaleString()}</p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="p-4 rounded-lg bg-gradient-to-r from-green-100 to-emerald-100 dark:from-green-900/40 dark:to-emerald-900/40 border-2 border-green-200 dark:border-green-900/30">
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-semibold text-green-700 dark:text-green-300 flex items-center gap-2">
                        <Package className="h-4 w-4 text-green-600 dark:text-green-400" />
                        Total Bottles:
                      </span>
                      <span className="font-bold text-2xl text-green-900 dark:text-green-100">{(batch.outputSummary?.totalBottles || 0).toLocaleString()}</span>
                    </div>
                  </div>
                  <div className="grid gap-3 md:grid-cols-3">
                    {(batch.outputSummary?.breakdown || []).map((item: any, idx: number) => {
                      const colors = [
                        { icon: "text-blue-600 dark:text-blue-400", bg: "bg-blue-50 dark:bg-blue-950/20" },
                        { icon: "text-purple-600 dark:text-purple-400", bg: "bg-purple-50 dark:bg-purple-950/20" },
                        { icon: "text-indigo-600 dark:text-indigo-400", bg: "bg-indigo-50 dark:bg-indigo-950/20" },
                      ]
                      const color = colors[idx % colors.length]
                      return (
                        <div key={item.size} className={cn("p-4 rounded-lg border border-slate-200 dark:border-slate-800", color.bg)}>
                          <div className="flex items-center gap-2 mb-2">
                            <Package className={cn("h-4 w-4", color.icon)} />
                            <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">{item.size}</span>
                          </div>
                          <p className="text-xl font-bold text-slate-900 dark:text-slate-100">{item.quantity.toLocaleString()} pcs</p>
                          <p className="text-xs text-slate-500 dark:text-slate-500 mt-1">{item.litres}L</p>
                        </div>
                      )
                    })}
                  </div>
                  <div className="pt-3 border-t border-slate-200 dark:border-slate-800">
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-semibold text-slate-600 dark:text-slate-400 flex items-center gap-2">
                        <FlaskConical className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                        Remaining Litres:
                      </span>
                      <span className="font-bold text-lg text-slate-900 dark:text-slate-100">
                        {(() => {
                          // Remaining litres should never exceed totalLitres (actual produced)
                          // If remainingLitres is greater than totalLitres, it's likely using old expected value
                          const actualProduced = batch.totalLitres || 0
                          const remaining = batch.outputSummary?.remainingLitres
                          
                          // If remaining is undefined or greater than actual produced, use actual produced
                          // Otherwise, use the remaining value (which decreases as packaging happens)
                          if (!remaining || remaining > actualProduced) {
                            return `${actualProduced}L`
                          }
                          return `${remaining}L`
                        })()}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 italic">
                      Volume available for packaging. Decreases as packaging sessions are completed.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Packaging Output Tab */}
          <TabsContent value="packaging" className="space-y-6">
            <Card className="border-amber-200 dark:border-amber-900/50 bg-gradient-to-br from-amber-50/50 to-orange-50/30 dark:from-amber-950/20 dark:to-orange-950/10 shadow-lg">
              <CardHeader className="bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/20 border-b border-amber-200 dark:border-amber-900/50">
                <CardTitle className="text-lg font-bold text-card-foreground flex items-center gap-2">
                  <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/30">
                    <Package className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                  </div>
                  Packaging Output
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                <div className="space-y-6">
                  {packagingFlavourRows.length > 0 ? (
                    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                      {packagingFlavourRows.map((row) => (
                        <Card key={row.key} className="border-amber-200 dark:border-amber-900/40 bg-white/80 dark:bg-slate-900/60 shadow-sm">
                          <CardContent className="p-4 space-y-2.5">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-sm font-bold text-slate-900 dark:text-slate-100">{row.flavour}</p>
                              <Badge variant="outline" className="text-[11px]">{row.sessions} session{row.sessions !== 1 ? "s" : ""}</Badge>
                            </div>
                            <div className="grid grid-cols-2 gap-2 text-xs">
                              <div className="rounded-md border border-slate-200 dark:border-slate-700 px-2.5 py-2">
                                <p className="text-muted-foreground">Packed</p>
                                <p className="font-semibold text-slate-900 dark:text-slate-100">{row.litres.toFixed(2)}L</p>
                              </div>
                              <div className="rounded-md border border-slate-200 dark:border-slate-700 px-2.5 py-2">
                                <p className="text-muted-foreground">Units</p>
                                <p className="font-semibold text-slate-900 dark:text-slate-100">{row.units.toLocaleString()}</p>
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-1.5 pt-1">
                              {Object.entries(row.bySize).map(([size, qty]) => (
                                <Badge key={`${row.key}-${size}`} variant="secondary" className="text-[10px]">
                                  {size}: {Number(qty).toLocaleString()}
                                </Badge>
                              ))}
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-amber-200 dark:border-amber-900/40 bg-amber-50/80 dark:bg-amber-950/20 p-4 text-sm text-amber-800 dark:text-amber-200">
                      No packaging sessions have been recorded for this batch yet.
                    </div>
                  )}
                  {batch.packagingTeam && batch.packagingTeam.length > 0 && (
                    <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800">
                      <p className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3 flex items-center gap-2">
                        <User className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                        Packaging Team:
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {batch.packagingTeam.map((member, idx) => (
                          <Badge key={idx} className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 font-medium px-3 py-1">
                            {member}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  {batch.packagingTime && (
                    <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800">
                      <p className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1 flex items-center gap-2">
                        <Clock className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                        Packaging Time:
                      </p>
                      <p className="font-medium text-slate-900 dark:text-slate-100">{parseDate(batch.packagingTime).toLocaleString()}</p>
                    </div>
                  )}
                  {packagingOutputs.length > 0 && (
                    <div className="p-4 rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800">
                      <p className="text-sm font-semibold text-blue-700 dark:text-blue-300 mb-2 flex items-center gap-2">
                        <Package className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                        Packaging Sessions ({packagingOutputs.length}):
                      </p>
                      <div className="space-y-2">
                        {packagingOutputs.map((po: any) => (
                          <div key={po._id || po.id} className="text-sm text-blue-900 dark:text-blue-100">
                            {(po.flavourName || po.packedFlavourName || "Line")} · {po.packageNumber || "N/A"} ·{" "}
                            {po.packagingLine || "—"} — {po.packagedLitres || 0}L
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Storage: packaged bottles not yet distributed, per flavour */}
          <TabsContent value="storage" className="space-y-6">
            <Card className="border-teal-200 dark:border-teal-900/50 bg-gradient-to-br from-teal-50/50 to-cyan-50/30 dark:from-teal-950/20 dark:to-cyan-950/10 shadow-lg">
              <CardHeader className="bg-gradient-to-r from-teal-50 to-cyan-50 dark:from-teal-950/30 dark:to-cyan-950/20 border-b border-teal-200 dark:border-teal-900/50">
                <CardTitle className="text-lg font-bold text-card-foreground flex items-center gap-2">
                  <div className="p-2 rounded-lg bg-teal-100 dark:bg-teal-950/40 border border-teal-200 dark:border-teal-900/30">
                    <Warehouse className="h-5 w-5 text-teal-600 dark:text-teal-400" />
                  </div>
                  <div className="flex flex-col">
                    <span>Batch storage</span>
                    <span className="text-xs font-normal text-muted-foreground mt-0.5">
                      Packaged bottles still on hand (not yet on delivery notes for this batch)
                    </span>
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6 space-y-6">
                <div className="rounded-xl border-2 border-teal-200/80 bg-gradient-to-r from-teal-50 to-cyan-50 dark:from-teal-950/30 dark:to-cyan-950/20 dark:border-teal-900/50 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-teal-800 dark:text-teal-200">
                      Total in storage (this batch)
                    </p>
                    <p className="text-2xl font-bold text-teal-900 dark:text-teal-100 tabular-nums">
                      {totalStorageBottles.toLocaleString()} <span className="text-base font-semibold">bottles</span>
                    </p>
                  </div>
                  <p className="text-xs text-teal-800/80 dark:text-teal-200/80 max-w-md">
                    Per flavour: packaged units minus units shipped on distribution notes for batch{" "}
                    <span className="font-mono font-semibold">{batch.batchNumber}</span>.
                  </p>
                </div>

                {storageFlavourRows.some((r) => r.packagedBottles > 0) ? (
                  <div className="space-y-4">
                    <div className="rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-gradient-to-r from-slate-100 to-slate-50 dark:from-slate-800 dark:to-slate-900 border-b-2 border-slate-300 dark:border-slate-700">
                            <TableHead className="font-semibold text-xs uppercase tracking-wider py-3 px-4">Flavour</TableHead>
                            <TableHead className="font-semibold text-xs uppercase tracking-wider py-3 px-4 text-right">Packaged</TableHead>
                            <TableHead className="font-semibold text-xs uppercase tracking-wider py-3 px-4 text-right">Distributed</TableHead>
                            <TableHead className="font-semibold text-xs uppercase tracking-wider py-3 px-4 text-right">In storage</TableHead>
                            <TableHead className="font-semibold text-xs uppercase tracking-wider py-3 px-4">By bottle size</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {storageFlavourRows
                            .filter((r) => r.packagedBottles > 0)
                            .map((row, idx) => (
                              <TableRow
                                key={row.key}
                                className={cn(
                                  "border-b border-slate-200 dark:border-slate-800",
                                  idx % 2 === 0 ? "bg-white dark:bg-slate-900/50" : "bg-slate-50/80 dark:bg-slate-900/30"
                                )}
                              >
                                <TableCell className="py-3 px-4 font-semibold text-slate-900 dark:text-slate-100">
                                  {row.flavour}
                                </TableCell>
                                <TableCell className="py-3 px-4 text-right tabular-nums text-slate-700 dark:text-slate-300">
                                  {row.packagedBottles.toLocaleString()}
                                </TableCell>
                                <TableCell className="py-3 px-4 text-right tabular-nums text-slate-700 dark:text-slate-300">
                                  {row.distributedBottles.toLocaleString()}
                                </TableCell>
                                <TableCell className="py-3 px-4 text-right">
                                  <span
                                    className={cn(
                                      "inline-flex min-w-[3rem] justify-end font-bold tabular-nums",
                                      row.inStorageBottles <= 0
                                        ? "text-slate-500 dark:text-slate-400"
                                        : "text-teal-700 dark:text-teal-300"
                                    )}
                                  >
                                    {row.inStorageBottles.toLocaleString()}
                                  </span>
                                </TableCell>
                                <TableCell className="py-3 px-4">
                                  <div className="flex flex-wrap gap-1.5">
                                    {Object.keys(row.bySize).length > 0 ? (
                                      Object.entries(row.bySize).map(([size, qty]) => (
                                        <Badge
                                          key={`${row.key}-${size}`}
                                          variant="secondary"
                                          className="text-[11px] font-medium"
                                        >
                                          {size}: {Number(qty).toLocaleString()}
                                        </Badge>
                                      ))
                                    ) : (
                                      <span className="text-xs text-muted-foreground">—</span>
                                    )}
                                  </div>
                                </TableCell>
                              </TableRow>
                            ))}
                        </TableBody>
                      </Table>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      “By bottle size” appears when delivery note lines include sizes that match packaging. If a note has
                      quantities but no size, only the flavour totals (packaged / distributed / in storage) are reliable.
                    </p>
                  </div>
                ) : (
                  <div className="rounded-lg border border-teal-200 dark:border-teal-900/40 bg-teal-50/80 dark:bg-teal-950/20 p-6 text-center text-sm text-teal-900 dark:text-teal-100">
                    No packaging recorded for this batch yet — nothing in storage. After packaging sessions are
                    logged, remaining stock per flavour appears here until it is distributed.
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Raw Materials Tab */}
          <TabsContent value="materials" className="space-y-6">
            <Card className="border-red-200 dark:border-red-900/50 bg-gradient-to-br from-red-50/50 to-rose-50/30 dark:from-red-950/20 dark:to-rose-950/10 shadow-lg">
              <CardHeader className="bg-gradient-to-r from-red-50 to-rose-50 dark:from-red-950/30 dark:to-rose-950/20 border-b border-red-200 dark:border-red-900/50">
                <CardTitle className="text-lg font-bold text-card-foreground flex items-center gap-2">
                  <div className="p-2 rounded-lg bg-red-100 dark:bg-red-950/40 border border-red-200 dark:border-red-900/30">
                    <Factory className="h-5 w-5 text-red-600 dark:text-red-400" />
                  </div>
                  Raw Materials Used
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                <div className="rounded-lg border-2 border-slate-200 dark:border-slate-800 overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-gradient-to-r from-slate-100 to-slate-50 dark:from-slate-800 dark:to-slate-900 border-b-2 border-slate-300 dark:border-slate-700">
                        <TableHead className="font-semibold text-xs uppercase tracking-wider text-slate-900 dark:text-slate-100 py-3 px-4">Material</TableHead>
                        <TableHead className="font-semibold text-xs uppercase tracking-wider text-slate-700 dark:text-slate-300 py-3 px-4">Quantity</TableHead>
                        <TableHead className="font-semibold text-xs uppercase tracking-wider text-slate-700 dark:text-slate-300 py-3 px-4">Unit Cost</TableHead>
                        <TableHead className="font-semibold text-xs uppercase tracking-wider text-slate-700 dark:text-slate-300 py-3 px-4">Total Cost</TableHead>
                        <TableHead className="font-semibold text-xs uppercase tracking-wider text-slate-700 dark:text-slate-300 py-3 px-4">Lot Number</TableHead>
                        <TableHead className="font-semibold text-xs uppercase tracking-wider text-slate-700 dark:text-slate-300 py-3 px-4">Supplier</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(batch.ingredients || []).map((ing: any, idx: number) => (
                        <TableRow
                          key={idx}
                          className={cn(
                            "hover:bg-gradient-to-r hover:from-red-50/70 hover:to-rose-50/30 dark:hover:from-red-950/30 dark:hover:to-rose-950/10 transition-all border-b border-slate-200 dark:border-slate-800",
                            idx % 2 === 0 ? "bg-white dark:bg-slate-900/50" : "bg-slate-50/80 dark:bg-slate-900/30"
                          )}
                        >
                          <TableCell className="py-4 px-4 font-semibold text-slate-900 dark:text-slate-100">{ing.material}</TableCell>
                          <TableCell className="py-4 px-4 text-slate-700 dark:text-slate-300">{ing.quantity} {ing.unit || ''}</TableCell>
                          <TableCell className="py-4 px-4 text-slate-700 dark:text-slate-300">${(ing.unitCost || 0).toFixed(2)}</TableCell>
                          <TableCell className="py-4 px-4 font-semibold text-red-700 dark:text-red-400">${(ing.totalCost || 0).toFixed(2)}</TableCell>
                          <TableCell className="py-4 px-4 text-slate-600 dark:text-slate-400">{ing.lotNumber || "N/A"}</TableCell>
                          <TableCell className="py-4 px-4 text-slate-600 dark:text-slate-400">{ing.supplier || "N/A"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <div className="mt-6 p-5 rounded-lg bg-gradient-to-r from-red-100 to-rose-100 dark:from-red-900/40 dark:to-rose-900/40 border-2 border-red-200 dark:border-red-900/30">
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-lg text-red-900 dark:text-red-100 flex items-center gap-2">
                      <BarChart3 className="h-5 w-5 text-red-600 dark:text-red-400" />
                      Total Material Cost:
                    </span>
                    <span className="text-3xl font-bold text-red-600 dark:text-red-400">
                      ${totalMaterialCost.toFixed(2)}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Distribution Tab */}
          <TabsContent value="distribution" className="space-y-6">
            {deliveryNotes.length > 0 ? (
              <Card className="border-blue-200 dark:border-blue-900/50 bg-gradient-to-br from-blue-50/50 to-indigo-50/30 dark:from-blue-950/20 dark:to-indigo-950/10 shadow-lg">
                <CardHeader className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/20 border-b border-blue-200 dark:border-blue-900/50">
                  <CardTitle className="text-lg font-bold text-card-foreground flex items-center gap-2">
                    <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/30">
                      <Truck className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                    </div>
                    Distribution Records ({deliveryNotes.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-6">
                  {distributionFlavourRows.length > 0 && (
                    <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {distributionFlavourRows.map((row) => (
                        <div key={row.key} className="rounded-lg border border-blue-200/80 bg-white/80 px-3 py-2.5 dark:border-blue-900/40 dark:bg-slate-900/60">
                          <p className="text-xs text-muted-foreground">Flavour distributed</p>
                          <p className="text-sm font-bold text-slate-900 dark:text-slate-100">{row.flavour}</p>
                          <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                            {row.units.toLocaleString()} units across {row.notes} note{row.notes !== 1 ? "s" : ""}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="rounded-lg border-2 border-slate-200 dark:border-slate-800 overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-gradient-to-r from-slate-100 to-slate-50 dark:from-slate-800 dark:to-slate-900 border-b-2 border-slate-300 dark:border-slate-700">
                          <TableHead className="font-semibold text-xs uppercase tracking-wider text-slate-900 dark:text-slate-100 py-3 px-4">Note ID</TableHead>
                          <TableHead className="font-semibold text-xs uppercase tracking-wider text-slate-700 dark:text-slate-300 py-3 px-4">Distributor</TableHead>
                          <TableHead className="font-semibold text-xs uppercase tracking-wider text-slate-700 dark:text-slate-300 py-3 px-4">Date</TableHead>
                          <TableHead className="font-semibold text-xs uppercase tracking-wider text-slate-700 dark:text-slate-300 py-3 px-4">Items by flavour</TableHead>
                          <TableHead className="font-semibold text-xs uppercase tracking-wider text-slate-700 dark:text-slate-300 py-3 px-4">Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {deliveryNotes.map((note: any, idx: number) => (
                          <TableRow
                            key={note._id || note.id}
                            className={cn(
                              "hover:bg-gradient-to-r hover:from-blue-50/70 hover:to-indigo-50/30 dark:hover:from-blue-950/30 dark:hover:to-indigo-950/10 transition-all border-b border-slate-200 dark:border-slate-800",
                              idx % 2 === 0 ? "bg-white dark:bg-slate-900/50" : "bg-slate-50/80 dark:bg-slate-900/30"
                            )}
                          >
                            <TableCell className="py-4 px-4 font-semibold text-slate-900 dark:text-slate-100">{note.noteId || 'N/A'}</TableCell>
                            <TableCell className="py-4 px-4 font-medium text-slate-900 dark:text-slate-100">{note.distributorName || 'N/A'}</TableCell>
                            <TableCell className="py-4 px-4 text-slate-600 dark:text-slate-400">{parseDate(note.date || note.deliveryDate).toLocaleDateString()}</TableCell>
                            <TableCell className="py-4 px-4">
                              <div className="flex flex-col gap-1">
                                {(note.items || []).map((item: any, itemIdx: number) => (
                                  <Badge key={itemIdx} className="w-fit bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 text-xs">
                                    {(item.flavor || resolveFlavourLabel(item.flavourLineId)).toString()} · {item.quantity}×{item.size || item.containerSize}
                                  </Badge>
                                ))}
                              </div>
                            </TableCell>
                            <TableCell className="py-4 px-4">
                              <Badge className={cn(
                                "font-semibold text-xs px-2.5 py-1 border-2",
                                note.status === "Delivered" ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 border-green-200 dark:border-green-900/30" :
                                note.status === "In Transit" ? "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 border-blue-200 dark:border-blue-900/30" :
                                "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 border-amber-200 dark:border-amber-900/30"
                              )}>
                                {note.status || 'Pending'}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card className="border-amber-200 dark:border-amber-900/50 bg-gradient-to-br from-amber-50/50 to-orange-50/30 dark:from-amber-950/20 dark:to-orange-950/10 shadow-lg">
                <CardContent className="p-12 text-center">
                  <div className="flex flex-col items-center gap-4">
                    <div className="p-4 rounded-full bg-amber-100 dark:bg-amber-900/40 border-2 border-amber-200 dark:border-amber-900/30">
                      <Truck className="h-12 w-12 text-amber-600 dark:text-amber-400" />
                    </div>
                    <p className="text-lg font-semibold text-amber-900 dark:text-amber-100">No distribution records for this batch</p>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Documents Tab */}
          <TabsContent value="documents" className="space-y-6">
            <Card className="border-purple-200 dark:border-purple-900/50 bg-gradient-to-br from-purple-50/50 to-violet-50/30 dark:from-purple-950/20 dark:to-violet-950/10 shadow-lg">
              <CardHeader className="bg-gradient-to-r from-purple-50 to-violet-50 dark:from-purple-950/30 dark:to-violet-950/20 border-b border-purple-200 dark:border-purple-900/50">
                <CardTitle className="text-lg font-bold text-card-foreground flex items-center gap-2">
                  <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-900/30">
                    <FileText className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                  </div>
                  Batch Documents
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                {batch.documents && batch.documents.length > 0 ? (
                  <div className="space-y-3">
                    {batch.documents.map((doc, idx) => (
                      <div key={idx} className="flex items-center justify-between p-4 rounded-lg bg-gradient-to-r from-slate-50 to-white dark:from-slate-900 dark:to-slate-950 border-2 border-slate-200 dark:border-slate-800 hover:border-purple-300 dark:hover:border-purple-800 transition-all shadow-sm">
                        <div className="flex items-center gap-3">
                          <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-900/30">
                            <FileText className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                          </div>
                          <span className="font-semibold text-slate-900 dark:text-slate-100">{doc}</span>
                        </div>
                        <button className="px-4 py-2 rounded-lg bg-gradient-to-r from-purple-600 to-violet-700 hover:from-purple-700 hover:to-violet-800 text-white font-semibold shadow-lg shadow-purple-500/30 transition-all flex items-center gap-2">
                          <Download className="h-4 w-4" />
                          Download
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <div className="flex flex-col items-center gap-4">
                      <div className="p-4 rounded-full bg-slate-100 dark:bg-slate-900/40 border-2 border-slate-200 dark:border-slate-800">
                        <FileText className="h-12 w-12 text-slate-400 dark:text-slate-500" />
                      </div>
                      <p className="text-lg font-semibold text-slate-600 dark:text-slate-400">No documents available</p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </>
  )
}
