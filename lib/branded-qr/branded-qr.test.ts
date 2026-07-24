import { describe, expect, it } from "vitest"
import { buildBrandedQrSvg, generateQrMatrix, QUIET_ZONE_MODULES } from "@/lib/branded-qr"

describe("branded QR matrix", () => {
  it("encodes the original input value into a real matrix", () => {
    const value = "https://www.infusionjaba.co.ke/menu?t=2"
    const matrix = generateQrMatrix(value)
    expect(matrix.size).toBeGreaterThan(20)
    expect(matrix.get(0, 0)).toBe(true)
    expect(matrix.get(0, matrix.size - 1)).toBe(true)
  })

  it("builds SVG with quiet zone clearance and leaf path (not a circle)", () => {
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
    // Frame stays outside quiet zone
    const quietHalf = result.quietOuterSize / 2
    expect(result.ringRadius).toBeGreaterThan(quietHalf + 4)
    expect(result.svg).toContain("#2F8F3A")
    expect(result.svg).toContain("#F27A21")
    expect(result.svg).toContain("qr-modules")
    expect(result.svg).toContain("logo-badge")
    expect(result.svg).toContain("leaf-flourish")
    expect(result.svg).toContain("M4 48C20 15 58 2 95 5")
    expect(result.svg).toContain("circular-frame")
    // Modules use rounded rects with ~22% radius, not full circles
    expect(result.svg).toMatch(/rx="[0-9.]+"/)
    const leafChunk = result.svg.match(/id="leaf-flourish"[\s\S]*?<\/g>\s*<\/g>/)?.[0]
      ?? result.svg.match(/<g id="leaf-flourish"[\s\S]*?<\/g>/)?.[0]
    expect(leafChunk).toBeTruthy()
    expect(leafChunk).toContain("M4 48C20 15 58 2 95 5")
    expect(leafChunk).not.toContain("<circle")
  })

  it("rejects empty values", () => {
    expect(() => generateQrMatrix("   ")).toThrow(/empty/i)
  })
})
