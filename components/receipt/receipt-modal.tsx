"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { X, Printer, Loader2 } from "lucide-react"
import { formatKsh, formatDate, formatReceiptTime, RECEIPT_DISPLAY_TILL_NUMBER } from "@/lib/receipt-utils"
import { getOrderPayUrl } from "@/lib/pay-url"

// Receipt order type
export interface ReceiptOrder {
  id: string
  timestamp: Date | string
  status: string
  table?: string | number
  customerName?: string
  customerPhone?: string | null
  waiter?: string
  cashier?: string
  paymentMethod?: string | null
  mpesaReceiptNumber?: string | null
  glovoOrderNumber?: string | null
  items: Array<{
    name: string
    quantity: number
    price: number
  }>
  subtotal?: number | null
  vat?: number | null
  total?: number | null
  cashAmount?: number | null
  cashBalance?: number | null
  /** M-Pesa / split payment summary */
  totalLinkedPayments?: number | null
  balanceDue?: number | null
  overpaymentAmount?: number | null
  changeGiven?: boolean | null
  paymentStatusLabel?: string | null
}

interface ReceiptModalProps {
  order: ReceiptOrder | null
  open: boolean
  onClose: () => void
  businessName?: string
  businessSubtitle?: string
  /** @deprecated Receipt display always uses RECEIPT_DISPLAY_TILL_NUMBER */
  tillNumber?: string
  showQRCode?: boolean
}

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

/**
 * Builds the receipt body HTML once — used verbatim for both the on-screen
 * preview and the 80mm print job, so what you see is exactly what prints.
 * Pure black & white for thermal printers.
 */
