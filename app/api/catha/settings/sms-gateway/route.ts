import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth-catha'
import { normalizePermissions, hasCathaPermission } from '@/lib/catha-permissions-model'
import {
  getSmsGatewaySettingsForClient,
  saveSmsGatewaySettings,
} from '@/lib/sms-gateway-settings'
import { sendJabaSmsStrict } from '@/lib/jaba-sms'
import { normalizePhoneNumbers } from '@/lib/phone-normalize'

function requireSettingsEdit() {
  return async () => {
    const session = await auth()
    if (!session?.user?.email) {
      return { ok: false as const, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
    }
    const role = ((session.user as any).role ?? '').toUpperCase()
    const perms = normalizePermissions((session.user as any).permissions)
    if (role !== 'SUPER_ADMIN' && !hasCathaPermission(perms, 'settings', 'edit')) {
      return { ok: false as const, response: NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 }) }
    }
    return { ok: true as const, session }
  }
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const role = ((session.user as any).role ?? '').toUpperCase()
  const perms = normalizePermissions((session.user as any).permissions)
  if (role !== 'SUPER_ADMIN' && !hasCathaPermission(perms, 'settings', 'view')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  try {
    const settings = await getSmsGatewaySettingsForClient()
    return NextResponse.json({ success: true, settings })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to load SMS gateway settings' },
      { status: 500 }
    )
  }
}

export async function PUT(request: Request) {
  const gate = await requireSettingsEdit()()
  if (!gate.ok) return gate.response
  try {
    const body = await request.json().catch(() => ({}))
    const settings = await saveSmsGatewaySettings({
      userId: body.userId,
      password: body.password,
      apiKey: body.apiKey,
      senderId: body.senderId,
      apiUrl: body.apiUrl,
      msgType: body.msgType,
      adminOtpPhones: body.adminOtpPhones,
      updatedBy: gate.session.user?.email || undefined,
    })
    return NextResponse.json({ success: true, settings })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to save SMS gateway settings' },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  const gate = await requireSettingsEdit()()
  if (!gate.ok) return gate.response
  try {
    const body = await request.json().catch(() => ({}))
    const action = String(body.action || 'test').toLowerCase()
    if (action !== 'test') {
      return NextResponse.json({ success: false, error: 'Unknown action' }, { status: 400 })
    }
    const phones = normalizePhoneNumbers(body.phone || body.phones || '')
    if (!phones.length) {
      return NextResponse.json(
        { success: false, error: 'Provide a valid test phone number (+254…)' },
        { status: 400 }
      )
    }
    const message =
      String(body.message || '').trim() ||
      `Catha SMS gateway test at ${new Date().toISOString()}`
    await sendJabaSmsStrict(message, phones, { allowDuplicateCheck: false })
    return NextResponse.json({ success: true, phone: phones[0] })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || 'Test SMS failed' },
      { status: 400 }
    )
  }
}
