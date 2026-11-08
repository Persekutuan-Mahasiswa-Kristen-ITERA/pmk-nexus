import type { Metadata } from "next";
import { getAccessState } from "@/lib/auth/session";
import { ForbiddenScreen } from "@/components/access/forbidden-screen";
import { listMyRequests } from "@/modules/inventory-borrowing/server/borrowing";
import { inventoryCapabilities } from "@/modules/inventory-borrowing/types";
import { MyRequestsScreen } from "@/modules/inventory-borrowing/ui/my-requests-screen";
import { pageFailure } from "@/modules/inventory-borrowing/ui/page-errors";
import { myRequestsHref, readMyRequestsParams, type SearchParams } from "@/modules/inventory-borrowing/ui/routes";
import { queueCountsFor } from "../queue-count";
import { inventoryPageTitle } from "../titles";

export async function generateMetadata(): Promise<Metadata> {
  return { title: await inventoryPageTitle("Peminjaman Saya") };
}

/**
 * Peminjaman Saya (design screen 7). Every active member, own requests only (fixed right L9); readable
 * without an active period too. The page checks the session itself; the database checks again.
 */
export default async function MyRequestsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const state = await getAccessState();
  if (state.kind !== "member") return null;

  const capabilities = inventoryCapabilities(state);
  const noActivePeriod = !capabilities.hasActivePeriod;
  // The module sits behind inventory.view (drawer, segments); own requests are a fixed right inside it.
  if (!capabilities.canViewCatalog || !capabilities.canViewOwnRequests) return <ForbiddenScreen noActivePeriod={noActivePeriod} />;

  const { filter, page } = readMyRequestsParams(await searchParams);
  const [list, counts] = await Promise.all([listMyRequests({ filter, page }), queueCountsFor(capabilities)]);

  if (!list.ok) {
    const failure = pageFailure(list.error, myRequestsHref(filter, page));
    if (failure === "forbidden") return <ForbiddenScreen noActivePeriod={noActivePeriod} />;
  }

  return (
    <MyRequestsScreen
      result={list.ok ? { kind: "ok", page: list.data } : { kind: "unavailable" }}
      filter={list.ok ? list.data.filter : filter}
      capabilities={capabilities}
      periodLabel={state.member.activePeriodLabel}
      queueActionCount={counts?.actionNeeded ?? null}
    />
  );
}
