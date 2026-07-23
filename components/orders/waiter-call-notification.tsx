"use client"

import React, { useState } from "react"
import { BellRing, Check, Volume2, X } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  type WaiterCall,
  formatCallTime,
  tableDisplay,
} from "@/lib/waiter-call"
import styles from "./order-notification.module.css"

interface WaiterCallNotificationProps {
  call: WaiterCall
  onDismiss: () => void
  onAcknowledge: () => void | Promise<void>
  /** First-load / audio-locked: show Enable sound pill beside On it */
  showEnableSound?: boolean
  onEnableSound?: () => void
}

export function WaiterCallNotification({
  call,
  onDismiss,
  onAcknowledge,
  showEnableSound = false,
  onEnableSound,
}: WaiterCallNotificationProps) {
  const [exiting, setExiting] = useState(false)
  const [acked, setAcked] = useState(false)

  const table = tableDisplay(call.tableNumber || call.tableId)
  const reason = call.reasonLabel || "Assistance"
  const phone = call.customerPhone?.trim() || null
  const time = formatCallTime(call.createdAt)

  const dismiss = () => {
    if (exiting) return
    setExiting(true)
    setTimeout(onDismiss, 280)
  }

  const handleOnIt = async () => {
    if (acked || exiting) return
    setAcked(true)
    try {
      await onAcknowledge()
    } finally {
      setTimeout(() => {
        setExiting(true)
        setTimeout(onDismiss, 280)
      }, 480)
    }
  }

  return (
    <div
      className={cn(styles.card, exiting ? styles.exit : styles.enter)}
      role="alertdialog"
      aria-label="Waiter call"
    >
      <div className={styles.brandEdge} aria-hidden />
      <div className={styles.body}>
        <div className={styles.header}>
          <div className={styles.bellWrap}>
            <BellRing className={styles.bellIcon} strokeWidth={2.25} />
          </div>
          <div className={styles.headerText}>
            <h3 className={styles.title}>
              Table {table} · {reason}
            </h3>
            <p className={styles.meta}>
              Called {time}
              {phone ? ` · ${phone}` : ""}
            </p>
          </div>
          <button
            type="button"
            className={styles.dismiss}
            aria-label="Dismiss"
            onClick={dismiss}
          >
            <X className="h-4 w-4" strokeWidth={2.25} />
          </button>
        </div>

        <div className={styles.waiterActions}>
          <button
            type="button"
            className={cn(styles.onIt, acked && styles.onItDone)}
            onClick={handleOnIt}
            disabled={acked}
          >
            <Check className="h-4 w-4" strokeWidth={2.5} />
            {acked ? "On the way" : "On it"}
          </button>
          {showEnableSound && (
            <button
              type="button"
              className={styles.enableSound}
              onClick={onEnableSound}
            >
              <Volume2 className={styles.enableSoundIcon} strokeWidth={2.25} />
              Enable sound
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
