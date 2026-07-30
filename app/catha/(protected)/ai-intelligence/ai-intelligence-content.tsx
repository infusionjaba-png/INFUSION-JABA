'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Loader2, Brain, ShieldAlert, Sparkles, Target, Gauge, TrendingUp, AlertCircle, ClipboardCheck, Users, Plus, CheckCircle2, Activity } from 'lucide-react'
import { AIHero } from './_components/ai-hero'
import { AIPriorityActions, AIAlerts, AIRecommendations } from './_components/ai-alerts-recs'
import {
  ProfitIntelligence, InventoryIntelligence, ClientIntelligence,
  OperationsIntelligence, PeakHoursIntelligence, SupplierIntelligence,
  OrderSourceIntelligence, ExpenseIntelligence, TodayOpsIntelligence,
} from './_components/ai-intelligence-sections'
import { AskAIPanel, AIQuickActions } from './_components/ai-ask-panel'
import { CommerceIntelligenceSection } from './_components/commerce-intelligence-section'

interface IntelligenceData {
  success: boolean
  lastUpdated: string
  healthScore: { overall: number; sales: number; inventory: number; dataQuality: number; operations: number; clientRetention: number }
  healthBreakdown?: import('./_components/ai-hero').HealthBreakdown
  overview: any
  priorityActions: any[]
  alerts: any[]
  recommendations: any[]
  profitIntelligence: any
  inventoryIntelligence: any
  clientIntelligence: any
  operationsIntelligence: any
  peakHoursIntelligence: any
  supplierIntelligence: any
  orderSourceIntelligence: any
  expenseIntelligence?: any
  discountIntelligence?: any
  paymentsSmsIntelligence?: any
}

const SECTION_NAV = [
  { id: 'priority-actions', label: 'Priorities' },
  { id: 'ai-alerts', label: 'Alerts' },
  { id: 'ai-recommendations', label: 'Recommendations' },
  { id: 'inventory-intelligence', label: 'Inventory' },
  { id: 'profit-intelligence', label: 'Profit' },
  { id: 'today-ops', label: 'Discounts & Payments' },
  { id: 'expense-intelligence', label: 'Expenses' },
  { id: 'client-intelligence', label: 'Customers' },
  { id: 'operations-intelligence', label: 'Operations' },
  { id: 'peak-hours', label: 'Peak Hours' },
  { id: 'supplier-intelligence', label: 'Suppliers' },
  { id: 'ai-action-lab', label: 'Action Lab' },
  { id: 'catha-commerce-intelligence', label: 'Website' },
  { id: 'ask-ai', label: 'Ask AI' },
]

function SectionNav() {
  return (
    <nav className="sticky top-2 z-20 -mx-1 px-1">
      <div className="rounded-2xl border border-border/60 bg-card/95 backdrop-blur shadow-sm px-3 py-2 flex gap-1.5 overflow-x-auto">
        {SECTION_NAV.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            className="whitespace-nowrap rounded-full px-3 py-1.5 text-[12.5px] font-medium text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
          >
            {s.label}
          </a>
        ))}
      </div>
    </nav>
  )
}

