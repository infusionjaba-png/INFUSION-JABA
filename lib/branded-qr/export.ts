import jsQR from "jsqr"

export type ScanValidation =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "ok"; decoded: string }
  | { status: "mismatch"; decoded: string; expected: string }
  | { status: "fail"; message: string }

/** Rasterize SVG to ImageData via canvas, then decode with jsQR. */
export async function validateBrandedQrSvg(
  svg: string,
  expectedValue: string,
  rasterSize = 512
): Promise<ScanValidation> {
  if (typeof window === "undefined") {
    return { status: "fail", message: "Validation requires a browser" }
  }

  try {
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const img = await loadImage(url)
    URL.revokeObjectURL(url)

    const canvas = document.createElement("canvas")
    canvas.width = rasterSize
    canvas.height = rasterSize
    const ctx = canvas.getContext("2d")
    if (!ctx) return { status: "fail", message: "Canvas unavailable" }

    ctx.fillStyle = "#FFFFFF"
    ctx.fillRect(0, 0, rasterSize, rasterSize)
    ctx.drawImage(img, 0, 0, rasterSize, rasterSize)
    const imageData = ctx.getImageData(0, 0, rasterSize, rasterSize)
    const code = jsQR(imageData.data, imageData.width, imageData.height, {
      inversionAttempts: "dontInvert",
    })

    if (!code?.data) {
      return {
        status: "fail",
        message: "Could not decode QR — try a shorter URL or larger size",
      }
    }
    if (code.data.trim() !== expectedValue.trim()) {
      return { status: "mismatch", decoded: code.data, expected: expectedValue }
    }
    return { status: "ok", decoded: code.data }
  } catch (err) {
    return {
      status: "fail",
      message: err instanceof Error ? err.message : "Validation failed",
    }
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error("Failed to rasterize SVG for validation"))
    img.src = src
  })
}

export async function svgToPngBlob(svg: string, size: number): Promise<Blob> {
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  try {
    const img = await loadImage(url)
    const canvas = document.createElement("canvas")
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error("Canvas unavailable")
    ctx.fillStyle = "#FFFFFF"
    ctx.fillRect(0, 0, size, size)
    ctx.drawImage(img, 0, 0, size, size)
    const out = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("PNG export failed"))),
        "image/png"
      )
    })
    return out
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function downloadBlob(blob: Blob, filename: string) {
  const a = document.createElement("a")
  const url = URL.createObjectURL(blob)
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function downloadSvg(svg: string, filename: string) {
  downloadBlob(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }), filename)
}
