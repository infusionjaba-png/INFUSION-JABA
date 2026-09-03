import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth-catha'
import { normalizePermissions, hasCathaPermission } from '@/lib/catha-permissions-model'
import {
  requestMpesaIntegrationOtp,
  verifyMpesaIntegrationOtpResult,
  type MpesaOtpAction,
} from '@/lib/catha-mpesa-integration-security'

const ALLOWED_ACTIONS: MpesaOtpAction[] = [
  'unlock_mpesa_edit',
  'register_integration_phone',
  'change_integration_phone_step1',
  'change_integration_phone_step2',
]

async function assertSettingsAdmin() {
  const session = await auth()
  if (!session?.user?.email) {
    return { denied: NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 }) as NextResponse, email: null }
  }
  const role = ((session.user as { role?: string }).role ?? '').toUpperCase()
  const perms = normalizePermissions((session.user as { permissions?: unknown }).permissions)
  if (role !== 'SUPER_ADMIN' && !hasCathaPermission(perms, 'settings', 'edit')) {
    return { denied: NextResponse.json({ success: false, error: 'Insufficient permissions' }, { status: 403 }) as NextResponse, email: null }
  }
  return { denied: null, email: session.user.email }
}

export async function POST(request: NextRequest) {
  const gate = await assertSettingsAdmin()
  if (gate.denied) return gate.denied
  const email = gate.email!

  try {
    const body = await request.json()
    const action = String(body.action || '') as MpesaOtpAction
    if (!ALLOWED_ACTIONS.includes(action)) {
      return NextResponse.json({ success: false, error: 'Invalid OTP action' }, { status: 400 })
    }

    const result = await requestMpesaIntegrationOtp({
      action,
      requestedBy: email,
      newPhone: body.newPhone ? String(body.newPhone) : undefined,
      changeToken: body.changeToken ? String(body.changeToken) : undefined,
    })

    return NextResponse.json({
      success: true,
      message: 'OTP sent',
      maskedDestination: result.maskedDestination,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to send OTP'
    console.error('[M-Pesa integration OTP] request error:', error)
    const isGateway =
      /zettatel|sms gateway|cannot send sms|not configured|auth incomplete/i.test(message)
    return NextResponse.json(
      { success: false, error: message, code: isGateway ? 'sms_gateway' : 'otp_request' },
      { status: isGateway ? 502 : 400 }
    )
  }
}

export async function PUT(request: NextRequest) {
  const gate = await assertSettingsAdmin()
  if (gate.denied) return gate.denied
  const email = gate.email!

  try {
    const body = await request.json()
    const action = String(body.action || '') as MpesaOtpAction
    const otp = String(body.otp || '').trim()
    if (!ALLOWED_ACTIONS.includes(action) || !otp) {
      return NextResponse.json({ success: false, error: 'Invalid verification payload' }, { status: 400 })
    }

    const result = await verifyMpesaIntegrationOtpResult({
      action,
      requestedBy: email,
      otp,
      newPhone: body.newPhone ? String(body.newPhone) : undefined,
      changeToken: body.changeToken ? String(body.changeToken) : undefined,
    })

    if (!result.ok) {
      const messages: Record<string, string> = {
        missing_otp: 'OTP is required.',
        no_otp_doc: 'No OTP session found. Request a new code.',
        bad_otp: 'Invalid OTP. Check the code and try again.',
        expired: 'OTP has expired. Request a new code.',
        unauthorized: 'Verification failed.',
        invalid_phone: 'Invalid phone number.',
        no_integration_phone: 'Integration number is not configured.',
        change_not_authorized: 'Change authorization expired. Start again from step 1.',
      }
      return NextResponse.json(
        { success: false, error: messages[result.reason] || 'Verification failed' },
        { status: 400 }
      )
    }

    return NextResponse.json({
      success: true,
      editToken: result.editToken,
      editExpiresAt: result.editExpiresAt,
      changeToken: result.changeToken,
      changeExpiresAt: result.changeExpiresAt,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to verify OTP'
    console.error('[M-Pesa integration OTP] verify error:', error)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
