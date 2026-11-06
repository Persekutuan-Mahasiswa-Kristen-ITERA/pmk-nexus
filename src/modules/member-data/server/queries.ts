import "server-only";
import {
  readActiveMemberCount,
  readMemberExportLog,
  readMemberList,
  readMemberUnitOptions,
} from "@/lib/picore/member-data";
import {
  memberExportLogQuerySchema,
  memberListQuerySchema,
  type MemberDataResult,
  type MemberExportLogPage,
  type MemberExportLogQueryInput,
  type MemberListPage,
  type MemberListQueryInput,
  type MemberUnitOption,
} from "../types";
import { requireMemberData } from "./access";
import { invalidInput } from "./validation";

// Read functions for the Data Anggota page, the Dashboard card and the (future) export-log screen.
// Order in each: session + permission (server), then input validation, then the database function,
// which checks the permission again (defense in depth). None of them throws.
// Permission is checked before validation so a caller without access learns nothing from the inputs.

/** The list page (F1-F4). Needs member_data.view. */
export async function listMembers(input: MemberListQueryInput = {}): Promise<MemberDataResult<MemberListPage>> {
  const gate = await requireMemberData("canView");
  if (!gate.ok) return gate;
  const parsed = memberListQuerySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: invalidInput(parsed.error) };
  return readMemberList(gate.supabase, parsed.data);
}

/** Unit filter options (F3, R5). Needs member_data.view. */
export async function getMemberUnitOptions(): Promise<MemberDataResult<MemberUnitOption[]>> {
  const gate = await requireMemberData("canView");
  if (!gate.ok) return gate;
  return readMemberUnitOptions(gate.supabase);
}

/** Dashboard "Members" number (M5b, MD-38). Needs member_data.view. */
export async function getActiveMemberCount(): Promise<MemberDataResult<number>> {
  const gate = await requireMemberData("canView");
  if (!gate.ok) return gate;
  return readActiveMemberCount(gate.supabase);
}

/** Export log, newest first (spec 4.2, MD-34). System Admin or member_data.view_export_log. */
export async function listMemberExportLog(
  input: MemberExportLogQueryInput = {},
): Promise<MemberDataResult<MemberExportLogPage>> {
  const gate = await requireMemberData("canViewExportLog");
  if (!gate.ok) return gate;
  const parsed = memberExportLogQuerySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: invalidInput(parsed.error) };
  return readMemberExportLog(gate.supabase, parsed.data);
}
