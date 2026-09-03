import crypto from 'crypto'
import clientPromise from '@/lib/mongodb'
import { normalizeKenyaPhone } from '@/lib/phone-utils'
import { sendJabaSmsStrict } from '@/lib/jaba-sms'

const DB_NAME = 'infusion_jaba'
const OTP_COLLECTION = 'catha_mpesa_integration_otps'
const EDIT_SESSION_COLLECTION = 'catha_mpesa_edit_sessions'
const CHANGE_AUTH_COLLECTION = 'catha_mpesa_phone_change_auth'

const OTP_EXPIRY_MINUTES = 10
const EDIT_SESSION_MINUTES = 15
const CHANGE_AUTH_MINUTES = 15
const OTP_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000
const OTP_RATE_LIMIT_MAX = 5

export type MpesaOtpAction =
  | 'unlock_mpesa_edit'
  | 'register_integration_phone'
  | 'change_integration_phone_step1'
  | 'change_integration_phone_step2'

export type VerifyMpesaOtpResult =
  | { ok: true; editToken?: string; editExpiresAt?: string; changeToken?: string; changeExpiresAt?: string }
  | { ok: false; reason: 'missing_otp' | 'no_otp_doc' | 'bad_otp' | 'expired' | 'unauthorized' | 'invalid_phone' | 'no_integration_phone' | 'change_not_authorized' }

function generateOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000))
}

function generateToken(): string {
  return crypto.randomBytes(32).toString('hex')
}

function findOneAndUpdateResultDoc(r: unknown): Record<string, unknown> | null {
  if (r == null || typeof r !== 'object') return null
  const o = r as Record<string, unknown>
  if ('value' in o && o.value !== undefined && !('_id' in o)) {
    const inner = o.value
    return inner != null && typeof inner === 'object' ? (inner as Record<string, unknown>) : null
  }
  return o
}

/** Mask +254712345678 → +2547****5678 */
export function maskKenyaPhone(phone: string): string {
  const normalized = normalizeKenyaPhone(phone)
  if (!normalized || normalized.length < 8) return '********'
  return `${normalized.slice(0, 5)}****${normalized.slice(-4)}`
}

export function maskMpesaSecret(value: string, visibleEnds = 4): string {
  if (!value) return ''
  if (value.length <= visibleEnds * 2) return '********'
  return `${value.slice(0, visibleEnds)}${'*'.repeat(8)}${value.slice(-visibleEnds)}`
}

export async function getStoredIntegrationPhone(): Promise<string | null> {
  const client = await clientPromise
  const db = client.db(DB_NAME)
  const settings = await db.collection('catha_settings').findOne({})
  const phone = settings?.notifications?.mpesaIntegrationPhone
  if (!phone || typeof phone !== 'string') return null
  return normalizeKenyaPhone(phone)
}

export async function assertOtpRateLimit(requestedBy: string, action: MpesaOtpAction): Promise<void> {
  const client = await clientPromise
  const db = client.db(DB_NAME)
  const since = new Date(Date.now() - OTP_RATE_LIMIT_WINDOW_MS)
  const count = await db.collection(OTP_COLLECTION).countDocuments({
    requestedBy,
    action,
    createdAt: { $gte: since },
  })
  if (count >= OTP_RATE_LIMIT_MAX) {
    throw new Error('Too many OTP requests. Please wait a few minutes and try again.')
  }
}

