import clientPromise from '@/lib/mongodb'
import { normalizePhoneNumbers } from '@/lib/phone-normalize'

export { normalizePhoneNumbers } from '@/lib/phone-normalize'
const SETTINGS_COLLECTION = 'jaba_settings'
const SETTINGS_ID = 'sms_notifications'

export interface JabaSmsEventSettings {
  batchCreated: boolean
  packagingCreated: boolean
  distributionCreated: boolean
  distributionDelivered: boolean
}

export interface JabaSmsSettings {
  enabled: boolean
  numbers: string[]
  events: JabaSmsEventSettings
  updatedAt: Date
  updatedBy?: string
}

export const DEFAULT_JABA_SMS_SETTINGS: JabaSmsSettings = {
  enabled: false,
  numbers: [],
  events: {
    batchCreated: true,
    packagingCreated: true,
    distributionCreated: true,
    distributionDelivered: false,
  },
  updatedAt: new Date(),
}

const DB_NAME = 'infusion_jaba'

export async function getJabaSmsSettings(): Promise<JabaSmsSettings> {
  const client = await clientPromise
  const db = client.db(DB_NAME)
  const doc = await db.collection(SETTINGS_COLLECTION).findOne({ _id: SETTINGS_ID })
  if (!doc) {
    return { ...DEFAULT_JABA_SMS_SETTINGS }
  }
  const ev = doc.events ?? {}
  const defEv = DEFAULT_JABA_SMS_SETTINGS.events
  return {
    enabled: Boolean(doc.enabled),
    numbers: normalizePhoneNumbers(doc.numbers ?? []),
    events: {
      batchCreated: ev.batchCreated !== undefined ? Boolean(ev.batchCreated) : defEv.batchCreated,
      packagingCreated:
        ev.packagingCreated !== undefined ? Boolean(ev.packagingCreated) : defEv.packagingCreated,
      distributionCreated:
        ev.distributionCreated !== undefined ? Boolean(ev.distributionCreated) : defEv.distributionCreated,
      distributionDelivered:
        ev.distributionDelivered !== undefined ? Boolean(ev.distributionDelivered) : defEv.distributionDelivered,
    },
    updatedAt: doc.updatedAt instanceof Date ? doc.updatedAt : new Date(),
    updatedBy: doc.updatedBy ? String(doc.updatedBy) : undefined,
  }
}

export async function saveJabaSmsSettings(settings: Partial<JabaSmsSettings> & { updatedBy?: string }) {
  const current = await getJabaSmsSettings()
  const next: JabaSmsSettings = {
    enabled: settings.enabled ?? current.enabled,
    numbers: normalizePhoneNumbers(settings.numbers ?? current.numbers),
    events: {
      batchCreated: settings.events?.batchCreated ?? current.events.batchCreated,
      packagingCreated: settings.events?.packagingCreated ?? current.events.packagingCreated,
      distributionCreated: settings.events?.distributionCreated ?? current.events.distributionCreated,
      distributionDelivered: settings.events?.distributionDelivered ?? current.events.distributionDelivered,
    },
    updatedAt: new Date(),
    updatedBy: settings.updatedBy,
  }

  const client = await clientPromise
  const db = client.db(DB_NAME)
  await db.collection(SETTINGS_COLLECTION).updateOne(
    { _id: SETTINGS_ID },
    { $set: next },
    { upsert: true }
  )
  return next
}

function isSmsConfigured(): boolean {
  return Boolean(
    process.env.ZETTATEL_USER_ID &&
      process.env.ZETTATEL_PASSWORD &&
      process.env.ZETTATEL_SENDER_ID
  )
}

/** Zettatel requires country code without leading +. Example: 2547XXXXXXXX */
export function toZettatelMobile(phone: string): string {
  const digits = String(phone || '').replace(/\D/g, '')
  return digits
}

function formatZettatelMobiles(numbers: string[]): string[] {
  return [...new Set(numbers.map(toZettatelMobile).filter((n) => n.length >= 9))]
}

