"use client"

import React, { useCallback, useEffect, useRef, useState } from "react"
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  Bell,
  BellRing,
  Clock,
  CircleHelp,
  GlassWater,
  Hand,
  Receipt,
} from "lucide-react"
import { AnimatePresence, motion } from "framer-motion"
import { cn } from "@/lib/utils"
import {
  WAITER_CALL_REASONS,
  WAITER_CALL_SHEET_AUTO_DISMISS_MS,
  type WaiterCallReasonId,
  claimWaiterAckNotification,
  clearPendingWaiterCall,
  formatCallTime,
  playWaiterAckBeep,
  reasonMeta,
  savePendingWaiterCall,
  startCooldown,
  tableDisplay,
} from "@/lib/waiter-call"
import { toast } from "sonner"
import styles from "./call-waiter-sheet.module.css"

const REASON_ICONS: Record<
  WaiterCallReasonId,
  React.ComponentType<{ className?: string; strokeWidth?: number }>
> = {
  bill: Receipt,
  drinks: GlassWater,
  issue: CircleHelp,
  other: Hand,
}

export interface CallWaiterSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  tableNumber: string
  customerPhone?: string | null
  orderId?: string | null
  /** Fired after a successful call (cooldown should start) */
  onCalled?: (payload: {
    callId: string
    reason: WaiterCallReasonId
    createdAt: number
  }) => void
}

