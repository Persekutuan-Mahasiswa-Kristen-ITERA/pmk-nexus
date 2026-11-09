import type { Metadata } from "next";
import { Suspense } from "react";
import { getAccessState } from "@/lib/auth/session";
import { SignOutAction } from "@/components/auth/sign-out-action";
import { AlertMessage } from "@/components/ui/alert-message";
import { PageHeaderCard } from "@/components/ui/page-header-card";
import { getQueueCounts } from "@/modules/inventory-borrowing/server/borrowing";
import { getInventoryStatusCounts } from "@/modules/inventory-borrowing/server/catalog";
import { inventoryCapabilities } from "@/modules/inventory-borrowing/types";
import { InventoryStatusCard, InventoryStatusSkeleton } from "@/modules/inventory-borrowing/ui/dashboard-card";
import { getActiveMemberCount } from "@/modules/member-data/server/queries";
import { memberDataCapabilities } from "@/modules/member-data/types";
import { MemberCountCard, MemberCountSkeleton } from "@/modules/member-data/ui/dashboard-card";

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
 * (Inventaris, Data Anggota). Surat, Notulensi and Keuangan get no card until they exist (R-24, R-38).
 * The Dashboard module itself is built last.
 */
export default async function DashboardPage() {
  // Every protected page checks for itself; the layout already shows the right screen otherwise.
  const state = await getAccessState();
  if (state.kind !== "member") return null;

  const { fullName, activePeriodLabel } = state.member;
  const inventory = inventoryCapabilities(state);
  const members = memberDataCapabilities(state);
  const cardCount = (inventory.canViewCatalog ? 1 : 0) + (members.canView ? 1 : 0);

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-5 md:max-w-3xl md:gap-6">
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
        <div className={cardCount > 1 ? "grid gap-4 md:grid-cols-2" : "grid gap-4"}>
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
        </div>
      ) : null}

      {/* "Keluar" is also in the side drawer (spec F8); this copy stays until the Dashboard module is built. */}
      <div className="nx-rise nx-delay-3">
        <SignOutAction variant="text" />
      </div>
    </div>
  );
}

/** "Shalom, Grace!": the first word of the PI-CORE name; a one-word name is used whole. */
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