function buildReceiptHtml(opts: {
  order: ReceiptOrder
  businessName: string
  businessSubtitle: string
  tillNumber: string
  isPaid: boolean
  amountDue: number
  baseUrl: string
}): string {
  const { order, businessName, businessSubtitle, tillNumber, isPaid, amountDue, baseUrl } = opts

  const mono = `font-family:'Courier New',Courier,monospace;`
  const dashed = `border-top:1px dashed #000;margin:6px 0;`
  const solid = `border-top:2px solid #000;margin:6px 0;`

  const row = (label: string, value: string, size = 11) =>
    `<div style="display:flex;justify-content:space-between;align-items:baseline;gap:6px;${mono}font-size:${size}px;font-weight:700;line-height:1.5;">
      <span>${label}</span><span style="text-align:right;word-break:break-word;">${value}</span>
    </div>`

  const statusText = isPaid ? "PAID" : order.status === "pending" ? "PENDING" : "NOT PAID"

  const payUrl = getOrderPayUrl(order.id, baseUrl)
  const qrSrc = `${baseUrl.replace(/\/$/, "")}/api/qr?theme=mono&url=${encodeURIComponent(payUrl)}`
  const showScanToPay = !isPaid && amountDue > 0

  // ---------- Items ----------
  const itemsHtml = order.items
    .map((item) => {
      const lineTotal = formatKsh((item.price ?? 0) * (item.quantity ?? 0))
      return `
        <div style="margin:5px 0;">
          <div style="${mono}font-size:12px;font-weight:900;line-height:1.3;">${esc(item.name)}</div>
          ${row(`&nbsp;&nbsp;${item.quantity} x ${formatKsh(item.price)}`, lineTotal)}
        </div>`
    })
    .join("")

  // ---------- Extra totals ----------
  let extraTotals = ""
  if (order.totalLinkedPayments != null && order.totalLinkedPayments > 0) {
    extraTotals += row("Paid (linked)", formatKsh(order.totalLinkedPayments))
    if (order.balanceDue != null && order.balanceDue > 0) {
      extraTotals += row("Balance due", formatKsh(order.balanceDue))
    }
    if (order.overpaymentAmount != null && order.overpaymentAmount > 0) {
      extraTotals += row("Excess/change", formatKsh(order.overpaymentAmount))
      extraTotals += row("Change given", order.changeGiven ? "Yes" : "No")
    }
    if (order.paymentStatusLabel) {
      extraTotals += row("Pay status", esc(order.paymentStatusLabel))
    }
  }
  if (isPaid && order.cashAmount != null && order.cashAmount > 0) {
    extraTotals += row("Received", formatKsh(order.cashAmount))
    if (order.cashBalance != null && order.cashBalance > 0) {
      extraTotals += row("Change", formatKsh(order.cashBalance))
    }
  }

  // ---------- Scan to pay ----------
  const scanToPayHtml = showScanToPay
    ? `
      <div style="margin-top:10px;border:2px solid #000;">
        <div style="background:#000;color:#fff;padding:6px 4px;text-align:center;${mono}font-size:13px;font-weight:900;letter-spacing:4px;">
          SCAN TO PAY
        </div>
        <div style="padding:8px 6px;text-align:center;border-bottom:2px dashed #000;">
          <div style="${mono}font-size:9px;font-weight:700;letter-spacing:3px;">ORDER ID</div>
          <div style="${mono}font-size:19px;font-weight:900;word-break:break-all;line-height:1.1;margin-top:2px;">${esc(order.id)}</div>
        </div>
        <div style="padding:8px 6px;text-align:center;border-bottom:2px dashed #000;">
          <div style="${mono}font-size:9px;font-weight:700;letter-spacing:3px;">AMOUNT DUE</div>
          <div style="${mono}font-size:23px;font-weight:900;line-height:1.1;margin-top:2px;">${formatKsh(amountDue)}</div>
        </div>
        <div style="padding:10px 6px;text-align:center;">
          <div style="display:inline-block;border:2px solid #000;padding:5px;background:#fff;">
            <img src="${qrSrc}" alt="Scan to pay QR" width="150" height="150" style="display:block;" />
          </div>
          <div style="${mono}font-size:10px;font-weight:900;margin-top:6px;letter-spacing:1px;">POINT PHONE CAMERA HERE TO PAY</div>
          <div style="${mono}font-size:8px;font-weight:700;margin-top:3px;word-break:break-all;">${esc(payUrl.replace(/^https?:\/\//, ""))}</div>
        </div>
        ${
          tillNumber
            ? `<div style="background:#000;color:#fff;padding:7px 4px;text-align:center;">
                <div style="${mono}font-size:9px;font-weight:700;letter-spacing:3px;">M-PESA TILL</div>
                <div style="${mono}font-size:20px;font-weight:900;line-height:1.1;margin-top:2px;">${esc(tillNumber)}</div>
              </div>`
            : ""
        }
      </div>`
    : ""

  const paidStampHtml = isPaid
    ? `<div style="margin-top:10px;border:2px solid #000;background:#000;color:#fff;padding:8px 4px;text-align:center;${mono}font-size:15px;font-weight:900;letter-spacing:5px;">
        * PAID *
      </div>`
    : ""

  // ---------- Assemble ----------
  return `
    <div style="${mono}color:#000;background:#fff;font-weight:700;">
      <!-- Header -->
      <div style="text-align:center;">
        <div style="${mono}font-size:20px;font-weight:900;letter-spacing:1px;">${esc(businessName)}</div>
        ${businessSubtitle ? `<div style="${mono}font-size:10px;font-weight:700;letter-spacing:3px;text-transform:uppercase;margin-top:2px;">${esc(businessSubtitle)}</div>` : ""}
      </div>

      <div style="${solid}"></div>

      <!-- Order / status / date -->
      <div style="text-align:center;">
        <div style="${mono}font-size:9px;font-weight:700;letter-spacing:3px;">ORDER ID</div>
        <div style="${mono}font-size:17px;font-weight:900;word-break:break-all;line-height:1.2;margin-top:1px;">#${esc(order.id)}</div>
        <div style="${mono}font-size:11px;font-weight:900;letter-spacing:2px;margin-top:3px;">*** ${statusText} ***</div>
        <div style="${mono}font-size:10px;font-weight:700;margin-top:3px;">${formatDate(order.timestamp)} &bull; ${formatReceiptTime(order.timestamp)}</div>
      </div>

      <div style="${dashed}"></div>

      <!-- Meta -->
      ${row("Table", esc(order.table ?? "-"))}
      ${row("Customer", esc(order.customerName || "Walk-in"))}
      ${order.customerPhone ? row("Phone", esc(order.customerPhone)) : ""}
      ${row("Server", esc(order.waiter || "-"))}
      ${tillNumber ? row("Till No.", esc(tillNumber)) : ""}
      ${row("Payment", esc((order.paymentMethod || "-").toUpperCase()))}
      ${order.paymentMethod?.toLowerCase() === "glovo" && order.glovoOrderNumber ? row("Glovo #", esc(order.glovoOrderNumber)) : ""}
      ${order.paymentMethod?.toLowerCase() === "mpesa" && order.mpesaReceiptNumber ? row("M-Pesa Ref", esc(order.mpesaReceiptNumber)) : ""}

      <div style="${dashed}"></div>

      <!-- Items -->
      ${row("ITEM", "AMOUNT", 10)}
      <div style="${dashed}"></div>
      ${itemsHtml}

      <div style="${dashed}"></div>

      <!-- Totals -->
      ${row("Subtotal", formatKsh(order.subtotal))}
      ${extraTotals}
      <div style="${solid}"></div>
      <div style="display:flex;justify-content:space-between;align-items:baseline;${mono}font-size:16px;font-weight:900;">
        <span>TOTAL</span><span>${formatKsh(order.total)}</span>
      </div>
      ${
        !isPaid && amountDue > 0
          ? `<div style="display:flex;justify-content:space-between;align-items:center;background:#000;color:#fff;padding:5px 6px;margin-top:5px;${mono}font-size:13px;font-weight:900;">
              <span>AMOUNT DUE</span><span>${formatKsh(amountDue)}</span>
            </div>`
          : ""
      }

      ${paidStampHtml}
      ${scanToPayHtml}

      <div style="${dashed}margin-top:10px;"></div>

      <!-- Footer -->
      <div style="text-align:center;">
        <div style="${mono}font-size:12px;font-weight:900;">Thank you for your order!</div>
        <div style="${mono}font-size:9px;font-weight:700;margin-top:6px;">Printed: ${new Date().toLocaleString("en-KE")}</div>
        <div style="${mono}font-size:9px;font-weight:700;margin-top:2px;">Powered by Infusion POS</div>
      </div>
    </div>
  `
}

