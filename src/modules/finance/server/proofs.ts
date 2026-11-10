import "server-only";
import { randomUUID } from "node:crypto";
import type { AccessState } from "@/lib/auth/types";
import { isSameOriginRequest, readCappedBody } from "@/lib/http/request";
import { uploadFinanceProof } from "@/lib/picore/finance";
import {
  FINANCE_PROOF_MAX_BYTES,
  FINANCE_PROOF_MAX_MB,
  FINANCE_PROOF_UPLOAD_FIELDS,
  cleanFinanceProofName,
  financeProofPath,
  financeUploadFileSchema,
  sniffFinanceProofType,
  type FinanceError,
  type FinanceProofUploadResult,
} from "../types";
import { requireFinance } from "./access";
import { financeErrorResponse, financeMethodNotAllowed } from "./http";

// POST /api/finance/proofs (contract section 13, spec 4.4, FN-25): one proof file, uploaded when it is
// picked (before the entry exists or is saved). Order: same-origin check (CSRF) -> session ->
// finance.manage -> active period -> multipart body capped near the limit -> exactly one "file" field ->
// declared type and size -> the file's real type from its first bytes (magic bytes) must match the
// declared type -> upload with the USER's client (never the service role) into the caller's OWN folder
// under a fresh random name, no overwrite. The bucket policy finance_proof_can_upload checks again
// (manage holder, own folder, active period, at most 10 unattached uploads in 24 hours). The answer is the
// path and the cleaned name; the save action attaches them (and the database checks them again).

/** Room for the multipart boundary and the field header around a file at the bucket limit. */
const MULTIPART_OVERHEAD_BYTES = 16 * 1024;

const TOO_LARGE: FinanceError = { code: "file_too_large", field: "file", ref: null, maxMb: FINANCE_PROOF_MAX_MB };
const INVALID_FILE: FinanceError = { code: "invalid_file", field: "file", ref: null };
const BAD_REQUEST: FinanceError = { code: "invalid_input", field: "request" };

const json = (result: FinanceProofUploadResult) => Response.json(result, { status: 200, headers: { "Cache-Control": "no-store" } });

export async function handleFinanceProofUpload(request: Request, readAccessState: () => Promise<AccessState>): Promise<Response> {
  if (request.method !== "POST") return financeMethodNotAllowed();
  if (!isSameOriginRequest(request)) return financeErrorResponse({ code: "forbidden" });

  let state: AccessState;
  try {
    state = await readAccessState();
  } catch {
    return financeErrorResponse({ code: "unavailable" });
  }
  const gate = await requireFinance("canManage", state);
  if (!gate.ok) return financeErrorResponse(gate.error);
  if (!gate.capabilities.canUploadProof) return financeErrorResponse({ code: "no_active_period" });

  // Keep the raw header for parsing: the multipart boundary is case-sensitive (WebKit sends mixed case).
  const rawType = request.headers.get("content-type") ?? "";
  if (!rawType.toLowerCase().startsWith("multipart/form-data")) return financeErrorResponse(BAD_REQUEST);

  // Over the cap = a file above the bucket limit (the browser resizes images first): file_too_large.
  const body = await readCappedBody(request, FINANCE_PROOF_MAX_BYTES + MULTIPART_OVERHEAD_BYTES);
  if (!body) return financeErrorResponse(TOO_LARGE);

  let form: FormData;
  try {
    form = await new Response(body, { headers: { "content-type": rawType } }).formData();
  } catch {
    return financeErrorResponse(BAD_REQUEST);
  }

  // Exactly one file, nothing else (contract FINANCE_PROOF_UPLOAD_FIELDS).
  const names = [...form.keys()];
  if (names.some((name) => name !== FINANCE_PROOF_UPLOAD_FIELDS.file)) return financeErrorResponse(BAD_REQUEST);
  const files = form.getAll(FINANCE_PROOF_UPLOAD_FIELDS.file);
  const file = files[0];
  if (files.length !== 1 || typeof file === "string") return financeErrorResponse({ code: "invalid_input", field: "file" });

  // Size first, so a too-large file gets its own text (invalid_file stays for the format).
  if (file.size > FINANCE_PROOF_MAX_BYTES) return financeErrorResponse(TOO_LARGE);
  const declared = financeUploadFileSchema.safeParse({ type: file.type, size: file.size });
  if (!declared.success) {
    const tooLarge = declared.error.issues.some((issue) => issue.message === "file_too_large");
    return financeErrorResponse(tooLarge ? TOO_LARGE : INVALID_FILE);
  }
  const type = declared.data.type;

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    return financeErrorResponse({ code: "invalid_input", field: "file" });
  }
  // The declared type is only a claim: the first bytes must say the same (FN-25).
  if (bytes.byteLength > FINANCE_PROOF_MAX_BYTES) return financeErrorResponse(TOO_LARGE);
  if (bytes.byteLength !== declared.data.size || sniffFinanceProofType(bytes) !== type) return financeErrorResponse(INVALID_FILE);

  // The folder is the caller's own members.id from the session, never from the request.
  const path = financeProofPath(gate.member.memberId, randomUUID(), type);
  const uploaded = await uploadFinanceProof(gate.supabase, path, bytes, type, cleanFinanceProofName(file.name, type));
  if (!uploaded.ok) return financeErrorResponse(uploaded.error);
  return json(uploaded.data);
}
