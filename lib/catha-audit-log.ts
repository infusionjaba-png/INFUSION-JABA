import clientPromise from '@/lib/mongodb'
import { sendJabaSmsStrict, normalizePhoneNumbers } from '@/lib/jaba-sms'
import type { Db } from 'mongodb'

export type CathaAuditType = 'SECURITY' | 'FINANCIAL' | 'SYSTEM'
export type CathaAuditStatus = 'SUCCESS' | 'DENIED'

export type CathaAuditLogInput = {
  type: CathaAuditType
  action: string
  status: CathaAuditStatus
  reason?: string | null
  userId?: string | null
  role?: string | null
  shiftId?: string | null
  endpoint: string
  payloadSummary?: Record<string, unknown>
}

type CathaAuditLogDoc = CathaAuditLogInput & {
  createdAt: Date
}

const DB_NAME = 'infusion_jaba'
const COLLECTION = 'audit_logs'
const ALERT_STATE_COLLECTION = 'audit_alert_state'
const MAINTENANCE_STATE_COLLECTION = 'audit_maintenance_state'
const RETENTION_STATE_ID = 'retention'

const SUCCESS_RETENTION_DAYS = 45
const DENIED_RETENTION_DAYS = 120
const RETENTION_COOLDOWN_MS = 24 * 60 * 60 * 1000

let ensureIndexesPromise: Promise<void> | null = null

function sanitizeSummary(value: unknown): unknown {
  if (value == null) return value
  if (typeof value === 'string') {
    if (value.length > 180) return value.slice(0, 180)
    return value
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizeSummary(item))
  if (typeof value === 'object') {
    const input = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(input).slice(0, 30)) {
      const key = k.toLowerCase()
      if (key.includes('phone')) {
        const raw = String(v ?? '')
        out[k] = raw.length > 4 ? `${'*'.repeat(Math.max(0, raw.length - 4))}${raw.slice(-4)}` : raw
        continue
      }
      out[k] = sanitizeSummary(v)
    }
    return out
  }
  return String(value)
}

export async function ensureCathaAuditIndexes(): Promise<void> {
  if (!ensureIndexesPromise) {
    ensureIndexesPromise = (async () => {
      const client = await clientPromise
      const col = client.db(DB_NAME).collection(COLLECTION)
      await Promise.all([
        col.createIndex({ createdAt: -1 }, { name: 'audit_createdAt_idx' }),
        col.createIndex({ userId: 1, createdAt: -1 }, { name: 'audit_user_created_idx' }),
        col.createIndex({ status: 1, createdAt: -1 }, { name: 'audit_status_created_idx' }),
        col.createIndex({ type: 1, createdAt: -1 }, { name: 'audit_type_created_idx' }),
      ])
    })().catch((error: any) => {
      console.error('[audit-log] Failed to ensure indexes:', error?.message || error)
    })
  }
  await ensureIndexesPromise
}

export async function writeCathaAuditLog(input: CathaAuditLogInput): Promise<void> {
  await ensureCathaAuditIndexes()
  const client = await clientPromise
  const db = client.db(DB_NAME)
  const doc: CathaAuditLogDoc = {
    ...input,
    reason: input.reason ?? null,
    userId: input.userId ?? null,
    role: input.role ?? null,
    shiftId: input.shiftId ?? null,
    payloadSummary: (sanitizeSummary(input.payloadSummary || {}) as Record<string, unknown>) ?? {},
    createdAt: new Date(),
  }
  await db.collection<CathaAuditLogDoc>(COLLECTION).insertOne(doc)
  if (doc.status === 'DENIED') {
    await maybeSendDeniedBurstSmsAlert(db, doc)
  }
  runAuditRetentionSweep({ db }).catch((error: any) => {
    console.error('[audit-log] Retention sweep failed:', error?.message || error)
  })
}

export function queueCathaAuditLog(input: CathaAuditLogInput): void {
  writeCathaAuditLog(input).catch((error: any) => {
    console.error('[audit-log] Write failed:', error?.message || error)
  })
}

