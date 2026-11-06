import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { MemberContext, PermissionGrant } from "@/lib/auth/types";

// Readers for the caller's own identity and rights. These nexus RPCs read PI-CORE tables under the
// caller's session (supabase/README.md section 3), so they live here and nowhere else (CLAUDE.md 4).
// Every answer is validated: an unexpected shape is an error, never a grant (fail closed).
// Only src/lib/auth/session.ts may call these (AUTH-41).

/** ok:false means "could not tell": the caller must show the error state, not "no access". */
export type PicoreRead<T> = { ok: true; data: T } | { ok: false };

const uuid = z.guid(); // Postgres uuid text form; z.guid() also accepts seeded non-RFC ids.

const contextRow = z.object({
  member_id: uuid,
  full_name: z.string(),
  member_type: z.enum(["student", "lecturer"]),
  is_system_admin: z.boolean(),
  active_period_id: uuid.nullable(),
  active_period_label: z.string().nullable(),
});

const permissionRow = z
  .object({
    permission_key: z.string().min(1),
    scope: z.enum(["all", "units"]),
    unit_ids: z.array(uuid),
    is_sensitive: z.boolean(),
  })
  // my_permissions() returns no units for "all" and at least one for "units". Anything else is unexpected.
  .refine((row) => (row.scope === "all" ? row.unit_ids.length === 0 : row.unit_ids.length > 0));

/**
 * nexus.my_context(). data null = 0 rows = No access (L1: inactive or unlinked, one state, D-016).
 * More than one row is impossible by design (one member per user, one active period): fail closed.
 */
export async function readMyContext(supabase: SupabaseClient): Promise<PicoreRead<MemberContext | null>> {
  const rows = await callRpc(supabase, "my_context", z.array(contextRow));
  if (!rows.ok) return rows;
  if (rows.data.length === 0) return { ok: true, data: null };
  if (rows.data.length > 1) return fail("my_context", "more_than_one_row");
  const row = rows.data[0];
  return {
    ok: true,
    data: {
      memberId: row.member_id,
      fullName: row.full_name,
      memberType: row.member_type,
      isSystemAdmin: row.is_system_admin,
      activePeriodId: row.active_period_id,
      activePeriodLabel: row.active_period_label,
    },
  };
}

/** nexus.my_password_change_pending() (D-015). Only exactly true or false is accepted. */
export async function readPasswordChangePending(supabase: SupabaseClient): Promise<PicoreRead<boolean>> {
  return callRpc(supabase, "my_password_change_pending", z.boolean());
}

/** nexus.my_permissions(): the caller's effective permissions in the active period (union of assignments). */
export async function readMyPermissions(supabase: SupabaseClient): Promise<PicoreRead<PermissionGrant[]>> {
  const rows = await callRpc(supabase, "my_permissions", z.array(permissionRow));
  if (!rows.ok) return rows;
  return {
    ok: true,
    data: rows.data.map((row) => ({
      key: row.permission_key,
      scope: row.scope,
      unitIds: row.unit_ids,
      isSensitive: row.is_sensitive,
    })),
  };
}

type NexusRpc = "my_context" | "my_password_change_pending" | "my_permissions";

/** Calls a parameterless nexus RPC with the USER's client and validates the answer. Never throws. */
async function callRpc<T>(supabase: SupabaseClient, fn: NexusRpc, schema: z.ZodType<T>): Promise<PicoreRead<T>> {
  try {
    const { data, error } = await supabase.schema("nexus").rpc(fn);
    // Covers network failures, `nexus` not in Exposed schemas (PGRST106), permission denied (42501), 5xx.
    if (error) return fail(fn, error.code || "rpc_error");
    const parsed = schema.safeParse(data);
    if (!parsed.success) return fail(fn, "unexpected_shape");
    return { ok: true, data: parsed.data };
  } catch {
    return fail(fn, "exception");
  }
}

function fail(fn: NexusRpc, reason: string): { ok: false } {
  // Function name and code only: never tokens, user ids, or row data in logs.
  console.error(`[picore] nexus.${fn}() failed: ${reason}`);
  return { ok: false };
}
