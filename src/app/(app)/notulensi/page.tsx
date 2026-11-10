import type { Metadata } from "next";
import { getAccessState } from "@/lib/auth/session";
import { ForbiddenScreen } from "@/components/access/forbidden-screen";
import { getMinuteDashboardCounts, listMinuteUnits, listMinutes } from "@/modules/minutes/server/minutes";
import { MINUTE_COPY, minuteCapabilities, readableMinuteUnits, type MinuteDashboardCounts, type MinuteUnitOption } from "@/modules/minutes/types";
import { MinutesListScreen, type MinutesListResult } from "@/modules/minutes/ui/list-screen";
import { pageFailure } from "@/modules/minutes/ui/page-errors";
import { listHref, readListParams, type SearchParams } from "@/modules/minutes/ui/routes";
import { minutesPageTitle } from "./page-data";

export async function generateMetadata(): Promise<Metadata> {
  return { title: await minutesPageTitle(MINUTE_COPY.moduleTitle) };
}

/**
 * Notulensi Rapat (spec 7 screen 1). minutes.view in any unit scope; without an active period the key
 * matches nothing (R11) and the Forbidden screen says why. The list, the unit choices and the header
 * tiles are read side by side; the tiles and the unit filter are hints, so a failed read only hides them.
 */
export default async function MinutesListPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const state = await getAccessState();
  if (state.kind !== "member") return null;

  const capabilities = minuteCapabilities(state);
  if (!capabilities.canView) return <ForbiddenScreen noActivePeriod={!capabilities.hasActivePeriod} />;

  const values = readListParams(await searchParams);
  const [list, units, counts] = await Promise.all([
    listMinutes({
      filters: { search: values.search, unitId: values.unitId, period: values.period, status: values.status },
      page: values.page,
    }),
    readUnits(),
    readCounts(),
  ]);

  let result: MinutesListResult;
  if (list.ok) {
    result = { kind: "ok", page: list.data };
  } else {
    const failure = pageFailure(list.error, listHref(values));
    if (failure === "forbidden") return <ForbiddenScreen noActivePeriod={!capabilities.hasActivePeriod} />;
    result = list.error.code === "invalid_input" && list.error.field === "search" ? { kind: "search_too_long" } : { kind: "unavailable" };
  }

  return (
    <MinutesListScreen
      result={result}
      values={values}
      units={units}
      capabilities={capabilities}
      periodLabel={state.member.activePeriodLabel}
      counts={counts}
    />
  );
}

/** Units the person may read (the Unit filter shows with two or more). A failed read hides the filter. */
async function readUnits(): Promise<MinuteUnitOption[]> {
  try {
    const result = await listMinuteUnits();
    return result.ok ? readableMinuteUnits(result.data) : [];
  } catch {
    return [];
  }
}

/** The header tiles; a failed read shows no tiles (a hint, not data). */
async function readCounts(): Promise<MinuteDashboardCounts | null> {
  try {
    const result = await getMinuteDashboardCounts();
    return result.ok ? result.data : null;
  } catch {
    return null;
  }
}
