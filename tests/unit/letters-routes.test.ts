// Letters route handlers (src/modules/letters/server/files.ts and export.ts) with the database layer mocked:
// the order of the checks (same origin -> session -> period -> body size -> shape -> declared type -> real bytes), the
// mixed-case multipart boundary (Chrome and Safari send "----WebKitFormBoundaryAbC..."), size limits, HTTP statuses of the error
// codes, the export body parser (JSON and form fallbacks) and the file-name clean-up on its way to Storage.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccessState, PermissionGrant } from "@/lib/auth/types";

const uploadLetterFile = vi.fn();
const exportLetterRows = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ marker: "user-client" }) }));
vi.mock("@/lib/auth/session", () => ({ getAccessState: vi.fn() }));
vi.mock("@/lib/picore/letters", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/picore/letters")>();
  return {
    ...original,
    uploadLetterFile: (...args: unknown[]) => uploadLetterFile(...args),
    exportLetterRows: (...args: unknown[]) => exportLetterRows(...args),
  };
});

import { handleLetterFileUpload } from "@/modules/letters/server/files";
import { handleLetterExport, letterErrorResponse, letterErrorStatus, readLetterExportBody } from "@/modules/letters/server/export";
import type { LetterError, LetterErrorCode } from "@/modules/letters/types";

const BOUNDARY = "----WebKitFormBoundaryAbC123xYz";
const MEMBER_ID = "11111111-2222-3333-4444-555555555555";

const grant = (key: string): PermissionGrant => ({ key, scope: "all", unitIds: [], isSensitive: false });
const state = (keys: string[], over: { periodId?: string | null; memberId?: string } = {}): AccessState => ({
  kind: "member",
  member: { memberId: over.memberId ?? MEMBER_ID, fullName: "Tester", memberType: "student", isSystemAdmin: false, activePeriodId: over.periodId === undefined ? "p-1" : over.periodId, activePeriodLabel: "2026/2027" },
  permissions: keys.map(grant),
});
const plainMember = state([]);
const bph = state(["letters.view", "letters.export", "letter_requests.view_all"]);

type Part = { name: string; value: string | Uint8Array; filename?: string; type?: string };
/** A browser-style multipart body: CRLF line ends, the boundary exactly as sent. */
function multipart(parts: Part[], boundary = BOUNDARY): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  for (const p of parts) {
    let head = `--${boundary}\r\nContent-Disposition: form-data; name="${p.name}"`;
    if (p.filename !== undefined) head += `; filename="${p.filename}"`;
    head += "\r\n";
    if (p.type) head += `Content-Type: ${p.type}\r\n`;
    head += "\r\n";
    chunks.push(enc.encode(head), typeof p.value === "string" ? enc.encode(p.value) : p.value, enc.encode("\r\n"));
  }
  chunks.push(enc.encode(`--${boundary}--\r\n`));
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}
const sameOrigin = { origin: "http://localhost:3100", host: "localhost:3100", "sec-fetch-site": "same-origin" };
const post = (url: string, body: BodyInit | null, headers: Record<string, string>) => new Request(url, { method: "POST", headers: { ...sameOrigin, ...headers }, body });
const upload = (parts: Part[], boundary = BOUNDARY, extra: Record<string, string> = {}) =>
  post("http://localhost:3100/api/letters/files", multipart(parts, boundary) as unknown as BodyInit, { "content-type": `multipart/form-data; boundary=${boundary}`, ...extra });

const PDF = new TextEncoder().encode("%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF");
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const MIB = 1024 * 1024;
const bigPdf = (bytes: number) => {
  const out = new Uint8Array(bytes);
  out.set(PDF);
  return out;
};
const json = async (res: Response) => (await res.json()) as { error?: LetterError; path?: string; name?: string };

