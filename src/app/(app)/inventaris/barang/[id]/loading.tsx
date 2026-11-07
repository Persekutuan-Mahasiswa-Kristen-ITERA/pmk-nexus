import { DetailSkeleton } from "@/modules/inventory-borrowing/ui/skeletons";

// First load of the item page (design 6.4).
export default function Loading() {
  return <DetailSkeleton text="Memuat barang..." />;
}
