import {
  BRANDED_QR_COLORS,
  CANVAS_SIZE,
  FRAME_CX,
  FRAME_CY,
  FRAME_RADIUS,
  FRAME_STROKE,
  FRAME_STROKE_NARROW,
  LOGO_BADGE_FRACTION,
  QR_SIZE,
  QR_X,
  QR_Y,
  QUIET_ZONE_MODULES,
} from "./constants"
import { finderOrigins, generateQrMatrix, isInFinderPattern, type QrMatrix } from "./matrix"

export type BrandedQrSvgOptions = {
  value: string
  /** Pixel size of the exported SVG (viewBox stays 600×600). */
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
  matrixOriginX: number
  matrixOriginY: number
  matrixPx: number
  encodedValue: string
  /** Outer edge of quiet zone (matrix + 4-module border). */
  quietOuterX: number
  quietOuterY: number
  quietOuterSize: number
  ringRadius: number
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

function polar(cx: number, cy: number, deg: number, radius: number) {
  const rad = ((deg - 90) * Math.PI) / 180
  return {
    x: cx + radius * Math.cos(rad),
    y: cy + radius * Math.sin(rad),
  }
}

/** SVG arc path from startDeg → endDeg (degrees, 0 = top, clockwise). */
function arcPath(
  cx: number,
  cy: number,
  radius: number,
  startDeg: number,
  endDeg: number
): string {
  let sweep = endDeg - startDeg
  while (sweep < 0) sweep += 360
  while (sweep > 360) sweep -= 360
  const start = polar(cx, cy, startDeg, radius)
  const end = polar(cx, cy, endDeg, radius)
  const largeArc = sweep > 180 ? 1 : 0
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${radius.toFixed(2)} ${radius.toFixed(2)} 0 ${largeArc} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`
}

export function drawFinderPattern(
  x: number,
  y: number,
  modulePx: number,
  green: string,
  orange: string
): string {
  const outerSize = 7 * modulePx
  const middleSize = 5 * modulePx
  const innerSize = 3 * modulePx
  const outerRadius = modulePx * 1.1
  const middleRadius = modulePx * 0.7
  const innerRadius = modulePx * 0.55
  const midInset = (outerSize - middleSize) / 2
  const innerInset = (outerSize - innerSize) / 2
  return [
    `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${outerSize.toFixed(2)}" height="${outerSize.toFixed(2)}" rx="${outerRadius.toFixed(2)}" ry="${outerRadius.toFixed(2)}" fill="${green}"/>`,
    `<rect x="${(x + midInset).toFixed(2)}" y="${(y + midInset).toFixed(2)}" width="${middleSize.toFixed(2)}" height="${middleSize.toFixed(2)}" rx="${middleRadius.toFixed(2)}" ry="${middleRadius.toFixed(2)}" fill="#FFFFFF"/>`,
    `<rect x="${(x + innerInset).toFixed(2)}" y="${(y + innerInset).toFixed(2)}" width="${innerSize.toFixed(2)}" height="${innerSize.toFixed(2)}" rx="${innerRadius.toFixed(2)}" ry="${innerRadius.toFixed(2)}" fill="${orange}"/>`,
  ].join("")
}

export function drawQrModules(
  matrix: QrMatrix,
  matrixOriginX: number,
  matrixOriginY: number,
  modulePx: number,
  green: string
): string {
  const { size: n } = matrix
  const roundR = modulePx * 0.18
  const parts: string[] = []

  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!matrix.get(r, c)) continue
      if (isInFinderPattern(r, c, n)) continue
      const x = matrixOriginX + c * modulePx
      const y = matrixOriginY + r * modulePx
      const inset = modulePx * 0.015
      parts.push(
        `<rect x="${(x + inset).toFixed(2)}" y="${(y + inset).toFixed(2)}" width="${(modulePx - inset * 2).toFixed(2)}" height="${(modulePx - inset * 2).toFixed(2)}" rx="${roundR.toFixed(2)}" ry="${roundR.toFixed(2)}" fill="${green}"/>`
      )
    }
  }

  return parts.join("")
}

/**
 * Broken circular frame — separate arcs with intentional openings
 * (lower-left for orange dots, lower-right for leaf, gap near top-right).
 */
export function drawCircularFrame(
  cx: number,
  cy: number,
  radius: number,
  green: string
): string {
  // Heavy arc: after orange-dot gap → left side → near top-center
  const mainLeft = arcPath(cx, cy, radius, 236, 352)
  // Bottom arc: leaf base → bottom → just before orange dots
  const bottom = arcPath(cx, cy, radius, 145, 190)
  // Narrow right-side arc (thinner stroke), above leaf toward upper-right
  const right = arcPath(cx, cy, radius, 52, 105)

  return [
    `<g id="circular-frame" fill="none" stroke="${green}" stroke-linecap="round" stroke-linejoin="round">`,
    `<path d="${mainLeft}" stroke-width="${FRAME_STROKE}"/>`,
    `<path d="${bottom}" stroke-width="${FRAME_STROKE}"/>`,
    `<path d="${right}" stroke-width="${FRAME_STROKE_NARROW}"/>`,
    `</g>`,
  ].join("")
}

