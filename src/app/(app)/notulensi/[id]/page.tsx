import type { Metadata } from "next";
import { getAccessState } from "@/lib/auth/session";
import { ForbiddenScreen } from "@/components/access/forbidden-screen";
import { getMinuteDetail } from "@/modules/minutes/server/minutes";
import { MINUTE_COPY, MINUTE_ERROR_COPY_VARIANTS, MINUTE_ROUTES, minuteCapabilities, minuteDetailPath } from "@/modules/minutes/types";
import { MinuteDetailScreen } from "@/modules/minutes/ui/detail-screen";
import { pageFailure } from "@/modules/minutes/ui/page-errors";
import { isGuid, readMinuteNotice, type SearchParams } from "@/modules/minutes/ui/routes";
import { MessageCard, NarrowPage, UnavailableNotice } from "@/modules/minutes/ui/states";
import { minutesPageTitle } from "../page-data";

export async function generateMetadata(): Promise<Metadata> {
  return { title: await minutesPageTitle(MINUTE_COPY.detail.title) };
}

type PageProps = { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> };

/**
 * Detail Notulensi at /notulensi/{id} (spec 7 screen 2). minutes.view; an unknown id, a malformed id or a
 * minute outside this person's units all answer "Notulensi ini tidak ditemukan." (no hint that it
 * exists). The manager buttons come from the database's `actions` for this viewer.
 */
export default async function MinuteDetailPage({ params, searchParams }: PageProps) {
  const state = await getAccessState();
  if (state.kind !== "member") return null;

  const capabilities = minuteCapabilities(state);
  if (!capabilities.canView) return <ForbiddenScreen noActivePeriod={!capabilities.hasActivePeriod} />;

  const [{ id }, query] = await Promise.all([params, searchParams]);
  const notFound = (
    <NarrowPage>
      <MessageCard text={MINUTE_ERROR_COPY_VARIANTS.notFound.minute} backHref={MINUTE_ROUTES.list} backLabel={MINUTE_COPY.detail.back} />
    </NarrowPage>
  );
  if (!isGuid(id)) return notFound;

  const detail = await getMinuteDetail(id);
  if (!detail.ok) {
    const failure = pageFailure(detail.error, minuteDetailPath(id));
    if (failure === "forbidden") return <ForbiddenScreen noActivePeriod={!capabilities.hasActivePeriod} />;
    if (failure === "not_found" || failure === "invalid") return notFound;
    return (
      <NarrowPage>
        <UnavailableNotice />
      </NarrowPage>
    );
  }

  return <MinuteDetailScreen detail={detail.data} notice={readMinuteNotice(query)} />;
}
