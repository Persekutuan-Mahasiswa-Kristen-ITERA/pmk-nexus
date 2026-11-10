import type { Metadata } from "next";
import { getAccessState } from "@/lib/auth/session";
import { ForbiddenScreen } from "@/components/access/forbidden-screen";
import { ListNavigationProvider } from "@/components/list/list-navigation";
import { getLetterDetail } from "@/modules/letters/server/register";
import { letterCapabilities } from "@/modules/letters/types";
import { COPY } from "@/modules/letters/ui/copy";
import { LetterDetailScreen } from "@/modules/letters/ui/letter-detail-screen";
import { NarrowPage } from "@/modules/letters/ui/letters-header";
import { pageFailure } from "@/modules/letters/ui/page-errors";
import { INCOMING_PATH, isGuid, letterHref, readLetterNotice, type SearchParams } from "@/modules/letters/ui/routes";
import { NotFoundCard, UnavailableNotice } from "@/modules/letters/ui/states";
import { lettersPageTitle } from "../page-data";

export async function generateMetadata(): Promise<Metadata> {
  return { title: await lettersPageTitle("Detail Surat") };
}

type PageProps = { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> };

/**
 * Detail Surat at /surat/{id} (design screen 3). letters.view; an unknown or malformed id answers
 * "Surat ini tidak ditemukan." The manager buttons come from the database's `actions` for this viewer.
 */
export default async function LetterDetailPage({ params, searchParams }: PageProps) {
  const state = await getAccessState();
  if (state.kind !== "member") return null;

  const capabilities = letterCapabilities(state);
  if (!capabilities.canViewRegister) return <ForbiddenScreen noActivePeriod={!capabilities.hasActivePeriod} />;

  const [{ id }, query] = await Promise.all([params, searchParams]);
  const notFound = (
    <NarrowPage>
      <NotFoundCard text={COPY.letterNotFound} backHref={INCOMING_PATH} backLabel={COPY.backToList} />
    </NarrowPage>
  );
  if (!isGuid(id)) return notFound;

  const detail = await getLetterDetail(id);
  if (!detail.ok) {
    const failure = pageFailure(detail.error, letterHref(id));
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

  return <LetterDetailScreen detail={detail.data} notice={readLetterNotice(query)} canViewRequests={capabilities.canViewAllRequests} />;
}