beforeEach(() => {
  uploadLetterFile.mockReset();
  exportLetterRows.mockReset();
  uploadLetterFile.mockImplementation(async (_c: unknown, path: string, bytes: Uint8Array, type: string, name: string) => ({ ok: true, data: { path, name, sizeBytes: bytes.byteLength, mimeType: type } }));
  exportLetterRows.mockResolvedValue({ ok: true, data: { rows: [], totalCount: 0 } });
});

describe("upload route: a browser (mixed-case) multipart boundary is accepted, and nothing is weakened by it", () => {
  it("mixed-case boundary: 200, the path is in the CALLER's folder with a fresh random name and the right extension", async () => {
    const res = await handleLetterFileUpload(upload([{ name: "file", value: PDF, filename: "surat.pdf", type: "application/pdf" }]), async () => plainMember);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await json(res);
    expect(body.path).toMatch(new RegExp(`^${MEMBER_ID}/[0-9a-f-]{36}\\.pdf$`));
    expect(body.name).toBe("surat.pdf");
    expect(uploadLetterFile).toHaveBeenCalledTimes(1);
    expect(uploadLetterFile.mock.calls[0][3]).toBe("application/pdf"); // content type = the checked type, not the client's claim
  });
  it("an all-lower-case boundary works the same", async () => {
    const lower = "----webkitformboundaryabc123xyz";
    const res = await handleLetterFileUpload(upload([{ name: "file", value: JPEG, filename: "foto.jpg", type: "image/jpeg" }], lower), async () => plainMember);
    expect(res.status).toBe(200);
    expect((await json(res)).path).toMatch(/\.jpg$/);
  });
  it("two uploads of the same file get two different random paths (no overwrite, no name from the client)", async () => {
    const a = await json(await handleLetterFileUpload(upload([{ name: "file", value: PDF, filename: "same.pdf", type: "application/pdf" }]), async () => plainMember));
    const b = await json(await handleLetterFileUpload(upload([{ name: "file", value: PDF, filename: "same.pdf", type: "application/pdf" }]), async () => plainMember));
    expect(a.path).not.toBe(b.path);
    expect(uploadLetterFile.mock.calls.every((c) => /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.pdf$/.test(c[1] as string))).toBe(true);
  });
  it("the folder is the SESSION's member id: a form field that tries to choose another folder is refused", async () => {
    const res = await handleLetterFileUpload(
      upload([
        { name: "path", value: "99999999-2222-3333-4444-555555555555/x.pdf" },
        { name: "file", value: PDF, filename: "a.pdf", type: "application/pdf" },
      ]),
      async () => plainMember,
    );
    expect(res.status).toBe(400);
    expect(uploadLetterFile).not.toHaveBeenCalled();
  });
  it("the file name sent to Storage is cleaned: control characters, bidi overrides and zero-width characters are dropped (5f5874a)", async () => {
    const res = await handleLetterFileUpload(upload([{ name: "file", value: PDF, filename: "scan‮fdp.exe​.pdf", type: "application/pdf" }]), async () => plainMember);
    expect(res.status).toBe(200);
    expect((await json(res)).name).toBe("scanfdp.exe.pdf");
    expect(uploadLetterFile.mock.calls[0][4]).toBe("scanfdp.exe.pdf");
  });
});

