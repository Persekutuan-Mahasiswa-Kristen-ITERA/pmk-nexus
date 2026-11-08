import { DetailSkeleton } from "@/modules/inventory-borrowing/ui/skeletons";

// First load of "Terima pengembalian" (design 13.6).
export default function Loading() {
  return <DetailSkeleton text="Memuat pengembalian..." />;
}
