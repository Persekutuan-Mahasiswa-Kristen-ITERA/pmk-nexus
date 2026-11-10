"use client";

import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import { describedBy, FieldError } from "@/components/ui/field-error";
import { fieldBoxClass, fieldHintClass, fieldLabelClass } from "@/components/ui/field-styles";
import { rupiahInputDisplay } from "../types";
import { UI_COPY } from "./copy";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "value" | "onChange" | "type" | "inputMode"> & {
  id: string;
  label: string;
  /** What the field holds right now (already shown grouped: "1.250.000"). */
  value: string;
  /** Receives the grouped text. The form turns it into digits with normaliseRupiahInput() on submit. */
  onValueChange: (value: string) => void;
  hint?: ReactNode;
  error?: string;
};

/**
 * "Jumlah (Rp)" (spec 7 screen 3): a text field that opens the numeric keypad, shows "Rp" as a fixed
 * prefix and inserts the thousands dots while typing (contract rupiahInputDisplay). It never turns the
 * text into a JS number: anything that is not digits (a comma, a minus, a letter) stays as typed so the
 * error shows instead of a silently different amount.
 */
export const AmountField = forwardRef<HTMLInputElement, Props>(function AmountField(
  { id, label, value, onValueChange, hint, error, className, ...rest },
  ref,
) {
  const hintId = hint ? `${id}-hint` : null;
  const errorId = error ? `${id}-error` : null;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className={fieldLabelClass}>
        {label}
      </label>
      <div className="relative">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-body-md font-semibold text-ink-body"
        >
          {UI_COPY.amountPrefix}
        </span>
        <input
          ref={ref}
          id={id}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          enterKeyHint="next"
          spellCheck={false}
          value={value}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(hintId, errorId)}
          onChange={(event) => onValueChange(rupiahInputDisplay(event.target.value))}
          className={fieldBoxClass({ invalid: Boolean(error), className: `h-12 pr-3 pl-10 tabular-nums ${className ?? ""}` })}
          {...rest}
        />
      </div>
      {hint ? (
        <p id={hintId ?? undefined} className={fieldHintClass}>
          {hint}
        </p>
      ) : null}
      {error ? <FieldError id={errorId ?? `${id}-error`}>{error}</FieldError> : null}
    </div>
  );
});