export function CallWaiterSheet({
  open,
  onOpenChange,
  tableNumber,
  customerPhone,
  orderId,
  onCalled,
}: CallWaiterSheetProps) {
  const [reason, setReason] = useState<WaiterCallReasonId>("bill")
  const [phase, setPhase] = useState<"pick" | "confirmed">("pick")
  const [submitting, setSubmitting] = useState(false)
  const [callId, setCallId] = useState<string | null>(null)
  const [calledAt, setCalledAt] = useState<number | null>(null)
  const [confirmedReason, setConfirmedReason] = useState<WaiterCallReasonId>("bill")
  const [staffOnWay, setStaffOnWay] = useState(false)
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const tableLabel = tableDisplay(tableNumber)
  const confirmed = reasonMeta(confirmedReason)

  const clearTimers = useCallback(() => {
    if (dismissTimer.current) {
      clearTimeout(dismissTimer.current)
      dismissTimer.current = null
    }
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  const reset = useCallback(() => {
    clearTimers()
    setReason("bill")
    setPhase("pick")
    setSubmitting(false)
    setCallId(null)
    setCalledAt(null)
    setConfirmedReason("bill")
    setStaffOnWay(false)
  }, [clearTimers])

  useEffect(() => {
    if (open) {
      setReason("bill")
      setPhase("pick")
      setSubmitting(false)
      setCallId(null)
      setCalledAt(null)
      setConfirmedReason("bill")
      setStaffOnWay(false)
    } else {
      clearTimers()
    }
  }, [open, clearTimers])

  useEffect(() => () => clearTimers(), [clearTimers])

  // Poll for staff "On it" while confirmed sheet is open
  useEffect(() => {
    if (phase !== "confirmed" || !callId || !open) return

    const poll = async () => {
      try {
        const res = await fetch(`/api/waiter-calls?callId=${encodeURIComponent(callId)}`, {
          cache: "no-store",
        })
        if (!res.ok) return
        const data = await res.json()
        if (data?.status === "acknowledged") {
          setStaffOnWay(true)
          if (pollRef.current) {
            clearInterval(pollRef.current)
            pollRef.current = null
          }
          if (dismissTimer.current) {
            clearTimeout(dismissTimer.current)
            dismissTimer.current = null
          }
          const meta = reasonMeta(confirmedReason)
          const label = data.reasonLabel || meta.label
          if (claimWaiterAckNotification(callId)) {
            playWaiterAckBeep()
            toast.success("Waiter confirmed", {
              description: `${label} · on the way`,
              duration: 6000,
            })
          }
          dismissTimer.current = setTimeout(() => {
            onOpenChange(false)
          }, 2200)
        } else if (data?.status === "cancelled") {
          clearPendingWaiterCall()
          onOpenChange(false)
        }
      } catch {}
    }

    poll()
    pollRef.current = setInterval(poll, 2000)
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [phase, callId, open, onOpenChange, confirmedReason, calledAt, tableNumber])

  const scheduleAutoDismiss = useCallback(() => {
    if (dismissTimer.current) clearTimeout(dismissTimer.current)
    dismissTimer.current = setTimeout(() => {
      onOpenChange(false)
    }, WAITER_CALL_SHEET_AUTO_DISMISS_MS)
  }, [onOpenChange])

  const handleCall = async () => {
    if (submitting || !tableNumber) return
    setSubmitting(true)
    const meta = reasonMeta(reason)
    const createdAt = Date.now()

    try {
      const res = await fetch("/api/waiter-calls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tableNumber,
          tableId: tableNumber,
          reason,
          reasonLabel: meta.label,
          confirmedLabel: meta.confirmedLabel,
          customerPhone: customerPhone ?? null,
          orderId: orderId ?? null,
        }),
      })

      if (!res.ok) {
        setSubmitting(false)
        return
      }

      const data = await res.json()
      const id = String(data.callId ?? data.id ?? "")
      setCallId(id)
      setCalledAt(typeof data.createdAt === "number" ? data.createdAt : createdAt)
      setConfirmedReason(reason)
      setPhase("confirmed")
      startCooldown(tableNumber)
      savePendingWaiterCall({
        callId: id,
        tableKey: tableNumber,
        reason,
        reasonLabel: meta.label,
        confirmedLabel: meta.confirmedLabel,
        createdAt: typeof data.createdAt === "number" ? data.createdAt : createdAt,
      })
      onCalled?.({
        callId: id,
        reason,
        createdAt: typeof data.createdAt === "number" ? data.createdAt : createdAt,
      })
      scheduleAutoDismiss()
    } catch {
      // keep picker open on failure
    } finally {
      setSubmitting(false)
    }
  }

  const handleCancelCall = async () => {
    clearTimers()
    clearPendingWaiterCall()
    if (callId) {
      try {
        await fetch("/api/waiter-calls", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ callId, status: "cancelled" }),
        })
      } catch {}
    }
    onOpenChange(false)
    // Keep cooldown — cancel notifies staff but still prevents spam
  }

  const handleCancelPicker = () => {
    onOpenChange(false)
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) reset()
        onOpenChange(next)
      }}
    >
      <SheetContent
        side="bottom"
        showClose={false}
        className={styles.sheetShell}
        overlayClassName="bg-[rgba(10,8,6,0.65)] backdrop-blur-[6px]"
        aria-describedby={undefined}
      >
        <div className={styles.panel}>
          <div className={styles.handle} aria-hidden>
            <div className={styles.handleBar} />
          </div>

          <div className={styles.body}>
            <AnimatePresence mode="wait" initial={false}>
              {phase === "pick" ? (
                <motion.div
                  key="pick"
                  className={styles.state}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.25 }}
                >
                  <SheetTitle className={styles.title}>Call a waiter</SheetTitle>
                  <p className={styles.subtitle}>
                    They&apos;ll come to Table {tableLabel}
                  </p>

                  <div className={styles.reasonGrid} role="radiogroup" aria-label="Reason">
                    {WAITER_CALL_REASONS.map((r) => {
                      const Icon = REASON_ICONS[r.id]
                      const selectedCard = reason === r.id
                      return (
                        <button
                          key={r.id}
                          type="button"
                          role="radio"
                          aria-checked={selectedCard}
                          className={cn(
                            styles.reasonCard,
                            selectedCard && styles.reasonSelected
                          )}
                          onClick={() => setReason(r.id)}
                        >
                          <Icon className={styles.reasonIcon} strokeWidth={2.25} />
                          <span className={styles.reasonLabel}>{r.label}</span>
                        </button>
                      )
                    })}
                  </div>

                  <button
                    type="button"
                    className={styles.cta}
                    onClick={handleCall}
                    disabled={submitting}
                  >
                    <Bell className={styles.ctaIcon} strokeWidth={2.25} />
                    {submitting ? "Calling…" : "Call waiter"}
                  </button>

                  <button
                    type="button"
                    className={styles.ghost}
                    onClick={handleCancelPicker}
                  >
                    Cancel
                  </button>
                </motion.div>
              ) : (
                <motion.div
                  key="confirmed"
                  className={cn(styles.state, styles.confirmWrap)}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.25 }}
                >
                  <div className={styles.bellGlow} aria-hidden>
                    <div className={styles.bellCircle}>
                      <BellRing className={styles.bellIcon} strokeWidth={2} />
                    </div>
                  </div>

                  <SheetTitle className={styles.title}>Waiter on the way</SheetTitle>
                  <div className={styles.metaBlock}>
                    <p className={styles.metaLine}>
                      {confirmed.confirmedLabel} · Table {tableLabel}
                    </p>
                    <p className={styles.metaLine}>
                      Called {formatCallTime(calledAt ?? Date.now())}
                    </p>
                  </div>

                  <div
                    className={cn(styles.chip, staffOnWay && styles.chipOnWay)}
                  >
                    <Clock className={styles.chipIcon} strokeWidth={2.25} />
                    {staffOnWay ? "On the way" : "Usually under 2 minutes"}
                  </div>

                  <button
                    type="button"
                    className={styles.ghost}
                    onClick={handleCancelCall}
                  >
                    Cancel call
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