function parseZettatelResponse(text: string): {
  ok: boolean
  reason: string
  transactionId?: string
  invalidMobile?: string
} {
  const trimmed = String(text || '').trim()
  if (!trimmed) return { ok: false, reason: 'empty_provider_response' }

  try {
    const json = JSON.parse(trimmed) as Record<string, unknown>
    const nested = (json.response && typeof json.response === 'object'
      ? (json.response as Record<string, unknown>)
      : null) as Record<string, unknown> | null
    const status = String(json.status ?? nested?.status ?? '').toLowerCase()
    const statusCode = String(json.statusCode ?? nested?.code ?? nested?.statusCode ?? '')
    const reason = String(
      json.reason ?? nested?.msg ?? nested?.reason ?? (status || 'unknown')
    )
    const transactionId = String(json.transactionId ?? nested?.transactionId ?? '').trim() || undefined
    const invalidMobile = String(json.invalidMobile ?? '').trim() || undefined

    const success =
      status === 'success' ||
      statusCode === '200' ||
      reason.toLowerCase() === 'success'

    if (!success) {
      return {
        ok: false,
        reason: invalidMobile
          ? `invalid_mobile:${invalidMobile}; ${reason}`
          : reason || `provider_status:${status || statusCode || 'error'}`,
        transactionId,
        invalidMobile,
      }
    }
    if (invalidMobile) {
      return {
        ok: false,
        reason: `invalid_mobile:${invalidMobile}`,
        transactionId,
        invalidMobile,
      }
    }
    return { ok: true, reason: 'success', transactionId }
  } catch {
    // Plain-text success responses still appear in older accounts.
    const lower = trimmed.toLowerCase()
    if (lower.includes('success') && !lower.includes('error') && !lower.includes('fail')) {
      return { ok: true, reason: 'success' }
    }
    return { ok: false, reason: `unrecognized_provider_response:${trimmed.slice(0, 180)}` }
  }
}

async function deliverJabaSms(message: string, numbers: string[]): Promise<{ transactionId?: string }> {
  const mobiles = formatZettatelMobiles(numbers)
  if (mobiles.length === 0) {
    throw new Error('Cannot send SMS: no valid gateway mobile numbers')
  }

  const endpoint = process.env.ZETTATEL_API_URL || 'https://portal.zettatel.com/SMSApi/send'
  const payload = new URLSearchParams({
    // Zettatel expects lowercase `userid` parameter.
    userid: process.env.ZETTATEL_USER_ID || '',
    // Keep camelCase variant as compatibility fallback.
    userId: process.env.ZETTATEL_USER_ID || '',
    password: process.env.ZETTATEL_PASSWORD || '',
    sendMethod: 'quick',
    mobile: mobiles.join(','),
    msg: message,
    senderid: process.env.ZETTATEL_SENDER_ID || '',
    msgType: process.env.ZETTATEL_MSG_TYPE || 'text',
    duplicatecheck: 'true',
    output: 'json',
  })

  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
  }
  if (process.env.ZETTATEL_API_KEY) {
    headers.apikey = process.env.ZETTATEL_API_KEY
  }

  console.log('[Jaba SMS] Sending request', {
    endpoint,
    recipients: mobiles,
    recipientCount: mobiles.length,
    senderId: process.env.ZETTATEL_SENDER_ID,
    msgType: process.env.ZETTATEL_MSG_TYPE || 'text',
    hasApiKey: Boolean(process.env.ZETTATEL_API_KEY),
  })

  const controller = new AbortController()
  const timeoutMs = Math.max(5_000, Math.min(25_000, Number(process.env.ZETTATEL_TIMEOUT_MS) || 20_000))
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  let res: Response
  let text: string
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: payload.toString(),
      signal: controller.signal,
    })
    text = await res.text()
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      throw new Error(`Zettatel timed out after ${timeoutMs}ms`)
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }

  console.log('[Jaba SMS] Provider response', {
    status: res.status,
    ok: res.ok,
    body: text,
  })

  if (!res.ok) {
    throw new Error(`Zettatel failed: ${res.status} ${text}`)
  }

  const parsed = parseZettatelResponse(text)
  if (!parsed.ok) {
    throw new Error(`Zettatel rejected SMS: ${parsed.reason}`)
  }
  return { transactionId: parsed.transactionId }
}

export async function sendJabaSms(message: string, numbers: string[]) {
  if (!message.trim()) {
    console.warn('[Jaba SMS] Skipped: empty message')
    return
  }
  if (numbers.length === 0) {
    console.warn('[Jaba SMS] Skipped: no recipient numbers')
    return
  }
  if (!isSmsConfigured()) {
    console.error(
      '[Jaba SMS] Skipped: missing env config. Required ZETTATEL_USER_ID, ZETTATEL_PASSWORD, ZETTATEL_SENDER_ID'
    )
    return
  }

  await deliverJabaSms(message, numbers)
}

/** Use for security-sensitive flows (e.g. delete OTP) so failures surface instead of succeeding silently. */
export async function sendJabaSmsStrict(
  message: string,
  numbers: string[]
): Promise<{ transactionId?: string }> {
  if (!message.trim()) {
    throw new Error('Cannot send SMS: empty message')
  }
  if (numbers.length === 0) {
    throw new Error('Cannot send SMS: no recipient numbers')
  }
  if (!isSmsConfigured()) {
    throw new Error(
      'SMS gateway is not configured. Set ZETTATEL_USER_ID, ZETTATEL_PASSWORD, and ZETTATEL_SENDER_ID in the environment.'
    )
  }
  return deliverJabaSms(message, numbers)
}

