import type { Metadata } from "next";
import { getAccessState } from "@/lib/auth/session";
import { ForbiddenScreen } from "@/components/access/forbidden-screen";
import { listCatalog, listEntries } from "@/modules/inventory-borrowing/server/catalog";
import { inventoryCapabilities, jakartaToday } from "@/modules/inventory-borrowing/types";
import type { CatalogResult } from "@/modules/inventory-borrowing/ui/catalog-screen";
import { ManageScreen } from "@/modules/inventory-borrowing/ui/manage-screen";
import { firstFailure, pageFailure } from "@/modules/inventory-borrowing/ui/page-errors";
import {
  catalogHref,
  MANAGE_PATH,
  manageExtra,
  readCatalogParams,
  readManageStatus,
  type SearchParams,
} from "@/modules/inventory-borrowing/ui/routes";
import { queueCountsFor } from "../queue-count";
import { inventoryPageTitle } from "../titles";

export async function generateMetadata(): Promise<Metadata> {
  return { title: await inventoryPageTitle("Kelola Barang") };
}

/**
 * Kelola Barang (design 4.3, screens 4 and 5): the manager's catalog with the status filter. Checks the
 * session and inventory.manage itself; the server read and the database check again (the status filter
 * archived/all is refused for anyone else).
 */
export default async function ManagePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const state = await getAccessState();
  if (state.kind !== "member") return null;

  const capabilities = inventoryCapabilities(state);
  if (!capabilities.canManageInventory) return <ForbiddenScreen noActivePeriod={!capabilities.hasActivePeriod} />;

  const query = await searchParams;
  // The manager list has no availability dates (design 5 is the member question).
  const values = { ...readCatalogParams(query), from: null, to: null };
  const status = readManageStatus(query);

  const [list, categories, locations, counts] = await Promise.all([
    listCatalog({
      filters: {
        search: values.search,
        categoryId: values.categoryId,
        locationId: values.locationId,
        condition: values.condition,
        status,
      },
      page: values.page,
    }),
    listEntries({ kind: "category" }),
    listEntries({ kind: "location" }),
    queueCountsFor(capabilities),
  ]);

  const next = catalogHref(values, MANAGE_PATH, manageExtra(status));
  const failure = firstFailure(
    list.ok ? null : pageFailure(list.error, next),
    categories.ok ? null : pageFailure(categories.error, next),
    locations.ok ? null : pageFailure(locations.error, next),
  );
  if (failure === "forbidden") return <ForbiddenScreen noActivePeriod={!capabilities.hasActivePeriod} />;

  let result: CatalogResult;
  if (list.ok && categories.ok && locations.ok) {
    result = { kind: "ok", list: list.data, categories: categories.data, locations: locations.data };
  } else if (categories.ok && locations.ok && !list.ok && list.error.code === "invalid_input" && list.error.field === "search") {
    result = { kind: "search_too_long", categories: categories.data, locations: locations.data };
  } else {
    result = { kind: "unavailable" };
  }

  return (
    <ManageScreen
      result={result}
      values={values}
      status={status}
      capabilities={capabilities}
      periodLabel={state.member.activePeriodLabel}
      today={jakartaToday()}
      queueActionCount={counts?.actionNeeded ?? null}
    />
  );
}
