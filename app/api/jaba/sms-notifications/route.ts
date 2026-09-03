import { NextRequest, NextResponse } from 'next/server'
import { getJabaSmsSettings, normalizePhoneNumbers, saveJabaSmsSettings, sendJabaSmsStrict } from '@/lib/jaba-sms'
import { requireJabaSuperAdminDb } from '@/lib/api-jaba-permissions'

export async function GET() {
  try {
    const authz = await requireJabaSuperAdminDb()
    if ('response' in authz) return authz.response

    const settings = await getJabaSmsSettings()
    return NextResponse.json({
      ...settings,
      updatedAt: settings.updatedAt.toISOString(),
    })
  } catch (error) {
    console.error('[Jaba SMS Settings] GET failed:', error)
    return NextResponse.json({ error: 'Failed to fetch SMS settings' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const authz = await requireJabaSuperAdminDb()
    if ('response' in authz) return authz.response

    const body = await request.json()
    const saved = await saveJabaSmsSettings({
      enabled: Boolean(body.enabled),
      numbers: normalizePhoneNumbers(body.numbers),
      events: {
        batchCreated: Boolean(body.events?.batchCreated),
        packagingCreated: Boolean(body.events?.packagingCreated),
        distributionCreated: Boolean(body.events?.distributionCreated),
        distributionDelivered: Boolean(body.events?.distributionDelivered),
      },
      updatedBy: authz.email || undefined,
    })

    return NextResponse.json({
      ...saved,
      updatedAt: saved.updatedAt.toISOString(),
    })
  } catch (error) {
    console.error('[Jaba SMS Settings] PUT failed:', error)
    return NextResponse.json({ error: 'Failed to save SMS settings' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const authz = await requireJabaSuperAdminDb()
    if ('response' in authz) return authz.response

    const body = await request.json()
    const inputNumbers = normalizePhoneNumbers(body.numbers)
    const settings = await getJabaSmsSettings()
    const targetNumbers = inputNumbers.length > 0 ? inputNumbers : settings.numbers

    if (targetNumbers.length === 0) {
      console.error('[Jaba SMS Test] No valid numbers in request or saved settings')
      return NextResponse.json({ error: 'No valid SMS numbers found for test' }, { status: 400 })
    }

    const message =
      typeof body.message === 'string' && body.message.trim()
        ? body.message.trim()
        : `Jaba SMS test: Zettatel integration is working (${new Date().toLocaleString()}).`

    console.log('[Jaba SMS Test] Sending test SMS', {
      initiatedBy: authz.email,
      recipientCount: targetNumbers.length,
      recipients: targetNumbers,
      messageLength: message.length,
    })

    await sendJabaSmsStrict(message, targetNumbers)
    console.log('[Jaba SMS Test] Test SMS sent successfully')
    return NextResponse.json({ success: true, sentTo: targetNumbers.length })
  } catch (error) {
    console.error('[Jaba SMS Settings] POST test failed:', error)
    const message = error instanceof Error ? error.message : 'Failed to send test SMS'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
