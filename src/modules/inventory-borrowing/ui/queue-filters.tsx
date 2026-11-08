"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ChevronDown, Search, SlidersHorizontal } from "lucide-react";
import { RemovableTag } from "@/components/list/filter-tags";
import { isPlainClick, useListNavigation } from "@/components/list/list-navigation";
import { fieldBoxClass } from "@/components/ui/field-styles";
import { DateField, SelectField } from "@/components/ui/form-fields";
import { cn } from "@/lib/utils";
import {
  INVENTORY_ERROR_COPY,
  INVENTORY_SEARCH_RAW_MAX_LENGTH,
  QUEUE_VIEW_LABEL,
  queueViewSchema,
  type BorrowingPeriod,
  type QueueView,
} from "../types";
import { COPY, STAFF_COPY } from "./copy";
import { formatRange } from "./format";
import { INVENTORY_PARAMS, QUEUE_PATH, queueHref, type QueueUrlState } from "./routes";

const SEARCH_PAUSE_MS = 450;

export type ViewOption = { view: QueueView; count: number | null };

/**
 * "Tampilkan" select of Antrean (design 11.1). Real GET form, so it works without JavaScript; with it,
 * a change loads the chosen list at once. The handover list keeps none of the other filters.
 */
export function QueueViewSelect({ values, options }: { values: QueueUrlState; options: ViewOption[] }) {
  const { navigate } = useListNavigation();
  return (
    <form method="get" action={QUEUE_PATH} className="flex flex-col gap-2">
      <SelectField
        id="queue-view"
        label="Tampilkan"
        name={INVENTORY_PARAMS.view}
        value={values.view}
        onChange={(event) => {
          const parsed = queueViewSchema.safeParse(event.target.value);
          if (!parsed.success) return;
          const view = parsed.data;
          navigate(view === "open_all_periods" ? queueHref({ view }) : queueHref({ ...values, view, page: 1 }));
        }}
      >
        {options.map((option) => (
          <option key={option.view} value={option.view}>
            {option.count !== null ? `${QUEUE_VIEW_LABEL[option.view]} (${option.count})` : QUEUE_VIEW_LABEL[option.view]}
          </option>
        ))}
      </SelectField>
      <noscript>
        <button
          type="submit"
          className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-walnut px-5 text-label-lg text-primary-foreground hover:bg-walnut-hover"
        >
          Tampilkan
        </button>
      </noscript>
    </form>
  );
}

/**
 * Search, date range and period of Antrean (design 11.1; period filter from the contract). Search
 * matches the reference, the requester, the organisation and the item. A request matches the dates when
 * its range overlaps them; past dates are allowed (history). Applied filters show as removable tags.
 */
