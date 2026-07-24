"use client"

import React, { memo, useEffect, useRef, useState } from "react"
import { ShoppingCart } from "lucide-react"
import { CartItem } from "@/types/menu"
import { motion, AnimatePresence } from "framer-motion"
import { cn } from "@/lib/utils"
import styles from "./sticky-cart-bar.module.css"

interface StickyCartBarProps {
  items: CartItem[]
  total: number
  onOpenCart: () => void
  /** Hide when a sheet is open */
  hidden?: boolean
}

export const StickyCartBar = memo(function StickyCartBar({
  items,
  total,
  onOpenCart,
  hidden = false,
}: StickyCartBarProps) {
  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0)
  const [pulse, setPulse] = useState(false)
  const [countFlash, setCountFlash] = useState(false)
  const prevCount = useRef(itemCount)

  useEffect(() => {
    if (itemCount > prevCount.current) {
      setPulse(true)
      setCountFlash(true)
      const t = setTimeout(() => setPulse(false), 700)
      const t2 = setTimeout(() => setCountFlash(false), 300)
      prevCount.current = itemCount
      return () => {
        clearTimeout(t)
        clearTimeout(t2)
      }
    }
    prevCount.current = itemCount
  }, [itemCount])

  return (
    <AnimatePresence>
      {itemCount > 0 && !hidden && (
        <motion.div
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 80, opacity: 0 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          className={styles.bar}
        >
          <button
            onClick={onOpenCart}
            className={cn(styles.button, pulse && styles.buttonPulse)}
          >
            <div className={styles.left}>
              <div className={cn(styles.iconWrap, countFlash && styles.iconFlash)}>
                <ShoppingCart className="h-4 w-4" />
                <span className={cn(styles.countBadge, countFlash && styles.countFlash)}>
                  {itemCount}
                </span>
              </div>
              <p className={styles.summary}>
                <span key={itemCount} className={cn(countFlash && styles.countTick)}>
                  {itemCount}
                </span>{" "}
                {itemCount === 1 ? "item" : "items"} · KES{" "}
                {(Number(total) || 0).toLocaleString()}
              </p>
            </div>
            <div className={styles.cta}>
              <span>View cart →</span>
            </div>
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  )
})