export async function requestMpesaIntegrationOtp(params: {
  action: MpesaOtpAction
  requestedBy: string
  newPhone?: string
  changeToken?: string
}): Promise<{ maskedDestination?: string }> {
  await assertOtpRateLimit(params.requestedBy, params.action)

  const client = await clientPromise
  const db = client.db(DB_NAME)
  const existingPhone = await getStoredIntegrationPhone()
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000)
  const otp = generateOtp()

  let destinationPhone: string | null = null
  let pendingNewPhone: string | null = null

  switch (params.action) {
    case 'unlock_mpesa_edit': {
      if (!existingPhone) {
        throw new Error('M-Pesa integration number is not configured. Add it in Notifications first.')
      }
      destinationPhone = existingPhone
      break
    }
    case 'register_integration_phone': {
      if (existingPhone) {
        throw new Error('Integration number already configured. Use change flow to update it.')
      }
      const normalized = normalizeKenyaPhone(params.newPhone || '')
      if (!normalized) {
        throw new Error('Enter a valid Kenyan mobile number.')
      }
      destinationPhone = normalized
      pendingNewPhone = normalized
      break
    }
    case 'change_integration_phone_step1': {
      if (!existingPhone) {
        throw new Error('No integration number on file. Register one first.')
      }
      destinationPhone = existingPhone
      break
    }
    case 'change_integration_phone_step2': {
      if (!existingPhone) {
        throw new Error('No integration number on file.')
      }
      const changeToken = String(params.changeToken || '').trim()
      if (!changeToken) {
        throw new Error('Change authorization required. Verify OTP on the current number first.')
      }
      const auth = await db.collection(CHANGE_AUTH_COLLECTION).findOne({
        token: changeToken,
        requestedBy: params.requestedBy,
        used: false,
        expiresAt: { $gt: new Date() },
      })
      if (!auth) {
        throw new Error('Change authorization expired or invalid. Start again from step 1.')
      }
      const normalized = normalizeKenyaPhone(params.newPhone || '')
      if (!normalized) {
        throw new Error('Enter a valid Kenyan mobile number.')
      }
      if (normalized === existingPhone) {
        throw new Error('New number must be different from the current integration number.')
      }
      destinationPhone = normalized
      pendingNewPhone = normalized
      break
    }
    default:
      throw new Error('Invalid OTP action')
  }

  if (!destinationPhone) {
    throw new Error('Could not determine OTP destination.')
  }

  const actionLabel =
    params.action === 'unlock_mpesa_edit'
      ? 'unlock M-Pesa settings'
      : params.action === 'register_integration_phone'
        ? 'register M-Pesa integration number'
        : params.action === 'change_integration_phone_step1'
          ? 'authorize integration number change'
          : 'confirm new M-Pesa integration number'

  const insertResult = await db.collection(OTP_COLLECTION).insertOne({
    action: params.action,
    requestedBy: params.requestedBy,
    otp,
    destinationPhone,
    pendingNewPhone,
    changeToken: params.changeToken || null,
    used: false,
    createdAt: new Date(),
    expiresAt,
  })

  try {
    await sendJabaSmsStrict(
      `Catha ${actionLabel} OTP: ${otp}. Expires in ${OTP_EXPIRY_MINUTES} minutes. Do not share this code.`,
      [destinationPhone]
    )
  } catch (error) {
    // Do not leave a usable OTP if delivery failed — avoids "Invalid OTP" after a silent miss.
    await db.collection(OTP_COLLECTION).deleteOne({ _id: insertResult.insertedId })
    throw error
  }

  return { maskedDestination: maskKenyaPhone(destinationPhone) }
}

export async function verifyMpesaIntegrationOtpResult(params: {
  action: MpesaOtpAction
  requestedBy: string
  otp: string
  newPhone?: string
  changeToken?: string
}): Promise<VerifyMpesaOtpResult> {
  const raw = params.otp.trim()
  const digitsOnly = raw.replace(/\D/g, '')
  const otpTrim = digitsOnly.length === 6 ? digitsOnly : raw
  if (!otpTrim) {
    return { ok: false, reason: 'missing_otp' }
  }

  const client = await clientPromise
  const db = client.db(DB_NAME)
  const now = new Date()

  const r = await db.collection(OTP_COLLECTION).findOneAndUpdate(
    {
      action: params.action,
      requestedBy: params.requestedBy,
      used: false,
      expiresAt: { $gt: now },
      otp: otpTrim,
    },
    { $set: { used: true, usedAt: now } },
    { sort: { createdAt: -1 }, returnDocument: 'before' }
  )

  const matched = findOneAndUpdateResultDoc(r)
  if (!matched) {
    const latest = await db.collection(OTP_COLLECTION).findOne(
      { action: params.action, requestedBy: params.requestedBy },
      { sort: { createdAt: -1 } }
    )
    if (!latest) return { ok: false, reason: 'no_otp_doc' }
    if (latest.used === true) return { ok: false, reason: 'bad_otp' }
    const exp = latest.expiresAt instanceof Date ? latest.expiresAt : new Date(latest.expiresAt)
    if (exp <= now) return { ok: false, reason: 'expired' }
    return { ok: false, reason: 'bad_otp' }
  }

  if (params.action === 'unlock_mpesa_edit') {
    const session = await createMpesaEditSession(params.requestedBy)
    return {
      ok: true,
      editToken: session.token,
      editExpiresAt: session.expiresAt.toISOString(),
    }
  }

  if (params.action === 'register_integration_phone') {
    const normalized = normalizeKenyaPhone(params.newPhone || String(matched.pendingNewPhone || ''))
    if (!normalized) return { ok: false, reason: 'invalid_phone' }
    await saveIntegrationPhone(normalized)
    return { ok: true }
  }

  if (params.action === 'change_integration_phone_step1') {
    const token = generateToken()
    const expiresAt = new Date(Date.now() + CHANGE_AUTH_MINUTES * 60 * 1000)
    await db.collection(CHANGE_AUTH_COLLECTION).insertOne({
      token,
      requestedBy: params.requestedBy,
      used: false,
      createdAt: now,
      expiresAt,
    })
    return {
      ok: true,
      changeToken: token,
      changeExpiresAt: expiresAt.toISOString(),
    }
  }

  if (params.action === 'change_integration_phone_step2') {
    const changeToken = String(params.changeToken || matched.changeToken || '').trim()
    if (!changeToken) return { ok: false, reason: 'change_not_authorized' }

    const authUpdate = await db.collection(CHANGE_AUTH_COLLECTION).findOneAndUpdate(
      {
        token: changeToken,
        requestedBy: params.requestedBy,
        used: false,
        expiresAt: { $gt: now },
      },
      { $set: { used: true, usedAt: now } },
      { returnDocument: 'before' }
    )
    if (!findOneAndUpdateResultDoc(authUpdate)) {
      return { ok: false, reason: 'change_not_authorized' }
    }

    const normalized = normalizeKenyaPhone(params.newPhone || String(matched.pendingNewPhone || ''))
    if (!normalized) return { ok: false, reason: 'invalid_phone' }
    await saveIntegrationPhone(normalized)
    return { ok: true }
  }

  return { ok: false, reason: 'unauthorized' }
}