export async function sendJabaSmsForEvent(event: keyof JabaSmsEventSettings, message: string) {
  try {
    const settings = await getJabaSmsSettings()
    if (!settings.enabled) {
      console.log(`[Jaba SMS] Event "${event}" skipped: notifications disabled`)
      return
    }
    if (!settings.events[event]) {
      console.log(`[Jaba SMS] Event "${event}" skipped: toggle disabled`)
      return
    }
    console.log(`[Jaba SMS] Event "${event}" sending to ${settings.numbers.length} recipients`)
    await sendJabaSms(message, settings.numbers)
  } catch (error) {
    console.error(`[Jaba SMS] Failed to send ${event} SMS:`, error)
  }
}

// --- Summarized transactional SMS bodies (packaging / distribution) ---

const SMS_SOFT_MAX = 680

function clipSms(text: string): string {
  const t = text.trim()
  if (t.length <= SMS_SOFT_MAX) return t
  return `${t.slice(0, SMS_SOFT_MAX - 3)}...`
}

type SizeAgg = { bottles: number; litres: number }

function emptyAgg(): SizeAgg {
  return { bottles: 0, litres: 0 }
}

function fmtSmsBottles(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0'
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, '')
}

function fmtSmsLitres(l: number): string {
  if (!Number.isFinite(l) || l <= 0) return '0'
  return Number.isInteger(l) ? String(l) : l.toFixed(2).replace(/\.?0+$/, '')
}

/** Aggregate bottle counts and litres by standard pack sizes (matches packaging API logic). */
export function aggregatePackagingContainers(
  containers: Array<{ quantity?: unknown; size?: string; customSize?: unknown }>
): {
  '250ml': SizeAgg
  '500ml': SizeAgg
  '750ml': SizeAgg
  '1L': SizeAgg
  '2L': SizeAgg
  extraLines: string[]
} {
  const out = {
    '250ml': emptyAgg(),
    '500ml': emptyAgg(),
    '750ml': emptyAgg(),
    '1L': emptyAgg(),
    '2L': emptyAgg(),
    extraLines: [] as string[],
  }

  for (const c of containers || []) {
    const qty = Math.max(0, parseFloat(String((c as { quantity?: unknown }).quantity ?? '0')) || 0)
    if (qty <= 0) continue
    const size = String(c.size || '').trim()

    if (size === '250ml') {
      out['250ml'].bottles += qty
      out['250ml'].litres += qty * 0.25
    } else if (size === '500ml') {
      out['500ml'].bottles += qty
      out['500ml'].litres += qty * 0.5
    } else if (size === '750ml') {
      out['750ml'].bottles += qty
      out['750ml'].litres += qty * 0.75
    } else if (size === '1L') {
      out['1L'].bottles += qty
      out['1L'].litres += qty * 1
    } else if (size === '2L') {
      out['2L'].bottles += qty
      out['2L'].litres += qty * 2
    } else if (size === 'custom') {
      const ml = parseFloat(String(c.customSize ?? '0')) || 0
      const litres = (qty * ml) / 1000
      if (Math.abs(ml - 250) < 0.01) {
        out['250ml'].bottles += qty
        out['250ml'].litres += litres
      } else if (Math.abs(ml - 500) < 0.01) {
        out['500ml'].bottles += qty
        out['500ml'].litres += litres
      } else if (Math.abs(ml - 750) < 0.01) {
        out['750ml'].bottles += qty
        out['750ml'].litres += litres
      } else if (Math.abs(ml - 1000) < 0.01) {
        out['1L'].bottles += qty
        out['1L'].litres += litres
      } else if (Math.abs(ml - 2000) < 0.01) {
        out['2L'].bottles += qty
        out['2L'].litres += litres
      } else {
        const label = ml > 0 ? `${ml}ml` : 'Custom'
        out.extraLines.push(
          `${label}: ${fmtSmsBottles(qty)} bottles | Total: ${fmtSmsLitres(litres)} L`
        )
      }
    } else if (size) {
      out.extraLines.push(`${size}: ${fmtSmsBottles(qty)} bottles`)
    }
  }

  return out
}

function packagingTemplateLine(label: string, agg: SizeAgg): string {
  return `${label}: ${fmtSmsBottles(agg.bottles)} bottles | Total: ${fmtSmsLitres(agg.litres)} L`
}

/**
 * Packaging complete SMS (fixed template).
 * Optional product / flavour line when provided.
 */
