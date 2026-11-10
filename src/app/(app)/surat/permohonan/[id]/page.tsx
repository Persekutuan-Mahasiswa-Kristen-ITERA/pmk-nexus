import type { Metadata } from "next";
import { getAccessState } from "@/lib/auth/session";
import { ForbiddenScreen } from "@/components/access/forbidden-screen";
import { ListNavigationProvider } from "@/components/list/list-navigation";
import { getRequestDetail } from "@/modules/letters/server/requests";
import { letterCapabilities } from "@/modules/letters/types";
import { COPY } from "@/modules/letters/ui/copy";
import { NarrowPage } from "@/modules/letters/ui/letters-header";
import { pageFailure } from "@/modules/letters/ui/page-errors";
import { RequestDetailScreen } from "@/modules/letters/ui/request-detail-screen";
import { isGuid, MY_REQUESTS_PATH, readRequestNotice, requestHref, type SearchParams } from "@/modules/letters/ui/routes";
import { NotFoundCard, UnavailableNotice } from "@/modules/letters/ui/states";
import { lettersPageTitle } from "../../page-data";

export async function generateMetadata(): Promise<Metadata> {
  return { title: await lettersPageTitle("Detail Permohonan") };
}

type PageProps = { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> };

/**
 * One request at /surat/permohonan/{id} (design screens 7 and 9). The requester and view_all holders may
 * read it; for anyone else, and for an unknown id, the answer is the same "Permohonan ini tidak
 * ditemukan." (10.5: nothing to probe).
 */
export default async function LetterRequestPage({ params, searchParams }: PageProps) {
  const state = await getAccessState();
  if (state.kind !== "member") return null;

  const capabilities = letterCapabilities(state);
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const notFound = (
    <NarrowPage>
      <NotFoundCard text={COPY.requestNotFound} backHref={MY_REQUESTS_PATH} backLabel="Kembali ke Permohonan Saya" />
    </NarrowPage>
  );
  if (!isGuid(id)) return notFound;

  const detail = await getRequestDetail(id);
  if (!detail.ok) {
    const failure = pageFailure(detail.error, requestHref(id));
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

  return (
    <RequestDetailScreen
      detail={detail.data}
      capabilities={capabilities}
      notice={readRequestNotice(query)}
      activePeriodLabel={state.member.activePeriodLabel}
    />
  );
}
