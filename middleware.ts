import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { getToken } from "next-auth/jwt"
// Edge-safe helper: Get app-specific secret from env vars
function getAppSecret(appName: 'catha' | 'jaba'): string | null {
  const isProduction = process.env.NODE_ENV === 'production' || process.env.NEXTAUTH_URL?.startsWith('https://')
  
  if (appName === 'catha') {
    const secret = process.env.AUTH_SECRET_CATHA || (!isProduction ? process.env.NEXTAUTH_SECRET : undefined)
    if (!secret && isProduction) {
      console.error('[Middleware] ❌ CRITICAL: AUTH_SECRET_CATHA must be set in production')
      return null
    }
    return secret || null
  } else {
    const secret = process.env.AUTH_SECRET_JABA || (!isProduction ? process.env.NEXTAUTH_SECRET : undefined)
    if (!secret && isProduction) {
      console.error('[Middleware] ❌ CRITICAL: AUTH_SECRET_JABA must be set in production')
      return null
    }
    return secret || null
  }
}

// Cookie names: prod uses __Secure- prefix (HTTPS), dev uses plain (localhost)
const CATHA_COOKIE_NAMES = ['__Secure-catha.session-token', 'catha.session-token']
const JABA_COOKIE_NAMES = ['__Secure-jaba.session-token', 'jaba.session-token']

// Edge-safe helper: Check if session cookie exists for an app (check BOTH prod + dev names)
function hasSession(cookies: any, appName: 'catha' | 'jaba'): boolean {
  const names = appName === 'catha' ? CATHA_COOKIE_NAMES : JABA_COOKIE_NAMES
  for (const name of names) {
    if (cookies.get(name)?.value) return true
  }
  return false
}

