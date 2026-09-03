/**
 * Adaptive polling helpers — reduce Vercel invocations without removing live updates.
 *
 * Visible tab: use the provided active interval.
 * Hidden tab: pause (default) or use a much longer background interval.
 * Tab return: caller should refresh immediately via visibilitychange.
 */

export function documentIsVisible(): boolean {
  if (typeof document === "undefined") return true
  return document.visibilityState !== "hidden"
}

export type AdaptivePollOptions = {
  /** Interval while the tab is visible (ms). */
  activeMs: number
  /**
   * Interval while the tab is hidden.
   * - `null` / omit → pause entirely while hidden (recommended).
   * - number → keep a slow background poll.
   */
  hiddenMs?: number | null
  /** Skip starting a new tick while the previous async tick is still running. */
  skipIfInFlight?: boolean
  /** Run the first tick immediately (default true). Set false when caller already fetched. */
  immediate?: boolean
}

/**
 * Non-React adaptive poller (singletons, stores).
 * Returns a stop() function. Refreshes immediately when the tab becomes visible again.
 */
export function startAdaptivePoll(
  tick: () => void | Promise<void>,
  options: AdaptivePollOptions
): () => void {
  const { activeMs, hiddenMs = null, skipIfInFlight = true, immediate = true } = options
  let timer: ReturnType<typeof setTimeout> | null = null
  let stopped = false
  let inFlight = false

  const clear = () => {
    if (timer != null) {
      clearTimeout(timer)
      timer = null
    }
  }

  const schedule = (delay: number) => {
    clear()
    if (stopped) return
    timer = setTimeout(run, delay)
  }

  const run = async () => {
    if (stopped) return
    if (!documentIsVisible()) {
      if (hiddenMs == null) {
        // Paused until visibilitychange
        return
      }
      if (skipIfInFlight && inFlight) {
        schedule(hiddenMs)
        return
      }
      inFlight = true
      try {
        await tick()
      } finally {
        inFlight = false
        if (!stopped && !documentIsVisible() && hiddenMs != null) {
          schedule(hiddenMs)
        } else if (!stopped && documentIsVisible()) {
          schedule(activeMs)
        }
      }
      return
    }

    if (skipIfInFlight && inFlight) {
      schedule(activeMs)
      return
    }
    inFlight = true
    try {
      await tick()
    } finally {
      inFlight = false
      if (!stopped) {
        schedule(documentIsVisible() ? activeMs : hiddenMs ?? activeMs)
      }
    }
  }

  const onVisibility = () => {
    if (stopped) return
    if (documentIsVisible()) {
      // Immediate sync on return, then resume active cadence
      void run()
    } else {
      clear()
      if (hiddenMs != null) schedule(hiddenMs)
    }
  }

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibility)
  }

  // Kick off — immediate sync on mount (unless caller already fetched), else wait one cadence.
  schedule(immediate ? 0 : activeMs)

  return () => {
    stopped = true
    clear()
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }
}
