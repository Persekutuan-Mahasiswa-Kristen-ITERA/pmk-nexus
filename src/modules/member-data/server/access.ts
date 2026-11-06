import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAccessState } from "@/lib/auth/session";
import type { AccessState, MemberContext } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";
import { memberDataCapabilities, type MemberDataCapabilities, type MemberDataError } from "../types";

// Server-side permission gate for every Member Data entry point (CLAUDE.md 6: server check first,
// the database function checks again). Rights come from the active-period assignments, combined
// (my_permissions() already returns the union), read fresh per request (R3, MD-07, MD-08).

export type MemberDataCapability = keyof MemberDataCapabilities;

export type MemberDataGate =
  | { ok: true; supabase: SupabaseClient; member: MemberContext }
  | { ok: false; error: MemberDataError };

/**
 * Turns an access state into "allowed" or an error code:
 * anonymous -> unauthenticated; error -> unavailable; no_access / password_pending / missing key -> forbidden.
 */
export function checkMemberDataAccess(state: AccessState, capability: MemberDataCapability): MemberDataError | null {
  switch (state.kind) {
    case "anonymous":
      return { code: "unauthenticated" };
    case "error":
      return { code: "unavailable" };
    case "no_access":
    case "password_pending":
      return { code: "forbidden" };
    case "member":
      return memberDataCapabilities(state)[capability] ? null : { code: "forbidden" };
  }
}

/**
 * Checks the caller (session check of src/lib/auth, cached per request) and returns the user's own
 * Supabase client for the database call. `state` lets a route handler pass the state it already read.
 */
export async function requireMemberData(
  capability: MemberDataCapability,
  state?: AccessState,
): Promise<MemberDataGate> {
  let current: AccessState;
  try {
    current = state ?? (await getAccessState());
  } catch {
    return { ok: false, error: { code: "unavailable" } };
  }
  const denied = checkMemberDataAccess(current, capability);
  if (denied) return { ok: false, error: denied };
  if (current.kind !== "member") return { ok: false, error: { code: "forbidden" } }; // narrowing only

  try {
    return { ok: true, supabase: await createClient(), member: current.member };
  } catch {
    console.error("[member-data] could not create the Supabase client");
    return { ok: false, error: { code: "unavailable" } };
  }
}
