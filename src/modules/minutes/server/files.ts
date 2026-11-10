import "server-only";
import { randomUUID } from "node:crypto";
import type { AccessState } from "@/lib/auth/types";
import { isSameOriginRequest, readCappedBody } from "@/lib/http/request";
import { uploadMinuteFile } from "@/lib/picore/minutes";
import {
  MINUTE_FILE_MAX_BYTES,
  MINUTE_FILE_MAX_MB,
  MINUTE_FILE_UPLOAD_FIELDS,
  cleanMinuteFileName,
  minuteFilePath,
  minuteUploadFileSchema,
  sniffMinuteFileType,
  type MinuteError,
  type MinuteFileUploadResult,
} from "../types";
import { requireMinutes } from "./access";
import { minuteErrorResponse, minuteMethodNotAllowed } from "./http";

// POST /api/minutes/files (contract section 12, spec 4.4, MN-17): one attachment, uploaded when it is
// picked (before the minute exists or is saved). Order: same-origin check (CSRF) -> session ->
// minutes.manage in any scope (database M4) -> active period -> multipart body capped near the limit ->
// exactly one "file" field -> declared type and size -> the file's real type from its first bytes
// (magic bytes) must match the declared type -> upload with the USER's client (never the service role)
// into the caller's OWN folder under a fresh random name, no overwrite. The bucket policy
// minute_file_can_upload checks again (manage holder, own folder, active period, at most 10 unattached
// uploads in 24 hours). The answer is the path and the cleaned name; the save action attaches them
// (and the database checks them again).

/** Room for the multipart boundary and the field header around a file at the bucket limit. */
const MULTIPART_OVERHEAD_BYTES = 16 * 1024;

const TOO_LARGE: MinuteError = { code: "file_too_large", field: "file", ref: null, maxMb: MINUTE_FILE_MAX_MB };
const INVALID_FILE: MinuteError = { code: "invalid_file", field: "file", ref: null };
const BAD_REQUEST: MinuteError = { code: "invalid_input", field: "request" };

const json = (result: MinuteFileUploadResult) => Response.json(result, { status: 200, headers: { "Cache-Control": "no-store" } });

export async function handleMinuteFileUpload(request: Request, readAccessState: () => Promise<AccessState>): Promise<Response> {
  if (request.method !== "POST") return minuteMethodNotAllowed();
  if (!isSameOriginRequest(request)) return minuteErrorResponse({ code: "forbidden" });

  let state: AccessState;
  try {
    state = await readAccessState();
  } catch {
    return minuteErrorResponse({ code: "unavailable" });
  }
  const gate = await requireMinutes("canManage", state);
  if (!gate.ok) return minuteErrorResponse(gate.error);
  if (!gate.capabilities.canUploadFiles) return minuteErrorResponse({ code: "no_active_period" });

  // Keep the raw header for parsing: the multipart boundary is case-sensitive (WebKit sends mixed case).
  const rawType = request.headers.get("content-type") ?? "";
  if (!rawType.toLowerCase().startsWith("multipart/form-data")) return minuteErrorResponse(BAD_REQUEST);

  // Over the cap = a file above the bucket limit (the browser resizes images first): file_too_large.
  const body = await readCappedBody(request, MINUTE_FILE_MAX_BYTES + MULTIPART_OVERHEAD_BYTES);
  if (!body) return minuteErrorResponse(TOO_LARGE);

  let form: FormData;
  try {
    form = await new Response(body, { headers: { "content-type": rawType } }).formData();
  } catch {
    return minuteErrorResponse(BAD_REQUEST);
  }

  // Exactly one file, nothing else (contract MINUTE_FILE_UPLOAD_FIELDS).
  const names = [...form.keys()];
  if (names.some((name) => name !== MINUTE_FILE_UPLOAD_FIELDS.file)) return minuteErrorResponse(BAD_REQUEST);
  const files = form.getAll(MINUTE_FILE_UPLOAD_FIELDS.file);
  const file = files[0];
  if (files.length !== 1 || typeof file === "string") return minuteErrorResponse({ code: "invalid_input", field: "file" });

  // Size first, so a too-large file gets its own text (invalid_file stays for the format).
  if (file.size > MINUTE_FILE_MAX_BYTES) return minuteErrorResponse(TOO_LARGE);
  const declared = minuteUploadFileSchema.safeParse({ type: file.type, size: file.size });
  if (!declared.success) {
    const tooLarge = declared.error.issues.some((issue) => issue.message === "file_too_large");
    return minuteErrorResponse(tooLarge ? TOO_LARGE : INVALID_FILE);
  }
  const type = declared.data.type;

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    return minuteErrorResponse({ code: "invalid_input", field: "file" });
  }
  // The declared type is only a claim: the first bytes must say the same (MN-17).
  if (bytes.byteLength > MINUTE_FILE_MAX_BYTES) return minuteErrorResponse(TOO_LARGE);
  if (bytes.byteLength !== declared.data.size || sniffMinuteFileType(bytes) !== type) return minuteErrorResponse(INVALID_FILE);

  // The folder is the caller's own members.id from the session, never from the request.
  const path = minuteFilePath(gate.member.memberId, randomUUID(), type);
  const uploaded = await uploadMinuteFile(gate.supabase, path, bytes, type, cleanMinuteFileName(file.name, type));
  if (!uploaded.ok) return minuteErrorResponse(uploaded.error);
  return json(uploaded.data);
}
