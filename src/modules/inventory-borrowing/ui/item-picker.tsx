"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Search } from "lucide-react";
import { AlertMessage } from "@/components/ui/alert-message";
import { fieldBoxClass } from "@/components/ui/field-styles";
import { buttonClass, Spinner } from "@/components/ui/nx-button";
import { Sheet } from "@/components/ui/sheet";
import { INVENTORY_SEARCH_MAX_LENGTH, type InventoryResult, type ItemMode } from "../types";
import { COPY } from "./copy";
import { formatCount } from "./format";

/** One row of the item picker (design 9.1): only what the picker shows. */
export type PickerItem = {
  itemId: string;
  name: string;
  code: string | null;
  mode: ItemMode;
  unitCount: number;
  categoryName: string | null;
  qtyGood: number;
};

export type SearchItems = (search: string) => Promise<InventoryResult<{ rows: PickerItem[]; total: number }>>;

const SEARCH_PAUSE_MS = 300;

type Results = { kind: "loading" } | { kind: "ok"; rows: PickerItem[]; search: string } | { kind: "error" };

/**
 * "Pilih barang" sheet (design 9.1). Offers active items with stock in Baik; an item already on the
 * form is shown as "Sudah ditambahkan" and cannot be chosen again (R20). Choosing a row adds the line
 * and closes the sheet; the form then moves focus to that line's quantity.
 */
export function ItemPicker({
  open,
  onOpenChange,
  selectedIds,
  onPick,
  searchItems,
  onCloseAutoFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedIds: string[];
  onPick: (item: PickerItem) => void;
  searchItems: SearchItems;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const searchRef = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestNo = useRef(0);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Results>({ kind: "loading" });

  async function run(text: string) {
    const no = ++requestNo.current;
    setResults({ kind: "loading" });
    try {
      const result = await searchItems(text);
      if (no !== requestNo.current) return; // a newer search answered first
      setResults(result.ok ? { kind: "ok", rows: result.data.rows, search: text } : { kind: "error" });
    } catch {
      if (no === requestNo.current) setResults({ kind: "error" });
    }
  }

  // Load the first page each time the sheet opens (stock may have changed since the last time).
  const [openedFor, setOpenedFor] = useState(false);
  if (open !== openedFor) {
    setOpenedFor(open);
    if (open) {
      setSearch("");
      setResults({ kind: "loading" });
    }
  }
  useEffect(() => {
    if (!open) return;
    const start = setTimeout(() => void run(""), 0);
    return () => clearTimeout(start);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run is stable enough; only opening matters
  }, [open]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function onSearchChange(value: string) {
    setSearch(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void run(value.trim()), SEARCH_PAUSE_MS);
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Pilih barang"
      initialFocusRef={searchRef}
      onCloseAutoFocus={onCloseAutoFocus}
    >
      <div className="flex flex-col gap-3">
        <div className="relative">
          <label htmlFor="picker-search" className="sr-only">
            {COPY.catalogSearchLabel}
          </label>
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-field-line"
            strokeWidth={2}
          />
          <input
            ref={searchRef}
            id="picker-search"
            type="search"
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
            spellCheck={false}
            maxLength={INVENTORY_SEARCH_MAX_LENGTH}
            placeholder={COPY.catalogSearchPlaceholder}
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                if (timer.current) clearTimeout(timer.current);
                void run(search.trim());
              }
            }}
            className={fieldBoxClass({ className: "h-12 appearance-none pr-3 pl-10" })}
          />
        </div>

        <div role="status" aria-live="polite" className="empty:hidden">
          {results.kind === "loading" ? (
            <p className="flex items-center gap-2 text-body-md text-ink-body">
              <Spinner />
              {COPY.catalogLoading}
            </p>
          ) : results.kind === "ok" && results.rows.length === 0 ? (
            <p className="text-body-md text-ink">{results.search ? COPY.pickerNoMatch : COPY.pickerEmpty}</p>
          ) : null}
        </div>

        {results.kind === "error" ? (
          <div className="flex flex-col gap-3">
            <AlertMessage role="alert" tone="warning">
              {COPY.unavailable}
            </AlertMessage>
            <button type="button" onClick={() => void run(search.trim())} className={buttonClass("outline")}>
              Coba lagi
            </button>
          </div>
        ) : null}

        {results.kind === "ok" && results.rows.length > 0 ? (
          <ul aria-label="Barang yang bisa dipinjam" className="overflow-hidden rounded-xl border border-surface-line">
            {results.rows.map((item, index) => {
              const taken = selectedIds.includes(item.itemId);
              const meta = [
                item.mode === "quantity" ? item.code : `${formatCount(item.unitCount)} unit`,
                item.categoryName ?? COPY.noCategory,
                `${formatCount(item.qtyGood)} baik`,
              ]
                .filter(Boolean)
                .join(" · ");
              const zebra = index % 2 === 1 ? "bg-zebra" : "bg-surface";
              return (
                <li key={item.itemId} className="border-t border-row-line first:border-t-0">
                  {taken ? (
                    <div aria-disabled="true" className={`flex min-h-14 flex-col justify-center px-3 py-2 ${zebra}`}>
                      <span className="text-body-md font-semibold break-words text-ink-body">{item.name}</span>
                      <span className="flex items-center gap-1 text-body-sm text-success">
                        <Check aria-hidden="true" className="size-4" strokeWidth={2} />
                        {COPY.alreadyAdded}
                      </span>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onPick(item)}
                      className={`flex min-h-14 w-full flex-col justify-center px-3 py-2 text-left hover:bg-ivory focus-visible:-outline-offset-2 ${zebra}`}
                    >
                      <span className="text-body-md font-semibold break-words text-walnut">{item.name}</span>
                      <span className="text-body-sm break-words text-ink-meta tabular-nums">{meta}</span>
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </Sheet>
  );
}
