"use client"

import type React from "react"
import dynamic from "next/dynamic"
import { useState, useMemo, useEffect, useCallback, useRef } from "react"

// Lazy load heavy modals - load only when needed for faster initial page load
const ReceiptModal = dynamic(() => import("@/components/receipt").then((m) => ({ default: m.ReceiptModal })), { ssr: false })
const TablePanel = dynamic(() => import("@/components/pos/table-panel").then((m) => ({ default: m.TablePanel })), { ssr: false })
import { ShiftWidget } from "@/components/pos/shift-widget"
import { POSProductCard } from "@/components/pos/product-card"
import { SegmentedToggle } from "@/components/pos/segmented-toggle"
import { CartItemRow } from "@/components/pos/cart-item-row"
import { OrderInputField } from "@/components/pos/order-input-field"
import { InfoChip } from "@/components/pos/info-chip"
import { CustomerFields } from "@/components/pos/customer-fields"
import { normalizeKenyaPhone, isValidKenyaPhone, getPhoneValidationError } from "@/lib/phone-utils"
import { createCathaOrderId } from "@/lib/catha-order-id"
import { normalizeMpesaStatus } from "@/lib/mpesa-status"
import { summarizeCathaOrderPayments } from "@/lib/catha-order-payments"
import { Home, UtensilsCrossed } from "lucide-react"
import { categories, staff, type Product, type Transaction, type Staff } from "@/lib/dummy-data"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useRouter } from "next/navigation"
import { useDebounce } from "@/hooks/use-debounce"
import { useInfiniteScroll } from "@/hooks/use-infinite-scroll"
import { useSession } from "next-auth/react"
import {
  Search,
  Grid3X3,
  Minus,
  CreditCard,
  Smartphone,
  Truck,
  Receipt,
  Trash2,
  Wine,
  Beer,
  GlassWater,
  Martini,
  Leaf,
  Sparkles,
  Coffee,
  Grape,
  CircleDot,
  ShoppingCart,
  X,
  Menu,
  Plus,
  ChevronLeft,
  Clock,
  Loader2,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import {
  buildPosDiscountContextFromApi,
  resolvePosPrice,
  buildCampaignsMapFromApi,
  getActiveCampaignBanners,
  type PromotionConflictMode,
} from "@/lib/pos-discount-client"
import { PromotionCampaignBanner, type PromotionBannerData } from "@/components/pos/promotion-campaign-banner"

interface CartItem extends Product {
  quantity: number
  size?: string
  isCustom?: boolean
}

/** API line items: strict schema — inventory lines are intent-only (productId, quantity, size); server resolves names/prices */
function mapCartToOrderLineItems(cart: CartItem[]) {
  return cart.map((item) => {
    if (item.isCustom) {
      return {
        isCustomItem: true as const,
        lineType: "custom" as const,
        name: item.name.trim(),
        quantity: item.quantity,
        price: item.price,
      }
    }
    const line: { productId: string; quantity: number; size?: string } = {
      productId: item.id,
      quantity: item.quantity,
    }
    if (item.size && String(item.size).trim()) {
      line.size = String(item.size).trim()
    }
    return line
  })
}

async function readOrderApiError(response: Response, fallback: string) {
  try {
    const err = await response.json()
    const msg = typeof err?.error === "string" ? err.error : typeof err?.message === "string" ? err.message : fallback
    console.error("[POS] Order API error:", response.status, err)
    return msg
  } catch {
    console.error("[POS] Order API error:", response.status, "(no JSON body)")
    return fallback
  }
}

/** Every POS POST to /api/catha/orders must include this; API returns 400 if non-empty while editing. */
function posNewOrderClientGuardPayload(editingOrderId: string | null) {
  return { clientEditingOrderId: editingOrderId ?? null }
}

function recordMpesaPromptOutcomeOnOrder(
  orderId: string,
  fields: { mpesaLastPromptStatus: string; mpesaLastPromptMessage: string }
) {
  return fetch("/api/catha/orders", {
    method: "PUT",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: orderId,
      mpesaLastPromptAt: new Date().toISOString(),
      ...fields,
    }),
  })
}

interface ProductWithSize extends Product {
  size?: string
}

// Category icons mapping - use function to avoid creating React elements at module level
const getCategoryIcon = (categoryId: string) => {
  const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
    whiskey: Wine,
    vodka: Martini,
    rum: GlassWater,
    gin: Leaf,
    beer: Beer,
    wine: Grape,
    cocktails: Sparkles,
    "soft-drinks": Coffee,
  }
  const IconComponent = iconMap[categoryId] || CircleDot
  return <IconComponent className="h-5 w-5" />
}

// In-memory cache for instant repeat loads - short TTL to avoid wrong stock (POS-critical)
const PRODUCTS_CACHE_TTL_MS = 5_000 // 5 seconds - stock must stay near real-time

type PosDiscountApiRecord = {
  productId: string
  discountType: "percentage" | "fixed"
  discountValue: number
  status: "active" | "inactive"
  startAt?: string | null
  endAt?: string | null
  promotionName?: string | null
  eligibilityScope?: "everyone" | "selected_customers" | "customer_group" | "loyalty_tier" | "membership_plan"
  eligibleCustomers?: string[]
  campaignId?: string | null
}

type PosCampaignApiRecord = {
  id: string
  name: string
  description?: string | null
  status: "active" | "inactive" | "archived"
  priority: number
  startAt?: string | null
  endAt?: string | null
  color?: string | null
  icon?: string | null
}

type PosCategoryDiscountApiRecord = {
  category: string
  discountType: "percentage" | "fixed"
  discountValue: number
  status: "active" | "inactive"
  startAt?: string | null
  endAt?: string | null
  promotionName?: string | null
  eligibilityScope?: "everyone" | "selected_customers" | "customer_group" | "loyalty_tier" | "membership_plan"
  eligibleCustomers?: string[]
  campaignId?: string | null
}

type PosInventoryDiscountCache = {
  raw: unknown[]
  productRules: PosDiscountApiRecord[]
  categoryRules: PosCategoryDiscountApiRecord[]
  campaigns: PosCampaignApiRecord[]
  conflictMode: PromotionConflictMode
  disabledCampaignIds: string[]
  mappedAt: number
}

let _posInventoryDiscountCache: PosInventoryDiscountCache | null = null

function mapProductsWithPosDiscounts(
  raw: unknown[],
  productRules: PosDiscountApiRecord[],
  categoryRules: PosCategoryDiscountApiRecord[],
  campaigns: PosCampaignApiRecord[],
  customerId?: string | null,
  conflictMode: PromotionConflictMode = "never_stack",
  disabledCampaignIds: string[] = []
): Product[] {
  const campaignsMap = buildCampaignsMapFromApi(campaigns)
  const ctx = buildPosDiscountContextFromApi(
    productRules,
    categoryRules,
    campaignsMap,
    new Date(),
    conflictMode,
    new Set(disabledCampaignIds)
  )

  return (raw || []).map((p: any) => {
    const id = p.id || p._id || p.barcode || p.name || "unknown-product"
    const catalogPrice = Number(p.price || 0)
    const category = p.category || "other"
    const base: Product = {
      id,
      name: p.name || "Unknown Product",
      category,
      price: catalogPrice,
      cost: p.cost || 0,
      stock: p.stock || 0,
      minStock: p.minStock || 0,
      image: p.image || "/placeholder.svg?height=150&width=200&query=drink bottle",
      barcode: p.barcode || "",
      unit: p.unit || "item",
      supplier: p.supplier || "Unknown",
      isJaba: p.isJaba || false,
      batchNumber: p.batch || undefined,
      size: p.size || "",
    }

    const applied = resolvePosPrice(catalogPrice, id, category, ctx, customerId)
    if (!applied) return base

    return {
      ...base,
      price: applied.unit,
      originalPrice: applied.originalPrice,
      posDiscount: {
        discountType: applied.posDiscountType,
        discountValue: applied.discountValue,
        discountAmount: applied.posDiscountAmount,
        badgeLabel: applied.badgeLabel,
        promotionName: applied.promotionName,
        source: applied.source,
      },
    }
  })
}

// Colorful icon backgrounds per category
const categoryIconColors: Record<string, string> = {
  whiskey: "bg-amber-500/15 text-amber-700",
  vodka: "bg-sky-500/15 text-sky-700",
  rum: "bg-cyan-500/15 text-cyan-700",
  gin: "bg-emerald-500/15 text-emerald-700",
  beer: "bg-yellow-400/20 text-yellow-700",
  wine: "bg-rose-500/15 text-rose-700",
  cocktails: "bg-pink-500/15 text-pink-700",
  "soft-drinks": "bg-lime-500/15 text-lime-700",
}

