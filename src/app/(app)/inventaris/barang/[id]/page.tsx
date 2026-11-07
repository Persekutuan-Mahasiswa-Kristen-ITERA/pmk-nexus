import type { Metadata } from "next";
import { getAccessState } from "@/lib/auth/session";
import { ForbiddenScreen } from "@/components/access/forbidden-screen";
import { getItemAvailability, getItemDetail } from "@/modules/inventory-borrowing/server/catalog";
import {
  INVENTORY_ERROR_COPY,
  INVENTORY_ERROR_COPY_VARIANTS,
  inventoryCapabilities,
  jakartaToday,
} from "@/modules/inventory-borrowing/types";
import type { AvailabilityResult } from "@/modules/inventory-borrowing/ui/availability-check";
import { ItemDetailScreen } from "@/modules/inventory-borrowing/ui/item-detail-screen";
import { NarrowPage } from "@/modules/inventory-borrowing/ui/inventory-header";
import { pageFailure } from "@/modules/inventory-borrowing/ui/page-errors";
import {
  catalogHref,
  catalogParams,
  INVENTORY_PARAMS,
  itemHref,
  readCatalogParams,
  readId,
  type SearchParams,
} from "@/modules/inventory-borrowing/ui/routes";
import { NotFoundCard, UnavailableNotice } from "@/modules/inventory-borrowing/ui/states";
import { ListNavigationProvider } from "@/components/list/list-navigation";
import { inventoryPageTitle } from "../../titles";

export async function generateMetadata(): Promise<Metadata> {
  return { title: await inventoryPageTitle("Detail barang") };
}

type PageProps = { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> };

/**
 * Item detail (design screen 3). Checks the session and inventory.view itself. Archived items answer
 * not_found to non-managers, so the page then reads "Barang ini tidak ditemukan." (design 6.4).
 */
export default async function ItemPage({ params, searchParams }: PageProps) {
  const state = await getAccessState();
  if (state.kind !== "member") return null;

  const capabilities = inventoryCapabilities(state);
  if (!capabilities.canViewCatalog) return <ForbiddenScreen noActivePeriod={!capabilities.hasActivePeriod} />;

  const [{ id }, query] = await Promise.all([params, searchParams]);
  const back = readCatalogParams(query);
  const backParams = catalogParams(back);
  if (back.page > 1) backParams[INVENTORY_PARAMS.page] = String(back.page);
  const backHref = catalogHref(back);

  const notFound = (
    <NarrowPage>
      <NotFoundCard text={INVENTORY_ERROR_COPY_VARIANTS.notFound.item} backHref={backHref} backLabel="Kembali ke katalog" />
    </NarrowPage>
  );

  const itemId = readId(id);
  if (!itemId) return notFound;

  const today = jakartaToday();
  const from = back.from ?? "";
  const to = back.to ?? "";

  let availability: AvailabilityResult = { kind: "none" };
  let check: Promise<Awaited<ReturnType<typeof getItemAvailability>>> | null = null;
  if (from && to) {
    if (from < today) availability = { kind: "invalid", field: "from", text: INVENTORY_ERROR_COPY.start_in_past ?? "" };
    else if (to < from) availability = { kind: "invalid", field: "to", text: INVENTORY_ERROR_COPY.invalid_dates ?? "" };
    else check = getItemAvailability({ itemId, from, to });
  }

  const [detail, checked] = await Promise.all([getItemDetail(itemId), check]);
  const next = itemHref(itemId, { ...backParams });

  if (!detail.ok) {
    const failure = pageFailure(detail.error, next);
    if (failure === "forbidden") return <ForbiddenScreen noActivePeriod={!capabilities.hasActivePeriod} />;
    if (failure === "not_found" || failure === "invalid") return notFound;
    return (
      <ListNavigationProvider>
        <NarrowPage>
          <UnavailableNotice />
        </NarrowPage>
      </ListNavigationProvider>
    );
  }

  if (checked) {
    if (checked.ok) availability = { kind: "ok", data: checked.data, from, to };
    else {
      const failure = pageFailure(checked.error, next);
      if (failure === "forbidden") return <ForbiddenScreen noActivePeriod={!capabilities.hasActivePeriod} />;
      if (checked.error.code === "start_in_past") {
        availability = { kind: "invalid", field: "from", text: INVENTORY_ERROR_COPY.start_in_past ?? "" };
      } else if (checked.error.code === "invalid_dates") {
        availability = { kind: "invalid", field: "to", text: INVENTORY_ERROR_COPY.invalid_dates ?? "" };
      } else {
        availability = { kind: "error" };
      }
    }
  }

  return (
    <ItemDetailScreen
      item={detail.data}
      capabilities={capabilities}
      backHref={backHref}
      path={itemHref(itemId)}
      keepParams={backParams}
      from={from}
      to={to}
      availability={availability}
      today={today}
    />
  );
}
