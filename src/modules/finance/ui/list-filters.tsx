"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Search, SlidersHorizontal } from "lucide-react";
import { ChoiceTags, RemovableTag } from "@/components/list/filter-tags";
import { useListNavigation } from "@/components/list/list-navigation";
import { FieldError } from "@/components/ui/field-error";
import { fieldBoxClass } from "@/components/ui/field-styles";
import { DateField } from "@/components/ui/form-fields";
import { buttonClass } from "@/components/ui/nx-button";
import { Sheet } from "@/components/ui/sheet";
import {
  FINANCE_COPY,
  FINANCE_PARAMS,
  FINANCE_ROUTES,
  FINANCE_SEARCH_RAW_MAX_LENGTH,
  FINANCE_TYPE_FILTER_LABEL,
  financeTypeFilterSchema,
  type FinanceTypeFilter,
} from "../types";
import { UI_COPY } from "./copy";
import { LIST_DEFAULTS, listHref, type ListUrlState } from "./routes";

/** Wait after the last keystroke before searching (same as Letters and Minutes: 450 ms, or Enter). */
const SEARCH_PAUSE_MS = 450;

const L = FINANCE_COPY.filters;
const TYPE_OPTIONS = (["all", "income", "expense", "opening"] as const).map((value) => ({ value, label: FINANCE_TYPE_FILTER_LABEL[value] }));

/**
 * Search, the "Filter" button with its sheet (Jenis, Dari tanggal, Sampai tanggal, "Tampilkan yang
 * dibatalkan", "Tanpa bukti", Reset; spec 7 screen 1) and the applied filters as removable tags. The search
 * is a plain GET form, so Enter works without JavaScript. Every change goes to the address and the server
 * reads the list again; the old rows stay dimmed until the new ones arrive. The period is NOT a filter
 * here: it is the select in the header, and it survives a filter change.
 */
export function ListFilters({
  values,
  searchError,
  rangeError,
  exportSlot,
}: {
  values: ListUrlState;
  searchError: string | null;
  /** "Tanggal akhir tidak boleh sebelum tanggal mulai." when the address holds a reversed range. */
  rangeError: string | null;
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

  // One removable tag per non-default filter. The period is not one (it has its own select).
  const tags: { key: string; label: string; href: string }[] = [];
  if (values.type !== LIST_DEFAULTS.type) tags.push({ key: "t", label: FINANCE_TYPE_FILTER_LABEL[values.type], href: href({ type: "all" }) });
  if (values.from) tags.push({ key: "f", label: `${L.from} ${values.from}`, href: href({ from: null }) });
  if (values.to) tags.push({ key: "e", label: `${L.to} ${values.to}`, href: href({ to: null }) });
  if (values.includeVoided) tags.push({ key: "v", label: L.includeVoided, href: href({ includeVoided: false }) });
  if (values.withoutProof) tags.push({ key: "n", label: L.withoutProof, href: href({ withoutProof: false }) });

  const searchId = "finance-search";

  return (
    <div className="flex flex-col gap-3">
      <form
        method="get"
        action={FINANCE_ROUTES.list}
        role="search"
        aria-label={UI_COPY.searchLabel}
        onSubmit={onSubmit}
        className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 md:grid-cols-[minmax(0,1fr)_auto_auto]"
      >
        {/* Keep the chosen period when Enter sends the plain form (no JavaScript). */}
        {values.period ? <input type="hidden" name={FINANCE_PARAMS.period} value={values.period} /> : null}
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
              name={FINANCE_PARAMS.search}
              type="search"
              inputMode="search"
              enterKeyHint="search"
              autoComplete="off"
              spellCheck={false}
              maxLength={FINANCE_SEARCH_RAW_MAX_LENGTH}
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
          {L.open}
          {tags.length > 0 ? <span className="tabular-nums"> ({tags.length})</span> : null}
        </button>
        <div className="justify-self-end md:mt-0.5">{exportSlot}</div>
      </form>

      {rangeError ? (
        <div role="alert">
          <FieldError id="finance-range-error">{rangeError}</FieldError>
        </div>
      ) : null}

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
        title={L.open}
        footer={
          <button
            type="button"
            onClick={() => {
              setSearch("");
              go({ search: "", type: "all", from: null, to: null, includeVoided: false, withoutProof: false });
            }}
            className={buttonClass("outline")}
          >
            {L.reset}
          </button>
        }
      >
        <div className="flex flex-col gap-5">
          <ChoiceTags
            legend={L.type}
            name="finance-filter-type"
            options={TYPE_OPTIONS}
            value={values.type}
            onChange={(value) => {
              const parsed = financeTypeFilterSchema.safeParse(value);
              go({ type: parsed.success ? (parsed.data satisfies FinanceTypeFilter) : "all" });
            }}
          />
          <DateField
            id="finance-filter-from"
            label={L.from}
            value={values.from ?? ""}
            max={values.to ?? undefined}
            onChange={(event) => go({ from: event.target.value === "" ? null : event.target.value })}
          />
          <DateField
            id="finance-filter-to"
            label={L.to}
            value={values.to ?? ""}
            min={values.from ?? undefined}
            error={rangeError ?? undefined}
            onChange={(event) => go({ to: event.target.value === "" ? null : event.target.value })}
          />
          <CheckRow
            name={FINANCE_PARAMS.includeVoided}
            label={L.includeVoided}
            checked={values.includeVoided}
            onChange={(checked) => go({ includeVoided: checked })}
          />
          <CheckRow
            name={FINANCE_PARAMS.withoutProof}
            label={L.withoutProof}
            checked={values.withoutProof}
            onChange={(checked) => go({ withoutProof: checked })}
          />
        </div>
      </Sheet>
    </div>
  );
}

function CheckRow({ name, label, checked, onChange }: { name: string; label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border-[1.5px] border-field-line bg-surface px-3 hover:border-walnut has-[input:checked]:border-2 has-[input:checked]:border-walnut has-[input:checked]:bg-ivory has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-walnut">
      <input
        type="checkbox"
        name={name}
        value="1"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="size-5 shrink-0 accent-walnut"
      />
      <span className="text-body-md text-ink">{label}</span>
    </label>
  );
}