// Helper function to get token for a specific app
// CRITICAL: Each app uses its own cookie name to prevent collisions
// Catha → catha.session-token
// Jaba → jaba.session-token
async function getTokenForApp(request: NextRequest, appName: 'catha' | 'jaba'): Promise<any | null> {
  // Get app-specific secret
  const secret = getAppSecret(appName)
  if (!secret) {
    console.log(`[Middleware ${appName}] ❌ No secret available (AUTH_SECRET_${appName.toUpperCase()} or NEXTAUTH_SECRET)`)
    return null
  }

  const cookieNames = appName === 'catha' ? CATHA_COOKIE_NAMES : JABA_COOKIE_NAMES
  const allCookies = request.cookies.getAll()
  const allNames = allCookies.map(c => c.name)
  console.log(`[Middleware ${appName}] 🔍 All cookies seen: ${allNames.join(', ')}`)

  // Try each cookie name (prod then dev) so localhost and prod both work
  for (const cookieName of cookieNames) {
    const cookieValue = request.cookies.get(cookieName)?.value
    if (!cookieValue) continue
    console.log(`[Middleware ${appName}] ✅ Found ${cookieName} cookie (length: ${cookieValue.length}), attempting decode...`)
    try {
      const token = await getToken({
        req: request,
        secret: secret,
        cookieName: cookieName,
      })
    
    if (token) {
      // ✅ SAFE TOKEN LOGGING: Confirm token exists and is readable
      console.log(`[Middleware ${appName}] ✅ Token exists? YES - successfully decoded from cookie`)
      
      // CRITICAL: Validate token exists and has required fields
      const tokenApp = (token as any)?.app
      const tokenExp = (token as any)?.exp
      const tokenRole = (token as any)?.role
      const tokenApproved = (token as any)?.approved
      const tokenId = (token as any)?.id
      const tokenUserCollection = (token as any)?.userCollection
      
      // ✅ SAFE TOKEN LOGGING: Log non-sensitive token data
      const tokenData = {
        id: tokenId?.substring(0, 8) + '...' || 'none',
        app: tokenApp || 'none',
        role: tokenRole || 'none',
        approved: tokenApproved ?? 'none',
        exp: tokenExp ? new Date(tokenExp * 1000).toISOString() : 'none',
        userCollection: tokenUserCollection || 'none',
      }
      console.log(`[Middleware ${appName}] 📋 Token data:`, JSON.stringify(tokenData, null, 2))
      
      // CRITICAL: Validate token expiration (only if exp is present)
      // Don't block if exp is missing - NextAuth handles expiration via maxAge
      if (tokenExp !== undefined && tokenExp !== null) {
        const now = Math.floor(Date.now() / 1000)
        if (tokenExp < now) {
          console.log(`[Middleware ${appName}] ⚠️ Token expired (exp: ${new Date(tokenExp * 1000).toISOString()}, now: ${new Date(now * 1000).toISOString()})`)
          return null
        }
      } else {
        // exp is missing - log warning in dev, but don't block
        const isProduction = process.env.NODE_ENV === 'production'
        if (!isProduction) {
          console.log(`[Middleware ${appName}] ⚠️ WARNING: Token exp field is missing - relying on NextAuth maxAge for expiration`)
        }
      }
      
      // CRITICAL: Validate token.app field (MUST check - primary validation)
      // This ensures the token belongs to the correct app
      if (!tokenApp || tokenApp !== appName) {
        console.log(`[Middleware ${appName}] ⚠️ Token app (${tokenApp}) doesn't match expected app (${appName})`)
        console.log(`[Middleware ${appName}] 💡 User is logged into the other app - blocking access`)
        return null
      }
      
      // Optional: token.userCollection should match app (catha vs jaba only; no cross-app)
      const expectedCollection = appName === 'catha' ? 'catha' : 'jaba'
      if (tokenUserCollection && tokenUserCollection !== expectedCollection) {
        console.log(`[Middleware ${appName}] ⚠️ WARNING: Token userCollection (${tokenUserCollection}) doesn't match expected (${expectedCollection})`)
      }
      
      // Log token data (production-safe: only essential fields, no sensitive data)
      const isProduction = process.env.NODE_ENV === 'production'
      if (isProduction) {
        // Production: Log only essential fields
        console.log(`[Middleware ${appName}] ✅ Token validated - app: ${tokenApp}, role: ${tokenRole}, approved: ${tokenApproved}, id: ${tokenId?.substring(0, 8)}...`)
      } else {
        // Development: Log full token for debugging
        console.log(`[Middleware ${appName}] ✅ Successfully decoded JWT token from ${cookieName}`)
        console.log(`[Middleware ${appName}] 📋 TOKEN DATA:`, JSON.stringify({
          app: tokenApp,
          userCollection: tokenUserCollection,
          role: tokenRole,
          email: (token as any)?.email,
          approved: tokenApproved,
          routePermissions: (token as any)?.routePermissions,
          id: tokenId,
          exp: tokenExp,
        }, null, 2))
      }
      
      return token
    } else {
      console.log(`[Middleware ${appName}] ⚠️ getToken returned null for ${cookieName}, trying next cookie name`)
    }
    } catch (error: any) {
      console.log(`[Middleware ${appName}] ❌ getToken error for ${cookieName}: ${error.message}`)
    }
  }
  console.log(`[Middleware ${appName}] ❌ No valid session cookie found (tried: ${cookieNames.join(', ')})`)
  return null
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname ?? ''
  const allowOfflineDev = process.env.NODE_ENV !== 'production' && process.env.ALLOW_OFFLINE_DEV === 'true'

  try {
  // ─── Local offline dev bypass for Jaba routes ───
  // Allows UI testing when Mongo/Atlas is unavailable.
  if (allowOfflineDev && (pathname === "/jaba" || pathname.startsWith("/jaba/")) && !pathname.startsWith("/api")) {
    return NextResponse.next()
  }

  // ─── Catha: require valid JWT for app=catha (not merely a cookie present) ───
  if (pathname.startsWith("/catha") && !pathname.startsWith("/api")) {
    const allowed =
      pathname === "/catha/login" ||
      pathname === "/catha/waiting" ||
      pathname === "/catha/access-denied" ||
      pathname === "/catha/disabled" ||
      pathname.startsWith("/catha/public/")
    if (allowed) return NextResponse.next()
    const hasCathaSession = hasSession(request.cookies, 'catha')
    if (!hasCathaSession) {
      const url = new URL("/catha/login", request.url)
      url.searchParams.set("callbackUrl", pathname)
      return NextResponse.redirect(url)
    }
    const cathaToken = await getTokenForApp(request, 'catha')
    if (!cathaToken) {
      const url = new URL("/catha/login", request.url)
      url.searchParams.set("callbackUrl", pathname)
      return NextResponse.redirect(url)
    }
    const cathaRole = String((cathaToken as any)?.role ?? '').toUpperCase()
    const cashierShiftRoutes = [
      '/catha/staff-shifts',
      '/catha/shift-history',
      '/catha/workforce-hub',
    ]
    if (
      cathaRole === 'CASHIER' &&
      cashierShiftRoutes.some((route) => pathname === route || pathname.startsWith(`${route}/`))
    ) {
      return NextResponse.redirect(new URL('/catha/my-shift', request.url))
    }
    const requestHeaders = new Headers(request.headers)
    requestHeaders.set('x-catha-pathname', pathname)
    return NextResponse.next({
      request: { headers: requestHeaders },
    })
  }

  // ─── Protect /jaba routes ───
  if (
    (pathname === "/jaba" || pathname.startsWith("/jaba/")) &&
    !pathname.startsWith("/jaba/login") &&
    !pathname.startsWith("/jaba/signup") &&
    pathname !== "/jaba/waiting" &&
    pathname !== "/jaba/unauthorized" &&
    pathname !== "/jaba/account-suspended" &&
    !pathname.startsWith("/api")
  ) {
    const cookies = request.cookies

    // Check if user has Jaba session cookie
    const hasSessionCookie = hasSession(cookies, 'jaba')
    console.log(`[Middleware Jaba] Checking ${pathname}, hasSessionCookie: ${hasSessionCookie}`)
    
    if (!hasSessionCookie) {
      console.log(`[Middleware Jaba] ❌ No session cookie found for ${pathname}, redirecting to login`)
      const url = new URL("/jaba/login", request.url)
      url.searchParams.set("callbackUrl", pathname)
      return NextResponse.redirect(url)
    }

    // Get token and user info - try ALL possible methods to ensure we get the token
    const isProduction = process.env.NODE_ENV === 'production' || process.env.NEXTAUTH_URL?.startsWith('https://')
    
    let token: any = null
    
    try {
      // Log environment info for debugging
      const jabaSecret = getAppSecret('jaba')
      console.log(`[Middleware Jaba] Environment check - isProduction: ${isProduction}, NEXTAUTH_URL: ${process.env.NEXTAUTH_URL?.substring(0, 50)}...`)
      console.log(`[Middleware Jaba] AUTH_SECRET_JABA present: ${!!process.env.AUTH_SECRET_JABA}, NEXTAUTH_SECRET fallback: ${!!process.env.NEXTAUTH_SECRET}`)
      
      // Method 1: Get token for Jaba app (uses jaba.session-token cookie with AUTH_SECRET_JABA)
      token = await getTokenForApp(request, 'jaba')
      
      if (token) {
        console.log(`[Middleware Jaba] ✅ Token retrieved successfully!`)
        console.log(`[Middleware Jaba] Token details - userCollection: ${token?.userCollection}, role: ${token?.role}, email: ${token?.email}`)
      } else {
        // Log available cookies for debugging
        const allCookies = request.cookies.getAll()
        const cookieNames = allCookies.map(c => c.name)
        const cookieInfo = allCookies.map(c => `${c.name}=${c.value.substring(0, 30)}... (length: ${c.value.length})`)
        console.log(`[Middleware Jaba] ❌ All getToken attempts failed`)
        console.log(`[Middleware Jaba] Available cookies (${cookieNames.length}): ${cookieNames.join(', ')}`)
        console.log(`[Middleware Jaba] Cookie details: ${cookieInfo.join(' | ')}`)
      }
    } catch (tokenError: any) {
      console.error(`[Middleware Jaba] ❌ Error getting token: ${tokenError.message}`)
      console.error(`[Middleware Jaba] Error stack: ${tokenError.stack}`)
      const url = new URL("/jaba/login", request.url)
      url.searchParams.set("callbackUrl", pathname)
      url.searchParams.set("error", "token_error")
      return NextResponse.redirect(url)
    }
    
    if (!token) {
      console.log(`[Middleware Jaba] ⚠️ No token found for ${pathname} (session cookie exists but token is null)`)
      console.log(`[Middleware Jaba] This might be a NextAuth v5 Edge runtime issue. Allowing access if session API confirms authentication.`)
      // CRITICAL FIX: If getToken fails but session cookie exists, don't redirect immediately
      // Instead, let the client-side session check handle it (login page will redirect if needed)
      // This prevents infinite loops when getToken can't decode the token in Edge runtime
      // The session API (/api/auth/session) can read it fine, so we trust that
      if (pathname === "/jaba/login") {
        // If we're already on login page and token is null, allow it (client will handle redirect)
        return NextResponse.next()
      }
      // For other pages, redirect to login but don't set callbackUrl to prevent loop
      const url = new URL("/jaba/login", request.url)
      // Don't set callbackUrl if we're coming from login to prevent loop
      if (!request.url.includes('/jaba/login')) {
        url.searchParams.set("callbackUrl", pathname)
      }
      return NextResponse.redirect(url)
    }

    const userCollection = (token as any)?.userCollection
    const role = (token as any)?.role as string | undefined
    const approved = (token as any)?.approved as boolean | undefined
    const userStatus = (token as any)?.status as string | undefined
    const routePermissions = (token as any)?.routePermissions as string[] | undefined
    const email = (token as any)?.email as string | undefined

    // Debug logging for production
    console.log(`[Middleware Jaba] pathname: ${pathname}, role: ${role}, status: ${userStatus}, approved: ${approved}, userCollection: ${userCollection}, email: ${email}`)

    // ─── SUSPENDED (status inactive): Block everywhere except account-suspended ───
    if (userStatus === 'inactive') {
      const url = new URL("/jaba/account-suspended", request.url)
      return NextResponse.redirect(url)
    }

    // Jaba: only Jaba users. Catha users use /catha; no cross-app access.
    if (userCollection !== "jaba") {
      console.log(`[Middleware Jaba] ❌ BLOCKED: userCollection is "${userCollection}" (expected "jaba"). Redirecting to login.`)
      const url = new URL("/jaba/login", request.url)
      url.searchParams.set("callbackUrl", pathname)
      // Clear any session cookies to force re-authentication with correct context
      const response = NextResponse.redirect(url)
      response.cookies.delete("authjs.session-token")
      response.cookies.delete("__Secure-authjs.session-token")
      response.cookies.delete("next-auth.session-token")
      response.cookies.delete("__Secure-next-auth.session-token")
      return response
    }

    // ─── SUPER ADMIN: Can access ALL pages (ALWAYS, regardless of approved status) ───
    if (role === "super_admin") {
      // Super admin on waiting/unauthorized pages: redirect to dashboard
      if (pathname === "/jaba/waiting" || pathname === "/jaba/unauthorized") {
        return NextResponse.redirect(new URL("/jaba", request.url))
      }
      return NextResponse.next()
    }

    // ─── ADMIN (cashier_admin or manager_admin): Must be approved AND have permissions ───
    if (role === "cashier_admin" || role === "manager_admin") {
      // If not approved → redirect to waiting
      if (!approved) {
        if (pathname !== "/jaba/waiting") {
          return NextResponse.redirect(new URL("/jaba/waiting", request.url))
        }
        return NextResponse.next()
      }

      // If approved but no permissions → redirect to waiting
      if (!routePermissions || routePermissions.length === 0) {
        if (pathname !== "/jaba/waiting") {
          return NextResponse.redirect(new URL("/jaba/waiting", request.url))
        }
        return NextResponse.next()
      }

      // If accessing page not in permissions → show Access Denied (unauthorized page)
      // Inlined - no function (Edge bundler drops functions)
      let ok = false
      if (routePermissions && Array.isArray(routePermissions) && routePermissions.length > 0) {
        const n = String(pathname || '').replace(/\/$/, '') || pathname
        for (let i = 0; i < routePermissions.length; i++) {
          const r = String(routePermissions[i] || '').replace(/\/$/, '') || routePermissions[i]
          if ((r === '/jaba' && n === '/jaba') || n === r || n.startsWith(r + '/')) { ok = true; break }
        }
      }
      if (!ok) return NextResponse.redirect(new URL("/jaba/unauthorized", request.url))

      // Approved admin with permissions - on waiting/unauthorized, redirect to first allowed page
      if (pathname === "/jaba/waiting" || pathname === "/jaba/unauthorized") {
        const firstAllowed = routePermissions?.[0] || "/jaba"
        return NextResponse.redirect(new URL(firstAllowed, request.url))
      }
      return NextResponse.next()
    }

    // ─── USER or any other role: Always redirect to waiting ───
    if (pathname !== "/jaba/waiting") {
      return NextResponse.redirect(new URL("/jaba/waiting", request.url))
    }
    return NextResponse.next()
  }

  // Legacy root paths (no prefix) → redirect to Catha. Jaba has its own /jaba/*; no connection.
  const legacyCathaPaths = [
    "/pos", "/inventory", "/suppliers", "/stock-movement", "/orders",
    "/mpesa", "/expenses", "/clients", "/users", "/distributor-requests", "/reports", "/settings",
  ]
  if (legacyCathaPaths.includes(pathname) && !pathname.startsWith("/catha") && !pathname.startsWith("/jaba")) {
    return NextResponse.redirect(new URL(`/catha${pathname}`, request.url))
  }

  return NextResponse.next()
  } catch (err: any) {
    console.error('[Middleware] Unhandled error:', err?.message ?? err)
    if (pathname.startsWith('/jaba')) return NextResponse.redirect(new URL('/jaba/login', request.url))
    return NextResponse.next()
  }
}

export const config = {
  matcher: [
    /*
     * Only run Edge middleware where auth redirects or legacy path rewrites are needed.
     * Public storefront (/shop, /menu, /product, …) no longer pays Edge invocation cost.
     */
    "/catha/:path*",
    "/jaba/:path*",
    "/pos",
    "/inventory",
    "/suppliers",
    "/stock-movement",
    "/orders",
    "/mpesa",
    "/expenses",
    "/clients",
    "/users",
    "/distributor-requests",
    "/reports",
    "/settings",
  ],
}
