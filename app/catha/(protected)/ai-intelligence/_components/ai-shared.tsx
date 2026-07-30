'use client'

import { cn } from '@/lib/utils'
import Link from 'next/link'
import {
  AlertTriangle, AlertCircle, Info, CheckCircle, ArrowRight, TrendingUp, TrendingDown, Minus,
} from 'lucide-react'

// ── Severity / status badges ──
export function SeverityBadge({ severity }: { severity: string }) {
  const config: Record<string, { cls: string; label: string; Icon: React.ComponentType<{ className?: string }> }> = {
    critical: { cls: 'bg-red-600 text-white', label: 'Critical', Icon: AlertCircle },
    high: { cls: 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300 ring-1 ring-orange-300/60 dark:ring-orange-800', label: 'High', Icon: AlertTriangle },
    medium: { cls: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 ring-1 ring-amber-300/60 dark:ring-amber-800', label: 'Medium', Icon: Info },
    low: { cls: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300 ring-1 ring-sky-300/60 dark:ring-sky-800', label: 'Low', Icon: CheckCircle },
  }
  const c = config[severity] || config.low
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide shrink-0', c.cls)}>
      <c.Icon className="h-3 w-3" />
      {c.label}
    </span>
  )
}

export function ImpactBadge({ impact }: { impact: string }) {
  const colors: Record<string, string> = {
    profit: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
    revenue: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300',
    cost: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
    operations: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
    data: 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300',
    retention: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
  }
  return (
    <span className={cn('inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide', colors[impact] || colors.operations)}>
      {impact}
    </span>
  )
}

export function TypeBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    increase: 'bg-emerald-600 text-white',
    reduce: 'bg-orange-500 text-white',
    promote: 'bg-indigo-600 text-white',
    fix: 'bg-red-600 text-white',
    monitor: 'bg-slate-600 text-white',
  }
  return (
    <span className={cn('inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide', colors[type] || colors.monitor)}>
      {type}
    </span>
  )
}

export function ActionLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-[13px] font-semibold text-primary-foreground hover:bg-primary/90 transition-colors shrink-0">
      {label} <ArrowRight className="h-3.5 w-3.5" />
    </Link>
  )
}

// ── Score visuals ──
export function scoreTone(score: number) {
  if (score >= 70) return { text: 'text-emerald-600 dark:text-emerald-400', stroke: 'stroke-emerald-500', bar: 'bg-emerald-500', word: 'Good' }
  if (score >= 40) return { text: 'text-amber-600 dark:text-amber-400', stroke: 'stroke-amber-500', bar: 'bg-amber-500', word: 'Fair' }
  return { text: 'text-red-600 dark:text-red-400', stroke: 'stroke-red-500', bar: 'bg-red-500', word: 'Weak' }
}

export function ScoreGauge({ score, label, size = 'md' }: { score: number; label: string; size?: 'sm' | 'md' | 'lg' }) {
  const tone = scoreTone(score)
  const dims = { sm: { w: 64, r: 26, sw: 5 }, md: { w: 96, r: 40, sw: 7 }, lg: { w: 148, r: 62, sw: 9 } }
  const d = dims[size]
  const circumference = 2 * Math.PI * d.r
  const offset = circumference - (score / 100) * circumference

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: d.w, height: d.w }}>
        <svg className="transform -rotate-90" width={d.w} height={d.w}>
          <circle cx={d.w / 2} cy={d.w / 2} r={d.r} fill="none" className="stroke-muted/40" strokeWidth={d.sw} />
          <circle cx={d.w / 2} cy={d.w / 2} r={d.r} fill="none" className={tone.stroke} strokeWidth={d.sw}
            strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round"
            style={{ transition: 'stroke-dashoffset 1s ease-out' }} />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={cn('font-bold tabular-nums leading-none', tone.text, size === 'lg' ? 'text-4xl' : size === 'md' ? 'text-2xl' : 'text-base')}>{score}</span>
          {size === 'lg' && <span className={cn('text-[12px] font-semibold mt-1', tone.text)}>{tone.word}</span>}
        </div>
      </div>
      <span className={cn('text-foreground/80 font-medium text-center', size === 'sm' ? 'text-[12px]' : 'text-[13px]')}>{label}</span>
    </div>
  )
}

