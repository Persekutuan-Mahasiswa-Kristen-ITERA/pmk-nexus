import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "id"> & {
  id: string;
  label: string;
  /** 20 px icon at the left, decorative. */
  leadingIcon?: ReactNode;
  /** A control inside the right end of the box (for example the password reveal button). */
  trailing?: ReactNode;
  invalid?: boolean;
};

/**
 * NEXUS text field (docs/design/login.md 2.5a): label above, 48 px box, radius 8,
 * 1 px #81756A border (D-017), 16 px text, 2 px walnut border plus soft halo on focus.
 * Read-only looks the same as editable so typed text stays readable while a request runs.
 */
export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { id, label, leadingIcon, trailing, invalid, className, ...inputProps },
  ref,
) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-label-lg text-ink-label">
        {label}
      </label>
      <div className="relative">
        {leadingIcon ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-field-line [&_svg]:size-5"
          >
            {leadingIcon}
          </span>
        ) : null}
        <input
          ref={ref}
          id={id}
          aria-invalid={invalid || undefined}
          className={cn(
            // scroll-mb-24 keeps the focused field above the phone keyboard (design 4.4).
            "h-12 w-full scroll-mb-24 rounded-lg border bg-field px-3 text-field text-ink transition-[border-color,box-shadow] duration-100 placeholder:text-ink-meta",
            "focus:outline-none focus-visible:outline-none",
            // taste-skill-ignore: focus-only inner line plus Stitch halo; nothing has a shadow at rest.
            invalid
              ? "border-danger focus:shadow-[inset_0_0_0_1px_var(--color-danger),0_0_0_2px_var(--color-focus-halo)]" // taste-skill-ignore
              : "border-field-line hover:border-walnut focus:border-walnut focus:shadow-[inset_0_0_0_1px_var(--color-walnut),0_0_0_2px_var(--color-focus-halo)]", // taste-skill-ignore
            leadingIcon && "pl-10",
            trailing && "pr-12",
            className,
          )}
          {...inputProps}
        />
        {trailing ? <div className="absolute inset-y-0.5 right-0.5 flex items-center">{trailing}</div> : null}
      </div>
    </div>
  );
});
