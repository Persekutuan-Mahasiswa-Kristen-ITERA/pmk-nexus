"use server";

import "server-only";
import { getAccessState } from "@/lib/auth/session";
import type { AccessState } from "@/lib/auth/types";
import { readLetterFileLink } from "@/lib/picore/letters";
import {
  LETTER_FILE_SIGNED_URL_TTL_SECONDS,
  letterFileLinkSchema,
  type LetterFileLink,
  type LetterFileLinkInput,
  type LetterResult,
} from "../types";
import { requireLetters } from "./access";
import { parseInput, safely } from "./validation";

// "Lihat" / "Unduh" on a letter file or a request attachment (design 3.3: the link is made at the
// press, so it never expires under an open page). The database decides which files this caller may
// read; the path never leaves the server. Short-lived: LETTER_FILE_SIGNED_URL_TTL_SECONDS (300 s).

export async function getLetterFileLink(input: LetterFileLinkInput): Promise<LetterResult<LetterFileLink>> {
  return safely("getLetterFileLink", async () => {
    let state: AccessState;
    try {
      state = await getAccessState();
    } catch {
      state = { kind: "error" };
    }
    // Every active member may open files of their own requests; the parent decides the rest.
    const g = await requireLetters("canViewOwnRequests", state);
    if (!g.ok) return g;
    const parsed = parseInput(letterFileLinkSchema, input);
    if (!parsed.ok) return parsed;
    if (parsed.data.parent === "letter" && !g.capabilities.canViewRegister) return { ok: false, error: { code: "forbidden" } };
    return readLetterFileLink(g.supabase, parsed.data, LETTER_FILE_SIGNED_URL_TTL_SECONDS);
  });
}
