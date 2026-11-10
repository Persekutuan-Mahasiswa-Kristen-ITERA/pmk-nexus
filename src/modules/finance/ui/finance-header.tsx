import Link from "next/link";
import { AlertMessage } from "@/components/ui/alert-message";
import { buttonClass } from "@/components/ui/nx-button";
import { PageHeaderCard } from "@/components/ui/page-header-card";
import { cn } from "@/lib/utils";
import {
  FINANCE_COPY,
  FINANCE_ROUTES,
  formatFinanceCopy,
  formatRupiah,
  isNegativeRupiah,
  type FinanceCapabilities,
  type FinancePeriodOption,
  type FinanceSummary,
} from "../types";
import { UI_COPY } from "./copy";
import { PeriodSelect } from "./period-select";

const T = FINANCE_COPY.tiles;

/**
 * Title block of the list (spec 7 screen 1, D-023): the warm header card with the period pill, the title
 * "Finance", the period select, and the tiles of the WHOLE selected period (never the filter, A-FN3):
 * Total Saldo as the hero figure, Total Pemasukan and Total Pengeluaran under it, a "Saldo awal" line.
 * Money is text of digits end to end and goes through formatRupiah() only. A summary that could not be
 * read shows no tiles at all: never a stale or partial balance (spec 3 states).
 */
export function FinanceHeader({
  summary,
  periods,
  selectedPeriod,
  periodLabel,
  capabilities,
}: {
  summary: FinanceSummary | null;
  periods: FinancePeriodOption[];
  /** The period id in the address (null = the active period). */
  selectedPeriod: string | null;
  periodLabel: string | null;
  capabilities: FinanceCapabilities;
}) {
  const shownLabel = summary?.periodLabel ?? periodLabel;
  return (
    <div className="flex flex-col gap-4">
      <PageHeaderCard periodLabel={shownLabel} title={FINANCE_COPY.page.title}>
        {periods.length > 1 ? (
          <PeriodSelect periods={periods} value={selectedPeriod ?? periods.find((p) => p.isActive)?.periodId ?? ""} />
        ) : null}
        {summary ? <Tiles summary={summary} capabilities={capabilities} /> : null}
      </PageHeaderCard>

      {summary && !summary.isActivePeriod ? (
        <AlertMessage role="status" tone="info">
          {formatFinanceCopy(FINANCE_COPY.page.oldPeriodBanner, { label: summary.periodLabel ?? "" })}
        </AlertMessage>
      ) : null}
      {capabilities.canManage && !capabilities.hasActivePeriod ? (
        <AlertMessage role="status" tone="info">
          {FINANCE_COPY.page.noPeriodBanner}
        </AlertMessage>
      ) : null}
    </div>
  );
}

function Tiles({ summary, capabilities }: { summary: FinanceSummary; capabilities: FinanceCapabilities }) {
  const negative = isNegativeRupiah(summary.balance);
  return (
    <section aria-label={UI_COPY.summaryLabel} className="flex flex-col gap-3">
      <dl className="flex flex-col gap-2 md:max-w-xl md:gap-3">
        <div className="flex min-w-0 flex-col rounded-lg border border-gold-tint-line bg-surface px-4 pt-3 pb-3.5">
          <dt className="text-body-sm text-ink-meta">{T.balance}</dt>
          <dd className={cn("nx-figure-md mt-1 break-words tabular-nums", negative ? "text-danger" : "text-ink")}>
            {formatRupiah(summary.balance)}
          </dd>
          <dd className="mt-1 text-body-sm text-ink-body tabular-nums">
            {formatFinanceCopy(T.openingLine, { jumlah: formatRupiah(summary.openingAmount) })}
          </dd>
        </div>
        <div className="grid grid-cols-2 gap-2 md:gap-3">
          <Figure label={T.income} value={formatRupiah(summary.incomeTotal)} />
          <Figure label={T.expense} value={formatRupiah(summary.expenseTotal)} />
        </div>
      </dl>

      {!summary.hasOpening ? (
        capabilities.canRecord && summary.isActivePeriod ? (
          <div className="flex flex-col items-start gap-1">
            <AlertMessage role="status" tone="info">
              {T.openingMissingManager}
            </AlertMessage>
            <Link href={FINANCE_ROUTES.opening} className={buttonClass("outline", "nx-press")}>
              {T.openingMissingButton}
            </Link>
          </div>
        ) : (
          <AlertMessage role="status" tone="info">
            {T.openingMissingViewer}
          </AlertMessage>
        )
      ) : null}
      {negative ? (
        <AlertMessage role="status" tone="warning">
          {T.negativeBalance}
        </AlertMessage>
      ) : null}
    </section>
  );
}

/** One tile: label and a rupiah figure at the same size as the other tile (they share a baseline). */
function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col rounded-lg border border-gold-tint-line bg-surface px-3 pt-2.5 pb-3 md:px-4">
      <dt className="text-body-sm text-ink-meta">{label}</dt>
      <dd className="mt-1 text-body-lg font-bold break-words text-ink tabular-nums">{value}</dd>
    </div>
  );
}
