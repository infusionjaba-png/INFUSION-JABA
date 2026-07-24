import type { Db } from "mongodb"

function asDate(value: unknown): Date | null {
  if (value == null) return null
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value
  }
  const d = new Date(value as any)
  return Number.isNaN(d.getTime()) ? null : d
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
  const statusLower = String(menuOrder.status || "").toLowerCase()
  const paid =
    String(menuOrder.paymentStatus || "").toUpperCase() === "PAID" ||
    statusLower === "paid"

  const phone =
    menuOrder.customerPhone ?? menuOrder.customerNumber ?? null

  const waiter =
    opts?.waiter ??
    menuOrder.receivedBy ??
    "Customer"

  const existingAdmin = await db.collection("orders").findOne({ id })
  const menuLooksServed = statusLower === "active"
  const inferredServedAt =
    opts?.servedAt !== undefined
      ? opts.servedAt
      : asDate(existingAdmin?.servedAt) ||
        (menuLooksServed
          ? asDate(menuOrder.servedAt) ||
            asDate(menuOrder.updatedAt) ||
            asDate(menuOrder.lastSentAt) ||
            new Date()
          : null)
  const servedBy =
    opts?.servedBy ??
    existingAdmin?.servedBy ??
    menuOrder.servedBy ??
    (inferredServedAt ? waiter : null)

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
      : inferredServedAt
        ? "Served — waiting payment"
        : "Menu order — awaiting payment",
    cashier: "Customer",
    waiter,
    orderSource: "menu",
    status: paid ? "completed" : "pending",
    updatedAt: new Date(),
  }

  if (inferredServedAt) {
    $set.servedAt = inferredServedAt
    $set.servedBy = servedBy ?? waiter
  }

  if (menuOrder.mpesaReceiptNumber) {
    $set.mpesaReceiptNumber = menuOrder.mpesaReceiptNumber
  }

  await db.collection("orders").updateOne(
    { id },
    {
      $set,
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
 * Returns how many menu docs were upserted.
 */
export async function syncOpenMenuOrdersToAdmin(db: Db): Promise<{ synced: number }> {
  const open = await db
    .collection("menu_orders")
    .find({
      status: { $in: ["sent", "active"] },
      // Treat missing / UNPAID / NOT_PAID as open; only skip paid rounds
      paymentStatus: { $nin: ["PAID", "paid"] },
    })
    .limit(200)
    .toArray()

  let synced = 0
  for (const mo of open) {
    try {
      const statusLower = String(mo.status || "").toLowerCase()
      await upsertAdminOrderFromMenuOrder(db, mo, {
        waiter: mo.receivedBy || "Customer",
        ...(statusLower === "active"
          ? {
              servedAt:
                asDate(mo.servedAt) ||
                asDate(mo.updatedAt) ||
                asDate(mo.lastSentAt) ||
                new Date(),
              servedBy: mo.receivedBy || mo.servedBy || "Server",
            }
          : {}),
      })
      synced += 1
    } catch (err) {
      console.error("[menu-order-admin-sync] backfill failed", mo?.orderId, err)
    }
  }

  return { synced }
}
