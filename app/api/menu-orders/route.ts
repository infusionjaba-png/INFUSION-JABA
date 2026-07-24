import { NextResponse } from "next/server"
import { getDatabase } from "@/lib/mongodb"
import { pricingForMenuOrderLines, sanitizePublicMenuPaymentFields } from "@/lib/secure-menu-order"
import { checkRateLimit, getClientIp } from "@/lib/rate-limit-simple"
import { logOrderSecurityEvent } from "@/lib/order-security-audit"
import { menuOrderCreateSchema, menuOrderPutSchema, formatZodError } from "@/lib/order-request-schemas"
import { maybeSendOnlineOrderSms } from "@/lib/catha-online-order-sms"

// Public-facing menu orders API used by /menu (QR + phone).
// Writes into the same `menu_orders` collection that Catha staff see via /api/catha/menu-orders.

export async function POST(request: Request) {
  try {
    const ip = getClientIp(request)
    const rl = checkRateLimit(`menu-orders-post:${ip}`, 40, 60_000)
    if (!rl.ok) {
      logOrderSecurityEvent({
        route: "/api/menu-orders",
        action: "POST",
        ip,
        userAgent: request.headers.get("user-agent"),
        rejected: true,
        reason: "rate_limit",
      })
      return NextResponse.json(
        { error: "Too many requests", retryAfterMs: rl.retryAfterMs },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } }
      )
    }

    const raw = await request.json()
    const parsed = menuOrderCreateSchema.safeParse(raw)
    if (!parsed.success) {
      logOrderSecurityEvent({
        route: "/api/menu-orders",
        action: "POST",
        ip,
        userAgent: request.headers.get("user-agent"),
        rejected: true,
        reason: "schema_validation",
        requestSummary: { details: parsed.error.flatten() },
      })
      return NextResponse.json(formatZodError(parsed.error), { status: 400 })
    }
    const body = parsed.data
    const db = await getDatabase("infusion_jaba")
    const orderId = body.orderId.trim()

    const priced = await pricingForMenuOrderLines(db, body.items as unknown[])
    if (!priced.ok) {
      logOrderSecurityEvent({
        route: "/api/menu-orders",
        action: "POST",
        ip,
        userAgent: request.headers.get("user-agent"),
        rejected: true,
        reason: priced.code,
        requestSummary: { orderId, itemCount: body.items.length },
      })
      return NextResponse.json({ error: priced.error, code: priced.code }, { status: 400 })
    }

    const order: Record<string, unknown> = {
      orderId,
      createdAt: new Date(),
      tableId: body.tableId,
      tableNumber: body.tableNumber ?? body.tableId,
      customerNumber: body.customerNumber ?? body.customerPart ?? null,
      guestSessionId: body.guestSessionId ?? null,
      customerPhone: body.customerPhone ?? null,
      status: typeof body.status === "string" ? body.status : "draft",
      paymentStatus: "UNPAID",
      paymentMethod: body.paymentMethod ?? null,
      items: priced.items,
      total: priced.total,
      subtotal: priced.subtotal,
      receivedBy: body.receivedBy,
      cancelledReason: body.cancelledReason,
      updatedAt: new Date(),
    }

    logOrderSecurityEvent({
      route: "/api/menu-orders",
      action: "POST",
      ip,
      userAgent: request.headers.get("user-agent"),
      resolvedDbPrices: priced.dbPricesBySku,
      computedTotals: { subtotal: priced.subtotal, vat: priced.vat, total: priced.total },
      requestSummary: { orderId },
    })

    const existingById = await db.collection("menu_orders").findOne({ orderId })
    if (existingById) {
      return NextResponse.json(existingById, { status: 200 })
    }

    const tenSecondsAgo = new Date(Date.now() - 10_000)
    const itemsFingerprint = JSON.stringify(
      priced.items
        .map((item: any) => ({
          id: item.productId ?? item.id ?? null,
          quantity: Number(item.quantity) || 0,
          unitPrice: Number(item.price) || 0,
        }))
        .sort((a: any, b: any) => String(a.id || "").localeCompare(String(b.id || "")))
    )
    const recentOrders = await db.collection("menu_orders").find({
      tableId: order.tableId,
      customerNumber: order.customerNumber ?? null,
      guestSessionId: order.guestSessionId ?? null,
      total: order.total,
      status: order.status,
      paymentStatus: order.paymentStatus,
      createdAt: { $gte: tenSecondsAgo },
    }).toArray()

    for (const recent of recentOrders) {
      const recentFingerprint = JSON.stringify(
        (Array.isArray(recent.items) ? recent.items : [])
          .map((item: any) => ({
            id: item.id ?? item.productId ?? null,
            quantity: Number(item.quantity) || 0,
            unitPrice: Number(item.unitPrice ?? item.price) || 0,
          }))
          .sort((a: any, b: any) => String(a.id || "").localeCompare(String(b.id || "")))
      )
      if (recentFingerprint === itemsFingerprint) {
        return NextResponse.json(recent, { status: 200 })
      }
    }

    await db.collection("menu_orders").insertOne(order)
    await maybeSendOnlineOrderSms(db, order)
    return NextResponse.json(order, { status: 201 })
  } catch (error: any) {
    console.error("[menu-orders] POST error:", error)
    return NextResponse.json(
      { error: "Failed to create menu order", message: error.message },
      { status: 500 }
    )
  }
}

