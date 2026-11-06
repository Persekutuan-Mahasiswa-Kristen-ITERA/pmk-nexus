"use client";

import { buttonClass, Spinner } from "@/components/ui/nx-button";

/** "Keluar" in the outline or text style. Shows a spinner while the session ends. */
export function SignOutButton({
  variant,
  pending,
  onPress,
  className,
}: {
  variant: "outline" | "text";
  pending: boolean;
  onPress: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        if (!pending) onPress();
      }}
      aria-busy={pending || undefined}
      className={buttonClass(variant, className)}
    >
      {pending ? <Spinner /> : null}
      Keluar
    </button>
  );
}
