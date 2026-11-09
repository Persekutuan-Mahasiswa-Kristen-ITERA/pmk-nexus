// Regression: Chrome and Safari send multipart boundaries with UPPER-CASE letters
// ("----WebKitFormBoundaryAbC123xYz"). The boundary is case-sensitive, but the handlers used to parse the
// body with the LOWER-CASED content-type, so every real browser upload failed with invalid_input while
// Node's own FormData (lower-case boundary) passed. These tests build the body by hand, exactly like a
// browser, for: the evidence upload route, the inventory/borrowing export form fallback, and the Member
// Data export body parser.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccessState, PermissionGrant } from "@/lib/auth/types";

const uploadEvidencePhoto = vi.fn();
const exportInventoryRows = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ marker: "user-client" }) }));
vi.mock("@/lib/auth/session", () => ({ getAccessState: vi.fn() }));
vi.mock("@/lib/picore/inventory-borrowing", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/picore/inventory-borrowing")>();
  return {
    ...original,
    uploadEvidencePhoto: (...args: unknown[]) => uploadEvidencePhoto(...args),
    exportInventoryRows: (...args: unknown[]) => exportInventoryRows(...args),
  };
});

import { handleEvidenceUpload } from "@/modules/inventory-borrowing/server/evidence";
import { handleInventoryExport } from "@/modules/inventory-borrowing/server/export";
import { parseMemberExportBody } from "@/modules/member-data/server/export";

const BOUNDARY = "----WebKitFormBoundaryAbC123xYz";
const REQUEST_ID = "11111111-2222-3333-4444-555555555555";

const grant = (key: string): PermissionGrant => ({ key, scope: "all", unitIds: [], isSensitive: false });
const operations: AccessState = {
  kind: "member",
  member: { memberId: "m-1", fullName: "Ops", memberType: "student", isSystemAdmin: false, activePeriodId: "p-1", activePeriodLabel: "2026/2027" },
  permissions: ["inventory.view", "inventory.export", "borrowing.handle", "borrowing.view_all"].map(grant),
};

/** A browser-style multipart body: CRLF line ends, the boundary exactly as sent. */
function multipart(parts: { name: string; value: string | Uint8Array; filename?: string; type?: string }[], boundary = BOUNDARY): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  for (const p of parts) {
    let head = `--${boundary}\r\nContent-Disposition: form-data; name="${p.name}"`;
    if (p.filename) head += `; filename="${p.filename}"`;
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

function post(url: string, body: Uint8Array, boundary = BOUNDARY): Request {
  return new Request(url, {
    method: "POST",
    headers: {
      origin: "http://localhost:3100",
      host: "localhost:3100",
      "sec-fetch-site": "same-origin",
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
    body: body as unknown as BodyInit,
  });
}

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);

beforeEach(() => {
  uploadEvidencePhoto.mockReset();
  exportInventoryRows.mockReset();
  uploadEvidencePhoto.mockImplementation(async (_c: unknown, path: string) => ({ ok: true, data: { path } }));
  exportInventoryRows.mockResolvedValue({ ok: true, data: [] });
});

describe("evidence upload accepts a browser (mixed-case) multipart boundary", () => {
  it("boundary with upper-case letters: 200 and the path is returned", async () => {
    const body = multipart([
      { name: "requestId", value: REQUEST_ID },
      { name: "file", value: JPEG, filename: "foto.jpg", type: "image/jpeg" },
    ]);
    const res = await handleEvidenceUpload(post("http://localhost:3100/api/inventory/evidence", body), async () => operations);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { path: string };
    expect(json.path).toMatch(new RegExp(`^${REQUEST_ID}/[0-9a-f-]{36}\\.jpg$`));
    expect(uploadEvidencePhoto).toHaveBeenCalledTimes(1);
  });

  it("the same upload with an all-lower-case boundary still works (nothing else changed)", async () => {
    const lower = "----webkitformboundaryabc123xyz";
    const body = multipart(
      [
        { name: "requestId", value: REQUEST_ID },
        { name: "file", value: JPEG, filename: "foto.jpg", type: "image/jpeg" },
      ],
      lower,
    );
    const res = await handleEvidenceUpload(post("http://localhost:3100/api/inventory/evidence", body, lower), async () => operations);
    expect(res.status).toBe(200);
  });

  it("a mixed-case boundary does not weaken the checks: a .jpg name with PNG-less bytes is still invalid_photo (400)", async () => {
    const body = multipart([
      { name: "requestId", value: REQUEST_ID },
      { name: "file", value: new TextEncoder().encode("<?php echo 1; ?>"), filename: "foto.jpg", type: "image/jpeg" },
    ]);
    const res = await handleEvidenceUpload(post("http://localhost:3100/api/inventory/evidence", body), async () => operations);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("invalid_photo");
    expect(uploadEvidencePhoto).not.toHaveBeenCalled();
  });
});

describe("inventory export: multipart form fallback with a mixed-case boundary", () => {
  it("is parsed (format and filters read), not refused as invalid_input", async () => {
    const body = multipart([
      { name: "format", value: "csv" },
      { name: "status", value: "active" },
    ]);
    const res = await handleInventoryExport(post("http://localhost:3100/api/inventory/export", body), async () => operations);
    expect(res.status, await res.clone().text()).toBe(200);
    expect(exportInventoryRows).toHaveBeenCalledTimes(1);
    expect(exportInventoryRows.mock.calls[0][1]).toBe("csv");
  });
});

describe("Member Data export body parser: multipart with a mixed-case boundary", () => {
  it("reads format and filters", async () => {
    const body = multipart([
      { name: "format", value: "csv" },
      { name: "status", value: "all" },
    ]);
    const parsed = await parseMemberExportBody(post("http://localhost:3100/api/member-data/export", body));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.format).toBe("csv");
      expect(parsed.filters.status).toBe("all");
    }
  });
});