describe("upload route: the real bytes decide, not the name or the declared type (LT-26)", () => {
  const cases: [string, Part][] = [
    ["a .pdf name with HTML inside", { name: "file", value: new TextEncoder().encode("<html><script>alert(1)</script></html>"), filename: "a.pdf", type: "application/pdf" }],
    ["a .pdf name with an executable inside", { name: "file", value: new Uint8Array([0x4d, 0x5a, 0x90, 0, 0, 0]), filename: "a.pdf", type: "application/pdf" }],
    ["a PNG declared as PDF", { name: "file", value: PNG, filename: "a.pdf", type: "application/pdf" }],
    ["a PDF declared as JPEG", { name: "file", value: PDF, filename: "a.jpg", type: "image/jpeg" }],
    ["a JPEG declared as PNG", { name: "file", value: JPEG, filename: "a.png", type: "image/png" }],
    ["a GIF", { name: "file", value: new TextEncoder().encode("GIF89a...."), filename: "a.gif", type: "image/gif" }],
    ["an SVG with a script", { name: "file", value: new TextEncoder().encode("<svg><script>1</script></svg>"), filename: "a.svg", type: "image/svg+xml" }],
    ["a docx", { name: "file", value: new Uint8Array([0x50, 0x4b, 3, 4, 0]), filename: "a.docx", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }],
    ["no declared type", { name: "file", value: PDF, filename: "a.pdf" }],
    ["an empty file", { name: "file", value: new Uint8Array(0), filename: "a.pdf", type: "application/pdf" }],
    ["a file that is only the PDF magic without the dash", { name: "file", value: new TextEncoder().encode("%PDF"), filename: "a.pdf", type: "application/pdf" }],
  ];
  for (const [label, part] of cases) {
    it(`${label}: 400 invalid_file, Storage is never called`, async () => {
      const res = await handleLetterFileUpload(upload([part]), async () => plainMember);
      expect(res.status).toBe(400);
      expect((await json(res)).error).toMatchObject({ code: "invalid_file", field: "file" });
      expect(uploadLetterFile).not.toHaveBeenCalled();
    });
  }
  it("PDF, JPEG and PNG pass with their own type", async () => {
    for (const [value, type, ext] of [[PDF, "application/pdf", "pdf"], [JPEG, "image/jpeg", "jpg"], [PNG, "image/png", "png"]] as const) {
      const res = await handleLetterFileUpload(upload([{ name: "file", value, filename: `a.${ext}`, type }]), async () => plainMember);
      expect(res.status, type).toBe(200);
      expect((await json(res)).path, type).toMatch(new RegExp(`\\.${ext}$`));
    }
  });
});

describe("upload route: size limits (L8: 4 MiB per file)", () => {
  it("exactly 4 MiB passes; one byte more is 413 file_too_large with maxMb 4", async () => {
    const exact = await handleLetterFileUpload(upload([{ name: "file", value: bigPdf(4 * MIB), filename: "a.pdf", type: "application/pdf" }]), async () => plainMember);
    expect(exact.status).toBe(200);
    uploadLetterFile.mockClear();
    const over = await handleLetterFileUpload(upload([{ name: "file", value: bigPdf(4 * MIB + 1), filename: "a.pdf", type: "application/pdf" }]), async () => plainMember);
    expect(over.status).toBe(413);
    expect((await json(over)).error).toMatchObject({ code: "file_too_large", maxMb: 4 });
    expect(uploadLetterFile).not.toHaveBeenCalled();
  });
  it("a body far above the limit is refused by the cap before it is parsed (Content-Length and streaming)", async () => {
    const huge = bigPdf(20 * MIB);
    const res = await handleLetterFileUpload(upload([{ name: "file", value: huge, filename: "a.pdf", type: "application/pdf" }]), async () => plainMember);
    expect(res.status).toBe(413);
    // no Content-Length, streamed: the cap still applies
    const body = multipart([{ name: "file", value: huge, filename: "a.pdf", type: "application/pdf" }]);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < body.byteLength; i += 65_536) controller.enqueue(body.subarray(i, Math.min(i + 65_536, body.byteLength)));
        controller.close();
      },
    });
    const streamed = new Request("http://localhost:3100/api/letters/files", {
      method: "POST",
      headers: { ...sameOrigin, "content-type": `multipart/form-data; boundary=${BOUNDARY}` },
      body: stream,
      duplex: "half",
    } as RequestInit);
    expect((await handleLetterFileUpload(streamed, async () => plainMember)).status).toBe(413);
    expect(uploadLetterFile).not.toHaveBeenCalled();
  });
});

