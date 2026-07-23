"use client"

import { useEffect, useState } from "react"
import {
  WAITER_CALL_COOLDOWN_EVENT,
  formatCountdown,
  getCooldownUntil,
} from "@/lib/waiter-call"

/** Live remaining cooldown for a table's Call Waiter button. */
export function useWaiterCallCooldown(tableKey: string | null | undefined) {
  const [remainingMs, setRemainingMs] = useState(0)

  useEffect(() => {
    if (!tableKey) {
      setRemainingMs(0)
      return
    }

    const tick = () => {
      const until = getCooldownUntil(tableKey)
      setRemainingMs(until ? Math.max(0, until - Date.now()) : 0)
    }

    tick()
    const id = setInterval(tick, 1000)
    const onSync = () => tick()
    window.addEventListener(WAITER_CALL_COOLDOWN_EVENT, onSync)
    window.addEventListener("storage", onSync)

    return () => {
      clearInterval(id)
      window.removeEventListener(WAITER_CALL_COOLDOWN_EVENT, onSync)
      window.removeEventListener("storage", onSync)
    }
  }, [tableKey])

  const cooling = remainingMs > 0
  return {
    cooling,
    remainingMs,
    label: cooling
      ? `Waiter called ✓ · ${formatCountdown(remainingMs)}`
      : "Call waiter",
    shortLabel: cooling ? "Waiter called ✓" : "Call waiter",
  }
}
