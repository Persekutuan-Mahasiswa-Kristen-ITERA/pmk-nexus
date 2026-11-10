import { COPY } from "@/modules/letters/ui/copy";
import { DetailSkeleton } from "@/modules/letters/ui/skeletons";

// First load of "Ubah rincian" (design 7.7).
export default function Loading() {
  return <DetailSkeleton text={COPY.loadingForm} />;
}
