import type { Db } from "mongodb"
import { normalizePhoneNumbers, sendJabaSmsStrict } from "@/lib/jaba-sms"

export type MenuConfirmPaymentInput = {
  orderIds: string[]
  phone?: string | null
  mpesaReceiptNumber?: string | null
  tableNumber?: string | null
}

export type MenuConfirmPaymentResult = {
  ok: true
  primaryOrderId: string
  receiptUrl: string
  sms: { sent: boolean; reason?: string; phone?: string | null }
  settledOrderIds: string[]
  total: number
  roundCount: number
  items: Array<{ name: string; quantity: number; price: number }>
  tableNumber: string
  paidAt: number
}

function receiptBaseUrl(): string {
  return (
    process.env.CATHA_RECEIPT_LINK_BASE?.trim() ||
    process.env.NEXTAUTH_URL?.trim() ||
    "https://infusionjaba.co.ke"
  ).replace(/\/$/, "")
}

function buildTabReceiptMessage(opts: {
  orderId: string
  total: number
  roundCount: number
}): string {
  const link = `${receiptBaseUrl()}/r/${encodeURIComponent(opts.orderId)}`
  const rounds =
    opts.roundCount > 1 ? ` · ${opts.roundCount} rounds` : ""
  return `Payment received. Your tab at Catha Lounge is settled (KES ${Math.round(
    opts.total
  ).toLocaleString("en-KE")}${rounds}).\nReceipt: ${link}\n\nThank you for visiting us.`
}

function mapLineItems(raw: unknown): Array<{
  productId: string
  name: string
  quantity: number
  price: number
}> {
  if (!Array.isArray(raw)) return []
  return raw.map((it: any, idx: number) => {
    const qty = Number(it?.quantity) || 0
    const price = Number(it?.unitPrice ?? it?.price) || 0
    const name = String(it?.name || "Item")
    const productId = String(it?.id ?? it?.productId ?? it?.skuId ?? `line-${idx}`)
    return { productId, name, quantity: qty, price }
  })
}

/**
 * After verified M-Pesa success on the customer menu:
 * 1) Mark menu_orders paid
 * 2) Upsert completed admin `orders` (so /r/{id} + SMS work without staff auth)
 * 3) Send receipt SMS once (primary id) — only called after payment
 */
