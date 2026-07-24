import jsQR from "jsqr"

export type ScanValidation =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "ok"; decoded: string; pngOk: boolean; svgOk: boolean }
  | { status: "mismatch"; decoded: string; expected: string }
  | { status: "fail"; message: string }

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error("Failed to rasterize SVG for validation"))
    img.src = src
  })
}

async function decodeImageData(
  imageData: ImageData
): Promise<string | null> {
  const code = jsQR(imageData.data, imageData.width, imageData.height, {
    inversionAttempts: "dontInvert",
  })
  return code?.data ?? null
}

async function rasterizeSvgToImageData(svg: string, rasterSize: number): Promise<ImageData> {
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  try {
    const img = await loadImage(url)
    const canvas = document.createElement("canvas")
    canvas.width = rasterSize
    canvas.height = rasterSize
    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error("Canvas unavailable")
    ctx.fillStyle = "#FFFFFF"
    ctx.fillRect(0, 0, rasterSize, rasterSize)
    ctx.drawImage(img, 0, 0, rasterSize, rasterSize)
    return ctx.getImageData(0, 0, rasterSize, rasterSize)
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function decodePngBlob(png: Blob, rasterSize: number): Promise<string | null> {
  const url = URL.createObjectURL(png)
  try {
    const img = await loadImage(url)
    const canvas = document.createElement("canvas")
    canvas.width = rasterSize
    canvas.height = rasterSize
    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error("Canvas unavailable")
    ctx.fillStyle = "#FFFFFF"
    ctx.fillRect(0, 0, rasterSize, rasterSize)
    ctx.drawImage(img, 0, 0, rasterSize, rasterSize)
    return decodeImageData(ctx.getImageData(0, 0, rasterSize, rasterSize))
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Validate the decorated branded QR by decoding both:
 * 1) SVG rasterized to canvas
 * 2) PNG export of the same SVG
 */
export async function validateRenderedQr(
  svg: string,
  expectedValue: string,
  rasterSize = 512
): Promise<ScanValidation> {
  if (typeof window === "undefined") {
    return { status: "fail", message: "Validation requires a browser" }
  }

  try {
    const svgImageData = await rasterizeSvgToImageData(svg, rasterSize)
    const svgDecoded = await decodeImageData(svgImageData)

    const pngBlob = await svgToPngBlob(svg, rasterSize)
    const pngDecoded = await decodePngBlob(pngBlob, rasterSize)

    const expected = expectedValue.trim()
    const svgOk = Boolean(svgDecoded && svgDecoded.trim() === expected)
    const pngOk = Boolean(pngDecoded && pngDecoded.trim() === expected)

    if (!svgDecoded && !pngDecoded) {
      return {
        status: "fail",
        message: "Could not decode QR — try a shorter URL or larger size",
      }
    }

    const decoded = (svgDecoded ?? pngDecoded)!.trim()
    if (decoded !== expected) {
      return { status: "mismatch", decoded, expected: expectedValue }
    }

    if (!svgOk || !pngOk) {
      return {
        status: "fail",
        message: `Partial decode — SVG ${svgOk ? "ok" : "fail"}, PNG ${pngOk ? "ok" : "fail"}`,
      }
    }

    return { status: "ok", decoded, pngOk, svgOk }
  } catch (err) {
    return {
      status: "fail",
      message: err instanceof Error ? err.message : "Validation failed",
    }
  }
}

/** @deprecated Prefer validateRenderedQr — kept for existing call sites. */
export async function validateBrandedQrSvg(
  svg: string,
  expectedValue: string,
  rasterSize = 512
): Promise<ScanValidation> {
  return validateRenderedQr(svg, expectedValue, rasterSize)
}

export async function exportSvg(svg: string, filename: string) {
  downloadSvg(svg, filename)
}

export async function exportPng(svg: string, size: number, filename: string) {
  const blob = await svgToPngBlob(svg, size)
  downloadBlob(blob, filename)
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
