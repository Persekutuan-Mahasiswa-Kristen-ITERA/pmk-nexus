"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ChevronDown, Search, SlidersHorizontal } from "lucide-react";
import { ChoiceTags, RemovableTag } from "@/components/list/filter-tags";
import { isPlainClick, useListNavigation } from "@/components/list/list-navigation";
import { FieldError } from "@/components/ui/field-error";
import { fieldBoxClass } from "@/components/ui/field-styles";
import { SelectField } from "@/components/ui/form-fields";
import { cn } from "@/lib/utils";
import {
  LETTER_PARAMS,
  LETTER_PERIOD_FILTER_LABEL,
  LETTER_SEARCH_RAW_MAX_LENGTH,
  LETTER_STATUS_FILTER_LABEL,
  letterPeriodFilterSchema,
  letterStatusFilterSchema,
  type LetterType,
} from "../types";
import { COPY } from "./copy";
import { REGISTER_DEFAULTS, registerHref, registerPath, type RegisterUrlState } from "./routes";

/** Wait after the last keystroke before searching (design 5.2: 450 ms, or Enter). */
const SEARCH_PAUSE_MS = 450;

const STATUS_OPTIONS = (["all", "active", "voided"] as const).map((value) => ({ value, label: LETTER_STATUS_FILTER_LABEL[value] }));

/**
 * Register search and filters (design 5.1, 5.2). A plain GET form, so Enter works without JavaScript.
 * On a phone the filters fold behind "Filter (n)" and the applied ones show as removable tags; from
 * 768 px the card is always open (Inventory P3) and from 1024 px it is one row.
 */
