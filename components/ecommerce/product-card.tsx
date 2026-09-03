"use client"

import Link from "next/link"
import Image from "next/image"
import { Check, ShoppingCart } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { EcommerceProduct, getProductDisplayName } from "@/lib/ecommerce-data"
import { cn } from "@/lib/utils"
import { memo, useEffect, useRef, useState } from "react"

interface ProductCardProps {
  product: EcommerceProduct
  onAddToCart?: (product: EcommerceProduct) => void
  onBuyNow?: (product: EcommerceProduct) => void
  compact?: boolean
}

export const ProductCard = memo(function ProductCard({ product, onAddToCart, onBuyNow, compact = false }: ProductCardProps) {
  const [isAdded, setIsAdded] = useState(false)
  const addedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const discount = product.originalPrice
    ? Math.round(((product.originalPrice - product.price) / product.originalPrice) * 100)
    : 0
  const badgeBase = "absolute z-20 rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] shadow-md"

  useEffect(() => {
    return () => {
      if (addedTimerRef.current) {
        clearTimeout(addedTimerRef.current)
      }
    }
  }, [])

  return (
    <div className={cn(
      "group relative flex w-full min-w-0 flex-col overflow-hidden hover-lift bg-[#faf6ef] border border-[#deceba] shadow-[0_8px_20px_rgba(55,36,24,0.12)]",
      compact ? "rounded-lg sm:rounded-xl" : "rounded-xl sm:rounded-2xl"
    )}>
      <Link href={`/product/${product.id}`} prefetch={false} className="flex-1 flex flex-col">
        {/* Image Container */}
        <div className={cn(
          "relative w-full overflow-hidden bg-gradient-to-br from-[#efe5d7] to-[#f8f2e8]",
          compact ? "aspect-[3/4]" : "aspect-[4/5] sm:aspect-[5/6]"
        )}>
          {discount > 0 && (
            <Badge className={cn(
              badgeBase,
              "bg-[var(--brand-espresso-soft)] text-[#f8e8cc] border border-[var(--brand-orange)]/35",
              compact ? "top-1 left-1" : "top-1.5 left-1.5 sm:top-3 sm:left-3 sm:text-xs sm:px-2 sm:py-1"
            )}>
              Save {discount}%
            </Badge>
          )}
          {product.featured && (
            <Badge className={cn(
              badgeBase,
              "bg-[color-mix(in_srgb,var(--brand-green)_20%,var(--brand-espresso)_80%)] text-[#ebf5ed] border border-[var(--brand-green)]/45",
              compact ? "top-1 right-1" : "top-1.5 right-1.5 sm:top-3 sm:right-3 sm:text-xs sm:px-2 sm:py-1"
            )}>
              Top Shelf
            </Badge>
          )}
          {product.trending && (
            <Badge className={cn(
              badgeBase,
              "bg-[var(--brand-espresso)] text-[#f8e8cc] border border-[var(--brand-orange)]/40",
              compact ? "top-1 right-1" : "top-1.5 right-1.5 sm:top-3 sm:right-3 sm:text-xs sm:px-2 sm:py-1"
            )}>
              Trending
            </Badge>
          )}
          
          <Image
            src={product.image}
            alt={getProductDisplayName(product)}
            fill
            className="object-cover transition-all duration-300 group-hover:scale-105"
            sizes={compact ? "(max-width: 640px) 33vw, (max-width: 1024px) 25vw, 20vw" : "(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"}
          />
        </div>

        {/* Content */}
        <div className={cn(
          "flex flex-1 flex-col border-t border-[#dcc9b3]",
          compact ? "p-1.5" : "p-1.5 sm:p-2.5"
        )}>
          <div className={compact ? "mb-1" : "mb-1 sm:mb-1.5"}>
            <p className={cn(
              "font-semibold text-[var(--brand-green-strong)] uppercase tracking-[0.14em]",
              compact ? "text-[8px] mb-0.5" : "text-[9px] sm:text-[10px] mb-0.5 sm:mb-1"
            )}>
              {product.category}
            </p>
            <h3 className={cn(
              "font-semibold text-[#1f1713] line-clamp-2 group-hover:text-[var(--brand-green-strong)] transition-colors font-heading min-h-[2.35rem] sm:min-h-[2.7rem]",
              compact ? "text-[11px] leading-[1.25] mb-0.5" : "text-[13px] sm:text-[15px] leading-[1.3] mb-0.5"
            )}>
              {getProductDisplayName(product)}
            </h3>
          </div>

          {/* Price */}
          <div className="mt-auto flex items-end justify-between">
            <div className="space-y-0.5">
              <p className={cn(
                "font-semibold text-[#241a14] font-display tracking-tight",
                compact ? "text-[11px] sm:text-xs" : "text-[14px] sm:text-base"
              )}>
                KES {product.price.toLocaleString()}
              </p>
              {product.originalPrice && (
                <p className={cn(
                  "text-[#a18f79] line-through",
                  compact ? "text-[9px]" : "text-[10px] sm:text-xs"
                )}>
                  KES {product.originalPrice.toLocaleString()}
                </p>
              )}
            </div>
          </div>
        </div>
      </Link>

      {/* Add to Cart / Buy Now Buttons */}
      {(onAddToCart || onBuyNow) && (
        <div className={cn("space-y-1", compact ? "p-1.5 pt-0" : "p-2 sm:p-2.5 pt-0")}>
          {onAddToCart && (
            <Button
              onClick={async (e) => {
                e.preventDefault()
                setIsAdded(true)
                if (addedTimerRef.current) {
                  clearTimeout(addedTimerRef.current)
                }
                addedTimerRef.current = setTimeout(() => {
                  setIsAdded(false)
                }, 1500)
                try {
                  await onAddToCart(product)
                } catch {
                  if (addedTimerRef.current) {
                    clearTimeout(addedTimerRef.current)
                  }
                  setIsAdded(false)
                }
              }}
              className={cn(
                "w-full min-w-0 overflow-hidden font-medium text-[#f3e4c3] shadow-sm hover:shadow transition-all duration-300 active:scale-[0.98]",
                isAdded
                  ? "bg-gradient-to-r from-[var(--brand-green-strong)] to-[var(--brand-green)] hover:from-[var(--brand-green)] hover:to-[var(--brand-green-strong)] text-[#f6f1e7]"
                  : "bg-[var(--brand-espresso)] hover:bg-[color-mix(in_srgb,var(--brand-espresso)_75%,var(--brand-green)_25%)]",
                compact ? "rounded-lg h-7 text-[10px]" : "rounded-lg sm:rounded-xl h-7 sm:h-9 text-[10px] sm:text-sm",
                !product.inStock && "opacity-50 cursor-not-allowed bg-gray-400",
              )}
              disabled={!product.inStock}
            >
              {isAdded ? (
                <Check className={cn("mr-1.5", compact ? "h-3 w-3" : "h-3.5 w-3 sm:h-4 sm:w-4 sm:mr-2")} />
              ) : (
                <ShoppingCart className={cn("mr-1.5", compact ? "h-3 w-3" : "h-3.5 w-3 sm:h-4 sm:w-4 sm:mr-2")} />
              )}
              <span className="truncate">
                {product.inStock ? (isAdded ? "Added" : "Add to Cart") : "Out of Stock"}
              </span>
            </Button>
          )}
          {onBuyNow && (
            <Button
              onClick={(e) => {
                e.preventDefault()
                onBuyNow(product)
              }}
              variant="outline"
              className={cn(
                "w-full font-medium border-[var(--brand-border-beige)] text-[#5c4724] hover:border-[var(--brand-green)]/45 hover:text-[var(--brand-green-strong)] hover:bg-[var(--brand-green)]/10",
                compact ? "rounded-lg h-7 text-[10px]" : "rounded-lg sm:rounded-xl h-7.5 sm:h-9 text-[11px] sm:text-sm",
                !product.inStock && "opacity-50 cursor-not-allowed",
              )}
              disabled={!product.inStock}
            >
              Buy Now
            </Button>
          )}
        </div>
      )}
    </div>
  )
}, (prevProps, nextProps) => {
  return (
    prevProps.product.id === nextProps.product.id &&
    prevProps.product.price === nextProps.product.price &&
    prevProps.product.inStock === nextProps.product.inStock &&
    prevProps.product.image === nextProps.product.image &&
    prevProps.compact === nextProps.compact
  )
})

