import "server-only";
import {
  readAvailabilityBulk,
  readCatalog,
  readInventoryStatusCounts,
  readItemAvailability,
  readItemDetail,
  readItemHistory,
  readListEntries,
} from "@/lib/picore/inventory-borrowing";
import {
  availabilityQuerySchema,
  bulkAvailabilityQuerySchema,
  catalogQuerySchema,
  itemHistoryQuerySchema,
  listEntriesQuerySchema,
  type AvailabilityQueryInput,
  type BulkAvailabilityQueryInput,
  type CatalogPage,
  type CatalogQueryInput,
  type InventoryResult,
  type InventoryStatusCounts,
  type ItemAvailability,
  type ItemDetail,
  type ItemHistoryPage,
  type ItemHistoryQueryInput,
  type ListEntriesQueryInput,
  type ListEntry,
} from "../types";
import { requireInventory } from "./access";
import { idInputSchema, parseInput, safely, startInPast } from "./validation";

// Catalog reads (contract section 12). Order in each: session + capability (server), then input
// validation, then ONE database function with the user's client, which checks again. None throws.
// Permission is checked before validation so a caller without access learns nothing from the inputs.

/** Katalog / Kelola Barang list (F1). inventory.view; status archived/all also needs inventory.manage. */
export async function listCatalog(input: CatalogQueryInput = {}): Promise<InventoryResult<CatalogPage>> {
  return safely("listCatalog", async () => {
    const gate = await requireInventory("canViewCatalog");
    if (!gate.ok) return gate;
    const parsed = parseInput(catalogQuerySchema, input);
    if (!parsed.ok) return parsed;
    const { filters, page, pageSize } = parsed.data;
    if (filters.status !== "active" && !gate.capabilities.canManageInventory) return { ok: false, error: { code: "forbidden" } };
    const past = startInPast(filters.availableFrom, "availableFrom");
    if (past) return { ok: false, error: past };
    return readCatalog(gate.supabase, filters, page, pageSize);
  });
}

/** Item detail. Archived items answer not_found to non-managers (database rule). */
export async function getItemDetail(itemId: string): Promise<InventoryResult<ItemDetail>> {
  return safely("getItemDetail", async () => {
    const gate = await requireInventory("canViewCatalog");
    if (!gate.ok) return gate;
    const id = idInputSchema.safeParse(itemId);
    if (!id.success) return { ok: false, error: { code: "invalid_input", field: "itemId" } };
    return readItemDetail(gate.supabase, id.data);
  });
}

/** "Cek ketersediaan" for one item: counts only (R8). */
export async function getItemAvailability(input: AvailabilityQueryInput): Promise<InventoryResult<ItemAvailability>> {
  return safely("getItemAvailability", async () => {
    const gate = await requireInventory("canViewCatalog");
    if (!gate.ok) return gate;
    const parsed = parseInput(availabilityQuerySchema, input);
    if (!parsed.ok) return parsed;
    const past = startInPast(parsed.data.from, "from");
    if (past) return { ok: false, error: past };
    return readItemAvailability(gate.supabase, parsed.data.itemId, parsed.data.from, parsed.data.to);
  });
}

/** Availability for up to 100 items (request form, catalog date filter). */
export async function getAvailabilityBulk(input: BulkAvailabilityQueryInput): Promise<InventoryResult<ItemAvailability[]>> {
  return safely("getAvailabilityBulk", async () => {
    const gate = await requireInventory("canViewCatalog");
    if (!gate.ok) return gate;
    const parsed = parseInput(bulkAvailabilityQuerySchema, input);
    if (!parsed.ok) return parsed;
    const past = startInPast(parsed.data.from, "from");
    if (past) return { ok: false, error: past };
    if (parsed.data.itemIds.length === 0) return { ok: true, data: [] };
    return readAvailabilityBulk(gate.supabase, parsed.data.itemIds, parsed.data.from, parsed.data.to);
  });
}

/** Category or location list, A-Z (filters, forms, the list screen). */
export async function listEntries(input: ListEntriesQueryInput): Promise<InventoryResult<ListEntry[]>> {
  return safely("listEntries", async () => {
    const gate = await requireInventory("canViewCatalog");
    if (!gate.ok) return gate;
    const parsed = parseInput(listEntriesQuerySchema, input);
    if (!parsed.ok) return parsed;
    return readListEntries(gate.supabase, parsed.data.kind, parsed.data.includeInactive);
  });
}

/** "Riwayat barang": inventory.manage or borrowing.view_all. */
export async function listItemHistory(input: ItemHistoryQueryInput): Promise<InventoryResult<ItemHistoryPage>> {
  return safely("listItemHistory", async () => {
    const gate = await requireInventory("canViewItemHistory");
    if (!gate.ok) return gate;
    const parsed = parseInput(itemHistoryQuerySchema, input);
    if (!parsed.ok) return parsed;
    return readItemHistory(gate.supabase, parsed.data.itemId, parsed.data.page, parsed.data.pageSize);
  });
}

/** Dashboard "Inventaris Status" counts (no percentage). */
export async function getInventoryStatusCounts(): Promise<InventoryResult<InventoryStatusCounts>> {
  return safely("getInventoryStatusCounts", async () => {
    const gate = await requireInventory("canViewCatalog");
    if (!gate.ok) return gate;
    return readInventoryStatusCounts(gate.supabase);
  });
}
