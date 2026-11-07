"use client";

import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ListLink } from "./list-navigation";

// Filter tags are one of the two places pills are allowed (D-014). The visible pill is 36 px; an
// invisible extension makes the tap area 44 px (R-03) without making the row look heavy.
const tagBase =
  "relative inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 whitespace-nowrap transition-colors duration-150 motion-reduce:transition-none after:absolute after:-inset-y-1 after:inset-x-0 after:content-['']";
const tagIdle = "border-field-line bg-surface text-ink-body hover:border-walnut hover:text-walnut";
const tagActive = "border-walnut bg-walnut font-bold text-primary-foreground";

export type TagLinkOption = { key: string; label: string; href: string };

/**
 * Single-choice filter as links (e.g. "Berjalan / Selesai / Semua"): each choice is its own address.
 * The chosen one is filled walnut, bold and aria-current, not colour alone.
 */
export function FilterTagLinks({ label, options, current }: { label: string; options: TagLinkOption[]; current: string }) {
  return (
    <nav aria-label={label}>
      <ul className="flex flex-wrap gap-x-2 gap-y-2">
        {options.map((option) => {
          const active = option.key === current;
          return (
            <li key={option.key}>
              <ListLink
                href={option.href}
                aria-current={active ? "true" : undefined}
                className={`${cn(tagBase, active ? tagActive : tagIdle)} text-label-lg`}
              >
                {option.label}
              </ListLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Applied filter with a remove target: accessible name "Hapus filter {label}". */
export function RemovableTag({ label, href }: { label: string; href: string }) {
  return (
    <ListLink href={href} className={`${cn(tagBase, "border-ivory-line bg-ivory pr-2.5 text-walnut hover:bg-surface")} text-label-lg`}>
      <span className="sr-only">Hapus filter </span>
      <span className="max-w-[14rem] truncate">{label}</span>
      <X aria-hidden="true" className="size-4 shrink-0" strokeWidth={2} />
    </ListLink>
  );
}

export type ChoiceTagOption = { value: string; label: string };

/**
 * Single-choice filter inside a form, as radio inputs drawn as pills (works in a plain GET form).
 * Keyboard: arrow keys move inside the group, as with any radio group.
 */
export function ChoiceTags({
  legend,
  name,
  options,
  value,
  onChange,
}: {
  legend: string;
  name: string;
  options: ChoiceTagOption[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-1.5">
      <legend className="mb-1.5 text-label-lg text-ink-label">{legend}</legend>
      <div className="flex flex-wrap gap-x-2 gap-y-2">
        {options.map((option) => {
          const id = `${name}-${option.value || "all"}`;
          const checked = option.value === value;
          return (
            <span key={option.value} className="inline-flex">
              <input
                id={id}
                type="radio"
                name={name}
                value={option.value}
                checked={checked}
                onChange={() => onChange(option.value)}
                className="peer sr-only"
              />
              <label
                htmlFor={id}
                className={`${cn(
                  tagBase,
                  "cursor-pointer peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-walnut",
                  checked ? tagActive : tagIdle,
                )} text-label-lg`}
              >
                {option.label}
              </label>
            </span>
          );
        })}
      </div>
    </fieldset>
  );
}
