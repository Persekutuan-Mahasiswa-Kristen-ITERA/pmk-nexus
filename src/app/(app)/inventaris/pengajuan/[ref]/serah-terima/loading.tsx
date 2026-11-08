import { DetailSkeleton } from "@/modules/inventory-borrowing/ui/skeletons";

// First load of "Serahkan barang" (design 12.4).
export default function Loading() {
  return <DetailSkeleton text="Memuat serah terima..." />;
}
