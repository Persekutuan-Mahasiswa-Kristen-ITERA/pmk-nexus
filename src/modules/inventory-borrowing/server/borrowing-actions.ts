"use server";

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAccessState } from "@/lib/auth/session";
import {
  approveBorrowingRequest,
  cancelBorrowingRequest,
  correctBorrowingReturn,
  createBorrowingRequest,
  extendBorrowingRequest,
  handOverBorrowingRequest,
  readItemAvailability,
  readRequestDetail,
  rejectBorrowingRequest,
  returnBorrowingRequest,
} from "@/lib/picore/inventory-borrowing";
import {
  addDays,
  jakartaToday,
  rangeDays,
  requestApproveSchema,
  requestCancelSchema,
  requestCorrectReturnSchema,
  requestCreateSchema,
  requestExtendSchema,
  requestHandOverSchema,
  requestRejectSchema,
  requestReturnSchema,
  type InventoryResult,
  type RequestApproveInput,
  type RequestCancelInput,
  type RequestCorrectReturnInput,
  type RequestCreateInput,
  type RequestCreateResult,
  type RequestExtendInput,
  type RequestHandOverInput,
  type RequestRejectInput,
  type RequestReturnInput,
  type RequestTransitionResult,
} from "../types";
import { requireInventory, type InventoryCapability, type InventoryGate } from "./access";
import { parseInput, safely, startInPast } from "./validation";

// Server Actions for the borrowing state machine (spec section 4). Each: session check
// (getAccessState) + capability first, zod validation, then ONE database function with the user's
// client. The database re-checks everything: L1, the key, the active period, the version ("Data sudah
// berubah"), the status, L6 (never approve/reject/extend your own request) and stock under item locks.
// The requester is always the session member, never an input (IB-14). Never throws.

async function gate(capability: InventoryCapability): Promise<InventoryGate> {
  let state;
  try {
    state = await getAccessState();
  } catch {
    state = { kind: "error" } as const;
  }
  return requireInventory(capability, state);
}

/** "Ajukan Peminjaman" (F3); "Untuk pihak luar" (F10) needs borrowing.handle. */
export async function submitRequest(input: RequestCreateInput): Promise<InventoryResult<RequestCreateResult>> {
  return safely("submitRequest", async () => {
    const g = await gate("canViewOwnRequests");
    if (!g.ok) return g;
    const parsed = parseInput(requestCreateSchema, input);
    if (!parsed.ok) return parsed;
    if (!g.capabilities.hasActivePeriod) return { ok: false, error: { code: "no_active_period" } };
    if (parsed.data.outsideParty !== null && !g.capabilities.canRecordOutsideParty) {
      return { ok: false, error: { code: "forbidden" } };
    }
    const past = startInPast(parsed.data.startDate, "startDate");
    if (past) return { ok: false, error: past };
    return createBorrowingRequest(g.supabase, parsed.data);
  });
}

/** "Setujui" (heads; never own, L6). */
export async function approveRequest(input: RequestApproveInput): Promise<InventoryResult<RequestTransitionResult>> {
  return safely("approveRequest", async () => {
    const g = await gate("canApprove");
    if (!g.ok) return g;
    const parsed = parseInput(requestApproveSchema, input);
    if (!parsed.ok) return parsed;
    return approveBorrowingRequest(g.supabase, parsed.data);
  });
}

/** "Tolak" (heads; never own, L6; note required). */
export async function rejectRequest(input: RequestRejectInput): Promise<InventoryResult<RequestTransitionResult>> {
  return safely("rejectRequest", async () => {
    const g = await gate("canApprove");
    if (!g.ok) return g;
    const parsed = parseInput(requestRejectSchema, input);
    if (!parsed.ok) return parsed;
    return rejectBorrowingRequest(g.supabase, parsed.data);
  });
}

/**
 * "Ubah tanggal kembali" (heads; never own, L6). On insufficient_stock the first short day of the
 * added range is looked up with the availability function and returned as conflictDate (A-IB53);
 * null when it cannot be found reliably.
 */
export async function extendRequest(input: RequestExtendInput): Promise<InventoryResult<RequestTransitionResult>> {
  return safely("extendRequest", async () => {
    const g = await gate("canApprove");
    if (!g.ok) return g;
    const parsed = parseInput(requestExtendSchema, input);
    if (!parsed.ok) return parsed;
    const result = await extendBorrowingRequest(g.supabase, parsed.data);
    if (result.ok || result.error.code !== "insufficient_stock" || result.error.itemId === null) return result;
    if (!g.capabilities.canViewCatalog) return result;
    const conflictDate = await findConflictDate(g.supabase, parsed.data.requestId, result.error.itemId, parsed.data.newEndDate);
    return { ok: false, error: { ...result.error, conflictDate } };
  });
}