export function ReceiptModal({
  order,
  open,
  onClose,
  businessName = "catha lounge",
  businessSubtitle = "Restaurant & Bar",
  showQRCode = true,
}: ReceiptModalProps) {
  void showQRCode
  const [isPrinting, setIsPrinting] = useState(false)
  const tillNumber = RECEIPT_DISPLAY_TILL_NUMBER

  if (!order) return null

  const isPaid = order.status === "completed" || order.status === "PAID"
  const amountDueForPay =
    order.balanceDue != null && order.balanceDue > 0
      ? order.balanceDue
      : !isPaid && order.total != null
        ? order.total
        : 0

  const baseUrl =
    typeof window !== "undefined" ? window.location.origin : "https://www.infusionjaba.co.ke"

  const receiptHtml = buildReceiptHtml({
    order,
    businessName,
    businessSubtitle,
    tillNumber,
    isPaid,
    amountDue: amountDueForPay,
    baseUrl,
  })

  const handlePrint = () => {
    setIsPrinting(true)

    // Use hidden iframe to avoid opening a new tab
    const iframe = document.createElement("iframe")
    iframe.style.position = "fixed"
    iframe.style.right = "0"
    iframe.style.bottom = "0"
    iframe.style.width = "0"
    iframe.style.height = "0"
    iframe.style.border = "none"
    document.body.appendChild(iframe)

    const doc = iframe.contentWindow?.document
    if (!doc) {
      document.body.removeChild(iframe)
      setIsPrinting(false)
      return
    }

    doc.open()
    doc.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Receipt #${esc(order.id)}</title>
          <meta charset="UTF-8">
          <style>
            @page { size: 80mm auto; margin: 0; }
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body {
              width: 80mm;
              padding: 3mm 3mm 6mm;
              background: #fff;
              color: #000;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
            img { max-width: 100%; }
          </style>
        </head>
        <body>${receiptHtml}</body>
      </html>
    `)
    doc.close()

    // Small delay so the QR image renders before printing
    setTimeout(() => {
      iframe.contentWindow?.print()
      setTimeout(() => {
        document.body.removeChild(iframe)
        setIsPrinting(false)
      }, 1000)
    }, 400)
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-[420px] w-full max-h-[95vh] overflow-hidden flex flex-col p-0 gap-0 rounded-2xl">
        <DialogTitle className="sr-only">Receipt for Order #{order.id}</DialogTitle>

        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[#e5e7eb] bg-white">
          <div>
            <h2 className="text-base font-semibold text-[#0f172a]">Receipt</h2>
            <p className="text-[11px] text-[#64748b]">80mm thermal · exact print preview</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-[#f1f5f9] transition-colors"
          >
            <X className="h-5 w-5 text-[#64748b]" />
          </button>
        </div>

        {/* Receipt Preview — identical HTML to what prints */}
        <div className="flex-1 overflow-y-auto bg-[#e2e8f0] px-4 py-5">
          <div
            className="mx-auto bg-white shadow-[0_10px_30px_-10px_rgba(0,0,0,0.4)] px-3 py-4"
            style={{ width: 302 }}
            dangerouslySetInnerHTML={{ __html: receiptHtml }}
          />
        </div>

        {/* Modal Footer Actions */}
        <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-t border-[#e5e7eb] bg-[#f8fafc]">
          <span className="text-xs text-[#64748b]">
            <span className="font-semibold text-[#0f172a]">80mm</span> · B&amp;W thermal
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={onClose}
              className="h-9 px-4 text-sm font-medium"
            >
              Close
            </Button>
            <Button
              onClick={handlePrint}
              disabled={isPrinting}
              className="h-9 px-5 text-sm font-semibold bg-[#0f172a] hover:bg-[#1e293b] text-white"
            >
              {isPrinting ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Printer className="h-4 w-4 mr-2" />
              )}
              Print
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
