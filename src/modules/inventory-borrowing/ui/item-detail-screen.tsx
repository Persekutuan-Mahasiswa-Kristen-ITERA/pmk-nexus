import Link from "next/link";
import type { ReactNode } from "react";
import { ListNavigationProvider } from "@/components/list/list-navigation";
import { AlertMessage } from "@/components/ui/alert-message";
import { buttonClass } from "@/components/ui/nx-button";
import { StatusChip } from "@/components/ui/status-chip";
import { ITEM_MODE_LABEL, UNIT_STATUS_LABEL, type InventoryCapabilities, type ItemCondition, type ItemDetail } from "../types";
import { AvailabilityCheck, type AvailabilityResult } from "./availability-check";
import { ConditionChip, UnitChip } from "./chips";
import { COPY } from "./copy";
import { formatCount } from "./format";
import { NarrowPage } from "./inventory-header";
import { requestFormHref } from "./routes";
import { BackLink, SectionCard } from "./states";

const CONDITIONS: { key: ItemCondition; count: (s: ItemDetail["stock"]) => number }[] = [
  { key: "good", count: (s) => s.good },
  { key: "needs_service", count: (s) => s.needsService },
  { key: "damaged", count: (s) => s.damaged },
];

/**
 * Item detail and availability check (design screen 3), member view. Everything about one item, and
 * "is it free on my dates?" without ever saying who has it (R8).
 */
export function ItemDetailScreen({
  item,
  capabilities,
  backHref,
  path,
  keepParams,
  from,
  to,
  availability,
  today,
  managerActions = null,
  notice = null,
}: {
  item: ItemDetail;
  capabilities: InventoryCapabilities;
  /** Katalog with the same filters (kept in the address). */
  backHref: string;
  path: string;
  keepParams: Record<string, string>;
  from: string;
  to: string;
  availability: AvailabilityResult;
  today: string;
  /**
   * Part B slot for inventory.manage holders: "Ubah barang" and the stock dialogs (design 6.3, 7).
   * Null until Kelola Barang ships; the page passes nothing for anyone else.
   */
  managerActions?: ReactNode;
  /** One-time success text after a manager saved (design 7.5), shown under the title. */
  notice?: string | null;
}) {
  const canAsk = item.isActive && item.stock.good > 0 && capabilities.canSubmitRequest;
  const activeUnits = item.units.filter((u) => u.status === "active");
  const subtitle = item.mode === "quantity" ? item.code : `${formatCount(activeUnits.length)} unit`;

  return (
    <ListNavigationProvider>
      <NarrowPage>
        <BackLink href={backHref}>Katalog</BackLink>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-heading text-display-sm break-words text-title">{item.name}</h1>
            {item.isActive ? null : <StatusChip tone="ivory">{UNIT_STATUS_LABEL.archived}</StatusChip>}
          </div>
          {subtitle ? <p className="text-body-sm text-ink-meta tabular-nums">{subtitle}</p> : null}
        </div>

        {notice ? (
          <AlertMessage role="status" tone="success">
            {notice}
          </AlertMessage>
        ) : null}

        {capabilities.hasActivePeriod ? null : (
          <AlertMessage role="status" tone="info">
            {COPY.noActivePeriod}
          </AlertMessage>
        )}

        <div className="flex flex-col gap-4 md:grid md:grid-cols-2">
          <SectionCard title="Rincian" id="item-info">
            {item.description ? <p className="mb-3 text-body-md break-words whitespace-pre-line text-ink-body">{item.description}</p> : null}
            <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-2 text-body-md">
              <dt className="text-ink-meta">Kategori</dt>
              <dd className="break-words text-ink">{item.categoryName ?? COPY.noCategory}</dd>
              <dt className="text-ink-meta">Lokasi</dt>
              <dd className="break-words text-ink">{locationText(item)}</dd>
              <dt className="text-ink-meta">Dicatat</dt>
              <dd className="text-ink">{ITEM_MODE_LABEL[item.mode]}</dd>
            </dl>
          </SectionCard>

          <SectionCard title="Stok per kondisi" id="item-stock">
            <dl className="flex flex-col gap-2">
              {CONDITIONS.map(({ key, count }) => (
                <div key={key} className="flex items-center justify-between gap-3">
                  <dt>
                    <ConditionChip condition={key} />
                  </dt>
                  <dd className="text-body-md font-semibold text-ink tabular-nums">{formatCount(count(item.stock))}</dd>
                </div>
              ))}
              <div className="mt-1 flex items-center justify-between gap-3 border-t border-row-line pt-2">
                <dt className="text-body-md font-semibold text-ink">Total</dt>
                <dd className="text-body-md font-bold text-ink tabular-nums">{formatCount(item.stock.total)}</dd>
              </div>
            </dl>
          </SectionCard>
        </div>

        {item.mode === "tracked" && item.units.length > 0 ? (
          <SectionCard title="Unit" id="item-units">
            <ul className="flex flex-col gap-2">
              {item.units.map((unit) => (
                <li key={unit.unitId} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-body-md text-ink-body">
                  <span className="font-semibold text-ink tabular-nums">{unit.code}</span>
                  <UnitChip condition={unit.condition} status={unit.status} />
                  <span className="ml-auto break-words text-body-sm">{unit.locationName ?? COPY.noLocation}</span>
                </li>
              ))}
            </ul>
          </SectionCard>
        ) : null}

        {item.isActive ? (
          <SectionCard title="Cek ketersediaan" id="item-check">
            <AvailabilityCheck
              action={path}
              keepParams={keepParams}
              initialFrom={from}
              initialTo={to}
              result={availability}
              today={today}
            />
          </SectionCard>
        ) : null}

        {canAsk ? (
          <Link
            href={requestFormHref({ itemId: item.itemId, from: availability.kind === "ok" ? from : null, to: availability.kind === "ok" ? to : null })}
            className={buttonClass("primary")}
          >
            Ajukan barang ini
          </Link>
        ) : item.isActive && item.stock.good === 0 ? (
          <p className="text-body-md text-ink-body">{COPY.noGoodStock}</p>
        ) : null}

        {managerActions}
      </NarrowPage>
    </ListNavigationProvider>
  );
}

function locationText(item: ItemDetail): string {
  if (item.mode === "quantity") return item.locationName ?? COPY.noLocation;
  if (item.locationCount > 1) return `${formatCount(item.locationCount)} lokasi`;
  return item.units.find((u) => u.status === "active" && u.locationName)?.locationName ?? COPY.noLocation;
}
