"use client"

import { Button } from "@/components/ui/button"
import { Download, FileImage, FileCode2 } from "lucide-react"
import type { ScanValidation } from "@/lib/branded-qr"

export function DownloadButtons({
  onDownloadPng,
  onDownloadSvg,
  disabled,
  validation,
}: {
  onDownloadPng: () => void
  onDownloadSvg: () => void
  disabled?: boolean
  validation: ScanValidation
}) {
  const failed =
    validation.status === "fail" || validation.status === "mismatch"
  const checking = validation.status === "checking"

  return (
    <div className="space-y-2">
      <div className="flex flex-col sm:flex-row gap-2">
        <Button
          type="button"
          className="flex-1 h-11 rounded-xl bg-[#2F8F3A] hover:bg-[#237530]"
          disabled={disabled || checking}
          onClick={onDownloadPng}
        >
          <FileImage className="h-4 w-4 mr-2" />
          Download PNG
        </Button>
        <Button
          type="button"
          variant="outline"
          className="flex-1 h-11 rounded-xl border-[#2F8F3A]/40"
          disabled={disabled || checking}
          onClick={onDownloadSvg}
        >
          <FileCode2 className="h-4 w-4 mr-2" />
          Download SVG
        </Button>
      </div>
      {failed && (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2">
          Warning: this QR failed scan validation. You can still download, but test it with a phone camera before
          printing.
        </p>
      )}
      <p className="text-[11px] text-muted-foreground flex items-center gap-1">
        <Download className="h-3 w-3" />
        Exports include the live branded emblem at the selected size.
      </p>
    </div>
  )
}
