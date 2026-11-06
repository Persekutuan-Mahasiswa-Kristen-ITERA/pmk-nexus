"use client";

import { AlertMessage } from "@/components/ui/alert-message";
import { SignOutButton } from "./sign-out-button";
import { useSignOut } from "./use-sign-out";

/** Stand-alone "Keluar" with its own failure message. */
export function SignOutAction({ variant }: { variant: "outline" | "text" }) {
  const signOut = useSignOut();
  return (
    <div className="flex flex-col items-start gap-2">
      {signOut.failed ? (
        <AlertMessage role="alert" tone="warning" className="w-full">
          Terjadi gangguan. Coba lagi sebentar lagi.
        </AlertMessage>
      ) : null}
      <SignOutButton variant={variant} pending={signOut.pending} onPress={signOut.run} className="-mx-2" />
    </div>
  );
}
