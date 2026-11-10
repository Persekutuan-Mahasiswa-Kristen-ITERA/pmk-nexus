import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAccessState } from "@/lib/auth/session";
import type { AccessState, MemberContext } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";
import { minuteCapabilities, type MinuteCapabilities, type MinuteError } from "../types";

// Server-side permission gate for every Meeting Minutes entry point (CLAUDE.md 6: server check first,
// the database function checks again). Rights come from the caller's assignments in the ACTIVE period,
// combined across assignments with their unit scopes (my_permissions() already returns the union,
// "all" winning over units), read fresh per request. Never relies on what the UI showed. The per-unit
// check of ONE minute is the database's (detail.actions, has_permission(key, unit)); recordMinute also
// checks the chosen unit here with minuteScopeIncludes().

/** Boolean capabilities only (hasActivePeriod is a state, not a right). */
export type MinuteCapability = "canView" | "canManage" | "canRecord" | "canExport" | "canUploadFiles";

export type MinuteGate =
  | { ok: true; supabase: SupabaseClient; member: MemberContext; capabilities: MinuteCapabilities }
  | { ok: false; error: MinuteError };

/**
 * Turns an access state into "allowed" or an error code:
 * anonymous -> unauthenticated; error -> unavailable; no_access / password_pending / missing right -> forbidden.
 */
export function checkMinuteAccess(state: AccessState, capability: MinuteCapability): MinuteError | null {
  switch (state.kind) {
    case "anonymous":
      return { code: "unauthenticated" };
    case "error":
      return { code: "unavailable" };
    case "no_access":
    case "password_pending":
      return { code: "forbidden" };
    case "member":
      return minuteCapabilities(state)[capability] ? null : { code: "forbidden" };
  }
}

/** The session check of src/lib/auth (cached per request). Never throws: a failure is "error". */
export async function readAccessState(): Promise<AccessState> {
  try {
    return await getAccessState();
  } catch {
    return { kind: "error" };
  }
}

/**
 * Checks the caller and returns the user's own Supabase client (never the service role) for the
 * database call. `state` lets a route handler or Server Action pass the state it already read.
 */
export async function requireMinutes(capability: MinuteCapability, state?: AccessState): Promise<MinuteGate> {
  const current = state ?? (await readAccessState());
  const denied = checkMinuteAccess(current, capability);
  if (denied) return { ok: false, error: denied };
  if (current.kind !== "member") return { ok: false, error: { code: "forbidden" } }; // narrowing only

  try {
    return { ok: true, supabase: await createClient(), member: current.member, capabilities: minuteCapabilities(current) };
  } catch {
    console.error("[minutes] could not create the Supabase client");
    return { ok: false, error: { code: "unavailable" } };
  }
}
