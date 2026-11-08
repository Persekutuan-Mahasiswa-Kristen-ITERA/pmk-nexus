import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Radio card (docs/design/inventory-borrowing.md 3.7, 7.8): one label around a native radio, so the
 * whole card is the target (48 px or more). Selected = 2 px walnut border, ivory fill, filled dot and
 * bold title; never colour alone. Arrow keys move inside the group, as with any radio group.
 */
export function RadioRow({
  id,
  name,
  value,
  label,
  description,
  checked,
  onChange,
  readOnly,
  className,
}: {
  id?: string;
  name: string;
  value?: string;
  label: ReactNode;
  /** Second line under the title (radio cards of design 7.1). */
  description?: ReactNode;
  checked: boolean;
  onChange: () => void;
  /** While a save runs: the choice stays visible but does not change. */
  readOnly?: boolean;
  className?: string;
}) {
  return (
    <label
      className={cn(
        "flex min-h-12 cursor-pointer items-start gap-3 rounded-lg border px-3 py-3 has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-walnut",
        description ? "rounded-xl" : "items-center py-2.5",
        checked ? "border-2 border-walnut bg-ivory" : "border-[1.5px] border-field-line bg-surface hover:border-walnut",
        className,
      )}
    >
      <input
        id={id}
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={() => !readOnly && onChange()}
        className={cn("size-5 shrink-0 accent-walnut", description && "mt-0.5")}
      />
      <span className="min-w-0">
        <span className={cn("block text-body-md text-ink", checked && "font-semibold")}>{label}</span>
        {description ? <span className="mt-0.5 block text-body-sm text-ink-body">{description}</span> : null}
      </span>
    </label>
  );
}
