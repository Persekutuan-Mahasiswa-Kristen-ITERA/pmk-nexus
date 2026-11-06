import { getAccessState } from "@/lib/auth/session";
import { handleMemberDataExport, memberExportMethodNotAllowed } from "@/modules/member-data/server/export";

// Member Data export (docs/modules/member-data.md F5). Thin: all logic lives in the module.
// POST only, because every export writes a log row; a GET (prefetch, crawler) must never trigger it.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  // The session check runs here (AR8, F2), after the same-origin check; the handler gates on its result.
  return handleMemberDataExport(request, () => getAccessState());
}

export function GET(): Response {
  return memberExportMethodNotAllowed();
}

export const PUT = GET;
export const PATCH = GET;
export const DELETE = GET;
