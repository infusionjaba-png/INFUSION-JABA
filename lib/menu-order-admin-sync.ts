import type { Db } from "mongodb"

function asDate(value: unknown): Date | null {
  if (value == null) return null
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value
  }
  const d = new Date(value as any)
  return Number.isNaN(d.getTime()) ? null : d
}

function isPaidMenuOrder(menuOrder: any): boolean {
  const statusLower = String(menuOrder.status || "").toLowerCase()
  return (
    String(menuOrder.paymentStatus || "").toUpperCase() === "PAID" ||
    statusLower === "paid"
  )
}

/** Explicit staff Serve sets menu_orders.servedAt — legacy Accept only set status=active. */
export function menuOrderIsExplicitlyServed(menuOrder: any): boolean {
  return Boolean(asDate(menuOrder?.servedAt))
}

/**
 * Old Accept set status "active" (= guest "Served") without servedAt.
 * Roll those unpaid rounds back to "sent" (Preparing) until staff clicks Served.
 */
export async function repairPrematureMenuServed(db: Db): Promise<{ repaired: number }> {
  const premature = await db
    .collection("menu_orders")
    .find({
      status: "active",
      paymentStatus: { $nin: ["PAID", "paid"] },
      $or: [{ servedAt: { $exists: false } }, { servedAt: null }],
    })
    .limit(200)
    .toArray()

  let repaired = 0
  for (const mo of premature) {
    const orderId = String(mo.orderId || "").trim()
    if (!orderId) continue
    try {
      await db.collection("menu_orders").updateOne(
        { orderId },
        {
          $set: { status: "sent", updatedAt: new Date() },
          $unset: { servedBy: "" },
        }
      )
      await db.collection("orders").updateOne(
        { id: orderId },
        {
          $set: {
            paymentNote: "Menu order — awaiting payment",
            updatedAt: new Date(),
          },
          $unset: { servedAt: "", servedBy: "" },
        }
      )
      repaired += 1
    } catch (err) {
      console.error("[menu-order-admin-sync] premature-serve repair failed", orderId, err)
    }
  }

  // Also clear admin servedAt when menu is sent/preparing (stale backfill stamps)
  const staleAdmin = await db
    .collection("orders")
    .find({
      orderSource: "menu",
      status: "pending",
      servedAt: { $exists: true, $ne: null },
    })
    .limit(200)
    .toArray()

  for (const admin of staleAdmin) {
    const id = String(admin.id || "").trim()
    if (!id) continue
    const menu = await db.collection("menu_orders").findOne({ orderId: id })
    if (!menu) continue
    if (menuOrderIsExplicitlyServed(menu)) continue
    if (isPaidMenuOrder(menu)) continue
    try {
      await db.collection("orders").updateOne(
        { id },
        {
          $set: {
            paymentNote: "Menu order — awaiting payment",
            updatedAt: new Date(),
          },
          $unset: { servedAt: "", servedBy: "" },
        }
      )
      if (String(menu.status || "").toLowerCase() === "active") {
        await db.collection("menu_orders").updateOne(
          { orderId: id },
          { $set: { status: "sent", updatedAt: new Date() } }
        )
      }
      repaired += 1
    } catch (err) {
      console.error("[menu-order-admin-sync] stale servedAt clear failed", id, err)
    }
  }

  return { repaired }
}

