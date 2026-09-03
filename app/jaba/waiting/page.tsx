"use client"

import { signOut } from "next-auth/react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Clock, Shield, Mail, AlertCircle, RefreshCw, Lock, AlertTriangle } from "lucide-react"
import { useEffect, useState, useRef } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"

const API_ME_URL = "/api/jaba/auth/me"
const POLL_INTERVAL_MS = 15000
const REQUEST_TIMEOUT_MS = 8000
const DEFAULT_FIRST_ROUTE = "/jaba"

type MeState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok"; user: { email: string; role: string; status: string; approved: boolean; allowedRoutes: string[] } }
  | { status: "unauthenticated" }
  | { status: "deleted" }

function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  return fetch(url, {
    cache: "no-store",
    headers: { "Cache-Control": "no-cache" },
    signal: controller.signal,
  }).finally(() => clearTimeout(timeoutId))
}

export default function WaitingPage() {
  const router = useRouter()
  const [meState, setMeState] = useState<MeState>({ status: "loading" })
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [refreshCountdown, setRefreshCountdown] = useState(Math.floor(POLL_INTERVAL_MS / 1000))
  const stopRef = useRef(false)
  const pollRef = useRef<NodeJS.Timeout | null>(null)
  const hasRedirected = useRef(false)

  const doCheck = async (): Promise<MeState | "redirected"> => {
    try {
      const res = await fetchWithTimeout(API_ME_URL, REQUEST_TIMEOUT_MS)
      const data = await res.json().catch(() => ({}))

      if (res.status === 401) {
        return { status: "unauthenticated" }
      }
      if (res.status === 404 || data.reason === "deleted") {
        return { status: "deleted" }
      }
      if (!res.ok) {
        return { status: "error", message: data.error || data.reason || "Request failed" }
      }

      const ok = data.ok === true
      const user = data.user
      if (!ok || !user) {
        return { status: "error", message: data.error || "Invalid response" }
      }

      const role = (user.role ?? "pending").toLowerCase()
      const userStatus = (user.status ?? "ACTIVE").toUpperCase()
      const approved = user.approved ?? false
      const allowedRoutes = Array.isArray(user.allowedRoutes) ? user.allowedRoutes : []

      return {
        status: "ok",
        user: {
          email: user.email ?? "",
          role,
          status: userStatus,
          approved,
          allowedRoutes,
        },
      }
    } catch (err: any) {
      const msg = err?.name === "AbortError" ? "Request timed out" : err?.message || "Network error"
      return { status: "error", message: msg }
    }
  }

  const redirectTo = (path: string) => {
    if (hasRedirected.current) return
    hasRedirected.current = true
    stopRef.current = true
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
    router.replace(path)
  }

  const performRedirects = (state: MeState): boolean => {
    if (state.status !== "ok") return false
    const u = state.user
    const status = u.status
    const role = u.role
    const allowedRoutes = u.allowedRoutes

    if (status === "SUSPENDED" || status === "INACTIVE") {
      redirectTo("/jaba/account-suspended")
      return true
    }
    if (role === "super_admin") {
      redirectTo(DEFAULT_FIRST_ROUTE)
      return true
    }
    if ((role === "cashier_admin" || role === "manager_admin") && u.approved && allowedRoutes.length > 0) {
      redirectTo(allowedRoutes[0] || DEFAULT_FIRST_ROUTE)
      return true
    }
    return false
  }

  const runCheck = async () => {
    if (stopRef.current) return
    const state = await doCheck()
    if (state === "redirected") return

    if (state.status === "unauthenticated") {
      stopRef.current = true
      if (pollRef.current) clearInterval(pollRef.current)
      router.replace("/jaba/login")
      return
    }

    if (state.status === "deleted") {
      stopRef.current = true
      if (pollRef.current) clearInterval(pollRef.current)
      await signOut({ callbackUrl: "/jaba/login" })
      router.replace("/jaba/login")
      return
    }

    setMeState(state)
    if (state.status === "ok" && performRedirects(state)) return
    setIsRefreshing(false)
  }

  useEffect(() => {
    stopRef.current = false
    hasRedirected.current = false

    runCheck()

    pollRef.current = setInterval(() => {
      if (stopRef.current) return
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return
      runCheck()
    }, POLL_INTERVAL_MS)

    const onVisible = () => {
      if (document.visibilityState === "visible" && !stopRef.current) runCheck()
    }
    document.addEventListener("visibilitychange", onVisible)

    return () => {
      stopRef.current = true
      document.removeEventListener("visibilitychange", onVisible)
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (meState.status === "ok" && !isRefreshing) {
      const t = setInterval(() => {
        setRefreshCountdown((p) => (p <= 1 ? Math.floor(POLL_INTERVAL_MS / 1000) : p - 1))
      }, 1000)
      return () => clearInterval(t)
    }
  }, [meState.status, isRefreshing])

  const handleRetry = () => {
    setMeState({ status: "loading" })
    setIsRefreshing(true)
    runCheck()
  }

  const handleRefresh = () => {
    setIsRefreshing(true)
    setRefreshCountdown(Math.floor(POLL_INTERVAL_MS / 1000))
    runCheck()
  }

  if (meState.status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-50 via-emerald-50/90 to-emerald-50/80 dark:from-slate-900 dark:via-emerald-950/30 dark:to-slate-900">
        <div className="flex flex-col items-center gap-4">
          <RefreshCw className="h-8 w-8 animate-spin text-emerald-600 dark:text-emerald-400" />
          <p className="text-sm text-stone-600 dark:text-stone-400">Checking account status...</p>
        </div>
      </div>
    )
  }

  if (meState.status === "error") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-50 via-emerald-50/90 to-emerald-50/80 dark:from-slate-900 dark:via-emerald-950/30 dark:to-slate-900 p-6">
        <Card className="max-w-md w-full border-rose-200 dark:border-rose-800 bg-white dark:bg-slate-900 shadow-xl">
          <CardHeader>
            <div className="mx-auto mb-4 p-4 rounded-full bg-rose-100 dark:bg-rose-950/30 w-20 h-20 flex items-center justify-center">
              <AlertTriangle className="h-10 w-10 text-rose-600 dark:text-rose-400" />
            </div>
            <CardTitle className="text-center text-xl font-bold">Could not load account status</CardTitle>
            <CardDescription className="text-center mt-2">{meState.message}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button className="w-full gap-2" onClick={handleRetry}>
              <RefreshCw className="h-4 w-4" />
              Retry
            </Button>
            <Button variant="outline" className="w-full" asChild>
              <Link href="/jaba/login">Back to login</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (meState.status === "unauthenticated") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-50 via-emerald-50/90 to-emerald-50/80 dark:from-slate-900 dark:via-emerald-950/30 dark:to-slate-900 p-6">
        <Card className="max-w-md w-full border-emerald-200 dark:border-emerald-800 bg-white dark:bg-slate-900 shadow-xl">
          <CardHeader>
            <CardTitle>Session required</CardTitle>
            <CardDescription>Please sign in to view this page.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/jaba/login">Go to sign in</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (meState.status === "deleted") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-50 via-emerald-50/90 to-emerald-50/80 dark:from-slate-900 dark:via-emerald-950/30 dark:to-slate-900 p-6">
        <Card className="max-w-md w-full border-stone-200 dark:border-stone-800 bg-white dark:bg-slate-900 shadow-xl">
          <CardHeader>
            <CardTitle>Account not found</CardTitle>
            <CardDescription>Your account may have been removed. Redirecting to login...</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/jaba/login">Go to login</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const u = meState.user
  const isAdmin = u.role === "cashier_admin" || u.role === "manager_admin"
  const waitingForPermissions = isAdmin && u.approved && u.allowedRoutes.length === 0

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-emerald-50/90 to-emerald-50/80 dark:from-slate-900 dark:via-emerald-950/30 dark:to-slate-900 flex items-center justify-center p-6">
      <Card className="max-w-2xl w-full border-emerald-200 dark:border-emerald-800 bg-white dark:bg-slate-900 shadow-xl">
        <CardHeader className="text-center pb-4">
          <div className="mx-auto mb-4 p-4 rounded-full bg-amber-100 dark:bg-amber-950/30 w-20 h-20 flex items-center justify-center">
            {waitingForPermissions ? (
              <Lock className="h-10 w-10 text-amber-600 dark:text-amber-400" />
            ) : (
              <Clock className="h-10 w-10 text-amber-600 dark:text-amber-400" />
            )}
          </div>
          <CardTitle className="text-2xl font-bold text-emerald-900 dark:text-emerald-50">
            {waitingForPermissions ? "Waiting for permissions" : "Your account is under review"}
          </CardTitle>
          <CardDescription className="text-base mt-2 text-stone-600 dark:text-stone-400">
            {waitingForPermissions
              ? "You have been approved but no pages have been assigned yet. Contact an administrator."
              : "Waiting for admin approval and permissions"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-4 rounded-lg bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800">
              <Shield className="h-5 w-5 text-emerald-600 dark:text-emerald-400 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium text-stone-900 dark:text-stone-100">Account Status</p>
                <p className="text-sm text-stone-600 dark:text-stone-400 mt-1">
                  {waitingForPermissions
                    ? "Your account is approved. A super administrator needs to assign page permissions."
                    : "Your account is pending approval. A super administrator will review your account and assign the necessary permissions."}
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-4 rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800">
              <Mail className="h-5 w-5 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium text-stone-900 dark:text-stone-100">Signed in as</p>
                <p className="text-sm text-stone-600 dark:text-stone-400 mt-1 font-mono">{u.email}</p>
                <p className="text-xs text-stone-500 dark:text-stone-500 mt-1">
                  Role: <span className="font-medium capitalize">{u.role.replace("_", " ")}</span>
                  {u.approved && <span className="ml-2 text-green-600 dark:text-green-400">✓ Approved</span>}
                </p>
              </div>
            </div>

            {!isRefreshing && (
              <div className="flex items-center gap-2 p-4 rounded-lg bg-stone-50 dark:bg-stone-800/50 border border-stone-200 dark:border-stone-700">
                <RefreshCw className="h-4 w-4 text-stone-500 dark:text-stone-400" />
                <p className="text-xs text-stone-600 dark:text-stone-400">
                  Auto-refreshing in {refreshCountdown} seconds to check for approval...
                </p>
              </div>
            )}

            {isRefreshing && (
              <div className="flex items-center gap-2 p-4 rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800">
                <RefreshCw className="h-4 w-4 text-blue-600 dark:text-blue-400 animate-spin" />
                <p className="text-xs text-blue-600 dark:text-blue-400">Checking for approval...</p>
              </div>
            )}
          </div>

          <div className="flex flex-col sm:flex-row gap-2 justify-center pt-4">
            <Button variant="outline" className="gap-2" onClick={handleRefresh} disabled={isRefreshing}>
              <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
              {isRefreshing ? "Checking..." : "Refresh Now"}
            </Button>
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => signOut({ callbackUrl: "/jaba/login" })}
              disabled={isRefreshing}
            >
              <AlertCircle className="h-4 w-4" />
              Sign out
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