describe("upload route: shape, session, period and Storage answers", () => {
  it("exactly one 'file' field: two files, no file, a text 'file', an extra field are all 400", async () => {
    const f = (n: string): Part => ({ name: "file", value: PDF, filename: `${n}.pdf`, type: "application/pdf" });
    expect((await handleLetterFileUpload(upload([f("a"), f("b")]), async () => plainMember)).status).toBe(400);
    expect((await handleLetterFileUpload(upload([{ name: "note", value: "x" }]), async () => plainMember)).status).toBe(400);
    expect((await handleLetterFileUpload(upload([{ name: "file", value: "just text" }]), async () => plainMember)).status).toBe(400);
    expect((await handleLetterFileUpload(upload([f("a"), { name: "extra", value: "1" }]), async () => plainMember)).status).toBe(400);
    expect(uploadLetterFile).not.toHaveBeenCalled();
  });
  it("a body that is not multipart is 400 (JSON, plain text, nothing)", async () => {
    for (const [type, body] of [["application/json", '{"file":"x"}'], ["text/plain", "hello"], ["", "x"]] as const) {
      const res = await handleLetterFileUpload(post("http://localhost:3100/api/letters/files", body, type ? { "content-type": type } : {}), async () => plainMember);
      expect(res.status, type).toBe(400);
    }
    const broken = post("http://localhost:3100/api/letters/files", "garbage", { "content-type": `multipart/form-data; boundary=${BOUNDARY}` });
    expect((await handleLetterFileUpload(broken, async () => plainMember)).status).toBe(400);
  });
  it("only POST: every other method is 405 and never reads the session", async () => {
    const readState = vi.fn(async () => plainMember);
    for (const method of ["GET", "PUT", "PATCH", "DELETE"]) {
      const res = await handleLetterFileUpload(new Request("http://localhost:3100/api/letters/files", { method, headers: sameOrigin }), readState);
      expect(res.status, method).toBe(405);
    }
    expect(readState).not.toHaveBeenCalled();
  });
  it("CSRF: a missing, 'null', cross-site or mismatching Origin is 403 before the session is read", async () => {
    const readState = vi.fn(async () => plainMember);
    const part: Part = { name: "file", value: PDF, filename: "a.pdf", type: "application/pdf" };
    for (const headers of [{ origin: "https://evil.example" }, { origin: "null" }, { "sec-fetch-site": "cross-site" }, { origin: "" }] as Record<string, string>[]) {
      const base = upload([part]);
      const h = new Headers(base.headers);
      for (const [k, v] of Object.entries(headers)) h.set(k, v);
      if (headers.origin === "") h.delete("origin");
      const res = await handleLetterFileUpload(new Request(base.url, { method: "POST", headers: h, body: multipart([part]) as unknown as BodyInit }), readState);
      expect(res.status, JSON.stringify(headers)).toBe(403);
    }
    expect(readState).not.toHaveBeenCalled();
    expect(uploadLetterFile).not.toHaveBeenCalled();
  });
  it("session states: anonymous 401, deactivated / no access / temp password 403, a failing session read 503; none reaches Storage", async () => {
    const part: Part = { name: "file", value: PDF, filename: "a.pdf", type: "application/pdf" };
    const statuses: [string, () => Promise<AccessState>, number][] = [
      ["anonymous", async () => ({ kind: "anonymous" }), 401],
      ["no_access", async () => ({ kind: "no_access", reason: "deactivated" } as unknown as AccessState), 403],
      ["password_pending", async () => ({ kind: "password_pending" }), 403],
      ["error", async () => ({ kind: "error" }), 503],
      ["throws", async () => { throw new Error("boom"); }, 503],
    ];
    for (const [label, read, status] of statuses) {
      const res = await handleLetterFileUpload(upload([part]), read);
      expect(res.status, label).toBe(status);
      expect(JSON.stringify(await res.json()), label).not.toMatch(/boom|stack/);
    }
    expect(uploadLetterFile).not.toHaveBeenCalled();
  });
  it("no active period: 409 no_active_period (R7), Storage not called", async () => {
    const res = await handleLetterFileUpload(upload([{ name: "file", value: PDF, filename: "a.pdf", type: "application/pdf" }]), async () => state([], { periodId: null }));
    expect(res.status).toBe(409);
    expect((await json(res)).error).toEqual({ code: "no_active_period" });
    expect(uploadLetterFile).not.toHaveBeenCalled();
  });
  it("Storage answers pass through as codes: the 10-per-24-hours cap is 429, an outage is 503, never a raw message", async () => {
    const part: Part = { name: "file", value: PDF, filename: "a.pdf", type: "application/pdf" };
    uploadLetterFile.mockResolvedValueOnce({ ok: false, error: { code: "upload_limit", limit: 10 } });
    const capped = await handleLetterFileUpload(upload([part]), async () => plainMember);
    expect(capped.status).toBe(429);
    expect((await json(capped)).error).toEqual({ code: "upload_limit", limit: 10 });
    uploadLetterFile.mockResolvedValueOnce({ ok: false, error: { code: "unavailable" } });
    const down = await handleLetterFileUpload(upload([part]), async () => plainMember);
    expect(down.status).toBe(503);
    expect(await down.json()).toEqual({ error: { code: "unavailable" } });
  });
});

