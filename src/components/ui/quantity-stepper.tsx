"use client";

import { useState } from "react";
import { Minus, Plus } from "lucide-react";
import { fieldBoxClass } from "./field-styles";

const stepButton =
  "inline-flex size-12 shrink-0 items-center justify-center rounded-lg border-[1.5px] border-walnut bg-surface text-walnut hover:bg-ivory active:scale-[0.98] motion-reduce:active:scale-100";

/**
 * Whole-number stepper (design 3.7 / 9.6): 48 x 48 minus and plus with a number field between them.
 * The field accepts typing; the value only reaches the parent as a whole number in [min, max].
 * The buttons are never greyed: at a limit they simply do nothing (K8).
 */
export function QuantityStepper({
  id,
  value,
  onChange,
  min = 1,
  max,
  label,
  invalid,
  describedBy,
  readOnly,
}: {
  id: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max: number;
  /** Accessible name, e.g. "Jumlah {nama barang}". */
  label: string;
  invalid?: boolean;
  describedBy?: string;
  readOnly?: boolean;
}) {
  // What is in the box while typing (may be empty for a moment).
  const [draft, setDraft] = useState(String(value));
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    setDraft(String(value));
  }

  function commit(next: number) {
    const clamped = Math.min(max, Math.max(min, next));
    setDraft(String(clamped));
    if (clamped !== value) onChange(clamped);
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        className={stepButton}
        aria-label={`Kurangi ${label}`}
        aria-controls={id}
        onClick={() => !readOnly && commit(value - 1)}
      >
        <Minus aria-hidden="true" className="size-5" strokeWidth={2} />
      </button>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="off"
        aria-label={label}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        readOnly={readOnly}
        value={draft}
        onChange={(event) => {
          const digits = event.target.value.replace(/\D/g, "").slice(0, 4);
          setDraft(digits);
          if (digits !== "") {
            const parsed = Number(digits);
            if (parsed >= min && parsed <= max && parsed !== value) onChange(parsed);
          }
        }}
        onBlur={() => commit(draft === "" ? min : Number(draft))}
        className={fieldBoxClass({ invalid, className: "h-12 w-16 px-2 text-center tabular-nums" })}
      />
      <button
        type="button"
        className={stepButton}
        aria-label={`Tambah ${label}`}
        aria-controls={id}
        onClick={() => !readOnly && commit(value + 1)}
      >
        <Plus aria-hidden="true" className="size-5" strokeWidth={2} />
      </button>
    </div>
  );
}
