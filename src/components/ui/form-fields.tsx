import { forwardRef, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { describedBy, FieldError } from "./field-error";
import { fieldBoxClass, fieldHintClass, fieldLabelClass } from "./field-styles";

// Form controls that match TextField (docs/design/inventory-borrowing.md 3.4). Each takes the native
// props, so it works controlled (value + onChange) or as a plain GET form field without JavaScript.

type FieldFrameProps = {
  id: string;
  label: ReactNode;
  /** Helper line under the box (always read with the field). */
  hint?: ReactNode;
  /** Error under the box; also turns the border red. */
  error?: ReactNode;
  className?: string;
};

function hintId(id: string) {
  return `${id}-hint`;
}
function errorId(id: string) {
  return `${id}-error`;
}

function Frame({ id, label, hint, error, className, children }: FieldFrameProps & { children: ReactNode }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <label htmlFor={id} className={fieldLabelClass}>
        {label}
      </label>
      {children}
      {hint ? (
        <p id={hintId(id)} className={fieldHintClass}>
          {hint}
        </p>
      ) : null}
      {error ? <FieldError id={errorId(id)}>{error}</FieldError> : null}
    </div>
  );
}

type SelectFieldProps = FieldFrameProps & Omit<SelectHTMLAttributes<HTMLSelectElement>, "id" | "className">;

/** Native select (phones show their own picker), 48 px, chevron on the right. */
export function SelectField({ id, label, hint, error, className, children, ...selectProps }: SelectFieldProps) {
  return (
    <Frame id={id} label={label} hint={hint} error={error} className={className}>
      <div className="relative">
        <select
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(hint ? hintId(id) : null, error ? errorId(id) : null)}
          className={fieldBoxClass({ invalid: Boolean(error), className: "h-12 cursor-pointer appearance-none truncate pr-9 pl-3" })}
          {...selectProps}
        >
          {children}
        </select>
        <ChevronDown
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 right-2.5 size-5 -translate-y-1/2 text-ink-body"
          strokeWidth={2}
        />
      </div>
    </Frame>
  );
}

type DateFieldProps = FieldFrameProps & Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "type" | "className">;

/** Native date input (the phone date picker is the best one available), 48 px. Value is YYYY-MM-DD. */
export const DateField = forwardRef<HTMLInputElement, DateFieldProps>(function DateField(
  { id, label, hint, error, className, ...inputProps },
  ref,
) {
  return (
    <Frame id={id} label={label} hint={hint} error={error} className={className}>
      <input
        ref={ref}
        id={id}
        type="date"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(hint ? hintId(id) : null, error ? errorId(id) : null)}
        className={fieldBoxClass({ invalid: Boolean(error), className: "h-12 min-w-0 appearance-none px-3" })}
        {...inputProps}
      />
    </Frame>
  );
});

type TextareaFieldProps = FieldFrameProps & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id" | "className">;

/**
 * Textarea: same box, 3 rows, grows with the text up to about 6 rows where the browser supports
 * field-sizing (elsewhere it stays 3 rows and scrolls). No resize handle.
 */
export const TextareaField = forwardRef<HTMLTextAreaElement, TextareaFieldProps>(function TextareaField(
  { id, label, hint, error, className, rows = 3, ...textareaProps },
  ref,
) {
  return (
    <Frame id={id} label={label} hint={hint} error={error} className={className}>
      <textarea
        ref={ref}
        id={id}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(hint ? hintId(id) : null, error ? errorId(id) : null)}
        className={fieldBoxClass({
          invalid: Boolean(error),
          className: "max-h-40 min-h-[5.5rem] resize-none px-3 py-2.5 field-sizing-content",
        })}
        {...textareaProps}
      />
    </Frame>
  );
});
