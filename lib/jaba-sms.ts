import clientPromise from '@/lib/mongodb'
import { normalizePhoneNumbers } from '@/lib/phone-normalize'
import { normalizeKenyaPhone } from '@/lib/phone-utils'
import { resolveSmsGatewayConfig } from '@/lib/sms-gateway-settings'

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

async function isSmsConfigured(): Promise<boolean> {
  const cfg = await resolveSmsGatewayConfig()
  return cfg.configured
}

/** Zettatel requires country code without leading +. Example: 2547XXXXXXXX */
export function toZettatelMobile(phone: string): string {
  const kenya = normalizeKenyaPhone(phone)
  if (kenya) return kenya.replace(/\D/g, '')

  const digits = String(phone || '').replace(/\D/g, '')
  // Local 07… / 01… that somehow skipped Kenya normalize
  if (/^0[17]\d{8}$/.test(digits)) return `254${digits.slice(1)}`
  return digits
}

function formatZettatelMobiles(numbers: string[]): string[] {
  return [...new Set(numbers.map(toZettatelMobile).filter((n) => n.length >= 10 && n.length <= 15))]
}

function humanizeZettatelReason(reason: string): string {
  const r = String(reason || '').trim()
  const lower = r.toLowerCase()
  if (lower.includes('invalid login') || lower.includes('invalid credentials') || lower === '401') {
    return (
      'Invalid Login — check Settings → SMS (User ID + Password) OR API Key only (not both mismatched). ' +
      'Also confirm Sender ID is approved.'
    )
  }
  if (lower.includes('invalid_mobile') || lower.includes('invalid mobile')) {
    return `Invalid mobile number for Zettatel (${r}). Use a Kenyan mobile like 07XXXXXXXX / +2547XXXXXXXX.`
  }
  if (lower.includes('sender') && lower.includes('invalid')) {
    return `Invalid Sender ID — use the exact approved sender from your Zettatel portal (${r}).`
  }
  return r
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
      reason.toLowerCase() === 'success' ||
      // Some accounts return a transaction id with an empty/odd status wrapper.
      Boolean(transactionId && !status.includes('error') && !status.includes('fail'))

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

function isZettatelAuthFailure(reasonOrBody: string): boolean {
  const lower = String(reasonOrBody || '').toLowerCase()
  return (
    lower.includes('invalid login') ||
    lower.includes('invalid credentials') ||
    lower.includes('authentication') ||
    lower.includes('"code":"401"') ||
    lower.includes('"statuscode":"401"')
  )
}

async function deliverJabaSms(
  message: string,
  numbers: string[],
  options?: { allowDuplicateCheck?: boolean }
): Promise<{ transactionId?: string }> {
  const mobiles = formatZettatelMobiles(numbers)
  if (mobiles.length === 0) {
    throw new Error('Cannot send SMS: no valid gateway mobile numbers')
  }

  const cfg = await resolveSmsGatewayConfig()
  if (!cfg.configured) {
    throw new Error(
      'SMS gateway is not configured. Fill Settings → SMS Gateway (or set ZETTATEL_* env vars).'
    )
  }

  const hasUserPass = Boolean(cfg.userId && cfg.password)
  const hasApiKey = Boolean(cfg.apiKey)
  // Zettatel: use userId+password OR apiKey — never both in one request.
  // If the first mode gets Invalid Login, retry the other when available.
  const modes: Array<'userpass' | 'apikey'> = []
  if (cfg.preferApiKey && hasApiKey) {
    modes.push('apikey')
    if (hasUserPass) modes.push('userpass')
  } else {
    if (hasUserPass) modes.push('userpass')
    if (hasApiKey) modes.push('apikey')
  }
  if (modes.length === 0) {
    throw new Error(
      'SMS gateway auth incomplete. Set User ID + Password, or API Key (Settings → SMS / ZETTATEL_*).'
    )
  }

  const endpoint = cfg.apiUrl || 'https://portal.zettatel.com/SMSApi/send'
  const timeoutMs = Math.max(5_000, Math.min(25_000, Number(process.env.ZETTATEL_TIMEOUT_MS) || 20_000))
  let lastError: Error | null = null

  for (let i = 0; i < modes.length; i++) {
    const authMode = modes[i]!
    const payload = new URLSearchParams({
      sendMethod: 'quick',
      mobile: mobiles.join(','),
      msg: message,
      senderid: cfg.senderId,
      msgType: cfg.msgType || 'text',
      duplicatecheck: options?.allowDuplicateCheck === true ? 'true' : 'false',
      output: 'json',
    })
    if (authMode === 'userpass') {
      payload.set('userid', cfg.userId)
      payload.set('password', cfg.password)
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
    }
    if (authMode === 'apikey') {
      headers.apikey = cfg.apiKey
    }

    console.log('[Jaba SMS] Sending request', {
      endpoint,
      recipients: mobiles,
      recipientCount: mobiles.length,
      senderId: cfg.senderId,
      msgType: cfg.msgType || 'text',
      authMode,
      attempt: i + 1,
      attemptsTotal: modes.length,
      duplicatecheck: payload.get('duplicatecheck'),
    })

    const controller = new AbortController()
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
      clearTimeout(timeout)
      if (error?.name === 'AbortError') {
        lastError = new Error(`Zettatel timed out after ${timeoutMs}ms`)
      } else {
        lastError = error instanceof Error ? error : new Error(String(error))
      }
      continue
    } finally {
      clearTimeout(timeout)
    }

    console.log('[Jaba SMS] Provider response', {
      status: res.status,
      ok: res.ok,
      authMode,
      body: text,
    })

    if (!res.ok) {
      lastError = new Error(`Zettatel failed: ${res.status} ${text}`)
      if (isZettatelAuthFailure(text) && i < modes.length - 1) {
        console.warn('[Jaba SMS] Auth rejected — retrying with alternate credentials')
        continue
      }
      throw lastError
    }

    const parsed = parseZettatelResponse(text)
    if (!parsed.ok) {
      lastError = new Error(`Zettatel rejected SMS: ${humanizeZettatelReason(parsed.reason)}`)
      if (isZettatelAuthFailure(parsed.reason) && i < modes.length - 1) {
        console.warn('[Jaba SMS] Auth rejected — retrying with alternate credentials')
        continue
      }
      throw lastError
    }
    return { transactionId: parsed.transactionId }
  }

  throw lastError || new Error('Zettatel SMS send failed')
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
  if (!(await isSmsConfigured())) {
    console.error(
      '[Jaba SMS] Skipped: missing gateway config. Fill Settings → SMS Gateway or ZETTATEL_* env vars.'
    )
    return
  }

  await deliverJabaSms(message, numbers)
}

/** Use for security-sensitive flows (e.g. delete OTP) so failures surface instead of succeeding silently. */
export async function sendJabaSmsStrict(
  message: string,
  numbers: string[],
  options?: { allowDuplicateCheck?: boolean }
): Promise<{ transactionId?: string }> {
  if (!message.trim()) {
    throw new Error('Cannot send SMS: empty message')
  }
  if (numbers.length === 0) {
    throw new Error('Cannot send SMS: no recipient numbers')
  }
  if (!(await isSmsConfigured())) {
    throw new Error(
      'SMS gateway is not configured. Fill Settings → SMS Gateway (or set ZETTATEL_* env vars).'
    )
  }
  return deliverJabaSms(message, numbers, options)
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
    await sendJabaSmsStrict(message, settings.numbers)
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
