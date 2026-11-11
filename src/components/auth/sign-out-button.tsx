"use client";

import { LogOut } from "lucide-react";
import { buttonClass, Spinner } from "@/components/ui/nx-button";
import { cn } from "@/lib/utils";

export type SignOutVariant = "outline" | "text" | "bar" | "row";

// "bar": on the walnut app bar, icon only on a phone, icon and label from md up; 44 px hit area.
// "row": a drawer row in the same shape as the menu items, so it reads as an action and not a link.
const custom: Record<"bar" | "row", string> = {
  bar: "inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-lg px-2 text-primary-foreground hover:bg-walnut-hover focus-visible:outline-primary-foreground md:px-3",
  row: "flex min-h-11 w-full items-center gap-3 rounded-lg px-4 text-ink-body transition-[color,background-color,transform] duration-150 hover:bg-ivory hover:text-ink active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100",
};

/** "Keluar" in one of four styles. Shows a spinner while the session ends. */
export function SignOutButton({
  variant,
  pending,
  onPress,
  className,
}: {
  variant: SignOutVariant;
  pending: boolean;
  onPress: () => void;
  className?: string;
}) {
  const withIcon = variant === "bar" || variant === "row";
  return (
    <button
      type="button"
      onClick={() => {
        if (!pending) onPress();
      }}
      aria-busy={pending || undefined}
      // Type size outside cn(): see buttonClass in components/ui/nx-button.tsx.
      className={withIcon ? `text-label-lg ${cn(custom[variant], className)}` : buttonClass(variant, className)}
    >
      {pending ? (
        <Spinner />
      ) : withIcon ? (
        <LogOut aria-hidden="true" className={cn("size-5 shrink-0", variant === "row" && "text-walnut")} strokeWidth={2} />
      ) : null}
      {/* The bar shows the icon only on a phone; the word stays the accessible name. */}
      {variant === "bar" ? <span className="sr-only md:not-sr-only">Keluar</span> : "Keluar"}
    </button>
  );
}
