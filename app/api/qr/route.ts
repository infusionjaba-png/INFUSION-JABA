import { NextResponse } from "next/server"
import QRCode from "qrcode"
import { JABA_QR_DARK, JABA_QR_LIGHT } from "@/lib/jaba-brand-colors"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const url = searchParams.get("url")?.trim()
  if (!url || url.length > 2048) {
    return NextResponse.json({ error: "Invalid url" }, { status: 400 })
  }

  const sizeRaw = parseInt(searchParams.get("size") || "320", 10)
  const width = Number.isFinite(sizeRaw) ? Math.min(Math.max(sizeRaw, 64), 1024) : 320

  try {
    const buffer = await QRCode.toBuffer(url, {
      type: "png",
      width,
      margin: 2,
      errorCorrectionLevel: "M",
      color: { dark: JABA_QR_DARK, light: JABA_QR_LIGHT },
    })
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      },
    })
  } catch {
    return NextResponse.json({ error: "QR generation failed" }, { status: 500 })
  }
}
