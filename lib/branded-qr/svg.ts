import {
  BRANDED_QR_COLORS,
  LOGO_BADGE_FRACTION,
  QUIET_ZONE_MODULES,
} from "./constants"
import { finderOrigins, generateQrMatrix, isInFinderPattern, type QrMatrix } from "./matrix"

export type BrandedQrSvgOptions = {
  value: string
  /** Pixel size of the full emblem (including ring). */
  size: number
  /** Absolute or same-origin URL for center logo. */
  logoSrc: string
  /** Optional data URL override (uploaded logo). */
  logoDataUrl?: string | null
}

export type BrandedQrSvgResult = {
  svg: string
  matrixSize: number
  modulePx: number
  quietZonePx: number
  matrixOrigin: number
  matrixPx: number
  encodedValue: string
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

function leafPath(cx: number, cy: number, scale: number): string {
  // Organic leaf pointing up-left from lower-right of the ring
  const s = scale
  return [
    `M ${cx} ${cy}`,
    `c ${-0.35 * s} ${-0.15 * s}, ${-0.75 * s} ${-0.55 * s}, ${-0.55 * s} ${-1.15 * s}`,
    `c ${0.15 * s} ${-0.45 * s}, ${0.55 * s} ${-0.75 * s}, ${1.05 * s} ${-0.7 * s}`,
    `c ${0.55 * s} ${0.05 * s}, ${0.85 * s} ${0.55 * s}, ${0.7 * s} ${1.1 * s}`,
    `c ${-0.12 * s} ${0.42 * s}, ${-0.45 * s} ${0.72 * s}, ${-1.2 * s} ${0.75 * s}`,
    "z",
  ].join(" ")
}

function drawFinder(
  x: number,
  y: number,
  modulePx: number,
  green: string,
  orange: string
): string {
  const outer = 7 * modulePx
  const outerR = modulePx * 1.15
  const midInset = modulePx
  const mid = outer - midInset * 2
  const midR = modulePx * 0.85
  const innerInset = modulePx * 2
  const inner = outer - innerInset * 2
  const innerR = modulePx * 0.55
  return [
    `<rect x="${x}" y="${y}" width="${outer}" height="${outer}" rx="${outerR}" ry="${outerR}" fill="${green}"/>`,
    `<rect x="${x + midInset}" y="${y + midInset}" width="${mid}" height="${mid}" rx="${midR}" ry="${midR}" fill="#FFFFFF"/>`,
    `<rect x="${x + innerInset}" y="${y + innerInset}" width="${inner}" height="${inner}" rx="${innerR}" ry="${innerR}" fill="${orange}"/>`,
  ].join("")
}

/**
 * Build a scannable branded SVG emblem from a real QR matrix (ECC H).
 * Decorations sit outside the quiet zone; finders use orange centers only.
 */
export function buildBrandedQrSvg(options: BrandedQrSvgOptions): BrandedQrSvgResult {
  const value = options.value.trim()
  const matrix: QrMatrix = generateQrMatrix(value)
  const { size: n } = matrix

  const view = options.size
  // Emblem layout: outer padding + ring + quiet zone + matrix
  const outerPad = view * 0.06
  const ringStroke = Math.max(2, view * 0.012)
  const ringGap = view * 0.035 // space between ring and quiet zone edge
  const usable = view - outerPad * 2 - ringStroke * 2 - ringGap * 2
  const modulesWithQuiet = n + QUIET_ZONE_MODULES * 2
  const modulePx = usable / modulesWithQuiet
  const quietZonePx = QUIET_ZONE_MODULES * modulePx
  const matrixPx = n * modulePx
  const matrixOrigin = outerPad + ringStroke + ringGap + quietZonePx

  const green = BRANDED_QR_COLORS.primaryGreen
  const darkGreen = BRANDED_QR_COLORS.darkGreen
  const orange = BRANDED_QR_COLORS.orange
  const bg = BRANDED_QR_COLORS.background

  const roundR = modulePx * 0.38
  const moduleRects: string[] = []

  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!matrix.get(r, c)) continue
      if (isInFinderPattern(r, c, n)) continue
      const x = matrixOrigin + c * modulePx
      const y = matrixOrigin + r * modulePx
      // slight inset for rounded look without merging neighbors too hard
      const inset = modulePx * 0.06
      moduleRects.push(
        `<rect x="${x + inset}" y="${y + inset}" width="${modulePx - inset * 2}" height="${modulePx - inset * 2}" rx="${roundR}" ry="${roundR}" fill="${green}"/>`
      )
    }
  }

  const finders = finderOrigins(n)
    .map(({ row, col }) =>
      drawFinder(matrixOrigin + col * modulePx, matrixOrigin + row * modulePx, modulePx, green, orange)
    )
    .join("")

  const badgeD = matrixPx * LOGO_BADGE_FRACTION
  const badgeCx = matrixOrigin + matrixPx / 2
  const badgeCy = matrixOrigin + matrixPx / 2
  const badgeR = badgeD / 2
  const logoPad = badgeR * 0.22
  const logoSize = (badgeR - logoPad) * 2
  const logoHref = esc(options.logoDataUrl || options.logoSrc)

  const centerX = view / 2
  const centerY = view / 2
  const quietOuter = matrixOrigin - quietZonePx
  const quietOuterSize = matrixPx + quietZonePx * 2
  // Ring sits outside quiet zone
  const ringR = quietOuterSize / 2 + ringGap + ringStroke / 2
  // Leave a gap at bottom-right for the leaf join
  const ringStart = -20
  const ringSweep = 290

  const polar = (deg: number, radius: number) => {
    const rad = ((deg - 90) * Math.PI) / 180
    return {
      x: centerX + radius * Math.cos(rad),
      y: centerY + radius * Math.sin(rad),
    }
  }
  const start = polar(ringStart, ringR)
  const end = polar(ringStart + ringSweep, ringR)
  const largeArc = ringSweep > 180 ? 1 : 0
  const ringPath = `M ${start.x} ${start.y} A ${ringR} ${ringR} 0 ${largeArc} 1 ${end.x} ${end.y}`

  // Orange dots on lower-left of ring (~210–235°)
  const dots = [208, 220, 232].map((deg, i) => {
    const p = polar(deg, ringR)
    const rr = Math.max(2, view * 0.006) + i * Math.max(1.2, view * 0.003)
    return `<circle cx="${p.x}" cy="${p.y}" r="${rr}" fill="${orange}"/>`
  })

  // Leaf flourish lower-right (~135°)
  const leafAnchor = polar(138, ringR * 0.98)
  const leaf = `<path d="${leafPath(leafAnchor.x, leafAnchor.y, view * 0.12)}" fill="${darkGreen}"/>`

  const logoBadge = [
    `<circle cx="${badgeCx}" cy="${badgeCy}" r="${badgeR + 1.5}" fill="${bg}" stroke="${green}" stroke-width="${Math.max(1.5, view * 0.006)}"/>`,
    `<image href="${logoHref}" xlink:href="${logoHref}" x="${badgeCx - logoSize / 2}" y="${badgeCy - logoSize / 2}" width="${logoSize}" height="${logoSize}" preserveAspectRatio="xMidYMid meet"/>`,
  ].join("")

  const svg = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${view}" height="${view}" viewBox="0 0 ${view} ${view}" role="img" aria-label="Branded QR code">`,
    `<title>Infusion's Jaba QR</title>`,
    `<rect width="100%" height="100%" fill="${bg}"/>`,
    // Soft outer card edge
    `<rect x="1" y="1" width="${view - 2}" height="${view - 2}" rx="${view * 0.06}" fill="none" stroke="${BRANDED_QR_COLORS.lightBorder}" stroke-width="1"/>`,
    // Quiet zone (explicit white under matrix)
    `<rect x="${quietOuter}" y="${quietOuter}" width="${quietOuterSize}" height="${quietOuterSize}" fill="${bg}"/>`,
    `<g id="qr-modules">${moduleRects.join("")}</g>`,
    `<g id="qr-finders">${finders}</g>`,
    `<g id="logo-badge">${logoBadge}</g>`,
    `<path d="${ringPath}" fill="none" stroke="${green}" stroke-width="${ringStroke}" stroke-linecap="round"/>`,
    leaf,
    dots.join(""),
    `</svg>`,
  ].join("")

  return {
    svg,
    matrixSize: n,
    modulePx,
    quietZonePx,
    matrixOrigin,
    matrixPx,
    encodedValue: value,
  }
}
