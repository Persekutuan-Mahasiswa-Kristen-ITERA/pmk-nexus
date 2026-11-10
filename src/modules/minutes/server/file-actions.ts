"use server";

import "server-only";
import { getAccessState } from "@/lib/auth/session";
import type { AccessState } from "@/lib/auth/types";
import { readMinuteFileLink } from "@/lib/picore/minutes";
import {
  MINUTE_FILE_SIGNED_URL_TTL_SECONDS,
  minuteFileLinkSchema,
  type MinuteFileLink,
  type MinuteFileLinkInput,
  type MinuteResult,
} from "../types";
import { requireMinutes } from "./access";
import { parseInput, safely } from "./validation";

// "Lihat" on an attachment (spec 4.4: the link is made at the press, so it never expires under an open
// page). The database decides which files this caller may read (withdrawn ones only for managers of
// the unit); the path never leaves the server. Short-lived: MINUTE_FILE_SIGNED_URL_TTL_SECONDS (300 s).

export async function getMinuteFileLink(input: MinuteFileLinkInput): Promise<MinuteResult<MinuteFileLink>> {
  return safely("getMinuteFileLink", async () => {
    let state: AccessState;
    try {
      state = await getAccessState();
    } catch {
      state = { kind: "error" };
    }
    const g = await requireMinutes("canView", state);
    if (!g.ok) return g;
    const parsed = parseInput(minuteFileLinkSchema, input);
    if (!parsed.ok) return parsed;
    return readMinuteFileLink(g.supabase, parsed.data, MINUTE_FILE_SIGNED_URL_TTL_SECONDS);
  });
}
