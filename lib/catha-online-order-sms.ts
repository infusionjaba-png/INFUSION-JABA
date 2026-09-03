import type { Db } from "mongodb"
import { sendJabaSmsStrict } from "@/lib/jaba-sms"
import { getCathaNotificationSettings } from "@/lib/catha-notification-settings"

function buildOnlineOrderSmsMessage(order: Record<string, unknown>): string {
  const orderId = String(order.orderId || order.id || "").trim() || "N/A"
  const table = String(order.tableNumber || order.tableId || "").trim() || "N/A"
  const totalNum = Number(order.total || 0)
  const total = Number.isFinite(totalNum) ? totalNum.toLocaleString() : "0"
  const phone = String(order.customerPhone || "").trim()
  const customerPhone = phone || "N/A"
  return `New online order received.\nOrder: ${orderId}\nTable: ${table}\nTotal: KES ${total}\nCustomer: ${customerPhone}`
}

export async function maybeSendOnlineOrderSms(
  db: Db,
  order: Record<string, unknown>
): Promise<{ sent: boolean; reason?: string }> {
  try {
    const notifications = await getCathaNotificationSettings(db)
    const phones = notifications.onlineOrderSmsPhones
    if (!phones.length) return { sent: false, reason: "no_recipients" }
    const message = buildOnlineOrderSmsMessage(order)
    await sendJabaSmsStrict(message, phones)
    return { sent: true }
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'sms_send_failed'
    console.error("[online-order-sms] Failed to send SMS:", error)
    return { sent: false, reason }
  }
}
