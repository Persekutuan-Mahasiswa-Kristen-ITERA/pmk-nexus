"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ChevronDown, Search, SlidersHorizontal } from "lucide-react";
import { ChoiceTags, RemovableTag } from "@/components/list/filter-tags";
import { isPlainClick, useListNavigation } from "@/components/list/list-navigation";
import { fieldBoxClass } from "@/components/ui/field-styles";
import { DateField, SelectField } from "@/components/ui/form-fields";
import { cn } from "@/lib/utils";
import {
  CONDITION_LABEL,
  INVENTORY_ERROR_COPY,
  INVENTORY_SEARCH_RAW_MAX_LENGTH,
  itemConditionSchema,
  type ItemCondition,
  type ListEntry,
} from "../types";
import { COPY } from "./copy";
import { formatRangeShort } from "./format";
import { CATALOG_DEFAULTS, catalogHref, INVENTORY_PARAMS, INVENTORY_PATH, type CatalogUrlState } from "./routes";

/** Wait after the last keystroke before searching (design 5.2: 450 ms, or Enter). */
const SEARCH_PAUSE_MS = 450;

const CONDITION_OPTIONS = [
  { value: "", label: "Semua" },
  ...(["good", "needs_service", "damaged"] as const).map((c) => ({ value: c, label: CONDITION_LABEL[c] })),
];

/**
 * Katalog search and filters (design 5.1, 5.2; P3 / X7). A plain GET form, so Enter works without
 * JavaScript. On a phone the five filter controls fold behind "Filter (n)"; the applied filters show
 * underneath as removable tags. From 768 px the card is always open and the button is hidden.
 */
