import { getAccessState } from "@/lib/auth/session";
import { financeMethodNotAllowed } from "@/modules/finance/server/http";
import { handleFinanceProofUpload } from "@/modules/finance/server/proofs";

// Finance proof upload (docs/modules/finance.md 4.4). Thin: all logic lives in the module. POST only
// (multipart: exactly one field "file").
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  // The session check runs here (AR8), after the same-origin check; the handler gates on its result.
  return handleFinanceProofUpload(request, () => getAccessState());
}

export function GET(): Response {
  return financeMethodNotAllowed();
}

export const PUT = GET;
export const PATCH = GET;
export const DELETE = GET;
