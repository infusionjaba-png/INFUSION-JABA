import { NextResponse } from "next/server"
import { ObjectId } from "mongodb"
import { getDatabase } from "@/lib/mongodb"
import { checkRateLimit, getClientIp } from "@/lib/rate-limit-simple"
import {
  WAITER_CALL_REASONS,
  type WaiterCallReasonId,
  reasonMeta,
} from "@/lib/waiter-call"

const COLLECTION = "waiter_calls"
const VALID_REASONS = new Set(WAITER_CALL_REASONS.map((r) => r.id))

function formatDoc(doc: any) {
  const createdAt =
    doc.createdAt instanceof Date
      ? doc.createdAt.getTime()
      : new Date(doc.createdAt).getTime() || Date.now()
  const acknowledgedAt = doc.acknowledgedAt
    ? doc.acknowledgedAt instanceof Date
      ? doc.acknowledgedAt.getTime()
      : new Date(doc.acknowledgedAt).getTime()
    : null
  const cancelledAt = doc.cancelledAt
    ? doc.cancelledAt instanceof Date
      ? doc.cancelledAt.getTime()
      : new Date(doc.cancelledAt).getTime()
    : null

  return {
    id: doc._id?.toString?.() ?? doc.callId,
    callId: doc.callId ?? doc._id?.toString?.(),
    tableNumber: String(doc.tableNumber ?? doc.tableId ?? ""),
    tableId: String(doc.tableId ?? doc.tableNumber ?? ""),
    reason: doc.reason as WaiterCallReasonId,
    reasonLabel: doc.reasonLabel,
    confirmedLabel: doc.confirmedLabel,
    customerPhone: doc.customerPhone ?? null,
    orderId: doc.orderId ?? null,
    status: doc.status ?? "pending",
    createdAt,
    acknowledgedAt,
    cancelledAt,
  }
}

/** Public GET — poll a single call by callId (customer sheet). */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const callId = searchParams.get("callId")?.trim()
    if (!callId) {
      return NextResponse.json({ error: "callId required" }, { status: 400 })
    }

    const db = await getDatabase("infusion_jaba")
    let doc =
      (await db.collection(COLLECTION).findOne({ callId })) ||
      (ObjectId.isValid(callId)
        ? await db.collection(COLLECTION).findOne({ _id: new ObjectId(callId) })
        : null)

    if (!doc) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    return NextResponse.json(formatDoc(doc))
  } catch (error: any) {
    console.error("[WaiterCalls] GET error:", error)
    return NextResponse.json(
      { error: "Failed to fetch waiter call", message: error.message },
      { status: 500 }
    )
  }
}

/** Public POST — customer creates a waiter call. */
export async function POST(request: Request) {
  try {
    const ip = getClientIp(request)
    const rl = checkRateLimit(`waiter-calls-post:${ip}`, 8, 60_000)
    if (!rl.ok) {
      return NextResponse.json(
        { error: "Too many requests", retryAfterMs: rl.retryAfterMs },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } }
      )
    }

    const body = await request.json()
    const tableRaw = String(body.tableNumber ?? body.tableId ?? "").trim()
    if (!tableRaw) {
      return NextResponse.json({ error: "tableNumber required" }, { status: 400 })
    }

    const reason = String(body.reason || "bill") as WaiterCallReasonId
    if (!VALID_REASONS.has(reason)) {
      return NextResponse.json({ error: "Invalid reason" }, { status: 400 })
    }

    const tableKey = tableRaw.replace(/^table\s*/i, "").trim() || tableRaw
    const tableRl = checkRateLimit(`waiter-calls-table:${tableKey}`, 2, 180_000)
    if (!tableRl.ok) {
      return NextResponse.json(
        {
          error: "Please wait before calling again",
          retryAfterMs: tableRl.retryAfterMs,
        },
        { status: 429, headers: { "Retry-After": String(Math.ceil(tableRl.retryAfterMs / 1000)) } }
      )
    }

    const meta = reasonMeta(reason)
    const callId = `wc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    const now = new Date()

    const doc = {
      callId,
      tableNumber: tableKey,
      tableId: String(body.tableId ?? tableKey),
      reason,
      reasonLabel: String(body.reasonLabel || meta.label),
      confirmedLabel: String(body.confirmedLabel || meta.confirmedLabel),
      customerPhone: body.customerPhone ? String(body.customerPhone) : null,
      orderId: body.orderId ? String(body.orderId) : null,
      status: "pending" as const,
      createdAt: now,
      acknowledgedAt: null,
      cancelledAt: null,
    }

    const db = await getDatabase("infusion_jaba")
    const result = await db.collection(COLLECTION).insertOne(doc)

    return NextResponse.json(
      formatDoc({ ...doc, _id: result.insertedId }),
      { status: 201 }
    )
  } catch (error: any) {
    console.error("[WaiterCalls] POST error:", error)
    return NextResponse.json(
      { error: "Failed to create waiter call", message: error.message },
      { status: 500 }
    )
  }
}

/** Public PATCH — customer cancels an active call. */
export async function PATCH(request: Request) {
  try {
    const body = await request.json()
    const callId = String(body.callId ?? body.id ?? "").trim()
    if (!callId) {
      return NextResponse.json({ error: "callId required" }, { status: 400 })
    }
    if (body.status !== "cancelled") {
      return NextResponse.json({ error: "Only cancel supported" }, { status: 400 })
    }

    const db = await getDatabase("infusion_jaba")
    const filter = ObjectId.isValid(callId)
      ? { $or: [{ callId }, { _id: new ObjectId(callId) }] }
      : { callId }

    const updateResult = await db.collection(COLLECTION).updateOne(filter, {
      $set: {
        status: "cancelled",
        cancelledAt: new Date(),
      },
    })

    if (updateResult.matchedCount === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    const doc = await db.collection(COLLECTION).findOne(filter)
    return NextResponse.json(formatDoc(doc))
  } catch (error: any) {
    console.error("[WaiterCalls] PATCH error:", error)
    return NextResponse.json(
      { error: "Failed to cancel waiter call", message: error.message },
      { status: 500 }
    )
  }
}
