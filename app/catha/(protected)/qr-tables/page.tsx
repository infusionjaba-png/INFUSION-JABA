"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { Header } from "@/components/layout/header"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { QrCode, Plus, Download, Printer, Loader2, Trash2, Grid3X3 } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

interface TableData {
  id: number
  name?: string
  status?: string
  capacity?: number
}

export default function QRTablesPage() {
  const [tables, setTables] = useState<TableData[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [newTableName, setNewTableName] = useState("")
  const [newTableId, setNewTableId] = useState<number | "">("")
  const [isAdding, setIsAdding] = useState(false)
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || (typeof window !== "undefined" ? window.location.origin : "https://www.infusionjaba.co.ke")
  const printRef = useRef<HTMLDivElement>(null)

  const fetchTables = useCallback(async () => {
    try {
      const res = await fetch("/api/catha/tables")
      const data = await res.json()
      if (data.success && Array.isArray(data.tables)) {
        setTables(data.tables)
      } else {
        toast.error("Failed to load tables")
      }
    } catch (err) {
      console.error(err)
      toast.error("Failed to load tables")
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchTables()
  }, [fetchTables])

  const getMenuUrl = (tableId: number | string) => {
    return `${baseUrl}/menu?t=${encodeURIComponent(String(tableId))}`
  }

  const getQRImageUrl = (url: string, size = 300, absolute = false) => {
    // Brand-colored QR via our generator (Infusion Jaba logo green)
    const path = `/api/qr?size=${size}&url=${encodeURIComponent(url)}`
    if (!absolute) return path
    const origin =
      typeof window !== "undefined"
        ? window.location.origin
        : baseUrl.replace(/\/$/, "")
    return `${origin}${path}`
  }

  const handleAddTable = async () => {
    const name = newTableName.trim() || `Table ${newTableId || "?"}`
    const id = newTableId !== "" ? Number(newTableId) : (tables.length > 0 ? Math.max(...tables.map((t) => t.id)) + 1 : 1)

    if (tables.some((t) => t.id === id)) {
      toast.error(`Table ${id} already exists`)
      return
    }

    setIsAdding(true)
    try {
      const res = await fetch("/api/catha/tables", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, name }),
      })
      const data = await res.json()
      if (data.success) {
        toast.success(`Table ${name} added`)
        setIsAddOpen(false)
        setNewTableName("")
        setNewTableId("")
        fetchTables()
      } else {
        toast.error(data.error || "Failed to add table")
      }
    } catch (err) {
      toast.error("Failed to add table")
    } finally {
      setIsAdding(false)
    }
  }

  const handleDeleteTable = async (id: number) => {
    if (!confirm(`Delete table ${id}?`)) return
    try {
      const res = await fetch(`/api/catha/tables?id=${id}`, { method: "DELETE" })
      const data = await res.json()
      if (data.success) {
        toast.success("Table deleted")
        fetchTables()
      } else {
        toast.error("Failed to delete table")
      }
    } catch {
      toast.error("Failed to delete table")
    }
  }

  const downloadQR = async (table: TableData) => {
    const url = getMenuUrl(table.id)
    const qrUrl = getQRImageUrl(url, 400)
    try {
      const res = await fetch(qrUrl)
      const blob = await res.blob()
      const a = document.createElement("a")
      a.href = URL.createObjectURL(blob)
      a.download = `table-${table.id}-qr.png`
      a.click()
      URL.revokeObjectURL(a.href)
      toast.success(`Downloaded QR for ${table.name || `Table ${table.id}`}`)
    } catch {
      toast.error("Failed to download QR code")
    }
  }

  const printSingle = (table: TableData) => {
    const url = getMenuUrl(table.id)
    const qrUrl = getQRImageUrl(url, 256, true)
    const w = window.open("", "_blank")
    if (!w) {
      toast.error("Please allow popups to print")
      return
    }
    w.document.write(`
      <!DOCTYPE html>
      <html>
        <head><title>Table ${table.id} QR</title></head>
        <body style="margin:0;padding:24px;display:flex;flex-direction:column;align-items:center;font-family:sans-serif;">
          <h2 style="margin:0 0 12px;">${table.name || `Table ${table.id}`}</h2>
          <p style="margin:0 0 16px;color:#64748b;">Scan to order</p>
          <img src="${qrUrl}" alt="QR Code" width="256" height="256" />
          <p style="margin:16px 0 0;font-size:12px;color:#94a3b8;">Table ${table.id}</p>
        </body>
      </html>
    `)
    w.document.close()
    w.focus()
    setTimeout(() => {
      w.print()
      w.close()
    }, 250)
  }

  const printAll = () => {
    if (tables.length === 0) {
      toast.error("No tables to print")
      return
    }
    const rows = tables.map(
      (t) => `
      <div style="display:inline-block;margin:16px;text-align:center;page-break-inside:avoid;">
        <h3 style="margin:0 0 8px;">${t.name || `Table ${t.id}`}</h3>
        <p style="margin:0 0 12px;font-size:14px;color:#64748b;">Scan to order</p>
        <img src="${getQRImageUrl(getMenuUrl(t.id), 200, true)}" width="200" height="200" alt="QR" />
        <p style="margin:8px 0 0;font-size:12px;color:#94a3b8;">Table ${t.id}</p>
      </div>
    `
    )
    const w = window.open("", "_blank")
    if (!w) {
      toast.error("Please allow popups to print")
      return
    }
    w.document.write(`
      <!DOCTYPE html>
      <html>
        <head><title>Table QR Codes</title></head>
        <body style="margin:0;padding:24px;font-family:sans-serif;">
          <h1 style="margin:0 0 24px;">Table QR Codes</h1>
          <div style="display:flex;flex-wrap:wrap;justify-content:flex-start;">
            ${rows.join("")}
          </div>
        </body>
      </html>
    `)
    w.document.close()
    w.focus()
    setTimeout(() => {
      w.print()
      w.close()
    }, 500)
  }

  if (isLoading) {
    return (
      <div className="flex flex-col min-h-screen">
        <Header title="Table QR Codes" subtitle="Generate and print QR codes for tables" />
        <div className="flex-1 flex items-center justify-center p-4 sm:p-8 min-h-[50vh]">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col min-h-screen">
      <Header title="Table QR Codes" subtitle="Generate, download, and print QR codes for your tables" />

      <div className="flex-1 p-4 sm:p-6 pb-8 sm:pb-6 space-y-4 sm:space-y-6">
        <Card className="overflow-hidden">
          <CardHeader className="p-4 sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
                  <QrCode className="h-4 w-4 sm:h-5 sm:w-5 flex-shrink-0" />
                  Table QR Codes
                </CardTitle>
                <CardDescription className="mt-1 text-xs sm:text-sm">
                  Add tables, then download or print QR codes. Customers scan them to open the menu.
                </CardDescription>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-2">
                <Button
                  variant="outline"
                  onClick={() => setIsAddOpen(true)}
                  className="w-full sm:w-auto min-h-[44px] sm:min-h-0"
                >
                  <Plus className="h-4 w-4 sm:mr-2" />
                  <span className="sm:inline">Add Table</span>
                </Button>
                {tables.length > 0 && (
                  <Button
                    onClick={printAll}
                    className="w-full sm:w-auto min-h-[44px] sm:min-h-0"
                  >
                    <Printer className="h-4 w-4 sm:mr-2" />
                    <span className="sm:inline">Print All</span>
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-4 sm:p-6 pt-0 sm:pt-0">
            {tables.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 sm:py-16 border-2 border-dashed rounded-xl px-4">
                <Grid3X3 className="h-10 w-10 sm:h-12 sm:w-12 text-muted-foreground mb-3 sm:mb-4" />
                <p className="text-muted-foreground text-sm sm:text-base mb-1 sm:mb-2">No tables yet</p>
                <p className="text-xs sm:text-sm text-muted-foreground mb-4 text-center">Add tables to generate QR codes</p>
                <Button
                  onClick={() => setIsAddOpen(true)}
                  className="w-full sm:w-auto min-h-[44px]"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Table
                </Button>
              </div>
            ) : (
              <div
                ref={printRef}
                className="grid gap-4 sm:gap-6 grid-cols-1 min-[480px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
              >
                {tables.map((table) => {
                  const menuUrl = baseUrl ? getMenuUrl(table.id) : ""
                  const qrUrl = menuUrl ? getQRImageUrl(menuUrl, 200) : ""
                  const displayName = table.name || `Table ${table.id}`

                  return (
                    <Card key={table.id} className="overflow-hidden">
                      <CardContent className="p-4 sm:pt-6">
                        <div className="flex flex-col items-center text-center">
                          <div className="w-[140px] h-[140px] sm:w-[180px] sm:h-[180px] lg:w-[200px] lg:h-[200px] bg-white rounded-lg border flex items-center justify-center p-2 mb-3 sm:mb-4 flex-shrink-0">
                            {qrUrl ? (
                              <img
                                src={qrUrl}
                                alt={`QR for ${displayName}`}
                                className="w-full h-full object-contain"
                              />
                            ) : (
                              <Loader2 className="h-6 w-6 sm:h-8 sm:w-8 animate-spin text-muted-foreground" />
                            )}
                          </div>
                          <h3 className="font-semibold text-base sm:text-lg truncate w-full px-1">{displayName}</h3>
                          <p className="text-xs sm:text-sm text-muted-foreground mb-1">Table {table.id}</p>
                          <p className="text-[10px] sm:text-xs text-muted-foreground mb-3 sm:mb-4 truncate w-full max-w-full px-1" title={menuUrl}>
                            {menuUrl || "—"}
                          </p>
                          <div className="flex items-center gap-2 w-full justify-center flex-wrap">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => downloadQR(table)}
                              className="min-h-[40px] sm:min-h-0 flex-1 sm:flex-none min-w-0"
                            >
                              <Download className="h-3.5 w-3.5 sm:mr-1" />
                              <span className="hidden sm:inline">Download</span>
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => printSingle(table)}
                              className="min-h-[40px] sm:min-h-0 flex-1 sm:flex-none min-w-0"
                            >
                              <Printer className="h-3.5 w-3.5 sm:mr-1" />
                              <span className="hidden sm:inline">Print</span>
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-destructive hover:text-destructive min-h-[40px] sm:min-h-0 flex-shrink-0"
                              onClick={() => handleDeleteTable(table.id)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="w-[95vw] max-w-lg mx-auto max-h-[90vh] overflow-y-auto">
          <DialogHeader className="space-y-2">
            <DialogTitle className="text-lg sm:text-xl">Add Table</DialogTitle>
            <DialogDescription className="text-sm">
              Add a new table with a number or name. The QR code will link customers to the menu for this table.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="table-id">Table Number</Label>
              <Input
                id="table-id"
                type="number"
                min={1}
                placeholder={String((tables.length ? Math.max(...tables.map((t) => t.id)) : 0) + 1)}
                value={newTableId === "" ? "" : newTableId}
                onChange={(e) => setNewTableId(e.target.value === "" ? "" : parseInt(e.target.value, 10) || "")}
                className="min-h-[44px]"
              />
              <p className="text-xs text-muted-foreground">Optional. Auto-assigns next number if left empty.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="table-name">Table Name (optional)</Label>
              <Input
                id="table-name"
                placeholder="e.g. VIP Booth, Patio 1"
                value={newTableName}
                onChange={(e) => setNewTableName(e.target.value)}
                className="min-h-[44px]"
              />
              <p className="text-xs text-muted-foreground">Defaults to &quot;Table N&quot; if empty.</p>
            </div>
          </div>
          <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              variant="outline"
              onClick={() => setIsAddOpen(false)}
              className="w-full sm:w-auto min-h-[44px]"
            >
              Cancel
            </Button>
            <Button
              onClick={handleAddTable}
              disabled={isAdding}
              className="w-full sm:w-auto min-h-[44px]"
            >
              {isAdding ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Add Table
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