// ---------------------------------------------------------------------------------------------
describe("error codes -> HTTP status (contract section 8)", () => {
  const status = (code: LetterErrorCode) => letterErrorStatus({ code } as LetterError);
  it("matches the contract: 401, 403, 404, 413, 422, 429, 503, 400 for input, 409 for every other business refusal", () => {
    expect(status("unauthenticated")).toBe(401);
    for (const c of ["forbidden", "self_processing_blocked", "closed_period"] as const) expect(status(c), c).toBe(403);
    expect(status("not_found")).toBe(404);
    expect(status("file_too_large")).toBe(413);
    expect(status("export_too_large")).toBe(422);
    expect(status("upload_limit")).toBe(429);
    expect(status("unavailable")).toBe(503);
    for (const c of ["invalid_input", "text_required", "text_too_long", "reason_required", "note_required", "date_required", "date_in_future", "date_in_past", "invalid_dates", "invalid_file", "file_already_attached", "file_required", "file_count", "invalid_number_format"] as const) {
      expect(status(c), c).toBe(400);
    }
    for (const c of ["state_changed", "no_active_period", "letter_voided", "request_open", "number_not_taken", "last_issued_file", "too_many_open_requests", "daily_request_limit", "duplicate_number", "format_collision", "year_not_current", "sequence_not_higher", "file_missing"] as const) {
      expect(status(c), c).toBe(409);
    }
  });
  it("an error answer is JSON with a code only, no-store, never row data or a stack", async () => {
    const res = letterErrorResponse({ code: "too_many_open_requests", limit: 5 });
    expect(res.status).toBe(409);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({ error: { code: "too_many_open_requests", limit: 5 } });
  });
});