export async function PUT(request: Request) {
  try {
    const ip = getClientIp(request)
    const rl = checkRateLimit(`menu-orders-put:${ip}`, 60, 60_000)
    if (!rl.ok) {
      return NextResponse.json(
        { error: "Too many requests", retryAfterMs: rl.retryAfterMs },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } }
      )
    }

    const raw = await request.json()
    const parsed = menuOrderPutSchema.safeParse(raw)
    if (!parsed.success) {
      return NextResponse.json(formatZodError(parsed.error), { status: 400 })
    }
    const body = parsed.data
    const db = await getDatabase("infusion_jaba")
    const { orderId, mpesaReceiptNumber, ...rest } = body
    const updateData: Record<string, unknown> = { ...rest }
    if (mpesaReceiptNumber !== undefined) {
      updateData.mpesaReceiptNumber = mpesaReceiptNumber
    }

    const existing = await db.collection("menu_orders").findOne({ orderId })
    if (!existing) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 })
    }

    sanitizePublicMenuPaymentFields(updateData as Record<string, unknown>, existing as any)

    if (Array.isArray(updateData.items)) {
      // Draft cart sync may clear all lines — allow empty without pricing.
      if (updateData.items.length === 0) {
        updateData.items = []
        updateData.total = 0
        updateData.subtotal = 0
      } else {
        const priced = await pricingForMenuOrderLines(db, updateData.items as unknown[])
        if (!priced.ok) {
          logOrderSecurityEvent({
            route: "/api/menu-orders",
            action: "PUT",
            ip,
            userAgent: request.headers.get("user-agent"),
            rejected: true,
            reason: priced.code,
            requestSummary: { orderId },
          })
          return NextResponse.json({ error: priced.error, code: priced.code }, { status: 400 })
        }
        updateData.items = priced.items
        updateData.total = priced.total
        updateData.subtotal = priced.subtotal
      }
    } else {
      delete updateData.total
      delete updateData.subtotal
    }

    updateData.updatedAt = new Date()
    if (updateData.status === "sent" || updateData.status === "active") {
      updateData.lastSentAt = new Date()
    }

    const result = await db
      .collection("menu_orders")
      .updateOne({ orderId }, { $set: updateData })

    if (result.matchedCount === 0) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 })
    }
    const updated = await db.collection("menu_orders").findOne({ orderId })

    // Mirror sent/active/paid rounds onto admin `orders` (client alertBar often 401s).
    const syncStatus = String(updated?.status || updateData.status || "").toLowerCase()
    if (syncStatus === "sent" || syncStatus === "active" || syncStatus === "paid") {
      try {
        const { upsertAdminOrderFromMenuOrder } = await import("@/lib/menu-order-admin-sync")
        const hasExplicitServe = Boolean(updated?.servedAt)
        await upsertAdminOrderFromMenuOrder(db, updated, {
          waiter: updated?.receivedBy || "Customer",
          ...(hasExplicitServe
            ? {
                servedAt: new Date(updated.servedAt as any),
                servedBy: updated?.servedBy || updated?.receivedBy || "Server",
              }
            : { servedAt: null }),
        })
      } catch (syncErr) {
        console.error("[menu-orders] admin sync failed", syncErr)
      }
    }

    return NextResponse.json({ success: true, order: updated })
  } catch (error: any) {
    console.error("[menu-orders] PUT error:", error)
    return NextResponse.json(
      { error: "Failed to update menu order", message: error.message },
      { status: 500 }
    )
  }
}
