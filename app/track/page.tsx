"use client"

import { useState, useEffect, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { EcommerceHeader } from "@/components/ecommerce/header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { CheckCircle2, Circle, Package, Truck, Home } from "lucide-react"
import { cn } from "@/lib/utils"

interface OrderStatus {
  id: string
  status: "pending" | "processing" | "shipped" | "delivered" | "cancelled"
  steps: {
    name: string
    status: "completed" | "current" | "pending"
    date?: string
  }[]
}

function TrackOrderPageContent() {
  const searchParams = useSearchParams()
  const [orderId, setOrderId] = useState(searchParams.get("orderId") || "")
  const [trackedOrder, setTrackedOrder] = useState<OrderStatus | null>(
    orderId
      ? {
          id: orderId,
          status: "shipped",
          steps: [
            { name: "Order Placed", status: "completed", date: "2024-01-15 10:30 AM" },
            { name: "Processing", status: "completed", date: "2024-01-15 11:00 AM" },
            { name: "Shipped", status: "current", date: "2024-01-16 09:00 AM" },
            { name: "Out for Delivery", status: "pending" },
            { name: "Delivered", status: "pending" },
          ],
        }
      : null,
  )

  useEffect(() => {
    document.title = "Track Order | Infusion Jaba"
  }, [])

  const handleTrack = () => {
    if (!orderId.trim()) {
      return
    }

    // In a real app, you'd fetch order status from API
    setTrackedOrder({
      id: orderId,
      status: "shipped",
      steps: [
        { name: "Order Placed", status: "completed", date: "2024-01-15 10:30 AM" },
        { name: "Processing", status: "completed", date: "2024-01-15 11:00 AM" },
        { name: "Shipped", status: "current", date: "2024-01-16 09:00 AM" },
        { name: "Out for Delivery", status: "pending" },
        { name: "Delivered", status: "pending" },
      ],
    })
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#F0FDF4] via-[#ECFDF5] to-[#F0FDF4]">
      <EcommerceHeader cartCount={0} />

      <main className="container mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <h1 className="text-3xl font-bold mb-8 text-gray-900">Track Your Order</h1>

        {/* Search Form */}
        <div className="max-w-2xl mb-12">
          <div className="bg-white/90 backdrop-blur-sm rounded-2xl border-2 border-[#10B981]/20 p-6 shadow-lg">
            <Label htmlFor="orderId" className="text-sm font-semibold mb-2 block text-gray-900">
              Enter Order ID
            </Label>
            <div className="flex gap-3">
              <Input
                id="orderId"
                value={orderId}
                onChange={(e) => setOrderId(e.target.value)}
                placeholder="e.g., M482917 or P482917"
                className="rounded-xl h-12 border-[#10B981]/30 focus:border-[#10B981] focus:ring-2 focus:ring-[#10B981]/20 bg-white"
                onKeyDown={(e) => e.key === "Enter" && handleTrack()}
              />
              <Button 
                onClick={handleTrack} 
                className="rounded-xl h-12 px-8 bg-gradient-to-r from-[#10B981] to-[#0E9F6E] hover:from-[#0E9F6E] hover:to-[#10B981] text-white"
              >
                Track Order
              </Button>
            </div>
          </div>
        </div>

        {/* Order Status */}
        {trackedOrder && (
          <div className="max-w-3xl">
            <div className="rounded-2xl border-2 border-[#10B981]/20 bg-white/90 backdrop-blur-sm p-6 mb-6 shadow-lg">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-xl font-bold text-gray-900">Order {trackedOrder.id}</h2>
                  <p className="text-sm text-gray-600 mt-1">
                    Status: <span className="font-medium capitalize text-[#10B981]">{trackedOrder.status}</span>
                  </p>
                </div>
              </div>

              {/* Timeline */}
              <div className="relative">
                {trackedOrder.steps.map((step, index) => (
                  <div key={index} className="relative flex gap-4 pb-8 last:pb-0">
                    {/* Line */}
                    {index < trackedOrder.steps.length - 1 && (
                      <div
                        className={cn(
                          "absolute left-5 top-10 h-full w-0.5",
                          step.status === "completed" ? "bg-[#10B981]" : "bg-gray-200",
                        )}
                      />
                    )}

                    {/* Icon */}
                    <div
                      className={cn(
                        "relative z-10 flex h-10 w-10 items-center justify-center rounded-full border-2",
                        step.status === "completed"
                          ? "border-[#10B981] bg-[#10B981] text-white"
                          : step.status === "current"
                            ? "border-[#10B981] bg-[#10B981]/10 text-[#10B981]"
                            : "border-gray-200 bg-white text-gray-400",
                      )}
                    >
                      {step.status === "completed" ? (
                        <CheckCircle2 className="h-5 w-5" />
                      ) : step.status === "current" ? (
                        <Package className="h-5 w-5" />
                      ) : (
                        <Circle className="h-5 w-5" />
                      )}
                    </div>

                    {/* Content */}
                    <div className="flex-1 pt-1">
                      <h3
                        className={cn(
                          "font-semibold",
                          step.status === "completed" || step.status === "current"
                            ? "text-gray-900"
                            : "text-gray-500",
                        )}
                      >
                        {step.name}
                      </h3>
                      {step.date && (
                        <p className="text-sm text-gray-600 mt-1">{step.date}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Estimated Delivery */}
            <div className="rounded-2xl border-2 border-[#10B981]/20 bg-white/90 backdrop-blur-sm p-6 shadow-lg">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#10B981]/10">
                  <Truck className="h-6 w-6 text-[#10B981]" />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900">Estimated Delivery</h3>
                  <p className="text-sm text-gray-600">January 18, 2024</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {!trackedOrder && (
          <div className="text-center py-12">
            <div className="bg-white/90 backdrop-blur-sm rounded-2xl border-2 border-[#10B981]/20 p-8 shadow-lg max-w-md mx-auto">
              <Package className="h-16 w-16 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-700">Enter an order ID to track your order</p>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

export default function TrackOrderPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-screen">
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-green-600 border-t-transparent" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    }>
      <TrackOrderPageContent />
    </Suspense>
  )
}