export function drawOrangeDots(cx: number, cy: number, radius: number, orange: string): string {
  // Slightly outside the frame stroke so they sit in the lower-left gap
  // without entering the quiet-zone square. Largest → smallest along the curve.
  const dotRadius = radius + 20
  const specs = [
    { deg: 214, r: 7 },
    { deg: 206, r: 6 },
    { deg: 198, r: 5 },
  ]
  return specs
    .map(({ deg, r }) => {
      const p = polar(cx, cy, deg, dotRadius)
      return `<circle cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="${r}" fill="${orange}"/>`
    })
    .join("")
}

/**
 * Broad pointed leaf attached to lower-right frame (not a circle/ellipse).
 */
export function drawLeaf(green: string): string {
  return [
    `<g id="leaf-flourish" transform="translate(390 435) rotate(-25)" aria-hidden="true">`,
    `<path d="M0 78C28 20 92 -5 158 0C143 54 99 91 42 96C23 97 9 90 0 78Z" fill="${green}"/>`,
    `<path d="M24 79C61 58 99 34 139 11" fill="none" stroke="#FFFFFF" stroke-width="5" stroke-linecap="round"/>`,
    `</g>`,
  ].join("")
}

export function drawCenterLogoBadge(
  badgeCx: number,
  badgeCy: number,
  badgeDiameter: number,
  logoHref: string,
  green: string,
  bg: string
): string {
  const badgeR = badgeDiameter / 2
  // Logo occupies ~75% of badge diameter
  const logoSize = badgeDiameter * 0.75
  return [
    `<g id="logo-badge">`,
    `<circle cx="${badgeCx.toFixed(2)}" cy="${badgeCy.toFixed(2)}" r="${badgeR.toFixed(2)}" fill="${bg}" stroke="${green}" stroke-width="3"/>`,
    `<image href="${logoHref}" xlink:href="${logoHref}" x="${(badgeCx - logoSize / 2).toFixed(2)}" y="${(badgeCy - logoSize / 2).toFixed(2)}" width="${logoSize.toFixed(2)}" height="${logoSize.toFixed(2)}" preserveAspectRatio="xMidYMid meet"/>`,
    `</g>`,
  ].join("")
}

/**
 * Build a scannable branded SVG emblem from a real QR matrix (ECC H).
 * Layout uses a fixed 600×600 design coordinate system matching the reference.
 */
export function buildBrandedQrSvg(options: BrandedQrSvgOptions): BrandedQrSvgResult {
  const value = options.value.trim()
  const matrix: QrMatrix = generateQrMatrix(value)
  const { size: n } = matrix

  const view = CANVAS_SIZE
  const exportSize = Math.max(320, options.size)

  const matrixOriginX = QR_X
  const matrixOriginY = QR_Y
  const matrixPx = QR_SIZE
  const modulePx = matrixPx / n
  const quietZonePx = QUIET_ZONE_MODULES * modulePx
  const quietOuterX = matrixOriginX - quietZonePx
  const quietOuterY = matrixOriginY - quietZonePx
  const quietOuterSize = matrixPx + quietZonePx * 2

  const green = BRANDED_QR_COLORS.primaryGreen
  const orange = BRANDED_QR_COLORS.orange
  const bg = BRANDED_QR_COLORS.background

  const moduleRects = drawQrModules(matrix, matrixOriginX, matrixOriginY, modulePx, green)

  const finders = finderOrigins(n)
    .map(({ row, col }) =>
      drawFinderPattern(
        matrixOriginX + col * modulePx,
        matrixOriginY + row * modulePx,
        modulePx,
        green,
        orange
      )
    )
    .join("")

  const badgeFraction = Math.min(0.2, Math.max(0.18, LOGO_BADGE_FRACTION))
  const badgeD = matrixPx * badgeFraction
  const badgeCx = matrixOriginX + matrixPx / 2
  const badgeCy = matrixOriginY + matrixPx / 2
  const logoHref = esc(options.logoDataUrl || options.logoSrc)

  const ringGroup = drawCircularFrame(FRAME_CX, FRAME_CY, FRAME_RADIUS, green)
  const dots = drawOrangeDots(FRAME_CX, FRAME_CY, FRAME_RADIUS, orange)
  const leaf = drawLeaf(green)
  const logoBadge = drawCenterLogoBadge(badgeCx, badgeCy, badgeD, logoHref, green, bg)

  // Draw order: decorations BEHIND QR → quiet zone → modules → finders → logo
  const svg = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${exportSize}" height="${exportSize}" viewBox="0 0 ${view} ${view}" role="img" aria-label="Branded QR code" style="width:100%;height:auto;aspect-ratio:1/1;max-width:600px;display:block;margin:0 auto">`,
    `<title>Infusion's Jaba QR</title>`,
    `<rect width="100%" height="100%" fill="${bg}"/>`,
    ringGroup,
    `<g id="orange-dots">${dots}</g>`,
    leaf,
    `<rect id="quiet-zone" x="${quietOuterX.toFixed(2)}" y="${quietOuterY.toFixed(2)}" width="${quietOuterSize.toFixed(2)}" height="${quietOuterSize.toFixed(2)}" fill="${bg}"/>`,
    `<g id="qr-modules">${moduleRects}</g>`,
    `<g id="qr-finders">${finders}</g>`,
    logoBadge,
    `</svg>`,
  ].join("")

  return {
    svg,
    matrixSize: n,
    modulePx,
    quietZonePx,
    matrixOrigin: matrixOriginX,
    matrixOriginX,
    matrixOriginY,
    matrixPx,
    encodedValue: value,
    quietOuterX,
    quietOuterY,
    quietOuterSize,
    ringRadius: FRAME_RADIUS,
  }
}
