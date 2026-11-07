import { getAccessState } from "@/lib/auth/session";
import { handleInventoryExport, inventoryMethodNotAllowed } from "@/modules/inventory-borrowing/server/export";

// Inventory (catalog) export (docs/modules/inventory-borrowing.md F12). Thin: all logic lives in the module.
// POST only, because every export writes a log row; a GET (prefetch, crawler) must never trigger it.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  // The session check runs here (AR8), after the same-origin check; the handler gates on its result.
  return handleInventoryExport(request, () => getAccessState());
}

export function GET(): Response {
  return inventoryMethodNotAllowed();
}

export const PUT = GET;
export const PATCH = GET;
export const DELETE = GET;
