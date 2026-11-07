import "server-only";

// Request helpers shared by NEXUS route handlers (POST endpoints that change state or write a log row).
// Same rules as the first copy in src/modules/member-data/server/export.ts (kept there unchanged so the
// Member Data module stays self-contained); new route handlers use this file.

/**
 * CSRF guard. The browser always sends Origin on a POST; it must match the host this request was sent
 * to (x-forwarded-host on Vercel, else host), like Next.js's own Server Action check. A missing Origin,
 * "null", or a cross-site Sec-Fetch-Site is refused.
 */
export function isSameOriginRequest(request: Request): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite !== null && fetchSite !== "same-origin") return false;

  const origin = request.headers.get("origin");
  if (!origin || origin === "null") return false;
  const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "").split(",")[0].trim();
  if (host === "") return false;
  try {
    const url = new URL(origin);
    return (url.protocol === "https:" || url.protocol === "http:") && url.host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * Reads the body up to `max` bytes; null when it is larger (by Content-Length or while streaming) or
 * unreadable. Never buffers more than max + one chunk, so a huge or chunked body cannot fill memory.
 */
export async function readCappedBody(request: Request, max: number): Promise<Uint8Array<ArrayBuffer> | null> {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const length = Number(declared);
    if (!Number.isFinite(length) || length < 0 || length > max) return null;
  }
  if (!request.body) return new Uint8Array(new ArrayBuffer(0));
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  const out = new Uint8Array(new ArrayBuffer(total));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** 405 for every method a POST-only endpoint does not accept. */
export function methodNotAllowed(): Response {
  return new Response(null, { status: 405, headers: { Allow: "POST", "Cache-Control": "no-store" } });
}
