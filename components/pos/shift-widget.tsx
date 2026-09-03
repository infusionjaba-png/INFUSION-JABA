"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Clock3 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { toast } from "sonner"
import { useRouter } from "next/navigation"

type Shift = {
  _id: string
  status: string
  startedAt: string
  scheduledEndAt?: string
  endedAt?: string
  cashSales: number
  mpesaSales: number
  totalRevenue: number
  ordersServed: number
}

type CloseAtStrategy = "expected" | "now" | "manual"
type ShiftTiming = {
  isDelayed: boolean
  overdueByMs: number
  delayedByMs: number
  overdueByHuman: string
  delayedByHuman: string
  expectedCloseAt: string
  now: string
}

type ContinuePromptShift = {
  _id: string
  startedAt: string
  endedAt?: string
  status: string
}

type ShiftReminderSettings = {
  noShiftReminderMinutes: number
  noShiftHardAlertMinutes: number
}

export function ShiftWidget({ cashierName }: { cashierName: string }) {
  const router = useRouter()
  const [shift, setShift] = useState<Shift | null>(null)
  const [shiftTiming, setShiftTiming] = useState<ShiftTiming | null>(null)
  const [loading, setLoading] = useState(true)
  const [showClockInDialog, setShowClockInDialog] = useState(false)
  const [showCloseDialog, setShowCloseDialog] = useState(false)
  const [showDelayedCloseDialog, setShowDelayedCloseDialog] = useState(false)
  const [showClosingReminder, setShowClosingReminder] = useState(false)
  const [openingFloat, setOpeningFloat] = useState("")
  const [countedDrawerAmount, setCountedDrawerAmount] = useState("")
  const [notes, setNotes] = useState("")
  const [breakBusy, setBreakBusy] = useState(false)
  const [clockInBusy, setClockInBusy] = useState(false)
  const [closeBusy, setCloseBusy] = useState(false)
  const [delayedCloseStrategy, setDelayedCloseStrategy] = useState<CloseAtStrategy>("expected")
  const [manualDelayedCloseAt, setManualDelayedCloseAt] = useState("")
  const [continueBusy, setContinueBusy] = useState(false)
  const [issueText, setIssueText] = useState("")
  const [showIssueDialog, setShowIssueDialog] = useState(false)
  const [showPendingDialog, setShowPendingDialog] = useState(false)
  const [showContinueDialog, setShowContinueDialog] = useState(false)
  const [continuePromptShift, setContinuePromptShift] = useState<ContinuePromptShift | null>(null)
  const [dismissedContinuePromptId, setDismissedContinuePromptId] = useState<string>("")
  const [reminderSnoozeUntil, setReminderSnoozeUntil] = useState<number>(0)
  const [noShiftSinceMs, setNoShiftSinceMs] = useState<number | null>(null)
  const [nextShiftReminderAtMs, setNextShiftReminderAtMs] = useState<number | null>(null)
  const [lastOverdueAlertAtMs, setLastOverdueAlertAtMs] = useState<number>(0)
  const [reminderSettings, setReminderSettings] = useState<ShiftReminderSettings>({
    noShiftReminderMinutes: 10,
    noShiftHardAlertMinutes: 20,
  })

  const refresh = useCallback(async () => {
    const response = await fetch("/api/catha/shifts/active", { cache: "no-store" })
    const data = await response.json()
    setShift(data.shift ?? null)
    setShiftTiming(data.timing ?? null)
    if (data?.autoClosedShift?._id) {
      toast.warning("Shift auto-closed", {
        description: "Your shift was auto-closed after passing scheduled clock-out by 2 hours.",
      })
    }
    const prompt = (data?.continuePromptShift ?? null) as ContinuePromptShift | null
    setContinuePromptShift(prompt)
    if (
      !data.shift &&
      prompt?._id &&
      prompt._id !== dismissedContinuePromptId
    ) {
      setShowContinueDialog(true)
    }
    if (data?.shift?.status === "PENDING_CLOSURE") {
      const started = new Date(data.shift.startedAt)
      const today = new Date()
      const yesterdayPending = started.toDateString() !== today.toDateString()
      if (yesterdayPending) setShowPendingDialog(true)
    }
    setLoading(false)
  }, [dismissedContinuePromptId])

  const queuePending = useCallback((entry: { endpoint: string; body: Record<string, unknown> }) => {
    const raw = localStorage.getItem("catha_shift_pending_queue")
    const list = raw ? (JSON.parse(raw) as Array<{ endpoint: string; body: Record<string, unknown> }>) : []
    list.push(entry)
    localStorage.setItem("catha_shift_pending_queue", JSON.stringify(list))
  }, [])

  const flushPending = useCallback(async () => {
    const raw = localStorage.getItem("catha_shift_pending_queue")
    if (!raw) return
    const list = JSON.parse(raw) as Array<{ endpoint: string; body: Record<string, unknown> }>
    const remaining: typeof list = []
    for (const item of list) {
      try {
        const res = await fetch(item.endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(item.body),
        })
        if (!res.ok) remaining.push(item)
      } catch {
        remaining.push(item)
      }
    }
    if (remaining.length) localStorage.setItem("catha_shift_pending_queue", JSON.stringify(remaining))
    else localStorage.removeItem("catha_shift_pending_queue")
  }, [])

  useEffect(() => {
    refresh().catch(() => setLoading(false))
  }, [refresh])

  useEffect(() => {
    const interval = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return
      refresh().catch(() => {})
    }, 60_000)
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh().catch(() => {})
    }
    window.addEventListener("focus", onVisible)
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      clearInterval(interval)
      window.removeEventListener("focus", onVisible)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [refresh])

  useEffect(() => {
    flushPending().catch(() => {})
    const onOnline = () => flushPending().catch(() => {})
    window.addEventListener("online", onOnline)
    return () => window.removeEventListener("online", onOnline)
  }, [flushPending])

  useEffect(() => {
    const loadReminderSettings = async () => {
      try {
        const response = await fetch("/api/catha/shift-settings", { cache: "no-store" })
        const data = await response.json()
        if (!response.ok || !data?.settings) return
        const reminderMin = Number(data.settings.noShiftReminderMinutes)
        const hardAlertMin = Number(data.settings.noShiftHardAlertMinutes)
        if (!Number.isFinite(reminderMin) || !Number.isFinite(hardAlertMin)) return
        setReminderSettings({
          noShiftReminderMinutes: Math.max(1, Math.round(reminderMin)),
          noShiftHardAlertMinutes: Math.max(Math.round(reminderMin) + 1, Math.round(hardAlertMin)),
        })
      } catch {
        // Keep default reminder settings if loading fails.
      }
    }
    loadReminderSettings().catch(() => {})
  }, [])

  useEffect(() => {
    if (loading) return
    if (shift) {
      setNoShiftSinceMs(null)
      setNextShiftReminderAtMs(null)
      setLastOverdueAlertAtMs(0)
      return
    }

    const reminderDelayMs = reminderSettings.noShiftReminderMinutes * 60 * 1000
    const hardAlertDelayMs = reminderSettings.noShiftHardAlertMinutes * 60 * 1000
    const now = Date.now()
    if (noShiftSinceMs === null) {
      setNoShiftSinceMs(now)
      setShowClockInDialog(true)
      setNextShiftReminderAtMs(now + reminderDelayMs)
      return
    }

    const interval = setInterval(() => {
      const tickNow = Date.now()
      const elapsed = tickNow - noShiftSinceMs
      const pastHardAlertLimit = elapsed >= hardAlertDelayMs

      if (pastHardAlertLimit && !showClockInDialog) {
        setShowClockInDialog(true)
      }

      if (!pastHardAlertLimit && nextShiftReminderAtMs && tickNow >= nextShiftReminderAtMs) {
        setShowClockInDialog(true)
        toast.message("Shift reminder", { description: "Start your shift to continue working." })
        setNextShiftReminderAtMs(tickNow + reminderDelayMs)
      }

      if (pastHardAlertLimit && tickNow - lastOverdueAlertAtMs >= 2 * 60 * 1000) {
        toast.error("Shift required", {
          description: `You have been logged in for over ${reminderSettings.noShiftHardAlertMinutes} minutes without starting a shift.`,
        })
        setLastOverdueAlertAtMs(tickNow)
      }
    }, 60_000)

    return () => clearInterval(interval)
  }, [
    loading,
    shift,
    noShiftSinceMs,
    nextShiftReminderAtMs,
    lastOverdueAlertAtMs,
    showClockInDialog,
    reminderSettings.noShiftReminderMinutes,
    reminderSettings.noShiftHardAlertMinutes,
  ])

  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date()
      if (Date.now() < reminderSnoozeUntil) return
      if (now.getHours() === 23 && now.getMinutes() === 0) setShowClosingReminder(true)
    }, 60_000)
    return () => clearInterval(timer)
  }, [reminderSnoozeUntil])

  const onClockIn = async () => {
    if (clockInBusy) return
    setClockInBusy(true)
    try {
      const response = await fetch("/api/catha/shifts/clock-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          openingFloat: Number(openingFloat || 0),
          notes,
        }),
      })
      const data = await response.json()
      if (!response.ok) {
        queuePending({ endpoint: "/api/catha/shifts/clock-in", body: { openingFloat: Number(openingFloat || 0), notes } })
        toast.error(data.error || "Failed to start shift")
        return
      }
      setShift(data.shift)
      setContinuePromptShift(null)
      setShowContinueDialog(false)
      setShowClockInDialog(false)
      toast.success("Shift started")
    } finally {
      setClockInBusy(false)
    }
  }

  const onContinueShift = async () => {
    if (!continuePromptShift?._id) return
    if (continueBusy) return
    setContinueBusy(true)
    try {
      const response = await fetch("/api/catha/shifts/continue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shiftId: continuePromptShift._id }),
      })
      const data = await response.json()
      if (!response.ok) {
        toast.error(data.error || "Failed to continue previous shift")
        return
      }
      setShift(data.shift)
      setShowContinueDialog(false)
      setContinuePromptShift(null)
      setDismissedContinuePromptId("")
      toast.success("Previous shift resumed")
    } finally {
      setContinueBusy(false)
    }
  }

  const onStartNewShiftFromPrompt = () => {
    if (continuePromptShift?._id) {
      setDismissedContinuePromptId(continuePromptShift._id)
    }
    setShowContinueDialog(false)
    setShowClockInDialog(true)
  }

  const onCloseShift = async () => {
    if (closeBusy) return
    if (shiftTiming?.isDelayed) {
      setShowDelayedCloseDialog(true)
      return
    }
    await submitCloseShift("now")
  }

  const submitCloseShift = async (closeAtStrategy: CloseAtStrategy) => {
    if (closeBusy) return
    setCloseBusy(true)
    try {
      const payload: Record<string, unknown> = {
        countedDrawerAmount: Number(countedDrawerAmount || 0),
        notes,
        closeAtStrategy,
      }
      if (closeAtStrategy === "manual") {
        if (!manualDelayedCloseAt) {
          toast.error("Please set a custom closing time")
          return
        }
        payload.manualClosedAt = new Date(manualDelayedCloseAt).toISOString()
      }
      const response = await fetch("/api/catha/shifts/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const data = await response.json()
      if (!response.ok) {
        queuePending({ endpoint: "/api/catha/shifts/close", body: payload })
        toast.error(data.error || "Failed to close shift")
        return
      }
      setShift(null)
      setShowCloseDialog(false)
      setShowDelayedCloseDialog(false)
      setCountedDrawerAmount("")
      setNotes("")
      setManualDelayedCloseAt("")
      setDelayedCloseStrategy("expected")
      toast.success("Shift closed")
    } finally {
      setCloseBusy(false)
    }
  }

  const onBreakStart = async (breakType: "TEA" | "LUNCH" | "EMERGENCY") => {
    setBreakBusy(true)
    try {
      const response = await fetch("/api/catha/shifts/break/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ breakType }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Failed to start break")
      toast.success(`${breakType} break started`)
    } catch (error: any) {
      toast.error(error?.message || "Failed to start break")
    } finally {
      setBreakBusy(false)
    }
  }

  const onBreakEnd = async () => {
    setBreakBusy(true)
    try {
      const response = await fetch("/api/catha/shifts/break/end", { method: "POST" })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Failed to resume shift")
      toast.success("Shift resumed from break")
      refresh().catch(() => {})
    } catch (error: any) {
      toast.error(error?.message || "Failed to resume shift")
    } finally {
      setBreakBusy(false)
    }
  }

  const onSaveDraft = () => {
    localStorage.setItem(
      "catha_shift_close_draft",
      JSON.stringify({ countedDrawerAmount: Number(countedDrawerAmount || 0), notes, at: new Date().toISOString() })
    )
    toast.success("Shift close draft saved")
  }

  const onReportIssue = async () => {
    const response = await fetch("/api/catha/shifts/report-issue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ issue: issueText }),
    })
    const data = await response.json()
    if (!response.ok) {
      toast.error(data.error || "Failed to report issue")
      return
    }
    setIssueText("")
    setShowIssueDialog(false)
    toast.success("Issue reported")
  }

  const onClosePreviousShift = async () => {
    if (!shift?._id) return
    const response = await fetch("/api/catha/shifts/pending/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shiftId: shift._id, countedDrawerAmount: 0, notes: "Resolved from next login prompt" }),
    })
    const data = await response.json()
    if (!response.ok) {
      toast.error(data.error || "Failed to close previous shift")
      return
    }
    setShowPendingDialog(false)
    setShift(null)
    toast.success("Previous shift closed")
  }

  const badge = useMemo(() => {
    if (!shift) return "bg-slate-100 text-slate-700"
    if (shift.status === "ACTIVE") return "bg-emerald-100 text-emerald-700"
    if (shift.status === "PENDING_CLOSURE") return "bg-amber-100 text-amber-700"
    return "bg-slate-100 text-slate-700"
  }, [shift])

  const delayedCloseInfo = useMemo(() => {
    if (!shiftTiming?.isDelayed) return null
    const expectedLabel = new Date(shiftTiming.expectedCloseAt).toLocaleString()
    const totalHoursLate = Math.floor(shiftTiming.overdueByMs / (60 * 60 * 1000))
    const crossesBusinessDayBoundary =
      new Date(shiftTiming.now).toDateString() !== new Date(shiftTiming.expectedCloseAt).toDateString()
    return {
      expectedLabel,
      delayedByLabel: shiftTiming.delayedByHuman,
      totalHoursLate,
      crossesBusinessDayBoundary,
    }
  }, [shiftTiming])

  return (
    <>
      <button
        type="button"
        onClick={() => (shift ? setShowCloseDialog(true) : setShowClockInDialog(true))}
        className={`min-h-[44px] rounded-xl border px-3 py-2 text-left text-xs shadow-sm transition-colors hover:bg-muted/50 ${badge}`}
      >
        <div className="flex items-center gap-2">
          <Clock3 className="h-4 w-4" />
          <span className="font-semibold">{shift ? `Shift ${shift.status}` : "Start Shift"}</span>
        </div>
        <div className="mt-1">{cashierName}</div>
        {shift ? (
          <div className="mt-1 text-[11px]">
            Sales KES {Math.round(shift.totalRevenue).toLocaleString()} | Orders {shift.ordersServed}
          </div>
        ) : null}
        {shift && delayedCloseInfo ? (
          <div className="mt-1 text-[11px] text-amber-700">
            ⏱ Shift overdue by {delayedCloseInfo.delayedByLabel}
          </div>
        ) : null}
      </button>
      {shift && (
        <div className="ml-1 hidden items-center gap-1 md:flex">
          <Button variant="outline" size="sm" className="h-8 text-xs" disabled={breakBusy} onClick={() => onBreakStart("TEA")}>
            Tea Break
          </Button>
          <Button variant="outline" size="sm" className="h-8 text-xs" disabled={breakBusy} onClick={onBreakEnd}>
            Resume
          </Button>
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setShowIssueDialog(true)}>
            Report Issue
          </Button>
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => router.push("/catha/shift-history")}>
            View Shift Summary
          </Button>
        </div>
      )}

      <Dialog
        open={showClockInDialog}
        onOpenChange={(open) => {
          setShowClockInDialog(open)
          if (!open && !shift) {
            // Snooze manual dismissal based on configured reminder interval.
            setNextShiftReminderAtMs(Date.now() + reminderSettings.noShiftReminderMinutes * 60 * 1000)
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader className="space-y-2">
            <DialogTitle className="text-xl font-semibold tracking-tight">Start shift</DialogTitle>
            <DialogDescription className="text-sm">
              Clock in now and optionally record your opening float.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-2 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="opening-float">Opening Float (optional)</Label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  KES
                </span>
                <Input
                  id="opening-float"
                  type="number"
                  min="0"
                  inputMode="decimal"
                  value={openingFloat}
                  onChange={(e) => setOpeningFloat(e.target.value)}
                  placeholder="0"
                  className="h-11 pl-12"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="clock-in-notes">Notes (optional)</Label>
              <Input
                id="clock-in-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. Busy night"
                className="h-11"
              />
            </div>
            <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
              <Button variant="outline" onClick={() => setShowClockInDialog(false)} disabled={clockInBusy}>
                Cancel
              </Button>
              <Button className="sm:min-w-[132px]" onClick={onClockIn} disabled={clockInBusy}>
                {clockInBusy ? "Clocking In..." : "Clock In Now"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showCloseDialog} onOpenChange={setShowCloseDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>End Shift Summary</DialogTitle>
            <DialogDescription>Review and confirm shift close.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">
              Cash {shift?.cashSales?.toLocaleString() ?? 0} | M-Pesa {shift?.mpesaSales?.toLocaleString() ?? 0}
            </div>
            <div>
              <Label>Counted Drawer Amount</Label>
              <Input value={countedDrawerAmount} onChange={(e) => setCountedDrawerAmount(e.target.value)} placeholder="0" />
            </div>
            <div>
              <Label>Notes</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Shift note" />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowCloseDialog(false)} disabled={closeBusy}>Cancel</Button>
              <Button variant="outline" onClick={onSaveDraft} disabled={closeBusy}>Save Draft</Button>
              <Button onClick={onCloseShift} disabled={closeBusy}>
                {closeBusy ? "Closing..." : "Confirm Close Shift"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showClosingReminder} onOpenChange={setShowClosingReminder}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Business Closing Time Reached</DialogTitle>
            <DialogDescription>Would you like to close your shift?</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowClosingReminder(false)}>Cancel</Button>
            <Button variant="outline" onClick={() => { setReminderSnoozeUntil(Date.now() + 30 * 60 * 1000); setShowClosingReminder(false) }}>Extend Shift 30 mins</Button>
            <Button variant="outline" onClick={() => { setReminderSnoozeUntil(Date.now() + 10 * 60 * 1000); setShowClosingReminder(false) }}>Remind Later</Button>
            <Button onClick={() => { setShowClosingReminder(false); setShowCloseDialog(true) }}>Close Shift Now</Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={showDelayedCloseDialog} onOpenChange={setShowDelayedCloseDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delayed Shift Closure Detected</DialogTitle>
            <DialogDescription>
              This shift was supposed to close at {delayedCloseInfo?.expectedLabel || "the expected time"} and is being closed{" "}
              {delayedCloseInfo ? `${delayedCloseInfo.totalHoursLate}h later` : "late"}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">To keep reports accurate, choose how to proceed:</p>
            <div className="space-y-2 rounded-md border p-3">
              <label className="flex cursor-pointer items-start gap-2 text-sm">
                <input
                  type="radio"
                  checked={delayedCloseStrategy === "expected"}
                  onChange={() => setDelayedCloseStrategy("expected")}
                />
                <span>Close at correct time (Recommended)</span>
              </label>
              <label className="flex cursor-pointer items-start gap-2 text-sm">
                <input type="radio" checked={delayedCloseStrategy === "now"} onChange={() => setDelayedCloseStrategy("now")} />
                <span>Close with current time</span>
              </label>
              {delayedCloseStrategy === "now" && delayedCloseInfo?.crossesBusinessDayBoundary ? (
                <p className="text-xs text-amber-700">
                  ⚠️ This will move part of yesterday&apos;s shift into today&apos;s reports.
                </p>
              ) : null}
              <label className="flex cursor-pointer items-start gap-2 text-sm">
                <input
                  type="radio"
                  checked={delayedCloseStrategy === "manual"}
                  onChange={() => setDelayedCloseStrategy("manual")}
                />
                <span>Adjust manually</span>
              </label>
              {delayedCloseStrategy === "manual" ? (
                <div className="pt-1">
                  <Label htmlFor="manual-close-at">Custom closing time</Label>
                  <Input
                    id="manual-close-at"
                    type="datetime-local"
                    value={manualDelayedCloseAt}
                    onChange={(e) => setManualDelayedCloseAt(e.target.value)}
                  />
                </div>
              ) : null}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowDelayedCloseDialog(false)} disabled={closeBusy}>
                Cancel
              </Button>
              <Button onClick={() => submitCloseShift(delayedCloseStrategy)} disabled={closeBusy}>
                {closeBusy ? "Closing..." : "Continue"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={showIssueDialog} onOpenChange={setShowIssueDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Report Shift Issue</DialogTitle>
            <DialogDescription>Describe any POS, cash, or handover issue.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input value={issueText} onChange={(e) => setIssueText(e.target.value)} placeholder="POS issue..." />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowIssueDialog(false)}>Cancel</Button>
              <Button onClick={onReportIssue}>Submit</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={showPendingDialog} onOpenChange={setShowPendingDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>You had an open shift yesterday</DialogTitle>
            <DialogDescription>Choose how you want to proceed.</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowPendingDialog(false)}>Resume Shift</Button>
            <Button variant="outline" onClick={() => setShowIssueDialog(true)}>Ask Manager</Button>
            <Button onClick={onClosePreviousShift}>Close Previous Shift</Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={showContinueDialog} onOpenChange={setShowContinueDialog}>
        <DialogContent className="sm:max-w-lg rounded-2xl border border-emerald-100 bg-gradient-to-br from-white to-emerald-50">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold">Previous shift was auto-closed</DialogTitle>
            <DialogDescription>
              Your previous shift was automatically closed because clock-out time was exceeded.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onStartNewShiftFromPrompt} disabled={continueBusy}>Start New Shift</Button>
            <Button onClick={onContinueShift} disabled={continueBusy}>
              {continueBusy ? "Continuing..." : "Continue Previous Shift"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
