import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

// Next.js 16 name for middleware. Coarse gate only: see src/lib/supabase/proxy.ts.
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // Everything except build assets, image optimization, and public static / PWA files, which must
    // load without a session (login page styles, icons, install manifest, service worker).
    "/((?!_next/static|_next/image|favicon\\.ico|manifest\\.webmanifest|manifest\\.json|sw\\.js|robots\\.txt|icons/|brand/|.*\\.(?:png|jpg|jpeg|gif|svg|webp|avif|ico|txt|xml|woff2?)$).*)",
  ],
};
