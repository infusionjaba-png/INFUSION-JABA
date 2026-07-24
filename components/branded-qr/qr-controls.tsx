"use client"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { LogoUploader } from "./logo-uploader"
import { MAX_SAFE_PAYLOAD_CHARS } from "@/lib/branded-qr"
import { Loader2, QrCode, RotateCcw } from "lucide-react"

export const QR_SIZE_OPTIONS = [
  { label: "Small (320)", value: 320 },
  { label: "Medium (480)", value: 480 },
  { label: "Standard (600)", value: 600 },
  { label: "Large (640)", value: 640 },
  { label: "Print (1024)", value: 1024 },
] as const

export function QrControls({
  value,
  onValueChange,
  size,
  onSizeChange,
  onGenerate,
  onReset,
  generating,
  emptyError,
  longWarning,
  customLogo,
  onLogoDataUrl,
  onClearLogo,
}: {
  value: string
  onValueChange: (v: string) => void
  size: number
  onSizeChange: (n: number) => void
  onGenerate: () => void
  onReset: () => void
  generating?: boolean
  emptyError?: string | null
  longWarning?: string | null
  customLogo: boolean
  onLogoDataUrl: (dataUrl: string | null) => void
  onClearLogo: () => void
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="branded-qr-value">URL or text</Label>
        <Input
          id="branded-qr-value"
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          placeholder="https://www.infusionjaba.co.ke/menu?t=1"
          className="h-11 rounded-xl"
          onKeyDown={(e) => {
            if (e.key === "Enter") onGenerate()
          }}
        />
        {emptyError ? <p className="text-xs text-red-600">{emptyError}</p> : null}
        {longWarning ? <p className="text-xs text-amber-700">{longWarning}</p> : null}
        <p className="text-[11px] text-muted-foreground">
          Keep under ~{MAX_SAFE_PAYLOAD_CHARS} characters for reliable scanning with the center logo (ECC H).
        </p>
      </div>

      <div className="space-y-2">
        <Label>QR size</Label>
        <Select value={String(size)} onValueChange={(v) => onSizeChange(Number(v))}>
          <SelectTrigger className="h-11 rounded-xl">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {QR_SIZE_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={String(o.value)}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <LogoUploader
        onLogoDataUrl={onLogoDataUrl}
        hasCustomLogo={customLogo}
        onClear={onClearLogo}
      />

      <div className="flex flex-col sm:flex-row gap-2 pt-1">
        <Button
          type="button"
          className="flex-1 h-11 rounded-xl bg-[#F27A21] hover:bg-[#d96818] text-white font-semibold"
          onClick={onGenerate}
          disabled={generating}
        >
          {generating ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <QrCode className="h-4 w-4 mr-2" />
          )}
          Generate QR
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-11 rounded-xl sm:w-auto"
          onClick={onReset}
        >
          <RotateCcw className="h-4 w-4 mr-2" />
          Reset
        </Button>
      </div>
    </div>
  )
}
