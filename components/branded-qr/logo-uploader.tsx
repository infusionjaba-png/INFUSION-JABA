"use client"

import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { DEFAULT_BRANDED_LOGO_SRC } from "@/lib/branded-qr"

export function LogoUploader({
  onLogoDataUrl,
  hasCustomLogo,
  onClear,
}: {
  onLogoDataUrl: (dataUrl: string | null) => void
  hasCustomLogo: boolean
  onClear: () => void
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor="branded-qr-logo">Optional logo upload</Label>
      <Input
        id="branded-qr-logo"
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        className="cursor-pointer"
        onChange={async (e) => {
          const file = e.target.files?.[0]
          if (!file) return
          if (file.size > 2_000_000) {
            onLogoDataUrl(null)
            return
          }
          const reader = new FileReader()
          reader.onload = () => {
            if (typeof reader.result === "string") onLogoDataUrl(reader.result)
          }
          reader.readAsDataURL(file)
        }}
      />
      <p className="text-[11px] text-muted-foreground">
        Default: <code className="text-[10px]">{DEFAULT_BRANDED_LOGO_SRC}</code>
        {hasCustomLogo ? (
          <>
            {" · "}
            <button type="button" className="underline text-foreground" onClick={onClear}>
              Use brand logo
            </button>
          </>
        ) : null}
      </p>
    </div>
  )
}
