import { NextResponse } from "next/server"
import { getDatabase } from "@/lib/mongodb"
import { checkRateLimit, getClientIp } from "@/lib/rate-limit-simple"
import { confirmMenuPayment } from "@/lib/menu-confirm-payment"

/**
 * Public (customer menu) — finalize paid rounds after M-Pesa success.
 * Marks menu_orders paid, upserts admin orders, sends receipt SMS once.
 */
export async function POST(request: Request) {
  try {
    const ip = getClientIp(request)
    const rl = checkRateLimit(`menu-confirm-payment:${ip}`, 20, 60_000)
    if (!rl.ok) {
      return NextResponse.json(
        { error: "Too many requests", retryAfterMs: rl.retryAfterMs },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } }
      )
    }

    const body = await request.json()
    const orderIds = Array.isArray(body.orderIds)
      ? body.orderIds.map((id: unknown) => String(id || "").trim()).filter(Boolean)
      : body.orderId
        ? [String(body.orderId).trim()]
        : []

    const db = await getDatabase("infusion_jaba")
    const result = await confirmMenuPayment(db, {
      orderIds,
      phone: body.phone ?? body.customerPhone ?? null,
      mpesaReceiptNumber: body.mpesaReceiptNumber ?? null,
      tableNumber: body.tableNumber ?? body.tableId ?? null,
    })

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    return NextResponse.json(result)
  } catch (error: any) {
    console.error("[menu-orders/confirm-payment]", error)
    return NextResponse.json(
      { error: "Failed to confirm payment", message: error?.message },
      { status: 500 }
    )
  }
}
