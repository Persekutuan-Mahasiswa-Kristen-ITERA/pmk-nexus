import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAccessState } from "@/lib/auth/session";
import type { AccessState, MemberContext } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";
import { financeCapabilities, type FinanceCapabilities, type FinanceError } from "../types";

// Server-side permission gate for every Finance entry point (CLAUDE.md 6: server check first, the
// database function checks again). Rights come from the caller's assignments in the ACTIVE period,
// read fresh per request. Finance keys accept scope "all" only (financeCapabilities ignores a "units"
// grant). Never relies on what the UI showed. Being System Admin gives nothing here (B18).

/** Boolean capabilities only (hasActivePeriod is a state, not a right). */
export type FinanceCapability = "canView" | "canManage" | "canRecord" | "canExport" | "canUploadProof";

export type FinanceGate =
  | { ok: true; supabase: SupabaseClient; member: MemberContext; capabilities: FinanceCapabilities }
  | { ok: false; error: FinanceError };

/**
 * Turns an access state into "allowed" or an error code:
 * anonymous -> unauthenticated; error -> unavailable; no_access / password_pending / missing right -> forbidden.
 */
export function checkFinanceAccess(state: AccessState, capability: FinanceCapability): FinanceError | null {
  switch (state.kind) {
    case "anonymous":
      return { code: "unauthenticated" };
    case "error":
      return { code: "unavailable" };
    case "no_access":
    case "password_pending":
      return { code: "forbidden" };
    case "member":
      return financeCapabilities(state)[capability] ? null : { code: "forbidden" };
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
export async function requireFinance(capability: FinanceCapability, state?: AccessState): Promise<FinanceGate> {
  const current = state ?? (await readAccessState());
  const denied = checkFinanceAccess(current, capability);
  if (denied) return { ok: false, error: denied };
  if (current.kind !== "member") return { ok: false, error: { code: "forbidden" } }; // narrowing only

  try {
    return { ok: true, supabase: await createClient(), member: current.member, capabilities: financeCapabilities(current) };
  } catch {
    console.error("[finance] could not create the Supabase client");
    return { ok: false, error: { code: "unavailable" } };
  }
}
