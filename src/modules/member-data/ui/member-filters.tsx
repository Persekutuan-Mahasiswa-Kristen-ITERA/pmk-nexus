"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ChevronDown, Search, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  MEMBER_LIST_PARAMS,
  MEMBER_SEARCH_MAX_LENGTH,
  memberStatusFilterSchema,
  type MemberStatusFilter,
  type MemberUnitOption,
} from "../types";
import { COPY, STATUS_OPTION_LABEL } from "./copy";
import { isPlainClick, useListNavigation } from "./list-navigation";
import { MEMBER_LIST_PATH, memberListHref } from "./list-url";

/** Wait after the last keystroke before searching (spec F2: "after a short pause or on Enter"). */
const SEARCH_PAUSE_MS = 450;

const STATUS_ORDER: MemberStatusFilter[] = ["active", "inactive", "all"];

// Same box as TextField (D-017): 48 px, radius 8, #81756A border, 16 px text, walnut border + halo on focus.
// text-field is appended outside cn() (it would be dropped next to text-ink).
const fieldBase = cn(
  "h-12 w-full rounded-lg border border-field-line bg-field text-ink transition-[border-color,box-shadow] duration-100",
  "hover:border-walnut focus:border-walnut focus:outline-none",
  "focus:shadow-[inset_0_0_0_1px_var(--color-walnut),0_0_0_2px_var(--color-focus-halo)]", // taste-skill-ignore: focus only
  "motion-reduce:transition-none",
);
const fieldClass = `${fieldBase} text-field`;

export type MemberFilterValues = {
  /** Search text as it is in the page address (may be refused by the server as too long). */
  search: string;
  unitId: string | null;
  status: MemberStatusFilter;
};

/**
 * Search and filter controls (spec F2, F3). A plain GET form, so Enter works without JavaScript;
 * with JavaScript, selects apply at once and typing searches after a pause, always back to page 1.
 */
export function MemberFilters({
  values,
  unitOptions,
  searchInvalid,
  errorId,
}: {
  values: MemberFilterValues;
  unitOptions: MemberUnitOption[];
  /** The server refused the search text; the message is rendered by the page under `errorId`. */
  searchInvalid: boolean;
  errorId: string;
}) {
  const { navigate } = useListNavigation();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [search, setSearch] = useState(values.search);
  const [unitId, setUnitId] = useState(values.unitId ?? "");
  const [status, setStatus] = useState<MemberStatusFilter>(values.status);
  // The search text this form last put in the address. An address that differs from it changed from
  // outside (Back, Reset, a link), so the fields follow; otherwise typing in progress is kept.
  const [sentSearch, setSentSearch] = useState(values.search.trim());
  const [seenKey, setSeenKey] = useState(stateKey(values));

  const incomingKey = stateKey(values);
  if (incomingKey !== seenKey) {
    setSeenKey(incomingKey);
    setUnitId(values.unitId ?? "");
    setStatus(values.status);
    if (values.search.trim() !== sentSearch) {
      setSearch(values.search);
      setSentSearch(values.search.trim());
    }
  }

  // A search waiting for its pause must not fire after the page is gone.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function clearPending() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }

  function apply(next: { search: string; unitId: string; status: MemberStatusFilter }, replace = false) {
    clearPending();
    const trimmed = next.search.trim();
    setSentSearch(trimmed);
    navigate(memberListHref({ search: trimmed || null, unitId: next.unitId || null, status: next.status }), { replace });
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    apply({ search, unitId, status });
  }

  function onSearchChange(value: string) {
    setSearch(value);
    clearPending();
    timer.current = setTimeout(() => {
      // Same text as the list already shows (for example only a space was added): nothing to do.
      if (value.trim() === sentSearch) return;
      apply({ search: value, unitId, status }, true);
    }, SEARCH_PAUSE_MS);
  }

  function onReset(event: React.MouseEvent<HTMLAnchorElement>) {
    if (!isPlainClick(event)) return;
    event.preventDefault();
    setSearch("");
    setUnitId("");
    setStatus("active");
    apply({ search: "", unitId: "", status: "active" });
  }

  return (
    <form
      method="get"
      action={MEMBER_LIST_PATH}
      role="search"
      aria-label="Cari dan saring anggota"
      onSubmit={onSubmit}
      className="flex flex-col gap-3"
    >
      <div className="relative">
        <label htmlFor="member-search" className="sr-only">
          {COPY.searchLabel}
        </label>
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-field-line"
          strokeWidth={2}
        />
        <input
          id="member-search"
          name={MEMBER_LIST_PARAMS.search}
          type="search"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          spellCheck={false}
          maxLength={MEMBER_SEARCH_MAX_LENGTH}
          placeholder={COPY.searchPlaceholder}
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          aria-invalid={searchInvalid || undefined}
          aria-describedby={searchInvalid ? errorId : undefined}
          className={`${cn(
            fieldBase,
            "scroll-mb-24 appearance-none pr-3 pl-10 placeholder:text-ink-meta",
            searchInvalid && "border-danger",
          )} text-field`}
        />
      </div>

      <div
        role="group"
        aria-labelledby="member-filter-title"
        className="rounded-xl border border-surface-line bg-surface p-4 shadow-elevation-1"
      >
        <div className="flex items-center justify-between gap-2">
          <h2 id="member-filter-title" className="flex items-center gap-2 text-label-lg text-ink-label">
            <SlidersHorizontal aria-hidden="true" className="size-4 text-walnut" strokeWidth={2} />
            Filter Direktori
          </h2>
          <a
            href={MEMBER_LIST_PATH}
            onClick={onReset}
            className="-my-2 -mr-2 inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg px-2 text-label-lg text-walnut underline underline-offset-2 hover:bg-ivory"
          >
            Reset
          </a>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <SelectField
            id="member-unit"
            label="Unit"
            name={MEMBER_LIST_PARAMS.unitId}
            value={unitId}
            onChange={(value) => {
              setUnitId(value);
              apply({ search, unitId: value, status });
            }}
          >
            <option value="">Semua unit</option>
            {unitOptions.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.name}
              </option>
            ))}
          </SelectField>
          <SelectField
            id="member-status"
            label="Status"
            name={MEMBER_LIST_PARAMS.status}
            value={status}
            onChange={(value) => {
              const parsed = memberStatusFilterSchema.catch("active").parse(value);
              setStatus(parsed);
              apply({ search, unitId, status: parsed });
            }}
          >
            {STATUS_ORDER.map((value) => (
              <option key={value} value={value}>
                {STATUS_OPTION_LABEL[value]}
              </option>
            ))}
          </SelectField>
        </div>

        {/* Without JavaScript the selects cannot apply themselves; this button does it instead. */}
        <noscript>
          <button
            type="submit"
            className="mt-3 inline-flex h-11 w-full items-center justify-center rounded-lg bg-walnut px-5 text-label-lg text-primary-foreground hover:bg-walnut-hover"
          >
            Terapkan
          </button>
        </noscript>
      </div>
    </form>
  );
}

function SelectField({
  id,
  label,
  name,
  value,
  onChange,
  children,
}: {
  id: string;
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-label-lg text-ink-label">
        {label}
      </label>
      <div className="relative">
        <select
          id={id}
          name={name}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={`${fieldClass} cursor-pointer appearance-none truncate pr-9 pl-3`}
        >
          {children}
        </select>
        <ChevronDown
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 right-2.5 size-5 -translate-y-1/2 text-ink-body"
          strokeWidth={2}
        />
      </div>
    </div>
  );
}

function stateKey(values: MemberFilterValues): string {
  return JSON.stringify([values.search, values.unitId, values.status]);
}
