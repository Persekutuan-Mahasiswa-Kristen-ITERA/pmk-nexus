import type { Metadata } from "next";
import { getAccessState } from "@/lib/auth/session";
import { ForbiddenScreen } from "@/components/access/forbidden-screen";
import { getMyRequestCaps, listMyRequests } from "@/modules/letters/server/requests";
import { letterCapabilities } from "@/modules/letters/types";
import { MyRequestsScreen } from "@/modules/letters/ui/my-requests-screen";
import { pageFailure } from "@/modules/letters/ui/page-errors";
import { myRequestsHref, readMyRequestsParams, type SearchParams } from "@/modules/letters/ui/routes";
import { lettersPageTitle, queueCountsFor } from "../page-data";

export async function generateMetadata(): Promise<Metadata> {
  return { title: await lettersPageTitle("Permohonan Saya") };
}

/**
 * Permohonan Saya (design screen 7). Every active member, own requests only (fixed right L9), readable
 * without an active period too (R7). The page checks the session itself; the database checks again.
 */
export default async function MyLetterRequestsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const state = await getAccessState();
  if (state.kind !== "member") return null;

  const capabilities = letterCapabilities(state);
  const { filter, page } = readMyRequestsParams(await searchParams);
  const [list, caps, queue] = await Promise.all([listMyRequests({ filter, page }), getMyRequestCaps(), queueCountsFor(capabilities)]);

  if (!list.ok && pageFailure(list.error, myRequestsHref(filter, page)) === "forbidden") {
    return <ForbiddenScreen noActivePeriod={!capabilities.hasActivePeriod} />;
  }

  return (
    <MyRequestsScreen
      result={list.ok ? { kind: "ok", page: list.data } : { kind: "unavailable" }}
      filter={list.ok ? list.data.filter : filter}
      capabilities={capabilities}
      periodLabel={state.member.activePeriodLabel}
      openCount={caps.ok ? caps.data.openCount : null}
      actionNeeded={queue?.actionNeeded ?? null}
    />
  );
}