export function RegisterFilters({
  type,
  values,
  years,
  searchError,
  exportSlot,
}: {
  type: LetterType;
  values: RegisterUrlState;
  /** "Tahun nomor" choices that exist in the register, newest first. */
  years: number[];
  searchError: string | null;
  exportSlot?: ReactNode;
}) {
  const { navigate } = useListNavigation();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [search, setSearch] = useState(values.search);
  const [sentSearch, setSentSearch] = useState(values.search.trim());
  const [open, setOpen] = useState(false);

  // When the address changes from outside (Back, Reset, a tag), the search box follows it.
  const [seen, setSeen] = useState(values.search);
  if (values.search !== seen) {
    setSeen(values.search);
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

  const applied: RegisterUrlState = { ...values, search: sentSearch };
  const href = (state: Partial<RegisterUrlState>) => registerHref(type, { ...applied, ...state, page: 1 });

  function go(next: Partial<RegisterUrlState>, replace = false) {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const state = { ...applied, ...next, page: 1 };
    setSentSearch(state.search.trim());
    navigate(registerHref(type, state), { replace });
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

  function onReset(event: React.MouseEvent<HTMLAnchorElement>) {
    if (!isPlainClick(event)) return;
    event.preventDefault();
    setSearch("");
    go({ ...REGISTER_DEFAULTS });
  }

  const activeCount =
    (values.period !== REGISTER_DEFAULTS.period ? 1 : 0) +
    (values.year !== null ? 1 : 0) +
    (values.status !== REGISTER_DEFAULTS.status ? 1 : 0) +
    (values.withoutFiles ? 1 : 0);

  // One removable pill per non-default filter (5.2); the default (active period) shows no tag.
  const tags: { key: string; label: string; href: string }[] = [];
  if (values.period !== REGISTER_DEFAULTS.period) {
    tags.push({ key: "p", label: LETTER_PERIOD_FILTER_LABEL[values.period], href: href({ period: REGISTER_DEFAULTS.period }) });
  }
  if (values.year !== null) tags.push({ key: "y", label: `Tahun ${values.year}`, href: href({ year: null }) });
  if (values.status !== REGISTER_DEFAULTS.status) {
    tags.push({ key: "s", label: LETTER_STATUS_FILTER_LABEL[values.status], href: href({ status: REGISTER_DEFAULTS.status }) });
  }
  if (values.withoutFiles) tags.push({ key: "f", label: COPY.withoutFiles, href: href({ withoutFiles: false }) });

  const yearOptions = values.year !== null && !years.includes(values.year) ? [values.year, ...years] : years;
  const searchId = `register-search-${type}`;

  return (
    <form
      method="get"
      action={registerPath(type)}
      role="search"
      aria-label="Cari dan saring surat"
      onSubmit={onSubmit}
      className="flex flex-col gap-3"
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="relative">
            <label htmlFor={searchId} className="sr-only">
              {COPY.searchLabel}
            </label>
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-field-line"
              strokeWidth={2}
            />
            <input
              id={searchId}
              name={LETTER_PARAMS.search}
              type="search"
              inputMode="search"
              enterKeyHint="search"
              autoComplete="off"
              spellCheck={false}
              maxLength={LETTER_SEARCH_RAW_MAX_LENGTH}
              placeholder={type === "incoming" ? COPY.searchIncoming : COPY.searchOutgoing}
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              aria-invalid={searchError ? true : undefined}
              aria-describedby={searchError ? `${searchId}-error` : undefined}
              className={fieldBoxClass({ invalid: Boolean(searchError), className: "h-12 appearance-none pr-3 pl-10" })}
            />
          </div>
          {searchError ? (
            <div role="alert" className="mt-1.5">
              <FieldError id={`${searchId}-error`}>{searchError}</FieldError>
            </div>
          ) : null}
        </div>

        {/* From 768 px the Filter button is gone, so "Ekspor" sits next to the search. */}
        {exportSlot ? <div className="hidden pt-0.5 md:block">{exportSlot}</div> : null}
      </div>

      <div className="flex items-start justify-between gap-2 md:hidden">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`register-filter-card-${type}`}
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
        id={`register-filter-card-${type}`}
        role="group"
        aria-labelledby={`register-filter-title-${type}`}
        className={cn(
          "flex-col gap-4 rounded-xl border border-surface-line bg-surface p-4 shadow-elevation-1",
          open ? "flex" : "hidden md:flex",
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <h2 id={`register-filter-title-${type}`} className="flex items-center gap-2 text-label-lg text-ink-label">
            <SlidersHorizontal aria-hidden="true" className="size-4 text-walnut" strokeWidth={2} />
            {COPY.filterTitle}
          </h2>
          <a
            href={registerPath(type)}
            onClick={onReset}
            className="-my-2 -mr-2 inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg px-2 text-label-lg text-walnut underline underline-offset-2 hover:bg-ivory"
          >
            Reset
          </a>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto] lg:items-end">
          <SelectField
            id={`register-period-${type}`}
            label="Periode"
            name={LETTER_PARAMS.period}
            value={values.period}
            onChange={(event) => {
              const parsed = letterPeriodFilterSchema.safeParse(event.target.value);
              go({ period: parsed.success ? parsed.data : REGISTER_DEFAULTS.period });
            }}
          >
            <option value="active">{LETTER_PERIOD_FILTER_LABEL.active}</option>
            <option value="all">{LETTER_PERIOD_FILTER_LABEL.all}</option>
          </SelectField>
          <SelectField
            id={`register-year-${type}`}
            label="Tahun nomor"
            name={LETTER_PARAMS.year}
            value={values.year === null ? "" : String(values.year)}
            onChange={(event) => go({ year: /^\d{4}$/.test(event.target.value) ? Number(event.target.value) : null })}
          >
            <option value="">Semua tahun</option>
            {yearOptions.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </SelectField>

          <div className="col-span-2 lg:col-span-1">
            <ChoiceTags
              legend="Status"
              name={LETTER_PARAMS.status}
              options={STATUS_OPTIONS}
              value={values.status}
              onChange={(value) => {
                const parsed = letterStatusFilterSchema.safeParse(value);
                go({ status: parsed.success ? parsed.data : REGISTER_DEFAULTS.status });
              }}
            />
          </div>

          <label className="col-span-2 flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border-[1.5px] border-field-line bg-surface px-3 hover:border-walnut has-[input:checked]:border-2 has-[input:checked]:border-walnut has-[input:checked]:bg-ivory has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-walnut lg:col-span-1">
            <input
              type="checkbox"
              name={LETTER_PARAMS.withoutFiles}
              value="1"
              checked={values.withoutFiles}
              onChange={(event) => go({ withoutFiles: event.target.checked })}
              className="size-5 shrink-0 accent-walnut"
            />
            <span className="text-body-md whitespace-nowrap text-ink">{COPY.withoutFiles}</span>
          </label>
        </div>

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