export async function runAuditRetentionSweep(options?: { db?: Db; force?: boolean }) {
  const db = options?.db ?? (await clientPromise).db(DB_NAME)
  const force = options?.force === true
  const now = new Date()

  if (!force) {
    const state = await db.collection(MAINTENANCE_STATE_COLLECTION).findOne({ _id: RETENTION_STATE_ID })
    const lastRunAt =
      state?.lastRunAt instanceof Date
        ? state.lastRunAt
        : state?.lastRunAt
          ? new Date(state.lastRunAt)
          : null
    if (lastRunAt && now.getTime() - lastRunAt.getTime() < RETENTION_COOLDOWN_MS) {
      return { ok: true, skipped: true, deletedSuccess: 0, deletedDenied: 0, lastRunAt }
    }
  }

  const successCutoff = new Date(now.getTime() - SUCCESS_RETENTION_DAYS * 24 * 60 * 60 * 1000)
  const deniedCutoff = new Date(now.getTime() - DENIED_RETENTION_DAYS * 24 * 60 * 60 * 1000)

  const [deleteSuccessRes, deleteDeniedRes] = await Promise.all([
    db.collection(COLLECTION).deleteMany({ status: 'SUCCESS', createdAt: { $lt: successCutoff } }),
    db.collection(COLLECTION).deleteMany({ status: 'DENIED', createdAt: { $lt: deniedCutoff } }),
  ])

  await db.collection(MAINTENANCE_STATE_COLLECTION).updateOne(
    { _id: RETENTION_STATE_ID },
    {
      $set: {
        lastRunAt: now,
        successRetentionDays: SUCCESS_RETENTION_DAYS,
        deniedRetentionDays: DENIED_RETENTION_DAYS,
        deletedSuccess: deleteSuccessRes.deletedCount ?? 0,
        deletedDenied: deleteDeniedRes.deletedCount ?? 0,
        updatedAt: now,
      },
    },
    { upsert: true }
  )

  return {
    ok: true,
    skipped: false,
    deletedSuccess: deleteSuccessRes.deletedCount ?? 0,
    deletedDenied: deleteDeniedRes.deletedCount ?? 0,
    successRetentionDays: SUCCESS_RETENTION_DAYS,
    deniedRetentionDays: DENIED_RETENTION_DAYS,
    lastRunAt: now,
  }
}

async function maybeSendDeniedBurstSmsAlert(db: Db, doc: CathaAuditLogDoc) {
  const settingsDoc = await db.collection('catha_settings').findOne({})
  const notifications = (settingsDoc as any)?.notifications ?? {}
  const enabled = Boolean(notifications.securitySmsAlertsEnabled)
  const recipients = normalizePhoneNumbers(notifications.securityAlertNumbers ?? [])
  const thresholdRaw = Number(notifications.securityDeniedBurstThreshold ?? 10)
  const threshold = Number.isFinite(thresholdRaw) ? Math.max(3, Math.min(100, Math.round(thresholdRaw))) : 10
  if (!enabled || recipients.length === 0 || !doc.userId) return

  const windowStart = new Date(Date.now() - 5 * 60 * 1000)
  const deniedCount = await db.collection(COLLECTION).countDocuments({
    status: 'DENIED',
    userId: doc.userId,
    createdAt: { $gte: windowStart },
  })
  if (deniedCount < threshold) return

  const stateId = `denied-burst:${doc.userId}`
  const cooldownUntil = new Date(Date.now() - 15 * 60 * 1000)
  const state = await db.collection(ALERT_STATE_COLLECTION).findOne({ _id: stateId })
  if (state?.lastSentAt && new Date(state.lastSentAt) > cooldownUntil) return

  const message = [
    'Catha Security Alert',
    `${deniedCount} denied actions in 5 mins`,
    `User: ${doc.userId}`,
    `Reason: ${doc.reason || 'unknown'}`,
    `Endpoint: ${doc.endpoint}`,
  ].join(' | ')

  try {
    await sendJabaSmsStrict(message, recipients)
    await db.collection(ALERT_STATE_COLLECTION).updateOne(
      { _id: stateId },
      { $set: { lastSentAt: new Date(), userId: doc.userId, updatedAt: new Date() } },
      { upsert: true }
    )
  } catch (error) {
    console.error('[catha-audit] Denied-burst SMS failed:', error)
  }
}
