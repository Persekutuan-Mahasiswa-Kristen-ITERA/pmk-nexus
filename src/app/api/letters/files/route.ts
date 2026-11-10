import { getAccessState } from "@/lib/auth/session";
import { letterMethodNotAllowed } from "@/modules/letters/server/export";
import { handleLetterFileUpload } from "@/modules/letters/server/files";

// Letter file / request attachment upload (docs/modules/letters.md 4.4, design 3.3). Thin: all logic
// lives in the module. POST only (multipart: exactly one field "file").
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  // The session check runs here (AR8), after the same-origin check; the handler gates on its result.
  return handleLetterFileUpload(request, () => getAccessState());
}

export function GET(): Response {
  return letterMethodNotAllowed();
}

export const PUT = GET;
export const PATCH = GET;
export const DELETE = GET;