/** Upsert a menu round into admin `orders` so it appears on /catha/orders. */
export async function upsertAdminOrderFromMenuOrder(
  db: Db,
  menuOrder: any,
  opts?: {
    waiter?: string | null
    servedAt?: Date | null
    servedBy?: string | null
  }
) {
  const id = String(menuOrder.orderId || "").trim()
  if (!id) return

  const rawItems = Array.isArray(menuOrder.items) ? menuOrder.items : []
  const items = rawItems.map((it: any, idx: number) => ({
    productId: String(it?.productId ?? it?.id ?? it?.skuId ?? `line-${idx}`),
    name: String(it?.name || "Item"),
    quantity: Number(it?.quantity) || 0,
    price: Number(it?.unitPrice ?? it?.price) || 0,
  }))

  const total = Number(menuOrder.total)
  const safeTotal = Number.isFinite(total)
    ? total
    : items.reduce((s: number, it: any) => s + it.quantity * it.price, 0)

  const tableRaw = menuOrder.tableId ?? menuOrder.tableNumber ?? ""
  const tableNum = parseInt(String(tableRaw), 10)
  const paid = isPaidMenuOrder(menuOrder)

  const phone =
    menuOrder.customerPhone ?? menuOrder.customerNumber ?? null

  const waiter =
    opts?.waiter ??
    menuOrder.receivedBy ??
    "Customer"

  // Served only when staff explicitly marked it (opts or menu.servedAt) — not bare status=active.
  const explicitServedAt =
    opts?.servedAt !== undefined
      ? opts.servedAt
      : asDate(menuOrder.servedAt)

  const servedBy =
    opts?.servedBy ??
    menuOrder.servedBy ??
    (explicitServedAt ? waiter : null)

  const $set: Record<string, unknown> = {
    id,
    table: Number.isFinite(tableNum) ? tableNum : String(tableRaw || "—"),
    customerPhone: phone,
    items,
    subtotal: safeTotal,
    vat: 0,
    total: safeTotal,
    paymentMethod: menuOrder.paymentMethod ?? (paid ? "mpesa" : "cash"),
    paymentStatus: paid ? "PAID" : "NOT_PAID",
    paymentNote: paid
      ? "Paid via menu"
      : explicitServedAt
        ? "Served — waiting payment"
        : "Menu order — awaiting payment",
    cashier: "Customer",
    waiter,
    orderSource: "menu",
    status: paid ? "completed" : "pending",
    stockDeducted: menuOrder.stockDeducted === true,
    stockDeductedAt: menuOrder.stockDeductedAt
      ? asDate(menuOrder.stockDeductedAt) || new Date()
      : menuOrder.stockDeducted === true
        ? new Date()
        : null,
    stockReleasedAt: asDate(menuOrder.stockReleasedAt),
    updatedAt: new Date(),
  }

  const $unset: Record<string, string> = {}
  if (explicitServedAt) {
    $set.servedAt = explicitServedAt
    $set.servedBy = servedBy ?? waiter
  } else if (!paid) {
    $unset.servedAt = ""
    $unset.servedBy = ""
  }

  if (menuOrder.mpesaReceiptNumber) {
    $set.mpesaReceiptNumber = menuOrder.mpesaReceiptNumber
  }

  await db.collection("orders").updateOne(
    { id },
    {
      $set,
      ...(Object.keys($unset).length ? { $unset } : {}),
      $setOnInsert: {
        timestamp:
          asDate(menuOrder.createdAt) ||
          asDate(menuOrder.lastSentAt) ||
          new Date(),
        createdAt: new Date(),
      },
    },
    { upsert: true }
  )
}

/**
 * Backfill open menu rounds onto admin `orders` (covers rounds created before sync existed).
 * Also repairs premature "Served" from the old Accept flow.
 */
export async function syncOpenMenuOrdersToAdmin(
  db: Db
): Promise<{ synced: number; repaired: number }> {
  const { repaired } = await repairPrematureMenuServed(db)

  const open = await db
    .collection("menu_orders")
    .find({
      status: { $in: ["sent", "active"] },
      paymentStatus: { $nin: ["PAID", "paid"] },
    })
    .limit(200)
    .toArray()

  let synced = 0
  for (const mo of open) {
    try {
      const explicitlyServed = menuOrderIsExplicitlyServed(mo)
      await upsertAdminOrderFromMenuOrder(db, mo, {
        waiter: mo.receivedBy || "Customer",
        ...(explicitlyServed
          ? {
              servedAt: asDate(mo.servedAt)!,
              servedBy: mo.servedBy || mo.receivedBy || "Server",
            }
          : { servedAt: null }),
      })
      synced += 1
    } catch (err) {
      console.error("[menu-order-admin-sync] backfill failed", mo?.orderId, err)
    }
  }

  return { synced, repaired }
}
