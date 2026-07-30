'use client'

import { Brain, RefreshCw, Shield, Database, Users, AlertTriangle, Lightbulb, CircleAlert, BarChart3 } from 'lucide-react'
import { ScoreGauge, ScoreBar } from './ai-shared'
import { cn } from '@/lib/utils'

export type HealthPillarBreakdown = {
  score: number
  target: number
  status: string
  reason: string
  solution: string
  actionLink?: string
  actionLabel?: string
}

export type HealthBreakdown = {
  overall: HealthPillarBreakdown
  sales: HealthPillarBreakdown
  inventory: HealthPillarBreakdown
  operations: HealthPillarBreakdown
  clientRetention: HealthPillarBreakdown
  dataQuality: HealthPillarBreakdown
}

interface AIHeroProps {
  healthScore: { overall: number; sales: number; inventory: number; dataQuality: number; operations: number; clientRetention: number }
  healthBreakdown?: HealthBreakdown | null
  overview: { totalProducts: number; risksCount: number; profitOpportunities: number; dataIssues: number; stockPressure: string; repeatCustomerCount: number; totalClients: number; todaySales: number; weekSales: number; todayOrders: number }
  lastUpdated: string
  onRefresh: () => void
  loading: boolean
}

export function AIHero({ healthScore, healthBreakdown, overview, lastUpdated, onRefresh, loading }: AIHeroProps) {
  const updatedAt = new Date(lastUpdated)
  const timeStr = updatedAt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  const overall = healthBreakdown?.overall
  const belowTarget = [
    { key: 'sales', label: 'Sales', score: healthScore.sales },
    { key: 'operations', label: 'Operations', score: healthScore.operations },
    { key: 'inventory', label: 'Inventory', score: healthScore.inventory },
    { key: 'clientRetention', label: 'Customer Retention', score: healthScore.clientRetention },
    { key: 'dataQuality', label: 'Data Quality', score: healthScore.dataQuality },
  ].filter((p) => p.score < 70)

  return (
    <div className="space-y-4">
      {/* Header + Health Score */}
      <div className="rounded-2xl border border-border/60 bg-card shadow-sm overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 px-5 md:px-6 py-5 border-b border-border/50">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 shrink-0">
              <Brain className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-bold text-foreground tracking-tight">AI Intelligence</h1>
              <p className="text-[13px] text-muted-foreground">Business monitoring, risk detection, and growth recommendations</p>
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span className="text-[12px] text-muted-foreground">Updated {timeStr}</span>
            <button
              onClick={onRefresh}
              disabled={loading}
              className={cn(
                'inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-[13px] font-semibold text-primary-foreground hover:bg-primary/90 transition-colors',
                loading && 'opacity-60 cursor-not-allowed'
              )}
            >
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
              Refresh Analysis
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[auto_1fr] gap-6 lg:gap-8 items-start px-5 md:px-6 py-6">
          <div className="flex flex-col items-center lg:items-start gap-3 max-w-sm mx-auto lg:mx-0">
            <ScoreGauge score={healthScore.overall} label="Overall Business Health" size="lg" />
            {overall && (
              <div className="w-full rounded-xl border border-border/50 bg-muted/25 p-3 space-y-1.5 text-[12px] leading-snug">
                <p className="text-muted-foreground">
                  <span className="font-semibold text-foreground/80">Why: </span>
                  {overall.reason}
                </p>
                <p className={healthScore.overall < 70 ? 'text-foreground/90' : 'text-muted-foreground'}>
                  <span className={cn('font-semibold', healthScore.overall < 70 ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400')}>
                    {healthScore.overall < 70 ? 'Do next: ' : 'Keep: '}
                  </span>
                  {overall.solution}
                </p>
                {belowTarget.length > 0 && (
                  <p className="text-[11px] text-muted-foreground pt-1 border-t border-border/40">
                    Below target (70+): {belowTarget.map((p) => `${p.label} ${p.score}`).join(' · ')}
                  </p>
                )}
              </div>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <ScoreBar
              score={healthScore.sales}
              label="Sales"
              reason={healthBreakdown?.sales?.reason}
              solution={healthBreakdown?.sales?.solution}
              actionLink={healthBreakdown?.sales?.actionLink}
              actionLabel={healthBreakdown?.sales?.actionLabel}
            />
            <ScoreBar
              score={healthScore.operations}
              label="Operations"
              reason={healthBreakdown?.operations?.reason}
              solution={healthBreakdown?.operations?.solution}
              actionLink={healthBreakdown?.operations?.actionLink}
              actionLabel={healthBreakdown?.operations?.actionLabel}
            />
            <ScoreBar
              score={healthScore.dataQuality}
              label="Data Quality"
              reason={healthBreakdown?.dataQuality?.reason}
              solution={healthBreakdown?.dataQuality?.solution}
              actionLink={healthBreakdown?.dataQuality?.actionLink}
              actionLabel={healthBreakdown?.dataQuality?.actionLabel}
            />
            <ScoreBar
              score={healthScore.inventory}
              label="Inventory"
              reason={healthBreakdown?.inventory?.reason}
              solution={healthBreakdown?.inventory?.solution}
              actionLink={healthBreakdown?.inventory?.actionLink}
              actionLabel={healthBreakdown?.inventory?.actionLabel}
            />
            <ScoreBar
              score={healthScore.clientRetention}
              label="Customer Retention"
              reason={healthBreakdown?.clientRetention?.reason}
              solution={healthBreakdown?.clientRetention?.solution}
              actionLink={healthBreakdown?.clientRetention?.actionLink}
              actionLabel={healthBreakdown?.clientRetention?.actionLabel}
            />
          </div>
        </div>

        <div className="px-5 md:px-6 py-3 border-t border-border/40 bg-muted/10">
          <p className="text-[12px] text-muted-foreground flex items-center gap-1.5">
            <Shield className="h-3.5 w-3.5 shrink-0" />
            Target is 70+ (Good) on every pillar. Reasons and next steps are based on live operational data.
          </p>
        </div>
      </div>

      {/* Key Numbers */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        <OverviewCard
          icon={BarChart3}
          iconColor="text-primary"
          iconBg="bg-primary/10"
          title="Today's Revenue"
          value={`KES ${overview.todaySales.toLocaleString()}`}
          subtitle={`${overview.todayOrders} orders`}
        />
        <OverviewCard
          icon={CircleAlert}
          iconColor="text-red-600"
          iconBg="bg-red-100 dark:bg-red-950"
          title="Risks Detected"
          value={overview.risksCount}
          subtitle="Critical & high severity"
          highlight={overview.risksCount > 0 ? 'red' : undefined}
        />
        <OverviewCard
          icon={AlertTriangle}
          iconColor={overview.stockPressure === 'high' ? 'text-red-600' : overview.stockPressure === 'medium' ? 'text-amber-600' : 'text-emerald-600'}
          iconBg={overview.stockPressure === 'high' ? 'bg-red-100 dark:bg-red-950' : overview.stockPressure === 'medium' ? 'bg-amber-100 dark:bg-amber-950' : 'bg-emerald-100 dark:bg-emerald-950'}
          title="Stock Pressure"
          value={overview.stockPressure.charAt(0).toUpperCase() + overview.stockPressure.slice(1)}
          subtitle="Restock urgency"
          highlight={overview.stockPressure === 'high' ? 'red' : overview.stockPressure === 'medium' ? 'amber' : undefined}
        />
        <OverviewCard
          icon={Lightbulb}
          iconColor="text-emerald-600"
          iconBg="bg-emerald-100 dark:bg-emerald-950"
          title="Profit Opportunities"
          value={overview.profitOpportunities}
          subtitle="Revenue & margin"
        />
        <OverviewCard
          icon={Database}
          iconColor="text-violet-600"
          iconBg="bg-violet-100 dark:bg-violet-950"
          title="Data Issues"
          value={overview.dataIssues}
          subtitle="Missing or incomplete"
        />
        <OverviewCard
          icon={Users}
          iconColor="text-sky-600"
          iconBg="bg-sky-100 dark:bg-sky-950"
          title="Repeat Customers"
          value={overview.repeatCustomerCount}
          subtitle={`of ${overview.totalClients} total`}
        />
      </div>
    </div>
  )
}

function OverviewCard({ icon: Icon, iconColor, iconBg, title, value, subtitle, highlight }: {
  icon: React.ComponentType<{ className?: string }>
  iconColor: string; iconBg: string
  title: string; value: string | number; subtitle: string
  highlight?: 'red' | 'amber'
}) {
  return (
    <div className={cn(
      'rounded-xl border bg-card p-4 shadow-sm transition-shadow hover:shadow-md',
      highlight === 'red' ? 'border-red-300/70 dark:border-red-800' :
      highlight === 'amber' ? 'border-amber-300/70 dark:border-amber-800' :
      'border-border/50'
    )}>
      <div className="flex items-center gap-2 mb-2.5">
        <div className={cn('flex h-8 w-8 items-center justify-center rounded-lg shrink-0', iconBg)}>
          <Icon className={cn('h-4 w-4', iconColor)} />
        </div>
        <p className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wide leading-tight">{title}</p>
      </div>
      <p className="text-xl font-bold text-foreground tabular-nums leading-tight">{value}</p>
      <p className="text-[12px] text-muted-foreground mt-0.5">{subtitle}</p>
    </div>
  )
}
