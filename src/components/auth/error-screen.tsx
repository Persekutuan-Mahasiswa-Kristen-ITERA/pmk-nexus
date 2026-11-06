"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import { recheckAccess } from "@/app/(app)/actions";
import { buttonClass, Spinner } from "@/components/ui/nx-button";
import { StatusCard } from "@/components/ui/status-card";

/**
 * The access check failed (network, database, paused project). Fail closed: no data,
 * the person stays signed in, one action (design section 8). Amber, not red: not their fault.
 */
export function ErrorScreen() {
  const router = useRouter();
  const [retrying, startRetry] = useTransition();
  const [announcement, setAnnouncement] = useState("");

  function retry() {
    if (retrying) return;
    setAnnouncement("");
    startRetry(async () => {
      let kind: Awaited<ReturnType<typeof recheckAccess>>;
      try {
        kind = await recheckAccess();
      } catch {
        kind = "error";
      }
      if (kind === "error") {
        // Screen-reader-only: tells the person the retry ran and failed again.
        setAnnouncement("Masih terjadi gangguan.");
      } else {
        router.refresh();
      }
    });
  }

  return (
    <StatusCard
      title="Terjadi gangguan"
      icon={<TriangleAlert aria-hidden="true" className="size-6 shrink-0 text-warn" strokeWidth={2} />}
      body="Coba lagi sebentar lagi. Kalau masih gagal, hubungi admin PMK ITERA."
    >
      <button type="button" onClick={retry} aria-busy={retrying || undefined} className={buttonClass("primary")}>
        {retrying ? (
          <>
            <Spinner />
            Memeriksa...
          </>
        ) : (
          "Coba lagi"
        )}
      </button>
      <p role="status" className="sr-only">
        {announcement}
      </p>
    </StatusCard>
  );
}
