import type { Metadata } from "next";
import { getAccessState } from "@/lib/auth/session";
import { ForbiddenScreen } from "@/components/access/forbidden-screen";
import { getFinanceEntryDetail } from "@/modules/finance/server/reads";
import { FINANCE_COPY, FINANCE_ROUTES, financeCapabilities, financeEntryPath } from "@/modules/finance/types";
import { EntryDetailScreen } from "@/modules/finance/ui/detail-screen";
import { pageFailure } from "@/modules/finance/ui/page-errors";
import { isGuid, readFinanceNotice, type SearchParams } from "@/modules/finance/ui/routes";
import { MessageCard, NarrowPage, UnavailableNotice } from "@/modules/finance/ui/states";
import { financePageTitle } from "../page-data";

export async function generateMetadata(): Promise<Metadata> {
  return { title: await financePageTitle(FINANCE_COPY.detail.title) };
}

type PageProps = { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> };

/**
 * Detail Transaksi at /finance/{id} (spec 7 screen 2). finance.view; an unknown id or a malformed id
 * answers "Transaksi ini tidak ditemukan." The manager buttons come from the database's `actions` for this
 * viewer.
 */
export default async function EntryDetailPage({ params, searchParams }: PageProps) {
  const state = await getAccessState();
  if (state.kind !== "member") return null;

  const capabilities = financeCapabilities(state);
  if (!capabilities.canView) return <ForbiddenScreen noActivePeriod={!capabilities.hasActivePeriod} />;

  const [{ id }, query] = await Promise.all([params, searchParams]);
  const notFound = (
    <NarrowPage>
      <MessageCard text="Transaksi ini tidak ditemukan." backHref={FINANCE_ROUTES.list} backLabel={FINANCE_COPY.detail.back} />
    </NarrowPage>
  );
  if (!isGuid(id)) return notFound;

  const detail = await getFinanceEntryDetail(id);
  if (!detail.ok) {
    const failure = pageFailure(detail.error, financeEntryPath(id));
    if (failure === "forbidden") return <ForbiddenScreen noActivePeriod={!capabilities.hasActivePeriod} />;
    if (failure === "not_found" || failure === "invalid") return notFound;
    return (
      <NarrowPage>
        <UnavailableNotice />
      </NarrowPage>
    );
  }

  return <EntryDetailScreen detail={detail.data} notice={readFinanceNotice(query)} periodLabel={state.member.activePeriodLabel} />;
}
