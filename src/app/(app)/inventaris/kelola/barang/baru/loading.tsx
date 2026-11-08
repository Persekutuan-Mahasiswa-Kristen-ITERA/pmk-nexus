import { DetailSkeleton } from "@/modules/inventory-borrowing/ui/skeletons";

// First load of "Tambah barang": the form needs the category and location lists (design 7.7).
export default function Loading() {
  return <DetailSkeleton text="Memuat daftar..." />;
}
