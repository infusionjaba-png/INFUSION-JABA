"use client"

import type React from "react"

import { useState, useMemo } from "react"
import { Sidebar } from "@/components/layout/sidebar"
import { ReceiptModal } from "@/components/pos/receipt-modal"
import { TablePanel } from "@/components/pos/table-panel"
import { CustomItemModal } from "@/components/pos/custom-item-modal"
import { products, categories, staff, type Product, type Transaction } from "@/lib/dummy-data"
import { createCathaOrderId } from "@/lib/catha-order-id"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Search,
  Grid3X3,
  User,
  Plus,
  Minus,
  Banknote,
  CreditCard,
  Smartphone,
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
  ChevronLeft,
  Clock,
} from "lucide-react"
import { cn } from "@/lib/utils"

interface CartItem extends Product {
  quantity: number
}

// Category icons mapping
const categoryIcons: Record<string, React.ReactNode> = {
  whiskey: <Wine className="h-5 w-5" />,
  vodka: <Martini className="h-5 w-5" />,
  rum: <GlassWater className="h-5 w-5" />,
  gin: <Leaf className="h-5 w-5" />,
  beer: <Beer className="h-5 w-5" />,
  wine: <Grape className="h-5 w-5" />,
  cocktails: <Sparkles className="h-5 w-5" />,
  "soft-drinks": <Coffee className="h-5 w-5" />,
  jaba: <Leaf className="h-5 w-5" />,
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
  jaba: "bg-green-500/15 text-green-700",
}

