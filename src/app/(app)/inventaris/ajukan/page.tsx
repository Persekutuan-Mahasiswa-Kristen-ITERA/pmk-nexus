import type { Metadata } from "next";
import Link from "next/link";
import { getAccessState } from "@/lib/auth/session";
import { ForbiddenScreen } from "@/components/access/forbidden-screen";
import { AlertMessage } from "@/components/ui/alert-message";
import { buttonClass } from "@/components/ui/nx-button";
import { getItemDetail } from "@/modules/inventory-borrowing/server/catalog";
import { getRequestDetailByReference } from "@/modules/inventory-borrowing/server/borrowing";
import { inventoryCapabilities, jakartaToday } from "@/modules/inventory-borrowing/types";
import { COPY } from "@/modules/inventory-borrowing/ui/copy";
import { NarrowPage } from "@/modules/inventory-borrowing/ui/inventory-header";
import { pageFailure } from "@/modules/inventory-borrowing/ui/page-errors";
import { RequestForm, type FormLine, type RequestFormInitial } from "@/modules/inventory-borrowing/ui/request-form";
import {
  firstParam,
  INVENTORY_PARAMS,
  INVENTORY_PATH,
  itemHref,
  readDate,
  readId,
  requestFormHref,
  requestHref,
  type SearchParams,
} from "@/modules/inventory-borrowing/ui/routes";
import { checkAvailability, searchLendableItems } from "../actions";
import { inventoryPageTitle } from "../titles";

export async function generateMetadata(): Promise<Metadata> {
  return { title: await inventoryPageTitle("Ajukan Peminjaman") };
}

/**
 * Borrowing request form (design screen 6). Every active member may ask (fixed right L9), but only in
 * an active period (R11); "Untuk pihak luar" needs borrowing.handle. "Ajukan barang ini" pre-fills the
 * item and dates; "Ajukan lagi" (P11) pre-fills from an old request. submitRequest checks everything
 * again, and so does the database.
 */
export default async function RequestFormPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const state = await getAccessState();
  if (state.kind !== "member") return null;

  const capabilities = inventoryCapabilities(state);
  if (!capabilities.canViewCatalog) return <ForbiddenScreen noActivePeriod={!capabilities.hasActivePeriod} />;

  if (!capabilities.canSubmitRequest) {
    return (
      <NarrowPage>
        <h1 className="font-heading text-display-sm text-title">Ajukan Peminjaman</h1>
        <AlertMessage role="alert" tone="warning">
          {COPY.noActivePeriod}
        </AlertMessage>
        <Link href={INVENTORY_PATH} className={buttonClass("text", "-ml-2 self-start")}>
          Kembali ke katalog
        </Link>
      </NarrowPage>
    );
  }

  const query = await searchParams;
  const today = jakartaToday();
  const itemId = readId(firstParam(query, INVENTORY_PARAMS.itemId));
  const again = firstParam(query, INVENTORY_PARAMS.again)?.slice(0, 40) ?? null;
  const from = readDate(firstParam(query, INVENTORY_PARAMS.from));
  const to = readDate(firstParam(query, INVENTORY_PARAMS.to));
  const range = from !== null && to !== null && from >= today && to >= from ? { from, to } : null;

  const initial: RequestFormInitial = {
    startDate: range?.from ?? "",
    endDate: range?.to ?? "",
    lines: [],
    purpose: "",
    note: "",
    outsideParty: null,
  };
  let cancelHref = INVENTORY_PATH;
  const next = requestFormHref({ itemId: itemId ?? undefined, from, to, again: again ?? undefined });

  // Pre-fills are a convenience: when one cannot be read the form simply starts empty.
  if (again) {
    const old = await getRequestDetailByReference(again);
    if (old.ok) {
      cancelHref = requestHref(old.data.reference);
      initial.lines = old.data.lines
        .filter((line) => line.itemIsActive)
        .map<FormLine>((line) => ({
          itemId: line.itemId,
          name: line.itemName,
          code: line.itemCode,
          mode: line.mode,
          unitCount: line.units.length,
          quantity: Math.max(1, line.quantityRequested),
        }));
      initial.purpose = old.data.purpose;
      initial.note = old.data.note ?? "";
      if (old.data.isOutsideParty && capabilities.canRecordOutsideParty) {
        initial.outsideParty = {
          orgName: old.data.outsideOrgName ?? "",
          contactName: old.data.outsideContactName ?? "",
        };
      }
    } else if (pageFailure(old.error, next) === "forbidden") {
      return <ForbiddenScreen noActivePeriod={!capabilities.hasActivePeriod} />;
    }
  } else if (itemId) {
    const item = await getItemDetail(itemId);
    if (item.ok) {
      cancelHref = itemHref(item.data.itemId);
      if (item.data.isActive && item.data.stock.good > 0) {
        initial.lines = [
          {
            itemId: item.data.itemId,
            name: item.data.name,
            code: item.data.code,
            mode: item.data.mode,
            unitCount: item.data.units.filter((u) => u.status === "active").length,
            quantity: 1,
          },
        ];
      }
    } else if (pageFailure(item.error, next) === "forbidden") {
      return <ForbiddenScreen noActivePeriod={!capabilities.hasActivePeriod} />;
    }
  }

  return (
    <NarrowPage>
      <RequestForm
        initial={initial}
        today={today}
        canRecordOutsideParty={capabilities.canRecordOutsideParty}
        cancelHref={cancelHref}
        checkAvailability={checkAvailability}
        searchItems={searchLendableItems}
      />
    </NarrowPage>
  );
}
