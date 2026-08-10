import { NextResponse } from "next/server"
import { getDatabase } from "@/lib/mongodb"
import { auth } from "@/lib/auth-catha"
import { normalizePermissions, hasCathaPermission } from "@/lib/catha-permissions-model"
import { pricingForMenuOrderLines, sanitizePublicMenuPaymentFields } from "@/lib/secure-menu-order"
import { checkRateLimit, getClientIp } from "@/lib/rate-limit-simple"
import { logOrderSecurityEvent } from "@/lib/order-security-audit"
import { menuOrderCreateSchema, menuOrderPutSchema, formatZodError } from "@/lib/order-request-schemas"
import { maybeSendOnlineOrderSms } from "@/lib/catha-online-order-sms"
import { applyMenuOrderStockChange } from "@/lib/menu-order-stock"

export async function GET() {
  const session = await auth()
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const role = ((session.user as any).role ?? "").toUpperCase()
  const perms = normalizePermissions((session.user as any).permissions)
  if (role !== "SUPER_ADMIN" && !hasCathaPermission(perms, "orders", "view")) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 })
  }
  try {
    const db = await getDatabase("infusion_jaba")
    const orders = await db
      .collection("menu_orders")
      .find({})
      .sort({ createdAt: -1 })
      .toArray()

    const formattedOrders = orders.map((order: any) => ({
      orderId: order.orderId,
      createdAt:
        order.createdAt instanceof Date
          ? order.createdAt.getTime()
          : new Date(order.createdAt).getTime(),
      updatedAt: order.updatedAt
        ? order.updatedAt instanceof Date
          ? order.updatedAt.getTime()
          : new Date(order.updatedAt).getTime()
        : undefined,
      tableId: order.tableId,
      tableNumber: order.tableNumber ?? order.tableId,
      customerNumber: order.customerNumber ?? order.customerPart ?? null,
      guestSessionId: order.guestSessionId ?? null,
      customerPhone: order.customerPhone,
      status: order.status,
      paymentStatus: order.paymentStatus,
      paymentMethod: order.paymentMethod ?? null,
      items: order.items || [],
      total: order.total,
      subtotal: order.subtotal,
      lastSentAt: order.lastSentAt
        ? order.lastSentAt instanceof Date
          ? order.lastSentAt.getTime()
          : new Date(order.lastSentAt).getTime()
        : undefined,
      receivedBy: order.receivedBy,
      servedAt: order.servedAt
        ? order.servedAt instanceof Date
          ? order.servedAt.getTime()
          : new Date(order.servedAt).getTime()
        : undefined,
      servedBy: order.servedBy ?? null,
      cancelledReason: order.cancelledReason,
      mpesaReceiptNumber: order.mpesaReceiptNumber ?? null,
      staffEditedAt: order.staffEditedAt
        ? order.staffEditedAt instanceof Date
          ? order.staffEditedAt.getTime()
          : new Date(order.staffEditedAt).getTime()
        : null,
      staffEditNotice: order.staffEditNotice ?? null,
    }))

    return NextResponse.json(formattedOrders)
  } catch (error: any) {
    console.error("Error fetching menu orders:", error)
    return NextResponse.json(
      { error: "Failed to fetch menu orders", message: error.message },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const role = ((session.user as any).role ?? "").toUpperCase()
  const perms = normalizePermissions((session.user as any).permissions)
  if (role !== "SUPER_ADMIN" && !hasCathaPermission(perms, "orders", "add")) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 })
  }
  try {
    const ip = getClientIp(request)
    const uid = (session.user as any).email || "unknown"
    const rl = checkRateLimit(`catha-menu-orders-post:${uid}:${ip}`, 60, 60_000)
    if (!rl.ok) {
      return NextResponse.json(
        { error: "Too many requests", retryAfterMs: rl.retryAfterMs },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } }
      )
    }

    const raw = await request.json()
    const parsed = menuOrderCreateSchema.safeParse(raw)
    if (!parsed.success) {
      return NextResponse.json(formatZodError(parsed.error), { status: 400 })
    }
    const body = parsed.data
    const db = await getDatabase("infusion_jaba")
    const orderId = body.orderId.trim()

    const priced = await pricingForMenuOrderLines(db, body.items as unknown[])
    if (!priced.ok) {
      logOrderSecurityEvent({
        route: "/api/catha/menu-orders",
        action: "POST",
        userId: uid,
        role,
        ip,
        userAgent: request.headers.get("user-agent"),
        rejected: true,
        reason: priced.code,
        requestSummary: { orderId },
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
      stockDeducted: false,
      stockDeductedAt: null,
    }

    logOrderSecurityEvent({
      route: "/api/catha/menu-orders",
      action: "POST",
      userId: uid,
      role,
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

    const stock = await applyMenuOrderStockChange(db, {
      orderId,
      previous: null,
      next: order,
      actor: uid,
    })
    if (!stock.ok) {
      return NextResponse.json(
        {
          error: stock.error,
          productId: stock.productId,
          productName: stock.productName,
          available: stock.available,
        },
        { status: 400 }
      )
    }
    order.stockDeducted = stock.stockDeducted
    order.stockDeductedAt = stock.stockDeductedAt
    order.stockReleasedAt = stock.stockReleasedAt

    await db.collection("menu_orders").insertOne(order)
    await maybeSendOnlineOrderSms(db, order)

    const syncStatus = String(order.status || "").toLowerCase()
    if (syncStatus === "sent" || syncStatus === "active" || syncStatus === "paid") {
      try {
        const { upsertAdminOrderFromMenuOrder } = await import("@/lib/menu-order-admin-sync")
        await upsertAdminOrderFromMenuOrder(db, order, {
          waiter: (typeof body.receivedBy === "string" && body.receivedBy) || uid,
          servedAt: null,
        })
      } catch (syncErr) {
        console.error("[catha/menu-orders] admin sync failed on create", syncErr)
      }
    }

    return NextResponse.json(order, { status: 201 })
  } catch (error: any) {
    console.error("Error creating menu order:", error)
    return NextResponse.json(
      { error: "Failed to create menu order", message: error.message },
      { status: 500 }
    )
  }
}

export async function PUT(request: Request) {
  const session = await auth()
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const role = ((session.user as any).role ?? "").toUpperCase()
  const perms = normalizePermissions((session.user as any).permissions)
  if (role !== "SUPER_ADMIN" && !hasCathaPermission(perms, "orders", "edit")) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 })
  }
  try {
    const ip = getClientIp(request)
    const uid = (session.user as any).email || "unknown"
    const rl = checkRateLimit(`catha-menu-orders-put:${uid}:${ip}`, 80, 60_000)
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
      if (updateData.items.length === 0) {
        updateData.items = []
        updateData.total = 0
        updateData.subtotal = 0
      } else {
        const priced = await pricingForMenuOrderLines(db, updateData.items as unknown[])
        if (!priced.ok) {
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
    // Explicit Serve: stamp servedAt on menu_orders (legacy Accept only set status=active).
    if (updateData.status === "active" && updateData.servedAt == null) {
      updateData.servedAt = new Date()
      if (updateData.servedBy == null) {
        updateData.servedBy =
          typeof updateData.receivedBy === "string"
            ? updateData.receivedBy
            : (session.user as any)?.name ?? "Server"
      }
    } else if (updateData.servedAt != null) {
      updateData.servedAt = new Date(updateData.servedAt as any)
    }

    const nextDoc = {
      ...existing,
      ...updateData,
      items: updateData.items !== undefined ? updateData.items : existing.items,
      status: updateData.status !== undefined ? updateData.status : existing.status,
    }

    const stock = await applyMenuOrderStockChange(db, {
      orderId,
      previous: existing,
      next: nextDoc,
      actor: uid,
    })
    if (!stock.ok) {
      return NextResponse.json(
        {
          error: stock.error,
          productId: stock.productId,
          productName: stock.productName,
          available: stock.available,
        },
        { status: 400 }
      )
    }
    updateData.stockDeducted = stock.stockDeducted
    updateData.stockDeductedAt = stock.stockDeductedAt
    updateData.stockReleasedAt = stock.stockReleasedAt

    const result = await db
      .collection("menu_orders")
      .updateOne({ orderId }, { $set: updateData })

    if (result.matchedCount === 0) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 })
    }
    const updated = await db.collection("menu_orders").findOne({ orderId })

    // Keep /catha/orders in sync for menu rounds (Accept / Served / pay)
    try {
      const { upsertAdminOrderFromMenuOrder } = await import("@/lib/menu-order-admin-sync")
      const serverName =
        typeof updateData.receivedBy === "string"
          ? updateData.receivedBy
          : (session.user as any)?.name ?? null
      const isServe = updateData.status === "active"
      const servedAt = updated?.servedAt
        ? updated.servedAt instanceof Date
          ? updated.servedAt
          : new Date(updated.servedAt as any)
        : isServe
          ? new Date()
          : null
      await upsertAdminOrderFromMenuOrder(db, updated, {
        waiter: serverName || updated?.receivedBy || undefined,
        ...(isServe && servedAt
          ? {
              servedAt,
              servedBy:
                (typeof updateData.servedBy === "string" && updateData.servedBy) ||
                serverName ||
                updated?.receivedBy ||
                "Server",
            }
          : { servedAt: null }),
      })
    } catch (syncErr) {
      console.error("[menu-orders] admin sync failed", syncErr)
    }

    return NextResponse.json({ success: true, order: updated })
  } catch (error: any) {
    console.error("Error updating menu order:", error)
    return NextResponse.json(
      { error: "Failed to update menu order", message: error.message },
      { status: 500 }
    )
  }
}
