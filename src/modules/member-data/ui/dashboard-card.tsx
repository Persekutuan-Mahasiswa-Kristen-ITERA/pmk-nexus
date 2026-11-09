import { Users } from "lucide-react";
import { ListNavigationProvider, RetryButton } from "@/components/list/list-navigation";
import { SkeletonBar } from "@/components/ui/skeleton-bar";
import { CountUp } from "@/components/ui/count-up";
import { DashboardCard, DashboardCardLink } from "@/components/ui/dashboard-card";
import { buttonClass } from "@/components/ui/nx-button";
import { MEMBER_LIST_PATH } from "./list-url";

const TITLE_ID = "member-count-title";

// Proposed copy (D-023 pilot), waiting for the owner. The figure is M5b: every member with is_active.
export const MEMBER_CARD_COPY = {
  title: "Data Anggota",
  unit: "anggota aktif",
  note: "Termasuk pembina dan anggota tanpa jabatan.",
  loading: "Memuat jumlah anggota...",
  error: "Jumlah anggota belum bisa dimuat.",
  link: "Buka Data Anggota",
} as const;

function Card({ children }: { children: React.ReactNode }) {
  return (
    <DashboardCard slot={1} titleId={TITLE_ID} title={MEMBER_CARD_COPY.title} icon={<Users aria-hidden="true" className="size-5" strokeWidth={2} />}>
      {children}
    </DashboardCard>
  );
}

/** Dashboard "Members" card (spec M5b, MD-38): member_data.view holders only; the page decides. */
export function MemberCountCard({ result }: { result: { kind: "ok"; count: number } | { kind: "error" } }) {
  if (result.kind === "error") {
    return (
      <Card>
        <p role="alert" className="text-body-md text-warn">
          {MEMBER_CARD_COPY.error}
        </p>
        <ListNavigationProvider>
          <RetryButton className={buttonClass("text", "-ml-2 self-start")} />
        </ListNavigationProvider>
      </Card>
    );
  }
  return (
    <Card>
      <div>
        <p className="nx-figure-lg text-ink">
          <CountUp value={result.count} />
        </p>
        <p className="text-body-md font-semibold text-ink">{MEMBER_CARD_COPY.unit}</p>
        <p className="mt-0.5 text-body-sm text-ink-meta">{MEMBER_CARD_COPY.note}</p>
      </div>
      <DashboardCardLink href={MEMBER_LIST_PATH}>{MEMBER_CARD_COPY.link}</DashboardCardLink>
    </Card>
  );
}

export function MemberCountSkeleton() {
  return (
    <Card>
      <p role="status" className="text-body-sm text-ink-body">
        {MEMBER_CARD_COPY.loading}
      </p>
      <div aria-hidden="true" className="flex flex-col gap-2">
        <SkeletonBar className="h-10 w-[80px]" />
        <SkeletonBar className="h-3.5 w-[120px]" />
      </div>
    </Card>
  );
}
