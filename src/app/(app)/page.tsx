import type { Metadata } from "next";
import { Suspense } from "react";
import { getAccessState } from "@/lib/auth/session";
import { SignOutAction } from "@/components/auth/sign-out-action";
import { AlertMessage } from "@/components/ui/alert-message";
import { NarrowColumn } from "@/components/shell/app-frame";
import { getQueueCounts } from "@/modules/inventory-borrowing/server/borrowing";
import { getInventoryStatusCounts } from "@/modules/inventory-borrowing/server/catalog";
import { inventoryCapabilities } from "@/modules/inventory-borrowing/types";
import { InventoryStatusCard, InventoryStatusSkeleton } from "@/modules/inventory-borrowing/ui/dashboard-card";

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
 * Placeholder for the Dashboard module (built last, CLAUDE.md section 9). Shows only real data: the
 * access state, and the cards of modules that are built (Inventaris Status, design inventory 16).
 */
export default async function DashboardPage() {
  // Every protected page checks for itself; the layout already shows the right screen otherwise.
  const state = await getAccessState();
  if (state.kind !== "member") return null;

  const { fullName, activePeriodLabel } = state.member;
  const inventory = inventoryCapabilities(state);

  return (
    <NarrowColumn>
      <div className="flex flex-col gap-5">
        <div>
          <h1 className="font-heading text-display-sm text-title">Dashboard</h1>
          <p className="mt-1 text-body-md text-ink-body">Masuk sebagai {fullName}.</p>
          {activePeriodLabel ? (
            <p className="mt-1 text-body-md text-ink-body">Periode {activePeriodLabel}</p>
          ) : null}
        </div>

        {activePeriodLabel ? null : (
          // AUTH-39 / access-control R11: login works without an active period.
          <AlertMessage role="status" tone="info">
            Belum ada periode aktif.
          </AlertMessage>
        )}

        {inventory.canViewCatalog ? (
          // The card loads on its own, so the rest of the Dashboard never waits for it (design 16.2).
          <Suspense fallback={<InventoryStatusSkeleton />}>
            <InventoryStatus canApprove={inventory.canApprove} />
          </Suspense>
        ) : null}

        {/* "Keluar" is also in the side drawer (spec F8); this copy stays until the Dashboard module is built. */}
        <SignOutAction variant="text" />
      </div>
    </NarrowColumn>
  );
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
