import type { Metadata } from "next";
import Link from "next/link";
import { getAccessState } from "@/lib/auth/session";
import { ForbiddenScreen } from "@/components/access/forbidden-screen";
import { ListNavigationProvider } from "@/components/list/list-navigation";
import { AlertMessage } from "@/components/ui/alert-message";
import { buttonClass } from "@/components/ui/nx-button";
import { getRequestDetail } from "@/modules/letters/server/requests";
import { jakartaToday, letterCapabilities } from "@/modules/letters/types";
import { COPY } from "@/modules/letters/ui/copy";
import { IssueForm } from "@/modules/letters/ui/issue-form";
import { NarrowPage } from "@/modules/letters/ui/letters-header";
import { pageFailure } from "@/modules/letters/ui/page-errors";
import { issueHref, isGuid, QUEUE_PATH, requestHref } from "@/modules/letters/ui/routes";
import { NotFoundCard, UnavailableNotice } from "@/modules/letters/ui/states";
import { lettersPageTitle } from "../../../page-data";

export async function generateMetadata(): Promise<Metadata> {
  return { title: await lettersPageTitle("Terbitkan surat") };
}

/**
 * "Terbitkan surat" (design 12.3, 12.8): letter_requests.process, never the viewer's own request, only
 * after "Ambil nomor". Otherwise the address explains what to do first. The action and the database
 * check every rule again.
 */
export default async function IssueLetterPage({ params }: { params: Promise<{ id: string }> }) {
  const state = await getAccessState();
  if (state.kind !== "member") return null;

  const capabilities = letterCapabilities(state);
  if (!capabilities.canProcessRequests) return <ForbiddenScreen noActivePeriod={!capabilities.hasActivePeriod} />;

  const { id } = await params;
  const notFound = (
    <NarrowPage>
      <NotFoundCard text={COPY.requestNotFound} backHref={QUEUE_PATH} backLabel="Kembali ke Antrean" />
    </NarrowPage>
  );
  if (!isGuid(id)) return notFound;

  const detail = await getRequestDetail(id);
  if (!detail.ok) {
    const failure = pageFailure(detail.error, issueHref(id));
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

  const request = detail.data;
  const back = (
    <Link href={requestHref(request.requestId)} className={buttonClass("text", "mt-2 -ml-2")}>
      {COPY.backToRequest}
    </Link>
  );

  if (request.isOwn) {
    return (
      <NarrowPage>
        <AlertMessage role="status" tone="info">
          {COPY.ownRequest}
        </AlertMessage>
        {back}
      </NarrowPage>
    );
  }
  if (!capabilities.hasActivePeriod) {
    return (
      <NarrowPage>
        <AlertMessage role="status" tone="warning">
          {COPY.noPeriodLetter}
        </AlertMessage>
        {back}
      </NarrowPage>
    );
  }
  if (!request.actions.canIssue || !request.letter) {
    // Not taken yet, or already decided by someone else (12.8).
    return (
      <NarrowPage>
        <div className="rounded-xl border border-surface-line bg-surface p-5 shadow-elevation-1">
          <p role="status" className="text-body-md text-ink">
            {request.status === "processing" && request.numberText === null ? COPY.issueNeedsNumber : COPY.stateChanged}
          </p>
          {back}
        </div>
      </NarrowPage>
    );
  }

  return (
    <NarrowPage>
      <IssueForm detail={request} letter={request.letter} today={jakartaToday()} activePeriodLabel={state.member.activePeriodLabel} />
    </NarrowPage>
  );
}
