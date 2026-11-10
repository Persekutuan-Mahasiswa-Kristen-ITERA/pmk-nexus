"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Search, SlidersHorizontal } from "lucide-react";
import { ChoiceTags, RemovableTag } from "@/components/list/filter-tags";
import { useListNavigation } from "@/components/list/list-navigation";
import { FieldError } from "@/components/ui/field-error";
import { fieldBoxClass } from "@/components/ui/field-styles";
import { SelectField } from "@/components/ui/form-fields";
import { buttonClass } from "@/components/ui/nx-button";
import { Sheet } from "@/components/ui/sheet";
import {
  MINUTE_COPY,
  MINUTE_PARAMS,
  MINUTE_PERIOD_FILTER_LABEL,
  MINUTE_ROUTES,
  MINUTE_SEARCH_RAW_MAX_LENGTH,
  MINUTE_STATUS_FILTER_LABEL,
  minutePeriodFilterSchema,
  minuteStatusFilterSchema,
  minuteUnitLabel,
  type MinuteUnitOption,
} from "../types";
import { UI_COPY } from "./copy";
import { LIST_DEFAULTS, listHref, type ListUrlState } from "./routes";

/** Wait after the last keystroke before searching (same as Letters: 450 ms, or Enter). */
const SEARCH_PAUSE_MS = 450;

const L = MINUTE_COPY.list;
const PERIOD_OPTIONS = (["active", "all"] as const).map((value) => ({ value, label: MINUTE_PERIOD_FILTER_LABEL[value] }));
const STATUS_OPTIONS = (["active", "voided", "all"] as const).map((value) => ({ value, label: MINUTE_STATUS_FILTER_LABEL[value] }));

/**
 * Search, the "Filter" button with its sheet (Unit, Periode, Status, Reset; spec 7 screen 1) and the
 * applied filters as removable tags. The search is a plain GET form, so Enter works without JavaScript.
 * Every change goes to the address and the server reads the list again; the old rows stay dimmed until
 * the new ones arrive. The Unit choice exists only for people who may read more than one unit (MN-22).
 */
export function ListFilters({
  values,
  units,
  searchError,
  exportSlot,
}: {
  values: ListUrlState;
  /** Readable units; the Unit filter shows only with two or more. */
  units: MinuteUnitOption[];
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

  const applied: ListUrlState = { ...values, search: sentSearch };
  const href = (next: Partial<ListUrlState>) => listHref({ ...applied, ...next, page: 1 });

  function go(next: Partial<ListUrlState>, replace = false) {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const state = { ...applied, ...next, page: 1 };
    setSentSearch(state.search.trim());
    navigate(listHref(state), { replace });
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

  const showUnit = units.length > 1;
  const unitName = (id: string) => {
    const found = units.find((u) => u.unitId === id);
    return found ? minuteUnitLabel(found) : MINUTE_COPY.unknownUnit;
  };

  // One removable tag per non-default filter; the defaults (all units, active period, Aktif) show none.
  const tags: { key: string; label: string; href: string }[] = [];
  if (values.unitId) tags.push({ key: "u", label: unitName(values.unitId), href: href({ unitId: null }) });
  if (values.period !== LIST_DEFAULTS.period) {
    tags.push({ key: "p", label: MINUTE_PERIOD_FILTER_LABEL[values.period], href: href({ period: LIST_DEFAULTS.period }) });
  }
  if (values.status !== LIST_DEFAULTS.status) {
    tags.push({ key: "s", label: MINUTE_STATUS_FILTER_LABEL[values.status], href: href({ status: LIST_DEFAULTS.status }) });
  }

  const searchId = "minutes-search";

  return (
    <div className="flex flex-col gap-3">
      <form
        method="get"
        action={MINUTE_ROUTES.list}
        role="search"
        aria-label={UI_COPY.searchLabel}
        onSubmit={onSubmit}
        className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 md:grid-cols-[minmax(0,1fr)_auto_auto]"
      >
        <div className="col-span-2 min-w-0 md:col-span-1">
          <div className="relative">
            <label htmlFor={searchId} className="sr-only">
              {UI_COPY.searchLabel}
            </label>
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-field-line"
              strokeWidth={2}
            />
            <input
              id={searchId}
              name={MINUTE_PARAMS.search}
              type="search"
              inputMode="search"
              enterKeyHint="search"
              autoComplete="off"
              spellCheck={false}
              maxLength={MINUTE_SEARCH_RAW_MAX_LENGTH}
              placeholder={L.searchPlaceholder}
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

        <button
          type="button"
          aria-haspopup="dialog"
          onClick={() => setOpen(true)}
          className="inline-flex h-11 items-center gap-2 justify-self-start rounded-lg border-[1.5px] border-walnut bg-surface px-4 text-label-lg text-walnut hover:bg-ivory md:mt-0.5"
        >
          <SlidersHorizontal aria-hidden="true" className="size-4" strokeWidth={2} />
          {L.filterButton}
          {tags.length > 0 ? <span className="tabular-nums"> ({tags.length})</span> : null}
        </button>
        <div className="justify-self-end md:mt-0.5">{exportSlot}</div>
      </form>

      {tags.length > 0 ? (
        <ul aria-label="Filter yang dipakai" className="flex flex-wrap gap-x-2 gap-y-2">
          {tags.map((tag) => (
            <li key={tag.key}>
              <RemovableTag label={tag.label} href={tag.href} />
            </li>
          ))}
        </ul>
      ) : null}

      <Sheet
        open={open}
        onOpenChange={setOpen}
        title={L.filterButton}
        footer={
          <button
            type="button"
            onClick={() => {
              setSearch("");
              go({ search: "", ...LIST_DEFAULTS });
            }}
            className={buttonClass("outline")}
          >
            {L.filterReset}
          </button>
        }
      >
        <div className="flex flex-col gap-5">
          {showUnit ? (
            <SelectField
              id="minutes-filter-unit"
              label={L.filterUnit}
              value={values.unitId ?? ""}
              onChange={(event) => go({ unitId: event.target.value === "" ? null : event.target.value })}
            >
              <option value="">{L.filterUnitAll}</option>
              {values.unitId && !units.some((u) => u.unitId === values.unitId) ? (
                <option value={values.unitId}>{MINUTE_COPY.unknownUnit}</option>
              ) : null}
              {units.map((unit) => (
                <option key={unit.unitId} value={unit.unitId}>
                  {minuteUnitLabel(unit)}
                </option>
              ))}
            </SelectField>
          ) : null}
          <ChoiceTags
            legend={L.filterPeriod}
            name="minutes-filter-period"
            options={PERIOD_OPTIONS}
            value={values.period}
            onChange={(value) => {
              const parsed = minutePeriodFilterSchema.safeParse(value);
              go({ period: parsed.success ? parsed.data : LIST_DEFAULTS.period });
            }}
          />
          <ChoiceTags
            legend={L.filterStatus}
            name="minutes-filter-status"
            options={STATUS_OPTIONS}
            value={values.status}
            onChange={(value) => {
              const parsed = minuteStatusFilterSchema.safeParse(value);
              go({ status: parsed.success ? parsed.data : LIST_DEFAULTS.status });
            }}
          />
        </div>
      </Sheet>
    </div>
  );
}
