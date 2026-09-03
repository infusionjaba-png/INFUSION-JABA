"use client"

import { useEffect, useRef } from "react"
import { startAdaptivePoll, type AdaptivePollOptions } from "@/lib/adaptive-poll"

/**
 * React wrapper around startAdaptivePoll.
 * Re-binds the latest callback without restarting the timer on every render.
 */
export function useAdaptivePoll(
  enabled: boolean,
  tick: () => void | Promise<void>,
  options: AdaptivePollOptions
) {
  const tickRef = useRef(tick)
  tickRef.current = tick

  const activeMs = options.activeMs
  const hiddenMs = options.hiddenMs ?? null
  const skipIfInFlight = options.skipIfInFlight !== false
  const immediate = options.immediate !== false

  useEffect(() => {
    if (!enabled) return
    return startAdaptivePoll(() => tickRef.current(), {
      activeMs,
      hiddenMs,
      skipIfInFlight,
      immediate,
    })
  }, [enabled, activeMs, hiddenMs, skipIfInFlight, immediate])
}
