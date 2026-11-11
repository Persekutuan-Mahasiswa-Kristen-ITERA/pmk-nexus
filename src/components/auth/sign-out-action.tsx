"use client";

import { AlertMessage } from "@/components/ui/alert-message";
import { cn } from "@/lib/utils";
import { SignOutButton, type SignOutVariant } from "./sign-out-button";
import { useSignOut } from "./use-sign-out";

/** Stand-alone "Keluar" with its own failure message. */
export function SignOutAction({ variant }: { variant: SignOutVariant }) {
  const signOut = useSignOut();
  const failure = signOut.failed ? (
    <AlertMessage
      role="alert"
      tone="warning"
      // On the app bar the message drops below the bar instead of pushing the brand aside.
      className={cn("w-full", variant === "bar" && "fixed inset-x-4 top-[4.5rem] z-30 w-auto shadow-elevation-2 md:inset-x-auto md:right-4 md:w-80")}
    >
      Terjadi gangguan. Coba lagi sebentar lagi.
    </AlertMessage>
  ) : null;

  if (variant === "bar") {
    return (
      <>
        <SignOutButton variant="bar" pending={signOut.pending} onPress={signOut.run} />
        {failure}
      </>
    );
  }
  return (
    <div className={cn("flex flex-col gap-2", variant === "row" ? "items-stretch" : "items-start")}>
      {failure}
      <SignOutButton variant={variant} pending={signOut.pending} onPress={signOut.run} className={variant === "row" ? undefined : "-mx-2"} />
    </div>
  );
}
