"use client";

import { redirect, usePathname, useSearchParams } from "next/navigation";

/**
 * No valid session inside the protected area. The proxy normally redirects first; this is the
 * page-level layer (spec 8.1). Keeps the current path as `next` (dropped for the home page, F1).
 * redirect() during render becomes a server redirect on first load.
 */
export function RedirectToLogin(): never {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const path = search ? `${pathname}?${search}` : pathname;
  redirect(path === "/" ? "/login" : `/login?next=${encodeURIComponent(path)}`);
}
