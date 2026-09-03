import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth-catha'
import { getDatabase } from '@/lib/mongodb'
import { normalizePermissions, hasCathaPermission } from '@/lib/catha-permissions-model'
import { maybeSendCathaPaymentReceiptSms } from '@/lib/catha-payment-sms'

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const role = ((session.user as any).role ?? '').toUpperCase()
  const perms = normalizePermissions((session.user as any).permissions)
  if (role !== 'SUPER_ADMIN' && !hasCathaPermission(perms, 'orders', 'edit')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  try {
    const body = await request.json().catch(() => ({}))
    const orderId = typeof body?.orderId === 'string' ? body.orderId.trim() : ''
    const phoneOverride =
      typeof body?.phone === 'string' && body.phone.trim() ? body.phone.trim() : null
    if (!orderId) {
      return NextResponse.json({ error: 'orderId is required' }, { status: 400 })
    }

    const db = await getDatabase('infusion_jaba')
    const before = await db.collection('orders').findOne({ id: orderId })
    const result = await maybeSendCathaPaymentReceiptSms(db, orderId, {
      force: true,
      phoneOverride,
    })
    const order = await db.collection('orders').findOne({ id: orderId })

    if (!result.sent) {
      const lastError =
        (order as any)?.paymentReceiptSmsLastError ||
        (before as any)?.paymentReceiptSmsLastError ||
        null
      return NextResponse.json(
        {
          success: false,
          reason: result.reason || lastError || 'sms_send_failed',
          phone: result.phone ?? null,
          lastError,
          order: order || null,
        },
        { status: 400 }
      )
    }

    return NextResponse.json({
      success: true,
      phone: result.phone ?? null,
      order: order || null,
    })
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Failed to resend receipt SMS', message: error?.message || 'Unknown error' },
      { status: 500 }
    )
  }
}
