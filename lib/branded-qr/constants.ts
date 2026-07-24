/** Infusion’s Jaba branded QR palette (matches logo + emblem reference). */
export const BRANDED_QR_COLORS = {
  primaryGreen: "#2F8F3A",
  darkGreen: "#237530",
  orange: "#F27A21",
  background: "#FFFFFF",
  lightBorder: "#E7E7E7",
} as const

export const DEFAULT_BRANDED_LOGO_SRC = "/branding/infusions-jaba-logo.png"

/** Quiet zone in modules (QR spec minimum is 4). */
export const QUIET_ZONE_MODULES = 4

/** Center logo badge diameter as fraction of matrix width (≤ ~18%). */
export const LOGO_BADGE_FRACTION = 0.16

export const MAX_SAFE_PAYLOAD_CHARS = 800
