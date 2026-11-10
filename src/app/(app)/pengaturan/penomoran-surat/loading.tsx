import { COPY } from "@/modules/letters/ui/copy";
import { DetailSkeleton } from "@/modules/letters/ui/skeletons";

// First load of Penomoran Surat (design 13.5).
export default function Loading() {
  return <DetailSkeleton text={COPY.loadingSettings} />;
}
