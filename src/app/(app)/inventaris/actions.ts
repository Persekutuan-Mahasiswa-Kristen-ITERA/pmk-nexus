"use server";

import { getAccessState } from "@/lib/auth/session";
import { getAvailabilityBulk, listCatalog } from "@/modules/inventory-borrowing/server/catalog";
import { getEvidencePhotoLinks } from "@/modules/inventory-borrowing/server/borrowing";
import {
  INVENTORY_PAGE_SIZE_MAX,
  type BulkAvailabilityQueryInput,
  type EvidencePhotoLink,
  type InventoryError,
  type InventoryResult,
  type ItemAvailability,
} from "@/modules/inventory-borrowing/types";
import type { PickerItem } from "@/modules/inventory-borrowing/ui/item-picker";

// Thin Server Action entry points for the reads a Client Component needs while the person types
// (request form availability, item picker, evidence photos). Each one checks the session first (AR8),
// then calls a contract read, which checks the session and the capability again, validates with zod
// and lets the database check a third time. They return what the read returns (InventoryResult).

/** Session gate (AR8). Anyone who is not an active member stops here, before any read runs. */
async function sessionError(): Promise<InventoryError | null> {
  try {
    const state = await getAccessState();
    if (state.kind === "member") return null;
    if (state.kind === "anonymous") return { code: "unauthenticated" };
    if (state.kind === "error") return { code: "unavailable" };
    return { code: "forbidden" };
  } catch {
    return { code: "unavailable" };
  }
}

/** Live availability on the request form lines (design 9.3). Counts only, never who (R8). */
export async function checkAvailability(input: BulkAvailabilityQueryInput): Promise<InventoryResult<ItemAvailability[]>> {
  const denied = await sessionError();
  if (denied) return { ok: false, error: denied };
  return getAvailabilityBulk(input);
}

/**
 * Items the picker offers: active items with stock in Baik ("Only active items with stock in Baik
 * are offered", design 9.2), matched by name or code. One page of the largest allowed size.
 */
export async function searchLendableItems(search: string): Promise<InventoryResult<{ rows: PickerItem[]; total: number }>> {
  const denied = await sessionError();
  if (denied) return { ok: false, error: denied };
  const result = await listCatalog({
    filters: { search, condition: "good", status: "active" },
    page: 1,
    pageSize: INVENTORY_PAGE_SIZE_MAX,
  });
  if (!result.ok) return result;
  return {
    ok: true,
    data: {
      total: result.data.total,
      rows: result.data.rows
        .filter((row) => row.isActive && row.qtyGood > 0)
        .map((row) => ({
          itemId: row.itemId,
          name: row.name,
          code: row.code,
          mode: row.mode,
          unitCount: row.unitCount,
          categoryName: row.categoryName,
          qtyGood: row.qtyGood,
        })),
    },
  };
}

/** Short-lived signed links to a request's evidence photos (requester or view_all; A-IB51). */
export async function loadEvidencePhotos(requestId: string): Promise<InventoryResult<EvidencePhotoLink[]>> {
  const denied = await sessionError();
  if (denied) return { ok: false, error: denied };
  return getEvidencePhotoLinks(requestId);
}
