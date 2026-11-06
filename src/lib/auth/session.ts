import "server-only";
import { cache } from "react";
import { readMyContext, readMyPermissions, readPasswordChangePending } from "@/lib/picore/context";
import { verifySession } from "@/lib/supabase/claims";
import { createClient } from "@/lib/supabase/server";
import type { AccessState } from "./types";

/**
 * The single session check (spec 8.2, AR8). Every protected page, route handler, and Server Action
 * calls it and acts on the result; the proxy is only a coarse first gate.
 *
 * Order (D-015): anonymous > error > no_access > password_pending > member.
 * Fail closed: any failed or odd answer becomes "error" (never "member", never "no_access"), and the
 * session is kept, because the problem may be on our side (AR10).
 *
 * Cached per request only (React cache), never across requests (AR4, R3).
 */
export const getAccessState = cache(async (): Promise<AccessState> => {
  let supabase: Awaited<ReturnType<typeof createClient>>;
  try {
    supabase = await createClient();
  } catch {
    console.error("[auth] could not create the Supabase client (check NEXT_PUBLIC_SUPABASE_* env)");
    return { kind: "error" };
  }

  // 1. Validate the JWT before asking the database anything.
  const session = await verifySession(supabase);
  if (session.kind === "anonymous") return { kind: "anonymous" };
  if (session.kind === "unavailable") return { kind: "error" };

  // 2. Identity and temporary-password flag, both with the user's own session. Run together to save a
  //    round trip; either failing makes the whole answer "error" (error outranks no_access).
  const [context, pending] = await Promise.all([readMyContext(supabase), readPasswordChangePending(supabase)]);
  if (!context.ok || !pending.ok) return { kind: "error" };
  if (context.data === null) return { kind: "no_access" };
  if (pending.data) return { kind: "password_pending" };

  // 3. Permissions only for a full member (spec 8.2).
  const permissions = await readMyPermissions(supabase);
  if (!permissions.ok) return { kind: "error" };

  return { kind: "member", member: context.data, permissions: permissions.data };
});
