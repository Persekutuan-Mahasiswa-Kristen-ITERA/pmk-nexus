import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { safeRedirectPath } from "@/lib/auth/redirect";
import { supabasePublicEnv } from "@/lib/env";
import { verifySession } from "./claims";
import { AUTH_COOKIE_OPTIONS, isAuthCookieName } from "./cookies";

/** Reachable without a session (AR9). Static and PWA files are excluded by the matcher in src/proxy.ts. */
const PUBLIC_PATHS = ["/login"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

/**
 * Coarse first gate (spec 8.1 layer 1). Refreshes the Supabase session cookies on every request and
 * sends page requests without a session to /login. It is NOT the access check: pages, route handlers,
 * and Server Actions all call getAccessState() themselves, and RLS is the last layer.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });
  const { url, publishableKey } = supabasePublicEnv();

  const supabase = createServerClient(url, publishableKey, {
    cookieOptions: AUTH_COOKIE_OPTIONS,
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        // @supabase/ssr sends no-store headers whenever it writes cookies, so no cache keeps a session.
        Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
      },
    },
  });

  // Nothing between createServerClient and this call: it validates the JWT and triggers the refresh.
  const session = await verifySession(supabase);
  noStore(response);

  // "unavailable" (Auth unreachable) passes on: the page shows the "gangguan" state and keeps the
  // session (AR10). Redirecting would look like a logout. Only a definite "anonymous" is sent away.
  if (session.kind !== "anonymous" || isPublicPath(request.nextUrl.pathname)) return response;

  // Server Actions (POST) are not redirected: the action's own check returns a "session ended"
  // result (AUTH-30), which a redirect here would break.
  if (request.method !== "GET" && request.method !== "HEAD") return response;

  const redirect = NextResponse.redirect(loginUrl(request));
  // Keep cookie writes from the refresh attempt (e.g. deleting a revoked session).
  response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
  noStore(redirect);
  return redirect;
}

/** /login?next=<path>[&reason=session_ended]. No `next` for the home page (F1). */
function loginUrl(request: NextRequest): URL {
  const target = request.nextUrl.clone();
  target.searchParams.delete("_rsc"); // Next.js internal cache-busting value, not part of the page address.
  const next = safeRedirectPath(`${target.pathname}${target.search}`);

  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  if (next !== "/") url.searchParams.set("next", next);
  // The browser sent a session cookie that no longer works: tell the person why (F9, AUTH-29).
  if (request.cookies.getAll().some((cookie) => isAuthCookieName(cookie.name))) {
    url.searchParams.set("reason", "session_ended");
  }
  return url;
}

/** Per-user responses must never be stored by a browser or CDN cache (PI-CORE SECURITY.md "Stale authorization"). */
function noStore(response: NextResponse): void {
  response.headers.set("Cache-Control", "private, no-store");
}
