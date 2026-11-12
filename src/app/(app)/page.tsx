import type { Metadata } from "next";
import { Suspense } from "react";
import { getAccessState } from "@/lib/auth/session";
import { AlertMessage } from "@/components/ui/alert-message";
import { PageHeaderCard } from "@/components/ui/page-header-card";
import { getFinanceSummary } from "@/modules/finance/server/reads";
import { financeCapabilities } from "@/modules/finance/types";
import { FinanceCard, FinanceCardSkeleton } from "@/modules/finance/ui/dashboard-card";
import { getQueueCounts } from "@/modules/inventory-borrowing/server/borrowing";
import { getInventoryStatusCounts } from "@/modules/inventory-borrowing/server/catalog";
import { inventoryCapabilities } from "@/modules/inventory-borrowing/types";
import { InventoryStatusCard, InventoryStatusSkeleton } from "@/modules/inventory-borrowing/ui/dashboard-card";
import { getLetterDashboardCounts } from "@/modules/letters/server/register";
import { letterCapabilities } from "@/modules/letters/types";
import { LettersCard, LettersCardSkeleton } from "@/modules/letters/ui/dashboard-card";
import { getActiveMemberCount } from "@/modules/member-data/server/queries";
import { memberDataCapabilities } from "@/modules/member-data/types";
import { MemberCountCard, MemberCountSkeleton } from "@/modules/member-data/ui/dashboard-card";
import { getMinuteDashboardCounts } from "@/modules/minutes/server/minutes";
import { minuteCapabilities } from "@/modules/minutes/types";
import { MinutesCard, MinutesCardSkeleton } from "@/modules/minutes/ui/dashboard-card";

// The (app) layout may show a status screen instead of this page; the tab title follows it (QA NOTE-1).
const STATUS_TITLES = {
  anonymous: "Masuk",
  error: "Terjadi gangguan",
  no_access: "Belum ada akses",
  password_pending: "Ganti kata sandi dulu",
  member: "Dashboard",
} as const;

export async function generateMetadata(): Promise<Metadata> {
  const state = await getAccessState(); // cached per request: no extra database call
  return { title: STATUS_TITLES[state.kind] };
}

/**
 * Dashboard (D-023 pilot). Real data only: the header card with the period and a greeting by first name
 * (the h1; the tab title stays "Dashboard"), then one card per BUILT module the person may open
 * (Inventaris, Data Anggota, Notulensi Rapat, Surat Menyurat). Keuangan gets no card until it exists
 * (R-24, R-38).
 * The Dashboard module itself is built last.
 */
