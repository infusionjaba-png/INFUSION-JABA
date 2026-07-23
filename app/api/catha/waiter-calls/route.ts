import { NextResponse } from "next/server"
import { ObjectId } from "mongodb"
import { getDatabase } from "@/lib/mongodb"
import { auth } from "@/lib/auth-catha"
import { normalizePermissions, hasCathaPermission } from "@/lib/catha-permissions-model"
import type { WaiterCallReasonId } from "@/lib/waiter-call"

const COLLECTION = "waiter_calls"

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

async function requireStaff() {
  const session = await auth()
  if (!session?.user?.email) {
    return { ok: false as const, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  }
  const role = ((session.user as any).role ?? "").toUpperCase()
  const perms = normalizePermissions((session.user as any).permissions)
  if (
    role !== "SUPER_ADMIN" &&
    !hasCathaPermission(perms, "orders", "view") &&
    !hasCathaPermission(perms, "sales.posSales", "view")
  ) {
    return { ok: false as const, response: NextResponse.json({ error: "Insufficient permissions" }, { status: 403 }) }
  }
  return { ok: true as const, session }
}

/** Staff GET — recent waiter calls (default: pending in last 15 min). */
export async function GET(request: Request) {
  const gate = await requireStaff()
  if (!gate.ok) return gate.response

  try {
    const { searchParams } = new URL(request.url)
    const status = searchParams.get("status") // pending | acknowledged | cancelled | all
    const db = await getDatabase("infusion_jaba")

    const filter: Record<string, unknown> = {}
    if (status && status !== "all") {
      filter.status = status
    } else if (!status) {
      filter.status = { $in: ["pending", "acknowledged"] }
    }

    // Only surface recent calls (15 min) unless explicitly asking for all
    if (status !== "all") {
      filter.createdAt = { $gte: new Date(Date.now() - 15 * 60 * 1000) }
    }

    const docs = await db
      .collection(COLLECTION)
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray()

    return NextResponse.json(docs.map(formatDoc))
  } catch (error: any) {
    console.error("[Catha WaiterCalls] GET error:", error)
    return NextResponse.json(
      { error: "Failed to fetch waiter calls", message: error.message },
      { status: 500 }
    )
  }
}

/** Staff PUT — acknowledge ("On it") a waiter call. */
export async function PUT(request: Request) {
  const gate = await requireStaff()
  if (!gate.ok) return gate.response

  try {
    const body = await request.json()
    const id = String(body.id ?? body.callId ?? "").trim()
    if (!id) {
      return NextResponse.json({ error: "id required" }, { status: 400 })
    }

    const status = String(body.status || "acknowledged")
    if (status !== "acknowledged" && status !== "cancelled") {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 })
    }

    const db = await getDatabase("infusion_jaba")
    const filter = ObjectId.isValid(id)
      ? { $or: [{ callId: id }, { _id: new ObjectId(id) }] }
      : { callId: id }

    const $set: Record<string, unknown> = { status }
    if (status === "acknowledged") $set.acknowledgedAt = new Date()
    if (status === "cancelled") $set.cancelledAt = new Date()

    await db.collection(COLLECTION).updateOne(filter, { $set })
    const doc = await db.collection(COLLECTION).findOne(filter)
    if (!doc) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    return NextResponse.json(formatDoc(doc))
  } catch (error: any) {
    console.error("[Catha WaiterCalls] PUT error:", error)
    return NextResponse.json(
      { error: "Failed to update waiter call", message: error.message },
      { status: 500 }
    )
  }
}