export async function saveIntegrationPhone(phone: string): Promise<void> {
  const normalized = normalizeKenyaPhone(phone)
  if (!normalized) {
    throw new Error('Invalid phone number')
  }
  const client = await clientPromise
  const db = client.db(DB_NAME)
  await db.collection('catha_settings').updateOne(
    {},
    {
      $set: {
        'notifications.mpesaIntegrationPhone': normalized,
        updatedAt: new Date(),
      },
    },
    { upsert: true }
  )
}

export async function createMpesaEditSession(requestedBy: string): Promise<{ token: string; expiresAt: Date }> {
  const client = await clientPromise
  const db = client.db(DB_NAME)
  const token = generateToken()
  const expiresAt = new Date(Date.now() + EDIT_SESSION_MINUTES * 60 * 1000)

  await db.collection(EDIT_SESSION_COLLECTION).insertOne({
    token,
    requestedBy,
    used: false,
    createdAt: new Date(),
    expiresAt,
  })

  return { token, expiresAt }
}

export async function verifyMpesaEditSession(token: string, requestedBy: string): Promise<boolean> {
  const trimmed = token.trim()
  if (!trimmed) return false

  const client = await clientPromise
  const db = client.db(DB_NAME)
  const now = new Date()

  const session = await db.collection(EDIT_SESSION_COLLECTION).findOne({
    token: trimmed,
    requestedBy,
    used: false,
    expiresAt: { $gt: now },
  })

  return !!session
}

export function sanitizeMpesaSettingsForClient(mpesa: Record<string, unknown> | undefined | null) {
  if (!mpesa) return mpesa
  const consumerKey = String(mpesa.consumerKey || '')
  const consumerSecret = String(mpesa.consumerSecret || '')
  const passkey = String(mpesa.passkey || '')
  const shortcode = String(mpesa.shortcode || '')
  const credentialsConfigured = !!(consumerKey && consumerSecret && passkey && shortcode)

  return {
    enabled: Boolean(mpesa.enabled),
    environment: mpesa.environment === 'production' ? 'production' : 'sandbox',
    consumerKey: consumerKey ? maskMpesaSecret(consumerKey) : '',
    consumerSecret: consumerSecret ? '********' : '',
    passkey: passkey ? '********' : '',
    shortcode: shortcode ? maskMpesaSecret(shortcode, 2) : '',
    confirmationUrl: String(mpesa.confirmationUrl || ''),
    validationUrl: String(mpesa.validationUrl || ''),
    callbackUrl: String(mpesa.callbackUrl || ''),
    credentialsConfigured,
  }
}

export function sanitizeNotificationsForClient(notifications: Record<string, unknown> | undefined | null) {
  if (!notifications) return notifications
  const phone = notifications.mpesaIntegrationPhone
  const configured = typeof phone === 'string' && !!normalizeKenyaPhone(phone)
  const { mpesaIntegrationPhone: _removed, ...rest } = notifications
  return {
    ...rest,
    mpesaIntegrationPhoneConfigured: configured,
    mpesaIntegrationPhoneMasked: configured ? maskKenyaPhone(String(phone)) : null,
  }
}
