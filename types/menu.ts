export type OrderStatusLegacy = "PENDING" | "IN_PROGRESS" | "RECEIVED" | "CANCELLED"
export type OrderStatus = "draft" | "active" | "sent" | "paid" | "cancelled"
export type PaymentStatus = "UNPAID" | "PAID"
export type PaymentMethod = "mpesa" | "glovo" | "cash" | "pending"

export interface MenuItem {
  id: string
  name: string
  description: string
  price: number
  image: string
  category: string
  inStock: boolean
  tag?: string
  isPopular?: boolean
  isJaba?: boolean
  brand?: string
  /** Raw size from inventory, e.g. "750" or "750ml" */
  size?: string
  unit?: string
  /** Display volume line, e.g. "750ml bottle" */
  volumeLabel?: string
  /** Human category for chips, e.g. "Tequila" */
  categoryLabel?: string
  /** Optional ABV string, e.g. "40% ABV" */
  abv?: string
  /** Style/variant from name, e.g. "Blanco" */
  style?: string
  /** Pairing hint shown in detail sheet */
  pairing?: string
  /** Longer tasting / origin copy for detail sheet */
  tastingNotes?: string
}

export interface CartItem {
  id: string
  name: string
  quantity: number
  unitPrice: number
  image?: string
  notes?: string
}

export interface Order {
  orderId: string
  createdAt: number
  updatedAt?: number
  tableId: string
  tableNumber?: string // alias for tableId
  customerNumber?: string | null
  customerPhone?: string
  guestSessionId?: string | null // for guest orders (device-session based)
  status: OrderStatus
  paymentStatus: PaymentStatus
  paymentMethod?: PaymentMethod
  glovoOrderNumber?: string | null
  items: CartItem[]
  total: number
  subtotal?: number
  lastSentAt?: number // when "Send Now" was clicked
  receivedBy?: string
  /** Set only when staff taps Served on /catha/orders */
  servedAt?: number | string | null
  servedBy?: string | null
  cancelledReason?: string
  /** Set when POS/staff edits this menu round — client shows an alert */
  staffEditedAt?: number | null
  staffEditNotice?: string | null
}

export interface MenuCategory {
  id: string
  name: string
  icon?: string
}
