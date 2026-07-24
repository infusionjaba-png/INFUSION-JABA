import QRCode from "qrcode"

export type QrMatrix = {
  size: number
  /** true = dark module */
  get: (row: number, col: number) => boolean
}

export function generateQrMatrix(value: string): QrMatrix {
  const text = value.trim()
  if (!text) {
    throw new Error("QR value is empty")
  }
  const qr = QRCode.create(text, { errorCorrectionLevel: "H" })
  const modules = qr.modules
  return {
    size: modules.size,
    get: (row, col) => Boolean(modules.get(row, col)),
  }
}

/** Finder pattern 7×7 regions (top-left, top-right, bottom-left). */
export function isInFinderPattern(row: number, col: number, size: number): boolean {
  const inTL = row < 7 && col < 7
  const inTR = row < 7 && col >= size - 7
  const inBL = row >= size - 7 && col < 7
  return inTL || inTR || inBL
}

export function finderOrigins(size: number): Array<{ row: number; col: number }> {
  return [
    { row: 0, col: 0 },
    { row: 0, col: size - 7 },
    { row: size - 7, col: 0 },
  ]
}
