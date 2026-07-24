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
  /** Outer edge of quiet zone (matrix + 4-module border). */
  quietOuter: number
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

/**
 * Organic leaf (viewBox 0 0 100 60) — NOT a circle/ellipse.
 * White vein for brand detail.
 */
function leafGroup(cx: number, cy: number, width: number, rotationDeg: number): string {
  const height = width * (45 / 74)
  // Nested SVG keeps the leaf path aspect ratio (100×60) — never a circle.
  return [
    `<g id="leaf-flourish" transform="translate(${cx.toFixed(2)} ${cy.toFixed(2)}) rotate(${rotationDeg})" aria-hidden="true">`,
    `<svg xmlns="http://www.w3.org/2000/svg" x="${(-width / 2).toFixed(2)}" y="${(-height / 2).toFixed(2)}" width="${width.toFixed(2)}" height="${height.toFixed(2)}" viewBox="0 0 100 60" overflow="visible">`,
    `<path d="M4 48C20 15 58 2 95 5C84 34 58 55 25 57C15 57 8 54 4 48Z" fill="${BRANDED_QR_COLORS.primaryGreen}"/>`,
    `<path d="M18 49C40 36 61 23 84 11" fill="none" stroke="#FFFFFF" stroke-width="4" stroke-linecap="round"/>`,
    `</svg>`,
    `</g>`,
  ].join("")
}