export default function POSPage() {
  const router = useRouter()
  const { data: session } = useSession()
  const role = String(session?.user?.role || "").trim().toUpperCase()
  const canManageOwnShift =
    role === "CASHIER" ||
    role === "CASHIER_ADMIN" ||
    role === "ADMIN" ||
    role === "MANAGER_ADMIN" ||
    role === "SUPER_ADMIN"
  const [selectedCategory, setSelectedCategory] = useState("all")
  const [searchQuery, setSearchQuery] = useState("")
  const debouncedSearchQuery = useDebounce(searchQuery, 300) // Debounce search by 300ms
  const [selectedTable, setSelectedTable] = useState<number | null>(null)
  const [orderType, setOrderType] = useState<"INHOUSE" | "TAKEOUT">("INHOUSE")
  const [tableNumberInput, setTableNumberInput] = useState("")
  const [tableError, setTableError] = useState<string | null>(null)
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<"GLOVO" | "MPESA" | null>(null)
  const [customerName, setCustomerName] = useState("")
  const [customerPhone, setCustomerPhone] = useState("")
  const [phoneError, setPhoneError] = useState<string | null>(null)
  const posCustomerId = useMemo(
    () => (customerPhone ? normalizeKenyaPhone(customerPhone) : null),
    [customerPhone]
  )
  const inventoryRawRef = useRef<unknown[]>([])
  const productRulesRef = useRef<PosDiscountApiRecord[]>([])
  const categoryRulesRef = useRef<PosCategoryDiscountApiRecord[]>([])
  const campaignsRef = useRef<PosCampaignApiRecord[]>([])
  const conflictModeRef = useRef<PromotionConflictMode>("never_stack")
  const disabledCampaignIdsRef = useRef<string[]>([])
  const [products, setProducts] = useState<Product[]>([])

  const promotionBanner = useMemo((): PromotionBannerData | null => {
    const campaignsMap = buildCampaignsMapFromApi(campaignsRef.current)
    const ctx = buildPosDiscountContextFromApi(
      productRulesRef.current,
      categoryRulesRef.current,
      campaignsMap,
      new Date(),
      conflictModeRef.current,
      new Set(disabledCampaignIdsRef.current)
    )
    const banners = getActiveCampaignBanners(ctx, posCustomerId)
    return banners[0] ?? null
  }, [products, posCustomerId])

  const [cashierId, setCashierId] = useState("1")
  const [waiterId, setWaiterId] = useState("")
  const [cart, setCart] = useState<CartItem[]>([])
  const [showReceipt, setShowReceipt] = useState(false)
  const [showTablePanel, setShowTablePanel] = useState(false)
  const [showCategories, setShowCategories] = useState(false)
  const [lastPaymentMethod, setLastPaymentMethod] = useState("")
  const [lastTransactionId, setLastTransactionId] = useState("")
  const [isLoading, setIsLoading] = useState(true)
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null)
  const [showNavigationDialog, setShowNavigationDialog] = useState(false)
  const [createdOrderId, setCreatedOrderId] = useState<string | null>(null)
  const [isMounted, setIsMounted] = useState(false)
  const [displayedCount, setDisplayedCount] = useState(30) // Start with 30 products, load more on scroll
  const productsPerLoad = 20 // Load 20 more products each time
  const [barcodeInput, setBarcodeInput] = useState("")
  const [isScanning, setIsScanning] = useState(false)
  const [promoCodeInput, setPromoCodeInput] = useState("")
  const [appliedPromoCode, setAppliedPromoCode] = useState<string | null>(null)
  const [orderPreview, setOrderPreview] = useState<{
    subtotal: number
    total: number
    posOrderDiscount: number
    bundleDiscount: number
    spendDiscount: number
    couponDiscount: number
    spendPromotionName: string | null
    promoCodeLabel: string | null
  } | null>(null)
  const [promoPreviewLoading, setPromoPreviewLoading] = useState(false)
  const [lastScanTime, setLastScanTime] = useState(0)
  const [lastWiFiScanCheck, setLastWiFiScanCheck] = useState<Date>(new Date())
  // WiFi scanner is disabled by default - enable only if you're using WiFi scanners
  const [wifiScannerEnabled, setWifiScannerEnabled] = useState(false)
  const [showCart, setShowCart] = useState(false) // For tablet cart overlay
  const [mpesaEnabled, setMpesaEnabled] = useState(false)
  const [showMpesaDialog, setShowMpesaDialog] = useState(false)
  const [mpesaPhoneNumber, setMpesaPhoneNumber] = useState("")
  const [mpesaProcessing, setMpesaProcessing] = useState(false)
  const [pendingMpesaOrderId, setPendingMpesaOrderId] = useState<string | null>(null)
  const [mpesaError, setMpesaError] = useState<{ message: string; status: string } | null>(null)
  const [mpesaCheckoutRequestId, setMpesaCheckoutRequestId] = useState<string | null>(null)
  /** New-sale M-Pesa: one pending order id reused for retries until paid or cart cleared */
  const [mpesaSessionOrderId, setMpesaSessionOrderId] = useState<string | null>(null)
  const mpesaDraftOrderIdRef = useRef<string | null>(null)
  const mpesaPromptInFlightRef = useRef(false)
  const orderSubmitInFlightRef = useRef(false)
  const [isOrderSubmitting, setIsOrderSubmitting] = useState(false)
  const [showGlovoDialog, setShowGlovoDialog] = useState(false)
  const [glovoOrderNumber, setGlovoOrderNumber] = useState("")
  const [lastGlovoOrderNumber, setLastGlovoOrderNumber] = useState<string | null>(null)
  const [lastCartSnapshot, setLastCartSnapshot] = useState<CartItem[]>([])
  const [lastMpesaReceiptNumber, setLastMpesaReceiptNumber] = useState<string | null>(null)
  const [isProcessingGlovoPayment, setIsProcessingGlovoPayment] = useState(false)
  const [stockErrorPopup, setStockErrorPopup] = useState<{ productName: string; message: string } | null>(null)
  const stockErrorTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const waiterInitializedRef = useRef(false)
  const mpesaPollIntervalRef = useRef<NodeJS.Timeout | null>(null)

  const [showCustomItemDialog, setShowCustomItemDialog] = useState(false)
  const [customItemName, setCustomItemName] = useState("")
  const [customItemQuantity, setCustomItemQuantity] = useState("1")
  const [customItemVolumeAmount, setCustomItemVolumeAmount] = useState("")
  const [customItemVolumeUnit, setCustomItemVolumeUnit] = useState<"shot" | "double-shot" | "ml" | "litre">("shot")
  const [customItemPrice, setCustomItemPrice] = useState("")

  const showStockError = useCallback((productName: string, message: string) => {
    if (stockErrorTimeoutRef.current) clearTimeout(stockErrorTimeoutRef.current)
    setStockErrorPopup({ productName, message })
    stockErrorTimeoutRef.current = setTimeout(() => {
      setStockErrorPopup(null)
      stockErrorTimeoutRef.current = null
    }, 5000)
  }, [])

  // Create extended staff list that includes logged-in user (client-side only, no hydration issues)
  // This memo only runs on client after mount to prevent hydration mismatches
  const extendedStaff = useMemo(() => {
    // Only extend staff on client side after mount
    if (typeof window === 'undefined' || !isMounted || !session?.user) return staff
    
    const userIdentifier = session.user.name || session.user.email
    if (!userIdentifier) return staff
    
    // Check if user already exists in staff
    const userExists = session.user.name 
      ? staff.some(s => s.name.toLowerCase().trim() === session.user.name?.toLowerCase().trim())
      : false
    
    if (userExists) return staff
    
    // Generate stable ID (no Date.now() or Math.random() to avoid hydration issues)
    // Use deterministic ID based on user ID or email
    const userId = `user-${session.user.id || session.user.email?.replace(/[^a-zA-Z0-9]/g, '') || 'logged-in-user'}`
    
    // Check if we already have this user in the extended list
    if (staff.some(s => s.id === userId)) return staff
    
    // Create new staff entry for logged-in user
    const displayName = session.user.name || session.user.email?.split('@')[0] || "Logged In User"
    const newStaffEntry: Staff = {
      id: userId,
      name: displayName,
      role: "waiter",
      avatar: session.user.image || "/placeholder-user.jpg",
      salesTotal: 0,
      ordersCount: 0,
    }
    
    return [...staff, newStaffEntry]
  }, [isMounted, session?.user?.name, session?.user?.id, session?.user?.email, session?.user?.image])

  // Ensure component only renders fully on client
  useEffect(() => {
    setIsMounted(true)
  }, [])

  // Set logged-in user as waiter by default (for accountability)
  // This ensures every order is tracked to the person who created it
  // Only runs on client side after mount to avoid hydration issues
  useEffect(() => {
    if (!isMounted) return
    
    // Only set waiter if: session is loaded, user exists (has name or email), not editing an order, and not already initialized
    const userIdentifier = session?.user?.name || session?.user?.email
    if (userIdentifier && !editingOrderId && !waiterInitializedRef.current) {
      // Generate the user's ID (same logic as in extendedStaff)
      const userId = `user-${session.user.id || session.user.email?.replace(/[^a-zA-Z0-9]/g, '') || 'logged-in-user'}`
      
      // Access extendedStaff inside the effect (it's memoized based on session data we're already tracking)
      // Try to find the logged-in user in the extended staff array
      // First try by ID (most reliable)
      let userStaff = extendedStaff.find(s => s.id === userId)
      
      // If not found by ID, try by name (case-insensitive)
      if (!userStaff && session?.user?.name) {
        userStaff = extendedStaff.find(
          (s) => s.name.toLowerCase().trim() === session.user.name?.toLowerCase().trim()
        )
      }

      if (userStaff) {
        // User found in extended staff - set as waiter (always set, even if already set)
        setWaiterId(userStaff.id)
        waiterInitializedRef.current = true
        console.log('[POS] Set logged-in user as waiter:', userStaff.name, userStaff.id)
      } else {
        // User not found in extendedStaff - this shouldn't happen, but log a warning
        console.warn('[POS] Logged-in user not found in extendedStaff, waiter not set automatically')
      }
    }
    
    // Reset initialization flag when editing an order (so it can be set again after order is cleared)
    if (editingOrderId) {
      waiterInitializedRef.current = false
    }
    // Note: extendedStaff is intentionally not in dependencies - it's memoized from session data we already track
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMounted, session?.user?.name, session?.user?.id, session?.user?.email, editingOrderId])

  // Fetch M-Pesa settings
  useEffect(() => {
    const fetchMpesaSettings = async () => {
      try {
        const response = await fetch('/api/catha/settings')
        const data = await response.json()
        if (data.success && data.settings?.mpesa?.enabled) {
          // Check if all required credentials are configured
          const mpesa = data.settings.mpesa
          if (mpesa.credentialsConfigured || (mpesa.consumerKey && mpesa.consumerSecret && mpesa.passkey && mpesa.shortcode)) {
            setMpesaEnabled(true)
          }
        }
      } catch (error) {
        console.error('Error fetching M-Pesa settings:', error)
      }
    }

    fetchMpesaSettings()
  }, [])

  useEffect(() => {
    if (editingOrderId) {
      mpesaDraftOrderIdRef.current = null
      setMpesaSessionOrderId(null)
    }
  }, [editingOrderId])

  useEffect(() => {
    if (cart.length === 0 && !editingOrderId && !pendingMpesaOrderId) {
      mpesaDraftOrderIdRef.current = null
      setMpesaSessionOrderId(null)
    }
  }, [cart.length, editingOrderId, pendingMpesaOrderId])

  // Fetch products + POS discounts - instant from cache, then revalidate in background
  useEffect(() => {
    const hasFreshCache =
      _posInventoryDiscountCache && Date.now() - _posInventoryDiscountCache.mappedAt < PRODUCTS_CACHE_TTL_MS
    if (hasFreshCache && _posInventoryDiscountCache) {
      inventoryRawRef.current = _posInventoryDiscountCache.raw
      productRulesRef.current = _posInventoryDiscountCache.productRules
      categoryRulesRef.current = _posInventoryDiscountCache.categoryRules
      campaignsRef.current = _posInventoryDiscountCache.campaigns
      conflictModeRef.current = _posInventoryDiscountCache.conflictMode
      disabledCampaignIdsRef.current = _posInventoryDiscountCache.disabledCampaignIds
      setProducts(
        mapProductsWithPosDiscounts(
          _posInventoryDiscountCache.raw,
          _posInventoryDiscountCache.productRules,
          _posInventoryDiscountCache.categoryRules,
          _posInventoryDiscountCache.campaigns,
          posCustomerId,
          _posInventoryDiscountCache.conflictMode,
          _posInventoryDiscountCache.disabledCampaignIds
        )
      )
      setIsLoading(false)
    }

    let cancelled = false
    const fetchProducts = async () => {
      try {
        if (!hasFreshCache) setIsLoading(true)
        const [inventoryRes, discountsRes] = await Promise.all([
          fetch("/api/catha/inventory", {
            cache: "default",
            headers: { "Cache-Control": "max-age=5, stale-while-revalidate=10" },
          }),
          fetch("/api/catha/pos-discounts?activeOnly=true", { cache: "no-store" }),
        ])
        if (cancelled) return
        if (!inventoryRes.ok) throw new Error("Failed to fetch inventory")

        const data = await inventoryRes.json()
        let productRules: PosDiscountApiRecord[] = []
        let categoryRules: PosCategoryDiscountApiRecord[] = []
        let campaigns: PosCampaignApiRecord[] = []
        let conflictMode: PromotionConflictMode = "never_stack"
        let disabledCampaignIds: string[] = []
        if (discountsRes.ok) {
          const discountData = await discountsRes.json()
          conflictMode = discountData.conflictMode || "never_stack"
          disabledCampaignIds = discountData.disabledCampaignIds || []
          conflictModeRef.current = conflictMode
          disabledCampaignIdsRef.current = disabledCampaignIds
          productRules = (discountData.discounts || []).map((d: PosDiscountApiRecord & { productId: string }) => ({
            productId: d.productId,
            discountType: d.discountType,
            discountValue: d.discountValue,
            status: d.status,
            startAt: d.startAt,
            endAt: d.endAt,
            promotionName: d.promotionName,
            eligibilityScope: d.eligibilityScope,
            eligibleCustomers: d.eligibleCustomers,
            campaignId: d.campaignId,
          }))
          categoryRules = (discountData.categoryDiscounts || []).map((d: PosCategoryDiscountApiRecord) => ({
            category: d.category,
            discountType: d.discountType,
            discountValue: d.discountValue,
            status: d.status,
            startAt: d.startAt,
            endAt: d.endAt,
            promotionName: d.promotionName,
            eligibilityScope: d.eligibilityScope,
            eligibleCustomers: d.eligibleCustomers,
            campaignId: d.campaignId,
          }))
          campaigns = discountData.campaigns || []
        }

        if (cancelled) return
        if (data.success && data.products) {
          inventoryRawRef.current = data.products
          productRulesRef.current = productRules
          categoryRulesRef.current = categoryRules
          campaignsRef.current = campaigns
          _posInventoryDiscountCache = {
            raw: data.products,
            productRules,
            categoryRules,
            campaigns,
            conflictMode,
            disabledCampaignIds,
            mappedAt: Date.now(),
          }
          setProducts(
            mapProductsWithPosDiscounts(
              data.products,
              productRules,
              categoryRules,
              campaigns,
              posCustomerId,
              conflictMode,
              disabledCampaignIds
            )
          )
        }
      } catch (error) {
        if (!cancelled) {
          console.error("Error fetching products:", error)
          if (!hasFreshCache) setProducts([])
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    fetchProducts()
    return () => {
      cancelled = true
    }
  }, [])

  // Re-apply customer-specific discounts when checkout customer changes
  useEffect(() => {
    if (inventoryRawRef.current.length === 0) return
    setProducts(
      mapProductsWithPosDiscounts(
        inventoryRawRef.current,
        productRulesRef.current,
        categoryRulesRef.current,
        campaignsRef.current,
        posCustomerId,
        conflictModeRef.current,
        disabledCampaignIdsRef.current
      )
    )
  }, [posCustomerId])

  // Preview order-level promotions (bundles, spend, coupon)
  useEffect(() => {
    if (cart.length === 0) {
      setOrderPreview(null)
      return
    }
    let cancelled = false
    const timer = setTimeout(async () => {
      setPromoPreviewLoading(true)
      try {
        const res = await fetch("/api/catha/pos-discounts/preview-order", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items: mapCartToOrderLineItems(cart),
            customerPhone: customerPhone ? normalizeKenyaPhone(customerPhone) : null,
            promoCode: appliedPromoCode,
          }),
        })
        const data = await res.json()
        if (cancelled) return
        if (res.ok) {
          setOrderPreview({
            subtotal: data.subtotal,
            total: data.total,
            posOrderDiscount: data.posOrderDiscount ?? 0,
            bundleDiscount: data.bundleDiscount ?? 0,
            spendDiscount: data.spendDiscount ?? 0,
            couponDiscount: data.couponDiscount ?? 0,
            spendPromotionName: data.spendPromotionName ?? null,
            promoCodeLabel: data.promoCodeLabel ?? null,
          })
        } else {
          setOrderPreview(null)
          if (appliedPromoCode) toast.error(data?.error || "Promo code invalid")
        }
      } catch {
        if (!cancelled) setOrderPreview(null)
      } finally {
        if (!cancelled) setPromoPreviewLoading(false)
      }
    }, 350)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [cart, appliedPromoCode, customerPhone])

  // Sync cart line prices when customer eligibility changes
  useEffect(() => {
    if (cart.length === 0) return
    setCart((prev) =>
      prev.map((item) => {
        if (item.isCustom) return item
        const product = products.find((p) => {
          const productKey = p.size ? `${p.id}-${p.size}` : p.id
          const itemKey = item.size ? `${item.id}-${item.size}` : item.id
          return productKey === itemKey
        })
        if (!product) return item
        return {
          ...item,
          price: product.price,
          originalPrice: product.originalPrice,
          posDiscount: product.posDiscount,
        }
      })
    )
  }, [products, posCustomerId])

  // Load order data for editing
  useEffect(() => {
    if (typeof window !== "undefined" && products.length > 0) {
      const editOrderData = sessionStorage.getItem("editOrder")
      if (editOrderData) {
        try {
          const orderData = JSON.parse(editOrderData)
          setEditingOrderId(orderData.id)
          setSelectedTable(orderData.table)
          if (orderData.orderType === "TAKEOUT" || orderData.orderType === "INHOUSE") {
            setOrderType(orderData.orderType)
          }
          if (orderData.customerName) setCustomerName(String(orderData.customerName))
          if (orderData.customerPhone) setCustomerPhone(String(orderData.customerPhone))

          // Prefill Glovo number for reopened Glovo-paid orders.
          // This keeps the saved Glovo order number visible in the Glovo confirm flow.
          if (String(orderData.paymentMethod || "").toLowerCase() === "glovo") {
            setGlovoOrderNumber((orderData.glovoOrderNumber || "").toString())
          }
          
          // Find cashier and waiter IDs from staff
          const cashier = staff.find(s => s.name === orderData.cashier)
          if (cashier) setCashierId(cashier.id)
          
          const waiter = staff.find(s => s.name === orderData.waiter)
          if (waiter) setWaiterId(waiter.id)
          
          // Load items into cart - try multiple matching strategies
          const cartItems: CartItem[] = orderData.items.map((item: any) => {
            if (item.isCustomItem === true || item.lineType === "custom") {
              return {
                id: `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`,
                name: item.name || "Custom item",
                category: "custom",
                price: Number(item.price) || 0,
                cost: 0,
                stock: 999999,
                minStock: 0,
                image: "/placeholder.svg?height=150&width=200&query=custom",
                barcode: "",
                unit: "custom",
                supplier: "Custom",
                quantity: Number(item.quantity) || 1,
                isCustom: true,
              } as CartItem
            }

            // Try exact ID match first
            let product = products.find(p => p.id === item.productId)
            
            // If not found, try matching by name (case insensitive)
            if (!product) {
              product = products.find(p => 
                p.name.toLowerCase().trim() === item.name.toLowerCase().trim()
              )
            }
            
            // If still not found, try matching by barcode
            if (!product && item.productId) {
              product = products.find(p => p.barcode === item.productId)
            }
            
            if (product) {
              return {
                ...product,
                quantity: item.quantity,
              }
            }
            
            // If product not found, create a basic product from item data
            // This ensures the item still appears in cart even if product was deleted
            return {
              id: item.productId,
              name: item.name,
              category: 'other',
              price: item.price,
              cost: 0,
              stock: 0,
              minStock: 0,
              image: '/placeholder.svg?height=150&width=200',
              barcode: '',
              unit: 'item',
              supplier: 'Unknown',
              quantity: item.quantity,
            } as CartItem
          })
          
          setCart(cartItems)
          
          // Clear sessionStorage after loading
          sessionStorage.removeItem("editOrder")
        } catch (error) {
          console.error("Error loading order for editing:", error)
        }
      }
    }
  }, [products])

  // Calculate category product counts from real data
  const categoriesWithCounts = useMemo(() => {
    return categories.map(cat => ({
      ...cat,
      productCount: products.filter(p => p.category === cat.id).length
    }))
  }, [products])

  // Use debounced search for filtering - reduces re-renders
  const filteredProducts = useMemo(() => {
    const query = debouncedSearchQuery.trim().toLowerCase()

    return products.filter((product) => {
      const matchesCategory = selectedCategory === "all" || product.category === selectedCategory

      // Allow searching by name or by barcode/serial number (for scanners)
      const matchesSearch =
        query.length === 0 ||
        product.name.toLowerCase().includes(query) ||
        (product.barcode && product.barcode.toLowerCase().includes(query))

      return matchesCategory && matchesSearch
    })
  }, [selectedCategory, debouncedSearchQuery, products])

  // Infinite scroll - show products progressively
  const displayedProducts = useMemo(() => {
    return filteredProducts.slice(0, displayedCount)
  }, [filteredProducts, displayedCount])

  const hasMore = displayedCount < filteredProducts.length

  // Infinite scroll handler
  const loadMore = useCallback(() => {
    if (hasMore) {
      setDisplayedCount(prev => Math.min(prev + productsPerLoad, filteredProducts.length))
    }
  }, [hasMore, productsPerLoad, filteredProducts.length])

  const { observerTarget, isLoading: isLoadingMore } = useInfiniteScroll({
    hasMore,
    loadMore,
    threshold: 300, // Load more when 300px from bottom
  })

  // Reset displayed count when filters change
  useEffect(() => {
    setDisplayedCount(30)
  }, [selectedCategory, debouncedSearchQuery])

  // Memoize handlers to prevent unnecessary re-renders
  const addToCart = useCallback((product: ProductWithSize) => {
    const stock = product.stock ?? 0
    if (stock <= 0) {
      showStockError(product.name, 'Insufficient stock. Only 0 left.')
      return
    }

    const uniqueId = product.size ? `${product.id}-${product.size}` : product.id

    setCart((prev) => {
      const existing = prev.find((item) => {
        const itemId = item.size ? `${item.id}-${item.size}` : item.id
        return itemId === uniqueId
      })
      const newQty = existing ? existing.quantity + 1 : 1
      if (newQty > stock) {
        showStockError(product.name, `Insufficient stock. Only ${stock} left.`)
        return prev
      }
      if (existing) {
        return prev.map((item) => {
          const itemId = item.size ? `${item.id}-${item.size}` : item.id
          return itemId === uniqueId ? { ...item, quantity: item.quantity + 1 } : item
        })
      }
      return [...prev, { ...product, quantity: 1, size: product.size || '' }]
    })
    
    // Auto-open cart overlay only on small screens (≤768px) where cart is overlay
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      setShowCart(true)
    }
  }, [showStockError])

  // Handle barcode scan - find product and add to cart
  const handleBarcodeScan = useCallback((barcode: string) => {
    if (!barcode || barcode.length < 3) return

    setIsScanning(true)
    
    // Find product by barcode (exact match first, then partial)
    const product = products.find(
      (p) => p.barcode && p.barcode.trim().toLowerCase() === barcode.toLowerCase()
    ) || products.find(
      (p) => p.barcode && p.barcode.trim().toLowerCase().includes(barcode.toLowerCase())
    )

    if (product) {
      // Product found - add to cart
      addToCart(product)
      
      // Clear search and show success feedback
      setSearchQuery("")
      if (searchInputRef.current) {
        searchInputRef.current.value = ""
        searchInputRef.current.focus()
      }
      
      // Show success toast
      toast.success(`Added ${product.name} to cart`, {
        description: `Barcode: ${barcode}`,
        duration: 2000,
      })
      
      // Visual feedback
      setTimeout(() => setIsScanning(false), 500)
    } else {
      // Product not found - keep barcode in search for manual review
      setSearchQuery(barcode)
      setIsScanning(false)
      
      // Show error toast
      toast.error("Product not found", {
        description: `No product found with barcode: ${barcode}`,
        duration: 3000,
      })
    }
    
    setLastScanTime(Date.now())
  }, [products, addToCart])

  // Global barcode scanner listener - works even when input is not focused
  useEffect(() => {
    if (!isMounted) return

    let barcodeBuffer = ""
    let lastKeyTime = 0
    const BARCODE_TIMEOUT = 300 // Max time between characters (ms)
    const MIN_BARCODE_LENGTH = 3

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA'
      
      // If user is typing in the search input, let it handle normally via its own handler
      if (isInput && target === searchInputRef.current) {
        // The search input will handle barcode scanning via its onKeyDown handler
        // Just reset our buffer to avoid conflicts
        barcodeBuffer = ""
        return
      }

      // If user is typing in another input field, reset buffer and ignore
      if (isInput) {
        barcodeBuffer = ""
        lastKeyTime = 0
        return
      }

      // Handle Enter key - check if we have a barcode
      if (e.key === 'Enter') {
        if (barcodeBuffer.length >= MIN_BARCODE_LENGTH) {
          e.preventDefault()
          e.stopPropagation()
          
          const barcode = barcodeBuffer.trim()
          barcodeBuffer = ""
          lastKeyTime = 0
          
          // Process the barcode scan
          handleBarcodeScan(barcode)
          
          // Clear search input if it exists
          if (searchInputRef.current) {
            searchInputRef.current.value = ""
            setSearchQuery("")
            setBarcodeInput("")
          }
        }
        return
      }

      // Handle regular character input
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const now = Date.now()
        
        // Reset buffer if too much time has passed (not a barcode scan)
        if (now - lastKeyTime > BARCODE_TIMEOUT) {
          barcodeBuffer = e.key
        } else {
          // Continue accumulating
          barcodeBuffer += e.key
        }
        
        lastKeyTime = now
      } else {
        // Non-character key pressed - reset buffer
        barcodeBuffer = ""
        lastKeyTime = 0
      }
    }

    // Add global listener with capture phase to catch events early
    document.addEventListener('keydown', handleGlobalKeyDown, true)

    return () => {
      document.removeEventListener('keydown', handleGlobalKeyDown, true)
    }
  }, [isMounted, handleBarcodeScan])

  // Auto-focus search input for barcode scanner (optional - can be removed if not needed)
  useEffect(() => {
    if (isMounted && searchInputRef.current) {
      // Focus the search input when component mounts (for barcode scanners)
      // This is optional now since we have global listener, but keeping for backward compatibility
      searchInputRef.current.focus()
    }
  }, [isMounted])

  // Poll for WiFi barcode scanner data
  // Only polls if WiFi scanner is enabled (disabled by default)
  // This prevents unnecessary API calls if you're only using USB/Bluetooth scanners
  useEffect(() => {
    // Skip polling if WiFi scanner is disabled or component not mounted
    if (!wifiScannerEnabled || !isMounted) return

    let isPolling = true
    let pollTimeout: NodeJS.Timeout | null = null
    let lastCheckTime = lastWiFiScanCheck

    const pollWiFiScans = async () => {
      // Don't poll if component unmounted or WiFi scanner disabled
      if (!isPolling || !wifiScannerEnabled) return

      try {
        const response = await fetch(
          `/api/catha/barcode-scan?lastCheck=${lastCheckTime.toISOString()}&scannerId=wifi-scanner`
        )
        
        if (!response.ok) {
          // If API fails, increase polling interval to reduce load
          pollTimeout = setTimeout(pollWiFiScans, 2000)
          return
        }

        const data = await response.json()
        
        if (data.success && data.scans && data.scans.length > 0) {
          // Process each scan
          for (const scan of data.scans) {
            if (scan.barcode) {
              handleBarcodeScan(scan.barcode)
            }
          }
          
          // Update last check time locally
          lastCheckTime = new Date()
          setLastWiFiScanCheck(lastCheckTime)
        }

        // Continue polling - use 500ms for real-time scanning when active
        if (isPolling && wifiScannerEnabled) {
          pollTimeout = setTimeout(pollWiFiScans, 500)
        }
      } catch (error) {
        // Silently fail - WiFi scanner might not be configured
        // Increase interval on error to reduce unnecessary requests
        if (isPolling && wifiScannerEnabled) {
          pollTimeout = setTimeout(pollWiFiScans, 2000)
        }
      }
    }

    // Start polling
    pollTimeout = setTimeout(pollWiFiScans, 500)

    return () => {
      isPolling = false
      if (pollTimeout) {
        clearTimeout(pollTimeout)
      }
    }
    // Remove lastWiFiScanCheck from dependencies to prevent effect restart
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMounted, wifiScannerEnabled, handleBarcodeScan])

  // Handle barcode scanning - detect rapid input (scanner behavior)
  // Most barcode scanners type very quickly and send Enter key after the barcode
  // We'll handle this in the onKeyDown handler instead
  // This effect is kept for fallback detection of very rapid typing
  useEffect(() => {
    if (!barcodeInput || barcodeInput.length < 3) return

    // Only auto-detect if input is very long (likely a complete barcode)
    // and was entered very quickly (within 200ms)
    const timeSinceLastScan = Date.now() - lastScanTime
    const isRapidInput = timeSinceLastScan < 200 && barcodeInput.length >= 8

    if (isRapidInput) {
      // Likely a barcode scan - search and add to cart
      const timeoutId = setTimeout(() => {
        handleBarcodeScan(barcodeInput.trim())
        setBarcodeInput("")
      }, 100) // Small delay to ensure barcode is complete
      
      return () => clearTimeout(timeoutId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [barcodeInput, lastScanTime]) // Removed handleBarcodeScan from deps to prevent effect restart

  const handleAddItem = useCallback((product: ProductWithSize) => {
    // Add directly to cart - users can search/scan barcode for specific sizes
    addToCart(product)
  }, [addToCart])

  const handleUpdateQuantity = (productId: string, quantity: number, size?: string) => {
    if (quantity <= 0) {
      setCart((prev) => {
        if (size) {
          return prev.filter((item) => {
            const itemId = item.size ? `${item.id}-${item.size}` : item.id
            const uniqueId = `${productId}-${size}`
            return itemId !== uniqueId
          })
        }
        return prev.filter((item) => item.id !== productId)
      })
    } else {
      const item = cart.find((c) => {
        const itemId = c.size ? `${c.id}-${c.size}` : c.id
        const uniqueId = size ? `${productId}-${size}` : productId
        return itemId === uniqueId
      })
      const stock = item?.stock ?? 0
      if (!item?.isCustom && quantity > stock) {
        showStockError(item?.name ?? 'Item', `Insufficient stock. Only ${stock} left.`)
        return
      }
      setCart((prev) => {
        if (size) {
          const uniqueId = `${productId}-${size}`
          return prev.map((it) => {
            const itemId = it.size ? `${it.id}-${it.size}` : it.id
            return itemId === uniqueId ? { ...it, quantity } : it
          })
        }
        return prev.map((it) => (it.id === productId ? { ...it, quantity } : it))
      })
    }
  }

  const handleRemoveItem = (productId: string, size?: string) => {
    setCart((prev) => {
      if (size) {
        const uniqueId = `${productId}-${size}`
        return prev.filter((item) => {
          const itemId = item.size ? `${item.id}-${item.size}` : item.id
          return itemId !== uniqueId
        })
      }
      return prev.filter((item) => item.id !== productId)
    })
  }

  // Poll for M-Pesa payment status
  useEffect(() => {
    if (!pendingMpesaOrderId) return

    let isStopped = false
    const currentOrderId = pendingMpesaOrderId
    const currentCheckoutId = mpesaCheckoutRequestId

    const stopPolling = () => {
      isStopped = true
      if (mpesaPollIntervalRef.current) {
        clearTimeout(mpesaPollIntervalRef.current)
        mpesaPollIntervalRef.current = null
      }
      toast.dismiss("mpesa-push")
    }

    const startTime = Date.now()
    const POLL_CAP_MS = 180_000   // 3 min max
    const FAST_PHASE_MS = 30_000   // first 30s: every 2s
    const FAST_INTERVAL = 2000
    const SLOW_INTERVAL = 5000

    const checkPaymentStatus = async () => {
      if (isStopped) return
      try {
        const searchQuery = currentCheckoutId || currentOrderId
        const response = await fetch(`/api/mpesa/transactions?search=${searchQuery}`, { cache: 'no-store' })
        const data = await response.json()

        if (data.success && data.transactions && data.transactions.length > 0) {
          const transaction = data.transactions.find((tx: any) =>
            tx.accountReference === currentOrderId ||
            (currentCheckoutId && tx.checkoutRequestId === currentCheckoutId)
          ) || data.transactions[0]

          const status = normalizeMpesaStatus(transaction.status)
          const isTerminal = status !== 'PENDING'
          if (isTerminal) stopPolling()

          if (status === 'COMPLETED') {
            toast.success("M-Pesa payment confirmed!", { id: "mpesa-status" })
            
            // Snapshot cart BEFORE clearing so the receipt can display items
            const cartSnapshot = [...cart]
            
            // Fetch the order to get M-Pesa receipt number and full order details
            try {
              const orderResponse = await fetch(`/api/catha/orders?id=${currentOrderId}`, {
                cache: 'no-store',
              })
              if (orderResponse.ok) {
                const order = await orderResponse.json()

                // If backend callback didn't mark the order as PAID/completed yet,
                // force-sync it now so the Orders page always shows the correct status.
                // Never set customerPhone from M-Pesa transaction data — only the STK prompt / POS field.
                const syncPayload: Record<string, unknown> = { id: currentOrderId }
                if (order.paymentStatus !== 'PAID' || order.status !== 'completed') {
                  syncPayload.status = 'completed'
                  syncPayload.paymentStatus = 'PAID'
                  syncPayload.paymentMethod = 'mpesa'
                  syncPayload.mpesaReceiptNumber =
                    order.mpesaReceiptNumber || transaction.mpesaReceiptNumber || null
                }
                if (Object.keys(syncPayload).length > 1) {
                  try {
                    await fetch('/api/catha/orders', {
                      method: 'PUT',
                      cache: 'no-store',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(syncPayload),
                    })
                  } catch (syncError) {
                    console.error('[POS] Failed to sync M-Pesa payment status to order:', syncError)
                  }
                }
                
                // Set receipt-related state
                setLastCartSnapshot(cartSnapshot)
                setLastPaymentMethod("mpesa")
                setLastTransactionId(currentOrderId)
                setLastMpesaReceiptNumber(order.mpesaReceiptNumber || transaction.mpesaReceiptNumber || null)
                setCreatedOrderId(currentOrderId)
                
                // Clear M-Pesa dialog state
                setPendingMpesaOrderId(null)
                setMpesaCheckoutRequestId(null)
                setShowMpesaDialog(false)
                setMpesaPhoneNumber("")
                setMpesaError(null)
                
                // Clear cart and other state
                setCart([])
                setSelectedTable(null)
                setWaiterId("")
                setEditingOrderId(null)
                setCustomerName("")
                setCustomerPhone("")
                setTableNumberInput("")
                setSelectedPaymentMethod(null)
                setMpesaSessionOrderId(null)
                mpesaDraftOrderIdRef.current = null
                console.log("[POS] M-Pesa payment completed for order:", currentOrderId)

                // Show receipt modal
                setShowReceipt(true)
              } else {
                // If order fetch fails, still show navigation dialog as fallback
                console.error('[POS] Failed to fetch order for receipt:', currentOrderId)
                setCreatedOrderId(currentOrderId)
                setPendingMpesaOrderId(null)
                setMpesaCheckoutRequestId(null)
                setShowMpesaDialog(false)
                setMpesaPhoneNumber("")
                setMpesaError(null)
                setCart([])
                setSelectedTable(null)
                setWaiterId("")
                setShowNavigationDialog(true)
                setMpesaSessionOrderId(null)
                mpesaDraftOrderIdRef.current = null
              }
            } catch (error) {
              console.error('[POS] Error fetching order for receipt:', error)
              // Fallback to navigation dialog
              setCreatedOrderId(currentOrderId)
              setPendingMpesaOrderId(null)
              setMpesaCheckoutRequestId(null)
              setShowMpesaDialog(false)
              setMpesaPhoneNumber("")
              setMpesaError(null)
              setCart([])
              setSelectedTable(null)
              setWaiterId("")
              setMpesaSessionOrderId(null)
              mpesaDraftOrderIdRef.current = null
              setShowNavigationDialog(true)
            }
          } else if (status === 'FAILED' || status === 'CANCELLED') {
            const errMsg = transaction.result_desc ||
              (status === 'CANCELLED'
                ? "Payment was cancelled by the customer. Please try again."
                : "Payment failed. Please check the phone and try again.")
            console.log("[POS] M-Pesa terminal status on same order:", currentOrderId, status)
            recordMpesaPromptOutcomeOnOrder(currentOrderId, {
              mpesaLastPromptStatus: status,
              mpesaLastPromptMessage: String(errMsg).slice(0, 500),
            }).catch((e) => console.error("[POS] Failed to record M-Pesa outcome on order:", e))
            setMpesaError({ message: errMsg, status })
            setPendingMpesaOrderId(null)
            setMpesaProcessing(false)
          }
          // If still PENDING, continue polling
        }
      } catch (error) {
        console.error('Error checking payment status:', error)
      }
    }

    const scheduleNext = () => {
      if (isStopped) return
      const elapsed = Date.now() - startTime
      if (elapsed >= POLL_CAP_MS) {
        stopPolling()
        recordMpesaPromptOutcomeOnOrder(currentOrderId, {
          mpesaLastPromptStatus: "TIMEOUT",
          mpesaLastPromptMessage: "Payment confirmation timeout (3 minutes)",
        }).catch((e) => console.error("[POS] Failed to record M-Pesa timeout on order:", e))
        setMpesaError({
          message: "Payment confirmation timeout (3 minutes). Please check your phone or try again.",
          status: 'TIMEOUT'
        })
        setPendingMpesaOrderId(null)
        setMpesaProcessing(false)
        return
      }
      const delay = elapsed < FAST_PHASE_MS ? FAST_INTERVAL : SLOW_INTERVAL
      mpesaPollIntervalRef.current = window.setTimeout(poll, delay)
    }

    const poll = () => {
      if (isStopped) return
      checkPaymentStatus().finally(() => {
        if (isStopped) return
        scheduleNext()
      })
    }
    poll()

    return () => {
      isStopped = true
      if (mpesaPollIntervalRef.current) {
        clearTimeout(mpesaPollIntervalRef.current)
        mpesaPollIntervalRef.current = null
      }
    }
  }, [pendingMpesaOrderId, mpesaCheckoutRequestId])

  const handleMpesaPayment = async () => {
    if (!mpesaPhoneNumber.trim()) {
      toast.error("Please enter a phone number")
      return
    }
    if (mpesaProcessing || mpesaPromptInFlightRef.current) {
      console.log("[POS] M-Pesa prompt blocked: request already in progress")
      return
    }
    if (orderType === "INHOUSE" && !selectedTable) {
      toast.error("Table number is required")
      return
    }

    setMpesaError(null)
    setMpesaProcessing(true)
    mpesaPromptInFlightRef.current = true

    const orderItems = mapCartToOrderLineItems(cart)
    const promptNorm = normalizeKenyaPhone(mpesaPhoneNumber.trim())
    if (!promptNorm) {
      toast.error("Please enter a valid Kenya phone number in the M-Pesa field")
      setMpesaProcessing(false)
      mpesaPromptInFlightRef.current = false
      return
    }

    const waiterName = waiterId
      ? extendedStaff.find((s) => s.id === waiterId)?.name || session?.user?.name || "Unknown"
      : session?.user?.name || "Unknown"

    const basePayload = {
      table: selectedTable || 0,
      orderType,
      items: orderItems,
      paymentMethod: "mpesa" as const,
      waiter: waiterName,
      status: "pending" as const,
      customerName: customerName || null,
      customerPhone: promptNorm,
      promoCode: appliedPromoCode,
    }

    let orderId =
      editingOrderId ?? mpesaSessionOrderId ?? mpesaDraftOrderIdRef.current ?? null
    if (!orderId) {
      orderId = createCathaOrderId("pos")
      mpesaDraftOrderIdRef.current = orderId
    }

    const usePut = Boolean(editingOrderId || mpesaSessionOrderId)

    try {
      if (usePut) {
        console.log("[POS] M-Pesa: order id reused — UPDATE before STK (no create)", {
          orderId,
          editing: Boolean(editingOrderId),
          sessionReuse: Boolean(mpesaSessionOrderId),
        })
        const orderResponse = await fetch("/api/catha/orders", {
          method: "PUT",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: orderId, ...basePayload }),
        })
        if (!orderResponse.ok) {
          const msg = await readOrderApiError(orderResponse, "Failed to update order")
          throw new Error(msg)
        }
      } else {
        if (editingOrderId) {
          console.error("[POS] Invariant violated: M-Pesa POST branch with editingOrderId set", editingOrderId)
          toast.error("Cannot create order while editing. Use the update flow.")
          setMpesaProcessing(false)
          mpesaPromptInFlightRef.current = false
          return
        }
        console.log("[POS] M-Pesa: CREATE pending order via POST (once per sale)", orderId)
        const orderResponse = await fetch("/api/catha/orders", {
          method: "POST",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: orderId, ...basePayload, ...posNewOrderClientGuardPayload(editingOrderId) }),
        })
        if (!orderResponse.ok) {
          const msg = await readOrderApiError(orderResponse, "Failed to create order")
          throw new Error(msg)
        }
        const created = await orderResponse.json()
        const persistedId = (created?.id as string) || orderId
        orderId = persistedId
        mpesaDraftOrderIdRef.current = persistedId
        setMpesaSessionOrderId(persistedId)
      }

      let stkAmount = total
      try {
        const cur = await fetch(`/api/catha/orders?id=${encodeURIComponent(orderId)}`, { cache: "no-store" })
        if (cur.ok) {
          const odoc = await cur.json()
          const sum = summarizeCathaOrderPayments(odoc)
          stkAmount = Math.max(
            0.01,
            sum.balanceDue > 0.005 ? sum.balanceDue : Number(odoc.total) || total
          )
        }
      } catch {
        stkAmount = total
      }

      toast.loading("Initiating M-Pesa payment...", { id: "mpesa-push" })
      const stkResponse = await fetch("/api/mpesa/stk-push", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phoneNumber: promptNorm,
          amount: stkAmount,
          accountReference: orderId,
          transactionDesc: `Payment for order ${orderId}`,
        }),
      })

      const stkData = await stkResponse.json()

      if (stkData.success) {
        if (stkData.duplicate) {
          console.log("[POS] Duplicate M-Pesa prompt blocked by API — reusing checkoutRequestID", stkData.data?.checkoutRequestID)
        }
        toast.loading("Payment request sent! Waiting for confirmation...", { id: "mpesa-push" })
        setPendingMpesaOrderId(orderId)
        setMpesaCheckoutRequestId(stkData.data?.checkoutRequestID || null)
        setMpesaProcessing(false)
      } else {
        toast.dismiss("mpesa-push")
        const errText = stkData.error || "Failed to initiate payment. Please try again."
        setMpesaError({
          message: errText,
          status: "INITIATION_FAILED",
        })
        recordMpesaPromptOutcomeOnOrder(orderId, {
          mpesaLastPromptStatus: "INITIATION_FAILED",
          mpesaLastPromptMessage: String(errText).slice(0, 500),
        }).catch(() => {})
        setMpesaProcessing(false)
      }
    } catch (error: any) {
      console.error("M-Pesa payment error:", error)
      toast.dismiss("mpesa-push")
      setMpesaError({
        message: error.message || "Failed to process M-Pesa payment. Please try again.",
        status: "ERROR",
      })
      setMpesaProcessing(false)
    } finally {
      mpesaPromptInFlightRef.current = false
    }
  }

  const handleConfirmGlovoPayment = async () => {
    if (isProcessingGlovoPayment || orderSubmitInFlightRef.current) return
    const normalizedGlovoOrderNumber = glovoOrderNumber.trim()
    if (!normalizedGlovoOrderNumber) {
      toast.error("Glovo order number is required.")
      return
    }

    orderSubmitInFlightRef.current = true
    setIsOrderSubmitting(true)
    setIsProcessingGlovoPayment(true)
    const cartSnapshot = [...cart]
    const orderItems = mapCartToOrderLineItems(cartSnapshot)
    const normalizedPhone = customerPhone ? normalizeKenyaPhone(customerPhone) : null
    const orderData = {
      table: selectedTable || 0,
      orderType,
      items: orderItems,
      paymentMethod: "glovo",
      glovoOrderNumber: normalizedGlovoOrderNumber,
      waiter: waiterId ? extendedStaff.find((s) => s.id === waiterId)?.name || session?.user?.name || "Unknown" : session?.user?.name || "Unknown",
      status: "completed",
      customerPhone: normalizedPhone,
      promoCode: appliedPromoCode,
    }

    try {
      if (editingOrderId) {
        const response = await fetch('/api/catha/orders', {
          method: 'PUT',
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: editingOrderId, ...orderData }),
        })
        if (!response.ok) {
          const msg = await readOrderApiError(response, "Failed to update order")
          toast.error(msg)
          throw new Error(msg)
        }
        setLastCartSnapshot(cartSnapshot)
        setLastPaymentMethod("glovo")
        setLastTransactionId(editingOrderId)
        setLastGlovoOrderNumber(normalizedGlovoOrderNumber)
        setShowGlovoDialog(false)
        setGlovoOrderNumber("")
        toast.success(`Order ${editingOrderId} updated successfully!`)
        setShowReceipt(true)
        setCart([])
        setSelectedTable(null)
        setWaiterId("")
        setEditingOrderId(null)
      } else {
        const transactionId = createCathaOrderId("pos")
        const completedOrder = {
          id: transactionId,
          ...orderData,
          status: orderData.status as "pending" | "completed" | "cancelled",
          timestamp: new Date(),
          ...posNewOrderClientGuardPayload(null),
        }
        const response = await fetch('/api/catha/orders', {
          method: 'POST',
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(completedOrder),
        })
        if (!response.ok) {
          const msg = await readOrderApiError(response, "Failed to create order")
          toast.error(msg)
          throw new Error(msg)
        }
        const createdOrder = await response.json()
        if (!createdOrder || !createdOrder.id) throw new Error('Invalid order creation response')
        setLastCartSnapshot(cartSnapshot)
        setLastPaymentMethod("glovo")
        setLastTransactionId(createdOrder.id)
        setLastGlovoOrderNumber(normalizedGlovoOrderNumber)
        setShowGlovoDialog(false)
        setGlovoOrderNumber("")
        toast.success(`Order ${createdOrder.id} created successfully!`)
        setShowReceipt(true)
        setCart([])
        setSelectedTable(null)
        setWaiterId("")
      }
    } catch (error: any) {
      console.error('Error processing Glovo payment:', error)
      toast.error(error?.message || 'Failed to process Glovo payment. Please try again.')
    } finally {
      setIsProcessingGlovoPayment(false)
      setIsOrderSubmitting(false)
      orderSubmitInFlightRef.current = false
    }
  }

  const handleCheckout = async (method: string) => {
    if ((method === "pay-later" || method === "cash" || method === "card") && orderSubmitInFlightRef.current) {
      return
    }
    const orderItems = mapCartToOrderLineItems(cart)

    // Handle M-Pesa STK Push
    if (method === "mpesa") {
      if (!mpesaEnabled) {
        toast.error("M-Pesa is not enabled. Please configure it in Settings.")
        return
      }
      // Auto-fill M-Pesa phone from Customer Phone; admin can change it in the modal if needed
      setMpesaPhoneNumber(customerPhone.trim())
      setShowMpesaDialog(true)
      return
    }

    // Handle Glovo payment - require Glovo order number
    if (method === "glovo") {
      // If editing an existing order, re-fetch so the modal shows the saved Glovo number.
      if (editingOrderId) {
        try {
          const orderResponse = await fetch(`/api/catha/orders?id=${editingOrderId}`, { cache: "no-store" })
          if (orderResponse.ok) {
            const order = await orderResponse.json()
            setGlovoOrderNumber((order.glovoOrderNumber || "").toString())
          } else {
            setGlovoOrderNumber("")
          }
        } catch {
          setGlovoOrderNumber("")
        }
      } else {
        // New order: keep what's typed (if any), otherwise start empty.
        if (!glovoOrderNumber.trim()) setGlovoOrderNumber("")
      }

      setShowGlovoDialog(true)
      return
    }

    // Normalize customer phone before saving
    const normalizedPhone = customerPhone ? normalizeKenyaPhone(customerPhone) : null

    const orderData = {
      table: selectedTable || 0,
      orderType,
      items: orderItems,
      paymentMethod: method === "pay-later" ? "pending" : method,
      waiter: waiterId ? extendedStaff.find((s) => s.id === waiterId)?.name || session?.user?.name || "Unknown" : session?.user?.name || "Unknown",
      status: method === "pay-later" ? "pending" : "completed",
      customerName: customerName || null,
      customerPhone: normalizedPhone,
      promoCode: appliedPromoCode,
    }

    // Snapshot cart BEFORE clearing so the receipt can display items
    const cartSnapshot = [...cart]

    console.log("[POS] Checkout payload:", {
      editingOrderId,
      method,
      itemCount: orderItems.length,
      lines: orderItems,
      subtotal,
      total,
    })

    orderSubmitInFlightRef.current = true
    setIsOrderSubmitting(true)
    try {
      if (editingOrderId) {
        const response = await fetch('/api/catha/orders', {
          method: 'PUT',
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: editingOrderId, ...orderData }),
        })
        if (!response.ok) {
          const msg = await readOrderApiError(response, "Failed to update order")
          throw new Error(msg)
        }

        if (method === "pay-later") {
          alert(`Order ${editingOrderId} updated successfully!`)
          setCart([])
          setSelectedTable(null)
          setWaiterId("")
          setEditingOrderId(null)
          setCustomerName("")
          setCustomerPhone("")
          setTableNumberInput("")
          setSelectedPaymentMethod(null)
          return
        }

        // For completed orders — snapshot first, then open receipt, then clear
        setLastCartSnapshot(cartSnapshot)
        setLastPaymentMethod(method)
        setLastTransactionId(editingOrderId)
        setShowReceipt(true)
        setCart([])
        setSelectedTable(null)
        setWaiterId("")
        setEditingOrderId(null)
        setCustomerName("")
        setCustomerPhone("")
        setTableNumberInput("")
        setSelectedPaymentMethod(null)
      } else {
        // Create new order
        if (method === "pay-later") {
          const newOrder: Transaction = {
            id: createCathaOrderId("pos"),
            ...orderData,
            status: orderData.status as "pending" | "completed" | "cancelled",
            timestamp: new Date(),
            ...posNewOrderClientGuardPayload(null),
          }
          const response = await fetch('/api/catha/orders', {
            method: 'POST',
            cache: 'no-store',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newOrder),
          })
          if (!response.ok) {
            const msg = await readOrderApiError(response, "Failed to create order")
            toast.error(msg)
            throw new Error(msg)
          }

          const createdOrder = await response.json()
          setCreatedOrderId(createdOrder.id)
          setCart([])
          setSelectedTable(null)
          setWaiterId("")
          setCustomerName("")
          setCustomerPhone("")
          setTableNumberInput("")
          setSelectedPaymentMethod(null)
          setShowNavigationDialog(true)
          return
        }

        // Regular payment flow — snapshot first, then open receipt, then clear
        const transactionId = createCathaOrderId("pos")
        const completedOrder: Transaction = {
          id: transactionId,
          ...orderData,
          status: orderData.status as "pending" | "completed" | "cancelled",
          timestamp: new Date(),
          ...posNewOrderClientGuardPayload(null),
        }
        const response = await fetch('/api/catha/orders', {
          method: 'POST',
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(completedOrder),
        })
        if (!response.ok) {
          const msg = await readOrderApiError(response, "Failed to create order")
          toast.error(msg)
          throw new Error(msg)
        }

        setLastCartSnapshot(cartSnapshot)
        setLastPaymentMethod(method)
        setLastTransactionId(transactionId)
        setCreatedOrderId(transactionId)
        setShowReceipt(true)
        setCart([])
        setSelectedTable(null)
        setCustomerName("")
        setCustomerPhone("")
        setTableNumberInput("")
        setSelectedPaymentMethod(null)
        setWaiterId("")
      }
    } catch (error: any) {
      console.error('Error saving order:', error)
      toast.error(error?.message || 'Failed to save order. Please try again.')
    } finally {
      setIsOrderSubmitting(false)
      orderSubmitInFlightRef.current = false
    }
  }

  const handleCloseReceipt = () => {
    setShowReceipt(false)
    setCart([])
    mpesaDraftOrderIdRef.current = null
    setMpesaSessionOrderId(null)
    setLastCartSnapshot([])
    setLastCashAmount(null)
    setLastCashBalance(null)
    setLastMpesaReceiptNumber(null)
    setSelectedTable(null)
    // Show navigation dialog after closing receipt
    if (createdOrderId) {
      setShowNavigationDialog(true)
    }
  }

  const handleGoToOrders = () => {
    setShowNavigationDialog(false)
    setCreatedOrderId(null)
    router.push('/catha/orders')
  }

  const handleStayInPOS = () => {
    setShowNavigationDialog(false)
    setCreatedOrderId(null)
  }

  // Prices are VAT-inclusive in this app; do not add tax on top.
  const lineSubtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0)
  const subtotal = orderPreview?.subtotal ?? lineSubtotal
  const orderDiscount = orderPreview?.posOrderDiscount ?? 0
  const vat = 0
  const total = orderPreview?.total ?? lineSubtotal
  const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0)

  return (
    <div className="flex h-screen overflow-hidden w-full relative bg-background pos-landscape">
      {/* Outer container: max-width on xl/2xl for 16–17.3" screens */}
      <div className="flex flex-1 min-w-0 min-h-0 xl:max-w-[1600px] xl:mx-auto">
        {/* LEFT PANEL - Categories: 220px compact, solid green pill active */}
        <div
          className={cn(
            "flex-shrink-0 h-full transition-all duration-300 ease-out overflow-hidden",
            "xl:static xl:z-auto",
            showCategories 
              ? "w-[200px] md:w-[220px] xl:w-[220px] mr-2 md:mr-3 opacity-100 z-40 fixed xl:relative inset-y-0 left-0 bg-card/95 xl:bg-transparent backdrop-blur-xl" 
              : "w-0 xl:w-0 mr-0 opacity-0 xl:opacity-0 pointer-events-none xl:pointer-events-none"
          )}
        >
          <div className="h-full bg-card/95 backdrop-blur-2xl border-r border-border/60 flex flex-col shadow-sm">
            <div className="px-4 py-3 border-b border-border/50 flex items-center justify-between pos-sidebar-compact">
            <div>
              <h2 className="text-sm font-bold text-foreground tracking-tight">Categories</h2>
              <p className="text-[10px] text-muted-foreground mt-0.5 font-medium">Browse by type</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowCategories(false)}
              className="h-8 w-8 rounded-lg hover:bg-secondary/80 transition-all min-w-[44px] min-h-[44px]"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            </div>

            <nav className="flex-1 px-3 py-2 space-y-1.5 overflow-y-auto pos-sidebar-compact">
            <button
              onClick={() => {
                setSelectedCategory("all")
                setShowCategories(false)
              }}
              className={cn(
                "w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-all min-h-[44px]",
                selectedCategory === "all"
                  ? "bg-emerald-600 text-white shadow-sm"
                  : "text-foreground hover:bg-muted/70 border border-transparent hover:border-border/50",
              )}
            >
              <div
                className={cn(
                  "p-1.5 rounded-lg flex items-center justify-center shrink-0",
                  selectedCategory === "all" ? "bg-white/20" : "bg-muted/80"
                )}
              >
                <CircleDot className="h-4 w-4" />
              </div>
              <span className="flex-1 text-left text-[12px] font-semibold truncate">All Items</span>
              <span className={cn(
                "px-2 py-0.5 rounded-full text-[10px] font-semibold shrink-0",
                selectedCategory === "all" ? "bg-white/25" : "bg-muted text-muted-foreground"
              )}>
                {products.length}
              </span>
            </button>

            {categoriesWithCounts.map((cat) => (
              <button
                key={cat.id}
                onClick={() => {
                  setSelectedCategory(cat.id)
                  setShowCategories(false)
                }}
                className={cn(
                  "w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-all min-h-[44px]",
                  selectedCategory === cat.id
                    ? "bg-emerald-600 text-white shadow-sm"
                    : "text-foreground hover:bg-muted/70 border border-transparent hover:border-border/50",
                )}
              >
                <div
                  className={cn(
                    "p-1.5 rounded-lg flex items-center justify-center shrink-0",
                    categoryIconColors[cat.id] ?? "bg-secondary/70 text-foreground",
                    selectedCategory === cat.id && "bg-white/20"
                  )}
                >
                  <div className="scale-95">{getCategoryIcon(cat.id)}</div>
                </div>
                <span className="flex-1 text-left text-[12px] font-semibold truncate">{cat.name}</span>
                <span className={cn(
                  "px-2 py-0.5 rounded-full text-[10px] font-semibold shrink-0",
                  selectedCategory === cat.id ? "bg-white/25" : "bg-muted text-muted-foreground"
                )}>
                  {cat.productCount}
                </span>
              </button>
            ))}
            </nav>
          </div>
        </div>

        {/* MIDDLE PANEL - Products (A) */}
        <div className={cn(
          "flex-1 flex flex-col min-w-0 overflow-hidden bg-gradient-to-b from-background/50 to-background transition-all duration-300"
        )}>
          {/* Sticky header: compact max 70px for 1280×800 */}
          <div className="sticky top-0 z-30 flex flex-wrap items-center gap-2 pl-14 md:pl-16 xl:pl-4 pr-2 xl:pr-4 py-2 bg-card/95 backdrop-blur-xl border-b border-border/50 shadow-sm pos-header-compact max-h-[70px]">
            {/* Category Toggle - touch target min 44px */}
            <Button
              variant="outline"
              onClick={() => setShowCategories(!showCategories)}
              className={cn(
                "pos-touch-target min-h-[44px] h-10 px-3 gap-1.5 rounded-xl border-border/50 bg-background/80 shadow-sm hover:shadow-md transition-all font-medium text-sm",
                showCategories && "border-emerald-600/50 bg-emerald-50 text-emerald-700"
              )}
            >
              <Menu className={cn("h-4 w-4 transition-transform duration-200", showCategories && "rotate-90")} />
              <span className="hidden md:inline">Categories</span>
              <span className="md:hidden">Cat</span>
            </Button>

            {canManageOwnShift ? <ShiftWidget cashierName={session?.user?.name || "Cashier"} /> : null}

            {/* Search - compact */}
            <div className="relative flex-1 min-w-[140px] max-w-full md:max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/70" />
              <Input
                ref={searchInputRef}
                placeholder="Search or scan barcode..."
                value={searchQuery}
                onChange={(e) => {
                  const value = e.target.value
                  setSearchQuery(value)
                  setBarcodeInput(value)
                  setLastScanTime(Date.now())
                }}
                onKeyDown={(e) => {
                  // Handle Enter key (scanner sends Enter after barcode)
                  if (e.key === 'Enter' && searchQuery.trim().length >= 3) {
                    e.preventDefault()
                    handleBarcodeScan(searchQuery.trim())
                    setSearchQuery("")
                    setBarcodeInput("")
                  }
                }}
                className={cn(
                  "pl-9 pr-12 min-h-[44px] h-10 bg-background/80 border-border/50 rounded-xl text-sm shadow-sm focus:shadow-md focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/20 transition-all",
                  isScanning && "border-green-500 bg-green-50/50 dark:bg-green-950/20"
                )}
                autoFocus
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
                {isScanning && (
                  <div className="h-2.5 w-2.5 rounded-full bg-green-500 animate-pulse" title="Scanning..." />
                )}
              </div>
            </div>

            {/* Table - compact */}
            <Button
              variant="outline"
              onClick={() => setShowTablePanel(true)}
              className={cn(
                "min-h-[44px] h-10 px-3 gap-1.5 rounded-xl border-border/50 bg-background/80 shadow-sm hover:shadow-md transition-all font-medium text-sm",
                selectedTable && "border-emerald-600/60 bg-emerald-50 text-emerald-700"
              )}
            >
              <Grid3X3 className="h-4 w-4" />
              <span className="hidden md:inline">{selectedTable ? `Table ${selectedTable}` : "Select Table"}</span>
              <span className="md:hidden">{selectedTable ? `T${selectedTable}` : "Table"}</span>
            </Button>

            {/* Cart Toggle - only on small screens (≤768px); on md+ cart is in-flow column */}
            <Button
              variant="outline"
              onClick={() => setShowCart(!showCart)}
              className={cn(
                "md:hidden min-h-[44px] h-11 px-4 gap-2 rounded-xl border-2 border-border/50 bg-background/80 shadow-lg hover:shadow-xl transition-all font-semibold text-sm relative touch-manipulation",
                cart.length > 0 && "border-emerald-600/60 bg-emerald-50 text-emerald-700"
              )}
            >
              <ShoppingCart className="h-5 w-5" />
              <span>Cart</span>
              {cart.length > 0 && (
                <span className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-emerald-600 text-white text-xs font-bold flex items-center justify-center border-2 border-background">
                  {totalItems > 9 ? '9+' : totalItems}
                </span>
              )}
            </Button>
          </div>

          {/* Products Grid - 4 cols for 1280×800, compact padding */}
          <div className="flex-1 overflow-y-auto p-2 sm:p-3 md:p-4">
            {/* Stock error popup - at top of product area with color shade */}
            {stockErrorPopup && (
              <div
                className="sticky top-0 z-30 mb-4 flex items-start gap-3 rounded-xl border-2 border-amber-400/80 bg-amber-50 px-4 py-3 shadow-lg dark:border-amber-500/70 dark:bg-amber-950/40"
                role="alert"
              >
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-amber-500/20 dark:bg-amber-500/30">
                  <span className="text-amber-600 dark:text-amber-400 text-lg leading-none">!</span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-amber-900 dark:text-amber-100">
                    {stockErrorPopup.productName}
                  </p>
                  <p className="text-sm text-amber-800 dark:text-amber-200">
                    {stockErrorPopup.message}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setStockErrorPopup(null)
                    if (stockErrorTimeoutRef.current) {
                      clearTimeout(stockErrorTimeoutRef.current)
                      stockErrorTimeoutRef.current = null
                    }
                  }}
                  className="flex-shrink-0 rounded-lg p-1.5 text-amber-700 hover:bg-amber-200/50 dark:text-amber-300 dark:hover:bg-amber-800/50"
                  aria-label="Dismiss"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            )}
            {promotionBanner && (
              <div className="mb-3 px-1">
                <PromotionCampaignBanner banner={promotionBanner} />
              </div>
            )}
            {isLoading ? (
              <div className="flex flex-col items-center justify-center min-h-[200px] text-muted-foreground">
                <div className="relative mb-6">
                  <div className="absolute inset-0 bg-primary/10 blur-3xl rounded-full" />
                  <Loader2 className="h-16 w-16 relative opacity-30 animate-spin" />
                </div>
                <p className="text-lg md:text-xl font-semibold mb-2">Loading products...</p>
                <p className="text-sm text-muted-foreground/80">Please wait</p>
              </div>
            ) : filteredProducts.length === 0 ? (
              <div className="flex flex-col items-center justify-center min-h-[200px] text-muted-foreground">
                <div className="relative mb-6">
                  <div className="absolute inset-0 bg-primary/10 blur-3xl rounded-full" />
                  <Search className="h-16 w-16 relative opacity-30" />
                </div>
                <p className="text-lg md:text-xl font-semibold mb-2">No products found</p>
                <p className="text-sm text-muted-foreground/80">Try a different search or category</p>
              </div>
            ) : (
              <>
                <div className={cn(
                  "grid gap-2 sm:gap-2",
                  "grid-cols-2",
                  "sm:grid-cols-2",
                  "md:grid-cols-3",
                  "lg:grid-cols-4",
                  "xl:grid-cols-4",
                  "2xl:grid-cols-5"
                )}>
                  {displayedProducts.map((product) => {
                    const productSize = (product as any).size || ''
                    const uniqueId = productSize ? `${product.id}-${productSize}` : product.id
                    
                    // Check if product is in cart - match by unique ID (including size)
                    const inCart = cart.find((item) => {
                      const itemId = item.size ? `${item.id}-${item.size}` : item.id
                      return itemId === uniqueId
                    })

                    return (
                      <POSProductCard
                        key={uniqueId}
                        product={product as Product & { size?: string }}
                        inCart={inCart}
                        onAddToCart={handleAddItem}
                      />
                    )
                  })}
                </div>
                
                {/* Infinite scroll trigger and loading indicator */}
                {hasMore && (
                  <div ref={observerTarget} className="flex items-center justify-center py-8">
                    {isLoadingMore ? (
                      <div className="flex items-center gap-3 text-muted-foreground">
                        <Loader2 className="h-5 w-5 animate-spin" />
                        <span className="text-sm font-medium">Loading more products...</span>
                      </div>
                    ) : (
                      <div className="text-sm text-muted-foreground">
                        Showing {displayedProducts.length} of {filteredProducts.length} products
                      </div>
                    )}
                  </div>
                )}
                
                {!hasMore && filteredProducts.length > 0 && (
                  <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
                    All {filteredProducts.length} products loaded
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* RIGHT PANEL - Cart + Checkout: 360px fixed for 1280×800 */}
        <div className={cn(
          "flex-shrink-0 flex flex-col bg-card border-l border-border",
          "max-md:fixed max-md:inset-y-0 max-md:right-0 max-md:z-40 max-md:w-full max-md:max-w-[340px] max-md:shadow-2xl max-md:translate-x-full max-md:transition-transform max-md:duration-300 max-md:ease-out",
          showCart && "max-md:translate-x-0",
          "md:relative md:translate-x-0 md:flex md:w-[360px] md:min-w-[320px] lg:w-[360px] xl:w-[360px]"
        )}>
          
          {/* Close button - only when cart is overlay (max-md) */}
          <button
            onClick={() => setShowCart(false)}
            className="max-md:flex md:hidden absolute top-3 right-3 z-10 pos-touch-target min-h-[44px] min-w-[44px] rounded-xl bg-card border border-border flex items-center justify-center hover:bg-muted transition-colors shadow-sm touch-manipulation focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label="Close cart"
          >
            <X className="h-5 w-5 text-muted-foreground" />
          </button>

          {/* Cart header - compact */}
          <div className="px-3 py-2.5 bg-card border-b border-border shrink-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center">
                  <ShoppingCart className="h-3.5 w-3.5 text-foreground" />
                </div>
                <div>
                  <h2 className="font-semibold text-xs text-foreground">
                    {editingOrderId ? "Editing Order" : "Current Order"}
                  </h2>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="font-mono text-[9px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                      #{editingOrderId || mpesaSessionOrderId || createdOrderId || "NEW"}
                    </span>
                    <span className="text-[9px] text-muted-foreground">
                      {totalItems} item{totalItems !== 1 ? "s" : ""}
                    </span>
                  </div>
                  {(editingOrderId || mpesaSessionOrderId) && (
                    <p className="text-[9px] text-amber-800/90 font-medium mt-1">
                      Updating existing order #{editingOrderId ?? mpesaSessionOrderId}
                    </p>
                  )}
                </div>
              </div>
              {isMounted && session?.user && (
                <div className="h-6 w-6 rounded-full bg-emerald-100 flex items-center justify-center text-[9px] font-bold text-emerald-700">
                  {(session.user.name || session.user.email || "U")[0].toUpperCase()}
                </div>
              )}
            </div>
          </div>

          {/* Scrollable cart content */}
          <div className="flex-1 overflow-y-auto p-2.5 sm:p-3 min-h-0 pos-order-compact">
            
            {/* Items section - scrollable */}
            <div className="bg-card rounded-xl border border-border p-2.5 pos-card-compact">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                  Items ({cart.length})
                </h3>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setShowCustomItemDialog(true)}
                    className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[10px] font-medium text-foreground hover:bg-muted/70 transition-colors"
                    type="button"
                  >
                    <Plus className="h-3 w-3" />
                    Custom Item
                  </button>
                  {cart.length > 0 && (
                    <button
                    onClick={() => {
                      setCart([])
                      mpesaDraftOrderIdRef.current = null
                      setMpesaSessionOrderId(null)
                      console.log("[POS] New sale: cart cleared — M-Pesa session order id reset")
                    }}
                    className="text-[10px] font-medium text-destructive hover:text-destructive/90 transition-colors min-h-[32px] px-2 flex items-center justify-center rounded-lg"
                      type="button"
                    >
                      Clear All
                    </button>
                  )}
                </div>
              </div>

              {cart.length === 0 ? (
                <div className="py-4 text-center">
                  <div className="h-10 w-10 mx-auto mb-2 rounded-lg bg-muted flex items-center justify-center">
                    <Receipt className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <p className="text-xs font-medium text-muted-foreground">No items yet</p>
                  <p className="text-[10px] text-muted-foreground/80 mt-0.5">Select products to start</p>
                </div>
              ) : (
                <div className="space-y-1.5 max-h-[200px] overflow-y-auto pos-items-scroll">
                  {cart.map((item) => {
                    const uniqueKey = item.size ? `${item.id}-${item.size}` : item.id
                    return (
                      <CartItemRow
                        key={uniqueKey}
                        item={{
                          id: item.id,
                          name: item.name,
                          price: item.price,
                          quantity: item.quantity,
                          size: item.size,
                          image: item.image,
                        }}
                        onUpdateQuantity={handleUpdateQuantity}
                        onRemove={handleRemoveItem}
                      />
                    )
                  })}
                </div>
              )}
            </div>

            {/* Service type - compact */}
            <div className="mt-3 bg-muted/50 rounded-xl border border-border p-2.5 space-y-2">
              <div className="flex items-center gap-2 mb-1">
                <Home className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Service Type
                </h3>
              </div>
              
              <SegmentedToggle
                options={[
                  { value: "INHOUSE", label: "Inhouse", icon: <Home className="h-4 w-4" /> },
                  { value: "TAKEOUT", label: "Takeout", icon: <UtensilsCrossed className="h-4 w-4" /> },
                ]}
                value={orderType}
                onChange={(value) => {
                  const newType = value as "INHOUSE" | "TAKEOUT"
                  setOrderType(newType)
                  if (newType === "TAKEOUT") {
                    setSelectedTable(null)
                    setTableNumberInput("")
                    setTableError(null)
                  }
                }}
              />

              {orderType === "INHOUSE" && (
                <OrderInputField
                  label="Table Number"
                  type="number"
                  inputMode="numeric"
                  placeholder="e.g. 12"
                  value={tableNumberInput}
                  onChange={(e) => {
                    setTableNumberInput(e.target.value)
                    setTableError(null)
                    if (e.target.value) {
                      setSelectedTable(parseInt(e.target.value))
                    } else {
                      setSelectedTable(null)
                    }
                  }}
                  helperText="Required for inhouse orders"
                  error={tableError || undefined}
                />
              )}
            </div>

            {/* Customer info */}
            <CustomerFields
              className="mt-3"
              customerName={customerName}
              customerPhone={customerPhone}
              onNameChange={setCustomerName}
              onPhoneChange={(value) => {
                setCustomerPhone(value)
                setPhoneError(null)
              }}
              phoneError={phoneError}
            />

            {cart.length > 0 && (
              <div className="mt-3 flex gap-2">
                <Input
                  value={promoCodeInput}
                  onChange={(e) => setPromoCodeInput(e.target.value.toUpperCase())}
                  placeholder="Promo code"
                  className="h-9 text-sm uppercase"
                />
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 shrink-0"
                  disabled={!promoCodeInput.trim() || promoPreviewLoading}
                  onClick={() => {
                    const code = promoCodeInput.trim()
                    if (!code) return
                    setAppliedPromoCode(code)
                  }}
                >
                  Apply
                </Button>
                {appliedPromoCode && (
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-9 shrink-0 text-muted-foreground"
                    onClick={() => {
                      setAppliedPromoCode(null)
                      setPromoCodeInput("")
                    }}
                  >
                    Clear
                  </Button>
                )}
              </div>
            )}
          </div>

          {/* Sticky checkout footer - totals + payment buttons */}
          <div className="sticky bottom-0 bg-card border-t border-border rounded-t-xl shadow-[0_-2px_10px_rgba(0,0,0,0.04)] shrink-0">
            <div className="px-2.5 py-2.5 space-y-2.5">
              
              {/* Totals block - compact */}
              <div className="bg-muted/50 backdrop-blur-sm rounded-xl border border-border p-2.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span className="font-semibold text-foreground tabular-nums">
                    KSh {subtotal.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
                {orderDiscount > 0 && (
                  <>
                    {(orderPreview?.bundleDiscount ?? 0) > 0 && (
                      <div className="flex items-center justify-between text-xs mt-0.5 text-emerald-700">
                        <span>Bundle savings</span>
                        <span className="tabular-nums">− KSh {(orderPreview?.bundleDiscount ?? 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      </div>
                    )}
                    {(orderPreview?.spendDiscount ?? 0) > 0 && (
                      <div className="flex items-center justify-between text-xs mt-0.5 text-emerald-700">
                        <span>{orderPreview?.spendPromotionName || "Spend promo"}</span>
                        <span className="tabular-nums">− KSh {(orderPreview?.spendDiscount ?? 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      </div>
                    )}
                    {(orderPreview?.couponDiscount ?? 0) > 0 && (
                      <div className="flex items-center justify-between text-xs mt-0.5 text-emerald-700">
                        <span>{orderPreview?.promoCodeLabel || appliedPromoCode}</span>
                        <span className="tabular-nums">− KSh {(orderPreview?.couponDiscount ?? 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      </div>
                    )}
                  </>
                )}
                <div className="flex items-center justify-between text-xs mt-0.5">
                  {/* VAT is already included in item prices; no separate tax line */}
                </div>
                <div className="h-px bg-border my-1.5" />
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-foreground">TOTAL</span>
                  <span className="text-base font-extrabold text-foreground tabular-nums">
                    KSh {total.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
              </div>

              {cart.length > 0 && orderType === "INHOUSE" && !selectedTable && (
                <p className="text-xs text-destructive font-medium text-center">
                  Enter table number for inhouse orders
                </p>
              )}

              {/* Payment buttons - full width, 48px height, softer colors */}
              <div className="flex gap-2">
                <Button
                  onClick={() => {
                    if (orderType === "INHOUSE" && !selectedTable) {
                      setTableError("Table number is required")
                      return
                    }
                    handleCheckout("pay-later")
                    setShowCart(false)
                  }}
                  disabled={cart.length === 0 || (orderType === "INHOUSE" && !selectedTable) || isOrderSubmitting}
                  variant="outline"
                  className="flex-1 min-h-[48px] h-12 text-sm font-bold rounded-xl border border-border bg-card hover:bg-muted text-foreground touch-manipulation"
                >
                  <Clock className="h-4 w-4 mr-1.5 shrink-0" />
                  Pay Later
                </Button>

                <Button
                  onClick={() => {
                    if (orderType === "INHOUSE" && !selectedTable) {
                      setTableError("Table number is required")
                      return
                    }
                    if (customerPhone) {
                      const phoneValidationError = getPhoneValidationError(customerPhone)
                      if (phoneValidationError) {
                        setPhoneError(phoneValidationError)
                        toast.error(phoneValidationError)
                        return
                      }
                    }
                    handleCheckout("glovo")
                    setShowCart(false)
                  }}
                  disabled={cart.length === 0 || (orderType === "INHOUSE" && !selectedTable) || isOrderSubmitting || isProcessingGlovoPayment}
                  className="flex-1 min-h-[48px] h-12 text-sm font-bold rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white touch-manipulation"
                >
                  <Truck className="h-4 w-4 mr-1.5 shrink-0" />
                  Glovo
                </Button>

                {mpesaEnabled && (
                  <Button
                    onClick={() => {
                      if (orderType === "INHOUSE" && !selectedTable) {
                        setTableError("Table number is required")
                        return
                      }
                      if (customerPhone) {
                        const phoneValidationError = getPhoneValidationError(customerPhone)
                        if (phoneValidationError) {
                          setPhoneError(phoneValidationError)
                          toast.error(phoneValidationError)
                          return
                        }
                      }
                      handleCheckout("mpesa")
                      setShowCart(false)
                    }}
                    disabled={cart.length === 0 || (orderType === "INHOUSE" && !selectedTable) || isOrderSubmitting || mpesaProcessing}
                    className="flex-1 min-h-[48px] h-12 text-sm font-bold rounded-xl bg-blue-500 hover:bg-blue-600 text-white touch-manipulation"
                  >
                    <Smartphone className="h-4 w-4 mr-1.5 shrink-0" />
                    M-Pesa
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Modals */}
      <TablePanel
        open={showTablePanel}
        onClose={() => setShowTablePanel(false)}
        selectedTable={selectedTable}
        onSelect={(table) => {
          setSelectedTable(table)
          setShowTablePanel(false)
        }}
      />

      <ReceiptModal
        open={showReceipt}
        onClose={handleCloseReceipt}
        order={showReceipt && lastCartSnapshot.length > 0 ? {
          id: lastTransactionId,
          timestamp: new Date(),
          status: lastPaymentMethod === "pay-later" ? "pending" : "completed",
          table: selectedTable ?? undefined,
          customerPhone: customerPhone || null,
          waiter: waiterId ? extendedStaff.find((s) => s.id === waiterId)?.name || session?.user?.name : session?.user?.name,
          cashier: staff.find((s) => s.id === cashierId)?.name,
          paymentMethod: lastPaymentMethod,
          mpesaReceiptNumber: lastMpesaReceiptNumber,
          glovoOrderNumber: lastGlovoOrderNumber,
          items: lastCartSnapshot.map(item => ({
            name: item.name,
            quantity: item.quantity,
            price: item.price,
            originalPrice: item.originalPrice,
            posDiscountAmount: item.posDiscount?.discountAmount,
            promotionName: item.posDiscount?.promotionName,
          })),
          subtotal: lastCartSnapshot.reduce((sum, item) => sum + item.price * item.quantity, 0),
          vat: 0,
          total: lastCartSnapshot.reduce((sum, item) => sum + item.price * item.quantity, 0),
        } : null}
        businessName="catha lounge"
        businessSubtitle="Restaurant & Bar"
        showQRCode={true}
      />

      {/* M-Pesa Phone Number Dialog */}
      {isMounted && showMpesaDialog && (
        <Dialog
          open={showMpesaDialog}
          onOpenChange={(open) => {
            // Prevent closing via X or backdrop if payment is pending or there's an error
            // User must use the Cancel button
            if (!open && (pendingMpesaOrderId || mpesaError)) return
            if (!open) {
              setShowMpesaDialog(false)
              setMpesaPhoneNumber("")
              setMpesaError(null)
              setMpesaCheckoutRequestId(null)
            }
          }}
        >
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="text-2xl font-bold text-foreground flex items-center gap-3">
                <div className="h-12 w-12 rounded-full bg-gradient-to-br from-primary/20 to-primary/10 flex items-center justify-center">
                  <Smartphone className="h-6 w-6 text-primary" />
                </div>
                M-Pesa Payment
              </DialogTitle>
              <DialogDescription className="text-base pt-2">
                {mpesaError
                  ? "Payment error — review the message below and retry or cancel."
                  : editingOrderId || mpesaSessionOrderId
                    ? `Payment for existing order #${editingOrderId ?? mpesaSessionOrderId}. Enter the customer's phone number.`
                    : "Enter the customer's phone number to initiate M-Pesa payment"}
              </DialogDescription>
            </DialogHeader>
            <div className="py-4 space-y-4">

              {/* Error box */}
              {mpesaError && (
                <div className="bg-red-50 border-2 border-red-200 rounded-lg p-4 flex items-start gap-3">
                  <div className="h-5 w-5 rounded-full bg-red-500 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="text-white text-xs font-bold">!</span>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-red-800 mb-1">
                      {mpesaError.status === 'CANCELLED' ? 'Payment Cancelled'
                        : mpesaError.status === 'FAILED' ? 'Payment Failed'
                        : mpesaError.status === 'TIMEOUT' ? 'Payment Timeout'
                        : 'Payment Error'}
                    </p>
                    <p className="text-sm text-red-700">{mpesaError.message}</p>
                  </div>
                </div>
              )}

              {/* Waiting indicator */}
              {pendingMpesaOrderId && !mpesaError && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <p className="text-sm text-amber-800 flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin flex-shrink-0" />
                    Waiting for M-Pesa confirmation… Please check the customer's phone.
                  </p>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="mpesa-phone">Phone Number</Label>
                <Input
                  id="mpesa-phone"
                  type="tel"
                  placeholder="0712345678, 0113794000, or +254…"
                  value={mpesaPhoneNumber}
                  onChange={(e) => setMpesaPhoneNumber(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && mpesaPhoneNumber.trim() && !mpesaProcessing && !pendingMpesaOrderId) {
                      handleMpesaPayment()
                    }
                  }}
                  autoFocus={!mpesaError}
                  disabled={mpesaProcessing || !!pendingMpesaOrderId}
                  className="text-lg"
                />
                <p className="text-xs text-muted-foreground">
                  Enter phone number: 07…, 01… (e.g. 0113794000), or +254…
                </p>
              </div>

              <div className="bg-muted/50 rounded-lg p-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Total Amount:</span>
                  <span className="font-bold text-primary">
                    Ksh {total.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
              </div>

              <div className="flex gap-3">
                {mpesaError ? (
                  <>
                    <Button
                      onClick={() => {
                        setMpesaError(null)
                        setMpesaCheckoutRequestId(null)
                      }}
                      className="flex-1 h-12 text-base font-semibold bg-gradient-to-r from-primary to-primary/90 hover:from-primary/90 hover:to-primary shadow-lg"
                    >
                      <Smartphone className="h-5 w-5 mr-2" />
                      Retry Payment
                    </Button>
                    <Button
                      onClick={() => {
                        console.log("[POS] M-Pesa dialog cancelled (error state), order row kept for retry:", editingOrderId ?? mpesaSessionOrderId)
                        setShowMpesaDialog(false)
                        setMpesaPhoneNumber("")
                        setMpesaError(null)
                        setPendingMpesaOrderId(null)
                        setMpesaCheckoutRequestId(null)
                        setMpesaProcessing(false)
                      }}
                      variant="outline"
                      className="h-12 text-base font-semibold"
                    >
                      Cancel
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      onClick={handleMpesaPayment}
                      disabled={!mpesaPhoneNumber.trim() || mpesaProcessing || !!pendingMpesaOrderId}
                      className="flex-1 h-12 text-base font-semibold bg-gradient-to-r from-primary to-primary/90 hover:from-primary/90 hover:to-primary shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {mpesaProcessing ? (
                        <span className="flex items-center gap-2">
                          <Loader2 className="h-5 w-5 animate-spin" />
                          Processing...
                        </span>
                      ) : pendingMpesaOrderId ? (
                        <span className="flex items-center gap-2">
                          <Loader2 className="h-5 w-5 animate-spin" />
                          Waiting for Payment...
                        </span>
                      ) : (
                        <>
                          <Smartphone className="h-5 w-5 mr-2" />
                          Send Payment Request
                        </>
                      )}
                    </Button>
                    <Button
                      onClick={() => {
                        console.log("[POS] M-Pesa dialog cancelled while waiting; order stays pending:", pendingMpesaOrderId)
                        setShowMpesaDialog(false)
                        setMpesaPhoneNumber("")
                        setMpesaError(null)
                        setPendingMpesaOrderId(null)
                        setMpesaCheckoutRequestId(null)
                        setMpesaProcessing(false)
                        if (mpesaPollIntervalRef.current) {
                          clearTimeout(mpesaPollIntervalRef.current)
                          mpesaPollIntervalRef.current = null
                        }
                        toast.dismiss("mpesa-push")
                      }}
                      variant="outline"
                      disabled={mpesaProcessing && !pendingMpesaOrderId && !mpesaError}
                      className="h-12 text-base font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Cancel
                    </Button>
                  </>
                )}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Custom Item Dialog */}
      {isMounted && showCustomItemDialog && (
        <Dialog
          open={showCustomItemDialog}
          onOpenChange={(open) => {
            if (!open) {
              setShowCustomItemDialog(false)
              setCustomItemName("")
              setCustomItemQuantity("1")
              setCustomItemVolumeAmount("")
              setCustomItemVolumeUnit("shot")
              setCustomItemPrice("")
            }
          }}
        >
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="text-2xl font-bold text-foreground flex items-center gap-3">
                <div className="h-12 w-12 rounded-full bg-gradient-to-br from-primary/20 to-primary/10 flex items-center justify-center">
                  <Plus className="h-6 w-6 text-primary" />
                </div>
                Add Custom Item
              </DialogTitle>
              <DialogDescription className="text-base pt-2">
                Create a one-off item with name, quantity/volume and amount. It will be added to this order only.
              </DialogDescription>
            </DialogHeader>
            <div className="py-4 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="custom-name">Item Name</Label>
                <Input
                  id="custom-name"
                  placeholder="e.g. Custom cocktail"
                  value={customItemName}
                  onChange={(e) => setCustomItemName(e.target.value)}
                  autoFocus
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="custom-quantity">Quantity</Label>
                  <Input
                    id="custom-quantity"
                    type="number"
                    min={1}
                    value={customItemQuantity}
                    onChange={(e) => {
                      const v = e.target.value
                      if (v === "" || /^\d+$/.test(v)) {
                        setCustomItemQuantity(v)
                      }
                    }}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Volume / Unit</Label>
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      min={0}
                      placeholder="Amount"
                      value={customItemVolumeAmount}
                      onChange={(e) => {
                        const v = e.target.value
                        if (v === "" || /^\d*\.?\d*$/.test(v)) {
                          setCustomItemVolumeAmount(v)
                        }
                      }}
                      className="w-1/2"
                    />
                    <Select
                      value={customItemVolumeUnit}
                      onValueChange={(v) =>
                        setCustomItemVolumeUnit(v as "shot" | "double-shot" | "ml" | "litre")
                      }
                    >
                      <SelectTrigger className="w-1/2">
                        <SelectValue placeholder="Unit" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="shot">Shot</SelectItem>
                        <SelectItem value="double-shot">Double shot</SelectItem>
                        <SelectItem value="ml">ml</SelectItem>
                        <SelectItem value="litre">Litre</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Volume can be in shots, ml or litres (e.g. 2 shots, 50 ml).
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="custom-price">Amount (per item)</Label>
                <Input
                  id="custom-price"
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="Enter amount in Ksh"
                  value={customItemPrice}
                  onChange={(e) => {
                    const v = e.target.value
                    if (v === "" || /^\d*\.?\d*$/.test(v)) {
                      setCustomItemPrice(v)
                    }
                  }}
                />
              </div>

              <div className="flex gap-3 pt-2">
                <Button
                  onClick={() => {
                    const name = customItemName.trim()
                    const qty = parseInt(customItemQuantity || "1", 10) || 1
                    const priceNum = parseFloat(customItemPrice || "0")

                    if (!name || !priceNum || qty <= 0) {
                      toast.error("Please enter item name, quantity and a valid amount.")
                      return
                    }

                    const volumeLabelBase =
                      customItemVolumeUnit === "shot"
                        ? "shot"
                        : customItemVolumeUnit === "double-shot"
                        ? "double shot"
                        : customItemVolumeUnit === "ml"
                        ? "ml"
                        : "litre"

                    const volumeLabel =
                      customItemVolumeAmount.trim().length > 0
                        ? `${customItemVolumeAmount} ${volumeLabelBase}${customItemVolumeAmount === "1" ? "" : volumeLabelBase === "ml" ? "" : "s"}`
                        : volumeLabelBase

                    const id = `custom-${Date.now().toString(36)}`

                    setCart((prev) => [
                      ...prev,
                      {
                        id,
                        name,
                        category: "custom",
                        price: priceNum,
                        cost: 0,
                        stock: Number.MAX_SAFE_INTEGER,
                        minStock: 0,
                        image: "/placeholder.svg?height=150&width=200&query=custom",
                        barcode: "",
                        unit: "custom",
                        supplier: "Custom",
                        quantity: qty,
                        size: volumeLabel,
                        isCustom: true,
                      },
                    ])

                    setShowCustomItemDialog(false)
                    setCustomItemName("")
                    setCustomItemQuantity("1")
                    setCustomItemVolumeAmount("")
                    setCustomItemVolumeUnit("shot")
                    setCustomItemPrice("")
                  }}
                  className="flex-1 h-11 text-base font-semibold bg-gradient-to-r from-primary to-primary/90 hover:from-primary/90 hover:to-primary shadow-lg"
                >
                  Add to Order
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowCustomItemDialog(false)
                    setCustomItemName("")
                    setCustomItemQuantity("1")
                    setCustomItemVolumeAmount("")
                    setCustomItemVolumeUnit("shot")
                    setCustomItemPrice("")
                  }}
                  className="h-11 text-base font-semibold"
                >
                  Cancel
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Glovo Payment Dialog */}
      {isMounted && showGlovoDialog && (
        <Dialog
          open={showGlovoDialog}
          onOpenChange={(open) => {
            if (!open) {
              setShowGlovoDialog(false)
              setGlovoOrderNumber("")
            }
          }}
        >
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="text-2xl font-bold text-foreground flex items-center gap-3">
                <div className="h-12 w-12 rounded-full bg-gradient-to-br from-primary/20 to-primary/10 flex items-center justify-center">
                  <Truck className="h-6 w-6 text-primary" />
                </div>
                Glovo Payment
              </DialogTitle>
              <DialogDescription className="text-base pt-2">
                Enter the Glovo order number to confirm payment.
              </DialogDescription>
            </DialogHeader>
            <div className="py-4 space-y-4">
              <div className="bg-muted/50 rounded-lg p-3">
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-muted-foreground">Total Amount:</span>
                  <span className="font-bold text-primary text-lg">
                    Ksh {total.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="glovo-order-number">Glovo Order Number</Label>
                <Input
                  id="glovo-order-number"
                  type="text"
                  placeholder="Enter Glovo order number"
                  value={glovoOrderNumber}
                  onChange={(e) => {
                    setGlovoOrderNumber(e.target.value)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && glovoOrderNumber.trim() && !isProcessingGlovoPayment && !isOrderSubmitting) {
                      handleConfirmGlovoPayment()
                    }
                  }}
                  autoFocus
                  className="text-lg font-semibold"
                />
                {!glovoOrderNumber.trim() && (
                  <p className="text-xs text-red-600">
                    Glovo order number is required
                  </p>
                )}
              </div>

              <div className="flex gap-3">
                <Button
                  onClick={handleConfirmGlovoPayment}
                  disabled={!glovoOrderNumber.trim() || isProcessingGlovoPayment || isOrderSubmitting}
                  className="flex-1 h-12 text-base font-semibold bg-gradient-to-r from-primary to-primary/90 hover:from-primary/90 hover:to-primary shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isProcessingGlovoPayment ? (
                    <>
                      <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    <>
                      <Truck className="h-5 w-5 mr-2" />
                      Complete Payment
                    </>
                  )}
                </Button>
                <Button
                  onClick={() => {
                    setShowGlovoDialog(false)
                    setGlovoOrderNumber("")
                  }}
                  variant="outline"
                  className="h-12 text-base font-semibold"
                >
                  Cancel
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Navigation Confirmation Dialog - Only render on client */}
      {isMounted && showNavigationDialog && (
        <Dialog open={showNavigationDialog} onOpenChange={(open) => !open && handleStayInPOS()}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="text-2xl font-bold text-foreground flex items-center gap-3">
                <div className="h-12 w-12 rounded-full bg-gradient-to-br from-primary/20 to-primary/10 flex items-center justify-center">
                  <Receipt className="h-6 w-6 text-primary" />
                </div>
                Order Created Successfully!
              </DialogTitle>
              <DialogDescription className="text-base pt-2">
                Order <span className="font-bold text-primary">{createdOrderId}</span> has been saved to the database and is now visible in the Orders page.
              </DialogDescription>
            </DialogHeader>
            <div className="py-4 space-y-3">
              <p className="text-sm text-muted-foreground">
                What would you like to do next?
              </p>
              <div className="flex flex-col gap-3">
                <Button
                  onClick={handleGoToOrders}
                  className="w-full h-12 text-base font-semibold bg-gradient-to-r from-primary to-primary/90 hover:from-primary/90 hover:to-primary shadow-lg"
                >
                  <Receipt className="h-5 w-5 mr-2" />
                  Go to Orders Page
                </Button>
                <Button
                  onClick={handleStayInPOS}
                  variant="outline"
                  className="w-full h-12 text-base font-semibold"
                >
                  Stay in POS
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

    </div>
  )
}
