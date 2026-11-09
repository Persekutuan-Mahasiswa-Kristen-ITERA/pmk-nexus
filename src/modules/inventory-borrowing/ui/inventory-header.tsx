import type { ReactNode } from "react";
import { AlertMessage } from "@/components/ui/alert-message";
import { ModuleNav, type ModuleNavItem } from "@/components/ui/module-nav";
import { HeaderStat, PageHeaderCard } from "@/components/ui/page-header-card";
import type { InventoryCapabilities, InventoryStatusCounts } from "../types";
import { COPY } from "./copy";
import { formatCount } from "./format";
import { INVENTORY_PATH, MANAGE_PATH, MY_REQUESTS_PATH, QUEUE_PATH } from "./routes";

export type InventorySection = "catalog" | "mine" | "queue" | "manage";

/**
 * Sections that exist as pages (R-24: no link to a page that does not exist). All four are built;
 * the switch stays so a section can be taken out again without touching the control.
 */
const SECTION_BUILT: Record<InventorySection, boolean> = {
  catalog: true,
  mine: true,
  queue: true,
  manage: true,
};

/**
 * The segments this person may use (design 4.3). Antrean needs borrowing.view_all (included in approve
 * and handle); Kelola Barang needs inventory.manage. Both match nothing without an active period (R11),
 * so the capabilities already hide them then. Hiding is convenience; every page checks again.
 */
export function inventorySections(capabilities: InventoryCapabilities, queueActionCount: number | null = null): ModuleNavItem[] {
  const items: ModuleNavItem[] = [
    { key: "catalog", href: INVENTORY_PATH, label: "Katalog" },
    { key: "mine", href: MY_REQUESTS_PATH, label: "Peminjaman Saya" },
  ];
  if (SECTION_BUILT.queue && capabilities.canViewAllRequests) {
    const count = queueActionCount && queueActionCount > 0 ? queueActionCount : null;
    items.push({
      key: "queue",
      href: QUEUE_PATH,
      label: "Antrean",
      count,
      accessibleLabel: count ? `Antrean, ${count} perlu tindakan` : undefined,
    });
  }
  if (SECTION_BUILT.manage && capabilities.canManageInventory) {
    items.push({ key: "manage", href: MANAGE_PATH, label: "Kelola Barang" });
  }
  return items;
}

/** True when part B has switched the Antrean segment on (the page then fetches its count). */
export function queueSectionVisible(capabilities: InventoryCapabilities): boolean {
  return SECTION_BUILT.queue && capabilities.canViewAllRequests;
}

/**
 * Title block of a module section page (design 3.2 and 4.2, D-023): the warm header card with the
 * period pill, the Playfair title and an optional count box or stat tiles, then the no-active-period
 * banner (4.5) and the segmented control.
 */
export function InventoryHeader({
  capabilities,
  periodLabel,
  current,
  countBox,
  stats,
  queueActionCount = null,
}: {
  capabilities: InventoryCapabilities;
  periodLabel: string | null;
  current: InventorySection;
  /** "Hasil 42 barang" / "Pengajuan 3 berjalan"; null while unknown. */
  countBox?: { label: string; value: string; unit: string } | null;
  /** Inventory-wide figures under the title (Katalog); null hides the row (unknown or failed). */
  stats?: InventoryStatusCounts | null;
  queueActionCount?: number | null;
}) {
  return (
    <div className="flex flex-col gap-4">
      <PageHeaderCard periodLabel={periodLabel} title={COPY.moduleTitle} aside={countBox ? <CountBox {...countBox} /> : null}>
        {stats ? <StatTiles counts={stats} /> : null}
      </PageHeaderCard>
      {capabilities.hasActivePeriod ? null : (
        <AlertMessage role="status" tone="info">
          {COPY.noActivePeriod}
        </AlertMessage>
      )}
      <div className="nx-rise nx-delay-1">
        <ModuleNav label={COPY.navLabel} items={inventorySections(capabilities, queueActionCount)} current={current} />
      </div>
    </div>
  );
}

/**
 * Three figures from the same counts as the Dashboard card. "Unit baik" includes the loaned units, so
 * the loan count is a note under it rather than a tile of its own (the tiles never add up wrongly).
 */
function StatTiles({ counts }: { counts: InventoryStatusCounts }) {
  if (counts.itemCount === 0) return null; // the list below already says the inventory is empty
  return (
    <dl aria-label="Ringkasan inventaris" className="mt-1 grid grid-cols-3 gap-2 md:gap-3">
      <HeaderStat label="Barang" value={counts.itemCount} />
      <HeaderStat label="Unit baik" value={counts.goodCount} note={`${formatCount(counts.goodOnLoanCount)} dipinjam`} />
      <HeaderStat label="Perlu servis" value={counts.needsServiceCount} warn={counts.needsServiceCount > 0} />
    </dl>
  );
}

function CountBox({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <p className="shrink-0 rounded-lg border border-gold-tint-line bg-surface px-3 py-1.5 text-right">
      <span className="block text-body-sm text-ink-meta">{label}</span>
      <span className="text-numeric-metric text-walnut tabular-nums">{value}</span>{" "}
      <span className="text-body-sm text-ink-body">{unit}</span>
    </p>
  );
}

/** Column for list screens (wide, as Data Anggota) and for forms and details (narrow, 448 px). */
export function ListColumn({ children }: { children: ReactNode }) {
  return <div className="mx-auto flex w-full max-w-xl flex-col gap-5 md:max-w-3xl">{children}</div>;
}

export function NarrowPage({ children }: { children: ReactNode }) {
  return <div className="mx-auto flex w-full max-w-md flex-col gap-4">{children}</div>;
}