export async function confirmMenuPayment(
  db: Db,
  input: MenuConfirmPaymentInput
): Promise<MenuConfirmPaymentResult | { ok: false; error: string; status: number }> {
  const orderIds = [...new Set((input.orderIds || []).map((id) => String(id || "").trim()).filter(Boolean))]
  if (orderIds.length === 0) {
    return { ok: false, error: "orderIds required", status: 400 }
  }

  const menuOrders = await db
    .collection("menu_orders")
    .find({ orderId: { $in: orderIds } })
    .toArray()

  if (menuOrders.length === 0) {
    return { ok: false, error: "Orders not found", status: 404 }
  }

  const byId = new Map(menuOrders.map((o: any) => [String(o.orderId), o]))
  const ordered = orderIds.map((id) => byId.get(id)).filter(Boolean) as any[]
  if (ordered.length === 0) {
    return { ok: false, error: "Orders not found", status: 404 }
  }

  const phoneRaw =
    input.phone ||
    ordered.find((o) => o.customerPhone)?.customerPhone ||
    ordered.find((o) => o.customerNumber)?.customerNumber ||
    null
  const phone = normalizePhoneNumbers(String(phoneRaw || ""))[0] || null
  const receipt = input.mpesaReceiptNumber ? String(input.mpesaReceiptNumber) : null
  const paidAt = new Date()
  const tableNumber = String(
    input.tableNumber ||
      ordered[0].tableNumber ||
      ordered[0].tableId ||
      "—"
  )

  // Mark every menu round paid
  await db.collection("menu_orders").updateMany(
    { orderId: { $in: orderIds } },
    {
      $set: {
        paymentStatus: "PAID",
        status: "paid",
        paymentMethod: "mpesa",
        updatedAt: paidAt,
        ...(receipt ? { mpesaReceiptNumber: receipt } : {}),
        ...(phone ? { customerPhone: phone } : {}),
      },
    }
  )

  // Upsert each round into admin orders (completed)
  for (const mo of ordered) {
    const id = String(mo.orderId)
    const items = mapLineItems(mo.items)
    const total = Number(mo.total)
    const safeTotal = Number.isFinite(total)
      ? total
      : items.reduce((s, it) => s + it.quantity * it.price, 0)

    await db.collection("orders").updateOne(
      { id },
      {
        $set: {
          id,
          table: parseInt(String(mo.tableId ?? mo.tableNumber), 10) || String(mo.tableId ?? mo.tableNumber ?? ""),
          customerPhone: phone,
          items,
          subtotal: safeTotal,
          vat: 0,
          total: safeTotal,
          paymentMethod: "mpesa",
          paymentStatus: "PAID",
          paymentNote: receipt
            ? `Paid via M-Pesa (${receipt})`
            : `Paid via M-Pesa (${phone ?? ""})`,
          cashier: "Customer",
          waiter: "Customer",
          orderSource: "menu",
          status: "completed",
          updatedAt: paidAt,
          ...(receipt ? { mpesaReceiptNumber: receipt } : {}),
        },
        $setOnInsert: {
          timestamp: mo.createdAt instanceof Date ? mo.createdAt : paidAt,
          createdAt: paidAt,
        },
      },
      { upsert: true }
    )
  }

  // Primary receipt = merged tab view on first order id (best for /r + SMS)
  const primaryOrderId = String(ordered[0].orderId)
  const mergedItems = ordered.flatMap((mo) => mapLineItems(mo.items))
  const tabTotal = ordered.reduce((sum, mo) => {
    const t = Number(mo.total)
    if (Number.isFinite(t)) return sum + t
    return (
      sum +
      mapLineItems(mo.items).reduce((s, it) => s + it.quantity * it.price, 0)
    )
  }, 0)

  if (ordered.length > 1) {
    await db.collection("orders").updateOne(
      { id: primaryOrderId },
      {
        $set: {
          items: mergedItems,
          subtotal: tabTotal,
          vat: 0,
          total: tabTotal,
          paymentNote: receipt
            ? `Tab settled via M-Pesa (${receipt}) · ${ordered.length} rounds`
            : `Tab settled via M-Pesa · ${ordered.length} rounds`,
          updatedAt: paidAt,
        },
      }
    )
  }

  // SMS only after payment — once per primary receipt
  let sms: MenuConfirmPaymentResult["sms"] = {
    sent: false,
    reason: "no_valid_customer_phone",
    phone,
  }

  if (phone) {
    const claim = await db.collection("orders").updateOne(
      {
        id: primaryOrderId,
        paymentReceiptSmsStatus: { $nin: ["SENDING", "SENT"] },
      },
      {
        $set: {
          paymentReceiptSmsSentAt: paidAt,
          paymentReceiptSmsPhone: phone,
          paymentReceiptSmsStatus: "SENDING",
          updatedAt: paidAt,
        },
      }
    )

    if (claim.matchedCount === 0) {
      sms = { sent: false, reason: "already_sent_or_in_progress", phone }
    } else {
      try {
        const message = buildTabReceiptMessage({
          orderId: primaryOrderId,
          total: tabTotal,
          roundCount: ordered.length,
        })
        await sendJabaSmsStrict(message, [phone])
        await db.collection("orders").updateOne(
          { id: primaryOrderId },
          {
            $set: {
              paymentReceiptSmsStatus: "SENT",
              paymentReceiptSmsLastError: null,
              updatedAt: new Date(),
            },
          }
        )
        sms = { sent: true, phone }
      } catch (error: any) {
        await db.collection("orders").updateOne(
          { id: primaryOrderId },
          {
            $set: {
              paymentReceiptSmsStatus: "FAILED",
              paymentReceiptSmsLastError: String(error?.message || "sms_send_failed"),
              updatedAt: new Date(),
            },
            $unset: { paymentReceiptSmsSentAt: "" },
          }
        )
        sms = {
          sent: false,
          reason: "sms_send_failed",
          phone,
        }
      }
    }
  }

  const base = receiptBaseUrl()
  return {
    ok: true,
    primaryOrderId,
    receiptUrl: `${base}/r/${encodeURIComponent(primaryOrderId)}`,
    sms,
    settledOrderIds: ordered.map((o) => String(o.orderId)),
    total: tabTotal,
    roundCount: ordered.length,
    items: mergedItems.map((it) => ({
      name: it.name,
      quantity: it.quantity,
      price: it.price,
    })),
    tableNumber,
    paidAt: paidAt.getTime(),
  }
}
