import { createShiftUserSmsLog } from '@/lib/models/shift-user-sms-log'
import { getCathaUserById } from '@/lib/models/catha-user'
import { enqueueShiftSms } from '@/lib/models/shift-sms-queue'
import { processShiftSmsQueueBatch } from '@/lib/catha-shift-sms-queue-worker'

const STRICT_PHONE = /^\+254[17]\d{8}$/

type ShiftUserSmsEvent = 'SHIFT_OPENED' | 'SHIFT_CLOSED' | 'SHIFT_AUTO_CLOSED'

export async function queueShiftUserSms(input: {
  userId: string
  shiftId?: string
  eventType: ShiftUserSmsEvent
  message: string
}): Promise<void> {
  const user = await getCathaUserById(input.userId)
  const phone = String(user?.phoneNumber ?? '').trim()
  if (!STRICT_PHONE.test(phone)) {
    await enqueueShiftSms({
      userId: input.userId,
      shiftId: input.shiftId,
      phone,
      message: input.message,
      eventType: input.eventType === 'SHIFT_OPENED' ? 'OPEN' : input.eventType === 'SHIFT_AUTO_CLOSED' ? 'AUTO_CLOSE' : 'CLOSE',
      status: 'permanently_failed',
      lastError: 'invalid_phone_format',
    })
    await createShiftUserSmsLog({
      userId: input.userId,
      shiftId: input.shiftId,
      phone,
      message: input.message,
      status: 'failed',
      eventType: input.eventType,
      error: 'invalid_phone_format',
    })
    return
  }
  await enqueueShiftSms({
    userId: input.userId,
    shiftId: input.shiftId,
    phone,
    message: input.message,
    eventType: input.eventType === 'SHIFT_OPENED' ? 'OPEN' : input.eventType === 'SHIFT_AUTO_CLOSED' ? 'AUTO_CLOSE' : 'CLOSE',
  })
  // Must await on Vercel — fire-and-forget is frozen when the HTTP response finishes.
  try {
    await processShiftSmsQueueBatch(10)
  } catch (error) {
    console.error('[shift-user-sms] queue process failed', error)
  }
}

