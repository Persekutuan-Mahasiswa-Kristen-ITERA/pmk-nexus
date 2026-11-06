"use server";

import { getAccessState } from "@/lib/auth/session";
import type { AccessState } from "@/lib/auth/types";

/**
 * Re-runs the caller's own access check for "Coba lagi" and "Sudah ganti? Muat ulang".
 * Returns only the state kind (no member data), so the screen can tell "still pending" or
 * "still failing" apart from "changed" without re-rendering. The client refreshes on a change.
 */
export async function recheckAccess(): Promise<AccessState["kind"]> {
  try {
    const state = await getAccessState();
    return state.kind;
  } catch {
    return "error";
  }
}
