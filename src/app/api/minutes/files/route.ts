import { getAccessState } from "@/lib/auth/session";
import { handleMinuteFileUpload } from "@/modules/minutes/server/files";
import { minuteMethodNotAllowed } from "@/modules/minutes/server/http";

// Meeting minutes attachment upload (docs/modules/meeting-minutes.md 4.4). Thin: all logic lives in the
// module. POST only (multipart: exactly one field "file").
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  // The session check runs here (AR8), after the same-origin check; the handler gates on its result.
  return handleMinuteFileUpload(request, () => getAccessState());
}

export function GET(): Response {
  return minuteMethodNotAllowed();
}

export const PUT = GET;
export const PATCH = GET;
export const DELETE = GET;
