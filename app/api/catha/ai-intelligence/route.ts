import { NextResponse } from 'next/server'
import { getDatabase } from '@/lib/mongodb'
import { requireSuperAdminApi } from '@/lib/catha-auth'
import {
  loadPosDiscountContext,
  isDiscountEffectivelyActive,
  sumPosDiscountSavingsFromOrders,
} from '@/lib/pos-product-discounts'
import { countPendingManualMpesaVerifications } from '@/lib/catha-manual-mpesa-verification'
import { getShiftSmsQueueMetrics } from '@/lib/models/shift-sms-queue'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
  const [session, errResp] = await requireSuperAdminApi()
  if (errResp) return errResp

  try {
    const db = await getDatabase('infusion_jaba')
    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const yesterdayStart = new Date(todayStart); yesterdayStart.setDate(yesterdayStart.getDate() - 1)
    const sevenDaysAgo = new Date(todayStart); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
    const thirtyDaysAgo = new Date(todayStart); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
    const sixtyDaysAgo = new Date(todayStart); sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60)

    const [products, recentOrders, olderOrders, stockMovements, suppliers, expenses] = await Promise.all([
      db.collection('bar_inventory').find({ type: 'bar', deleted: { $ne: true } }).toArray(),
      db.collection('orders').find({ timestamp: { $gte: thirtyDaysAgo } }).sort({ timestamp: -1 }).toArray(),
      db.collection('orders').find({ timestamp: { $gte: sixtyDaysAgo, $lt: thirtyDaysAgo } }).sort({ timestamp: -1 }).toArray(),
      db.collection('bar_stock_movements').find({ type: 'bar', date: { $gte: thirtyDaysAgo } }).sort({ date: -1 }).toArray(),
      db.collection('bar_suppliers').find({}).toArray(),
      db.collection('bar_expenses').find({ date: { $gte: thirtyDaysAgo } }).sort({ date: -1 }).toArray(),
    ])

    const allOrders = [...recentOrders, ...olderOrders]
    const completedOrders = recentOrders.filter((o: any) => o.status === 'completed' || o.paymentStatus === 'PAID')
    const todayOrders = completedOrders.filter((o: any) => {
      const t = o.timestamp instanceof Date ? o.timestamp : new Date(o.timestamp)
      return t >= todayStart
    })
    const yesterdayOrders = completedOrders.filter((o: any) => {
      const t = o.timestamp instanceof Date ? o.timestamp : new Date(o.timestamp)
      return t >= yesterdayStart && t < todayStart
    })
    const weekOrders = completedOrders.filter((o: any) => {
      const t = o.timestamp instanceof Date ? o.timestamp : new Date(o.timestamp)
      return t >= sevenDaysAgo
    })

    // ── DATA QUALITY ANALYSIS ──
    const missingCost = products.filter((p: any) => !p.cost || p.cost <= 0)
    const missingPrice = products.filter((p: any) => !p.price || p.price <= 0)
    const missingCategory = products.filter((p: any) => !p.category || p.category === 'other')
    const missingBarcode = products.filter((p: any) => !p.barcode)
    const missingImage = products.filter((p: any) => !p.image)
    const missingSupplier = products.filter((p: any) => !p.supplier)

    const dataQualityScore = products.length > 0
      ? Math.round(((products.length - missingCost.length) / products.length * 30)
        + ((products.length - missingPrice.length) / products.length * 30)
        + ((products.length - missingCategory.length) / products.length * 20)
        + ((products.length - missingBarcode.length) / products.length * 20))
      : 0

    // ── STOCK ANALYSIS ──
    const lowStock = products.filter((p: any) => (p.stock ?? 0) <= (p.minStock ?? 0) && (p.minStock ?? 0) > 0)
    const outOfStock = products.filter((p: any) => (p.stock ?? 0) <= 0)

    const productSalesMap: Record<string, { qty: number; revenue: number; name: string }> = {}
    for (const o of completedOrders) {
      for (const item of o.items || []) {
        const pid = String(item.productId || item._id || '')
        if (!productSalesMap[pid]) productSalesMap[pid] = { qty: 0, revenue: 0, name: item.name || 'Unknown' }
        productSalesMap[pid].qty += Number(item.quantity) || 0
        productSalesMap[pid].revenue += (Number(item.quantity) || 0) * (Number(item.price) || 0)
      }
    }

    const weekProductSalesMap: Record<string, number> = {}
    for (const o of weekOrders) {
      for (const item of o.items || []) {
        const pid = String(item.productId || item._id || '')
        weekProductSalesMap[pid] = (weekProductSalesMap[pid] || 0) + (Number(item.quantity) || 0)
      }
    }

    const restockNow = lowStock.filter((p: any) => {
      const pid = p._id.toString()
      return (weekProductSalesMap[pid] || 0) > 0
    }).map((p: any) => ({
      id: p._id.toString(), name: p.name, stock: p.stock ?? 0, minStock: p.minStock ?? 0,
      recentDemand: weekProductSalesMap[p._id.toString()] || 0, category: p.category,
    })).sort((a: any, b: any) => b.recentDemand - a.recentDemand)

    const deadStock = products.filter((p: any) => {
      const pid = p._id.toString()
      return (p.stock ?? 0) > 0 && !productSalesMap[pid]
    }).map((p: any) => ({ id: p._id.toString(), name: p.name, stock: p.stock ?? 0, category: p.category }))

    const overstock = products.filter((p: any) => {
      const pid = p._id.toString()
      const sales = productSalesMap[pid]?.qty || 0
      return (p.stock ?? 0) > 0 && sales < (p.stock ?? 0) * 0.1 && (p.stock ?? 0) > (p.minStock ?? 0) * 3
    }).map((p: any) => ({
      id: p._id.toString(), name: p.name, stock: p.stock ?? 0,
      monthlySales: productSalesMap[p._id.toString()]?.qty || 0, category: p.category,
    }))

    const fastMovers = Object.entries(productSalesMap)
      .sort((a, b) => b[1].qty - a[1].qty).slice(0, 10)
      .map(([id, data]) => {
        const prod = products.find((p: any) => p._id.toString() === id)
        return { id, name: data.name, monthlySales: data.qty, revenue: Math.round(data.revenue), stock: prod?.stock ?? 0, category: prod?.category }
      })

    const slowMovers = Object.entries(productSalesMap)
      .filter(([, data]) => data.qty > 0)
      .sort((a, b) => a[1].qty - b[1].qty).slice(0, 10)
      .map(([id, data]) => {
        const prod = products.find((p: any) => p._id.toString() === id)
        return { id, name: data.name, monthlySales: data.qty, stock: prod?.stock ?? 0, category: prod?.category }
      })

    const inventoryHealthScore = products.length > 0
      ? Math.round(100 - (lowStock.length / products.length * 40) - (outOfStock.length / products.length * 30) - (deadStock.length / products.length * 30))
      : 0

    // ── SALES & TIMING ANALYSIS ──
    const todaySales = todayOrders.reduce((s: number, o: any) => s + (o.total || 0), 0)
    const yesterdaySales = yesterdayOrders.reduce((s: number, o: any) => s + (o.total || 0), 0)
    const weekSales = weekOrders.reduce((s: number, o: any) => s + (o.total || 0), 0)

    const hourlyDistribution = Array.from({ length: 24 }, (_, h) => ({ hour: h, orders: 0, revenue: 0 }))
    const dailyDistribution = Array.from({ length: 7 }, (_, d) => ({ day: d, orders: 0, revenue: 0 }))

    for (const o of completedOrders) {
      const t = o.timestamp instanceof Date ? o.timestamp : new Date(o.timestamp)
      hourlyDistribution[t.getHours()].orders += 1
      hourlyDistribution[t.getHours()].revenue += o.total || 0
      dailyDistribution[t.getDay()].orders += 1
      dailyDistribution[t.getDay()].revenue += o.total || 0
    }

    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    const peakHours = [...hourlyDistribution].sort((a, b) => b.orders - a.orders).slice(0, 5)
      .map(h => ({ hour: `${String(h.hour).padStart(2, '0')}:00`, orders: h.orders, revenue: Math.round(h.revenue) }))
    const peakDays = [...dailyDistribution].sort((a, b) => b.revenue - a.revenue).slice(0, 3)
      .map(d => ({ day: dayNames[d.day], orders: d.orders, revenue: Math.round(d.revenue) }))

    const salesHealthScore = (() => {
      if (completedOrders.length === 0) return 30
      let score = 50
      if (todaySales > 0) score += 15
      if (todaySales >= yesterdaySales && yesterdaySales > 0) score += 15
      if (weekOrders.length > 20) score += 10
      if (weekOrders.length > 50) score += 10
      return Math.min(score, 100)
    })()

    // ── PROFIT ANALYSIS ──
    const topRevenue = Object.entries(productSalesMap)
      .sort((a, b) => b[1].revenue - a[1].revenue).slice(0, 10)
      .map(([id, data]) => {
        const prod = products.find((p: any) => p._id.toString() === id)
        const cost = prod?.cost || 0
        const sellingPrice = prod?.price || 0
        const margin = cost > 0 && sellingPrice > 0 ? Math.round(((sellingPrice - cost) / sellingPrice) * 100) : null
        return {
          id, name: data.name, revenue: Math.round(data.revenue), qty: data.qty,
          cost, sellingPrice, margin, category: prod?.category,
        }
      })

    const highMarginProducts = products
      .filter((p: any) => p.cost && p.cost > 0 && p.price && p.price > 0)
      .map((p: any) => {
        const margin = Math.round(((p.price - p.cost) / p.price) * 100)
        const sales = productSalesMap[p._id.toString()]
        return { id: p._id.toString(), name: p.name, margin, cost: p.cost, price: p.price, monthlySales: sales?.qty || 0, revenue: sales?.revenue || 0, category: p.category }
      })
      .sort((a: any, b: any) => b.margin - a.margin).slice(0, 10)

    const lowMarginHighSales = products
      .filter((p: any) => p.cost && p.cost > 0 && p.price && p.price > 0)
      .map((p: any) => {
        const margin = Math.round(((p.price - p.cost) / p.price) * 100)
        const sales = productSalesMap[p._id.toString()]
        return { id: p._id.toString(), name: p.name, margin, cost: p.cost, price: p.price, monthlySales: sales?.qty || 0, category: p.category }
      })
      .filter((p: any) => p.margin < 30 && p.monthlySales > 5)
      .sort((a: any, b: any) => b.monthlySales - a.monthlySales).slice(0, 10)

    // ── ORDER BEHAVIOR / OPERATIONS ANALYSIS ──
    const allRecentOrders = recentOrders
    const cancelledOrders = allRecentOrders.filter((o: any) => o.status === 'cancelled' || o.status === 'voided')
    const editedOrders = allRecentOrders.filter((o: any) => o.edited || o.modified || o.updatedAt)
    const cancelRate = allRecentOrders.length > 0 ? Math.round((cancelledOrders.length / allRecentOrders.length) * 100) : 0
    const editRate = allRecentOrders.length > 0 ? Math.round((editedOrders.length / allRecentOrders.length) * 100) : 0

    const paymentMethods: Record<string, number> = {}
    for (const o of completedOrders) {
      const method = o.paymentMethod || 'Unknown'
      paymentMethods[method] = (paymentMethods[method] || 0) + 1
    }

    const manualAdjustments = stockMovements.filter((m: any) =>
      m.reason === 'manual' || m.reason === 'adjustment' || m.reason === 'correction'
    )

    const operationsHealthScore = (() => {
      let score = 80
      if (cancelRate > 10) score -= 20
      else if (cancelRate > 5) score -= 10
      if (editRate > 20) score -= 15
      if (manualAdjustments.length > 20) score -= 15
      return Math.max(score, 10)
    })()

    // ── CLIENT ANALYSIS ──
    const clientMap: Record<string, { phone: string; name: string; visits: number; spend: number; lastOrder: Date | null; firstOrder: Date | null }> = {}
    for (const o of allOrders) {
      if (!o.customerPhone) continue
      const phone = o.customerPhone
      if (!clientMap[phone]) {
        clientMap[phone] = { phone, name: o.customerName || phone, visits: 0, spend: 0, lastOrder: null, firstOrder: null }
      }
      if (o.status === 'completed' || o.paymentStatus === 'PAID') {
        clientMap[phone].visits += 1
        clientMap[phone].spend += o.total || 0
      }
      const t = o.timestamp instanceof Date ? o.timestamp : new Date(o.timestamp)
      if (!clientMap[phone].lastOrder || t > clientMap[phone].lastOrder!) clientMap[phone].lastOrder = t
      if (!clientMap[phone].firstOrder || t < clientMap[phone].firstOrder!) clientMap[phone].firstOrder = t
    }

    const clients = Object.values(clientMap).filter(c => c.visits > 0)
    const repeatCustomers = clients.filter(c => c.visits >= 2)
    const highValueClients = [...clients].sort((a, b) => b.spend - a.spend).slice(0, 10)
    const inactiveClients = clients.filter(c => {
      if (!c.lastOrder) return false
      return c.lastOrder < thirtyDaysAgo && c.visits >= 2
    })
    const avgSpendPerClient = clients.length > 0
      ? Math.round(clients.reduce((s, c) => s + c.spend, 0) / clients.length)
      : 0

    const clientRetentionScore = (() => {
      if (clients.length === 0) return 30
      const repeatRate = clients.length > 0 ? repeatCustomers.length / clients.length : 0
      const inactiveRate = clients.length > 0 ? inactiveClients.length / clients.length : 0
      return Math.round(Math.min(100, 40 + repeatRate * 40 - inactiveRate * 20))
    })()

    // ── SUPPLIER ANALYSIS ──
    const productsNeedingSupplier = products.filter((p: any) => !p.supplier && (weekProductSalesMap[p._id.toString()] || 0) > 0)
    const supplierProducts = products.filter((p: any) => p.supplier)
    const supplierLowStock = supplierProducts.filter((p: any) => (p.stock ?? 0) <= (p.minStock ?? 0))

    // ── ORDER SOURCE ANALYSIS ──
    const orderSourceMap: Record<string, { count: number; revenue: number }> = {}
    for (const o of completedOrders) {
      const source = o.source || o.orderSource || (o.table ? 'dine-in' : 'counter')
      if (!orderSourceMap[source]) orderSourceMap[source] = { count: 0, revenue: 0 }
      orderSourceMap[source].count += 1
      orderSourceMap[source].revenue += o.total || 0
    }

    // ── EXPENSE ANALYSIS (30 days) ──
    const totalExpenses30d = expenses.reduce((s: number, e: any) => s + (Number(e.amount) || 0), 0)
    const expenseCategoryMap: Record<string, number> = {}
    for (const e of expenses) {
      const cat = e.category || 'other'
      expenseCategoryMap[cat] = (expenseCategoryMap[cat] || 0) + (Number(e.amount) || 0)
    }
    const topExpenseCategories = Object.entries(expenseCategoryMap)
      .map(([category, amount]) => ({ category, amount: Math.round(amount) }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 6)
    const monthSales = completedOrders.reduce((s: number, o: any) => s + (o.total || 0), 0)
    const expenseToRevenueRatio = monthSales > 0 ? Math.round((totalExpenses30d / monthSales) * 100) : null

    // ── POS DISCOUNTS ANALYSIS (added today) ──
    let discountIntelligence = {
      activeProductRules: 0,
      activeCategoryRules: 0,
      totalActiveRules: 0,
      savingsToday: 0,
      savings30d: 0,
      discountedOrders30d: 0,
    }
    try {
      const discountCtx = await loadPosDiscountContext(db, now)
      let activeProductRules = 0
      let activeCategoryRules = 0
      for (const rule of discountCtx.productDiscounts.values()) {
        if (isDiscountEffectivelyActive(rule, now)) activeProductRules++
      }
      for (const rule of discountCtx.categoryDiscounts.values()) {
        if (isDiscountEffectivelyActive(rule, now)) activeCategoryRules++
      }
      const tomorrowStart = new Date(todayStart); tomorrowStart.setDate(tomorrowStart.getDate() + 1)
      const discountedOrders30d = completedOrders.filter((o: any) =>
        (o.items || []).some((it: any) => Number(it.posDiscountAmount ?? 0) > 0)
      ).length
      discountIntelligence = {
        activeProductRules,
        activeCategoryRules,
        totalActiveRules: activeProductRules + activeCategoryRules,
        savingsToday: sumPosDiscountSavingsFromOrders(completedOrders as any, todayStart, tomorrowStart),
        savings30d: sumPosDiscountSavingsFromOrders(completedOrders as any, thirtyDaysAgo, tomorrowStart),
        discountedOrders30d,
      }
    } catch (e) {
      console.error('[AI Intelligence API] Discount analysis failed:', e)
    }

    // ── PAYMENTS & SMS HEALTH (added today) ──
    let pendingMpesaVerifications = 0
    try {
      pendingMpesaVerifications = await countPendingManualMpesaVerifications(db)
    } catch (e) {
      console.error('[AI Intelligence API] Manual M-Pesa count failed:', e)
    }

    let smsHealth: {
      failed: number; permanentlyFailed: number; pending: number
      delivered: number; sent: number; successRate: number; unresolvedCriticalAlerts: number
    } = { failed: 0, permanentlyFailed: 0, pending: 0, delivered: 0, sent: 0, successRate: 100, unresolvedCriticalAlerts: 0 }
    try {
      const m = await getShiftSmsQueueMetrics()
      smsHealth = {
        failed: m.failed,
        permanentlyFailed: m.permanentlyFailed,
        pending: m.pending,
        delivered: m.delivered,
        sent: m.sent,
        successRate: m.successRate,
        unresolvedCriticalAlerts: m.unresolvedCriticalAlerts,
      }
    } catch (e) {
      console.error('[AI Intelligence API] SMS metrics failed:', e)
    }

    // ── BUILD ALERTS ──
    const alerts: any[] = []

    if (missingCost.length > 0) alerts.push({ id: 'missing-cost', severity: 'high', category: 'data', title: `${missingCost.length} products missing buying price`, explanation: 'Profit calculations are incomplete without cost data.', action: 'Review product buying prices in Inventory.', actionLink: '/catha/inventory?filter=missing-cost', count: missingCost.length })
    if (missingPrice.length > 0) alerts.push({ id: 'missing-price', severity: 'critical', category: 'data', title: `${missingPrice.length} products missing selling price`, explanation: 'Products without selling prices cannot generate revenue properly.', action: 'Set selling prices in Inventory.', actionLink: '/catha/inventory?filter=missing-price', count: missingPrice.length })
    if (missingCategory.length > 0) alerts.push({ id: 'missing-category', severity: 'low', category: 'data', title: `${missingCategory.length} products without proper category`, explanation: 'Category data helps with reporting and menu organization.', action: 'Update product categories.', actionLink: '/catha/inventory?filter=missing-category', count: missingCategory.length })
    if (missingBarcode.length > 0) alerts.push({ id: 'missing-barcode', severity: 'low', category: 'data', title: `${missingBarcode.length} products without barcode`, explanation: 'Barcodes speed up POS scanning and reduce errors.', action: 'Add barcodes to products.', actionLink: '/catha/inventory?filter=missing-barcode', count: missingBarcode.length })
    if (missingImage.length > 0) alerts.push({ id: 'missing-image', severity: 'low', category: 'data', title: `${missingImage.length} products without image`, explanation: 'Product images improve storefront and menu display.', action: 'Upload product images.', actionLink: '/catha/inventory?filter=missing-image', count: missingImage.length })

    if (restockNow.length > 0) alerts.push({ id: 'restock-urgent', severity: 'critical', category: 'stock', title: `${restockNow.length} high-demand items need restocking`, explanation: 'These products are low on stock but still selling. Risk of stockout.', action: 'Review and restock urgently.', actionLink: '/catha/inventory?filter=restock-urgent', count: restockNow.length })
    if (outOfStock.length > 0) alerts.push({ id: 'out-of-stock', severity: 'high', category: 'stock', title: `${outOfStock.length} products out of stock`, explanation: 'Out-of-stock items mean lost sales opportunities.', action: 'Check stock levels.', actionLink: '/catha/inventory?filter=out-of-stock', count: outOfStock.length })
    if (deadStock.length > 0) alerts.push({ id: 'dead-stock', severity: 'medium', category: 'stock', title: `${deadStock.length} products with no sales in 30 days`, explanation: 'Dead stock ties up capital. Consider promotions or reducing orders.', action: 'Review slow inventory.', actionLink: '/catha/inventory?filter=dead-stock', count: deadStock.length })
    if (overstock.length > 0) alerts.push({ id: 'overstock', severity: 'medium', category: 'stock', title: `${overstock.length} products potentially overstocked`, explanation: 'High stock levels with low movement suggest overordering.', action: 'Adjust reorder quantities.', actionLink: '/catha/inventory?filter=overstock', count: overstock.length })

    if (cancelRate > 5) alerts.push({ id: 'high-cancel-rate', severity: cancelRate > 15 ? 'critical' : 'high', category: 'operations', title: `${cancelRate}% order cancellation rate`, explanation: 'High cancellation rates may indicate operational issues or staff behavior concerns.', action: 'Review cancelled orders.', actionLink: '/catha/orders?filter=cancelled', count: cancelledOrders.length })
    if (manualAdjustments.length > 10) alerts.push({ id: 'manual-adjustments', severity: 'medium', category: 'operations', title: `${manualAdjustments.length} manual stock adjustments this month`, explanation: 'Frequent manual adjustments may indicate inventory process gaps.', action: 'Review stock movements.', actionLink: '/catha/stock-movement', count: manualAdjustments.length })

    if (pendingMpesaVerifications > 0) alerts.push({ id: 'pending-mpesa-verifications', severity: 'high', category: 'operations', title: `${pendingMpesaVerifications} M-Pesa payment${pendingMpesaVerifications === 1 ? '' : 's'} awaiting manual verification`, explanation: 'Unverified manual M-Pesa payments delay order completion and reconciliation.', action: 'Review and approve pending verifications.', actionLink: '/catha/mpesa-transactions', count: pendingMpesaVerifications })
    if (smsHealth.permanentlyFailed > 0) alerts.push({ id: 'sms-permanent-failures', severity: 'critical', category: 'operations', title: `${smsHealth.permanentlyFailed} SMS message${smsHealth.permanentlyFailed === 1 ? '' : 's'} permanently failed`, explanation: 'Staff or customers did not receive important SMS notifications after all retries.', action: 'Check SMS logs and phone numbers in Settings.', actionLink: '/catha/settings', count: smsHealth.permanentlyFailed })
    else if (smsHealth.failed > 0) alerts.push({ id: 'sms-failures', severity: 'medium', category: 'operations', title: `${smsHealth.failed} SMS message${smsHealth.failed === 1 ? '' : 's'} failing and retrying`, explanation: 'Some SMS notifications are failing. They will retry automatically.', action: 'Monitor SMS delivery in Settings.', actionLink: '/catha/settings', count: smsHealth.failed })
    if (expenseToRevenueRatio !== null && expenseToRevenueRatio > 50) alerts.push({ id: 'high-expense-ratio', severity: expenseToRevenueRatio > 80 ? 'high' : 'medium', category: 'operations', title: `Expenses are ${expenseToRevenueRatio}% of 30-day revenue`, explanation: 'Operating expenses are consuming a large share of revenue.', action: 'Review expenses by category.', actionLink: '/catha/expenses', count: Math.round(totalExpenses30d) })

    if (supplierLowStock.length > 0) alerts.push({ id: 'supplier-low-stock', severity: 'high', category: 'supplier', title: `${supplierLowStock.length} supplier-linked items at low stock`, explanation: 'Items linked to suppliers need reordering.', action: 'Contact suppliers for restocking.', actionLink: '/catha/inventory?filter=supplier-low-stock', count: supplierLowStock.length })
    if (missingSupplier.length > 0) alerts.push({ id: 'missing-supplier', severity: 'low', category: 'data', title: `${missingSupplier.length} products without supplier linkage`, explanation: 'Linking products to suppliers helps with restocking workflows.', action: 'Assign suppliers to products.', actionLink: '/catha/inventory?filter=missing-supplier', count: missingSupplier.length })

    // ── BUILD PRIORITY ACTIONS ──
    const priorityActions: any[] = []
    if (missingCost.length > 0) priorityActions.push({ severity: 'high', title: `Add buying prices for ${missingCost.length} products`, reason: 'Enables profit tracking and margin analysis.', actionLabel: 'Review Products', actionLink: '/catha/inventory?filter=missing-cost' })
    if (restockNow.length > 0) priorityActions.push({ severity: 'critical', title: `Restock ${restockNow.length} high-demand items`, reason: 'These items are selling but running low.', actionLabel: 'Open Inventory', actionLink: '/catha/inventory?filter=restock-urgent' })
    if (cancelledOrders.length > 3) priorityActions.push({ severity: 'high', title: `Review ${cancelledOrders.length} cancelled orders`, reason: 'Unusual cancellation patterns may need investigation.', actionLabel: 'View Orders', actionLink: '/catha/orders?filter=cancelled' })
    if (deadStock.length > 3) priorityActions.push({ severity: 'medium', title: `Reduce stock for ${deadStock.length} slow-moving products`, reason: 'Dead stock ties up capital with no return.', actionLabel: 'Open Inventory', actionLink: '/catha/inventory?filter=dead-stock' })
    if (inactiveClients.length > 0) priorityActions.push({ severity: 'medium', title: `Re-engage ${inactiveClients.length} inactive customers`, reason: 'These repeat customers have not ordered recently.', actionLabel: 'Open Clients', actionLink: '/catha/clients?segment=inactive-repeat' })
    if (missingPrice.length > 0) priorityActions.push({ severity: 'critical', title: `Set selling prices for ${missingPrice.length} products`, reason: 'Products without prices cannot generate proper revenue.', actionLabel: 'Review Products', actionLink: '/catha/inventory?filter=missing-price' })
    if (pendingMpesaVerifications > 0) priorityActions.push({ severity: 'high', title: `Approve ${pendingMpesaVerifications} pending M-Pesa verification${pendingMpesaVerifications === 1 ? '' : 's'}`, reason: 'Manual M-Pesa payments are waiting for admin approval.', actionLabel: 'Open M-Pesa', actionLink: '/catha/mpesa-transactions' })
    if (smsHealth.permanentlyFailed > 0) priorityActions.push({ severity: 'high', title: `Fix ${smsHealth.permanentlyFailed} permanently failed SMS`, reason: 'Notifications never reached staff or customers. Check phone numbers.', actionLabel: 'Open Settings', actionLink: '/catha/settings' })

    // ── BUILD RECOMMENDATIONS ──
    const recommendations: any[] = []

    if (fastMovers.length > 0) recommendations.push({ type: 'increase', title: `Increase stock for top ${Math.min(fastMovers.length, 5)} fast-moving products`, explanation: `${fastMovers[0]?.name} sold ${fastMovers[0]?.monthlySales} units this month.`, impact: 'revenue', actionLink: '/catha/inventory?filter=fast-movers' })
    if (peakHours.length > 0) recommendations.push({ type: 'increase', title: `Prepare stock before peak hour (${peakHours[0]?.hour})`, explanation: `Peak traffic at ${peakHours[0]?.hour} with ${peakHours[0]?.orders} orders.`, impact: 'operations', actionLink: '/catha/inventory?filter=restock-urgent' })

    if (deadStock.length > 0) recommendations.push({ type: 'reduce', title: `Reduce orders for ${deadStock.length} non-selling products`, explanation: 'These items have no sales in 30 days but still occupy stock.', impact: 'cost', actionLink: '/catha/inventory?filter=dead-stock' })
    if (overstock.length > 0) recommendations.push({ type: 'reduce', title: `Lower reorder quantity for ${overstock.length} overstocked items`, explanation: 'Current stock levels exceed demand by a large margin.', impact: 'cost', actionLink: '/catha/inventory?filter=overstock' })

    if (highMarginProducts.length > 0) recommendations.push({ type: 'promote', title: `Promote ${highMarginProducts[0]?.name} (${highMarginProducts[0]?.margin}% margin)`, explanation: 'High-margin products generate more profit per sale.', impact: 'profit', actionLink: '/catha/inventory?filter=high-margin' })
    if (lowMarginHighSales.length > 0) recommendations.push({ type: 'fix', title: `Review pricing for ${lowMarginHighSales.length} low-margin high-sellers`, explanation: 'These products sell well but may be underpriced.', impact: 'profit', actionLink: '/catha/inventory?filter=low-margin-high-sales' })

    if (missingCost.length > 0) recommendations.push({ type: 'fix', title: `Add buying prices to ${missingCost.length} products`, explanation: `Profit visibility is limited: ${missingCost.length} of ${products.length} products lack cost data.`, impact: 'data', actionLink: '/catha/inventory?filter=missing-cost' })
    if (cancelRate > 5) recommendations.push({ type: 'monitor', title: 'Monitor order cancellation patterns', explanation: `Current ${cancelRate}% rate is above healthy threshold.`, impact: 'operations', actionLink: '/catha/orders?filter=cancelled' })
    if (inactiveClients.length > 0) recommendations.push({ type: 'monitor', title: `Watch ${inactiveClients.length} repeat customers becoming inactive`, explanation: 'Customers who previously ordered multiple times have stopped.', impact: 'retention', actionLink: '/catha/clients?segment=inactive-repeat' })
    if (discountIntelligence.totalActiveRules > 0) recommendations.push({ type: 'monitor', title: `Track ${discountIntelligence.totalActiveRules} active POS discount rule${discountIntelligence.totalActiveRules === 1 ? '' : 's'}`, explanation: `KES ${Math.round(discountIntelligence.savings30d).toLocaleString()} given as discounts in 30 days across ${discountIntelligence.discountedOrders30d} orders. Confirm they are driving volume.`, impact: 'profit', actionLink: '/catha/inventory' })

    // ── OVERALL HEALTH SCORE ──
    const overallHealth = Math.round(
      (salesHealthScore * 0.25) + (inventoryHealthScore * 0.25) +
      (dataQualityScore * 0.2) + (operationsHealthScore * 0.15) +
      (clientRetentionScore * 0.15)
    )

    const TARGET_SCORE = 70
    const clampScore = (n: number) => Math.max(0, Math.min(100, n))
    const salesScore = clampScore(salesHealthScore)
    const inventoryScore = clampScore(inventoryHealthScore)
    const dataQualityClamped = clampScore(dataQualityScore)
    const operationsScore = clampScore(operationsHealthScore)
    const retentionScore = clampScore(clientRetentionScore)
    const overallClamped = clampScore(overallHealth)
    const repeatRatePct = clients.length > 0 ? Math.round((repeatCustomers.length / clients.length) * 100) : 0

    const healthBreakdown = {
      overall: {
        score: overallClamped,
        target: TARGET_SCORE,
        status: overallClamped >= TARGET_SCORE ? 'on_track' : 'needs_work',
        reason:
          overallClamped >= TARGET_SCORE
            ? `Weighted blend of sales, inventory, data quality, operations, and retention is ${overallClamped}/100.`
            : `Overall is ${overallClamped}/100 (target ${TARGET_SCORE}+). Weakest areas pull the combined score down.`,
        solution:
          overallClamped >= TARGET_SCORE
            ? 'Keep the lowest-scoring pillars from slipping; refresh this page after big stock or pricing changes.'
            : 'Raise any pillar below 70 first—fix inventory pressure, sales consistency, cancel rates, and inactive repeat customers.',
        actionLink: '#priority-actions',
        actionLabel: 'See priorities',
      },
      sales: {
        score: salesScore,
        target: TARGET_SCORE,
        status: salesScore >= TARGET_SCORE ? 'on_track' : 'needs_work',
        reason:
          completedOrders.length === 0
            ? 'Almost no completed orders in the analysis window, so sales health stays low.'
            : `Today KES ${Math.round(todaySales).toLocaleString()} vs yesterday KES ${Math.round(yesterdaySales).toLocaleString()}; ${weekOrders.length} orders this week.`,
        solution:
          salesScore >= TARGET_SCORE
            ? 'Hold daily volume; staff peak hours and keep top sellers in stock.'
            : todaySales === 0
              ? 'Drive same-day sales: open POS early, promote bestsellers, and confirm tables/QR ordering is live.'
              : yesterdaySales > 0 && todaySales < yesterdaySales
                ? 'Today is behind yesterday—push upsells on peak items and check staff coverage for busy hours.'
                : weekOrders.length <= 20
                  ? 'Weekly order count is light—grow traffic via menu QR, promotions on high-margin items, and consistent opening hours.'
                  : 'Stabilize day-over-day revenue and aim for 50+ completed orders per week.',
        actionLink: '/catha/orders',
        actionLabel: 'Open orders',
      },
      inventory: {
        score: inventoryScore,
        target: TARGET_SCORE,
        status: inventoryScore >= TARGET_SCORE ? 'on_track' : 'needs_work',
        reason: `${outOfStock.length} out of stock, ${lowStock.length} below min, ${deadStock.length} with stock but no 30-day sales (${products.length} products).`,
        solution:
          inventoryScore >= TARGET_SCORE
            ? 'Keep restocking before peak and clear dead stock so capital is not tied up.'
            : outOfStock.length + lowStock.length > 0
              ? `Restock ${restockNow.length || lowStock.length} urgent items first, then reduce dead/overstock so score climbs above ${TARGET_SCORE}.`
              : `Clear or promote ${deadStock.length} non-sellers and tighten reorder quantities on overstock.`,
        actionLink: '/catha/inventory?filter=restock-urgent',
        actionLabel: 'Restock urgent',
      },
      operations: {
        score: operationsScore,
        target: TARGET_SCORE,
        status: operationsScore >= TARGET_SCORE ? 'on_track' : 'needs_work',
        reason: `${cancelRate}% cancel rate, ${editRate}% edits, ${manualAdjustments.length} manual stock adjustments this month.`,
        solution:
          operationsScore >= TARGET_SCORE
            ? 'Keep cancels under 5% and use stock movements instead of frequent manual corrections.'
            : cancelRate > 5
              ? 'Review cancelled/voided orders with staff, fix order-entry mistakes, and cut cancel rate below 5%.'
              : manualAdjustments.length > 20
                ? 'Reduce manual stock corrections—receive stock properly and train staff on inventory process.'
                : 'Cut unnecessary order edits and verify pending M-Pesa/SMS issues so operations stay clean.',
        actionLink: '/catha/orders?filter=cancelled',
        actionLabel: 'Review cancels',
      },
      dataQuality: {
        score: dataQualityClamped,
        target: TARGET_SCORE,
        status: dataQualityClamped >= TARGET_SCORE ? 'on_track' : 'needs_work',
        reason: `${missingCost.length} missing cost, ${missingPrice.length} missing price, ${missingCategory.length} weak category, ${missingBarcode.length} missing barcode.`,
        solution:
          dataQualityClamped >= TARGET_SCORE
            ? 'Fill remaining gaps (cost/barcode) so profit and stock reports stay accurate.'
            : missingCost.length > 0
              ? `Add buying prices to ${missingCost.length} products first—profit scoring depends on cost data.`
              : missingPrice.length > 0
                ? `Set selling prices on ${missingPrice.length} products so POS and menu stay complete.`
                : 'Assign real categories and barcodes so inventory filters and scanning stay reliable.',
        actionLink: '/catha/inventory?filter=missing-cost',
        actionLabel: 'Fix product data',
      },
      clientRetention: {
        score: retentionScore,
        target: TARGET_SCORE,
        status: retentionScore >= TARGET_SCORE ? 'on_track' : 'needs_work',
        reason:
          clients.length === 0
            ? 'Few customer phones on orders, so retention cannot be measured well.'
            : `${repeatRatePct}% repeat rate (${repeatCustomers.length}/${clients.length}); ${inactiveClients.length} previously repeat customers inactive 30+ days.`,
        solution:
          retentionScore >= TARGET_SCORE
            ? 'Protect loyalty: follow up inactive repeats and keep phone capture on every order.'
            : clients.length === 0
              ? 'Capture customer phone on more orders so retention tracking becomes meaningful.'
              : inactiveClients.length > 0
                ? `Re-engage ${inactiveClients.length} inactive repeats (SMS/offer) and raise repeat visit rate.`
                : 'Grow first-time to second visit with table QR, loyalty offers, and consistent service.',
        actionLink: '/catha/clients?segment=inactive-repeat',
        actionLabel: 'View customers',
      },
    }

    const risksCount = alerts.filter(a => a.severity === 'critical' || a.severity === 'high').length
    const profitOpportunities = recommendations.filter(r => r.impact === 'profit' || r.impact === 'revenue').length
    const dataIssues = missingCost.length + missingPrice.length + missingCategory.length + missingBarcode.length
    const stockPressure = restockNow.length > 5 ? 'high' : restockNow.length > 2 ? 'medium' : 'low'

    // ── Category demand by time (for peak hours section) ──
    const categoryByHour: Record<string, Record<number, number>> = {}
    const productCategoryMap: Record<string, string> = {}
    for (const p of products) {
      productCategoryMap[p._id.toString()] = p.category || 'other'
    }
    for (const o of completedOrders) {
      const t = o.timestamp instanceof Date ? o.timestamp : new Date(o.timestamp)
      const hour = t.getHours()
      for (const item of o.items || []) {
        const pid = String(item.productId || item._id || '')
        const cat = productCategoryMap[pid] || 'other'
        if (!categoryByHour[cat]) categoryByHour[cat] = {}
        categoryByHour[cat][hour] = (categoryByHour[cat][hour] || 0) + (Number(item.quantity) || 0)
      }
    }

    return NextResponse.json({
      success: true,
      lastUpdated: now.toISOString(),
      healthScore: {
        overall: overallClamped,
        sales: salesScore,
        inventory: inventoryScore,
        dataQuality: dataQualityClamped,
        operations: operationsScore,
        clientRetention: retentionScore,
      },
      healthBreakdown,
      overview: {
        totalProducts: products.length,
        risksCount,
        profitOpportunities,
        dataIssues,
        stockPressure,
        repeatCustomerCount: repeatCustomers.length,
        totalClients: clients.length,
        todaySales: Math.round(todaySales),
        weekSales: Math.round(weekSales),
        todayOrders: todayOrders.length,
      },
      priorityActions: priorityActions.slice(0, 8),
      alerts: alerts.sort((a, b) => {
        const sev = { critical: 0, high: 1, medium: 2, low: 3 } as any
        return (sev[a.severity] ?? 4) - (sev[b.severity] ?? 4)
      }),
      recommendations,
      profitIntelligence: {
        topRevenue: topRevenue.slice(0, 8),
        highMargin: highMarginProducts.slice(0, 8),
        lowMarginHighSales: lowMarginHighSales.slice(0, 8),
        missingCostCount: missingCost.length,
        missingPriceCount: missingPrice.length,
        totalWithCostData: products.filter((p: any) => p.cost && p.cost > 0).length,
        profitWarning: missingCost.length > 0 ? `Profit visibility is incomplete: ${missingCost.length} of ${products.length} products have no buying price.` : null,
      },
      inventoryIntelligence: {
        restockNow: restockNow.slice(0, 10),
        overstock: overstock.slice(0, 10),
        deadStock: deadStock.slice(0, 10),
        fastMovers: fastMovers.slice(0, 10),
        slowMovers: slowMovers.slice(0, 10),
        outOfStockCount: outOfStock.length,
        lowStockCount: lowStock.length,
        totalProducts: products.length,
      },
      clientIntelligence: {
        totalClients: clients.length,
        repeatCustomers: repeatCustomers.length,
        highValueClients: highValueClients.slice(0, 10).map(c => ({ phone: c.phone, name: c.name, visits: c.visits, spend: Math.round(c.spend) })),
        inactiveClients: inactiveClients.slice(0, 10).map(c => ({ phone: c.phone, name: c.name, visits: c.visits, spend: Math.round(c.spend), lastOrder: c.lastOrder?.toISOString() })),
        avgSpendPerClient,
        repeatRate: clients.length > 0 ? Math.round((repeatCustomers.length / clients.length) * 100) : 0,
      },
      operationsIntelligence: {
        cancelRate,
        editRate,
        cancelledCount: cancelledOrders.length,
        editedCount: editedOrders.length,
        totalOrders: allRecentOrders.length,
        manualAdjustments: manualAdjustments.length,
        paymentMethods: Object.entries(paymentMethods).map(([method, count]) => ({ method, count })).sort((a, b) => b.count - a.count),
      },
      peakHoursIntelligence: {
        hourlyDistribution: hourlyDistribution.map(h => ({ hour: `${String(h.hour).padStart(2, '0')}:00`, orders: h.orders, revenue: Math.round(h.revenue) })),
        dailyDistribution: dailyDistribution.map((d, i) => ({ day: dayNames[i], orders: d.orders, revenue: Math.round(d.revenue) })),
        peakHours,
        peakDays,
        categoryByHour,
      },
      supplierIntelligence: {
        totalSuppliers: suppliers.length,
        supplierLowStock: supplierLowStock.map((p: any) => ({ id: p._id.toString(), name: p.name, stock: p.stock ?? 0, supplier: p.supplier })),
        productsNeedingSupplier: productsNeedingSupplier.length,
        missingCostWithSupplier: supplierProducts.filter((p: any) => !p.cost || p.cost <= 0).length,
      },
      orderSourceIntelligence: {
        sources: Object.entries(orderSourceMap).map(([source, data]) => ({
          source, count: data.count, revenue: Math.round(data.revenue),
        })).sort((a, b) => b.revenue - a.revenue),
      },
      expenseIntelligence: {
        total30d: Math.round(totalExpenses30d),
        expenseCount30d: expenses.length,
        topCategories: topExpenseCategories,
        expenseToRevenueRatio,
        revenue30d: Math.round(monthSales),
      },
      discountIntelligence: {
        ...discountIntelligence,
        savingsToday: Math.round(discountIntelligence.savingsToday),
        savings30d: Math.round(discountIntelligence.savings30d),
      },
      paymentsSmsIntelligence: {
        pendingMpesaVerifications,
        sms: smsHealth,
      },
    })
  } catch (error: any) {
    console.error('[AI Intelligence API] Error:', error)
    return NextResponse.json({ error: 'Failed to load intelligence data', message: error.message }, { status: 500 })
  }
}
