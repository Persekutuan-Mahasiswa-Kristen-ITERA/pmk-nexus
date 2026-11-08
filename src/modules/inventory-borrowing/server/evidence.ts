import "server-only";
import { randomUUID } from "node:crypto";
import type { AccessState } from "@/lib/auth/types";
import { isSameOriginRequest, readCappedBody } from "@/lib/http/request";
import { uploadEvidencePhoto } from "@/lib/picore/inventory-borrowing";
import {
  EVIDENCE_MAX_BYTES,
  EVIDENCE_UPLOAD_FIELDS,
  evidencePhotoPath,
  evidenceUploadSchema,
  type EvidenceMimeType,
  type EvidenceUploadResult,
} from "../types";
import { requireInventory } from "./access";
import { inventoryErrorResponse, inventoryMethodNotAllowed } from "./export";
import { parseInput } from "./validation";

// POST /api/inventory/evidence (A-IB50, design 13.3): one evidence photo for a return being recorded.
// Order: same-origin check (CSRF) -> session + borrowing.handle -> multipart fields -> declared type and
// size (evidenceFileSchema) -> the file's real type from its first bytes (magic bytes) must match the
// declared type -> upload with the USER's client (never the service role) to the private bucket under a
// fresh random name, no overwrite. The bucket policy borrowing_evidence_can_upload checks again: only a
// borrowing.handle holder, only while the request is Dipinjam, at most 10 unattached files per request.
// The answer is only the storage path; the return action attaches it (and checks it again).

/** Room for the multipart boundaries and the two field headers around a file at the bucket limit. */
const MULTIPART_OVERHEAD_BYTES = 16 * 1024;

/** Known image signatures. WebP = "RIFF" <4-byte size> "WEBP". */
function sniffImageType(bytes: Uint8Array): EvidenceMimeType | null {
  const at = (offset: number, sig: readonly number[]) => sig.every((b, i) => bytes[offset + i] === b);
  if (bytes.length >= 3 && at(0, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (bytes.length >= 8 && at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (bytes.length >= 12 && at(0, [0x52, 0x49, 0x46, 0x46]) && at(8, [0x57, 0x45, 0x42, 0x50])) return "image/webp";
  return null;
}

const INVALID_PHOTO = { code: "invalid_photo", ref: null } as const;
/** Over the bucket limit (design 13.3 text "Foto terlalu besar. Pakai foto di bawah {max} MB."). */
const TOO_LARGE = { code: "photo_too_large", maxMb: EVIDENCE_MAX_BYTES / (1024 * 1024) } as const;

export async function handleEvidenceUpload(request: Request, readAccessState: () => Promise<AccessState>): Promise<Response> {
  if (request.method !== "POST") return inventoryMethodNotAllowed();
  if (!isSameOriginRequest(request)) return inventoryErrorResponse({ code: "forbidden" });

  let state: AccessState;
  try {
    state = await readAccessState();
  } catch {
    return inventoryErrorResponse({ code: "unavailable" });
  }
  const gate = await requireInventory("canHandle", state);
  if (!gate.ok) return inventoryErrorResponse(gate.error);

  // Keep the raw header for parsing: the multipart boundary is case-sensitive (WebKit sends mixed case).
  const rawType = request.headers.get("content-type") ?? "";
  const type = rawType.toLowerCase();
  if (!type.startsWith("multipart/form-data")) return inventoryErrorResponse({ code: "invalid_input", field: "request" });

  // Over the cap = a file above the bucket limit (the browser resizes first): photo_too_large.
  const body = await readCappedBody(request, EVIDENCE_MAX_BYTES + MULTIPART_OVERHEAD_BYTES);
  if (!body) return inventoryErrorResponse(TOO_LARGE);

  let form: FormData;
  try {
    form = await new Response(body, { headers: { "content-type": rawType } }).formData();
  } catch {
    return inventoryErrorResponse({ code: "invalid_input", field: "request" });
  }

  const requestIds = form.getAll(EVIDENCE_UPLOAD_FIELDS.requestId);
  const files = form.getAll(EVIDENCE_UPLOAD_FIELDS.file);
  if (requestIds.length !== 1 || typeof requestIds[0] !== "string") {
    return inventoryErrorResponse({ code: "invalid_input", field: "requestId" });
  }
  const file = files[0];
  if (files.length !== 1 || typeof file === "string") return inventoryErrorResponse({ code: "invalid_input", field: "file" });

  // Size first, so a too-large file gets its own text (invalid_photo stays for the format).
  if (file.size > EVIDENCE_MAX_BYTES) return inventoryErrorResponse(TOO_LARGE);
  const parsed = parseInput(evidenceUploadSchema, { requestId: requestIds[0], file: { type: file.type, size: file.size } });
  if (!parsed.ok) return inventoryErrorResponse(parsed.error);
  const declared = parsed.data.file.type;

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    return inventoryErrorResponse({ code: "invalid_input", field: "file" });
  }
  // The declared type is only a claim: the first bytes must say the same (A-IB50).
  if (bytes.byteLength > EVIDENCE_MAX_BYTES) return inventoryErrorResponse(TOO_LARGE);
  if (bytes.byteLength !== parsed.data.file.size || sniffImageType(bytes) !== declared) {
    return inventoryErrorResponse(INVALID_PHOTO);
  }

  const path = evidencePhotoPath(parsed.data.requestId, randomUUID(), declared);
  const uploaded = await uploadEvidencePhoto(gate.supabase, path, bytes, declared);
  if (!uploaded.ok) return inventoryErrorResponse(uploaded.error);

  const result: EvidenceUploadResult = uploaded.data;
  return Response.json(result, { status: 200, headers: { "Cache-Control": "no-store" } });
}
