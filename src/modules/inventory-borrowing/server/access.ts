import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAccessState } from "@/lib/auth/session";
import type { AccessState, MemberContext } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";
import { inventoryCapabilities, type InventoryCapabilities, type InventoryError } from "../types";

// Server-side permission gate for every Inventory and Borrowing entry point (CLAUDE.md 6: server check
// first, the database function checks again). Rights come from the caller's assignments in the ACTIVE
// period, combined (my_permissions() already returns the union with implied keys), read fresh per
// request. Never relies on what the UI showed.

/** Boolean capabilities only (hasActivePeriod is a state, not a right). */
export type InventoryCapability = Exclude<keyof InventoryCapabilities, "hasActivePeriod">;

export type InventoryGate =
  | { ok: true; supabase: SupabaseClient; member: MemberContext; capabilities: InventoryCapabilities }
  | { ok: false; error: InventoryError };

/**
 * Turns an access state into "allowed" or an error code:
 * anonymous -> unauthenticated; error -> unavailable; no_access / password_pending / missing right -> forbidden.
 */
export function checkInventoryAccess(state: AccessState, capability: InventoryCapability): InventoryError | null {
  switch (state.kind) {
    case "anonymous":
      return { code: "unauthenticated" };
    case "error":
      return { code: "unavailable" };
    case "no_access":
    case "password_pending":
      return { code: "forbidden" };
    case "member":
      return inventoryCapabilities(state)[capability] ? null : { code: "forbidden" };
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
export async function requireInventory(capability: InventoryCapability, state?: AccessState): Promise<InventoryGate> {
  const current = state ?? (await readAccessState());
  const denied = checkInventoryAccess(current, capability);
  if (denied) return { ok: false, error: denied };
  if (current.kind !== "member") return { ok: false, error: { code: "forbidden" } }; // narrowing only

  try {
    return { ok: true, supabase: await createClient(), member: current.member, capabilities: inventoryCapabilities(current) };
  } catch {
    console.error("[inventory] could not create the Supabase client");
    return { ok: false, error: { code: "unavailable" } };
  }
}