function drawFinder(
  x: number,
  y: number,
  modulePx: number,
  green: string,
  orange: string
): string {
  const outer = 7 * modulePx
  // ~22% of outer edge length → consistent rounded squares (not pills)
  const outerR = outer * 0.18
  const midInset = modulePx
  const mid = outer - midInset * 2
  const midR = mid * 0.16
  const innerInset = modulePx * 2
  const inner = outer - innerInset * 2
  const innerR = inner * 0.18
  return [
    `<rect x="${x}" y="${y}" width="${outer}" height="${outer}" rx="${outerR}" ry="${outerR}" fill="${green}"/>`,
    `<rect x="${x + midInset}" y="${y + midInset}" width="${mid}" height="${mid}" rx="${midR}" ry="${midR}" fill="#FFFFFF"/>`,
    `<rect x="${x + innerInset}" y="${y + innerInset}" width="${inner}" height="${inner}" rx="${innerR}" ry="${innerR}" fill="${orange}"/>`,
  ].join("")
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

/**
 * Build a scannable branded SVG emblem from a real QR matrix (ECC H).
 * Decorations sit outside the quiet zone and are drawn behind the matrix.
 */
export function buildBrandedQrSvg(options: BrandedQrSvgOptions): BrandedQrSvgResult {
  const value = options.value.trim()
  const matrix: QrMatrix = generateQrMatrix(value)
  const { size: n } = matrix

  const view = Math.max(320, options.size)

  // Layout: generous frame clearance so ring never enters quiet zone
  const outerPad = view * 0.05
  const ringStroke = Math.max(3.5, Math.min(5, view * 0.009)) // ~4px at typical sizes
  // Extra air between quiet-zone edge and inner side of stroke
  const frameClearance = Math.max(view * 0.055, ringStroke * 3.5)

  const modulesWithQuiet = n + QUIET_ZONE_MODULES * 2
  // Remaining budget for quiet+matrix after pads / stroke / clearance
  const usable =
    view - outerPad * 2 - ringStroke * 2 - frameClearance * 2
  const modulePx = usable / modulesWithQuiet
  const quietZonePx = QUIET_ZONE_MODULES * modulePx
  const matrixPx = n * modulePx
  const matrixOrigin = outerPad + ringStroke + frameClearance + quietZonePx

  const green = BRANDED_QR_COLORS.primaryGreen
  const orange = BRANDED_QR_COLORS.orange
  const bg = BRANDED_QR_COLORS.background

  // Rounded squares: 22% corner radius — not circles (circles need ~50%)
  const roundR = modulePx * 0.22
  const moduleRects: string[] = []

  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!matrix.get(r, c)) continue
      if (isInFinderPattern(r, c, n)) continue
      const x = matrixOrigin + c * modulePx
      const y = matrixOrigin + r * modulePx
      // Minimal gap so the QR reads as a continuous grid
      const inset = modulePx * 0.02
      moduleRects.push(
        `<rect x="${(x + inset).toFixed(2)}" y="${(y + inset).toFixed(2)}" width="${(modulePx - inset * 2).toFixed(2)}" height="${(modulePx - inset * 2).toFixed(2)}" rx="${roundR.toFixed(2)}" ry="${roundR.toFixed(2)}" fill="${green}"/>`
      )
    }
  }

  const finders = finderOrigins(n)
    .map(({ row, col }) =>
      drawFinder(
        matrixOrigin + col * modulePx,
        matrixOrigin + row * modulePx,
        modulePx,
        green,
        orange
      )
    )
    .join("")

  // Center badge ~16.5% of matrix (cap 17%, never >18%)
  const badgeFraction = Math.min(0.17, Math.max(0.15, LOGO_BADGE_FRACTION))
  const badgeD = matrixPx * badgeFraction
  const badgeCx = matrixOrigin + matrixPx / 2
  const badgeCy = matrixOrigin + matrixPx / 2
  const badgeR = badgeD / 2
  const logoPad = badgeR * 0.14
  const logoSize = (badgeR - logoPad) * 2
  const logoHref = esc(options.logoDataUrl || options.logoSrc)

  const centerX = view / 2
  const centerY = view / 2
  const quietOuter = matrixOrigin - quietZonePx
  const quietOuterSize = matrixPx + quietZonePx * 2

  // Ring centered on QR; radius clears quiet zone + frameClearance
  const ringR = quietOuterSize / 2 + frameClearance + ringStroke / 2

  // Separate arcs with intentional gaps (top-right + lower-left / leaf join)
  // Gap near top-right (~35–70°) and near lower-left (~200–235°) + leaf (~115–155°)
  const ringArcs = [
    arcPath(centerX, centerY, ringR, 72, 112), // right → toward leaf
    arcPath(centerX, centerY, ringR, 158, 198), // after leaf → lower
    arcPath(centerX, centerY, ringR, 238, 350), // after dots → top-left → almost top-right
    arcPath(centerX, centerY, ringR, 5, 28), // small arc near top
  ]

  const ringGroup = [
    `<g id="circular-frame" fill="none" stroke="${green}" stroke-width="${ringStroke.toFixed(2)}" stroke-linecap="round">`,
    ...ringArcs.map((d) => `<path d="${d}"/>`),
    `</g>`,
  ].join("")

  // Three orange dots on lower-left arc — decreasing size along the curve
  const dotAngles = [208, 218, 228]
  const dotRadii = [
    Math.max(3.5, view * 0.009),
    Math.max(2.6, view * 0.007),
    Math.max(1.8, view * 0.005),
  ]
  const dots = dotAngles
    .map((deg, i) => {
      const p = polar(centerX, centerY, deg, ringR)
      return `<circle cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="${dotRadii[i].toFixed(2)}" fill="${orange}"/>`
    })
    .join("")

  // Leaf at lower-right, sitting on the ring, outside quiet zone
  const leafAnchor = polar(centerX, centerY, 135, ringR)
  const leafWidth = Math.min(74, Math.max(52, view * 0.155))
  const leaf = leafGroup(leafAnchor.x, leafAnchor.y, leafWidth, -20)

  const logoBadge = [
    `<g id="logo-badge">`,
    `<circle cx="${badgeCx.toFixed(2)}" cy="${badgeCy.toFixed(2)}" r="${(badgeR + 1).toFixed(2)}" fill="${bg}" stroke="${green}" stroke-width="${Math.max(1.5, view * 0.005).toFixed(2)}"/>`,
    `<image href="${logoHref}" xlink:href="${logoHref}" x="${(badgeCx - logoSize / 2).toFixed(2)}" y="${(badgeCy - logoSize / 2).toFixed(2)}" width="${logoSize.toFixed(2)}" height="${logoSize.toFixed(2)}" preserveAspectRatio="xMidYMid meet"/>`,
    `</g>`,
  ].join("")

  // Draw order: decorations BEHIND QR → quiet zone → modules → finders → logo
  const svg = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${view}" height="${view}" viewBox="0 0 ${view} ${view}" role="img" aria-label="Branded QR code">`,
    `<title>Infusion's Jaba QR</title>`,
    `<rect width="100%" height="100%" fill="${bg}"/>`,
    // Decorations first (behind)
    ringGroup,
    `<g id="orange-dots">${dots}</g>`,
    leaf,
    // Quiet zone + QR on top — never covered by decorations
    `<rect id="quiet-zone" x="${quietOuter.toFixed(2)}" y="${quietOuter.toFixed(2)}" width="${quietOuterSize.toFixed(2)}" height="${quietOuterSize.toFixed(2)}" fill="${bg}"/>`,
    `<g id="qr-modules">${moduleRects.join("")}</g>`,
    `<g id="qr-finders">${finders}</g>`,
    logoBadge,
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
    quietOuter,
    quietOuterSize,
    ringRadius: ringR,
  }
}
