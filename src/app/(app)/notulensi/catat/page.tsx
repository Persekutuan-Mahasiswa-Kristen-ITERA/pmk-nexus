import type { Metadata } from "next";
import Link from "next/link";
import { getAccessState } from "@/lib/auth/session";
import { ForbiddenScreen } from "@/components/access/forbidden-screen";
import { AlertMessage } from "@/components/ui/alert-message";
import { buttonClass } from "@/components/ui/nx-button";
import { getMinuteDashboardCounts, listMinuteUnits } from "@/modules/minutes/server/minutes";
import {
  jakartaToday,
  MINUTE_COPY,
  MINUTE_ERROR_COPY,
  MINUTE_ROUTES,
  minuteCapabilities,
  recordableMinuteUnits,
} from "@/modules/minutes/types";
import { MinuteForm, type PeriodDates } from "@/modules/minutes/ui/minute-form";
import { pageFailure } from "@/modules/minutes/ui/page-errors";
import { MessageCard, NarrowPage, UnavailableNotice } from "@/modules/minutes/ui/states";
import { minutesPageTitle } from "../page-data";

export async function generateMetadata(): Promise<Metadata> {
  return { title: await minutesPageTitle(MINUTE_COPY.form.recordTitle) };
}

/**
 * Catat Notulensi (spec 7 screen 3, F3). minutes.manage and an active period; the unit select offers
 * only the units this person may write for (minute_unit_options canRecord). Checked here, again on save,
 * and a third time by the database.
 */
export default async function RecordMinutePage() {
  const state = await getAccessState();
  if (state.kind !== "member") return null;

  const capabilities = minuteCapabilities(state);
  if (!capabilities.canManage) return <ForbiddenScreen noActivePeriod={!capabilities.hasActivePeriod} />;

  if (!capabilities.canRecord) {
    return (
      <NarrowPage>
        <AlertMessage role="status" tone="info">
          {MINUTE_COPY.noActivePeriod}
        </AlertMessage>
        <Link href={MINUTE_ROUTES.list} className={buttonClass("text", "-ml-2 self-start")}>
          {MINUTE_COPY.form.back}
        </Link>
      </NarrowPage>
    );
  }

  const [units, period] = await Promise.all([listMinuteUnits(), readPeriod()]);
  if (!units.ok) {
    const failure = pageFailure(units.error, MINUTE_ROUTES.record);
    if (failure === "forbidden") return <ForbiddenScreen noActivePeriod={!capabilities.hasActivePeriod} />;
    return (
      <NarrowPage>
        <UnavailableNotice />
      </NarrowPage>
    );
  }

  const recordable = recordableMinuteUnits(units.data);
  if (recordable.length === 0) {
    return (
      <NarrowPage>
        <MessageCard text={MINUTE_ERROR_COPY.unit_not_allowed ?? MINUTE_COPY.unavailable} backHref={MINUTE_ROUTES.list} backLabel={MINUTE_COPY.form.back} />
      </NarrowPage>
    );
  }

  const today = jakartaToday();
  return (
    <NarrowPage>
      <MinuteForm
        mode="record"
        units={recordable}
        today={today}
        period={period}
        cancelHref={MINUTE_ROUTES.list}
        initial={{ meetingDate: today, title: "", topic: "", content: "", decision: "" }}
      />
    </NarrowPage>
  );
}

/** The active period's dates for the soft warning (R9). A failed read simply leaves the warning out. */
async function readPeriod(): Promise<PeriodDates | null> {
  try {
    const counts = await getMinuteDashboardCounts();
    if (!counts.ok || counts.data.periodId === null) return null;
    return { label: counts.data.periodLabel, startsOn: counts.data.periodStartsOn, endsOn: counts.data.periodEndsOn };
  } catch {
    return null;
  }
}
