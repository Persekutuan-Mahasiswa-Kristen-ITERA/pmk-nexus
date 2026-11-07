import { DetailSkeleton } from "@/modules/inventory-borrowing/ui/skeletons";

// First load of Detail Pengajuan (design 10.5).
export default function Loading() {
  return <DetailSkeleton text="Memuat pengajuan..." />;
}
