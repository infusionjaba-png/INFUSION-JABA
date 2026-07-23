"use client"

import React, { memo, useCallback, useEffect, useRef, useState } from "react"
import Image from "next/image"
import { createPortal } from "react-dom"
import { motion } from "framer-motion"
import { Plus, Minus, Trash2 } from "lucide-react"
import { MenuItem } from "@/types/menu"
import { cn } from "@/lib/utils"
import { tastingNotesFor } from "./product-meta"
import styles from "./product-card.module.css"

interface ProductCardProps {
  item: MenuItem
  quantity?: number
  onAdd: (item: MenuItem) => void
  onUpdateQuantity?: (id: string, quantity: number) => void
  onClick?: (item: MenuItem) => void
}

export const ProductCard = memo(function ProductCard({
  item,
  quantity = 0,
  onAdd,
  onUpdateQuantity,
  onClick,
}: ProductCardProps) {
  const inCart = quantity > 0
  const cardRef = useRef<HTMLDivElement>(null)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressTriggered = useRef(false)
  const [quickLook, setQuickLook] = useState<{ x: number; y: number } | null>(null)

  const clearLongPress = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }, [])

  const openQuickLook = useCallback(() => {
    const el = cardRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const width = Math.min(280, window.innerWidth - 32)
    let x = rect.left + rect.width / 2 - width / 2
    x = Math.max(16, Math.min(x, window.innerWidth - width - 16))
    let y = rect.top - 8
    if (y + 320 > window.innerHeight) y = Math.max(16, rect.bottom - 320)
    setQuickLook({ x, y })
  }, [])

  const startLongPress = useCallback(() => {
    longPressTriggered.current = false
    clearLongPress()
    longPressTimer.current = setTimeout(() => {
      longPressTriggered.current = true
      openQuickLook()
    }, 480)
  }, [clearLongPress, openQuickLook])

  useEffect(() => () => clearLongPress(), [clearLongPress])

  useEffect(() => {
    if (!quickLook) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setQuickLook(null)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [quickLook])

  const categoryChip = item.categoryLabel || item.category
  const volume = item.volumeLabel || item.description

  return (
    <>
      <div
        ref={cardRef}
        className={cn(styles.card, inCart && styles.cardInOrder)}
        onClick={() => {
          if (longPressTriggered.current) {
            longPressTriggered.current = false
            return
          }
          onClick?.(item)
        }}
        onContextMenu={(e) => e.preventDefault()}
        onTouchStart={startLongPress}
        onTouchEnd={clearLongPress}
        onTouchMove={clearLongPress}
        onMouseDown={(e) => {
          if (e.button === 0) startLongPress()
        }}
        onMouseUp={clearLongPress}
        onMouseLeave={clearLongPress}
      >
        <div className={styles.glow} />

        <motion.div
          layoutId={`product-image-${item.id}`}
          className={cn(styles.imageWrap, !item.inStock && styles.imageWrapOos)}
          transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        >
          <Image
            src={item.image || "/placeholder.jpg"}
            alt={item.name}
            fill
            className={styles.image}
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
            priority={item.isPopular}
          />
          <div className={styles.imageWarm} />
          <div className={styles.imageScrim} />
          {categoryChip && (
            <span className={styles.categoryChip}>{categoryChip}</span>
          )}
          {!item.inStock && (
            <div className={styles.oos}>
              <span className={styles.oosLabel}>Out of stock</span>
            </div>
          )}
        </motion.div>

        <div className={styles.body}>
          <h3 className={styles.name}>{item.name}</h3>
          <p className={styles.volume}>{volume || "\u00A0"}</p>
          <div className={styles.footer}>
            <span className={cn(styles.price, !item.inStock && styles.priceDim)}>
              KES {(Number(item.price) || 0).toLocaleString()}
            </span>
            {inCart && onUpdateQuantity ? (
              <div
                className={styles.stepper}
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  className={cn(styles.stepBtn, quantity === 1 && styles.stepTrash)}
                  aria-label={quantity === 1 ? "Remove from cart" : "Decrease quantity"}
                  onClick={() => onUpdateQuantity(item.id, quantity - 1)}
                >
                  {quantity === 1 ? (
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={2.5} />
                  ) : (
                    <Minus className="h-3.5 w-3.5" strokeWidth={2.5} />
                  )}
                </button>
                <span key={quantity} className={styles.stepCount}>
                  {quantity}
                </span>
                <button
                  type="button"
                  className={styles.stepBtn}
                  aria-label="Increase quantity"
                  onClick={() => onUpdateQuantity(item.id, quantity + 1)}
                >
                  <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
                </button>
              </div>
            ) : (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  if (item.inStock) onAdd(item)
                }}
                disabled={!item.inStock}
                aria-label={`Add ${item.name} to cart`}
                className={cn(styles.addBtn, !item.inStock && styles.addBtnGhost)}
              >
                + Add
              </button>
            )}
          </div>
        </div>
      </div>

      {quickLook &&
        typeof document !== "undefined" &&
        createPortal(
          <>
            <div
              className={styles.quickLookBackdrop}
              onClick={() => setQuickLook(null)}
            />
            <div
              className={styles.quickLook}
              style={{ left: quickLook.x, top: quickLook.y }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className={styles.quickLookImg}>
                <Image
                  src={item.image || "/placeholder.jpg"}
                  alt={item.name}
                  fill
                  className={styles.image}
                  sizes="280px"
                />
                <div className={styles.imageWarm} />
                <div className={styles.imageScrim} />
              </div>
              <div className={styles.quickLookBody}>
                <h4 className={styles.quickLookName}>{item.name}</h4>
                <p className={styles.quickLookDesc}>
                  {tastingNotesFor(item)}
                </p>
                <div className={styles.quickLookFooter}>
                  <span className={styles.price}>
                    KES {(Number(item.price) || 0).toLocaleString()}
                  </span>
                  <button
                    type="button"
                    className={styles.addBtn}
                    disabled={!item.inStock}
                    onClick={() => {
                      if (item.inStock) onAdd(item)
                      setQuickLook(null)
                    }}
                  >
                    + Add
                  </button>
                </div>
              </div>
            </div>
          </>,
          document.body
        )}
    </>
  )
})
