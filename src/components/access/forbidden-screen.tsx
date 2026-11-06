import Link from "next/link";
import { Lock } from "lucide-react";
import { NarrowColumn } from "@/components/shell/app-frame";
import { AlertMessage } from "@/components/ui/alert-message";
import { buttonClass } from "@/components/ui/nx-button";
import { StatusCard } from "@/components/ui/status-card";

/**
 * Shared "no permission" page (auth-login F11, access control R10): signed in and active, but this
 * page needs a right the person does not hold. Not the No-access state: the session stays and the
 * rest of NEXUS still works, so the one action leads back to the Dashboard.
 * With no active period nobody holds module rights (R13), so the period notice explains why.
 */
export function ForbiddenScreen({ noActivePeriod = false }: { noActivePeriod?: boolean }) {
  return (
    <NarrowColumn>
      <div className="flex flex-col gap-4">
        {noActivePeriod ? (
          <AlertMessage role="status" tone="info">
            Belum ada periode aktif.
          </AlertMessage>
        ) : null}
        <StatusCard
          title="Tidak punya akses"
          icon={<Lock aria-hidden="true" className="size-6 shrink-0 text-walnut" strokeWidth={2} />}
          body="Kamu tidak punya akses ke halaman ini. Kalau kamu memerlukannya, hubungi admin PMK ITERA."
        >
          <Link href="/" className={buttonClass("outline")}>
            Kembali ke Dashboard
          </Link>
        </StatusCard>
      </div>
    </NarrowColumn>
  );
}
