import clientPromise from '@/lib/mongodb'
import { ObjectId } from 'mongodb'

export type ShiftSmsQueueStatus = 'pending' | 'processing' | 'sent' | 'delivered' | 'failed' | 'permanently_failed'
export type ShiftSmsEventType = 'OPEN' | 'CLOSE' | 'AUTO_CLOSE'

export interface ShiftSmsQueueItem {
  _id?: ObjectId
  userId: string
  shiftId?: string
  phone: string
  message: string
  eventType: ShiftSmsEventType
  attempts: number
  status: ShiftSmsQueueStatus
  nextRetryAt: Date
  processingBy?: string | null
  processingAt?: Date | null
  providerMessageId?: string | null
  sentAt?: Date | null
  deliveredAt?: Date | null
  resolvedAt?: Date | null
  lastError?: string | null
  createdAt: Date
  updatedAt: Date
}

const DB_NAME = 'infusion_jaba'
const COLLECTION = 'shift_sms_queue'
const DLQ_COLLECTION = 'shift_sms_dead_letter'
const ALERT_COLLECTION = 'critical_alerts'
const MAX_ATTEMPTS = 5
const RATE_LIMIT_WINDOW_MS = 5 * 60_000
const RATE_LIMIT_MAX = 3

export async function ensureShiftSmsQueueIndexes(): Promise<void> {
  const client = await clientPromise
  const col = client.db(DB_NAME).collection<ShiftSmsQueueItem>(COLLECTION)
  await col.createIndex({ status: 1, nextRetryAt: 1 }, { name: 'shift_sms_queue_status_retry_idx' })
  await col.createIndex({ createdAt: -1 }, { name: 'shift_sms_queue_created_idx' })
  await col.createIndex({ userId: 1, createdAt: -1 }, { name: 'shift_sms_queue_user_idx' })
  await col.createIndex({ userId: 1, eventType: 1, shiftId: 1 }, { name: 'shift_sms_queue_event_dedupe_idx', unique: true })
  await col.createIndex({ providerMessageId: 1 }, { name: 'shift_sms_queue_provider_msg_idx', sparse: true })
  await client.db(DB_NAME).collection(DLQ_COLLECTION).createIndex({ createdAt: -1 }, { name: 'shift_sms_dlq_created_idx' })
  await client.db(DB_NAME).collection(ALERT_COLLECTION).createIndex({ createdAt: -1 }, { name: 'critical_alert_created_idx' })
}

export async function enqueueShiftSms(payload: {
  userId: string
  shiftId?: string
  phone: string
  message: string
  eventType: ShiftSmsEventType
  status?: ShiftSmsQueueStatus
  lastError?: string | null
}): Promise<void> {
  const client = await clientPromise
  const col = client.db(DB_NAME).collection<ShiftSmsQueueItem>(COLLECTION)
  const now = new Date()
  const recentCount = await col.countDocuments({
    userId: payload.userId,
    createdAt: { $gte: new Date(now.getTime() - RATE_LIMIT_WINDOW_MS) },
  })
  const delayedByRateLimit = recentCount >= RATE_LIMIT_MAX
  const nextRetryAt = delayedByRateLimit ? new Date(now.getTime() + RATE_LIMIT_WINDOW_MS) : now
  const initialStatus: ShiftSmsQueueStatus = payload.status ?? 'pending'
  const insertDoc: ShiftSmsQueueItem = {
    userId: payload.userId,
    shiftId: payload.shiftId,
    phone: payload.phone,
    message: payload.message,
    eventType: payload.eventType,
    attempts: initialStatus === 'failed' || initialStatus === 'permanently_failed' ? 1 : 0,
    status: initialStatus,
    nextRetryAt,
    processingBy: null,
    processingAt: null,
    providerMessageId: null,
    sentAt: null,
    deliveredAt: null,
    resolvedAt: null,
    lastError: payload.lastError ?? null,
    createdAt: now,
    updatedAt: now,
  }
  try {
    await col.insertOne(insertDoc)
  } catch (error: any) {
    if (error?.code === 11000) return
    throw error
  }
}

