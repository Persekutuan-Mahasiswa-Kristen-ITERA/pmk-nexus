import type { Metadata } from "next";
import { getAccessState } from "@/lib/auth/session";
import { ForbiddenScreen } from "@/components/access/forbidden-screen";
import { getMyRequestCaps, listRequestQueue } from "@/modules/letters/server/requests";
import { LETTER_ERROR_COPY, letterCapabilities } from "@/modules/letters/types";
import { pageFailure } from "@/modules/letters/ui/page-errors";
import { QueueScreen, type QueueResult } from "@/modules/letters/ui/queue-screen";
import { queueHref, readQueueParams, type SearchParams } from "@/modules/letters/ui/routes";
import { letterTilesFor, lettersPageTitle, queueCountsFor } from "../page-data";

export async function generateMetadata(): Promise<Metadata> {
  return { title: await lettersPageTitle("Antrean Permohonan") };
}

/**
 * Antrean Permohonan (design screen 8) for letter_requests.view_all. Checks the session and the key
 * itself; without an active period the key matches nothing (R7) and the Forbidden screen says why.
 */
export default async function LetterQueuePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const state = await getAccessState();
  if (state.kind !== "member") return null;

  const capabilities = letterCapabilities(state);
  if (!capabilities.canViewAllRequests) return <ForbiddenScreen noActivePeriod={!capabilities.hasActivePeriod} />;

  const values = readQueueParams(await searchParams, capabilities);
  // A date range applies only when it is complete and in order; past dates are allowed (history).
  let rangeError: string | null = null;
  let range: { from: string; to: string } | null = null;
  if (values.from && values.to) {
    if (values.to < values.from) rangeError = LETTER_ERROR_COPY.invalid_dates;
    else range = { from: values.from, to: values.to };
  }

  const [list, queue, caps] = await Promise.all([
    listRequestQueue({
      filters: { view: values.view, search: values.search, from: range?.from ?? null, to: range?.to ?? null },
      page: values.page,
    }),
    queueCountsFor(capabilities),
    capabilities.canProcessRequests ? getMyRequestCaps() : null,
  ]);
  const tiles = await letterTilesFor(capabilities, queue);

  let result: QueueResult;
  if (list.ok) {
    result = { kind: "ok", page: list.data };
  } else {
    const failure = pageFailure(list.error, queueHref(values));
    if (failure === "forbidden") return <ForbiddenScreen noActivePeriod={!capabilities.hasActivePeriod} />;
    if (list.error.code === "invalid_dates") rangeError = LETTER_ERROR_COPY.invalid_dates;
    result = { kind: "unavailable" };
  }

  // 3.4: the only processor right now, with an open request of their own that therefore waits.
  const loneProcessor =
    capabilities.canProcessRequests && queue?.processHolderCount === 1 && caps !== null && caps.ok && caps.data.openCount > 0;

  return (
    <QueueScreen
      result={result}
      values={values}
      counts={queue}
      capabilities={capabilities}
      periodLabel={state.member.activePeriodLabel}
      tiles={tiles}
      rangeError={rangeError}
      loneProcessor={loneProcessor}
    />
  );
}
