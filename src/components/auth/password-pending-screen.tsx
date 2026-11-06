"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { recheckAccess } from "@/app/(app)/actions";
import { AlertMessage } from "@/components/ui/alert-message";
import { buttonClass, Spinner } from "@/components/ui/nx-button";
import { StatusCard } from "@/components/ui/status-card";
import { SignOutButton } from "./sign-out-button";
import { useSignOut } from "./use-sign-out";

type Notice = "still_pending" | "check_failed" | "sign_out_failed" | null;

const NOTICE_TEXT: Record<Exclude<Notice, null>, string> = {
  still_pending: "Kata sandimu belum berubah. Ganti di PI-CORE dulu, lalu coba lagi.",
  check_failed: "Terjadi gangguan. Coba lagi sebentar lagi.",
  sign_out_failed: "Terjadi gangguan. Coba lagi sebentar lagi.",
};

/**
 * Active member still on a temporary password (D-015). Sends them to PI-CORE in a new tab
 * (D-017 Q3) so this page stays open for "Sudah ganti? Muat ulang".
 */
export function PasswordPendingScreen({ changePasswordUrl }: { changePasswordUrl: string }) {
  const router = useRouter();
  const signOut = useSignOut();
  const [checking, startCheck] = useTransition();
  const [notice, setNotice] = useState<Notice>(null);

  function recheck() {
    if (checking) return;
    setNotice(null); // removed first so a repeated message is announced again
    startCheck(async () => {
      let kind: Awaited<ReturnType<typeof recheckAccess>>;
      try {
        kind = await recheckAccess();
      } catch {
        kind = "error";
      }
      if (kind === "password_pending") {
        setNotice("still_pending");
      } else if (kind === "error") {
        // Stay here, still signed in (AR10).
        setNotice("check_failed");
      } else {
        // Changed: let the protected layout render the right screen (usually the Dashboard).
        router.refresh();
      }
    });
  }

  const shownNotice: Notice = signOut.failed ? "sign_out_failed" : notice;

  return (
    <StatusCard
      title="Ganti kata sandi dulu"
      body="Kamu masih memakai kata sandi sementara. Ganti kata sandi di PI-CORE, lalu kembali ke sini."
    >
      {shownNotice ? (
        <AlertMessage role="alert" tone="warning" className="mb-4">
          {NOTICE_TEXT[shownNotice]}
        </AlertMessage>
      ) : null}
      <div className="flex flex-col gap-2">
        <a
          href={changePasswordUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonClass("primary")}
        >
          Buka PI-CORE
          <span className="sr-only"> (membuka tab baru)</span>
        </a>
        <button
          type="button"
          onClick={recheck}
          aria-busy={checking || undefined}
          className={buttonClass("outline")}
        >
          {checking ? (
            <>
              <Spinner />
              Memeriksa...
            </>
          ) : (
            "Sudah ganti? Muat ulang"
          )}
        </button>
        <SignOutButton variant="text" pending={signOut.pending} onPress={signOut.run} className="self-center" />
      </div>
    </StatusCard>
  );
}