/** Most availability calls one conflict lookup may make (binary search over at most 366 days). */
const MAX_LOOKUPS = 12;

/**
 * The first day in the added range [max(old end + 1, today), new end] on which the item is short for
 * this request. The availability function gives the free quantity over a range (peak day), which only
 * shrinks as the range grows, so a binary search over the range end finds the first short day.
 * Not attempted for an overdue loan: its own holding is open-ended and counted in the availability,
 * and the function clamps free at 0, so "exactly enough" and "short" look the same (A-IB53: null).
 */
async function findConflictDate(
  supabase: SupabaseClient,
  requestId: string,
  itemId: string,
  newEndDate: string,
): Promise<string | null> {
  const detail = await readRequestDetail(supabase, requestId);
  if (!detail.ok) return null;
  const request = detail.data;
  if (request.isOverdue || (request.status !== "approved" && request.status !== "borrowed")) return null;
  const line = request.lines.find((l) => l.itemId === itemId);
  if (!line) return null;
  const needed = request.status === "approved" ? line.quantityApproved ?? 0 : line.outstanding;
  if (needed <= 0) return null;

  const today = jakartaToday();
  const dayAfterEnd = addDays(request.endDate, 1);
  const from = dayAfterEnd > today ? dayAfterEnd : today;
  if (from > newEndDate) return null;

  let lookups = 0;
  // true = short on some day of [from, end]; null = could not tell.
  const shortUntil = async (end: string): Promise<boolean | null> => {
    if (lookups >= MAX_LOOKUPS) return null;
    lookups += 1;
    const free = await readItemAvailability(supabase, itemId, from, end);
    return free.ok ? free.data.freeQty < needed : null;
  };

  const whole = await shortUntil(newEndDate);
  if (whole !== true) return null; // stock changed since, or unknown
  let lo = 0;
  let hi = rangeDays(from, newEndDate) - 1; // known short at hi
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const short = await shortUntil(addDays(from, mid));
    if (short === null) return null;
    if (short) hi = mid;
    else lo = mid + 1;
  }
  return addDays(from, lo);
}

/** "Batalkan pengajuan": requester of record, or borrowing.handle (approved only). The database decides. */
export async function cancelRequest(input: RequestCancelInput): Promise<InventoryResult<RequestTransitionResult>> {
  return safely("cancelRequest", async () => {
    const g = await gate("canViewOwnRequests");
    if (!g.ok) return g;
    const parsed = parseInput(requestCancelSchema, input);
    if (!parsed.ok) return parsed;
    return cancelBorrowingRequest(g.supabase, parsed.data);
  });
}

/** "Catat serah terima" (borrowing.handle; own request allowed). */
export async function handOverRequest(input: RequestHandOverInput): Promise<InventoryResult<RequestTransitionResult>> {
  return safely("handOverRequest", async () => {
    const g = await gate("canHandle");
    if (!g.ok) return g;
    const parsed = parseInput(requestHandOverSchema, input);
    if (!parsed.ok) return parsed;
    return handOverBorrowingRequest(g.supabase, parsed.data);
  });
}

/** "Catat pengembalian" (borrowing.handle). Photos must already be uploaded into this request's folder. */
export async function recordReturn(input: RequestReturnInput): Promise<InventoryResult<RequestTransitionResult>> {
  return safely("recordReturn", async () => {
    const g = await gate("canHandle");
    if (!g.ok) return g;
    const parsed = parseInput(requestReturnSchema, input);
    if (!parsed.ok) return parsed;
    return returnBorrowingRequest(g.supabase, {
      requestId: parsed.data.requestId,
      version: parsed.data.version,
      outcomes: parsed.data.outcomes.map((o) => ({
        lineId: o.lineId,
        outcome: o.outcome,
        quantity: o.quantity,
        unitId: o.unitId,
        resultingCondition: o.outcome === "damaged" ? o.resultingCondition : undefined,
        note: o.note,
        photos: o.outcome === "good" ? undefined : o.photos,
      })),
    });
  });
}

/** "Koreksi pengembalian" (borrowing.handle; once per request, active period only). */
export async function correctReturn(input: RequestCorrectReturnInput): Promise<InventoryResult<RequestTransitionResult>> {
  return safely("correctReturn", async () => {
    const g = await gate("canHandle");
    if (!g.ok) return g;
    const parsed = parseInput(requestCorrectReturnSchema, input);
    if (!parsed.ok) return parsed;
    return correctBorrowingReturn(g.supabase, parsed.data);
  });
}
