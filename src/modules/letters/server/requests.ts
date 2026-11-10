import "server-only";
import {
  readLetterQueue,
  readLetterQueueCounts,
  readLetterRequestDetail,
  readMyLetterRequestCaps,
  readMyLetterRequests,
} from "@/lib/picore/letters";
import {
  letterQueueQuerySchema,
  myLetterRequestsQuerySchema,
  type LetterQueueCounts,
  type LetterQueuePage,
  type LetterQueueQueryInput,
  type LetterRequestCaps,
  type LetterRequestDetail,
  type LetterResult,
  type MyLetterRequestsPage,
  type MyLetterRequestsQueryInput,
} from "../types";
import { requireLetters } from "./access";
import { idInputSchema, parseInput, safely } from "./validation";

// Request reads (contract section 12). Session + capability first, validation, then ONE database
// function with the user's client. Request visibility (own request or letter_requests.view_all) is
// decided by the database: a request the caller may not see is not_found "request", exactly like a
// missing one.

/** "Permohonan Saya": own requests only (L9; any active member). */
export async function listMyRequests(input: MyLetterRequestsQueryInput = {}): Promise<LetterResult<MyLetterRequestsPage>> {
  return safely("listMyRequests", async () => {
    const gate = await requireLetters("canViewOwnRequests");
    if (!gate.ok) return gate;
    const parsed = parseInput(myLetterRequestsQuerySchema, input);
    if (!parsed.ok) return parsed;
    return readMyLetterRequests(gate.supabase, parsed.data.filter, parsed.data.page, parsed.data.pageSize);
  });
}

/** The caller's own caps (header box, cap alert above the request form, lone-processor hint). */
export async function getMyRequestCaps(): Promise<LetterResult<LetterRequestCaps>> {
  return safely("getMyRequestCaps", async () => {
    const gate = await requireLetters("canViewOwnRequests");
    if (!gate.ok) return gate;
    return readMyLetterRequestCaps(gate.supabase);
  });
}

/** Antrean (letter_requests.view_all). */
export async function listRequestQueue(input: LetterQueueQueryInput = {}): Promise<LetterResult<LetterQueuePage>> {
  return safely("listRequestQueue", async () => {
    const gate = await requireLetters("canViewAllRequests");
    if (!gate.ok) return gate;
    const parsed = parseInput(letterQueueQuerySchema, input);
    if (!parsed.ok) return parsed;
    return readLetterQueue(gate.supabase, parsed.data.filters, parsed.data.page, parsed.data.pageSize);
  });
}

/** "Tampilkan" option counts, "Antrean (n)" and the lone-processor hint (counts only). */
export async function getLetterQueueCounts(): Promise<LetterResult<LetterQueueCounts>> {
  return safely("getLetterQueueCounts", async () => {
    const gate = await requireLetters("canViewAllRequests");
    if (!gate.ok) return gate;
    return readLetterQueueCounts(gate.supabase);
  });
}

/** Request detail. Requester or view_all (database decides); a malformed id answers not_found "request". */
export async function getRequestDetail(requestId: string): Promise<LetterResult<LetterRequestDetail>> {
  return safely("getRequestDetail", async () => {
    const gate = await requireLetters("canViewOwnRequests");
    if (!gate.ok) return gate;
    const id = idInputSchema.safeParse(requestId);
    if (!id.success) return { ok: false, error: { code: "not_found", entity: "request" } };
    return readLetterRequestDetail(gate.supabase, id.data);
  });
}
