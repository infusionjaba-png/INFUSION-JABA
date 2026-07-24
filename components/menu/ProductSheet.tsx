"use client"

import React, { memo, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Plus, Minus, X, Flame, Expand } from "lucide-react"
import Image from "next/image"
import { MenuItem } from "@/types/menu"
import { cn } from "@/lib/utils"
import {
  motion,
  AnimatePresence,
  useMotionValue,
  useTransform,
  useDragControls,
  animate,
} from "framer-motion"
import {
  eyebrowFor,
  tastingNotesFor,
  pairingFor,
  servingLabel,
} from "./product-meta"
import styles from "./product-sheet.module.css"

interface ProductSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  item: MenuItem | null
  quantity: number
  servings?: MenuItem[]
  onSelectServing?: (item: MenuItem) => void
  /** Confirm qty for the active SKU (add or update) */
  onConfirm: (item: MenuItem, quantity: number) => void
  onRemoveFromOrder?: (itemId: string) => void
}

const SPRING = { type: "spring" as const, stiffness: 380, damping: 32, mass: 0.9 }

export const ProductSheet = memo(function ProductSheet({
  open,
  onOpenChange,
  item,
  quantity,
  servings = [],
  onSelectServing,
  onConfirm,
  onRemoveFromOrder,
}: ProductSheetProps) {
  const [isDesktop, setIsDesktop] = useState(false)
  const [localQty, setLocalQty] = useState(1)
  const [flash, setFlash] = useState(false)
  const [imageExpanded, setImageExpanded] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const dragControls = useDragControls()
  const dragY = useMotionValue(0)
  const dragOpacity = useTransform(dragY, [0, 160], [1, 0.55])

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)")
    const apply = () => setIsDesktop(mq.matches)
    apply()
    mq.addEventListener("change", apply)
    return () => mq.removeEventListener("change", apply)
  }, [])

  useEffect(() => {
    if (open) {
      setLocalQty(Math.max(1, quantity || 1))
      setFlash(false)
      setImageExpanded(false)
      dragY.set(0)
      if (scrollRef.current) scrollRef.current.scrollTop = 0
    } else {
      setImageExpanded(false)
    }
  }, [open, item?.id, quantity, dragY])

  useEffect(() => {
    if (!imageExpanded) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setImageExpanded(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [imageExpanded])

  if (!item) return null

  const options = servings.length > 1 ? servings : []
  const unitPrice = Number(item.price) || 0
  const lineTotal = unitPrice * localQty
  const inOrder = quantity > 0
  const eyebrow = eyebrowFor(item)
  const notes = tastingNotesFor(item)
  const pairing = pairingFor(item)

  const handleConfirm = () => {
    if (!item.inStock) return
    setFlash(true)
    onConfirm(item, localQty)
    setTimeout(() => {
      onOpenChange(false)
      setFlash(false)
    }, 320)
  }

  const content = (
    <motion.div
      className={styles.panel}
      style={isDesktop ? undefined : { y: dragY, opacity: dragOpacity }}
      initial={isDesktop ? { opacity: 0, scale: 0.96 } : { y: 36 }}
      animate={isDesktop ? { opacity: 1, scale: 1 } : { y: 0 }}
      transition={SPRING}
      drag={isDesktop ? false : "y"}
      dragControls={dragControls}
      dragListener={false}
      dragConstraints={{ top: 0, bottom: 0 }}
      dragElastic={{ top: 0.04, bottom: 0.55 }}
      onDragEnd={(_, info) => {
        if (info.offset.y > 90 || info.velocity.y > 650) {
          onOpenChange(false)
        } else {
          animate(dragY, 0, SPRING)
        }
      }}
    >
      <div ref={scrollRef} className={styles.scroll}>
        {/* Hero — exactly 150px; pointer on hero starts sheet dismiss drag */}
        <div
          className={styles.hero}
          onPointerDown={(e) => {
            if (isDesktop) return
            // Don't steal the close button
            if ((e.target as HTMLElement).closest("button")) return
            dragControls.start(e)
          }}
        >
          <div className={styles.handle} aria-hidden />
          <motion.div
            layoutId={`product-image-${item.id}`}
            className={styles.heroImageWrap}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          >
            <Image
              src={item.image || "/placeholder.jpg"}
              alt={item.name}
              fill
              className={styles.heroImage}
              sizes="100vw"
              priority
            />
            <div className={styles.heroWarm} />
          </motion.div>
          <div className={styles.heroScrim} />

          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className={styles.close}
            aria-label="Close"
          >
            <X className="h-3.5 w-3.5" strokeWidth={2.5} />
          </button>

          {item.image && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setImageExpanded(true)
              }}
              className={styles.expand}
              aria-label="View full image"
            >
              <Expand className="h-3.5 w-3.5" strokeWidth={2.5} />
            </button>
          )}

          {eyebrow && (
            <div className={styles.eyebrowStrip}>
              <p className={styles.eyebrow}>{eyebrow}</p>
            </div>
          )}
        </div>

        {/* Body — natural flow, no spacer / flex-grow */}
        <div className={styles.body}>
          {isDesktop ? (
            <DialogTitle className="sr-only">{item.name}</DialogTitle>
          ) : (
            <SheetTitle className="sr-only">{item.name}</SheetTitle>
          )}

          <div className={styles.titleRow}>
            <h2 className={styles.title}>{item.name}</h2>
            <span key={unitPrice} className={styles.price}>
              KES {unitPrice.toLocaleString()}
            </span>
          </div>

          <p className={styles.desc}>{notes}</p>

          {options.length > 0 && (
            <div className={styles.servings} role="radiogroup" aria-label="Serving">
              {options.map((opt) => {
                const selected = opt.id === item.id
                return (
                  <button
                    key={opt.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    disabled={!opt.inStock && !selected}
                    className={cn(styles.serving, selected && styles.servingSelected)}
                    onClick={() => onSelectServing?.(opt)}
                  >
                    <span className={styles.servingLabel}>
                      {servingLabel(opt)}
                    </span>
                    <span className={styles.servingPrice}>
                      KES {(Number(opt.price) || 0).toLocaleString()}
                    </span>
                  </button>
                )
              })}
            </div>
          )}

          <p className={styles.pairing}>
            <Flame className={styles.pairingIcon} strokeWidth={2.5} />
            {pairing}
          </p>

          {/* Action row — IN CONTENT FLOW, directly after pairing */}
          {!item.inStock ? (
            <div className={styles.oosBox}>Currently out of stock</div>
          ) : (
            <>
              <div className={styles.actionRow}>
                <div className={styles.stepper}>
                  <button
                    type="button"
                    className={cn(styles.stepBtn, styles.stepMinus)}
                    aria-label="Decrease quantity"
                    disabled={localQty <= 1 && !inOrder}
                    onClick={() => setLocalQty((q) => Math.max(1, q - 1))}
                  >
                    <Minus className="h-4 w-4" strokeWidth={2.5} />
                  </button>
                  <span key={localQty} className={styles.stepCount}>
                    {localQty}
                  </span>
                  <button
                    type="button"
                    className={cn(styles.stepBtn, styles.stepPlus)}
                    aria-label="Increase quantity"
                    onClick={() => setLocalQty((q) => q + 1)}
                  >
                    <Plus className="h-4 w-4" strokeWidth={2.5} />
                  </button>
                </div>

                <button
                  type="button"
                  onClick={handleConfirm}
                  className={cn(styles.cta, flash && styles.ctaFlash)}
                >
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.span
                      key={`${inOrder ? "u" : "a"}-${lineTotal}`}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: 0.18 }}
                      className={styles.ctaTotal}
                    >
                      {inOrder ? "Update" : "Add"}
                      {" · "}
                      KES {lineTotal.toLocaleString()}
                    </motion.span>
                  </AnimatePresence>
                </button>
              </div>

              {inOrder && onRemoveFromOrder && (
                <button
                  type="button"
                  className={styles.removeBtn}
                  onClick={() => {
                    onRemoveFromOrder(item.id)
                    onOpenChange(false)
                  }}
                >
                  Remove
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </motion.div>
  )

  const lightbox =
    typeof document !== "undefined"
      ? createPortal(
          <AnimatePresence>
            {imageExpanded && item.image && (
              <motion.div
                className={styles.lightbox}
                role="dialog"
                aria-modal="true"
                aria-label={`${item.name} — full image`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.22 }}
                onClick={() => setImageExpanded(false)}
              >
                <button
                  type="button"
                  className={styles.lightboxClose}
                  aria-label="Close full image"
                  onClick={() => setImageExpanded(false)}
                >
                  <X className="h-4 w-4" strokeWidth={2.5} />
                </button>
                <motion.div
                  className={styles.lightboxFrame}
                  initial={{ opacity: 0, scale: 0.94 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={item.image}
                    alt={item.name}
                    className={styles.lightboxImage}
                  />
                  <p className={styles.lightboxCaption}>{item.name}</p>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body
        )
      : null

  return isDesktop ? (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className={styles.dialogShell}
        aria-describedby={undefined}
      >
        {content}
      </DialogContent>
      {lightbox}
    </Dialog>
  ) : (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        showClose={false}
        className={styles.sheetShell}
        overlayClassName="bg-[rgba(10,8,6,0.65)]"
      >
        {content}
      </SheetContent>
      {lightbox}
    </Sheet>
  )
})
