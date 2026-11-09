/**
 * Placeholder bar for loading shapes. A light band sweeps across it (nx-shimmer, D-023 round 2) so the
 * page reads as "still loading"; with reduced motion it is a still ivory bar.
 */
export function SkeletonBar({ className, width }: { className: string; width?: string }) {
  return <div style={width ? { width } : undefined} className={`nx-shimmer max-w-full rounded-sm bg-ivory ${className}`} />;
}
