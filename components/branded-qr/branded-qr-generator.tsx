"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  buildBrandedQrSvg,
  DEFAULT_BRANDED_LOGO_SRC,
  downloadBlob,
  downloadSvg,
  MAX_SAFE_PAYLOAD_CHARS,
  svgToPngBlob,
  validateBrandedQrSvg,
  type ScanValidation,
} from "@/lib/branded-qr"
import { QrControls } from "./qr-controls"
import { QrPreview } from "./qr-preview"
import { DownloadButtons } from "./download-buttons"
import { ScanValidationStatus } from "./scan-validation-status"
import { toast } from "sonner"

async function fetchAsDataUrl(src: string): Promise<string> {
  const res = await fetch(src, { cache: "force-cache" })
  if (!res.ok) throw new Error("Failed to load brand logo")
  const blob = await res.blob()
  return await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result)
      else reject(new Error("Logo encode failed"))
    }
    reader.onerror = () => reject(new Error("Logo encode failed"))
    reader.readAsDataURL(blob)
  })
}

export function BrandedQrGenerator({
  initialValue = "",
  className,
}: {
  initialValue?: string
  className?: string
}) {
  const [value, setValue] = useState(initialValue)
  const [size, setSize] = useState(480)
  const [svg, setSvg] = useState<string | null>(null)
  const [encodedValue, setEncodedValue] = useState("")
  const [emptyError, setEmptyError] = useState<string | null>(null)
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null)
  const [brandLogoDataUrl, setBrandLogoDataUrl] = useState<string | null>(null)
  const [customLogo, setCustomLogo] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [validation, setValidation] = useState<ScanValidation>({ status: "idle" })

  useEffect(() => {
    let cancelled = false
    fetchAsDataUrl(DEFAULT_BRANDED_LOGO_SRC)
      .then((data) => {
        if (!cancelled) setBrandLogoDataUrl(data)
      })
      .catch(() => {
        /* preview still works with path in browser; export may need data URL */
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    setValue(initialValue)
  }, [initialValue])

  const longWarning = useMemo(() => {
    const len = value.trim().length
    if (len > MAX_SAFE_PAYLOAD_CHARS) {
      return `Input is ${len} characters — long payloads may fail with the center logo. Prefer a short URL.`
    }
    return null
  }, [value])

  const effectiveLogo = customLogo && logoDataUrl ? logoDataUrl : brandLogoDataUrl || DEFAULT_BRANDED_LOGO_SRC

  const runGenerate = useCallback(async () => {
    const trimmed = value.trim()
    if (!trimmed) {
      setEmptyError("Enter a URL or text value to generate a QR code.")
      setSvg(null)
      setValidation({ status: "idle" })
      return
    }
    setEmptyError(null)
    setGenerating(true)
    setValidation({ status: "checking" })
    try {
      const result = buildBrandedQrSvg({
        value: trimmed,
        size,
        logoSrc: DEFAULT_BRANDED_LOGO_SRC,
        logoDataUrl: typeof effectiveLogo === "string" && effectiveLogo.startsWith("data:") ? effectiveLogo : brandLogoDataUrl,
      })
      setSvg(result.svg)
      setEncodedValue(result.encodedValue)
      const check = await validateBrandedQrSvg(result.svg, result.encodedValue, Math.min(720, Math.max(480, size)))
      setValidation(check)
      if (check.status === "ok") {
        toast.success("QR verified and scannable")
      } else if (check.status === "fail" || check.status === "mismatch") {
        toast.warning("QR generated, but scan validation failed — review before printing")
      }
    } catch (err) {
      setSvg(null)
      setValidation({
        status: "fail",
        message: err instanceof Error ? err.message : "Generation failed",
      })
      toast.error("Could not generate QR")
    } finally {
      setGenerating(false)
    }
  }, [value, size, effectiveLogo, brandLogoDataUrl])

  const handleReset = () => {
    setValue(initialValue)
    setSize(480)
    setSvg(null)
    setEncodedValue("")
    setEmptyError(null)
    setLogoDataUrl(null)
    setCustomLogo(false)
    setValidation({ status: "idle" })
  }

  const handleDownloadPng = async () => {
    if (!svg) return
    if (validation.status === "fail" || validation.status === "mismatch") {
      const ok = window.confirm(
        "This QR failed scan validation. Download anyway? Test with a phone before printing."
      )
      if (!ok) return
    }
    try {
      const blob = await svgToPngBlob(svg, size)
      downloadBlob(blob, `infusions-jaba-qr-${size}.png`)
      toast.success("PNG downloaded")
    } catch {
      toast.error("PNG export failed")
    }
  }

  const handleDownloadSvg = () => {
    if (!svg) return
    if (validation.status === "fail" || validation.status === "mismatch") {
      const ok = window.confirm(
        "This QR failed scan validation. Download anyway? Test with a phone before printing."
      )
      if (!ok) return
    }
    downloadSvg(svg, `infusions-jaba-qr-${size}.svg`)
    toast.success("SVG downloaded")
  }

  return (
    <div className={className}>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(280px,420px)] lg:items-start">
        <div className="order-2 lg:order-1 space-y-4 rounded-2xl border border-[#E7E7E7] bg-white p-4 sm:p-5 shadow-sm">
          <div>
            <h3 className="text-base font-semibold text-[#0f172a]">Branded QR generator</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Real ECC-H QR with Infusion&apos;s Jaba green modules, orange finder centers, logo badge, ring, and
              leaf.
            </p>
          </div>
          <QrControls
            value={value}
            onValueChange={(v) => {
              setValue(v)
              if (emptyError) setEmptyError(null)
            }}
            size={size}
            onSizeChange={setSize}
            onGenerate={runGenerate}
            onReset={handleReset}
            generating={generating}
            emptyError={emptyError}
            longWarning={longWarning}
            customLogo={customLogo}
            onLogoDataUrl={(dataUrl) => {
              setLogoDataUrl(dataUrl)
              setCustomLogo(Boolean(dataUrl))
            }}
            onClearLogo={() => {
              setLogoDataUrl(null)
              setCustomLogo(false)
            }}
          />
          <DownloadButtons
            onDownloadPng={handleDownloadPng}
            onDownloadSvg={handleDownloadSvg}
            disabled={!svg}
            validation={validation}
          />
          <ScanValidationStatus validation={validation} />
          {encodedValue ? (
            <p className="text-[11px] text-muted-foreground break-all">
              Encoded value: <span className="font-mono text-foreground">{encodedValue}</span>
            </p>
          ) : null}
        </div>

        <div className="order-1 lg:order-2 lg:sticky lg:top-4">
          <QrPreview svg={svg} />
          <p className="text-center text-[11px] text-muted-foreground mt-3">
            Quiet zone preserved · decorations outside matrix · logo ≤ 16% width
          </p>
        </div>
      </div>
    </div>
  )
}