export function ScoreBar({
  score,
  label,
  reason,
  solution,
  actionLink,
  actionLabel,
  target = 70,
}: {
  score: number
  label: string
  reason?: string
  solution?: string
  actionLink?: string
  actionLabel?: string
  target?: number
}) {
  const tone = scoreTone(score)
  const needsWork = score < target
  return (
    <div className="rounded-xl border border-border/40 bg-muted/20 p-3.5 space-y-2.5">
      <div>
        <div className="flex items-center justify-between mb-1.5 gap-2">
          <span className="text-[13px] font-medium text-foreground">{label}</span>
          <span className="flex items-baseline gap-1.5 shrink-0">
            <span className={cn('text-sm font-bold tabular-nums', tone.text)}>{score}</span>
            <span className={cn('text-[11px] font-semibold uppercase tracking-wide', tone.text)}>{tone.word}</span>
            {needsWork && (
              <span className="text-[10px] font-semibold text-muted-foreground tabular-nums">/ {target}+</span>
            )}
          </span>
        </div>
        <div className="h-2 rounded-full bg-muted/50 overflow-hidden relative">
          <div className={cn('h-full rounded-full transition-all duration-700', tone.bar)} style={{ width: `${score}%` }} />
          <div
            className="absolute top-0 bottom-0 w-px bg-foreground/25"
            style={{ left: `${target}%` }}
            title={`Target ${target}`}
          />
        </div>
      </div>
      {(reason || solution) && (
        <div className="space-y-1.5 text-[12px] leading-snug">
          {reason && (
            <p className="text-muted-foreground">
              <span className="font-semibold text-foreground/80">Why: </span>
              {reason}
            </p>
          )}
          {solution && (
            <p className={needsWork ? 'text-foreground/90' : 'text-muted-foreground'}>
              <span className={cn('font-semibold', needsWork ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400')}>
                {needsWork ? 'Do next: ' : 'Keep: '}
              </span>
              {solution}
            </p>
          )}
          {needsWork && actionLink && (
            <Link
              href={actionLink}
              className="inline-flex items-center gap-1 text-[12px] font-semibold text-primary hover:underline pt-0.5"
            >
              {actionLabel || 'Take action'} <ArrowRight className="h-3 w-3" />
            </Link>
          )}
        </div>
      )}
    </div>
  )
}

export function TrendIndicator({ value, suffix = '%' }: { value: number; suffix?: string }) {
  if (value > 0) return <span className="inline-flex items-center gap-0.5 text-xs font-medium text-emerald-600"><TrendingUp className="h-3 w-3" />+{value}{suffix}</span>
  if (value < 0) return <span className="inline-flex items-center gap-0.5 text-xs font-medium text-red-600"><TrendingDown className="h-3 w-3" />{value}{suffix}</span>
  return <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground"><Minus className="h-3 w-3" />0{suffix}</span>
}

// ── Section wrapper ──
export function AISection({ id, title, description, icon: Icon, children, className, actions, defaultOpen: _defaultOpen }: {
  id: string; title: string; description?: string
  icon: React.ComponentType<{ className?: string }>
  children: React.ReactNode; className?: string
  actions?: React.ReactNode
  defaultOpen?: boolean
}) {
  return (
    <section id={id} className={cn('rounded-2xl border border-border/60 bg-card shadow-sm overflow-hidden scroll-mt-28', className)}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-4 border-b border-border/50 bg-muted/10">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 shrink-0">
          <Icon className="h-[18px] w-[18px] text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-[15px] font-bold text-foreground tracking-tight leading-tight">{title}</h2>
          {description && <p className="text-[12.5px] text-muted-foreground leading-snug mt-0.5">{description}</p>}
        </div>
        {actions}
      </div>
      <div className="p-4 md:p-5">{children}</div>
    </section>
  )
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
      <div className="text-center">
        <CheckCircle className="h-8 w-8 mx-auto mb-2 text-emerald-500" />
        <p className="text-[13px]">{message}</p>
      </div>
    </div>
  )
}

export function StatCard({ title, value, subtitle, trend, className }: {
  title: string; value: string | number; subtitle?: string; trend?: number; className?: string
}) {
  return (
    <div className={cn('rounded-xl border border-border/50 bg-card p-4 shadow-sm', className)}>
      <p className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wide">{title}</p>
      <div className="mt-1 flex items-end gap-2">
        <p className="text-2xl font-bold text-foreground tabular-nums">{value}</p>
        {trend !== undefined && <TrendIndicator value={trend} />}
      </div>
      {subtitle && <p className="mt-1 text-[12px] text-muted-foreground">{subtitle}</p>}
    </div>
  )
}
