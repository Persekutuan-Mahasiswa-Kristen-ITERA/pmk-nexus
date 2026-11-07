import type { Metadata } from "next";
import { getAccessState } from "@/lib/auth/session";
import { ForbiddenScreen } from "@/components/access/forbidden-screen";
import { listCatalog, listEntries } from "@/modules/inventory-borrowing/server/catalog";
import { INVENTORY_ERROR_COPY, inventoryCapabilities, jakartaToday } from "@/modules/inventory-borrowing/types";
import { CatalogScreen, type CatalogResult } from "@/modules/inventory-borrowing/ui/catalog-screen";
import { firstFailure, pageFailure } from "@/modules/inventory-borrowing/ui/page-errors";
import { catalogHref, readCatalogParams, type SearchParams } from "@/modules/inventory-borrowing/ui/routes";
import { inventoryPageTitle } from "./titles";

export async function generateMetadata(): Promise<Metadata> {
  return { title: await inventoryPageTitle("Manajemen & Inventaris") };
}

/**
 * Katalog (docs/design/inventory-borrowing.md screen 2), the module landing. Checks the session and
 * inventory.view itself: the drawer is convenience only and the database checks a third time.
 */
export default async function KatalogPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const state = await getAccessState();
  if (state.kind !== "member") return null; // the layout already shows the right status screen

  const capabilities = inventoryCapabilities(state);
  const noActivePeriod = !capabilities.hasActivePeriod;
  if (!capabilities.canViewCatalog) return <ForbiddenScreen noActivePeriod={noActivePeriod} />;

  const values = readCatalogParams(await searchParams);
  const today = jakartaToday();

  // A date range is applied only when it is complete and valid; otherwise the list ignores it and the
  // field shows why (design 5.3). The server and the database check the same rules again.
  let dateError: string | null = null;
  let range: { from: string; to: string } | null = null;
  if (values.from && values.to) {
    if (values.from < today) dateError = INVENTORY_ERROR_COPY.start_in_past;
    else if (values.to < values.from) dateError = INVENTORY_ERROR_COPY.invalid_dates;
    else range = { from: values.from, to: values.to };
  }

  const [list, categories, locations] = await Promise.all([
    listCatalog({
      filters: {
        search: values.search,
        categoryId: values.categoryId,
        locationId: values.locationId,
        condition: values.condition,
        status: "active",
        availableFrom: range?.from ?? null,
        availableTo: range?.to ?? null,
      },
      page: values.page,
    }),
    listEntries({ kind: "category" }),
    listEntries({ kind: "location" }),
  ]);

  const next = catalogHref(values);
  const failure = firstFailure(
    list.ok ? null : pageFailure(list.error, next),
    categories.ok ? null : pageFailure(categories.error, next),
    locations.ok ? null : pageFailure(locations.error, next),
  );
  if (failure === "forbidden") return <ForbiddenScreen noActivePeriod={noActivePeriod} />;

  let result: CatalogResult;
  if (list.ok && categories.ok && locations.ok) {
    result = { kind: "ok", list: list.data, categories: categories.data, locations: locations.data };
  } else if (
    categories.ok &&
    locations.ok &&
    !list.ok &&
    list.error.code === "invalid_input" &&
    list.error.field === "search"
  ) {
    result = { kind: "search_too_long", categories: categories.data, locations: locations.data };
  } else {
    result = { kind: "unavailable" };
  }

  return (
    <CatalogScreen
      result={result}
      values={values}
      capabilities={capabilities}
      periodLabel={state.member.activePeriodLabel}
      today={today}
      dateError={dateError}
    />
  );
}
