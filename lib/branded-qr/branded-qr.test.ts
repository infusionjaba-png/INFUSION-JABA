import { describe, expect, it } from "vitest"
import {
  BRANDED_QR_COLORS,
  buildBrandedQrSvg,
  CANVAS_SIZE,
  FRAME_RADIUS,
  FRAME_STROKE,
  generateQrMatrix,
  QR_SIZE,
  QR_X,
  QR_Y,
  QUIET_ZONE_MODULES,
} from "@/lib/branded-qr"

describe("branded QR matrix", () => {
  it("encodes the original input value into a real matrix", () => {
    const value = "https://www.infusionjaba.co.ke/menu?t=2"
    const matrix = generateQrMatrix(value)
    expect(matrix.size).toBeGreaterThan(20)
    expect(matrix.get(0, 0)).toBe(true)
    expect(matrix.get(0, matrix.size - 1)).toBe(true)
  })

  it("builds SVG matching the reference composition constants", () => {
    const value = "https://www.infusionjaba.co.ke/menu?t=1"
    const result = buildBrandedQrSvg({
      value,
      size: 600,
      logoSrc: "/branding/infusions-jaba-logo.png",
      logoDataUrl: null,
    })
    expect(result.encodedValue).toBe(value)
    expect(result.matrixPx).toBe(QR_SIZE)
    expect(result.matrixOriginX).toBe(QR_X)
    expect(result.matrixOriginY).toBe(QR_Y)
    expect(result.quietZonePx).toBeGreaterThan(0)
    expect(result.modulePx * QUIET_ZONE_MODULES).toBeCloseTo(result.quietZonePx, 5)

    // Frame stays outside quiet zone
    const quietHalf = result.quietOuterSize / 2
    expect(result.ringRadius).toBe(FRAME_RADIUS)
    expect(result.ringRadius - FRAME_STROKE / 2).toBeGreaterThan(quietHalf)

    expect(result.svg).toContain(`viewBox="0 0 ${CANVAS_SIZE} ${CANVAS_SIZE}"`)
    expect(result.svg).toContain(BRANDED_QR_COLORS.primaryGreen)
    expect(result.svg).toContain(BRANDED_QR_COLORS.orange)
    expect(result.svg).toContain("#338F3A")
    expect(result.svg).toContain("#F1842D")
    expect(result.svg).toContain("qr-modules")
    expect(result.svg).toContain("logo-badge")
    expect(result.svg).toContain("leaf-flourish")
    expect(result.svg).toContain("M0 78C26 18 90 -8 160 2")
    expect(result.svg).toContain("circular-frame")
    expect(result.svg).toContain("orange-dots")
    expect(result.svg).toMatch(/rx="[0-9.]+"/)

    const leafChunk =
      result.svg.match(/id="leaf-flourish"[\s\S]*?<\/g>/)?.[0] ?? ""
    expect(leafChunk).toBeTruthy()
    expect(leafChunk).toContain("M0 78C26 18 90 -8 160 2")
    expect(leafChunk).toContain('stroke="#FFFFFF"')
    expect(leafChunk).not.toContain("<circle")

    // Exactly three orange decorative dots
    const orangeDots = result.svg.match(/id="orange-dots"[\s\S]*?<\/g>/)?.[0] ?? ""
    expect((orangeDots.match(/<circle/g) ?? []).length).toBe(3)

    // Badge ≤ 20% of QR width
    expect(result.svg).toMatch(/stroke-width="3"/)
  })

  it("rejects empty values", () => {
    expect(() => generateQrMatrix("   ")).toThrow(/empty/i)
  })
})
