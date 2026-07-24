"use client"

import { CheckCircle2, AlertTriangle, Loader2, ShieldAlert } from "lucide-react"
import type { ScanValidation } from "@/lib/branded-qr"
import { cn } from "@/lib/utils"

export function ScanValidationStatus({
  validation,
  className,
}: {
  validation: ScanValidation
  className?: string
}) {
  if (validation.status === "idle") return null

  if (validation.status === "checking") {
    return (
      <div className={cn("flex items-center gap-2 text-sm text-slate-600", className)}>
        <Loader2 className="h-4 w-4 animate-spin" />
        Validating scan…
      </div>
    )
  }

  if (validation.status === "ok") {
    return (
      <div
        className={cn(
          "flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800",
          className
        )}
      >
        <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
        <div>
          <p className="font-semibold">QR verified and scannable</p>
          <p className="text-xs text-emerald-700/90 mt-0.5 break-all">Decoded: {validation.decoded}</p>
          <p className="text-xs text-emerald-700/90 mt-0.5">
            PNG {validation.pngOk ? "ok" : "fail"} · SVG {validation.svgOk ? "ok" : "fail"}
          </p>
        </div>
      </div>
    )
  }

  if (validation.status === "mismatch") {
    return (
      <div
        className={cn(
          "flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900",
          className
        )}
      >
        <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" />
        <div>
          <p className="font-semibold">Decoded value does not match input</p>
          <p className="text-xs mt-0.5 break-all">Got: {validation.decoded}</p>
        </div>
      </div>
    )
  }

  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800",
        className
      )}
    >
      <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
      <div>
        <p className="font-semibold">QR failed scan validation</p>
        <p className="text-xs mt-0.5">{validation.message}</p>
      </div>
    </div>
  )
}
