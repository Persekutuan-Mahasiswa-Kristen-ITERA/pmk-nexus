import { COPY } from "@/modules/letters/ui/copy";
import { DetailSkeleton } from "@/modules/letters/ui/skeletons";

// First load of a letter (design 6.4).
export default function Loading() {
  return <DetailSkeleton text={COPY.loadingLetters} plate />;
}