export function CatalogFilters({
  values,
  categories,
  locations,
  today,
  searchError,
  dateError,
  exportSlot,
}: {
  values: CatalogUrlState;
  categories: ListEntry[];
  locations: ListEntry[];
  today: string;
  /** The server refused the search text (too long). */
  searchError: string | null;
  /** Date range from the address that the page did not apply. */
  dateError: string | null;
  /** "Ekspor" (only with inventory.export), placed on the Filter row. */
  exportSlot?: ReactNode;
}) {
  const { navigate } = useListNavigation();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [search, setSearch] = useState(values.search);
  const [sentSearch, setSentSearch] = useState(values.search.trim());
  const [from, setFrom] = useState(values.from ?? "");
  const [to, setTo] = useState(values.to ?? "");
  const [localDateError, setLocalDateError] = useState<{ field: "from" | "to"; text: string } | null>(null);
  const [open, setOpen] = useState(false);

  // When the address changes from outside (Back, Reset, a tag), the fields follow it.
  const key = JSON.stringify([values.search, values.from, values.to]);
  const [seenKey, setSeenKey] = useState(key);
  if (key !== seenKey) {
    setSeenKey(key);
    setFrom(values.from ?? "");
    setTo(values.to ?? "");
    setLocalDateError(null);
    if (values.search.trim() !== sentSearch) {
      setSearch(values.search);
      setSentSearch(values.search.trim());
    }
  }

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const applied: CatalogUrlState = { ...values, search: sentSearch };

  function go(next: Partial<CatalogUrlState>, replace = false) {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const state = { ...applied, ...next, page: 1 };
    setSentSearch(state.search.trim());
    navigate(catalogHref(state), { replace });
  }

  function onSearchChange(value: string) {
    setSearch(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (value.trim() === sentSearch) return;
      go({ search: value }, true);
    }, SEARCH_PAUSE_MS);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    go({ search });
  }

  /** Both dates or none; the range applies only when it is valid (design 5.3: the list keeps its result). */
  function onDateChange(nextFrom: string, nextTo: string) {
    setFrom(nextFrom);
    setTo(nextTo);
    if (nextFrom === "" && nextTo === "") {
      setLocalDateError(null);
      if (values.from || values.to) go({ from: null, to: null });
      return;
    }
    if (nextFrom === "" || nextTo === "") {
      setLocalDateError(null);
      return;
    }
    if (nextFrom < today) {
      setLocalDateError({ field: "from", text: INVENTORY_ERROR_COPY.start_in_past ?? COPY.unavailable });
      return;
    }
    if (nextTo < nextFrom) {
      setLocalDateError({ field: "to", text: INVENTORY_ERROR_COPY.invalid_dates ?? COPY.unavailable });
      return;
    }
    setLocalDateError(null);
    go({ from: nextFrom, to: nextTo });
  }

  function onReset(event: React.MouseEvent<HTMLAnchorElement>) {
    if (!isPlainClick(event)) return;
    event.preventDefault();
    setSearch("");
    setFrom("");
    setTo("");
    setLocalDateError(null);
    go({ ...CATALOG_DEFAULTS });
  }

  const activeCount =
    (values.categoryId ? 1 : 0) + (values.locationId ? 1 : 0) + (values.condition ? 1 : 0) + (values.from && values.to ? 1 : 0);

  const categoryName = entryName(categories, values.categoryId);
  const locationName = entryName(locations, values.locationId);
  const tags: { key: string; label: string; href: string }[] = [];
  if (values.categoryId) tags.push({ key: "c", label: `Kategori: ${categoryName}`, href: catalogHref({ ...applied, categoryId: null }) });
  if (values.locationId) tags.push({ key: "l", label: `Lokasi: ${locationName}`, href: catalogHref({ ...applied, locationId: null }) });
  if (values.condition) {
    tags.push({ key: "k", label: `Kondisi: ${CONDITION_LABEL[values.condition]}`, href: catalogHref({ ...applied, condition: null }) });
  }
  if (values.from && values.to) {
    tags.push({ key: "d", label: formatRangeShort(values.from, values.to, today), href: catalogHref({ ...applied, from: null, to: null }) });
  }

  const shownDateError = localDateError ?? (dateError ? { field: "to" as const, text: dateError } : null);

  return (
    <form
      method="get"
      action={INVENTORY_PATH}
      role="search"
      aria-label="Cari dan saring barang"
      onSubmit={onSubmit}
      className="flex flex-col gap-3"
    >
      <div className="relative">
        <label htmlFor="catalog-search" className="sr-only">
          {COPY.catalogSearchLabel}
        </label>
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-field-line"
          strokeWidth={2}
        />
        <input
          id="catalog-search"
          name={INVENTORY_PARAMS.search}
          type="search"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          spellCheck={false}
          maxLength={INVENTORY_SEARCH_RAW_MAX_LENGTH}
          placeholder={COPY.catalogSearchPlaceholder}
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          aria-invalid={searchError ? true : undefined}
          aria-describedby={searchError ? "catalog-search-error" : undefined}
          className={fieldBoxClass({ invalid: Boolean(searchError), className: "h-12 appearance-none pr-3 pl-10" })}
        />
      </div>

      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          aria-expanded={open}
          aria-controls="catalog-filter-card"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex h-11 items-center gap-2 rounded-lg border-[1.5px] border-walnut bg-surface px-4 text-label-lg text-walnut hover:bg-ivory md:hidden"
        >
          <SlidersHorizontal aria-hidden="true" className="size-4" strokeWidth={2} />
          Filter{activeCount > 0 ? <span className="tabular-nums"> ({activeCount})</span> : null}
          <ChevronDown
            aria-hidden="true"
            className={cn("size-4 transition-transform duration-150 motion-reduce:transition-none", open && "rotate-180")}
            strokeWidth={2}
          />
        </button>
        <div className="ml-auto">{exportSlot}</div>
      </div>

      {tags.length > 0 ? (
        <ul aria-label="Filter yang dipakai" className="flex flex-wrap gap-x-2 gap-y-2 md:hidden">
          {tags.map((tag) => (
            <li key={tag.key}>
              <RemovableTag label={tag.label} href={tag.href} />
            </li>
          ))}
        </ul>
      ) : null}

      <div
        id="catalog-filter-card"
        role="group"
        aria-labelledby="catalog-filter-title"
        className={cn(
          "flex-col gap-4 rounded-xl border border-surface-line bg-surface p-4 shadow-elevation-1",
          open ? "flex" : "hidden md:flex",
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <h2 id="catalog-filter-title" className="flex items-center gap-2 text-label-lg text-ink-label">
            <SlidersHorizontal aria-hidden="true" className="size-4 text-walnut" strokeWidth={2} />
            Filter Barang
          </h2>
          <a
            href={INVENTORY_PATH}
            onClick={onReset}
            className="-my-2 -mr-2 inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg px-2 text-label-lg text-walnut underline underline-offset-2 hover:bg-ivory"
          >
            Reset
          </a>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <SelectField
            id="catalog-category"
            label="Kategori"
            name={INVENTORY_PARAMS.categoryId}
            value={values.categoryId ?? ""}
            onChange={(event) => go({ categoryId: event.target.value || null })}
          >
            <option value="">Semua kategori</option>
            {entryOptions(categories, values.categoryId)}
          </SelectField>
          <SelectField
            id="catalog-location"
            label="Lokasi"
            name={INVENTORY_PARAMS.locationId}
            value={values.locationId ?? ""}
            onChange={(event) => go({ locationId: event.target.value || null })}
          >
            <option value="">Semua lokasi</option>
            {entryOptions(locations, values.locationId)}
          </SelectField>
          <DateField
            id="catalog-from"
            label="Dari"
            name={INVENTORY_PARAMS.from}
            min={today}
            value={from}
            onChange={(event) => onDateChange(event.target.value, to)}
            error={shownDateError?.field === "from" ? shownDateError.text : undefined}
          />
          <DateField
            id="catalog-to"
            label="Sampai"
            name={INVENTORY_PARAMS.to}
            min={from || today}
            value={to}
            onChange={(event) => onDateChange(from, event.target.value)}
            error={shownDateError?.field === "to" ? shownDateError.text : undefined}
          />
        </div>
        <p className="-mt-2 text-body-sm text-ink-body">
          Tersedia pada tanggal (boleh kosong). {COPY.inclusiveHint}
        </p>

        <ChoiceTags
          legend="Kondisi"
          name={INVENTORY_PARAMS.condition}
          options={CONDITION_OPTIONS}
          value={values.condition ?? ""}
          onChange={(value) => {
            const parsed = itemConditionSchema.safeParse(value);
            go({ condition: parsed.success ? (parsed.data as ItemCondition) : null });
          }}
        />

        {/* Without JavaScript the controls cannot apply themselves; this button sends the form. */}
        <noscript>
          <button
            type="submit"
            className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-walnut px-5 text-label-lg text-primary-foreground hover:bg-walnut-hover"
          >
            Terapkan
          </button>
        </noscript>
      </div>
    </form>
  );
}

function entryName(entries: ListEntry[], id: string | null): string {
  const entry = entries.find((e) => e.id === id);
  if (!entry) return "-";
  return entry.isActive ? entry.name : `${entry.name} (nonaktif)`;
}

/** Active entries first (A-Z, as the server sends them), then deactivated ones still used by items. */
function entryOptions(entries: ListEntry[], selected: string | null) {
  const active = entries.filter((e) => e.isActive);
  const inactive = entries.filter((e) => !e.isActive && (e.itemCount > 0 || e.id === selected));
  return [...active, ...inactive].map((entry) => (
    <option key={entry.id} value={entry.id}>
      {entry.isActive ? entry.name : `${entry.name} (nonaktif)`}
    </option>
  ));
}