export function QueueFilters({
  values,
  periods,
  searchError,
  dateError,
  exportSlot,
}: {
  values: QueueUrlState;
  /** PI-CORE periods, newest first (listBorrowingPeriods); empty when the list could not be read. */
  periods: BorrowingPeriod[];
  searchError: string | null;
  dateError: string | null;
  exportSlot?: ReactNode;
}) {
  const { navigate } = useListNavigation();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [search, setSearch] = useState(values.search);
  const [sentSearch, setSentSearch] = useState(values.search.trim());
  const [from, setFrom] = useState(values.from ?? "");
  const [to, setTo] = useState(values.to ?? "");
  const [localDateError, setLocalDateError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  // When the address changes from outside (Back, a tag, the view select), the fields follow it.
  const key = JSON.stringify([values.view, values.search, values.from, values.to]);
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

  const applied: QueueUrlState = { ...values, search: sentSearch };

  function go(next: Partial<QueueUrlState>, replace = false) {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const state = { ...applied, ...next, page: 1 };
    setSentSearch(state.search.trim());
    navigate(queueHref(state), { replace });
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
    if (nextTo < nextFrom) {
      setLocalDateError(INVENTORY_ERROR_COPY.invalid_dates ?? COPY.unavailable);
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
    go({ search: "", from: null, to: null, periodId: null });
  }

  const period = periods.find((p) => p.periodId === values.periodId) ?? null;
  const tags: { key: string; label: string; href: string }[] = [];
  if (values.from && values.to) {
    tags.push({ key: "d", label: formatRange(values.from, values.to), href: queueHref({ ...applied, from: null, to: null }) });
  }
  if (values.periodId) {
    tags.push({
      key: "p",
      label: `${STAFF_COPY.queuePeriodLabel} ${period?.label ?? "-"}`,
      href: queueHref({ ...applied, periodId: null }),
    });
  }
  const activeCount = tags.length;
  const shownDateError = localDateError ?? dateError;

  return (
    <form method="get" action={QUEUE_PATH} role="search" aria-label="Cari dan saring pengajuan" onSubmit={onSubmit} className="flex flex-col gap-3">
      <input type="hidden" name={INVENTORY_PARAMS.view} value={values.view} />
      <div className="relative">
        <label htmlFor="queue-search" className="sr-only">
          {STAFF_COPY.queueSearchLabel}
        </label>
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-field-line"
          strokeWidth={2}
        />
        <input
          id="queue-search"
          name={INVENTORY_PARAMS.search}
          type="search"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          spellCheck={false}
          maxLength={INVENTORY_SEARCH_RAW_MAX_LENGTH}
          placeholder={STAFF_COPY.queueSearchPlaceholder}
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          aria-invalid={searchError ? true : undefined}
          aria-describedby={searchError ? "queue-search-error" : undefined}
          className={fieldBoxClass({ invalid: Boolean(searchError), className: "h-12 appearance-none pr-3 pl-10" })}
        />
      </div>

      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          aria-expanded={open}
          aria-controls="queue-filter-card"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex h-11 items-center gap-2 rounded-lg border-[1.5px] border-walnut bg-surface px-4 text-label-lg text-walnut hover:bg-ivory"
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
        <ul aria-label="Filter yang dipakai" className="flex flex-wrap gap-x-2 gap-y-2">
          {tags.map((tag) => (
            <li key={tag.key}>
              <RemovableTag label={tag.label} href={tag.href} />
            </li>
          ))}
        </ul>
      ) : null}

      <div
        id="queue-filter-card"
        role="group"
        aria-labelledby="queue-filter-title"
        className={cn("flex-col gap-4 rounded-xl border border-surface-line bg-surface p-4 shadow-elevation-1", open ? "flex" : "hidden")}
      >
        <div className="flex items-center justify-between gap-2">
          <h2 id="queue-filter-title" className="flex items-center gap-2 text-label-lg text-ink-label">
            <SlidersHorizontal aria-hidden="true" className="size-4 text-walnut" strokeWidth={2} />
            Filter Pengajuan
          </h2>
          <a
            href={queueHref({ view: values.view })}
            onClick={onReset}
            className="-my-2 -mr-2 inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg px-2 text-label-lg text-walnut underline underline-offset-2 hover:bg-ivory"
          >
            Reset
          </a>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <DateField
            id="queue-from"
            label="Dari"
            name={INVENTORY_PARAMS.from}
            value={from}
            onChange={(event) => onDateChange(event.target.value, to)}
          />
          <DateField
            id="queue-to"
            label="Sampai"
            name={INVENTORY_PARAMS.to}
            min={from || undefined}
            value={to}
            onChange={(event) => onDateChange(from, event.target.value)}
            error={shownDateError ?? undefined}
          />
        </div>
        {periods.length > 0 ? (
          <SelectField
            id="queue-period"
            label={STAFF_COPY.queuePeriodLabel}
            name={INVENTORY_PARAMS.periodId}
            value={values.periodId ?? ""}
            onChange={(event) => go({ periodId: event.target.value || null })}
          >
            <option value="">{STAFF_COPY.queueAllPeriods}</option>
            {periods.map((p) => (
              <option key={p.periodId} value={p.periodId}>
                {p.isActive ? `${p.label} (aktif)` : p.label}
              </option>
            ))}
          </SelectField>
        ) : null}
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
