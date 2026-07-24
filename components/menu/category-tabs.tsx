"use client"

import React, { memo, useRef, useEffect } from "react"
import { MenuCategory } from "@/types/menu"
import { cn } from "@/lib/utils"
import { categoryIconFor, IconJaba } from "./category-icons"
import styles from "./category-tabs.module.css"

interface CategoryTabsProps {
  categories: MenuCategory[]
  selectedCategory: string
  onCategoryChange: (category: string) => void
  onJabaClick?: () => void
  hasJaba?: boolean
  counts?: Record<string, number>
  totalCount?: number
}

const shortLabelMap: Record<string, string> = {
  "soft-drinks": "Soft drinks",
  "energy-drinks": "Energy",
  cocktails: "Cocktails",
  whiskey: "Whiskey",
  whisky: "Whiskey",
}

export const CategoryTabs = memo(function CategoryTabs({
  categories,
  selectedCategory,
  onCategoryChange,
  onJabaClick,
  hasJaba = false,
  counts = {},
  totalCount = 0,
}: CategoryTabsProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (activeRef.current && scrollRef.current) {
      const container = scrollRef.current
      const button = activeRef.current
      const scrollTo =
        button.offsetLeft - container.offsetWidth / 2 + button.offsetWidth / 2
      container.scrollTo({ left: scrollTo, behavior: "smooth" })
    }
  }, [selectedCategory])

  const allCategories = [{ id: "all", name: "All" }, ...categories]

  return (
    <div className={styles.wrap}>
      <div className={styles.track}>
        <div className={styles.fadeLeft} aria-hidden />
        <div className={styles.fadeRight} aria-hidden />

        <div ref={scrollRef} className={styles.scroll}>
          {hasJaba && (
            <>
              <button
                type="button"
                onClick={onJabaClick}
                className={styles.pill}
              >
                <span className={styles.iconWrap}>
                  <IconJaba className={styles.icon} />
                </span>
                <span className={styles.label}>Jaba</span>
              </button>
              <span className={styles.divider} aria-hidden />
            </>
          )}

          {allCategories.map((cat) => {
            const isActive = selectedCategory === cat.id
            const label = shortLabelMap[cat.id] ?? cat.name
            const count = cat.id === "all" ? totalCount : (counts[cat.id] ?? 0)
            const Icon = categoryIconFor(cat.id)

            return (
              <button
                key={cat.id}
                ref={isActive ? activeRef : undefined}
                type="button"
                onClick={() => onCategoryChange(cat.id)}
                className={cn(styles.pill, isActive && styles.pillActive)}
                aria-pressed={isActive}
              >
                <span className={styles.iconWrap}>
                  <Icon className={styles.icon} />
                </span>
                <span className={styles.label}>
                  {isActive && count > 0 ? `${label} · ${count}` : label}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
})
