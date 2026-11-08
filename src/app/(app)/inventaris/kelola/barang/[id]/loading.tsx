import { DetailSkeleton } from "@/modules/inventory-borrowing/ui/skeletons";

// First load of "Ubah barang" (design 7.7).
export default function Loading() {
  return <DetailSkeleton text="Memuat barang..." />;
}
