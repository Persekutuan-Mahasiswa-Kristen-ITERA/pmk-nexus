"use client";

import { useEffect, useRef } from "react";
import { AlertMessage } from "@/components/ui/alert-message";
import { StatusCard } from "@/components/ui/status-card";
import { dropLocalSession } from "@/lib/auth/drop-session";
import { SignOutButton } from "./sign-out-button";
import { useSignOut } from "./use-sign-out";

/**
 * Signed in, but my_context() returned no row (deactivated or unlinked; one message, D-016).
 * No menu, no links, no retry: retrying cannot change the answer (design section 5).
 * The session is dropped once on first render (spec 6.2), so a reload lands on /login.
 */
export function NoAccessScreen() {
  const signOut = useSignOut();
  const dropped = useRef(false);

  useEffect(() => {
    // The ref keeps React's dev double-invoke from calling it twice. Failure is harmless: RLS already denies.
    if (dropped.current) return;
    dropped.current = true;
    void dropLocalSession();
  }, []);

  return (
    <StatusCard title="Belum ada akses" body="Akunmu belum bisa dipakai di NEXUS. Hubungi admin PMK ITERA.">
      {signOut.failed ? (
        <AlertMessage role="alert" tone="warning" className="mb-4">
          Terjadi gangguan. Coba lagi sebentar lagi.
        </AlertMessage>
      ) : null}
      <SignOutButton variant="outline" pending={signOut.pending} onPress={signOut.run} />
    </StatusCard>
  );
}
