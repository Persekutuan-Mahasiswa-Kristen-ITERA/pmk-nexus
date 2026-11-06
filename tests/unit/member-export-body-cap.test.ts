// Security review LOW 1 (2026-11-07): the 8 KiB body cap must hold even without a Content-Length header.
import { describe, expect, it } from "vitest";
import { parseMemberExportBody } from "@/modules/member-data/server/export";

function chunkedRequest(text: string): Request {
  const bytes = new TextEncoder().encode(text);
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += 1024) controller.enqueue(bytes.slice(i, i + 1024));
      controller.close();
    },
  });
  return new Request("http://localhost:3100/api/member-data/export", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    // @ts-expect-error Node's undici needs duplex for a stream body; not in the DOM lib types.
    duplex: "half",
  });
}

describe("export body cap without Content-Length (chunked)", () => {
  it("refuses a body over 8 KiB", async () => {
    const result = await parseMemberExportBody(chunkedRequest(`format=csv&q=${"x".repeat(20_000)}`));
    expect(result).toEqual({ ok: false, error: { code: "invalid_input", field: "request" } });
  });

  it("accepts a small chunked body", async () => {
    const result = await parseMemberExportBody(chunkedRequest("format=csv&status=all"));
    expect(result.ok).toBe(true);
  });
});
