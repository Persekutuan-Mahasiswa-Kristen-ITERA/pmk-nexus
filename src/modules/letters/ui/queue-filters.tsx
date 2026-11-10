"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { CalendarRange, ChevronDown, Search } from "lucide-react";
import { RemovableTag } from "@/components/list/filter-tags";
import { isPlainClick, useListNavigation } from "@/components/list/list-navigation";
import { fieldBoxClass } from "@/components/ui/field-styles";
import { DateField, SelectField } from "@/components/ui/form-fields";
import { cn } from "@/lib/utils";
import {
  LETTER_ERROR_COPY,
  LETTER_PARAMS,
  LETTER_QUEUE_VIEW_LABEL,
  LETTER_SEARCH_RAW_MAX_LENGTH,
  letterQueueViewSchema,
  type LetterQueueView,
} from "../types";
import { formatCount, formatDate } from "./format";
import { QUEUE_PATH, queueHref, type QueueUrlState } from "./routes";

const SEARCH_PAUSE_MS = 450;

export type ViewOption = { view: LetterQueueView; count: number | null };

/**
 * "Tampilkan" (design 11.1): one native select; the count in brackets only where it helps this person.
 * A plain GET form, so it also works without JavaScript.
 */
export function QueueViewSelect({ values, options }: { values: QueueUrlState; options: ViewOption[] }) {
  const { navigate } = useListNavigation();
  return (
    <form method="get" action={QUEUE_PATH} className="flex flex-col">
      <SelectField
        id="queue-view"
        label="Tampilkan"
        name={LETTER_PARAMS.view}
        value={values.view}
        onChange={(event) => {
          const parsed = letterQueueViewSchema.safeParse(event.target.value);
          const view = parsed.success ? parsed.data : values.defaultView;
          navigate(queueHref({ ...values, view, page: 1 }));
        }}
      >
        {options.map((option) => (
          <option key={option.view} value={option.view}>
            {LETTER_QUEUE_VIEW_LABEL[option.view]}
            {option.count !== null ? ` (${formatCount(option.count)})` : ""}
          </option>
        ))}
      </SelectField>
      <noscript>
        <button type="submit" className="mt-2 h-11 rounded-lg bg-walnut px-5 text-label-lg text-primary-foreground">
          Terapkan
        </button>
      </noscript>
    </form>
  );
}

/**
 * Search (requester name or Perihal) and "Filter tanggal" (requests submitted from-to, both or none;
 * past dates allowed). Same filter-card style as the register (design 11.1).
 */
export function QueueFilters({ values, rangeError }: { values: QueueUrlState; rangeError: string | null }) {
  const { navigate } = useListNavigation();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [search, setSearch] = useState(values.search);
  const [sentSearch, setSentSearch] = useState(values.search.trim());
  const [from, setFrom] = useState(values.from ?? "");
  const [to, setTo] = useState(values.to ?? "");
  const [localError, setLocalError] = useState<string | null>(null);
  const [open, setOpen] = useState(Boolean(values.from || values.to || rangeError));

  const key = JSON.stringify([values.search, values.from, values.to]);
  const [seenKey, setSeenKey] = useState(key);
  if (key !== seenKey) {
    setSeenKey(key);
    setFrom(values.from ?? "");
    setTo(values.to ?? "");
    setLocalError(null);
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

  function go(next: Partial<QueueUrlState>, replace = false) {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const state = { ...values, search: sentSearch, ...next, page: 1 };
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
      setLocalError(null);
      if (values.from || values.to) go({ from: null, to: null });
      return;
    }
    if (nextFrom === "" || nextTo === "") {
      setLocalError(null);
      return;
    }
    if (nextTo < nextFrom) {
      setLocalError(LETTER_ERROR_COPY.invalid_dates);
      return;
    }
    setLocalError(null);
    go({ from: nextFrom, to: nextTo });
  }

  function onReset(event: React.MouseEvent<HTMLAnchorElement>) {
    if (!isPlainClick(event)) return;
    event.preventDefault();
    setSearch("");
    setFrom("");
    setTo("");
    setLocalError(null);
    go({ search: "", from: null, to: null });
  }

  const shownError = localError ?? rangeError;
  const hasRange = Boolean(values.from && values.to);

  return (
    <form method="get" action={QUEUE_PATH} role="search" aria-label="Cari dan saring permohonan" onSubmit={onSubmit} className="flex flex-col gap-3">
      {values.view !== values.defaultView ? <input type="hidden" name={LETTER_PARAMS.view} value={values.view} /> : null}
      <div className="relative">
        <label htmlFor="queue-search" className="sr-only">
          Cari permohonan
        </label>
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-field-line"
          strokeWidth={2}
        />
        <input
          id="queue-search"
          name={LETTER_PARAMS.search}
          type="search"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          spellCheck={false}
          maxLength={LETTER_SEARCH_RAW_MAX_LENGTH}
          placeholder="Cari pemohon atau perihal..."
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          className={fieldBoxClass({ className: "h-12 appearance-none pr-3 pl-10" })}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-expanded={open}
          aria-controls="queue-date-card"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex h-11 items-center gap-2 rounded-lg border-[1.5px] border-walnut bg-surface px-4 text-label-lg text-walnut hover:bg-ivory"
        >
          <CalendarRange aria-hidden="true" className="size-4" strokeWidth={2} />
          Filter tanggal{hasRange ? <span className="tabular-nums"> (1)</span> : null}
          <ChevronDown
            aria-hidden="true"
            className={cn("size-4 transition-transform duration-150 motion-reduce:transition-none", open && "rotate-180")}
            strokeWidth={2}
          />
        </button>
        {hasRange && values.from && values.to ? (
          <RemovableTag
            label={`${formatDate(values.from)} sampai ${formatDate(values.to)}`}
            href={queueHref({ ...values, search: sentSearch, from: null, to: null, page: 1 })}
          />
        ) : null}
      </div>

      <div
        id="queue-date-card"
        role="group"
        aria-labelledby="queue-date-title"
        className={cn("flex-col gap-3 rounded-xl border border-surface-line bg-surface p-4 shadow-elevation-1", open ? "flex" : "hidden")}
      >
        <div className="flex items-center justify-between gap-2">
          <h2 id="queue-date-title" className="text-label-lg text-ink-label">
            Tanggal diajukan
          </h2>
          <a
            href={queueHref({ ...values, search: "", from: null, to: null, page: 1 })}
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
            name={LETTER_PARAMS.from}
            value={from}
            onChange={(event) => onDateChange(event.target.value, to)}
          />
          <DateField
            id="queue-to"
            label="Sampai"
            name={LETTER_PARAMS.to}
            min={from || undefined}
            value={to}
            onChange={(event) => onDateChange(from, event.target.value)}
            error={shownError ?? undefined}
          />
        </div>
        <noscript>
          <button type="submit" className="h-11 w-full rounded-lg bg-walnut px-5 text-label-lg text-primary-foreground">
            Terapkan
          </button>
        </noscript>
      </div>
    </form>
  );
}
