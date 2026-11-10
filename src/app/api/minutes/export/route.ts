import { getAccessState } from "@/lib/auth/session";
import { handleMinuteExport } from "@/modules/minutes/server/export";
import { minuteMethodNotAllowed } from "@/modules/minutes/server/http";

// Meeting minutes export (docs/modules/meeting-minutes.md F6, section 8). Thin: all logic lives in the
// module. POST only, because every export writes a log row; a GET (prefetch, crawler) must never trigger it.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  // The session check runs here (AR8), after the same-origin check; the handler gates on its result.
  return handleMinuteExport(request, () => getAccessState());
}

export function GET(): Response {
  return minuteMethodNotAllowed();
}

export const PUT = GET;
export const PATCH = GET;
export const DELETE = GET;
