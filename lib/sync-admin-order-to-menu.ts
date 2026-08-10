import type { Db } from "mongodb"

function itemsFingerprint(items: unknown): string {
  const rows = Array.isArray(items) ? items : []
  return JSON.stringify(
    rows
      .map((it: any) => ({
        id: String(it?.productId ?? it?.id ?? ""),
        qty: Number(it?.quantity) || 0,
        price: Number(it?.price ?? it?.unitPrice) || 0,
      }))
      .sort((a, b) => a.id.localeCompare(b.id))
  )
}

function adminItemsToMenuItems(items: unknown) {
  const rows = Array.isArray(items) ? items : []
  return rows.map((it: any, idx: number) => {
    const id = String(it?.productId ?? it?.id ?? `line-${idx}`)
    const unitPrice = Number(it?.price ?? it?.unitPrice) || 0
    return {
      id,
      productId: id,
      name: String(it?.name || "Item"),
      quantity: Number(it?.quantity) || 0,
      unitPrice,
      price: unitPrice,
    }
  })
}

function isMenuSourcedAdminOrder(order: Record<string, unknown> | null | undefined): boolean {
  if (!order) return false
  const source = String(order.orderSource || "").toLowerCase()
  if (source === "menu") return true
  if (source === "pos" || source === "online" || source === "ecommerce" || source === "glovo" || source === "kiosk") {
    return false
  }
  return String(order.cashier || "") === "Customer"
}

/**
 * Mirror staff edits on admin `orders` back to customer-facing `menu_orders`
 * so /menu tracking updates (and can alert the client).
 */
export async function syncAdminOrderEditsToMenuOrder(
  db: Db,
  adminOrderId: string,
  previousAdmin: Record<string, unknown> | null | undefined,
  nextAdmin: Record<string, unknown>
): Promise<boolean> {
  const id = String(adminOrderId || "").trim()
  if (!id) return false

  const menuDoc = await db.collection("menu_orders").findOne({ orderId: id })
  if (!menuDoc && !isMenuSourcedAdminOrder(nextAdmin) && !isMenuSourcedAdminOrder(previousAdmin)) {
    return false
  }

  const prevItemsFp = itemsFingerprint(previousAdmin?.items)
  const nextItemsFp = itemsFingerprint(nextAdmin.items)
  const itemsChanged = prevItemsFp !== nextItemsFp

  const nextStatus = String(nextAdmin.status || "").toLowerCase()
  const nextPay = String(nextAdmin.paymentStatus || "").toUpperCase()
  const paid =
    nextStatus === "completed" ||
    nextPay === "PAID" ||
    nextPay === "OVERPAID" ||
    nextPay === "COMPLETED"

  const $set: Record<string, unknown> = {
    updatedAt: new Date(),
  }

  if (itemsChanged) {
    const menuItems = adminItemsToMenuItems(nextAdmin.items)
    const total = Number(nextAdmin.total)
    const safeTotal = Number.isFinite(total)
      ? total
      : menuItems.reduce((s, it) => s + it.quantity * it.unitPrice, 0)
    $set.items = menuItems
    $set.total = safeTotal
    $set.subtotal = safeTotal
    $set.staffEditedAt = new Date()
    $set.staffEditNotice =
      "Staff updated your order. Check the items and total below."
  }

  if (paid) {
    $set.status = "paid"
    $set.paymentStatus = "PAID"
    if (nextAdmin.paymentMethod != null) $set.paymentMethod = nextAdmin.paymentMethod
  } else if (nextStatus === "cancelled" || nextStatus === "voided") {
    $set.status = "cancelled"
  } else if (itemsChanged) {
    // Keep the round visible on the client's tracking screen.
    const existingStatus = String(menuDoc?.status || "").toLowerCase()
    if (existingStatus !== "sent" && existingStatus !== "active") {
      $set.status = "sent"
    }
    $set.paymentStatus = "UNPAID"
  }

  if (nextAdmin.customerPhone != null) {
    $set.customerPhone = nextAdmin.customerPhone
    $set.customerNumber = nextAdmin.customerPhone
  }

  if (nextAdmin.table != null && nextAdmin.table !== "") {
    const tableStr = String(nextAdmin.table).replace(/^table\s*/i, "").trim()
    $set.tableId = tableStr
    $set.tableNumber = tableStr
  }

  if (Object.keys($set).length <= 1 && !itemsChanged) {
    // only updatedAt — skip no-op writes unless we have a menu doc to touch for status
    if (!menuDoc) return false
  }

  const result = await db.collection("menu_orders").updateOne(
    { orderId: id },
    { $set },
    // Only upsert when we know this is a menu-sourced admin row that lost its menu_orders twin.
    menuDoc ? undefined : { upsert: false }
  )

  if (result.matchedCount === 0 && isMenuSourcedAdminOrder(nextAdmin)) {
    // Recreate a minimal menu_orders row so the client can poll it.
    const menuItems = adminItemsToMenuItems(nextAdmin.items)
    const total = Number(nextAdmin.total) || 0
    const tableStr = String(nextAdmin.table ?? "")
      .replace(/^table\s*/i, "")
      .trim()
    await db.collection("menu_orders").updateOne(
      { orderId: id },
      {
        $set: {
          orderId: id,
          tableId: tableStr || "—",
          tableNumber: tableStr || "—",
          customerNumber: nextAdmin.customerPhone ?? null,
          customerPhone: nextAdmin.customerPhone ?? null,
          guestSessionId: null,
          status: paid ? "paid" : "sent",
          paymentStatus: paid ? "PAID" : "UNPAID",
          paymentMethod: nextAdmin.paymentMethod ?? "cash",
          items: menuItems,
          total,
          subtotal: total,
          staffEditedAt: itemsChanged ? new Date() : undefined,
          staffEditNotice: itemsChanged
            ? "Staff updated your order. Check the items and total below."
            : undefined,
          updatedAt: new Date(),
          createdAt: new Date(),
        },
      },
      { upsert: true }
    )
    return true
  }

  return result.matchedCount > 0 || result.modifiedCount > 0
}