export default function POSPage() {
  const [selectedCategory, setSelectedCategory] = useState("all")
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedTable, setSelectedTable] = useState<number | null>(null)
  const [cashierId, setCashierId] = useState("1")
  const [waiterId, setWaiterId] = useState("")
  const [cart, setCart] = useState<CartItem[]>([])
  const [showReceipt, setShowReceipt] = useState(false)
  const [showTablePanel, setShowTablePanel] = useState(false)
  const [showCategories, setShowCategories] = useState(false)
  const [lastPaymentMethod, setLastPaymentMethod] = useState("")
  const [lastTransactionId, setLastTransactionId] = useState("")

  const filteredProducts = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()

    return products.filter((product) => {
      const matchesCategory = selectedCategory === "all" || product.category === selectedCategory

      // Allow searching by name or by barcode/serial number (for scanners)
      const matchesSearch =
        query.length === 0 ||
        product.name.toLowerCase().includes(query) ||
        product.barcode.toLowerCase().includes(query)

      return matchesCategory && matchesSearch
    })
  }, [selectedCategory, searchQuery])

  const handleAddItem = (product: Product) => {
    setCart((prev) => {
      const existing = prev.find((item) => item.id === product.id)
      if (existing) {
        return prev.map((item) => (item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item))
      }
      return [...prev, { ...product, quantity: 1 }]
    })
  }

  const handleUpdateQuantity = (productId: string, quantity: number) => {
    if (quantity <= 0) {
      setCart((prev) => prev.filter((item) => item.id !== productId))
    } else {
      setCart((prev) => prev.map((item) => (item.id === productId ? { ...item, quantity } : item)))
    }
  }

  const handleRemoveItem = (productId: string) => {
    setCart((prev) => prev.filter((item) => item.id !== productId))
  }

  const handleCheckout = (method: string) => {
    if (method === "pay-later") {
      // Save order as pending without payment
      const newOrder: Transaction = {
        id: createCathaOrderId("pos"),
        table: selectedTable || 0,
        items: cart.map((item) => ({
          productId: item.id,
          name: item.name,
          quantity: item.quantity,
          price: item.price,
        })),
        subtotal,
        vat,
        total,
        paymentMethod: "pending",
        cashier: staff.find((s) => s.id === cashierId)?.name || "Unknown",
        waiter: waiterId ? staff.find((s) => s.id === waiterId)?.name || "None" : "None",
        timestamp: new Date(),
        status: "pending",
      }

      // Save to localStorage
      if (typeof window !== "undefined") {
        const savedOrders = JSON.parse(localStorage.getItem("orders") || "[]")
        savedOrders.push(newOrder)
        localStorage.setItem("orders", JSON.stringify(savedOrders))
      }

      // Show success message and clear cart
      alert(`Order ${newOrder.id} saved! You can pay later in the Orders page.`)
      setCart([])
      setSelectedTable(null)
      setWaiterId("")
      return
    }

    // Regular payment flow - also save completed order
    const transactionId = createCathaOrderId("pos")
    const completedOrder: Transaction = {
      id: transactionId,
      table: selectedTable || 0,
      items: cart.map((item) => ({
        productId: item.id,
        name: item.name,
        quantity: item.quantity,
        price: item.price,
      })),
      subtotal,
      vat,
      total,
      paymentMethod: method,
      cashier: staff.find((s) => s.id === cashierId)?.name || "Unknown",
      waiter: waiterId ? staff.find((s) => s.id === waiterId)?.name || "None" : "None",
      timestamp: new Date(),
      status: "completed",
    }

    // Save completed order to localStorage (for demo purposes)
    if (typeof window !== "undefined") {
      const allOrders = JSON.parse(localStorage.getItem("allOrders") || "[]")
      allOrders.push(completedOrder)
      localStorage.setItem("allOrders", JSON.stringify(allOrders))
    }

    setLastPaymentMethod(method)
    setLastTransactionId(transactionId)
    setShowReceipt(true)
  }

  const handleCloseReceipt = () => {
    setShowReceipt(false)
    setCart([])
    setSelectedTable(null)
  }

  const handleAddCustomItem = (name: string, price: number) => {
    const customItem: CartItem = {
      id: `custom-${Date.now()}`,
      name,
      category: "custom",
      price,
      cost: price * 0.6,
      stock: 999,
      minStock: 0,
      image: "/custom-drink.jpg",
      barcode: "",
      unit: "item",
      supplier: "Custom",
      quantity: 1,
    }
    setCart((prev) => [...prev, customItem])
  }

  const waiters = staff.filter((s) => s.role === "waiter")

  // Prices are VAT-inclusive in this app; do not add tax on top.
  const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0)
  const vat = 0
  const total = subtotal
  const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0)

  return (
    <div className="flex min-h-screen bg-gradient-to-br from-background via-background to-secondary/20">
      <Sidebar />

      <main className="flex-1 pl-64 flex h-screen overflow-hidden">
        {/* LEFT PANEL - Categories (docked next to sidebar) */}
        <div
          className={cn(
            "flex-shrink-0 h-full transition-all duration-300 ease-out overflow-hidden",
            showCategories ? "w-72 mr-4 opacity-100" : "w-0 mr-0 opacity-0 pointer-events-none"
          )}
        >
          <div className="h-full bg-card/95 backdrop-blur-2xl border-r border-border/60 flex flex-col shadow-2xl">
            <div className="p-6 border-b border-border/50 bg-gradient-to-br from-card via-card to-card/90 flex items-center justify-between backdrop-blur-xl">
            <div>
              <h2 className="text-lg font-bold text-foreground tracking-tight">Categories</h2>
              <p className="text-xs text-muted-foreground mt-1 font-medium">Browse by type</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowCategories(false)}
              className="h-9 w-9 rounded-xl hover:bg-secondary/80 transition-all hover:scale-110"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            </div>

            <nav className="flex-1 p-5 space-y-3 overflow-y-auto">
            <button
              onClick={() => {
                setSelectedCategory("all")
                setShowCategories(false)
              }}
              className={cn(
                "w-full flex items-center gap-3 px-5 py-3.5 rounded-2xl text-sm font-medium transition-all duration-300 relative group overflow-hidden",
                selectedCategory === "all"
                  ? "bg-gradient-to-r from-primary via-primary to-primary/90 text-primary-foreground shadow-2xl shadow-primary/40 scale-[1.03] ring-2 ring-primary/50"
                  : "text-foreground hover:text-foreground bg-gradient-to-r from-secondary/60 to-secondary/40 hover:from-secondary/80 hover:to-secondary/60 hover:scale-[1.02] hover:shadow-lg border-2 border-transparent hover:border-border/50",
              )}
            >
              {/* Animated background effect */}
              <div className={cn(
                "absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300",
                selectedCategory === "all" ? "bg-gradient-to-r from-primary-foreground/10 to-transparent" : "bg-gradient-to-r from-primary/5 to-transparent"
              )}></div>
              
              <div
                className={cn(
                  "relative p-2.5 rounded-xl transition-all duration-300 z-10 flex items-center justify-center",
                  "bg-primary/10 text-primary",
                  selectedCategory === "all"
                    ? "shadow-lg shadow-primary/30 scale-110 ring-2 ring-primary/40"
                    : "opacity-90 group-hover:opacity-100 group-hover:shadow-md group-hover:scale-110"
                )}
              >
                <CircleDot className="h-4 w-4" />
              </div>
              
              <span className="relative flex-1 text-left text-[13px] font-medium z-10">
                {selectedCategory === "all" ? "All Items" : "All Items"}
              </span>
              
              <span className={cn(
                "relative px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all duration-300 z-10",
                selectedCategory === "all" 
                  ? "bg-primary-foreground/30 text-primary-foreground shadow-lg scale-110" 
                  : "bg-secondary/90 text-foreground group-hover:bg-secondary group-hover:scale-110 group-hover:shadow-md"
              )}>
                {products.length}
              </span>
            </button>

            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => {
                  setSelectedCategory(cat.id)
                  setShowCategories(false)
                }}
                className={cn(
                  "w-full flex items-center gap-3 px-5 py-3.5 rounded-2xl text-sm font-medium transition-all duration-300 relative group overflow-hidden",
                  selectedCategory === cat.id
                    ? "bg-gradient-to-r from-primary via-primary to-primary/90 text-primary-foreground shadow-2xl shadow-primary/40 scale-[1.03] ring-2 ring-primary/50"
                    : "text-foreground hover:text-foreground bg-gradient-to-r from-secondary/60 to-secondary/40 hover:from-secondary/80 hover:to-secondary/60 hover:scale-[1.02] hover:shadow-lg border-2 border-transparent hover:border-border/50",
                )}
              >
                {/* Animated background effect */}
                <div className={cn(
                  "absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300",
                  selectedCategory === cat.id ? "bg-gradient-to-r from-primary-foreground/10 to-transparent" : "bg-gradient-to-r from-primary/5 to-transparent"
                )}></div>
                
                <div
                  className={cn(
                    "relative p-2.5 rounded-xl transition-all duration-300 z-10 flex items-center justify-center",
                    categoryIconColors[cat.id] ?? "bg-secondary/70 text-foreground",
                    selectedCategory === cat.id
                      ? "shadow-lg shadow-primary/30 scale-110 ring-2 ring-primary/50"
                      : "opacity-90 group-hover:opacity-100 group-hover:shadow-md group-hover:scale-110"
                  )}
                >
                  <div className="scale-110">
                    {categoryIcons[cat.id] || <CircleDot className="h-4 w-4" />}
                  </div>
                </div>
                
                <span className="relative flex-1 text-left text-[13px] font-medium z-10">
                  {cat.name}
                </span>
                
                <span className={cn(
                  "relative px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all duration-300 z-10",
                  selectedCategory === cat.id 
                    ? "bg-primary-foreground/30 text-primary-foreground shadow-lg scale-110" 
                    : "bg-secondary/90 text-foreground group-hover:bg-secondary group-hover:scale-110 group-hover:shadow-md"
                )}>
                  {cat.productCount}
                </span>
              </button>
            ))}
            </nav>
          </div>
        </div>

        {/* MIDDLE PANEL - Products */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-gradient-to-b from-background/50 to-background">
          {/* Top Bar */}
          <div className="flex items-center gap-4 px-8 py-5 bg-card/60 backdrop-blur-xl border-b border-border/50 shadow-sm">
            {/* Category Toggle */}
            <Button
              variant="outline"
              onClick={() => setShowCategories(!showCategories)}
              className={cn(
                "h-12 px-5 gap-2.5 rounded-2xl border-border/50 bg-background/80 shadow-sm hover:shadow-md transition-all font-medium",
                showCategories && "border-primary/50 bg-primary/10 text-primary shadow-md shadow-primary/10"
              )}
            >
              <Menu className={cn("h-4 w-4 transition-transform duration-200", showCategories && "rotate-90")} />
              Categories
            </Button>

            {/* Search */}
            <div className="relative flex-1 max-w-lg">
              <Search className="absolute left-5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground/70" />
              <Input
                placeholder="Search products by name or scan barcode..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-12 h-12 bg-background/80 border-border/50 rounded-2xl text-base shadow-sm focus:shadow-md focus:border-primary/50 transition-all"
              />
            </div>

            {/* Table */}
            <Button
              variant="outline"
              onClick={() => setShowTablePanel(true)}
              className={cn(
                "h-12 px-6 gap-2.5 rounded-2xl border-border/50 bg-background/80 shadow-sm hover:shadow-md transition-all font-medium",
                selectedTable && "border-primary/60 bg-primary/10 text-primary shadow-md shadow-primary/10",
              )}
            >
              <Grid3X3 className="h-4 w-4" />
              {selectedTable ? `Table ${selectedTable}` : "Select Table"}
            </Button>

            {/* Waiter */}
            <Select value={waiterId} onValueChange={setWaiterId}>
              <SelectTrigger className="w-44 h-12 rounded-2xl border-border/50 bg-background/80 shadow-sm hover:shadow-md transition-all">
                <User className="h-4 w-4 mr-2.5 text-muted-foreground" />
                <SelectValue placeholder="Waiter" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No Waiter</SelectItem>
                {waiters.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Custom Item */}
            <Button
              variant="outline"
              onClick={() => document.getElementById("custom-item-trigger")?.click()}
              className="h-12 px-5 gap-2 rounded-2xl border-dashed border-2 border-border/60 text-muted-foreground hover:text-foreground hover:border-primary/60 hover:bg-primary/5 transition-all font-medium"
            >
              <Plus className="h-4 w-4" />
              Custom Item
            </Button>
          </div>

          {/* Products Grid */}
          <div className="flex-1 overflow-y-auto p-8">
            {filteredProducts.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                <div className="relative mb-6">
                  <div className="absolute inset-0 bg-primary/10 blur-3xl rounded-full"></div>
                  <Search className="h-16 w-16 relative opacity-30" />
                </div>
                <p className="text-xl font-semibold mb-2">No products found</p>
                <p className="text-sm text-muted-foreground/80">Try a different search or category</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-5">
                {filteredProducts.map((product) => {
                  const isLowStock = product.stock < product.minStock
                  const inCart = cart.find((item) => item.id === product.id)

                  return (
                    <button
                      key={product.id}
                      onClick={() => handleAddItem(product)}
                      className={cn(
                        "group relative flex flex-col rounded-3xl bg-gradient-to-br from-blue-50 to-purple-50 border-2 border-blue-200/60 overflow-hidden transition-all duration-300",
                        "hover:border-primary/80 hover:shadow-2xl hover:shadow-primary/20 hover:-translate-y-1",
                        "active:scale-[0.97] active:translate-y-0",
                        inCart && "ring-2 ring-primary/80 ring-offset-2 ring-offset-background shadow-xl shadow-primary/30 bg-gradient-to-br from-emerald-50 to-teal-50 border-primary/60",
                      )}
                    >
                      {/* Image */}
                      <div className="relative aspect-[4/3] bg-gradient-to-br from-secondary/60 via-secondary/40 to-secondary/20 overflow-hidden">
                        <div className="absolute inset-0 bg-gradient-to-t from-black/5 to-transparent z-10"></div>
                        <img
                          src={product.image || "/placeholder.svg?height=150&width=200&query=drink bottle"}
                          alt={product.name}
                          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                        />

                        {/* Quantity badge if in cart */}
                        {inCart && (
                          <div className="absolute top-3 right-3 h-8 w-8 rounded-full bg-gradient-to-br from-primary to-primary/80 text-primary-foreground text-xs font-bold flex items-center justify-center shadow-lg shadow-primary/30 z-20 animate-in zoom-in duration-200">
                            {inCart.quantity}
                          </div>
                        )}

                        {/* Low stock indicator */}
                        {isLowStock && (
                          <div className="absolute top-3 left-3 px-2.5 py-1 rounded-full bg-gradient-to-r from-destructive to-destructive/90 text-destructive-foreground text-[10px] font-bold shadow-md z-20">
                            Low Stock
                          </div>
                        )}

                        {/* Jaba badge */}
                        {product.isJaba && (
                          <div className="absolute bottom-3 left-3 px-2.5 py-1 rounded-full bg-gradient-to-r from-success to-success/90 text-success-foreground text-[10px] font-bold shadow-md z-20">
                            Jaba
                          </div>
                        )}

                        {/* Hover overlay */}
                        <div className="absolute inset-0 bg-primary/0 group-hover:bg-primary/5 transition-colors duration-300 z-10"></div>
                      </div>

                      {/* Info */}
                      <div className="p-4 flex-1 flex flex-col bg-white/90">
                        <h3 className="text-base font-bold text-gray-800 line-clamp-2 text-left mb-2 group-hover:text-primary transition-colors leading-tight">
                          {product.name}
                        </h3>
                        <div className="flex items-end justify-between mt-auto pt-2 border-t border-border/30">
                          <div className="flex flex-col items-start">
                            <div className="flex items-baseline gap-1">
                              <span className="text-xs font-bold text-primary/70 uppercase tracking-wider">Ksh</span>
                              <span className="text-2xl font-black text-primary leading-none">
                                {product.price.toLocaleString("en-KE", {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}
                              </span>
                            </div>
                            <span className="text-[10px] text-muted-foreground/70 font-medium mt-1.5">{product.stock} in stock</span>
                          </div>
                          <div className="h-8 w-8 rounded-full bg-primary/10 group-hover:bg-primary/20 flex items-center justify-center transition-all group-hover:scale-110">
                            <Plus className="h-4 w-4 text-primary" />
                          </div>
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT PANEL - Cart */}
        <div className="w-[420px] flex-shrink-0 bg-card/80 backdrop-blur-xl border-l border-border/50 flex flex-col shadow-2xl">
          {/* Cart Header */}
          <div className="flex items-center justify-between px-6 py-5 border-b border-border/50 bg-gradient-to-r from-card to-card/90">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/10 flex items-center justify-center shadow-lg shadow-primary/10">
                <ShoppingCart className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h2 className="font-bold text-xl text-foreground tracking-tight">Current Order</h2>
                <p className="text-sm text-muted-foreground font-semibold mt-1.5 flex items-center gap-2">
                  <span className="px-3 py-1.5 rounded-lg bg-primary/20 text-primary font-bold border-2 border-primary/40 shadow-md">
                    {totalItems} item{totalItems !== 1 ? "s" : ""}
                  </span>
                  {selectedTable && (
                    <span className="px-3 py-1.5 rounded-lg bg-primary/25 text-primary font-bold border-2 border-primary/50 shadow-md">
                      Table {selectedTable}
                    </span>
                  )}
                </p>
              </div>
            </div>
            {cart.length > 0 && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setCart([])}
                className="h-10 w-10 rounded-xl text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>

          {/* Cart Items */}
          <div className="flex-1 overflow-y-auto p-6 bg-muted/40">
            {cart.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                <div className="relative mb-6">
                  <div className="absolute inset-0 bg-primary/10 blur-2xl rounded-full"></div>
                  <div className="h-24 w-24 rounded-3xl bg-gradient-to-br from-secondary/40 to-secondary/20 flex items-center justify-center relative shadow-lg">
                    <Receipt className="h-10 w-10 opacity-40" />
                  </div>
                </div>
                <p className="font-semibold text-base mb-1">No items yet</p>
                <p className="text-sm text-center text-muted-foreground/80">Select products from the menu to start an order</p>
              </div>
            ) : (
              <div className="space-y-3 bg-gradient-to-br from-purple-50 to-pink-50 shadow-lg border-2 border-purple-200/70 rounded-3xl p-4">
                {cart.map((item) => (
                  <div
                    key={item.id}
                    className="group relative flex flex-col gap-3 p-4 rounded-2xl bg-white border-2 border-purple-200/50 shadow-md hover:shadow-lg hover:border-primary/60 transition-all duration-200"
                  >
                    {/* Top Row: Image, Name, Price */}
                    <div className="flex items-start gap-3">
                      {/* Thumbnail */}
                      <div className="relative h-16 w-16 rounded-xl bg-gradient-to-br from-secondary/80 to-secondary/60 overflow-hidden flex-shrink-0 shadow-md ring-2 ring-border/40 group-hover:ring-primary/50 transition-all">
                        <img
                          src={item.image || "/placeholder.svg?height=56&width=56&query=drink"}
                          alt={item.name}
                          className="h-full w-full object-cover"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/10 to-transparent"></div>
                      </div>

                      {/* Product Details */}
                      <div className="flex-1 min-w-0 pr-1.5">
                        <h3 className="text-base font-bold text-gray-800 mb-2 group-hover:text-primary transition-colors leading-tight">
                          {item.name}
                        </h3>
                        <div className="flex items-baseline gap-1.5">
                          <span className="text-xs font-semibold text-muted-foreground">
                            Ksh{" "}
                            {item.price.toLocaleString("en-KE", {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </span>
                          <span className="text-xs text-muted-foreground/70 font-medium">each</span>
                        </div>
                      </div>

                      {/* Total Price */}
                      <div className="flex-shrink-0 text-right">
                        <div className="flex items-baseline gap-1.5 justify-end mb-2">
                          <span className="text-xs font-bold text-primary/70 uppercase tracking-wider">Ksh</span>
                          <span className="text-2xl font-black text-primary leading-none">
                            {(item.price * item.quantity).toLocaleString("en-KE", {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </span>
                        </div>
                        <div className="text-[11px] text-muted-foreground/80 font-semibold mt-1 bg-muted/50 px-2 py-1 rounded-md inline-block">
                          {item.quantity} × Ksh{" "}
                          {item.price.toLocaleString("en-KE", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </div>
                      </div>
                    </div>

                    {/* Bottom Row: Quantity Controls & Remove */}
                    <div className="flex items-center justify-between pt-2 border-t border-border/30">
                      {/* Quantity Controls */}
                      <div className="flex items-center gap-3">
                        <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Qty</span>
                        <div className="flex items-center gap-1.5 bg-secondary/80 rounded-2xl p-1 border border-border/40">
                          <button
                            onClick={() => handleUpdateQuantity(item.id, item.quantity - 1)}
                            className="h-8 w-8 rounded-lg bg-background hover:bg-card hover:text-primary flex items-center justify-center transition-all shadow-sm hover:shadow-md active:scale-95 font-semibold"
                          >
                            <Minus className="h-3.5 w-3.5" />
                          </button>
                          <div className="w-10 h-8 rounded-lg bg-background/90 flex items-center justify-center shadow-inner border border-border/30">
                            <span className="text-sm font-bold text-foreground">{item.quantity}</span>
                          </div>
                          <button
                            onClick={() => handleUpdateQuantity(item.id, item.quantity + 1)}
                            className="h-8 w-8 rounded-lg bg-primary/10 hover:bg-primary hover:text-primary-foreground flex items-center justify-center transition-all shadow-sm hover:shadow-md active:scale-95 font-semibold text-primary"
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Remove Button */}
                      <button
                        onClick={() => handleRemoveItem(item.id)}
                        className="group/remove flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-destructive bg-destructive/10 hover:bg-destructive hover:text-destructive-foreground transition-all duration-200 border border-destructive/30 hover:border-destructive"
                      >
                        <X className="h-3.5 w-3.5 group-hover/remove:rotate-90 transition-transform duration-200" />
                        <span>Remove</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Totals & Payment */}
          <div className="border-t border-border/50 bg-gradient-to-br from-cyan-50 to-blue-50 px-4 py-3 space-y-3 shadow-2xl">
            {/* Totals */}
            <div className="space-y-2.5 bg-white rounded-2xl px-4 py-3 border border-primary/20 shadow-md">
              <div className="flex justify-between items-center py-1.5">
                <span className="text-muted-foreground font-semibold text-xs uppercase tracking-wide">Subtotal</span>
                <div className="flex items-baseline gap-1">
                  <span className="text-[11px] font-bold text-primary/60 uppercase">Ksh</span>
                  <span className="text-base font-bold text-gray-800">
                    {subtotal.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
              {/* VAT is already included in item prices; no separate tax line */}
              <div className="h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent my-2" />
              <div className="flex justify-between items-center pt-1.5 pb-2.5">
                <span className="text-lg font-bold text-gray-800 tracking-tight uppercase">Total</span>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-xs font-black text-primary/70 uppercase tracking-widest">Ksh</span>
                  <span className="text-3xl font-black text-primary leading-none tracking-tight">
                    {total.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
            </div>

            {/* Payment Options */}
            <div className="grid grid-cols-3 gap-3">
              <Button
                variant="outline"
                onClick={() => handleCheckout("cash")}
                disabled={cart.length === 0}
                className="h-16 flex-col gap-2 rounded-2xl border-border/50 bg-background/80 hover:border-success/50 hover:bg-success/5 hover:shadow-lg hover:shadow-success/10 disabled:opacity-40 transition-all duration-200 group"
              >
                <div className="h-9 w-9 rounded-xl bg-success/10 group-hover:bg-success/20 flex items-center justify-center transition-all">
                  <Banknote className="h-5 w-5 text-success" />
                </div>
                <span className="text-xs font-semibold">Cash</span>
              </Button>
              <Button
                variant="outline"
                onClick={() => handleCheckout("card")}
                disabled={cart.length === 0}
                className="h-16 flex-col gap-2 rounded-2xl border-border/50 bg-background/80 hover:border-blue-400/50 hover:bg-blue-400/5 hover:shadow-lg hover:shadow-blue-400/10 disabled:opacity-40 transition-all duration-200 group"
              >
                <div className="h-9 w-9 rounded-xl bg-blue-400/10 group-hover:bg-blue-400/20 flex items-center justify-center transition-all">
                  <CreditCard className="h-5 w-5 text-blue-400" />
                </div>
                <span className="text-xs font-semibold">Card</span>
              </Button>
              <Button
                variant="outline"
                onClick={() => handleCheckout("mpesa")}
                disabled={cart.length === 0}
                className="h-16 flex-col gap-2 rounded-2xl border-border/50 bg-background/80 hover:border-primary/50 hover:bg-primary/5 hover:shadow-lg hover:shadow-primary/10 disabled:opacity-40 transition-all duration-200 group"
              >
                <div className="h-9 w-9 rounded-xl bg-primary/10 group-hover:bg-primary/20 flex items-center justify-center transition-all">
                  <Smartphone className="h-5 w-5 text-primary" />
                </div>
                <span className="text-xs font-semibold">M-Pesa</span>
              </Button>
            </div>

            {/* Pay Later Button */}
            <Button
              onClick={() => handleCheckout("pay-later")}
              disabled={cart.length === 0}
              variant="outline"
              className="w-full h-14 text-base font-semibold rounded-2xl border-2 border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-800 hover:text-amber-900 disabled:opacity-40 transition-all duration-200"
            >
              <Clock className="h-5 w-5 mr-2" />
              Pay Later
            </Button>

            {/* Complete Button */}
            <Button
              onClick={() => handleCheckout("card")}
              disabled={cart.length === 0}
              className="w-full h-16 text-base font-bold rounded-2xl bg-gradient-to-r from-primary to-primary/90 hover:from-primary/90 hover:to-primary shadow-xl shadow-primary/25 hover:shadow-2xl hover:shadow-primary/30 disabled:opacity-40 disabled:shadow-none transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
            >
              <Receipt className="h-5 w-5 mr-2" />
              Complete Sale
            </Button>
          </div>
        </div>
      </main>

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

      <CustomItemModal onAddItem={handleAddCustomItem} />

      <ReceiptModal
        open={showReceipt}
        onClose={handleCloseReceipt}
        items={cart}
        table={selectedTable}
        cashierId={cashierId}
        waiterId={waiterId}
        paymentMethod={lastPaymentMethod}
        transactionId={lastTransactionId}
      />
    </div>
  )
}
