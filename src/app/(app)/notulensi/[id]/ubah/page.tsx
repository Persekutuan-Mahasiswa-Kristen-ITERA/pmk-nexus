import type { Metadata } from "next";
import { getAccessState } from "@/lib/auth/session";
import { ForbiddenScreen } from "@/components/access/forbidden-screen";
import { getMinuteDashboardCounts, getMinuteDetail } from "@/modules/minutes/server/minutes";
import {
  jakartaToday,
  MINUTE_COPY,
  MINUTE_ERROR_COPY,
  MINUTE_ERROR_COPY_VARIANTS,
  MINUTE_ROUTES,
  minuteCapabilities,
  minuteDetailPath,
  minuteEditPath,
  minuteUnitLabel,
} from "@/modules/minutes/types";
import { UI_COPY } from "@/modules/minutes/ui/copy";
import { MinuteForm, type PeriodDates } from "@/modules/minutes/ui/minute-form";
import { pageFailure } from "@/modules/minutes/ui/page-errors";
import { isGuid } from "@/modules/minutes/ui/routes";
import { MessageCard, NarrowPage, UnavailableNotice } from "@/modules/minutes/ui/states";
import { minutesPageTitle } from "../../page-data";

export async function generateMetadata(): Promise<Metadata> {
  return { title: await minutesPageTitle(MINUTE_COPY.form.editTitle) };
}

/**
 * Ubah Notulensi (spec 7 screen 4, F4): minutes.manage on the minute's unit, an Aktif minute of the
 * active period (the database's actions.canEdit). A voided minute or one of an old period answers with
 * its reason; a minute of another unit is the Forbidden screen.
 */
export default async function EditMinutePage({ params }: { params: Promise<{ id: string }> }) {
  const state = await getAccessState();
  if (state.kind !== "member") return null;

  const capabilities = minuteCapabilities(state);
  if (!capabilities.canManage) return <ForbiddenScreen noActivePeriod={!capabilities.hasActivePeriod} />;

  const { id } = await params;
  const notFound = (
    <NarrowPage>
      <MessageCard text={MINUTE_ERROR_COPY_VARIANTS.notFound.minute} backHref={MINUTE_ROUTES.list} backLabel={MINUTE_COPY.form.back} />
    </NarrowPage>
  );
  if (!isGuid(id)) return notFound;

  const [detail, period] = await Promise.all([getMinuteDetail(id), readPeriod()]);
  if (!detail.ok) {
    const failure = pageFailure(detail.error, minuteEditPath(id));
    if (failure === "forbidden") return <ForbiddenScreen noActivePeriod={!capabilities.hasActivePeriod} />;
    if (failure === "not_found" || failure === "invalid") return notFound;
    return (
      <NarrowPage>
        <UnavailableNotice />
      </NarrowPage>
    );
  }

  const minute = detail.data;
  if (!minute.actions.canEdit) {
    const reason =
      minute.status === "voided" ? MINUTE_ERROR_COPY.minute_voided : !minute.isActivePeriod ? MINUTE_ERROR_COPY.closed_period : null;
    if (reason === null) return <ForbiddenScreen noActivePeriod={!capabilities.hasActivePeriod} />;
    return (
      <NarrowPage>
        <MessageCard text={reason} backHref={minuteDetailPath(minute.minuteId)} backLabel={UI_COPY.backToMinute} />
      </NarrowPage>
    );
  }

  return (
    <NarrowPage>
      <MinuteForm
        mode="edit"
        minuteId={minute.minuteId}
        version={minute.version}
        unitLabel={minuteUnitLabel(minute)}
        today={jakartaToday()}
        period={period}
        cancelHref={minuteDetailPath(minute.minuteId)}
        initial={{
          meetingDate: minute.meetingDate,
          title: minute.title,
          topic: minute.topic,
          content: minute.content,
          decision: minute.decision ?? "",
        }}
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