// ---------------------------------------------------------------------------------------------
describe("export body parser: JSON and the no-JavaScript form fallbacks (JSON, urlencoded, multipart with a mixed-case boundary)", () => {
  const url = "http://localhost:3100/api/letters/export";
  it("JSON: parsed as sent", async () => {
    const req = post(url, JSON.stringify({ format: "csv", filters: { type: "incoming", status: "voided" } }), { "content-type": "application/json" });
    expect(await readLetterExportBody(req)).toEqual({ ok: true, body: { format: "csv", filters: { type: "incoming", status: "voided" } } });
  });
  it("JSON that is broken, not UTF-8, or too large (over 8 KiB) is refused", async () => {
    for (const body of ["{not json", "", "[", '{"format":"csv"'] as const) {
      expect(await readLetterExportBody(post(url, body, { "content-type": "application/json" })), body).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    }
    const bad = new Uint8Array([0x7b, 0x22, 0xff, 0xfe, 0x22, 0x7d]);
    expect(await readLetterExportBody(post(url, bad as unknown as BodyInit, { "content-type": "application/json" }))).toMatchObject({ ok: false });
    const huge = JSON.stringify({ format: "csv", filters: { type: "incoming", search: "x".repeat(9000) } });
    expect(await readLetterExportBody(post(url, huge, { "content-type": "application/json" }))).toMatchObject({ ok: false });
  });
  it("urlencoded form: year and 'withoutFiles' become their JSON types; empty fields mean 'not set'", async () => {
    const body = new URLSearchParams({ format: "xlsx", type: "outgoing", search: "", period: "all", year: "2026", status: "active", withoutFiles: "1" }).toString();
    expect(await readLetterExportBody(post(url, body, { "content-type": "application/x-www-form-urlencoded" }))).toEqual({
      ok: true,
      body: { format: "xlsx", filters: { type: "outgoing", period: "all", year: 2026, status: "active", withoutFiles: true } },
    });
    const off = new URLSearchParams({ format: "csv", type: "incoming", withoutFiles: "0" }).toString();
    const parsed = await readLetterExportBody(post(url, off, { "content-type": "application/x-www-form-urlencoded" }));
    expect(parsed).toMatchObject({ ok: true, body: { filters: { withoutFiles: false } } });
  });
  it("a value that is not the expected type stays text, so the schema refuses it (never replaced silently)", async () => {
    const odd = new URLSearchParams({ format: "csv", type: "incoming", year: "20x6", withoutFiles: "maybe" }).toString();
    const parsed = await readLetterExportBody(post(url, odd, { "content-type": "application/x-www-form-urlencoded" }));
    expect(parsed).toMatchObject({ ok: true, body: { filters: { year: "20x6", withoutFiles: "maybe" } } });
  });
  it("multipart with a MIXED-CASE boundary is parsed (the case-sensitive boundary must not be lower-cased)", async () => {
    const body = multipart([
      { name: "format", value: "csv" },
      { name: "type", value: "incoming" },
      { name: "status", value: "voided" },
    ]);
    const parsed = await readLetterExportBody(post(url, body as unknown as BodyInit, { "content-type": `multipart/form-data; boundary=${BOUNDARY}` }));
    expect(parsed).toEqual({ ok: true, body: { format: "csv", filters: { type: "incoming", status: "voided" } } });
  });
  it("a repeated field or a file in the form is refused; other content types are refused", async () => {
    const twice = new URLSearchParams([["format", "csv"], ["type", "incoming"], ["type", "outgoing"]]).toString();
    expect(await readLetterExportBody(post(url, twice, { "content-type": "application/x-www-form-urlencoded" }))).toMatchObject({ ok: false });
    const withFile = multipart([{ name: "format", value: "csv" }, { name: "type", value: PDF, filename: "a.pdf", type: "application/pdf" }]);
    expect(await readLetterExportBody(post(url, withFile as unknown as BodyInit, { "content-type": `multipart/form-data; boundary=${BOUNDARY}` }))).toMatchObject({ ok: false });
    for (const type of ["text/plain", "text/csv", "application/xml", ""]) {
      expect(await readLetterExportBody(post(url, "format=csv", type ? { "content-type": type } : {})), type).toMatchObject({ ok: false });
    }
  });
});

