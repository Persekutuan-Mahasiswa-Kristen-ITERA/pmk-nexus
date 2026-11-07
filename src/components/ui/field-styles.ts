import { cn } from "@/lib/utils";

/**
 * The NEXUS field box (D-017, docs/design/login.md 2.5a): 48 px, radius 8, 1 px #81756A border,
 * 16 px text, walnut border plus the Stitch halo on focus. Shared by selects, dates, numbers and
 * textareas so every form control looks like TextField.
 *
 * `text-field` (16 px) is appended OUTSIDE cn(): next to a text colour cn() would drop it.
 */
export function fieldBoxClass(options: { invalid?: boolean; className?: string } = {}): string {
  return `${cn(
    "w-full scroll-mb-24 rounded-lg border bg-field text-ink transition-[border-color,box-shadow] duration-100 placeholder:text-ink-meta motion-reduce:transition-none",
    "focus:outline-none focus-visible:outline-none",
    options.invalid
      ? "border-danger focus:shadow-[inset_0_0_0_1px_var(--color-danger),0_0_0_2px_var(--color-focus-halo)]" // taste-skill-ignore: focus only
      : "border-field-line hover:border-walnut focus:border-walnut focus:shadow-[inset_0_0_0_1px_var(--color-walnut),0_0_0_2px_var(--color-focus-halo)]", // taste-skill-ignore: focus only
    options.className,
  )} text-field`;
}

/** Label above a field (label-lg, label brown). */
export const fieldLabelClass = "text-label-lg text-ink-label";

/** Helper line under a field. */
export const fieldHintClass = "text-body-sm text-ink-body";
