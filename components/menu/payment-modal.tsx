"use client"

import React, { useState, useEffect, useRef } from "react"
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog"
import { Check, Smartphone, Pencil } from "lucide-react"

interface PaymentModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  amount: number
  phone?: string
  orderMeta?: string
  onSuccess: (
    method: "mpesa" | "cash",
    mpesaReceiptNumber?: string,
    paidPhone?: string
  ) => void
  /** Skip the choose screen and go straight to M-Pesa */
  skipToMpesa?: boolean
  /** Hide cash option entirely — for orders already at the bar */
  mpesaOnly?: boolean
}

type Step = "settle" | "waiting" | "success" | "error"

function formatPhoneDisplay(raw: string): string {
  const digits = raw.replace(/\D/g, "")
  if (digits.startsWith("254") && digits.length >= 12) {
    return `+254 ${digits.slice(3, 6)} ${digits.slice(6, 9)} ${digits.slice(9)}`
  }
  if (digits.startsWith("0") && digits.length >= 10) {
    return `+254 ${digits.slice(1, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`
  }
  return raw || "+254"
}

export function PaymentModal({
  open,
  onOpenChange,
  amount,
  phone = "",
  orderMeta,
  onSuccess,
  skipToMpesa = false,
  mpesaOnly = false,
}: PaymentModalProps) {
  const [step, setStep] = useState<Step>("settle")
  const [phoneNumber, setPhoneNumber] = useState(phone)
  const [editingPhone, setEditingPhone] = useState(false)
  const [errorMsg, setErrorMsg] = useState("")
  const pollRef = useRef<NodeJS.Timeout | null>(null)
  const pollCountRef = useRef(0)

  useEffect(() => {
    if (phone) setPhoneNumber(phone)
  }, [phone])

  useEffect(() => {
    if (open) {
      setStep("settle")
      setErrorMsg("")
      pollCountRef.current = 0
      setEditingPhone(false)
    } else {
      stopPolling()
    }
    // skipToMpesa / mpesaOnly retained for API compat — settle is always M-Pesa first
    void skipToMpesa
    void mpesaOnly
  }, [open, skipToMpesa, mpesaOnly])

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }

  const handleClose = () => {
    if (step === "waiting" || step === "success") return
    stopPolling()
    setStep("settle")
    onOpenChange(false)
  }

  const handleMpesaSTK = async () => {
    if (!phoneNumber.trim()) return
    setErrorMsg("")
    setStep("waiting")

    try {
      const ref = `MENU${Date.now().toString().slice(-8)}`
      const res = await fetch("/api/mpesa/stk-push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phoneNumber: phoneNumber.trim(),
          amount,
          accountReference: ref,
          transactionDesc: `Table order ${ref}`,
        }),
      })
      const data = await res.json()

      if (!data.success) {
        setErrorMsg(data.error || "Failed to initiate M-Pesa payment. Please try again.")
        setStep("error")
        return
      }

      const cid = data.data?.checkoutRequestID
      pollCountRef.current = 0

      pollRef.current = setInterval(async () => {
        pollCountRef.current += 1
        if (pollCountRef.current > 30) {
          stopPolling()
          setErrorMsg("Payment confirmation timed out. Please try again.")
          setStep("error")
          return
        }

        try {
          const search = cid || ref
          const txRes = await fetch(`/api/mpesa/transactions?search=${encodeURIComponent(search)}`)
          const txData = await txRes.json()
          const tx = Array.isArray(txData.transactions) ? txData.transactions[0] : null

          if (tx?.status === "COMPLETED" || tx?.result_code === "0") {
            stopPolling()
            const receipt: string | undefined =
              tx.mpesaReceiptNumber || tx.mpesa_receipt_number || tx.MpesaReceiptNumber || undefined
            setStep("success")
            setTimeout(() => {
              onSuccess("mpesa", receipt, phoneNumber.trim())
              setStep("settle")
              onOpenChange(false)
            }, 1800)
          } else if (tx?.status === "CANCELLED" || tx?.result_code === "1032") {
            stopPolling()
            setErrorMsg("Payment was cancelled. Please try again.")
            setStep("error")
          } else if (tx?.status === "FAILED") {
            stopPolling()
            setErrorMsg(tx.result_desc || "Payment failed. Please try again.")
            setStep("error")
          }
        } catch {
          // keep polling
        }
      }, 4000)
    } catch (err: any) {
      setErrorMsg(err.message || "Network error. Please try again.")
      setStep("error")
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className="sm:max-w-sm rounded-[1.15rem] border border-[rgba(242,232,216,0.14)] shadow-2xl shadow-black/60 p-0 overflow-hidden"
        style={{
          background:
            "radial-gradient(ellipse at top center, rgba(200,114,42,0.12), transparent 55%), #2E241B",
        }}
        aria-describedby={undefined}
      >
        <div className="p-6">
          {step === "settle" && (
            <>
              <DialogTitle className="text-xl font-semibold text-[#F5EBDC] text-left font-[family-name:var(--menu-font-display)]">
                Settle your tab
              </DialogTitle>
              {orderMeta && (
                <p className="text-[rgba(242,232,216,0.65)] text-sm mt-1 text-left">
                  {orderMeta}
                </p>
              )}

              <div className="text-center my-8">
                <p className="text-[rgba(242,232,216,0.65)] text-[10px] font-semibold uppercase tracking-[0.16em] mb-2">
                  Amount due
                </p>
                <p className="text-[32px] leading-none font-semibold text-[#F5EBDC] font-[family-name:var(--menu-font-display)] tabular-nums">
                  KES {(Number(amount) || 0).toLocaleString()}
                </p>
              </div>

              <div className="mb-5">
                {editingPhone ? (
                  <input
                    autoFocus
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    onBlur={() => setEditingPhone(false)}
                    placeholder="07XX XXX XXX"
                    type="tel"
                    className="w-full h-12 px-4 rounded-xl bg-[#382C21] border border-[rgba(242,232,216,0.14)] text-[#F5EBDC] placeholder:text-[rgba(242,232,216,0.45)] text-base focus:outline-none focus:ring-2 focus:ring-[rgba(200,114,42,0.12)] focus:border-[rgba(200,114,42,0.55)] transition-all"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setEditingPhone(true)}
                    className="w-full h-12 px-4 rounded-xl bg-[#382C21] border border-[rgba(242,232,216,0.14)] flex items-center justify-between text-left"
                  >
                    <span className="text-[#F5EBDC] text-[15px] tabular-nums">
                      {formatPhoneDisplay(phoneNumber)}
                    </span>
                    <Pencil className="h-4 w-4 text-[#D9843B]" />
                  </button>
                )}
              </div>

              <button
                onClick={handleMpesaSTK}
                disabled={!phoneNumber || phoneNumber.replace(/\D/g, "").length < 9}
                className="w-full h-[54px] rounded-xl font-bold text-[15px] bg-gradient-to-r from-[#c8722a] to-[#e09040] text-[#412402] disabled:opacity-40 disabled:cursor-not-allowed transition-all active:scale-[0.98] flex items-center justify-center gap-2 shadow-[0_8px_24px_rgba(200,114,42,0.28)]"
              >
                <Smartphone className="h-4 w-4" strokeWidth={2.5} />
                Pay with M-Pesa
              </button>
            </>
          )}

          {step === "waiting" && (
            <div className="flex flex-col items-center justify-center py-10 space-y-4">
              <div className="relative h-16 w-16 flex items-center justify-center">
                <div className="absolute inset-0 rounded-full bg-[rgba(217,132,59,0.2)] animate-ping" />
                <div className="relative h-14 w-14 rounded-full bg-[#382C21] border border-[rgba(242,232,216,0.14)] flex items-center justify-center">
                  <Smartphone className="h-7 w-7 text-[#D9843B] animate-pulse" />
                </div>
              </div>
              <div className="text-center">
                <p className="text-[#F5EBDC] font-semibold font-[family-name:var(--menu-font-display)] text-lg">
                  Check your phone
                </p>
                <p className="text-[rgba(242,232,216,0.65)] text-sm mt-1">
                  Enter your M-Pesa PIN to complete
                </p>
              </div>
              <button
                onClick={() => {
                  stopPolling()
                  setStep("settle")
                }}
                className="text-[rgba(242,232,216,0.65)] text-xs hover:text-[rgba(242,232,216,0.8)] transition-colors mt-2"
              >
                Cancel
              </button>
            </div>
          )}

          {step === "success" && (
            <div className="flex flex-col items-center justify-center py-10 space-y-4">
              <div className="relative">
                <div className="absolute inset-[-20px] rounded-full bg-[radial-gradient(circle,rgba(217,132,59,0.35),transparent_68%)] pointer-events-none" />
                <div className="relative h-16 w-16 rounded-full bg-[#D9843B] flex items-center justify-center">
                  <Check className="h-8 w-8 text-[#412402]" strokeWidth={2.5} />
                </div>
              </div>
              <div className="text-center">
                <p className="text-[#F5EBDC] font-semibold text-lg font-[family-name:var(--menu-font-display)]">
                  Payment received
                </p>
                <p className="text-[rgba(242,232,216,0.65)] text-sm mt-1">
                  Moving to order history…
                </p>
              </div>
            </div>
          )}

          {step === "error" && (
            <div className="flex flex-col items-center justify-center py-6 space-y-4">
              <div className="w-full rounded-xl px-4 py-3 bg-[rgba(94,31,31,0.2)] border border-[rgba(94,31,31,0.35)]">
                <p className="text-[#F5EBDC] text-sm text-center">{errorMsg || "Payment failed"}</p>
              </div>
              <button
                onClick={() => {
                  setErrorMsg("")
                  setStep("settle")
                }}
                className="w-full h-[54px] rounded-xl font-bold text-[15px] text-[#D9843B] bg-transparent border border-[rgba(217,132,59,0.4)] hover:bg-[rgba(217,132,59,0.1)] transition-all"
              >
                Try again
              </button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