describe("export handler: order of checks and the log-before-file rule", () => {
  const url = "http://localhost:3100/api/letters/export";
  const body = (over: object = {}) => post(url, JSON.stringify({ format: "csv", filters: { type: "incoming" }, ...over }), { "content-type": "application/json" });

  it("a key holder gets a file with the right headers and the database is called once with the user's client, the format and the validated filters", async () => {
    const res = await handleLetterExport(body(), async () => bph);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename=/);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(exportLetterRows).toHaveBeenCalledTimes(1);
    expect(exportLetterRows.mock.calls[0][1]).toBe("csv");
    expect(exportLetterRows.mock.calls[0][2]).toMatchObject({ type: "incoming", period: "active", status: "all", search: null, year: null, withoutFiles: false });
    expect((exportLetterRows.mock.calls[0][0] as { marker: string }).marker).toBe("user-client");
  });
  it("without letters.export (plain member, view without export, no session) nothing is exported and the database is never called", async () => {
    for (const [label, s, status] of [
      ["plain member", plainMember, 403],
      ["letters.view without export", state(["letters.view"]), 403],
      ["export key without the view key", state(["letters.export"]), 403],
      ["anonymous", { kind: "anonymous" } as AccessState, 401],
      ["error", { kind: "error" } as AccessState, 503],
    ] as const) {
      const res = await handleLetterExport(body(), async () => s);
      expect(res.status, label).toBe(status);
    }
    expect(exportLetterRows).not.toHaveBeenCalled();
  });
  it("a bad body is 400 before the database is called", async () => {
    for (const over of [{ format: "docx" }, { format: undefined }, { filters: { type: "diary" } }, { filters: { type: "incoming", year: 1999 } }, { filters: { type: "incoming", search: "x".repeat(121) } }]) {
      const res = await handleLetterExport(body(over), async () => bph);
      expect(res.status, JSON.stringify(over)).toBe(400);
    }
    expect(exportLetterRows).not.toHaveBeenCalled();
  });
  it("only POST; other methods are 405", async () => {
    for (const method of ["GET", "PUT", "DELETE", "PATCH"]) {
      expect((await handleLetterExport(new Request(url, { method, headers: sameOrigin }), async () => bph)).status, method).toBe(405);
    }
  });
  it("the database refusing (no key at the database, log write failed) means no file: its error code is the answer", async () => {
    exportLetterRows.mockResolvedValueOnce({ ok: false, error: { code: "unavailable" } });
    const failed = await handleLetterExport(body(), async () => bph);
    expect(failed.status).toBe(503);
    expect(await failed.json()).toEqual({ error: { code: "unavailable" } });
    exportLetterRows.mockResolvedValueOnce({ ok: false, error: { code: "forbidden" } });
    expect((await handleLetterExport(body(), async () => bph)).status).toBe(403);
    exportLetterRows.mockRejectedValueOnce(new Error("network"));
    expect((await handleLetterExport(body(), async () => bph)).status).toBe(503);
  });
  it("a result cut by the API row limit is refused (422) rather than handed out as a partial register", async () => {
    exportLetterRows.mockResolvedValueOnce({ ok: true, data: { rows: [], totalCount: 5 } });
    const res = await handleLetterExport(body(), async () => bph);
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: { code: "export_too_large" } });
  });
  it("formula-looking cells are neutralised in CSV (= + - @ and a leading tab or carriage return)", async () => {
    const row = (n: number, subject: string) => ({
      rowNo: n, letterId: `id-${n}`, type: "incoming", numberText: `PMK/NEX/SM/2026/00${n}`, isLegacyNumber: false, letterDate: "2026-11-10", receivedDate: "2026-11-10",
      counterpart: subject, counterpartNumber: null, subject, notes: subject, status: "active", voidReason: null, fromRequest: false, periodLabel: "2026/2027",
      createdByName: "Test", createdAt: "2026-11-10T05:00:00Z", fileCount: 0,
    });
    exportLetterRows.mockResolvedValueOnce({ ok: true, data: { rows: [row(1, '=HYPERLINK("x")'), row(2, "+1+1"), row(3, "-2+3"), row(4, "@SUM(A1)"), row(5, "\t=1"), row(6, "\r=1"), row(7, "-")], totalCount: 7 } });
    const res = await handleLetterExport(body(), async () => bph);
    const text = (await res.text()).replace(/^﻿/, "");
    expect(text).toContain(`"'=HYPERLINK(""x"")"`);
    expect(text).toContain(",'+1+1,");
    expect(text).toContain(",'-2+3,");
    expect(text).toContain(",'@SUM(A1),");
    expect(text).not.toMatch(/,=HYPERLINK|,\+1\+1,|,-2\+3,|,@SUM/);
    // a lone "-" is the placeholder and stays as is
    expect(text).toMatch(/,-,-,-/);
  });
});
