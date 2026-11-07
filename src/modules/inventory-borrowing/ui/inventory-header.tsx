import type { ReactNode } from "react";
import { AlertMessage } from "@/components/ui/alert-message";
import { ModuleNav, type ModuleNavItem } from "@/components/ui/module-nav";
import type { InventoryCapabilities } from "../types";
import { COPY } from "./copy";
import { INVENTORY_PATH, MY_REQUESTS_PATH } from "./routes";

export type InventorySection = "catalog" | "mine" | "queue" | "manage";

/**
 * Sections that exist as pages. Antrean and Kelola Barang are part B: until their pages ship they stay
 * out of the control even for people who hold the key (R-24: no link to a page that does not exist).
 * Part B flips these to true.
 */
const SECTION_BUILT: Record<InventorySection, boolean> = {
  catalog: true,
  mine: true,
  queue: false,
  manage: false,
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
      href: `${INVENTORY_PATH}/antrean`,
      label: "Antrean",
      count,
      accessibleLabel: count ? `Antrean, ${count} perlu tindakan` : undefined,
    });
  }
  if (SECTION_BUILT.manage && capabilities.canManageInventory) {
    items.push({ key: "manage", href: `${INVENTORY_PATH}/kelola`, label: "Kelola Barang" });
  }
  return items;
}

/** True when part B has switched the Antrean segment on (the page then fetches its count). */
export function queueSectionVisible(capabilities: InventoryCapabilities): boolean {
  return SECTION_BUILT.queue && capabilities.canViewAllRequests;
}

/**
 * Title block of a module section page (design 3.2 and 4.2): Playfair title, period line, an optional
 * count box on the right, the segmented control, and the no-active-period banner (4.5).
 */
export function InventoryHeader({
  capabilities,
  periodLabel,
  current,
  countBox,
  queueActionCount = null,
}: {
  capabilities: InventoryCapabilities;
  periodLabel: string | null;
  current: InventorySection;
  /** "Hasil 42 barang" / "Pengajuan 3 berjalan"; null while unknown. */
  countBox?: { label: string; value: string; unit: string } | null;
  queueActionCount?: number | null;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end justify-between gap-4 border-b border-surface-line pb-3">
        <div className="min-w-0">
          <h1 className="font-heading text-display-lg text-balance text-title">{COPY.moduleTitle}</h1>
          {periodLabel ? <p className="text-body-md text-ink-body">Periode {periodLabel}</p> : null}
        </div>
        {countBox ? <CountBox {...countBox} /> : null}
      </div>
      {capabilities.hasActivePeriod ? null : (
        <AlertMessage role="status" tone="info">
          {COPY.noActivePeriod}
        </AlertMessage>
      )}
      <ModuleNav label={COPY.navLabel} items={inventorySections(capabilities, queueActionCount)} current={current} />
    </div>
  );
}

function CountBox({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <p className="shrink-0 rounded-lg border border-surface-line bg-surface px-3 py-1.5 text-right">
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
