/** Infusion’s Jaba branded QR palette (exact reference colors). */
export const BRANDED_QR_COLORS = {
  primaryGreen: "#338F3A",
  orange: "#F1842D",
  background: "#FFFFFF",
  lightBorder: "#E7E7E7",
} as const

export const DEFAULT_BRANDED_LOGO_SRC = "/branding/infusions-jaba-logo.png"

/** Quiet zone in modules (QR spec minimum is 4). */
export const QUIET_ZONE_MODULES = 4

/**
 * Center logo badge diameter as fraction of QR matrix width.
 * Spec: 18–20%; keep ≤20% for scannability.
 */
export const LOGO_BADGE_FRACTION = 0.2

/** Fixed SVG design coordinate system (matches reference composition). */
export const CANVAS_SIZE = 600
export const QR_SIZE = 330
export const QR_X = 135
export const QR_Y = 125
export const FRAME_STROKE = 14
export const FRAME_STROKE_NARROW = 8
/** Ring radius ≈ 40.5% of canvas → diameter ~81% (matches reference). */
export const FRAME_RADIUS = 243
/** Centered on the QR matrix (QR sits slightly above canvas mid). */
export const FRAME_CX = 300
export const FRAME_CY = 290

export const MAX_SAFE_PAYLOAD_CHARS = 800
