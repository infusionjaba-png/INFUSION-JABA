/**
 * Inventory deduction for /menu (QR) orders — mirrors POS behavior on send.
 */
import type { Db } from "mongodb"
import {
  validateStockForItems,
  deductStockAtomic,
  restoreStockAtomic,
  diffOrderItems,
} from "@/lib/inventory-ops"
import { filterInventoryStockLineItems } from "@/lib/catha-order-inventory-lines"

const COMMITTED = new Set(["sent", "active", "paid"])
const TERMINAL = new Set(["cancelled", "voided", "deleted"])

function statusOf(order: any): string {
  return String(order?.status || "").toLowerCase()
}

function isCommitted(order: any): boolean {
  return COMMITTED.has(statusOf(order))
}

function isTerminal(order: any): boolean {
  return TERMINAL.has(statusOf(order))
}

export type MenuStockResult =
  | {
      ok: true
      stockDeducted: boolean
      stockDeductedAt: Date | null
      stockReleasedAt: Date | null
    }
  | {
      ok: false
      error: string
      productId?: string
      productName?: string
      available?: number
    }

/**
 * Apply bar_inventory changes for a menu order transition.
 * - draft → sent/active/paid: deduct full lines
 * - already deducted + items changed: restore/deduct deltas
 * - committed → cancelled/voided/deleted: restore
 * Idempotent via menu_orders.stockDeducted (and admin orders flag when synced).
 */
export async function applyMenuOrderStockChange(
  db: Db,
  opts: {
    orderId: string
    /** Document before this write (null on create) */
    previous: any | null
    /** Final intended document (merged fields) */
    next: any
    actor?: string
  }
): Promise<MenuStockResult> {
  const { orderId, previous, next } = opts
  const actor = opts.actor || "Customer"
  const prevCommitted = previous ? isCommitted(previous) : false
  const nextCommitted = isCommitted(next)
  const nextTerminal = isTerminal(next)
  const wasDeducted = previous?.stockDeducted === true
  const nextItems = filterInventoryStockLineItems(next?.items)
  const prevItems = filterInventoryStockLineItems(previous?.items)

  // Cancel / void after stock was taken
  if (wasDeducted && nextTerminal) {
    for (const item of prevItems) {
      await restoreStockAtomic(
        db,
        item.productId,
        Number(item.quantity),
        orderId,
        actor,
        item.name || "Unknown",
        statusOf(next) === "deleted" ? "order_deleted" : "order_cancelled"
      )
    }
    await db.collection("orders").updateOne(
      { id: orderId },
      {
        $set: { stockDeducted: false, stockReleasedAt: new Date(), updatedAt: new Date() },
      }
    )
    return {
      ok: true,
      stockDeducted: false,
      stockDeductedAt: null,
      stockReleasedAt: new Date(),
    }
  }

  // Still draft / not committing inventory
  if (!nextCommitted || nextTerminal) {
    return {
      ok: true,
      stockDeducted: wasDeducted,
      stockDeductedAt: previous?.stockDeductedAt
        ? previous.stockDeductedAt instanceof Date
          ? previous.stockDeductedAt
          : new Date(previous.stockDeductedAt)
        : null,
      stockReleasedAt: previous?.stockReleasedAt
        ? previous.stockReleasedAt instanceof Date
          ? previous.stockReleasedAt
          : new Date(previous.stockReleasedAt)
        : null,
    }
  }

  // First commit (create as sent, or draft → sent)
  if (!wasDeducted && nextItems.length > 0) {
    const validation = await validateStockForItems(db, nextItems)
    if (!validation.ok) {
      return {
        ok: false,
        error: validation.error,
        productId: validation.productId,
        productName: validation.productName,
        available: validation.available,
      }
    }

    const deducted: Array<{ productId: string; quantity: number; name?: string }> = []
    for (const item of nextItems) {
      const qty = Number(item.quantity)
      const res = await deductStockAtomic(
        db,
        item.productId,
        qty,
        orderId,
        actor,
        item.name,
        "menu_sale"
      )
      if (!res.success) {
        for (const d of deducted) {
          await restoreStockAtomic(
            db,
            d.productId,
            d.quantity,
            orderId,
            actor,
            d.name || "Unknown",
            "order_cancelled"
          )
        }
        return { ok: false, error: res.error }
      }
      deducted.push({ productId: item.productId, quantity: qty, name: item.name })
    }

    const at = new Date()
    return { ok: true, stockDeducted: true, stockDeductedAt: at, stockReleasedAt: null }
  }

  // Already deducted — apply item deltas when lines change on a live round
  if (wasDeducted && prevCommitted && nextCommitted && previous && Array.isArray(next?.items)) {
    const { toRestore, toDeduct } = diffOrderItems(
      prevItems.map((i) => ({
        productId: i.productId,
        quantity: Number(i.quantity),
        name: i.name,
      })),
      nextItems.map((i) => ({
        productId: i.productId,
        quantity: Number(i.quantity),
        name: i.name,
      }))
    )

    for (const item of toRestore) {
      await restoreStockAtomic(
        db,
        item.productId,
        item.quantity,
        orderId,
        actor,
        item.name || "Unknown",
        "quantity_reduced"
      )
    }

    if (toDeduct.length > 0) {
      const validation = await validateStockForItems(db, toDeduct)
      if (!validation.ok) {
        // Roll back restores we just did
        for (const item of toRestore) {
          await deductStockAtomic(
            db,
            item.productId,
            item.quantity,
            orderId,
            actor,
            item.name,
            "menu_sale"
          )
        }
        return {
          ok: false,
          error: validation.error,
          productId: validation.productId,
          productName: validation.productName,
          available: validation.available,
        }
      }
      const deducted: Array<{ productId: string; quantity: number; name?: string }> = []
      for (const item of toDeduct) {
        const res = await deductStockAtomic(
          db,
          item.productId,
          item.quantity,
          orderId,
          actor,
          item.name,
          "menu_sale"
        )
        if (!res.success) {
          for (const d of deducted) {
            await restoreStockAtomic(
              db,
              d.productId,
              d.quantity,
              orderId,
              actor,
              d.name || "Unknown",
              "order_cancelled"
            )
          }
          for (const r of toRestore) {
            await deductStockAtomic(
              db,
              r.productId,
              r.quantity,
              orderId,
              actor,
              r.name,
              "menu_sale"
            )
          }
          return { ok: false, error: res.error }
        }
        deducted.push(item)
      }
    }

    return {
      ok: true,
      stockDeducted: true,
      stockDeductedAt: previous.stockDeductedAt
        ? previous.stockDeductedAt instanceof Date
          ? previous.stockDeductedAt
          : new Date(previous.stockDeductedAt)
        : new Date(),
      stockReleasedAt: null,
    }
  }

  // Committed with no inventory lines (or already deducted, no item change)
  return {
    ok: true,
    stockDeducted: wasDeducted || nextItems.length === 0 ? wasDeducted : false,
    stockDeductedAt: previous?.stockDeductedAt
      ? previous.stockDeductedAt instanceof Date
        ? previous.stockDeductedAt
        : new Date(previous.stockDeductedAt)
      : wasDeducted
        ? new Date()
        : null,
    stockReleasedAt: null,
  }
}
