import { describe, expect, it } from "vitest"
import { buildBrandedQrSvg, generateQrMatrix, QUIET_ZONE_MODULES } from "@/lib/branded-qr"

describe("branded QR matrix", () => {
  it("encodes the original input value into a real matrix", () => {
    const value = "https://www.infusionjaba.co.ke/menu?t=2"
    const matrix = generateQrMatrix(value)
    expect(matrix.size).toBeGreaterThan(20)
    // Finder corners are dark
    expect(matrix.get(0, 0)).toBe(true)
    expect(matrix.get(0, matrix.size - 1)).toBe(true)
  })

  it("builds SVG with quiet zone and green modules", () => {
    const value = "https://www.infusionjaba.co.ke/menu?t=1"
    const result = buildBrandedQrSvg({
      value,
      size: 480,
      logoSrc: "/branding/infusions-jaba-logo.png",
      logoDataUrl: null,
    })
    expect(result.encodedValue).toBe(value)
    expect(result.quietZonePx).toBeGreaterThan(0)
    expect(result.modulePx * QUIET_ZONE_MODULES).toBeCloseTo(result.quietZonePx, 5)
    expect(result.svg).toContain("#2F8F3A")
    expect(result.svg).toContain("#F27A21")
    expect(result.svg).toContain("qr-modules")
    expect(result.svg).toContain("logo-badge")
  })

  it("rejects empty values", () => {
    expect(() => generateQrMatrix("   ")).toThrow(/empty/i)
  })
})
