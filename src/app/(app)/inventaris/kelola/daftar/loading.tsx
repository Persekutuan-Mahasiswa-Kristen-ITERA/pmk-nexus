import { DetailSkeleton } from "@/modules/inventory-borrowing/ui/skeletons";

// First load of "Kategori dan lokasi" (design 8.3).
export default function Loading() {
  return <DetailSkeleton text="Memuat daftar..." />;
}