export function buildPackagingSmsBody(opts: {
  batchNumber: string
  containers: Array<{ quantity?: unknown; size?: string; customSize?: unknown }>
  flavourLabel?: string
}): string {
  const batch = String(opts.batchNumber || '').trim()
  const agg = aggregatePackagingContainers(opts.containers || [])

  const lines: string[] = [
    'PACKAGING COMPLETE',
    '',
    `Batch No: ${batch || 'N/A'}`,
    '',
    packagingTemplateLine('250ml', agg['250ml']),
    packagingTemplateLine('500ml', agg['500ml']),
    packagingTemplateLine('750ml', agg['750ml']),
    packagingTemplateLine('1L', agg['1L']),
  ]

  if (agg['2L'].bottles > 0 || agg['2L'].litres > 0) {
    lines.push(packagingTemplateLine('2L', agg['2L']))
  }
  for (const el of agg.extraLines) {
    lines.push(el)
  }

  const flavour = String(opts.flavourLabel || '').trim()
  if (flavour && flavour.toLowerCase() !== 'batch') {
    lines.push('')
    lines.push(`Product: ${flavour}`)
  }

  return clipSms(lines.join('\n'))
}

export type DistributionSmsItem = {
  productName?: string
  flavor?: string
  size?: string
  quantity?: number
  batchNumber?: string
}

function formatDistributionItemLine(item: DistributionSmsItem): string {
  const name = [item.flavor, item.productName].find((s) => String(s || '').trim()) || 'Item'
  const size = String(item.size || '').trim()
  const label = size ? `${String(name).trim()} ${size}` : String(name).trim()
  const batch = item.batchNumber?.trim()
  const qty = Number(item.quantity) || 0
  const q = Number.isInteger(qty) ? String(qty) : qty.toFixed(2).replace(/\.?0+$/, '')
  return batch ? `${label} (${batch}): ${q}` : `${label}: ${q}`
}

/** New delivery note (structured, same spirit as packaging SMS). */
export function buildDistributionCreatedSmsBody(opts: {
  noteId: string
  distributorName: string
  items: DistributionSmsItem[]
  dispatchedBy: string
  driver?: string
  driverPhone?: string
  vehicle?: string
}): string {
  const lines: string[] = [
    'DISTRIBUTION DISPATCHED',
    '',
    `Note: ${opts.noteId.trim()}`,
    `To: ${opts.distributorName.trim()}`,
    `Sent by: ${opts.dispatchedBy.trim()}`,
  ]
  const driver = opts.driver?.trim()
  const phone = opts.driverPhone?.trim()
  if (driver) {
    lines.push(`Driver: ${driver}${phone ? ` (${phone})` : ''}`)
  }
  if (opts.vehicle?.trim()) {
    lines.push(`Vehicle: ${opts.vehicle.trim()}`)
  }
  const items = opts.items || []
  lines.push('')
  lines.push('Items:')
  if (items.length === 0) {
    lines.push('(none)')
  } else {
    const maxItems = 8
    for (let i = 0; i < Math.min(items.length, maxItems); i++) {
      lines.push(formatDistributionItemLine(items[i]!))
    }
    if (items.length > maxItems) {
      lines.push(`+${items.length - maxItems} more`)
    }
  }
  return clipSms(lines.join('\n'))
}

/** SMS to distributor / client with link to the public delivery note page. */
export function buildClientDeliveryNoteSms(opts: {
  noteId: string
  distributorName: string
  viewUrl: string
}): string {
  const name = opts.distributorName.trim() || 'there'
  const id = opts.noteId.trim()
  const url = opts.viewUrl.trim()
  const line = `Hi ${name}, your delivery note ${id} is ready. Open here: ${url}`
  return clipSms(line)
}

/** Delivery marked complete (structured). */
export function buildDistributionDeliveredSmsBody(opts: {
  noteId: string
  distributorName: string
  items: DistributionSmsItem[]
  markedBy: string
  driver?: string
  driverPhone?: string
}): string {
  const lines: string[] = [
    'DISTRIBUTION DELIVERED',
    '',
    `Note: ${opts.noteId.trim()}`,
    `To: ${opts.distributorName.trim()}`,
    `Confirmed by: ${opts.markedBy.trim()}`,
  ]
  const driver = opts.driver?.trim()
  const phone = opts.driverPhone?.trim()
  if (driver) {
    lines.push(`Driver: ${driver}${phone ? ` (${phone})` : ''}`)
  }
  const items = opts.items || []
  lines.push('')
  lines.push('Items:')
  if (items.length === 0) {
    lines.push('(none)')
  } else {
    const maxItems = 8
    for (let i = 0; i < Math.min(items.length, maxItems); i++) {
      lines.push(formatDistributionItemLine(items[i]!))
    }
    if (items.length > maxItems) {
      lines.push(`+${items.length - maxItems} more`)
    }
  }
  return clipSms(lines.join('\n'))
}
