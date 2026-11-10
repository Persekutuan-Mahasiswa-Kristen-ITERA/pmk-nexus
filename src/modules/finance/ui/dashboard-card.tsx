import { Wallet } from "lucide-react";
import { ListNavigationProvider, RetryButton } from "@/components/list/list-navigation";
import { DashboardCard, DashboardCardLink } from "@/components/ui/dashboard-card";
import { buttonClass } from "@/components/ui/nx-button";
import { SkeletonBar } from "@/components/ui/skeleton-bar";
import { cn } from "@/lib/utils";
import { FINANCE_COPY, FINANCE_ROUTES, formatFinanceCopy, formatRupiah, isNegativeRupiah, type FinanceSummary } from "../types";
import { UI_COPY } from "./copy";

const TITLE_ID = "finance-card-title";
const C = FINANCE_COPY.dashboard;

function Card({ slot, children }: { slot: number; children: React.ReactNode }) {
  return (
    <DashboardCard slot={slot} titleId={TITLE_ID} title={C.title} icon={<Wallet aria-hidden="true" className="size-5" strokeWidth={2} />}>
      {children}
    </DashboardCard>
  );
}

export type FinanceCardResult = { kind: "ok"; summary: FinanceSummary } | { kind: "error" };

/**
 * Dashboard card "Finance" (spec 7 screen 9, A-FN20): Total Saldo, Pemasukan and Pengeluaran of the ACTIVE
 * period for finance.view holders only, no percentage and no growth badge. Money is text of digits and goes
 * through formatRupiah() only. An error stays inside the card and never shows a stale or partial balance.
 */
export function FinanceCard({ result, slot = 0 }: { result: FinanceCardResult; slot?: number }) {
  if (result.kind === "error") {
    return (
      <Card slot={slot}>
        <p role="alert" className="text-body-md text-warn">
          {C.error}
        </p>
        <ListNavigationProvider>
          <RetryButton className={buttonClass("text", "-ml-2 self-start")} />
        </ListNavigationProvider>
      </Card>
    );
  }

  const { summary } = result;
  const empty = summary.entryCount === 0 && !summary.hasOpening;
  const negative = isNegativeRupiah(summary.balance);
  return (
    <Card slot={slot}>
      {empty ? (
        <p className="text-body-md text-ink-body">{C.empty}</p>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-body-sm text-ink-meta">{formatFinanceCopy(C.periodLine, { label: summary.periodLabel ?? "-" })}</p>
          <div>
            <p className="text-body-sm text-ink-body">{C.balance}</p>
            <p className={cn("nx-figure-md break-words tabular-nums", negative ? "text-danger" : "text-ink")}>{formatRupiah(summary.balance)}</p>
          </div>
          <dl className="grid grid-cols-2 gap-2">
            <Line label={C.income} value={formatRupiah(summary.incomeTotal)} />
            <Line label={C.expense} value={formatRupiah(summary.expenseTotal)} />
          </dl>
        </div>
      )}
      <DashboardCardLink href={FINANCE_ROUTES.list}>{C.link}</DashboardCardLink>
    </Card>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col rounded-lg border border-gold-tint-line bg-gold-tint px-3 py-2">
      <dt className="text-body-sm text-ink-body">{label}</dt>
      <dd className="text-body-md font-semibold break-words text-ink tabular-nums">{value}</dd>
    </div>
  );
}

/** Loading shape: flat ivory bars with the sweep, and a caption. */
export function FinanceCardSkeleton({ slot = 0 }: { slot?: number }) {
  return (
    <Card slot={slot}>
      <p role="status" className="text-body-sm text-ink-body">
        {UI_COPY.loadingDashboard}
      </p>
      <div aria-hidden="true" className="flex flex-col gap-2">
        <SkeletonBar className="h-3 w-[120px]" />
        <SkeletonBar className="h-9 w-[180px]" />
        <SkeletonBar className="mt-1 h-12 w-full rounded-lg" />
      </div>
    </Card>
  );
}
