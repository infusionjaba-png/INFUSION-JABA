/**
 * Strict request DTOs for order/cart flows. All schemas use .strict() to reject unknown keys.
 * Use these at API boundaries — never persist raw request bodies.
 */

import { z } from 'zod'

/** Inventory line: intent only (IDs + quantity + optional size). */
export const minimalInventoryLineSchema = z
  .object({
    productId: z.string().min(1).optional(),
    id: z.string().min(1).optional(),
    quantity: z.coerce.number().int().min(1).max(999),
    size: z.string().max(120).optional(),
    selectedSize: z.string().max(120).optional(),
  })
  .strict()
  .refine((d) => Boolean((d.productId && d.productId.trim()) || (d.id && d.id.trim())), {
    message: 'Each line needs productId or id',
  })

/** POS custom line — price still validated/clamped in resolveBarOrderLines */
export const customOrderLineSchema = z
  .object({
    isCustomItem: z.literal(true),
    lineType: z.literal('custom'),
    name: z.string().min(1).max(500),
    quantity: z.number().int().min(1).max(999),
    price: z.number().positive().max(5_000_000),
  })
  .strict()

export const cathaOrderLineInputSchema = z.union([minimalInventoryLineSchema, customOrderLineSchema])

export const cathaStaffOrderCreateSchema = z
  .object({
    clientEditingOrderId: z.union([z.string(), z.null()]).optional(),
    id: z.string().max(64).optional(),
    table: z.union([z.number(), z.string()]).optional(),
    orderType: z.enum(['INHOUSE', 'TAKEOUT']).optional(),
    /** Server may override — only whitelisted sources */
    orderSource: z.enum(['pos', 'menu', 'glovo', 'kiosk']).optional(),
    items: z.array(cathaOrderLineInputSchema).min(1).max(200),
    paymentMethod: z.string().max(40).optional(),
    glovoOrderNumber: z.union([z.string().max(120), z.null()]).optional(),
    cardTransactionReference: z.union([z.string().max(120), z.null()]).optional(),
    paymentReference: z.union([z.string().max(120), z.null()]).optional(),
    reference: z.union([z.string().max(120), z.null()]).optional(),
    paidAmount: z.union([z.number(), z.null()]).optional(),
    paidAt: z.union([z.string(), z.date(), z.null()]).optional(),
    paidBy: z.union([z.string().max(200), z.null()]).optional(),
    cashAmount: z.union([z.number(), z.null()]).optional(),
    cashBalance: z.union([z.number(), z.null()]).optional(),
    waiter: z.union([z.string().max(200), z.null()]).optional(),
    customerName: z.union([z.string().max(300), z.null()]).optional(),
    customerPhone: z.union([z.string().max(40), z.null()]).optional(),
    promoCode: z.union([z.string().max(64), z.null()]).optional(),
    status: z.enum(['pending', 'completed', 'cancelled', 'voided', 'deleted']).optional(),
    /** Accepted for compatibility then discarded — server sets `timestamp` */
    timestamp: z.union([z.string(), z.number(), z.date()]).optional(),
  })
  .strict()

/** PUT /api/catha/orders — only these keys may be applied (money fields re-derived when items sent). */
export const cathaStaffOrderUpdateSchema = z
  .object({
    id: z.string().min(1).max(64),
    items: z.array(cathaOrderLineInputSchema).max(200).optional(),
    table: z.union([z.number(), z.string()]).optional(),
    orderType: z.enum(['INHOUSE', 'TAKEOUT']).optional(),
    orderSource: z.enum(['pos', 'menu', 'glovo', 'kiosk']).optional(),
    paymentMethod: z.string().max(40).optional(),
    paymentStatus: z.enum(['PENDING', 'PAID', 'PARTIALLY_PAID', 'NOT_PAID', 'OVERPAID']).optional(),
    status: z.enum(['pending', 'completed', 'cancelled', 'voided', 'deleted']).optional(),
    glovoOrderNumber: z.union([z.string().max(120), z.null()]).optional(),
    cardTransactionReference: z.union([z.string().max(120), z.null()]).optional(),
    paymentReference: z.union([z.string().max(120), z.null()]).optional(),
    reference: z.union([z.string().max(120), z.null()]).optional(),
    paidAmount: z.union([z.number(), z.null()]).optional(),
    paidAt: z.union([z.string(), z.date(), z.null()]).optional(),
    paidBy: z.union([z.string().max(200), z.null()]).optional(),
    cashAmount: z.union([z.number(), z.null()]).optional(),
    cashBalance: z.union([z.number(), z.null()]).optional(),
    waiter: z.union([z.string().max(200), z.null()]).optional(),
    servedAt: z.union([z.string(), z.date(), z.null()]).optional(),
    servedBy: z.union([z.string().max(200), z.null()]).optional(),
    customerName: z.union([z.string().max(300), z.null()]).optional(),
    customerPhone: z.union([z.string().max(40), z.null()]).optional(),
    promoCode: z.union([z.string().max(64), z.null()]).optional(),
    mpesaTransactionId: z.union([z.string().max(128), z.null()]).optional(),
    mpesaReceiptNumber: z.union([z.string().max(64), z.null()]).optional(),
    linkedAt: z.union([z.string(), z.date(), z.null()]).optional(),
    linkedBy: z.union([z.string().max(200), z.null()]).optional(),
    linkedPayments: z.array(z.unknown()).max(100).optional(),
    totalLinkedPayments: z.number().optional(),
    balanceDue: z.union([z.number(), z.null()]).optional(),
    overpaymentAmount: z.number().optional(),
    changeGiven: z.boolean().optional(),
    changeGivenAt: z.union([z.string(), z.date(), z.null()]).optional(),
    changeGivenBy: z.union([z.string().max(200), z.null()]).optional(),
    changeNotes: z.union([z.string().max(2000), z.null()]).optional(),
    mpesaLastPromptAt: z.union([z.string(), z.date(), z.null()]).optional(),
    mpesaLastPromptStatus: z.string().max(120).optional(),
    mpesaLastPromptMessage: z.string().max(2000).optional(),
    /** Accepted then discarded — order event time is not client-controlled */
    timestamp: z.union([z.string(), z.number(), z.date()]).optional(),
  })
  .strict()

