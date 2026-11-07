"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { useListNavigation } from "@/components/list/list-navigation";
import { AlertMessage } from "@/components/ui/alert-message";
import { DateField } from "@/components/ui/form-fields";
import { buttonClass } from "@/components/ui/nx-button";
import { INVENTORY_ERROR_COPY, type ItemAvailability } from "../types";
import { COPY } from "./copy";
import { formatCount, formatRange } from "./format";
import { INVENTORY_PARAMS } from "./routes";

/** Wait after the last date change before checking (design 6.2: "after a short pause"). */
const CHECK_PAUSE_MS = 400;

export type AvailabilityResult =
  | { kind: "none" }
  | { kind: "ok"; data: ItemAvailability; from: string; to: string }
  | { kind: "invalid"; field: "from" | "to"; text: string }
  | { kind: "error" };

/**
 * "Cek ketersediaan" (design 6.1, 6.2). The dates live in the page address, so the server answers with
 * the counts and a link can be shared; with JavaScript the check runs by itself once both dates are
 * valid, without it the "Cek" button sends the same GET form. Counts only, never who (R8, IB-18).
 */
export function AvailabilityCheck({
  action,
  keepParams,
  initialFrom,
  initialTo,
  result,
  today,
}: {
  /** The item page path (form action). */
  action: string;
  /** Catalog parameters to keep in the address (so "< Katalog" still returns to the same list). */
  keepParams: Record<string, string>;
  initialFrom: string;
  initialTo: string;
  result: AvailabilityResult;
  today: string;
}) {
  const { navigate, refresh, pending } = useListNavigation();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [localError, setLocalError] = useState<{ field: "from" | "to"; text: string } | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function href(nextFrom: string, nextTo: string): string {
    const params = new URLSearchParams(keepParams);
    params.delete(INVENTORY_PARAMS.from);
    params.delete(INVENTORY_PARAMS.to);
    if (nextFrom && nextTo) {
      params.set(INVENTORY_PARAMS.from, nextFrom);
      params.set(INVENTORY_PARAMS.to, nextTo);
    }
    const query = params.toString();
    return query ? `${action}?${query}` : action;
  }

  function onChange(nextFrom: string, nextTo: string) {
    setFrom(nextFrom);
    setTo(nextTo);
    if (timer.current) clearTimeout(timer.current);
    if (nextFrom !== "" && nextFrom < today) {
      setLocalError({ field: "from", text: INVENTORY_ERROR_COPY.start_in_past ?? COPY.unavailable });
      return;
    }
    if (nextFrom !== "" && nextTo !== "" && nextTo < nextFrom) {
      setLocalError({ field: "to", text: INVENTORY_ERROR_COPY.invalid_dates ?? COPY.unavailable });
      return;
    }
    setLocalError(null);
    if (nextFrom === "" || nextTo === "") return;
    timer.current = setTimeout(() => navigate(href(nextFrom, nextTo), { replace: true }), CHECK_PAUSE_MS);
  }

  const fieldError = localError ?? (result.kind === "invalid" ? result : null);
  const showResult = !localError && from === initialFrom && to === initialTo;

  return (
    <form method="get" action={action} onSubmit={(event) => event.preventDefault()} className="flex flex-col gap-3">
      {Object.entries(keepParams)
        .filter(([name]) => name !== INVENTORY_PARAMS.from && name !== INVENTORY_PARAMS.to)
        .map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
      <div className="grid grid-cols-2 gap-3">
        <DateField
          id="check-from"
          label="Mulai"
          name={INVENTORY_PARAMS.from}
          min={today}
          value={from}
          onChange={(event) => onChange(event.target.value, to)}
          error={fieldError?.field === "from" ? fieldError.text : undefined}
        />
        <DateField
          id="check-to"
          label="Sampai"
          name={INVENTORY_PARAMS.to}
          min={from || today}
          value={to}
          onChange={(event) => onChange(from, event.target.value)}
          error={fieldError?.field === "to" ? fieldError.text : undefined}
        />
      </div>
      <p className="-mt-1 text-body-sm text-ink-body">{COPY.inclusiveHint}</p>
      <noscript>
        <button type="submit" className={buttonClass("outline")}>
          Cek
        </button>
      </noscript>

      <div role="status" aria-live="polite" className="empty:hidden">
        {pending ? (
          <p className="flex items-center gap-2 text-body-md text-ink-body">
            <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" strokeWidth={2} />
            {COPY.checking}
          </p>
        ) : showResult && result.kind === "ok" ? (
          <ResultText data={result.data} range={formatRange(result.from, result.to)} />
        ) : null}
      </div>
      {!pending && showResult && result.kind === "error" ? (
        <div className="flex flex-col items-start gap-2">
          <AlertMessage role="alert" tone="warning" className="w-full">
            {COPY.availabilityError}
          </AlertMessage>
          <button type="button" onClick={refresh} className={buttonClass("outline")}>
            Coba lagi
          </button>
        </div>
      ) : null}
    </form>
  );
}

/** Design 6.2 result copy. The denominator is the stock in Baik (lendable), not the total. */
function ResultText({ data, range }: { data: ItemAvailability; range: string }) {
  if (data.freeQty <= 0) {
    return <p className="text-body-md font-semibold text-ink">{COPY.noneFree}</p>;
  }
  const held = data.lendableQty - data.freeQty;
  return (
    <p className="text-body-md text-ink-body">
      <span className="block text-headline-sm text-ink tabular-nums">
        Tersedia {formatCount(data.freeQty)} dari {formatCount(data.lendableQty)}
      </span>
      pada {range}.
      {held > 0 ? ` ${formatCount(held)} lainnya sudah dipesan atau sedang dipinjam.` : null}
    </p>
  );
}
