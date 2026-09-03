import clientPromise from '@/lib/mongodb'
import { normalizePhoneNumbers, sendJabaSmsStrict } from '@/lib/jaba-sms'
import { resolveSmsGatewayConfig } from '@/lib/sms-gateway-settings'

const DB_NAME = 'infusion_jaba'
const COLLECTION = 'jaba_delete_otps'
const OTP_EXPIRY_MINUTES = 10

export type DeleteAction =
  | 'delete_batch'
  | 'delete_packaging'
  | 'delete_delivery_note'
  | 'delete_raw_material'
  | 'delete_supplier'
  | 'delete_distributor'
  | 'delete_flavor'
  | 'delete_user'
  | 'delete_flavour_output'

function generateOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000))
}

/**
 * mongodb@6+ returns the matched document from findOneAndUpdate; older drivers
 * returned ModifyResult { value: doc | null }.
 */
function findOneAndUpdateResultDoc(r: unknown): Record<string, unknown> | null {
  if (r == null || typeof r !== 'object') return null
  const o = r as Record<string, unknown>
  if ('value' in o && o.value !== undefined && !('_id' in o)) {
    const inner = o.value
    return inner != null && typeof inner === 'object' ? (inner as Record<string, unknown>) : null
  }
  return o
}

export async function requestDeleteOtp(params: {
  action: DeleteAction
  targetId: string
  requestedBy: string
  /** Override default expiry. */
  expiryMinutes?: number
}) {
  const minutes = params.expiryMinutes ?? OTP_EXPIRY_MINUTES
  const expiresAt = new Date(Date.now() + minutes * 60 * 1000)
  const gateway = await resolveSmsGatewayConfig()
  const targetNumbers = normalizePhoneNumbers(gateway.adminOtpPhones || process.env.OT_NUMBER || '')

  if (targetNumbers.length === 0) {
    throw new Error(
      'Admin OTP phone missing. Set Settings → SMS → Admin OTP phones (or OT_NUMBER env) to a valid mobile (e.g. 07XXXXXXXX).'
    )
  }

  const client = await clientPromise
  const db = client.db(DB_NAME)
  const storageTargetId = params.targetId
  const otp = generateOtp()

  const insertResult = await db.collection(COLLECTION).insertOne({
    action: params.action,
    targetId: storageTargetId,
    requestedBy: params.requestedBy,
    otp,
    used: false,
    createdAt: new Date(),
    expiresAt,
  })

  try {
    await sendJabaSmsStrict(`Jaba ${params.action} OTP: ${otp}. Expires in ${minutes} minutes.`, targetNumbers)
  } catch (error) {
    await db.collection(COLLECTION).deleteOne({ _id: insertResult.insertedId })
    throw error
  }
}

export type VerifyDeleteOtpResult =
  | { ok: true }
  | { ok: false; reason: 'missing_header' | 'no_otp_doc' | 'bad_otp' | 'expired' }

/**
 * Atomically marks the newest matching OTP as used only if code matches and window is valid.
 */
export async function verifyDeleteOtpResult(params: {
  action: DeleteAction
  targetId: string
  requestedBy: string
  otp: string
}): Promise<VerifyDeleteOtpResult> {
  const raw = params.otp.trim()
  const digitsOnly = raw.replace(/\D/g, '')
  // Stored codes are 6 digits; accept pasted formats like "123 456" or "123-456"
  const otpTrim = digitsOnly.length === 6 ? digitsOnly : raw
  if (!otpTrim) {
    return { ok: false, reason: 'missing_header' }
  }

  const client = await clientPromise
  const db = client.db(DB_NAME)
  const now = new Date()
  const storageTargetId = params.targetId

  const r = await db.collection(COLLECTION).findOneAndUpdate(
    {
      action: params.action,
      targetId: storageTargetId,
      requestedBy: params.requestedBy,
      used: false,
      expiresAt: { $gt: now },
      otp: otpTrim,
    },
    { $set: { used: true, usedAt: now } },
    { returnDocument: 'before' }
  )

  if (findOneAndUpdateResultDoc(r)) {
    return { ok: true }
  }

  const latest = await db.collection(COLLECTION).findOne(
    {
      action: params.action,
      targetId: storageTargetId,
      requestedBy: params.requestedBy,
    },
    { sort: { createdAt: -1 } }
  )

  if (!latest) {
    return { ok: false, reason: 'no_otp_doc' }
  }
  if (latest.used === true) {
    return { ok: false, reason: 'bad_otp' }
  }
  const exp = latest.expiresAt instanceof Date ? latest.expiresAt : new Date(latest.expiresAt)
  if (exp <= now) {
    return { ok: false, reason: 'expired' }
  }
  return { ok: false, reason: 'bad_otp' }
}

/** @deprecated Prefer verifyDeleteOtpResult for structured failures. */
export async function verifyDeleteOtp(params: {
  action: DeleteAction
  targetId: string
  requestedBy: string
  otp: string
}): Promise<boolean> {
  const r = await verifyDeleteOtpResult(params)
  return r.ok
}
