import { getAccessState } from "@/lib/auth/session";
import { handleEvidenceUpload } from "@/modules/inventory-borrowing/server/evidence";
import { inventoryMethodNotAllowed } from "@/modules/inventory-borrowing/server/export";

// Evidence photo upload for a return (A-IB50, docs/design/inventory-borrowing.md 13.3). Thin: all logic
// lives in the module. POST only (multipart: requestId, file).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  // The session check runs here (AR8), after the same-origin check; the handler gates on its result.
  return handleEvidenceUpload(request, () => getAccessState());
}

export function GET(): Response {
  return inventoryMethodNotAllowed();
}

export const PUT = GET;
export const PATCH = GET;
export const DELETE = GET;
