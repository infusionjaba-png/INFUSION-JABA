"use client"

import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import {
  WAITER_CALL_PENDING_EVENT,
  claimWaiterAckNotification,
  clearPendingWaiterCall,
  getPendingWaiterCall,
  playWaiterAckBeep,
  reasonMeta,
  type PendingWaiterCall,
} from "@/lib/waiter-call"
import { useAdaptivePoll } from "@/hooks/use-adaptive-poll"

/**
 * Polls a pending waiter call after the sheet closes.
 * When staff taps "On it", plays a beep and shows the selected reason.
 */
export function useWaiterCallAck(tableKey: string | null | undefined) {
  const [pending, setPending] = useState<PendingWaiterCall | null>(null)
  const [staffOnWay, setStaffOnWay] = useState(false)

  useEffect(() => {
    const sync = () => {
      const p = getPendingWaiterCall()
      if (!tableKey || !p || p.tableKey !== tableKey) {
        setPending(null)
        setStaffOnWay(Boolean(p?.ackedNotified && p.tableKey === tableKey))
        return
      }
      setPending(p)
      if (p.ackedNotified) setStaffOnWay(true)
    }
    sync()
    window.addEventListener(WAITER_CALL_PENDING_EVENT, sync)
    return () => window.removeEventListener(WAITER_CALL_PENDING_EVENT, sync)
  }, [tableKey])

  const pollAck = useCallback(async () => {
    if (!pending?.callId || pending.ackedNotified) return
    try {
      const res = await fetch(
        `/api/waiter-calls?callId=${encodeURIComponent(pending.callId)}`,
        { cache: "no-store" }
      )
      if (!res.ok) return
      const data = await res.json()

      if (data?.status === "acknowledged") {
        const meta = reasonMeta(pending.reason)
        const label =
          data.reasonLabel ||
          data.confirmedLabel ||
          pending.reasonLabel ||
          meta.label

        if (claimWaiterAckNotification(pending.callId)) {
          playWaiterAckBeep()
          toast.success("Waiter confirmed", {
            description: `${label} · on the way`,
            duration: 6000,
          })
        }
        setStaffOnWay(true)
        setPending((p) => (p ? { ...p, ackedNotified: true } : p))
      } else if (data?.status === "cancelled") {
        clearPendingWaiterCall()
        setPending(null)
        setStaffOnWay(false)
      }
    } catch {}
  }, [pending?.callId, pending?.ackedNotified, pending?.reason, pending?.reasonLabel])

  useAdaptivePoll(
    Boolean(pending?.callId && !pending?.ackedNotified),
    pollAck,
    { activeMs: 5_000, hiddenMs: null }
  )

  return {
    pending,
    staffOnWay,
    statusLabel: staffOnWay
      ? "Waiter on the way"
      : pending
        ? "Waiter called ✓"
        : null,
  }
}
