import clientPromise from '@/lib/mongodb'

const DB_NAME = 'infusion_jaba'
const COLLECTION = 'sms_gateway_settings'
const DOC_ID = 'default'
export const SMS_SECRET_MASK = '********'

export type SmsGatewaySettings = {
  userId: string
  password: string
  apiKey: string
  senderId: string
  apiUrl: string
  msgType: string
  /** Admin OTP destination(s) for Jaba destructive actions (comma-separated). Overrides OT_NUMBER env when set. */
  adminOtpPhones: string
  updatedAt?: Date
  updatedBy?: string
}

export type SmsGatewaySettingsPublic = {
  userId: string
  password: string
  passwordConfigured: boolean
  apiKey: string
  apiKeyConfigured: boolean
  senderId: string
  apiUrl: string
  msgType: string
  adminOtpPhones: string
  /** True when enough credentials exist (settings and/or env) to send. */
  configured: boolean
  /** Which fields are currently coming from env fallback (not filled in settings). */
  usingEnvFallback: {
    userId: boolean
    password: boolean
    apiKey: boolean
    senderId: boolean
    apiUrl: boolean
    msgType: boolean
    adminOtpPhones: boolean
  }
  updatedAt?: string | null
}

export type ResolvedSmsGatewayConfig = {
  userId: string
  password: string
  apiKey: string
  senderId: string
  apiUrl: string
  msgType: string
  adminOtpPhones: string
  configured: boolean
  /** When true, try API key auth before user/password. */
  preferApiKey?: boolean
}

const DEFAULTS: SmsGatewaySettings = {
  userId: '',
  password: '',
  apiKey: '',
  senderId: '',
  apiUrl: '',
  msgType: 'text',
  adminOtpPhones: '',
}

function trimStr(v: unknown): string {
  return String(v ?? '').trim()
}

function env(name: string): string {
  return trimStr(process.env[name])
}

function maskSecret(value: string): string {
  const v = trimStr(value)
  if (!v) return ''
  if (v.length <= 4) return SMS_SECRET_MASK
  return `${SMS_SECRET_MASK}${v.slice(-4)}`
}

function isMaskedSecret(value: unknown): boolean {
  const v = trimStr(value)
  return !v || v === SMS_SECRET_MASK || v.includes('********')
}

export async function getSmsGatewaySettings(): Promise<SmsGatewaySettings> {
  const client = await clientPromise
  const doc = await client.db(DB_NAME).collection(COLLECTION).findOne({ _id: DOC_ID as any })
  if (!doc) return { ...DEFAULTS }
  return {
    userId: trimStr(doc.userId),
    password: trimStr(doc.password),
    apiKey: trimStr(doc.apiKey),
    senderId: trimStr(doc.senderId),
    apiUrl: trimStr(doc.apiUrl),
    msgType: trimStr(doc.msgType) || 'text',
    adminOtpPhones: trimStr(doc.adminOtpPhones),
    updatedAt: doc.updatedAt instanceof Date ? doc.updatedAt : undefined,
    updatedBy: doc.updatedBy ? String(doc.updatedBy) : undefined,
  }
}

/**
 * Collect gateway credentials without mixing a half settings pair with env.
 * Both user/password and apiKey may be present so deliver can retry auth modes.
 */
export async function resolveSmsGatewayConfig(): Promise<ResolvedSmsGatewayConfig> {
  const stored = await getSmsGatewaySettings()
  const envUserId = env('ZETTATEL_USER_ID')
  const envPassword = env('ZETTATEL_PASSWORD')
  const envApiKey = env('ZETTATEL_API_KEY')

  let userId = ''
  let password = ''
  if (stored.userId && stored.password) {
    userId = stored.userId
    password = stored.password
  } else if (envUserId && envPassword) {
    userId = envUserId
    password = envPassword
  } else {
    userId = stored.userId || envUserId
    password = stored.password || envPassword
  }

  const apiKey = stored.apiKey || envApiKey
  const senderId = stored.senderId || env('ZETTATEL_SENDER_ID')
  const apiUrl = stored.apiUrl || env('ZETTATEL_API_URL') || 'https://portal.zettatel.com/SMSApi/send'
  const msgType = stored.msgType || env('ZETTATEL_MSG_TYPE') || 'text'
  const adminOtpPhones = stored.adminOtpPhones || env('OT_NUMBER')

  const hasUserPass = Boolean(userId && password)
  const configured = Boolean(senderId && (hasUserPass || apiKey))

  return {
    userId,
    password,
    apiKey,
    senderId,
    apiUrl,
    msgType,
    adminOtpPhones,
    configured,
    /** Prefer API key when settings explicitly saved one without a full user/pass pair. */
    preferApiKey: Boolean(stored.apiKey && !(stored.userId && stored.password)),
  }
}

