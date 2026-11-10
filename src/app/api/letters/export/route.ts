import { getAccessState } from "@/lib/auth/session";
import { handleLetterExport, letterMethodNotAllowed } from "@/modules/letters/server/export";

// Letter register export (docs/modules/letters.md F8). Thin: all logic lives in the module.
// POST only, because every export writes a log row; a GET (prefetch, crawler) must never trigger it.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  // The session check runs here (AR8), after the same-origin check; the handler gates on its result.
  return handleLetterExport(request, () => getAccessState());
}

export function GET(): Response {
  return letterMethodNotAllowed();
}

export const PUT = GET;
export const PATCH = GET;
export const DELETE = GET;
