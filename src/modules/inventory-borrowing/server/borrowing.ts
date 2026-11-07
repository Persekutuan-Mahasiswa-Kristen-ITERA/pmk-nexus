import "server-only";
import {
  readBorrowingPeriods,
  readEvidencePhotoLinks,
  readHandoverUnits,
  readMyRequests,
  readOpenLoans,
  readQueue,
  readQueueCounts,
  readRequestDetail,
  readRequestDetailByReference,
} from "@/lib/picore/inventory-borrowing";
import {
  EVIDENCE_SIGNED_URL_TTL_SECONDS,
  myRequestsQuerySchema,
  queueQuerySchema,
  requestReferenceSchema,
  type BorrowingPeriod,
  type EvidencePhotoLink,
  type HandoverUnit,
  type InventoryResult,
  type MyRequestsPage,
  type MyRequestsQueryInput,
  type OpenLoanRow,
  type QueueCounts,
  type QueuePage,
  type QueueQueryInput,
  type RequestDetail,
} from "../types";
import { requireInventory } from "./access";
import { idInputSchema, parseInput, safely } from "./validation";

// Borrowing reads (contract section 12). Session + capability first, validation, then ONE database
// function with the user's client. Request visibility (own request or borrowing.view_all) is decided by
// the database: a request the caller may not see is not_found "request", exactly like a missing one (R8).

/** "Peminjaman Saya": own requests only (L9; any active member). */
export async function listMyRequests(input: MyRequestsQueryInput = {}): Promise<InventoryResult<MyRequestsPage>> {
  return safely("listMyRequests", async () => {
    const gate = await requireInventory("canViewOwnRequests");
    if (!gate.ok) return gate;
    const parsed = parseInput(myRequestsQuerySchema, input);
    if (!parsed.ok) return parsed;
    return readMyRequests(gate.supabase, parsed.data.filter, parsed.data.page, parsed.data.pageSize);
  });
}

/** Antrean (borrowing.view_all), incl. the period filter. */
export async function listQueue(input: QueueQueryInput = {}): Promise<InventoryResult<QueuePage>> {
  return safely("listQueue", async () => {
    const gate = await requireInventory("canViewAllRequests");
    if (!gate.ok) return gate;
    const parsed = parseInput(queueQuerySchema, input);
    if (!parsed.ok) return parsed;
    return readQueue(gate.supabase, parsed.data.filters, parsed.data.page, parsed.data.pageSize);
  });
}

/** "Tampilkan" option counts and "Antrean (n)". */
export async function getQueueCounts(): Promise<InventoryResult<QueueCounts>> {
  return safely("getQueueCounts", async () => {
    const gate = await requireInventory("canViewAllRequests");
    if (!gate.ok) return gate;
    return readQueueCounts(gate.supabase);
  });
}

/** Every unfinished request of every period (period handover, F11.5). */
export async function listOpenLoans(): Promise<InventoryResult<OpenLoanRow[]>> {
  return safely("listOpenLoans", async () => {
    const gate = await requireInventory("canViewAllRequests");
    if (!gate.ok) return gate;
    return readOpenLoans(gate.supabase);
  });
}

/** Period choices for the queue and export filter (PI-CORE periods, newest first). */
export async function listBorrowingPeriods(): Promise<InventoryResult<BorrowingPeriod[]>> {
  return safely("listBorrowingPeriods", async () => {
    const gate = await requireInventory("canViewAllRequests");
    if (!gate.ok) return gate;
    return readBorrowingPeriods(gate.supabase);
  });
}

/** "Detail Pengajuan" by id. Requester of record or borrowing.view_all (database decides). */
export async function getRequestDetail(requestId: string): Promise<InventoryResult<RequestDetail>> {
  return safely("getRequestDetail", async () => {
    const gate = await requireInventory("canViewOwnRequests");
    if (!gate.ok) return gate;
    const id = idInputSchema.safeParse(requestId);
    if (!id.success) return { ok: false, error: { code: "invalid_input", field: "requestId" } };
    return readRequestDetail(gate.supabase, id.data);
  });
}

/** "Detail Pengajuan" by reference (/inventaris/pengajuan/{ref}); "pjm-0001" works. */
export async function getRequestDetailByReference(reference: string): Promise<InventoryResult<RequestDetail>> {
  return safely("getRequestDetailByReference", async () => {
    const gate = await requireInventory("canViewOwnRequests");
    if (!gate.ok) return gate;
    const ref = requestReferenceSchema.safeParse(reference);
    if (!ref.success) return { ok: false, error: { code: "invalid_input", field: "reference" } };
    return readRequestDetailByReference(gate.supabase, ref.data);
  });
}

/** Units a handler may tick on "Catat serah terima" (borrowing.handle). */
export async function listHandoverUnits(requestId: string): Promise<InventoryResult<HandoverUnit[]>> {
  return safely("listHandoverUnits", async () => {
    const gate = await requireInventory("canHandle");
    if (!gate.ok) return gate;
    const id = idInputSchema.safeParse(requestId);
    if (!id.success) return { ok: false, error: { code: "invalid_input", field: "requestId" } };
    return readHandoverUnits(gate.supabase, id.data);
  });
}

/**
 * Signed links (EVIDENCE_SIGNED_URL_TTL_SECONDS = 300 s, A-IB51) for every photo attached to the
 * request. Requester of record or borrowing.view_all: the request detail decides (else not_found), and
 * the bucket policy borrowing_evidence_can_read checks each file again when it is signed.
 */
export async function getEvidencePhotoLinks(requestId: string): Promise<InventoryResult<EvidencePhotoLink[]>> {
  return safely("getEvidencePhotoLinks", async () => {
    const gate = await requireInventory("canViewOwnRequests");
    if (!gate.ok) return gate;
    const id = idInputSchema.safeParse(requestId);
    if (!id.success) return { ok: false, error: { code: "invalid_input", field: "requestId" } };
    return readEvidencePhotoLinks(gate.supabase, id.data, EVIDENCE_SIGNED_URL_TTL_SECONDS);
  });
}