export default function AIIntelligenceContent() {
  const [data, setData] = useState<IntelligenceData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await fetch('/api/catha/ai-intelligence')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to load intelligence data')
      setData(json)
    } catch (err: any) {
      setError(err.message || 'Failed to load intelligence data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  if (loading && !data) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <div className="relative">
          <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center animate-pulse">
            <Brain className="h-8 w-8 text-primary" />
          </div>
        </div>
        <div className="text-center">
          <p className="text-sm font-medium text-foreground">Analyzing business data...</p>
          <p className="text-xs text-muted-foreground mt-1">This may take a moment</p>
        </div>
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error && !data) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <div className="h-16 w-16 rounded-2xl bg-destructive/10 flex items-center justify-center">
          <ShieldAlert className="h-8 w-8 text-destructive" />
        </div>
        <div className="text-center">
          <p className="text-sm font-medium text-foreground">Failed to load intelligence data</p>
          <p className="text-xs text-muted-foreground mt-1">{error}</p>
        </div>
        <button onClick={fetchData} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
          Retry
        </button>
      </div>
    )
  }

  if (!data) return null

  return (
    <div className="p-4 md:p-6 space-y-6 overflow-x-hidden max-w-[1600px] mx-auto pb-12">
      {error && (
        <div className="rounded-lg bg-destructive/10 text-destructive px-4 py-2 text-sm">{error}</div>
      )}

      {/* 1. Hero: health score + key numbers */}
      <AIHero
        healthScore={data.healthScore}
        healthBreakdown={data.healthBreakdown}
        overview={data.overview}
        lastUpdated={data.lastUpdated}
        onRefresh={fetchData}
        loading={loading}
      />

      {/* Jump navigation */}
      <SectionNav />

      {/* 2. What to do right now */}
      <AIPriorityActions actions={data.priorityActions} />

      {/* 3. Detected risks */}
      <AIAlerts alerts={data.alerts} />

      {/* 4. Growth & savings opportunities */}
      <AIRecommendations recommendations={data.recommendations} />

      {/* 5. Core money & stock: Inventory + Profit */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <InventoryIntelligence data={data.inventoryIntelligence} />
        <ProfitIntelligence data={data.profitIntelligence} />
      </div>

      {/* 6. Discounts, M-Pesa verifications, SMS health (new features) */}
      <TodayOpsIntelligence discounts={data.discountIntelligence} paymentsSms={data.paymentsSmsIntelligence} />

      {/* 7. Expenses + Customers */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <ExpenseIntelligence data={data.expenseIntelligence} />
        <ClientIntelligence data={data.clientIntelligence} />
      </div>

      {/* 8. Operations quality */}
      <OperationsIntelligence data={data.operationsIntelligence} />

      {/* 9. Peak hours (full width for charts) */}
      <PeakHoursIntelligence data={data.peakHoursIntelligence} />

      {/* 10. Supply chain + channels */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <SupplierIntelligence data={data.supplierIntelligence} />
        <OrderSourceIntelligence data={data.orderSourceIntelligence} />
      </div>

      {/* 11. Planning tools */}
      <AIActionLab data={data} />

      {/* 12. Website & storefront analytics */}
      <CommerceIntelligenceSection />

      {/* 13. Ask AI */}
      <AskAIPanel intelligenceData={data} />

      {/* 14. Quick links */}
      <AIQuickActions />

      {/* Footer Advisory */}
      <div className="text-center py-4 border-t border-border/40">
        <p className="text-[12px] text-muted-foreground">
          AI Intelligence is advisory only. Insights are based on current operational data and do not make automatic changes to your system.
        </p>
      </div>
    </div>
  )
}

function AIActionLab({ data }: { data: IntelligenceData }) {
  const [conversionLift, setConversionLift] = useState(8)
  const [wasteReduction, setWasteReduction] = useState(12)
  const [shiftBriefing, setShiftBriefing] = useState<string[]>([])
  const [shiftLoading, setShiftLoading] = useState(true)
  const [applyMessage, setApplyMessage] = useState<string | null>(null)
  const [goalTitle, setGoalTitle] = useState('')
  const [goalTarget, setGoalTarget] = useState('')
  const [goals, setGoals] = useState<Array<{ id: string; title: string; target: number; achieved: number; completed: boolean; createdAt: string; updatedAt: string }>>([])

  const opportunities = useMemo(() => {
    const topRestock = data.inventoryIntelligence?.restockNow?.slice(0, 3) || []
    const inactiveClients = data.clientIntelligence?.inactiveClients?.length || 0
    const lowMargin = data.profitIntelligence?.lowMarginHighSales?.length || 0
    const missingCost = data.profitIntelligence?.missingCostCount || 0
    const deadStock = data.inventoryIntelligence?.deadStock?.length || 0

    return [
      {
        title: 'Recover Lost Sales from Low Stock',
        impact: `High`,
        detail: topRestock.length
          ? `Priority products: ${topRestock.map((p: any) => p.name).join(', ')}.`
          : 'No urgent restock risks currently detected.',
      },
      {
        title: 'Win Back Inactive Repeat Customers',
        impact: inactiveClients > 0 ? 'Medium' : 'Low',
        detail: inactiveClients > 0
          ? `${inactiveClients} repeat customers are at risk of churn. Trigger a comeback offer this week.`
          : 'Repeat customer base is currently stable.',
      },
      {
        title: 'Improve Profit Visibility',
        impact: missingCost > 0 ? 'High' : 'Low',
        detail: missingCost > 0
          ? `${missingCost} products are missing buying price. Fill cost data to unlock real margin insights.`
          : 'Cost coverage looks complete for margin tracking.',
      },
      {
        title: 'Reduce Hidden Margin Leakage',
        impact: lowMargin > 0 ? 'High' : 'Low',
        detail: lowMargin > 0
          ? `${lowMargin} high-selling products have low margins. Review pricing and supplier terms.`
          : 'No obvious low-margin high-sellers right now.',
      },
      {
        title: 'Turn Dead Stock into Cash',
        impact: deadStock > 0 ? 'Medium' : 'Low',
        detail: deadStock > 0
          ? `${deadStock} products had no sales in 30 days. Bundle or discount to free up capital.`
          : 'Dead stock risk is currently minimal.',
      },
    ]
  }, [data])

  const mission = useMemo(() => {
    const topAction = data.priorityActions?.[0]
    if (topAction) return topAction.title
    if ((data.alerts?.length || 0) > 0) return 'Resolve top critical alert before next shift.'
    return 'No urgent mission. Focus on upsell campaigns and repeat-customer retention.'
  }, [data])

  const simulator = useMemo(() => {
    const weeklySales = Number(data.overview?.weekSales || 0)
    const monthlyBaseline = weeklySales * 4
    const monthlyUpside = Math.round(monthlyBaseline * (conversionLift / 100))
    const wasteBase = Math.round(monthlyBaseline * 0.08)
    const wasteSaved = Math.round(wasteBase * (wasteReduction / 100))
    return { monthlyBaseline, monthlyUpside, wasteSaved, projectedMonthlyGain: monthlyUpside + wasteSaved }
  }, [conversionLift, wasteReduction, data.overview?.weekSales])

  const suggestedGoals = useMemo(() => {
    const restockNow = data.inventoryIntelligence?.restockNow?.length || 0
    const inactive = data.clientIntelligence?.inactiveClients?.length || 0
    const topGain = Math.max(2000, Math.round(simulator.projectedMonthlyGain * 0.4))
    return [
      { title: 'Close urgent restock risks', target: restockNow > 0 ? restockNow : 3 },
      { title: 'Recover inactive repeat customers', target: inactive > 0 ? inactive : 5 },
      { title: 'Capture projected monthly gain (KES)', target: topGain },
    ]
  }, [data, simulator.projectedMonthlyGain])

  const weeklySummary = useMemo(() => {
    const totalGoals = goals.length
    if (totalGoals === 0) {
      return {
        totalGoals: 0,
        completedGoals: 0,
        onTrackGoals: 0,
        atRiskGoals: 0,
        completionRate: 0,
        healthScore: 0,
        healthColor: 'red' as const,
      }
    }

    let completedGoals = 0
    let onTrackGoals = 0
    let atRiskGoals = 0
    let weighted = 0

    for (const goal of goals) {
      const pct = goal.target > 0 ? Math.min(100, Math.round((goal.achieved / goal.target) * 100)) : 0
      weighted += pct
      if (goal.completed || pct >= 100) {
        completedGoals += 1
      } else if (pct >= 50) {
        onTrackGoals += 1
      } else {
        atRiskGoals += 1
      }
    }

    const completionRate = Math.round((completedGoals / totalGoals) * 100)
    const avgProgress = Math.round(weighted / totalGoals)
    const healthScore = Math.round((completionRate * 0.6) + (avgProgress * 0.4))
    const healthColor = healthScore >= 75 ? 'green' : healthScore >= 45 ? 'yellow' : 'red'

    return {
      totalGoals,
      completedGoals,
      onTrackGoals,
      atRiskGoals,
      completionRate,
      healthScore,
      healthColor,
    }
  }, [goals])

  useEffect(() => {
    try {
      const stored = localStorage.getItem('catha-ai-goals-v1')
      if (stored) {
        const parsed = JSON.parse(stored)
        if (Array.isArray(parsed)) {
          const normalized = parsed.map((g: any) => ({
            id: String(g.id),
            title: String(g.title || 'Untitled goal'),
            target: Math.max(1, Number(g.target || 1)),
            achieved: Math.max(0, Number(g.achieved || 0)),
            completed: Boolean(g.completed),
            createdAt: g.createdAt ? String(g.createdAt) : new Date().toISOString(),
            updatedAt: g.updatedAt ? String(g.updatedAt) : new Date().toISOString(),
          }))
          setGoals(normalized)
        }
      }
    } catch {
      // ignore malformed local storage payload
    }
  }, [])

  useEffect(() => {
    localStorage.setItem('catha-ai-goals-v1', JSON.stringify(goals))
  }, [goals])

  useEffect(() => {
    let mounted = true
    async function loadShiftBriefing() {
      try {
        setShiftLoading(true)
        const res = await fetch('/api/catha/shifts/insights')
        const json = await res.json()
        if (!res.ok || !json?.ok) throw new Error(json?.error || 'Could not load shift data')

        const topCashier = json?.charts?.revenuePerCashier?.[0]
        const peakShiftHour = [...(json?.charts?.peakHoursWorked || [])].sort((a: any, b: any) => (b.count || 0) - (a.count || 0))[0]
        const lateLeaders = json?.charts?.chronicLateness?.slice(0, 2) || []
        const attendanceToday = json?.charts?.attendanceTrends?.[json?.charts?.attendanceTrends?.length - 1]

        const notes: string[] = []
        if (peakShiftHour?.count > 0) notes.push(`Most shift starts happen around ${peakShiftHour.hour}. Assign strongest cashier near this hour.`)
        if (topCashier) notes.push(`Top performer: ${topCashier.name} (KES ${Math.round(topCashier.revenue).toLocaleString()} in recent shifts).`)
        if (attendanceToday) notes.push(`Recent attendance on-time rate is ${attendanceToday.onTimeRate}%. Remind staff to clock in 10 minutes early.`)
        if (lateLeaders.length > 0) notes.push(`Watch punctuality for: ${lateLeaders.map((s: any) => s.name).join(', ')}.`)
        notes.push('Before peak periods, verify float cash, fast movers, and POS connectivity.')

        if (mounted) setShiftBriefing(notes)
      } catch {
        if (mounted) {
          setShiftBriefing([
            'Unable to fetch shift analytics now. Use peak sales hours and active alerts to brief cashiers.',
            'Prioritize fast movers, queue speed, and accurate order edits during peak traffic.',
          ])
        }
      } finally {
        if (mounted) setShiftLoading(false)
      }
    }

    loadShiftBriefing()
    return () => {
      mounted = false
    }
  }, [])

  function addGoal(title: string, target: number) {
    if (!title.trim() || !Number.isFinite(target) || target <= 0) return
    setGoals((prev) => [
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        title: title.trim(),
        target: Math.round(target),
        achieved: 0,
        completed: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      ...prev,
    ])
  }

  function updateGoalProgress(id: string, achieved: number) {
    setGoals((prev) =>
      prev.map((g) => {
        if (g.id !== id) return g
        const safe = Math.max(0, Math.round(achieved))
        return { ...g, achieved: safe, completed: safe >= g.target, updatedAt: new Date().toISOString() }
      })
    )
  }

  function toggleGoal(id: string) {
    setGoals((prev) => prev.map((g) => (g.id === id ? { ...g, completed: !g.completed, updatedAt: new Date().toISOString() } : g)))
  }

  async function copyPlan(label: string, lines: string[]) {
    const payload = `${label}\n\n${lines.map((line, i) => `${i + 1}. ${line}`).join('\n')}`
    try {
      await navigator.clipboard.writeText(payload)
      setApplyMessage(`${label} copied. Paste into team chat/briefing sheet.`)
    } catch {
      setApplyMessage(`${label} ready. Clipboard permission blocked; copy manually from the plan preview.`)
    }
  }

  return (
    <section id="ai-action-lab" className="space-y-4 rounded-2xl border border-border/60 bg-card shadow-sm p-4 md:p-6 scroll-mt-28">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 shrink-0">
          <Sparkles className="h-[18px] w-[18px] text-primary" />
        </div>
        <div>
          <h2 className="text-[15px] font-bold text-foreground tracking-tight leading-tight">AI Action Lab</h2>
          <p className="text-[12.5px] text-muted-foreground leading-snug mt-0.5">Plan the day: missions, simulations, briefings, and weekly goals.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="rounded-xl border border-border/40 bg-muted/10 p-4">
          <div className="flex items-center gap-2 mb-2">
            <Target className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">Mission of the Day</h3>
          </div>
          <p className="text-[14px] font-medium text-foreground leading-snug">{mission}</p>
          <p className="text-[12.5px] text-muted-foreground mt-2">
            Do this first to maximize today's business impact.
          </p>
        </div>

        <div className="xl:col-span-2 rounded-xl border border-border/40 bg-muted/10 p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertCircle className="h-4 w-4 text-amber-500" />
            <h3 className="text-sm font-semibold text-foreground">Opportunity Radar</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {opportunities.map((item) => (
              <div key={item.title} className="rounded-lg border border-border/40 bg-background/60 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[13px] font-semibold text-foreground">{item.title}</p>
                  <span className="text-[11px] font-medium rounded-full border border-border/50 px-2 py-0.5 text-muted-foreground shrink-0">
                    {item.impact} impact
                  </span>
                </div>
                <p className="text-[12.5px] text-muted-foreground leading-snug mt-1">{item.detail}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border/40 bg-muted/10 p-4">
        <div className="flex items-center gap-2 mb-1">
          <Gauge className="h-4 w-4 text-indigo-500" />
          <h3 className="text-sm font-semibold text-foreground">What-if Profit Simulator</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          Test how operational improvements could change monthly performance.
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="space-y-4">
            <label className="block">
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-foreground">Conversion Lift from Better Staffing/Promos</span>
                <span className="font-medium text-primary">{conversionLift}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={30}
                value={conversionLift}
                onChange={(e) => setConversionLift(Number(e.target.value))}
                className="w-full"
              />
            </label>

            <label className="block">
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-foreground">Waste/Leakage Reduction</span>
                <span className="font-medium text-primary">{wasteReduction}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={40}
                value={wasteReduction}
                onChange={(e) => setWasteReduction(Number(e.target.value))}
                className="w-full"
              />
            </label>
          </div>

          <div className="rounded-lg border border-border/30 bg-background/70 p-4">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="h-4 w-4 text-emerald-500" />
              <p className="text-sm font-semibold text-foreground">Projected Monthly Impact</p>
            </div>
            <div className="space-y-2 text-xs">
              <p className="text-muted-foreground">
                Baseline monthly revenue estimate:
                <span className="ml-1 font-medium text-foreground">KES {simulator.monthlyBaseline.toLocaleString()}</span>
              </p>
              <p className="text-muted-foreground">
                Upside from conversion lift:
                <span className="ml-1 font-medium text-foreground">KES {simulator.monthlyUpside.toLocaleString()}</span>
              </p>
              <p className="text-muted-foreground">
                Saved from waste reduction:
                <span className="ml-1 font-medium text-foreground">KES {simulator.wasteSaved.toLocaleString()}</span>
              </p>
              <div className="pt-2 border-t border-border/30">
                <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                  Total potential gain: KES {simulator.projectedMonthlyGain.toLocaleString()}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="rounded-xl border border-border/40 bg-muted/10 p-4">
          <div className="flex items-center gap-2 mb-3">
            <ClipboardCheck className="h-4 w-4 text-emerald-500" />
            <h3 className="text-sm font-semibold text-foreground">One-click Apply Plan</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <button
              onClick={() =>
                copyPlan('Promotion Target Plan', [
                  'Promote top 3 high-margin products in POS recommendations.',
                  'Offer bundle on one slow mover with one fast mover.',
                  'Review promo conversion at end of each shift.',
                ])
              }
              className="rounded-lg border border-border/40 bg-background/70 px-3 py-2 text-xs font-medium text-foreground hover:bg-primary/10"
            >
              Apply Promotion Plan
            </button>
            <button
              onClick={() =>
                copyPlan('Restock Action List', (data.inventoryIntelligence?.restockNow || []).slice(0, 8).map((p: any) => `${p.name}: stock ${p.stock}, 7d demand ${p.recentDemand}, min ${p.minStock}`))
              }
              className="rounded-lg border border-border/40 bg-background/70 px-3 py-2 text-xs font-medium text-foreground hover:bg-primary/10"
            >
              Apply Restock Plan
            </button>
            <button
              onClick={() =>
                copyPlan('Cashier Shift Briefing', shiftBriefing)
              }
              className="rounded-lg border border-border/40 bg-background/70 px-3 py-2 text-xs font-medium text-foreground hover:bg-primary/10"
            >
              Generate Shift Brief
            </button>
            <button
              onClick={() => window.open('/catha/reports', '_self')}
              className="rounded-lg border border-border/40 bg-background/70 px-3 py-2 text-xs font-medium text-foreground hover:bg-primary/10"
            >
              Open Reports to Execute
            </button>
          </div>
          {applyMessage && <p className="text-xs text-muted-foreground mt-3">{applyMessage}</p>}
        </div>

        <div className="rounded-xl border border-border/40 bg-muted/10 p-4">
          <div className="flex items-center gap-2 mb-2">
            <Users className="h-4 w-4 text-sky-500" />
            <h3 className="text-sm font-semibold text-foreground">AI Shift Briefing for Cashiers</h3>
          </div>
          {shiftLoading ? (
            <p className="text-[13px] text-muted-foreground">Preparing shift notes...</p>
          ) : (
            <ul className="space-y-1.5">
              {shiftBriefing.map((line) => (
                <li key={line} className="text-[13px] text-foreground flex gap-2 leading-snug">
                  <span className="text-primary">•</span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-border/40 bg-muted/10 p-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-indigo-500" />
            <h3 className="text-sm font-semibold text-foreground">Weekly Auto-goals Tracker</h3>
          </div>
          <p className="text-[11px] text-muted-foreground">Goals persist on this browser and track progress over time.</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-2 mb-3">
          {suggestedGoals.map((goal) => (
            <button
              key={goal.title}
              onClick={() => addGoal(goal.title, goal.target)}
              className="rounded-lg border border-border/40 bg-background/70 px-3 py-2 text-xs text-left hover:bg-primary/10"
            >
              <span className="font-medium text-foreground">+ {goal.title}</span>
              <span className="block text-muted-foreground">Target: {goal.target.toLocaleString()}</span>
            </button>
          ))}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            const target = Number(goalTarget)
            addGoal(goalTitle, target)
            setGoalTitle('')
            setGoalTarget('')
          }}
          className="flex flex-col md:flex-row gap-2 mb-4"
        >
          <input
            value={goalTitle}
            onChange={(e) => setGoalTitle(e.target.value)}
            placeholder="Create custom goal (e.g. Increase avg order value)"
            className="flex-1 rounded-lg border border-border/40 bg-background px-3 py-2 text-xs"
          />
          <input
            value={goalTarget}
            onChange={(e) => setGoalTarget(e.target.value)}
            placeholder="Target number"
            inputMode="numeric"
            className="w-full md:w-40 rounded-lg border border-border/40 bg-background px-3 py-2 text-xs"
          />
          <button type="submit" className="inline-flex items-center justify-center gap-1 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-50" disabled={!goalTitle.trim() || !goalTarget}>
            <Plus className="h-3.5 w-3.5" />
            Add Goal
          </button>
        </form>

        <div className="rounded-lg border border-border/30 bg-background/70 p-3 mb-4">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              <p className="text-xs font-semibold text-foreground">Goal Health Score</p>
            </div>
            <span className={`text-[11px] rounded-full px-2 py-0.5 border ${
              weeklySummary.healthColor === 'green'
                ? 'border-emerald-500/40 text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30'
                : weeklySummary.healthColor === 'yellow'
                  ? 'border-amber-500/40 text-amber-600 bg-amber-50 dark:bg-amber-950/30'
                  : 'border-red-500/40 text-red-600 bg-red-50 dark:bg-red-950/30'
            }`}>
              {weeklySummary.healthColor === 'green' ? 'Green' : weeklySummary.healthColor === 'yellow' ? 'Yellow' : 'Red'}
            </span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            <SummaryMetric label="Health Score" value={`${weeklySummary.healthScore}%`} />
            <SummaryMetric label="Completion" value={`${weeklySummary.completionRate}%`} />
            <SummaryMetric label="Completed" value={`${weeklySummary.completedGoals}`} />
            <SummaryMetric label="On Track" value={`${weeklySummary.onTrackGoals}`} />
            <SummaryMetric label="At Risk" value={`${weeklySummary.atRiskGoals}`} alert={weeklySummary.atRiskGoals > 0} />
          </div>
          <p className="text-[11px] text-muted-foreground mt-2">
            Weekly summary: {weeklySummary.totalGoals === 0
              ? 'No active goals yet. Add goals to start tracking health.'
              : `${weeklySummary.completedGoals}/${weeklySummary.totalGoals} goals completed this week, ${weeklySummary.atRiskGoals} at risk.`}
          </p>
        </div>

        {goals.length === 0 ? (
          <p className="text-xs text-muted-foreground">No goals yet. Add one of the auto-goals above or create a custom one.</p>
        ) : (
          <div className="space-y-2">
            {goals.map((goal) => {
              const pct = goal.target > 0 ? Math.min(100, Math.round((goal.achieved / goal.target) * 100)) : 0
              const goalHealthInfo = getGoalHealthInfo(goal)
              const goalHealth = goalHealthInfo.color
              return (
                <div key={goal.id} className="rounded-lg border border-border/30 bg-background/70 p-3">
                  <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-3">
                    <button
                      type="button"
                      onClick={() => toggleGoal(goal.id)}
                      className={`text-xs rounded-full px-2 py-0.5 border ${goal.completed ? 'border-emerald-500 text-emerald-600' : 'border-border/40 text-muted-foreground'}`}
                    >
                      {goal.completed ? 'Completed' : 'In Progress'}
                    </button>
                    <p className="text-xs font-medium text-foreground flex-1">{goal.title}</p>
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] rounded-full px-1.5 py-0.5 border ${
                        goalHealth === 'green'
                          ? 'border-emerald-500/40 text-emerald-600'
                          : goalHealth === 'yellow'
                            ? 'border-amber-500/40 text-amber-600'
                            : 'border-red-500/40 text-red-600'
                      }`} title={goalHealthInfo.reasons.join(' | ')}>
                        {goalHealth === 'green' ? 'Green' : goalHealth === 'yellow' ? 'Yellow' : 'Red'}
                      </span>
                      <span className="text-[11px] text-muted-foreground">Achieved</span>
                      <input
                        type="number"
                        value={goal.achieved}
                        onChange={(e) => updateGoalProgress(goal.id, Number(e.target.value || 0))}
                        className="w-24 rounded-md border border-border/40 bg-background px-2 py-1 text-xs"
                      />
                      <span className="text-[11px] text-muted-foreground">/ {goal.target.toLocaleString()}</span>
                    </div>
                  </div>
                  <div className="mt-2 h-2 rounded-full bg-muted/50 overflow-hidden">
                    <div className={`${goalHealth === 'green' ? 'bg-emerald-500' : goalHealth === 'yellow' ? 'bg-amber-500' : 'bg-red-500'} h-full`} style={{ width: `${pct}%` }} />
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">{pct}% achieved</p>
                  {goalHealth === 'red' && (
                    <p className="text-[11px] text-red-600 dark:text-red-400 mt-1">
                      Why red: {goalHealthInfo.reasons.join(' • ')}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}

function SummaryMetric({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <div className={`rounded-md border px-2 py-2 ${alert ? 'border-red-300/50 bg-red-50/60 dark:bg-red-950/20' : 'border-border/30 bg-muted/20'}`}>
      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className={`text-sm font-semibold ${alert ? 'text-red-600 dark:text-red-400' : 'text-foreground'}`}>{value}</p>
    </div>
  )
}

function getGoalHealthInfo(goal: { target: number; achieved: number; completed: boolean; updatedAt?: string }) {
  const pct = goal.target > 0 ? Math.min(100, Math.round((goal.achieved / goal.target) * 100)) : 0
  const now = Date.now()
  const updatedAtMs = goal.updatedAt ? new Date(goal.updatedAt).getTime() : now
  const noRecentUpdate = Number.isFinite(updatedAtMs) ? (now - updatedAtMs) > (7 * 24 * 60 * 60 * 1000) : false
  const targetTooHigh = goal.target >= 100 && goal.achieved <= Math.round(goal.target * 0.2)

  if (goal.completed || pct >= 100) {
    return { color: 'green' as const, reasons: ['Goal completed'] }
  }
  if (pct >= 75 && !noRecentUpdate) {
    return { color: 'green' as const, reasons: ['Strong progress this week'] }
  }
  if (pct >= 40) {
    const reasons = ['Moderate progress']
    if (noRecentUpdate) reasons.push('No update this week')
    return { color: 'yellow' as const, reasons }
  }

  const reasons = ['Low progress']
  if (noRecentUpdate) reasons.push('No update this week')
  if (targetTooHigh) reasons.push('Target may be too high')
  return { color: 'red' as const, reasons }
}