export async function getSmsGatewaySettingsForClient(): Promise<SmsGatewaySettingsPublic> {
  const stored = await getSmsGatewaySettings()
  const resolved = await resolveSmsGatewayConfig()

  return {
    userId: stored.userId,
    password: stored.password ? maskSecret(stored.password) : '',
    passwordConfigured: Boolean(stored.password || env('ZETTATEL_PASSWORD')),
    apiKey: stored.apiKey ? maskSecret(stored.apiKey) : '',
    apiKeyConfigured: Boolean(stored.apiKey || env('ZETTATEL_API_KEY')),
    senderId: stored.senderId,
    apiUrl: stored.apiUrl,
    msgType: stored.msgType || 'text',
    adminOtpPhones: stored.adminOtpPhones,
    configured: resolved.configured,
    usingEnvFallback: {
      userId: !stored.userId && Boolean(env('ZETTATEL_USER_ID')),
      password: !stored.password && Boolean(env('ZETTATEL_PASSWORD')),
      apiKey: !stored.apiKey && Boolean(env('ZETTATEL_API_KEY')),
      senderId: !stored.senderId && Boolean(env('ZETTATEL_SENDER_ID')),
      apiUrl: !stored.apiUrl && Boolean(env('ZETTATEL_API_URL')),
      msgType: !stored.msgType && Boolean(env('ZETTATEL_MSG_TYPE')),
      adminOtpPhones: !stored.adminOtpPhones && Boolean(env('OT_NUMBER')),
    },
    updatedAt: stored.updatedAt ? stored.updatedAt.toISOString() : null,
  }
}

export async function saveSmsGatewaySettings(
  incoming: Partial<SmsGatewaySettings> & { updatedBy?: string }
): Promise<SmsGatewaySettingsPublic> {
  const existing = await getSmsGatewaySettings()
  const next: SmsGatewaySettings = {
    userId: Object.prototype.hasOwnProperty.call(incoming, 'userId')
      ? trimStr(incoming.userId)
      : existing.userId,
    password: existing.password,
    apiKey: existing.apiKey,
    senderId: Object.prototype.hasOwnProperty.call(incoming, 'senderId')
      ? trimStr(incoming.senderId)
      : existing.senderId,
    apiUrl: Object.prototype.hasOwnProperty.call(incoming, 'apiUrl')
      ? trimStr(incoming.apiUrl)
      : existing.apiUrl,
    msgType: Object.prototype.hasOwnProperty.call(incoming, 'msgType')
      ? trimStr(incoming.msgType) || 'text'
      : existing.msgType || 'text',
    adminOtpPhones: Object.prototype.hasOwnProperty.call(incoming, 'adminOtpPhones')
      ? trimStr(incoming.adminOtpPhones)
      : existing.adminOtpPhones,
    updatedAt: new Date(),
    updatedBy: incoming.updatedBy,
  }

  // Empty / masked secrets mean "keep current" — never wipe on accidental blank save.
  if (Object.prototype.hasOwnProperty.call(incoming, 'password')) {
    const raw = trimStr(incoming.password)
    if (raw && !isMaskedSecret(raw)) next.password = raw
  }
  if (Object.prototype.hasOwnProperty.call(incoming, 'apiKey')) {
    const raw = trimStr(incoming.apiKey)
    if (raw && !isMaskedSecret(raw)) next.apiKey = raw
  }

  const client = await clientPromise
  await client.db(DB_NAME).collection(COLLECTION).updateOne(
    { _id: DOC_ID as any },
    { $set: next },
    { upsert: true }
  )

  return getSmsGatewaySettingsForClient()
}
