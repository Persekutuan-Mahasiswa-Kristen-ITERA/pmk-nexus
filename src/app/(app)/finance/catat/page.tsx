import type { Metadata } from "next";
import Link from "next/link";
import { getAccessState } from "@/lib/auth/session";
import { ForbiddenScreen } from "@/components/access/forbidden-screen";
import { AlertMessage } from "@/components/ui/alert-message";
import { buttonClass } from "@/components/ui/nx-button";
import { getFinanceEntryDetail, getFinanceSummary } from "@/modules/finance/server/reads";
import {
  FINANCE_COPY,
  FINANCE_PARAMS,
  FINANCE_ROUTES,
  financeCapabilities,
  financeCorrectionPrefill,
  financeRerecordPrefill,
  jakartaToday,
  type FinanceRecordPrefill,
} from "@/modules/finance/types";
import { pageFailure } from "@/modules/finance/ui/page-errors";
import { initialValues, RecordForm, type FinancePeriodDates } from "@/modules/finance/ui/record-form";
import { firstParam, isGuid, type SearchParams } from "@/modules/finance/ui/routes";
import { MessageCard, NarrowPage, UnavailableNotice } from "@/modules/finance/ui/states";
import { financePageTitle } from "../page-data";

export async function generateMetadata(): Promise<Metadata> {
  return { title: await financePageTitle(FINANCE_COPY.form.title) };
}

/**
 * Catat Transaksi (spec 7 screen 3, F2) and its two prefilled forms: "Buat koreksi" (?correct=, screen 5,
 * F5) and "Catat ulang" (?again=, F4). finance.manage and an active period; checked here, again on save, and
 * a third time by the database. A prefill is built from the entry's own detail (the contract helpers), so a
 * link that is not allowed for this person simply opens the plain form.
 */
export default async function RecordEntryPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const state = await getAccessState();
  if (state.kind !== "member") return null;

  const capabilities = financeCapabilities(state);
  if (!capabilities.canManage) return <ForbiddenScreen noActivePeriod={!capabilities.hasActivePeriod} />;

  if (!capabilities.canRecord) {
    return (
      <NarrowPage>
        <AlertMessage role="status" tone="info">
          {FINANCE_COPY.page.noPeriodBanner}
        </AlertMessage>
        <Link href={FINANCE_ROUTES.list} className={buttonClass("text", "-ml-2 self-start")}>
          {FINANCE_COPY.form.back}
        </Link>
      </NarrowPage>
    );
  }

  const query = await searchParams;
  const correctId = firstParam(query, FINANCE_PARAMS.correct);
  const againId = firstParam(query, FINANCE_PARAMS.again);

  let prefill: FinanceRecordPrefill | null = null;
  const sourceId = isGuid(correctId) ? correctId : isGuid(againId) ? againId : null;
  if (sourceId !== null) {
    const detail = await getFinanceEntryDetail(sourceId);
    if (!detail.ok) {
      const failure = pageFailure(detail.error, FINANCE_ROUTES.record);
      if (failure === "forbidden") return <ForbiddenScreen noActivePeriod={!capabilities.hasActivePeriod} />;
      if (failure === "unavailable") {
        return (
          <NarrowPage>
            <UnavailableNotice />
          </NarrowPage>
        );
      }
      // Not found or invalid: the plain form.
    } else if (isGuid(correctId)) {
      prefill = financeCorrectionPrefill(detail.data);
    } else {
      prefill = financeRerecordPrefill(detail.data);
    }
  }

  // A Saldo awal is recorded on its own form; send a "Catat ulang" of one there.
  if (prefill?.entryType === "opening") {
    return (
      <NarrowPage>
        <MessageCard text={FINANCE_COPY.opening.title} backHref={`${FINANCE_ROUTES.opening}?${FINANCE_PARAMS.again}=${sourceId}`} backLabel={FINANCE_COPY.opening.title} />
      </NarrowPage>
    );
  }

  const period = await readPeriod();
  const today = jakartaToday();
  return (
    <NarrowPage>
      <RecordForm
        mode="entry"
        today={today}
        period={period}
        initial={initialValues(today, "expense", prefill)}
        correction={prefill?.correctsEntryId ? { entryId: prefill.correctsEntryId, numberText: prefill.correctsNumberText ?? "" } : null}
        previous={null}
        cancelHref={FINANCE_ROUTES.list}
      />
    </NarrowPage>
  );
}

/** The active period's dates for the soft warning (R5). A failed read simply leaves the warning out. */
async function readPeriod(): Promise<FinancePeriodDates | null> {
  try {
    const summary = await getFinanceSummary();
    if (!summary.ok) return null;
    return { label: summary.data.periodLabel, startsOn: summary.data.startsOn, endsOn: summary.data.endsOn };
  } catch {
    return null;
  }
}
