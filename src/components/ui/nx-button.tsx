import { LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";

type ButtonVariant = "primary" | "outline" | "text";

const base =
  "inline-flex items-center justify-center gap-2 select-none transition-[background-color,transform] duration-100 motion-reduce:transition-none";

const variants: Record<ButtonVariant, string> = {
  // 48 px, full width inside a card, walnut fill (docs/design/login.md 2.6).
  primary:
    "h-12 w-full rounded-lg bg-walnut px-5 text-headline-sm text-primary-foreground hover:bg-walnut-hover active:scale-[0.98] motion-reduce:active:scale-100",
  // 1.5 px walnut outline on white; hover ivory.
  outline:
    "h-12 w-full rounded-lg border-[1.5px] border-walnut bg-surface px-5 text-headline-sm text-walnut hover:bg-ivory active:scale-[0.98] motion-reduce:active:scale-100",
  // Underlined text action with a 44 px tap area.
  text: "min-h-11 min-w-11 rounded-lg px-2 text-label-lg text-walnut underline underline-offset-2 hover:bg-ivory",
};

/** Class string for a NEXUS button or a link that looks like one. */
export function buttonClass(variant: ButtonVariant, className?: string) {
  return cn(base, variants[variant], className);
}

/** Busy indicator shown left of a button label while a request runs (static with reduced motion). */
export function Spinner() {
  return (
    <LoaderCircle
      aria-hidden="true"
      className="size-[18px] shrink-0 animate-spin motion-reduce:animate-none"
      strokeWidth={2}
    />
  );
}
