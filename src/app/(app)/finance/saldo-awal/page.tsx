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
  financeRerecordPrefill,
  formatFinanceCopy,
  formatRupiah,
  jakartaToday,
  openingAmountFromPrevious,
  type FinanceRecordPrefill,
  type FinanceSummary,
} from "@/modules/finance/types";
import { pageFailure } from "@/modules/finance/ui/page-errors";
import { initialValues, RecordForm } from "@/modules/finance/ui/record-form";
import { firstParam, isGuid, type SearchParams } from "@/modules/finance/ui/routes";
import { MessageCard, NarrowPage, UnavailableNotice } from "@/modules/finance/ui/states";
import { financePageTitle } from "../page-data";

export async function generateMetadata(): Promise<Metadata> {
  return { title: await financePageTitle(FINANCE_COPY.opening.title) };
}

/**
 * Catat Saldo Awal (spec 7 screen 4, F3). finance.manage and an active period. One Aktif Saldo awal per
 * period: when one exists the page says so and offers nothing to record (the database refuses a second
 * anyway). The previous period's closing balance is a HINT with "Pakai angka ini", never a silent prefill
 * (FN-21). Rp 0 is a valid Saldo awal (A-FN1).
 */
export default async function RecordOpeningPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
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

  const summary = await getFinanceSummary();
  if (!summary.ok) {
    const failure = pageFailure(summary.error, FINANCE_ROUTES.opening);
    if (failure === "forbidden") return <ForbiddenScreen noActivePeriod={!capabilities.hasActivePeriod} />;
    return (
      <NarrowPage>
        <UnavailableNotice />
      </NarrowPage>
    );
  }
  const data: FinanceSummary = summary.data;

  if (data.hasOpening) {
    return (
      <NarrowPage>
        <MessageCard text={FINANCE_COPY.opening.exists} backHref={FINANCE_ROUTES.list} backLabel={FINANCE_COPY.form.back} />
      </NarrowPage>
    );
  }

  // "Catat ulang" of a voided Saldo awal: the same form with the old values as a copy.
  const againId = firstParam(await searchParams, FINANCE_PARAMS.again);
  let prefill: FinanceRecordPrefill | null = null;
  if (isGuid(againId)) {
    const detail = await getFinanceEntryDetail(againId);
    if (detail.ok) prefill = financeRerecordPrefill(detail.data);
    else if (pageFailure(detail.error, FINANCE_ROUTES.opening) === "unavailable") {
      return (
        <NarrowPage>
          <UnavailableNotice />
        </NarrowPage>
      );
    }
  }
  if (prefill !== null && prefill.entryType !== "opening") prefill = null;

  const today = jakartaToday();
  const label = data.periodLabel ?? "";
  // The hint shows the formatted balance (it may be negative); "Pakai angka ini" fills the field with digits,
  // and only exists when those digits exist (a negative balance cannot be an opening amount).
  const previous =
    data.previousClosingBalance === null
      ? null
      : { label: data.previousPeriodLabel, balanceText: formatRupiah(data.previousClosingBalance), digits: openingAmountFromPrevious(data) };

  return (
    <NarrowPage>
      <RecordForm
        mode="opening"
        today={today}
        period={{ label: data.periodLabel, startsOn: data.startsOn, endsOn: data.endsOn }}
        initial={initialValues(today, "opening", prefill, formatFinanceCopy(FINANCE_COPY.opening.descriptionDefault, { label }))}
        correction={null}
        previous={previous}
        cancelHref={FINANCE_ROUTES.list}
      />
    </NarrowPage>
  );
}
