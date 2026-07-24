import { NextResponse } from "next/server"
import { getDatabase } from "@/lib/mongodb"
import { auth } from "@/lib/auth-catha"
import { normalizePermissions, hasCathaPermission } from "@/lib/catha-permissions-model"
import { syncOpenMenuOrdersToAdmin } from "@/lib/menu-order-admin-sync"

/**
 * POST — backfill open /menu rounds into admin `orders` so they appear on /catha/orders.
 * Safe to call repeatedly (upsert).
 */
export async function POST() {
  const session = await auth()
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const role = ((session.user as any).role ?? "").toUpperCase()
  const perms = normalizePermissions((session.user as any).permissions)
  if (role !== "SUPER_ADMIN" && !hasCathaPermission(perms, "orders", "view")) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 })
  }

  try {
    const db = await getDatabase("infusion_jaba")
    const result = await syncOpenMenuOrdersToAdmin(db)
    const res = NextResponse.json({ success: true, ...result })
    res.headers.set("Cache-Control", "no-store")
    return res
  } catch (error: any) {
    console.error("[menu-orders/sync-to-orders]", error)
    return NextResponse.json(
      { error: "Failed to sync menu orders", message: error?.message },
      { status: 500 }
    )
  }
}
