"use client"

import { cn } from "@/lib/utils"
import { formatKsh } from "@/lib/receipt-utils"
import { getOrderPayUrl } from "@/lib/pay-url"

interface ScanToPayBlockProps {
  orderId: string
  amountDue?: number | null
  tillNumber?: string | null
  isPaid?: boolean
  className?: string
  /** Use absolute URLs for print iframe */
  baseUrl?: string
}

/**
 * Designed for black & white thermal printing: solid black bands,
 * heavy borders, bold mono type. No color so screen matches paper.
 */
export function ScanToPayBlock({
  orderId,
  amountDue,
  tillNumber,
  isPaid = false,
  className,
  baseUrl,
}: ScanToPayBlockProps) {
  const payUrl = getOrderPayUrl(orderId, baseUrl)
  const qrSrc = `/api/qr?theme=mono&url=${encodeURIComponent(payUrl)}`
  const showPay = !isPaid && amountDue != null && amountDue > 0

  if (!showPay && isPaid) {
    return (
      <div className={cn("border-2 border-black p-3 text-center", className)}>
        <p className="text-sm font-black uppercase tracking-widest text-black">✓ Payment received</p>
        <p className="text-xs mt-1 font-mono font-bold text-black">Order #{orderId}</p>
      </div>
    )
  }

  if (!showPay) return null

  return (
    <div className={cn("border-2 border-black bg-white text-black", className)}>
      {/* Solid black title band */}
      <div className="bg-black px-3 py-2 text-center">
        <p className="text-sm font-black uppercase tracking-[0.3em] text-white">▪ Scan to Pay ▪</p>
      </div>

      {/* Order ID */}
      <div className="border-b-2 border-dashed border-black px-3 py-2.5 text-center">
        <p className="text-[10px] font-bold uppercase tracking-[0.25em]">Order ID</p>
        <p className="font-mono text-2xl font-black tracking-tight break-all leading-none mt-1">
          {orderId}
        </p>
      </div>

      {/* Amount */}
      <div className="border-b-2 border-dashed border-black px-3 py-2 text-center">
        <p className="text-[10px] font-bold uppercase tracking-[0.25em]">Amount Due</p>
        <p className="font-mono text-3xl font-black tabular-nums leading-none mt-1">
          {formatKsh(amountDue!)}
        </p>
      </div>

      {/* QR */}
      <div className="px-3 py-3 flex flex-col items-center gap-2">
        <div className="border-2 border-black p-1.5 bg-white">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={qrSrc}
            alt={`Scan to pay order ${orderId}`}
            width={168}
            height={168}
            className="h-40 w-40 sm:h-44 sm:w-44 object-contain"
          />
        </div>
        <p className="text-[11px] font-bold text-center leading-snug uppercase tracking-wide">
          Point phone camera here to pay
        </p>
        <p className="text-[10px] font-mono font-bold break-all text-center px-1">
          {payUrl.replace(/^https?:\/\//, "")}
        </p>
      </div>

      {/* Till */}
      {tillNumber && (
        <div className="bg-black px-3 py-2.5 text-center">
          <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-white">
            M-Pesa Till
          </p>
          <p className="font-mono text-2xl font-black text-white leading-none mt-0.5">{tillNumber}</p>
        </div>
      )}
    </div>
  )
}

/** HTML string for thermal print (no React) — pure black & white. */
export function scanToPayPrintHtml(opts: {
  orderId: string
  amountDue: number
  tillNumber?: string
  isPaid?: boolean
  baseUrl?: string
}): string {
  const { orderId, amountDue, tillNumber, isPaid, baseUrl } = opts
  if (isPaid || amountDue <= 0) return ""

  const payUrl = getOrderPayUrl(orderId, baseUrl)
  const qrSrc = `${(baseUrl || "https://www.infusionjaba.co.ke").replace(/\/$/, "")}/api/qr?theme=mono&url=${encodeURIComponent(payUrl)}`

  return `
    <div style="margin-top:12px;border:2px solid #000;text-align:center;color:#000;background:#fff;">
      <div style="background:#000;color:#fff;padding:6px 4px;font-size:12px;font-weight:900;letter-spacing:4px;text-transform:uppercase;">
        &#9642; SCAN TO PAY &#9642;
      </div>
      <div style="padding:8px 6px;border-bottom:2px dashed #000;">
        <div style="font-size:9px;font-weight:700;letter-spacing:3px;text-transform:uppercase;">ORDER ID</div>
        <div style="font-family:monospace;font-size:20px;font-weight:900;margin-top:2px;word-break:break-all;line-height:1;">${orderId}</div>
      </div>
      <div style="padding:8px 6px;border-bottom:2px dashed #000;">
        <div style="font-size:9px;font-weight:700;letter-spacing:3px;text-transform:uppercase;">AMOUNT DUE</div>
        <div style="font-family:monospace;font-size:24px;font-weight:900;margin-top:2px;line-height:1;">KSh ${amountDue.toFixed(2)}</div>
      </div>
      <div style="padding:10px 6px;">
        <div style="display:inline-block;border:2px solid #000;padding:5px;background:#fff;">
          <img src="${qrSrc}" alt="QR" width="150" height="150" style="display:block;" />
        </div>
        <div style="font-size:10px;font-weight:900;margin-top:6px;text-transform:uppercase;letter-spacing:1px;">Point phone camera here to pay</div>
        <div style="font-family:monospace;font-size:8px;font-weight:700;margin-top:3px;word-break:break-all;">${payUrl.replace(/^https?:\/\//, "")}</div>
      </div>
      ${
        tillNumber
          ? `<div style="background:#000;color:#fff;padding:7px 4px;">
              <div style="font-size:9px;font-weight:700;letter-spacing:3px;text-transform:uppercase;">M-PESA TILL</div>
              <div style="font-family:monospace;font-size:20px;font-weight:900;line-height:1;margin-top:2px;">${tillNumber}</div>
            </div>`
          : ""
      }
    </div>
  `
}
