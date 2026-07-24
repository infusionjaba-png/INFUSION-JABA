"use client"

import React, { useMemo, useState } from "react"
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  Check,
  ExternalLink,
  MessageSquare,
  Printer,
  Share2,
} from "lucide-react"
import { cn } from "@/lib/utils"
import styles from "./menu-receipt-sheet.module.css"

export type MenuReceiptPayload = {
  primaryOrderId: string
  receiptUrl: string
  total: number
  roundCount: number
  tableNumber: string
  paidAt: number
  items: Array<{ name: string; quantity: number; price: number }>
  mpesaReceiptNumber?: string | null
  sms: { sent: boolean; reason?: string; phone?: string | null }
}

interface MenuReceiptSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  receipt: MenuReceiptPayload | null
}

function formatKes(n: number) {
  return `KES ${Math.round(n).toLocaleString("en-KE")}`
}

function formatTime(ts: number) {
  try {
    return new Date(ts).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    })
  } catch {
    return ""
  }
}

function smsLabel(sms: MenuReceiptPayload["sms"]): string {
  if (sms.sent && sms.phone) return `SMS sent to ${sms.phone}`
  if (sms.sent) return "SMS receipt sent"
  if (sms.reason === "already_sent_or_in_progress") return "SMS already sent"
  if (sms.reason === "no_valid_customer_phone") return "No phone for SMS"
  if (sms.reason === "sms_send_failed") return "SMS failed — use share below"
  return "SMS not sent"
}

export function MenuReceiptSheet({
  open,
  onOpenChange,
  receipt,
}: MenuReceiptSheetProps) {
  const [sharing, setSharing] = useState(false)

  const visibleItems = useMemo(
    () => (receipt?.items ?? []).slice(0, 8),
    [receipt?.items]
  )
  const hidden = Math.max(0, (receipt?.items.length ?? 0) - visibleItems.length)

  if (!receipt) return null

  const absoluteUrl =
    typeof window !== "undefined" && receipt.receiptUrl.startsWith("http")
      ? receipt.receiptUrl
      : typeof window !== "undefined"
        ? `${window.location.origin}/r/${encodeURIComponent(receipt.primaryOrderId)}`
        : receipt.receiptUrl

  const handlePrint = () => {
    // Prefer dedicated receipt page print (clean layout)
    const w = window.open(absoluteUrl, "_blank", "noopener,noreferrer")
    if (w) {
      const tryPrint = () => {
        try {
          w.focus()
          w.print()
        } catch {}
      }
      // Give the receipt page a moment to render
      setTimeout(tryPrint, 800)
    } else {
      window.print()
    }
  }

  const handleShare = async () => {
    setSharing(true)
    const text = `Catha Lounge receipt — ${formatKes(receipt.total)}\n${absoluteUrl}`
    try {
      if (navigator.share) {
        await navigator.share({
          title: "Catha Lounge receipt",
          text: `Your tab receipt (${formatKes(receipt.total)})`,
          url: absoluteUrl,
        })
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
        alert("Receipt link copied")
      } else {
        window.open(absoluteUrl, "_blank", "noopener,noreferrer")
      }
    } catch {
      // user cancelled share — ignore
    } finally {
      setSharing(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
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

          <div className={styles.scroll}>
            <div className={styles.hero}>
              <div className={styles.checkWrap} aria-hidden>
                <Check className="h-7 w-7" strokeWidth={2.5} />
              </div>
              <SheetTitle className={styles.title}>Tab paid</SheetTitle>
              <p className={styles.meta}>
                Table {receipt.tableNumber}
                {receipt.roundCount > 1
                  ? ` · ${receipt.roundCount} rounds`
                  : ""}
                {" · "}
                {formatTime(receipt.paidAt)}
              </p>
              <p className={styles.total}>{formatKes(receipt.total)}</p>
              {receipt.mpesaReceiptNumber && (
                <p className={styles.meta}>
                  M-Pesa {receipt.mpesaReceiptNumber}
                </p>
              )}
              <div
                className={cn(
                  styles.smsChip,
                  receipt.sms.sent && styles.smsChipOk
                )}
              >
                <MessageSquare className={styles.smsIcon} strokeWidth={2.25} />
                {smsLabel(receipt.sms)}
              </div>
            </div>

            <div className={styles.lines}>
              {visibleItems.map((item, i) => (
                <div key={`${item.name}-${i}`} className={styles.line}>
                  <span>
                    {item.quantity}× {item.name}
                  </span>
                  <span className={styles.lineAmt}>
                    {formatKes(item.quantity * item.price)}
                  </span>
                </div>
              ))}
              {hidden > 0 && (
                <p className={styles.more}>
                  +{hidden} more on full receipt
                </p>
              )}
            </div>

            <div className={styles.actions}>
              <a
                className={styles.primary}
                href={absoluteUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink className="h-4 w-4" strokeWidth={2.25} />
                View receipt
              </a>
              <button type="button" className={styles.secondary} onClick={handlePrint}>
                <Printer className="h-4 w-4" strokeWidth={2.25} />
                Print / PDF
              </button>
              <button
                type="button"
                className={styles.secondary}
                onClick={handleShare}
                disabled={sharing}
              >
                <Share2 className="h-4 w-4" strokeWidth={2.25} />
                {sharing ? "Sharing…" : "Share"}
              </button>
            </div>

            <button
              type="button"
              className={styles.done}
              onClick={() => onOpenChange(false)}
            >
              Done
            </button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