export default async function DashboardPage() {
  // Every protected page checks for itself; the layout already shows the right screen otherwise.
  const state = await getAccessState();
  if (state.kind !== "member") return null;

  const { fullName, activePeriodLabel } = state.member;
  const inventory = inventoryCapabilities(state);
  const members = memberDataCapabilities(state);
  // Surat Menyurat (letters design 15): letters.view only, and absent without an active period (R7).
  const showLetters = letterCapabilities(state).canViewRegister && activePeriodLabel !== null;
  // Notulensi Rapat (spec 7 screen 8, N5 a): minutes.view in any unit scope, counts only, absent without
  // an active period.
  const showMinutes = minuteCapabilities(state).canView && activePeriodLabel !== null;
  // Finance (spec 7 screen 9, A-FN20): finance.view only, active period only, saldo and totals, no percentage.
  const showFinance = financeCapabilities(state).canView && activePeriodLabel !== null;
  const cardCount =
    (inventory.canViewCatalog ? 1 : 0) + (members.canView ? 1 : 0) + (showFinance ? 1 : 0) + (showMinutes ? 1 : 0) + (showLetters ? 1 : 0);

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-5 md:max-w-3xl md:gap-dashboard xl:max-w-dashboard xl:gap-dashboard-wide">
      <PageHeaderCard periodLabel={activePeriodLabel} title={`Shalom, ${firstName(fullName)}!`}>
        <div className="flex flex-col gap-1">
          <p className="text-body-lg text-ink">Kamu masuk sebagai {fullName}.</p>
          {cardCount > 0 ? (
            <p className="text-body-md text-ink-body">Ringkasan ini hanya memuat modul yang bisa kamu buka.</p>
          ) : null}
        </div>
      </PageHeaderCard>

      {activePeriodLabel ? null : (
        // AUTH-39 / access-control R11: login works without an active period.
        <div className="nx-rise nx-delay-1">
          <AlertMessage role="status" tone="info">
            Belum ada periode aktif.
          </AlertMessage>
        </div>
      )}

      {cardCount > 0 ? (
        // Each card loads on its own, so one slow module never holds the others back (design 16.2).
        <div className={cardGridClass(cardCount)}>
          {inventory.canViewCatalog ? (
            <Suspense fallback={<InventoryStatusSkeleton />}>
              <InventoryStatus canApprove={inventory.canApprove} />
            </Suspense>
          ) : null}
          {members.canView ? (
            <Suspense fallback={<MemberCountSkeleton />}>
              <MemberCount />
            </Suspense>
          ) : null}
          {showFinance ? (
            <Suspense fallback={<FinanceCardSkeleton slot={2} />}>
              <FinanceTotals />
            </Suspense>
          ) : null}
          {showMinutes ? (
            <Suspense fallback={<MinutesCardSkeleton slot={2} />}>
              <MinutesCount />
            </Suspense>
          ) : null}
          {showLetters ? (
            <Suspense fallback={<LettersCardSkeleton slot={2} />}>
              <LettersCount />
            </Suspense>
          ) : null}
        </div>
      ) : null}

    </div>
  );
}

/** "Shalom, Grace!": the first word of the PI-CORE name; a one-word name is used whole. */
function cardGridClass(count: number): string {
  if (count <= 1) return "grid gap-4";
  if (count === 2) return "grid gap-4 md:grid-cols-2";
  if (count === 3) return "grid gap-4 md:grid-cols-2 xl:grid-cols-3";
  return "grid gap-4 md:grid-cols-2 xl:grid-cols-3";
}

function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] || fullName;
}

/** Reads the counts (inventory.view, checked again by the read and the database); errors stay in the card. */
async function InventoryStatus({ canApprove }: { canApprove: boolean }) {
  const [counts, queue] = await Promise.all([getInventoryStatusCounts(), canApprove ? getQueueCounts() : null]);
  return (
    <InventoryStatusCard
      result={counts.ok ? { kind: "ok", counts: counts.data } : { kind: "error" }}
      pendingApprovals={queue?.ok ? queue.data.pending : null}
    />
  );
}

/** member_data.view, checked again by getActiveMemberCount and the database (MD-38). */
async function MemberCount() {
  const count = await getActiveMemberCount();
  return <MemberCountCard result={count.ok ? { kind: "ok", count: count.data } : { kind: "error" }} />;
}

/** finance.view, checked again by getFinanceSummary and the database (FN-33). Totals of the active period only. */
async function FinanceTotals() {
  const summary = await getFinanceSummary();
  // No active period: the card is absent (R11). Any other failure stays inside the card, never a stale balance.
  if (!summary.ok && summary.error.code === "no_active_period") return null;
  return <FinanceCard slot={2} result={summary.ok ? { kind: "ok", summary: summary.data } : { kind: "error" }} />;
}

/** minutes.view, checked again by getMinuteDashboardCounts and the database (MN-28). Counts only. */
async function MinutesCount() {
  const counts = await getMinuteDashboardCounts();
  if (counts.ok && counts.data.periodId === null) return null; // no active period: the card is absent
  return <MinutesCard slot={2} result={counts.ok ? { kind: "ok", counts: counts.data } : { kind: "error" }} />;
}

/** letters.view, checked again by getLetterDashboardCounts and the database (L11). Counts only. */
async function LettersCount() {
  const counts = await getLetterDashboardCounts();
  if (counts.ok && counts.data.periodId === null) return null; // no active period: the card is absent (15.2)
  return <LettersCard slot={2} result={counts.ok ? { kind: "ok", counts: counts.data } : { kind: "error" }} />;
}