export async function claimProcessableShiftSmsBatch(limit: number, workerId: string): Promise<ShiftSmsQueueItem[]> {
  const client = await clientPromise
  const col = client.db(DB_NAME).collection<ShiftSmsQueueItem>(COLLECTION)
  const now = new Date()
  const stuckCutoff = new Date(now.getTime() - 2 * 60_000)
  const claimed: ShiftSmsQueueItem[] = []
  const take = Math.max(1, Math.min(500, limit))
  for (let i = 0; i < take; i += 1) {
    const doc = await col.findOneAndUpdate(
      {
        $or: [
          {
            status: { $in: ['pending', 'failed'] },
            attempts: { $lt: MAX_ATTEMPTS },
            nextRetryAt: { $lte: now },
          },
          // Reclaim workers killed mid-send (Vercel freeze / timeout).
          {
            status: 'processing',
            attempts: { $lt: MAX_ATTEMPTS },
            processingAt: { $lte: stuckCutoff },
          },
        ],
      },
      {
        $set: {
          status: 'processing',
          processingBy: workerId,
          processingAt: now,
          updatedAt: now,
        },
      },
      { sort: { nextRetryAt: 1, createdAt: 1 }, returnDocument: 'after' }
    )
    if (!doc) break
    claimed.push(doc)
  }
  return claimed
}

export async function markShiftSmsSent(id: string, providerMessageId?: string | null): Promise<void> {
  const client = await clientPromise
  await client
    .db(DB_NAME)
    .collection<ShiftSmsQueueItem>(COLLECTION)
    .updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          status: 'sent',
          updatedAt: new Date(),
          sentAt: new Date(),
          lastError: null,
          nextRetryAt: new Date(),
          processingBy: null,
          processingAt: null,
          providerMessageId: providerMessageId ?? null,
        },
        $inc: { attempts: 1 },
      }
    )
}

const RETRY_BACKOFF_MS = [30_000, 120_000, 300_000, 900_000]

export async function markShiftSmsFailed(id: string, attemptsAfterIncrement: number, error: string): Promise<void> {
  const client = await clientPromise
  const col = client.db(DB_NAME).collection<ShiftSmsQueueItem>(COLLECTION)
  const retryIndex = Math.max(0, Math.min(RETRY_BACKOFF_MS.length - 1, attemptsAfterIncrement - 1))
  const backoff = RETRY_BACKOFF_MS[retryIndex] ?? RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1]
  const terminal = attemptsAfterIncrement >= MAX_ATTEMPTS
  const now = new Date()
  const doc = await col.findOne({ _id: new ObjectId(id) })
  await col.updateOne(
    { _id: new ObjectId(id) },
    {
      $set: {
        status: terminal ? 'permanently_failed' : 'failed',
        updatedAt: now,
        lastError: error,
        nextRetryAt: terminal ? now : new Date(Date.now() + backoff),
        processingBy: null,
        processingAt: null,
      },
      $inc: { attempts: 1 },
    }
  )
  if (terminal && doc) {
    await client.db(DB_NAME).collection(DLQ_COLLECTION).insertOne({
      ...doc,
      status: 'permanently_failed',
      lastError: error,
      failedAt: now,
      movedToDeadLetterAt: now,
    })
    await client.db(DB_NAME).collection(ALERT_COLLECTION).insertOne({
      type: 'SMS_PERMANENT_FAILURE',
      severity: 'critical',
      userId: doc.userId,
      shiftId: doc.shiftId ?? null,
      message: `SMS permanently failed for ${doc.userId}`,
      meta: { eventType: doc.eventType, phone: doc.phone, lastError: error },
      createdAt: now,
    })
  }
}

export async function markShiftSmsDeliveredByQueueId(id: string, providerMessageId?: string | null): Promise<boolean> {
  const client = await clientPromise
  const res = await client
    .db(DB_NAME)
    .collection<ShiftSmsQueueItem>(COLLECTION)
    .updateOne(
      { _id: new ObjectId(id), status: { $in: ['sent', 'processing'] } },
      {
        $set: {
          status: 'delivered',
          deliveredAt: new Date(),
          updatedAt: new Date(),
          providerMessageId: providerMessageId ?? null,
          processingBy: null,
          processingAt: null,
          lastError: null,
        },
      }
    )
  return res.modifiedCount > 0
}

export async function markShiftSmsFailedByQueueId(id: string, reason: string): Promise<boolean> {
  const client = await clientPromise
  const doc = await client.db(DB_NAME).collection<ShiftSmsQueueItem>(COLLECTION).findOne({ _id: new ObjectId(id) })
  if (!doc) return false
  const nextAttempt = Number(doc.attempts || 0) + 1
  await markShiftSmsFailed(id, nextAttempt, reason)
  return true
}

export async function markShiftSmsFailedByProviderId(providerMessageId: string, reason: string): Promise<boolean> {
  const client = await clientPromise
  const doc = await client.db(DB_NAME).collection<ShiftSmsQueueItem>(COLLECTION).findOne({ providerMessageId })
  if (!doc?._id) return false
  const nextAttempt = Number(doc.attempts || 0) + 1
  await markShiftSmsFailed(String(doc._id), nextAttempt, reason)
  return true
}