export const ecommerceOrderCreateSchema = z
  .object({
    id: z.string().max(64).optional(),
    customerName: z.string().max(300).optional(),
    customerEmail: z.string().max(320).optional(),
    deliveryAddress: z.string().max(2000).optional(),
    city: z.string().max(200).optional(),
    postalCode: z.string().max(40).optional(),
    deliveryNotes: z.string().max(2000).optional(),
    deliveryOption: z.string().max(120).optional(),
    deliveryFee: z.number().min(0).max(50_000).optional(),
    items: z.array(minimalInventoryLineSchema).min(1).max(200),
  })
  .strict()

/**
 * PUT /api/ecommerce/orders — staff-only (Catha `sales.orders` edit).
 * Customers must not use this route; `status` is a closed enum (never trust arbitrary client strings).
 */
export const ecommerceStaffOrderPutSchema = z
  .object({
    id: z.string().min(1).max(64),
    status: z.enum(['cancelled', 'completed']),
  })
  .strict()

/** Menu order create — public */
export const menuOrderCreateSchema = z
  .object({
    orderId: z.string().min(1).max(80),
    tableId: z.string().max(80).optional(),
    tableNumber: z.union([z.string(), z.number()]).optional(),
    customerNumber: z.union([z.string().max(40), z.null()]).optional(),
    customerPart: z.union([z.string().max(40), z.null()]).optional(),
    guestSessionId: z.union([z.string().max(120), z.null()]).optional(),
    customerPhone: z.union([z.string().max(40), z.null()]).optional(),
    status: z.string().max(40).optional(),
    paymentMethod: z.union([z.string().max(40), z.null()]).optional(),
    items: z.array(minimalInventoryLineSchema).min(1).max(200),
    receivedBy: z.union([z.string().max(200), z.null()]).optional(),
    cancelledReason: z.union([z.string().max(500), z.null()]).optional(),
  })
  .strict()

export const menuOrderPutSchema = z
  .object({
    orderId: z.string().min(1).max(80),
    mpesaReceiptNumber: z.union([z.string().max(64), z.null()]).optional(),
    status: z.string().max(40).optional(),
    paymentStatus: z.string().max(40).optional(),
    paymentMethod: z.union([z.string().max(40), z.null()]).optional(),
    items: z.array(minimalInventoryLineSchema).max(200).optional(),
    customerPhone: z.union([z.string().max(40), z.null()]).optional(),
    receivedBy: z.union([z.string().max(200), z.null()]).optional(),
  })
  .strict()

/** Shop cart: only SKU + quantity (+ size). Names/prices/images are server-derived. */
export const shopCartLineIntentSchema = z
  .object({
    productId: z.string().min(1).optional(),
    id: z.string().min(1).optional(),
    quantity: z.coerce.number().int().min(1).max(999),
    size: z.string().max(120).optional(),
  })
  .strict()
  .refine((d) => Boolean((d.productId && d.productId.trim()) || (d.id && d.id.trim())), {
    message: 'productId or id required',
  })

export const shopCartReplaceSchema = z
  .object({
    items: z.array(shopCartLineIntentSchema).max(200),
  })
  .strict()

export const shopCartAddItemsSchema = z
  .object({
    items: z.array(shopCartLineIntentSchema).min(1).max(50).optional(),
    item: shopCartLineIntentSchema.optional(),
  })
  .strict()
  .refine((d) => (d.items != null && d.items.length > 0) || d.item != null, {
    message: 'Provide items array or item',
  })

export const shopCartQuantityUpdateSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            uniqueId: z.string().min(1),
            quantity: z.number().int().min(1).max(999),
          })
          .strict()
      )
      .optional(),
    uniqueId: z.string().optional(),
    quantity: z.number().int().min(1).max(999).optional(),
  })
  .strict()

export function formatZodError(e: z.ZodError): { error: string; details: unknown } {
  return { error: 'Invalid request body', details: e.flatten() }
}
