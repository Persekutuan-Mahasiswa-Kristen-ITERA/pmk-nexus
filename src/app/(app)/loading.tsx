import { LoadingContent } from "@/components/auth/loading-shell";

// Page-level loading inside the signed-in frame (the app bar is already drawn by the layout).
export default function Loading() {
  return <LoadingContent />;
}