export async function markShiftSmsDeliveredByProviderId(providerMessageId: string): Promise<boolean> {
  const client = await clientPromise
  const res = await client
    .db(DB_NAME)
    .collection<ShiftSmsQueueItem>(COLLECTION)
    .updateOne(
      { providerMessageId, status: { $in: ['sent', 'processing'] } },
      {
        $set: {
          status: 'delivered',
          deliveredAt: new Date(),
          updatedAt: new Date(),
          processingBy: null,
          processingAt: null,
          lastError: null,
        },
      }
    )
  return res.modifiedCount > 0
}

export async function markShiftSmsResolved(id: string): Promise<void> {
  const client = await clientPromise
  await client
    .db(DB_NAME)
    .collection<ShiftSmsQueueItem>(COLLECTION)
    .updateOne({ _id: new ObjectId(id) }, { $set: { resolvedAt: new Date(), updatedAt: new Date() } })
}

export async function retryShiftSms(id: string): Promise<void> {
  const client = await clientPromise
  await client
    .db(DB_NAME)
    .collection<ShiftSmsQueueItem>(COLLECTION)
    .updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          status: 'pending',
          nextRetryAt: new Date(),
          processingBy: null,
          processingAt: null,
          updatedAt: new Date(),
        },
      }
    )
}

export async function listShiftSmsQueue(options?: {
  limit?: number
  status?: ShiftSmsQueueStatus | 'all'
  search?: string
}): Promise<ShiftSmsQueueItem[]> {
  const client = await clientPromise
  const filter: Record<string, any> = {}
  if (options?.status && options.status !== 'all') filter.status = options.status
  if (options?.search) {
    const q = String(options.search).trim()
    if (q) {
      filter.$or = [{ phone: { $regex: q, $options: 'i' } }, { userId: { $regex: q, $options: 'i' } }]
    }
  }
  return client
    .db(DB_NAME)
    .collection<ShiftSmsQueueItem>(COLLECTION)
    .find(filter)
    .sort({ createdAt: -1 })
    .limit(Math.max(1, Math.min(500, options?.limit ?? 200)))
    .toArray()
}

export async function getShiftSmsQueueMetrics(): Promise<{
  total: number
  sent: number
  delivered: number
  failed: number
  permanentlyFailed: number
  pending: number
  processing: number
  successRate: number
  failureRate: number
  avgDeliveryMs: number | null
  retryDistribution: Record<string, number>
  unresolvedCriticalAlerts: number
}> {
  const client = await clientPromise
  const col = client.db(DB_NAME).collection<ShiftSmsQueueItem>(COLLECTION)
  const [total, sent, delivered, failed, permanentlyFailed, pending, processing, alerts] = await Promise.all([
    col.countDocuments({}),
    col.countDocuments({ status: 'sent' }),
    col.countDocuments({ status: 'delivered' }),
    col.countDocuments({ status: 'failed' }),
    col.countDocuments({ status: 'permanently_failed' }),
    col.countDocuments({ status: 'pending' }),
    col.countDocuments({ status: 'processing' }),
    client.db(DB_NAME).collection(ALERT_COLLECTION).countDocuments({ type: 'SMS_PERMANENT_FAILURE' }),
  ])
  const deliveredDocs = await col
    .find({ deliveredAt: { $ne: null }, sentAt: { $ne: null } }, { projection: { sentAt: 1, deliveredAt: 1 } })
    .limit(500)
    .toArray()
  const avgDeliveryMs =
    deliveredDocs.length === 0
      ? null
      : Math.round(
          deliveredDocs.reduce((sum, d: any) => sum + (new Date(d.deliveredAt).getTime() - new Date(d.sentAt).getTime()), 0) /
            deliveredDocs.length
        )
  const retryBuckets = await col
    .aggregate<{ _id: number; count: number }>([
      { $group: { _id: '$attempts', count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ])
    .toArray()
  const retryDistribution: Record<string, number> = {}
  for (const bucket of retryBuckets) retryDistribution[String(bucket._id)] = bucket.count
  const successful = sent + delivered
  const totalResolved = successful + failed + permanentlyFailed
  return {
    total,
    sent,
    delivered,
    failed,
    permanentlyFailed,
    pending,
    processing,
    successRate: totalResolved === 0 ? 0 : Number(((successful / totalResolved) * 100).toFixed(2)),
    failureRate: totalResolved === 0 ? 0 : Number((((failed + permanentlyFailed) / totalResolved) * 100).toFixed(2)),
    avgDeliveryMs,
    retryDistribution,
    unresolvedCriticalAlerts: alerts,
  }
}

