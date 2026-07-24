"use client"

import React, { memo, useEffect } from "react"
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerFooter } from "@/components/ui/drawer"
import { Plus, Minus, Trash2, ShoppingBag, Send, CheckCircle2, Smartphone, Banknote, Check } from "lucide-react"
import { CartItem } from "@/types/menu"
import Image from "next/image"
import { cn } from "@/lib/utils"
import styles from "./cart-drawer.module.css"

export interface SentConfirmation {
  orderLabel: string
  tableNumber: string
}

interface CartDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  items: CartItem[]
  tableNumber?: string
  customerNumber?: string | null
  onUpdateQuantity: (id: string, quantity: number) => void
  onRemove: (id: string) => void
  onSendNow: () => void
  onPayMpesa?: () => void
  total: number
  subtotal?: number
  vat?: number
  existingOrderId?: string | null
  isAddingToExisting?: boolean
  activeOrderStatus?: string
  activeOrderPaymentMethod?: string | null
  activeOrderTotal?: number
  sentConfirmation?: SentConfirmation | null
  onTrackOrder?: () => void
  sending?: boolean
}

export const CartDrawer = memo(function CartDrawer({
  open,
  onOpenChange,
  items,
  tableNumber,
  customerNumber,
  onUpdateQuantity,
  onRemove,
  onSendNow,
  onPayMpesa,
  total,
  existingOrderId: _existingOrderId,
  isAddingToExisting,
  activeOrderStatus,
  activeOrderPaymentMethod,
  activeOrderTotal,
  sentConfirmation,
  onTrackOrder,
  sending = false,
}: CartDrawerProps) {
  const isAlreadySent = activeOrderStatus === "sent" || activeOrderStatus === "active" || activeOrderStatus === "paid"
  const isPaidAlready = activeOrderStatus === "paid"
  const isCashPending = isAlreadySent && !isPaidAlready && activeOrderPaymentMethod === "cash"
  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0)
  const showSent = !!sentConfirmation

  const cartSubtotal = items.reduce(
    (sum, i) => sum + (Number(i.unitPrice) || 0) * (Number(i.quantity) || 0),
    0
  )
  const cartTotal = cartSubtotal

  // Auto-transition to Active Orders after 2s
  useEffect(() => {
    if (!showSent || !onTrackOrder) return
    const t = setTimeout(() => onTrackOrder(), 2000)
    return () => clearTimeout(t)
  }, [showSent, onTrackOrder, sentConfirmation?.orderLabel])

  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        if (showSent && !next) {
          onTrackOrder?.()
          return
        }
        onOpenChange(next)
      }}
    >
      <DrawerContent
        className={cn(styles.drawer, "bg-transparent")}
        style={{
          touchAction: "manipulation",
          background:
            "radial-gradient(ellipse at top center, rgba(200,114,42,0.12), transparent 55%), #2E241B",
        }}
      >
        <div className={styles.handle}>
          <div className={styles.handleBar} />
        </div>

        {showSent && sentConfirmation ? (
          <div className={styles.sentWrap}>
            <div className={styles.sentGlow}>
              <div className={styles.sentCircle}>
                <Check className="h-8 w-8" strokeWidth={2.5} />
              </div>
            </div>
            <h2 className={styles.sentTitle}>Order sent to the bar</h2>
            <p className={styles.sentSub}>
              We&apos;ll bring it to Table {sentConfirmation.tableNumber} · Order{" "}
              {sentConfirmation.orderLabel}
            </p>
            <button
              type="button"
              className={styles.trackBtn}
              onClick={() => onTrackOrder?.()}
            >
              Track order
            </button>
          </div>
        ) : (
          <>
            <DrawerHeader className={styles.header}>
              <DrawerTitle className="flex items-center gap-3">
                <div className={styles.iconBox}>
                  <ShoppingBag className="h-5 w-5" />
                </div>
                <div>
                  <span className={styles.title}>
                    {isAlreadySent ? "Your tab" : isAddingToExisting ? "Add to tab" : "Your Order"}
                  </span>
                  <p className={styles.subtitle}>
                    {itemCount} {itemCount === 1 ? "item" : "items"}
                    {tableNumber && ` · Table ${tableNumber}`}
                    {customerNumber && ` · #${customerNumber}`}
                  </p>
                </div>
                {isAlreadySent && (
                  <span className={isPaidAlready ? styles.statusPaid : styles.statusUnpaid}>
                    <span
                      className={cn(
                        "h-1.5 w-1.5 rounded-full",
                        isPaidAlready ? "bg-[#b98a44]" : "bg-[#D9843B] animate-pulse"
                      )}
                    />
                    {isPaidAlready ? "Paid" : "Unpaid · At Bar"}
                  </span>
                )}
              </DrawerTitle>
            </DrawerHeader>

            <div className={cn(styles.list, "space-y-3")}>
              {items.length === 0 ? (
                <div className={styles.empty}>
                  <div className={styles.emptyIcon}>
                    <ShoppingBag className="h-8 w-8" />
                  </div>
                  <p className="text-[#F5EBDC] font-semibold">Cart is empty</p>
                  <p className="text-[rgba(242,232,216,0.65)] text-sm mt-1">Add something delicious</p>
                </div>
              ) : (
                items.map((item) => (
                  <div key={item.id} className={cn(styles.item, styles.itemPress)}>
                    {item.image && (
                      <div className={styles.thumb}>
                        <Image
                          src={item.image}
                          alt={item.name}
                          fill
                          className="object-cover"
                          sizes="64px"
                        />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <h4 className={styles.itemName}>{item.name}</h4>
                      <p className={styles.itemPrice}>
                        KES {(Number(item.unitPrice) || 0).toLocaleString()}
                      </p>
                      <div className="flex items-center justify-between gap-2 mt-2">
                        <div className={styles.qtyPill}>
                          <button
                            className={cn(styles.qtyBtn, item.quantity === 1 && styles.qtyTrash)}
                            onClick={() =>
                              item.quantity === 1
                                ? onRemove(item.id)
                                : onUpdateQuantity(item.id, item.quantity - 1)
                            }
                            aria-label={item.quantity === 1 ? "Remove item" : "Decrease quantity"}
                          >
                            {item.quantity === 1 ? (
                              <Trash2 className="h-3 w-3" />
                            ) : (
                              <Minus className="h-3 w-3" />
                            )}
                          </button>
                          <span
                            key={item.quantity}
                            className={cn(styles.qtyCount, styles.qtyCountCrossfade)}
                          >
                            {item.quantity}
                          </span>
                          <button
                            className={styles.qtyBtn}
                            onClick={() => onUpdateQuantity(item.id, item.quantity + 1)}
                            aria-label="Increase quantity"
                          >
                            <Plus className="h-3 w-3" />
                          </button>
                        </div>

                        <div className="flex items-center gap-2">
                          <span className={styles.lineTotal}>
                            KES {((Number(item.unitPrice) || 0) * item.quantity).toLocaleString()}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {items.length > 0 && (
              <DrawerFooter className={styles.footer}>
                <div className="space-y-1.5 px-1 pb-1">
                  {isAlreadySent && (
                    <p className="text-[rgba(242,232,216,0.65)] text-[10px] font-semibold uppercase tracking-[0.16em] mb-1">
                      New Items
                    </p>
                  )}
                  <div className="flex justify-between items-center">
                    <span className="text-[rgba(242,232,216,0.65)] text-sm">Subtotal</span>
                    <span className="text-[rgba(242,232,216,0.7)] text-sm font-semibold tabular-nums">
                      KES {cartSubtotal.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className="flex justify-between items-center pt-2 border-t border-[rgba(242,232,216,0.10)]">
                    <span className="text-[#F5EBDC] font-bold text-base">Total</span>
                    <span className="text-xl font-extrabold text-[#D9843B] tabular-nums">
                      KES {cartTotal.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>

                {isAlreadySent ? (
                  <>
                    {isPaidAlready ? (
                      <div className={styles.paidBox}>
                        <CheckCircle2 className="h-5 w-5" strokeWidth={2.5} />
                        <span>Order Paid</span>
                      </div>
                    ) : (
                      <>
                        {activeOrderTotal != null && (
                          <div className="flex justify-between items-center px-1 py-1 border-t border-[rgba(242,232,216,0.14)]">
                            <span className="text-[rgba(242,232,216,0.65)] text-xs font-semibold uppercase tracking-wider">
                              Outstanding
                            </span>
                            <span className="text-[#D9843B] font-extrabold text-lg tabular-nums">
                              KES {activeOrderTotal.toLocaleString()}
                            </span>
                          </div>
                        )}

                        {isCashPending ? (
                          <>
                            <div className={styles.infoCard}>
                              <Banknote className="h-5 w-5 text-[#D9843B] flex-shrink-0" />
                              <div>
                                <p className="text-[#D9843B] text-sm font-bold">Pay at the Teller</p>
                                <p className="text-[rgba(200,114,42,0.65)] text-xs mt-0.5">
                                  Please have KES {(activeOrderTotal ?? 0).toLocaleString()} ready in cash
                                </p>
                              </div>
                            </div>
                            {onPayMpesa && (
                              <button
                                onClick={() => { onPayMpesa(); onOpenChange(false) }}
                                className={styles.mpesaCta}
                              >
                                <Smartphone className="h-4 w-4" strokeWidth={2.5} />
                                Pay via M-Pesa instead · KES {(activeOrderTotal ?? 0).toLocaleString()}
                              </button>
                            )}
                          </>
                        ) : (
                          <div className={cn(styles.infoCard, "bg-[#261E17] border-[rgba(242,232,216,0.14)]")}>
                            <Banknote className="h-5 w-5 text-[#D9843B] flex-shrink-0" />
                            <div>
                              <p className="text-[#F5EBDC] text-sm font-bold">Order at Bar — Awaiting Payment</p>
                              <p className="text-[rgba(242,232,216,0.65)] text-xs mt-0.5">Payment will be collected</p>
                            </div>
                          </div>
                        )}

                        {items.length > 0 && (
                          <button
                            onClick={onSendNow}
                            disabled={sending}
                            className={styles.secondaryCta}
                          >
                            <Send className={cn("h-4 w-4", sending && styles.planeFly)} strokeWidth={2.5} />
                            Send to tab · KES {cartTotal.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </button>
                        )}
                      </>
                    )}
                  </>
                ) : (
                  <button
                    onClick={onSendNow}
                    disabled={sending}
                    className={styles.primaryCta}
                  >
                    <Send className={cn("h-4 w-4", sending && styles.planeFly)} strokeWidth={2.5} />
                    {sending ? "Sending…" : "Send to tab"}
                  </button>
                )}

                <button
                  onClick={() => onOpenChange(false)}
                  className={styles.ghostCta}
                >
                  {isAlreadySent ? "Close" : "Keep Browsing"}
                </button>
              </DrawerFooter>
            )}
          </>
        )}
      </DrawerContent>
    </Drawer>
  )
})
