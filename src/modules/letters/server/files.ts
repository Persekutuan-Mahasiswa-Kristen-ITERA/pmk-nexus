import "server-only";
import { randomUUID } from "node:crypto";
import type { AccessState } from "@/lib/auth/types";
import { isSameOriginRequest, readCappedBody } from "@/lib/http/request";
import { uploadLetterFile } from "@/lib/picore/letters";
import {
  LETTER_FILE_MAX_BYTES,
  LETTER_FILE_MAX_MB,
  LETTER_FILE_UPLOAD_FIELDS,
  cleanLetterFileName,
  letterFilePath,
  letterUploadFileSchema,
  sniffLetterFileType,
  type LetterError,
  type LetterFileUploadResult,
} from "../types";
import { requireLetters } from "./access";
import { letterErrorResponse, letterMethodNotAllowed } from "./export";

// POST /api/letters/files (contract section 12, A-LT13, LT-26): one letter file or request attachment,
// uploaded when it is picked (before the letter or request exists). Order: same-origin check (CSRF) ->
// session (any active member) -> active period -> multipart body capped near the limit -> exactly one
// "file" field -> declared type and size -> the file's real type from its first bytes (magic bytes)
// must match the declared type -> upload with the USER's client (never the service role) into the
// caller's OWN folder under a fresh random name, no overwrite. The bucket policy letter_file_can_upload
// checks again (own folder, active period, at most 10 unattached uploads in 24 hours). The answer is
// the path and the cleaned name; the save action attaches them (and the database checks them again).

/** Room for the multipart boundary and the field header around a file at the bucket limit. */
const MULTIPART_OVERHEAD_BYTES = 16 * 1024;

const TOO_LARGE: LetterError = { code: "file_too_large", field: "file", ref: null, maxMb: LETTER_FILE_MAX_MB };
const INVALID_FILE: LetterError = { code: "invalid_file", field: "file", ref: null };
const BAD_REQUEST: LetterError = { code: "invalid_input", field: "request" };

const json = (result: LetterFileUploadResult) => Response.json(result, { status: 200, headers: { "Cache-Control": "no-store" } });

export async function handleLetterFileUpload(request: Request, readAccessState: () => Promise<AccessState>): Promise<Response> {
  if (request.method !== "POST") return letterMethodNotAllowed();
  if (!isSameOriginRequest(request)) return letterErrorResponse({ code: "forbidden" });

  let state: AccessState;
  try {
    state = await readAccessState();
  } catch {
    return letterErrorResponse({ code: "unavailable" });
  }
  const gate = await requireLetters("canViewOwnRequests", state);
  if (!gate.ok) return letterErrorResponse(gate.error);
  if (!gate.capabilities.canUploadFiles) return letterErrorResponse({ code: "no_active_period" });

  // Keep the raw header for parsing: the multipart boundary is case-sensitive (WebKit sends mixed case).
  const rawType = request.headers.get("content-type") ?? "";
  if (!rawType.toLowerCase().startsWith("multipart/form-data")) return letterErrorResponse(BAD_REQUEST);

  // Over the cap = a file above the bucket limit (the browser resizes images first): file_too_large.
  const body = await readCappedBody(request, LETTER_FILE_MAX_BYTES + MULTIPART_OVERHEAD_BYTES);
  if (!body) return letterErrorResponse(TOO_LARGE);

  let form: FormData;
  try {
    form = await new Response(body, { headers: { "content-type": rawType } }).formData();
  } catch {
    return letterErrorResponse(BAD_REQUEST);
  }

  // Exactly one file, nothing else (contract LETTER_FILE_UPLOAD_FIELDS).
  const names = [...form.keys()];
  if (names.some((name) => name !== LETTER_FILE_UPLOAD_FIELDS.file)) return letterErrorResponse(BAD_REQUEST);
  const files = form.getAll(LETTER_FILE_UPLOAD_FIELDS.file);
  const file = files[0];
  if (files.length !== 1 || typeof file === "string") return letterErrorResponse({ code: "invalid_input", field: "file" });

  // Size first, so a too-large file gets its own text (invalid_file stays for the format).
  if (file.size > LETTER_FILE_MAX_BYTES) return letterErrorResponse(TOO_LARGE);
  const declared = letterUploadFileSchema.safeParse({ type: file.type, size: file.size });
  if (!declared.success) {
    const tooLarge = declared.error.issues.some((issue) => issue.message === "file_too_large");
    return letterErrorResponse(tooLarge ? TOO_LARGE : INVALID_FILE);
  }
  const type = declared.data.type;

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    return letterErrorResponse({ code: "invalid_input", field: "file" });
  }
  // The declared type is only a claim: the first bytes must say the same (LT-26).
  if (bytes.byteLength > LETTER_FILE_MAX_BYTES) return letterErrorResponse(TOO_LARGE);
  if (bytes.byteLength !== declared.data.size || sniffLetterFileType(bytes) !== type) return letterErrorResponse(INVALID_FILE);

  // The folder is the caller's own members.id from the session, never from the request (decision D3).
  const path = letterFilePath(gate.member.memberId, randomUUID(), type);
  const uploaded = await uploadLetterFile(gate.supabase, path, bytes, type, cleanLetterFileName(file.name, type));
  if (!uploaded.ok) return letterErrorResponse(uploaded.error);
  return json(uploaded.data);
}
