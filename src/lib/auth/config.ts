// Auth-related configuration shared by server and browser code. Not secret.
import { picoreBaseUrl } from "@/lib/env";

/**
 * PI-CORE's change-password page (D-015, A-AUTH-2). PI-CORE keeps `next=/change-password` through its
 * own login, so the link works for someone not yet signed in there. Opened in a new tab (D-017).
 * Throws at import if NEXT_PUBLIC_PICORE_URL is missing or not http(s), so a bad deploy fails loudly.
 */
export const picoreChangePasswordUrl: string = `${picoreBaseUrl()}/change-password`;
