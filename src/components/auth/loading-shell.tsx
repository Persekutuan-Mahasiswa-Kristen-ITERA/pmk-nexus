import { AppFrame } from "@/components/shell/app-frame";

/** Flat placeholder bar. No shimmer, no pulse (MOTION 1). */
function Bar({ className }: { className: string }) {
  return <div className={`max-w-full rounded-sm bg-ivory ${className}`} />;
}

function SkeletonCard({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <div className={`flex flex-col gap-2 rounded-xl border border-surface-line bg-surface p-4 shadow-elevation-1 ${className}`}>
      {children}
    </div>
  );
}

/**
 * Content of the loading state (design section 7): says what is happening, shows no module
 * data, names, numbers or menu. Generic on purpose: the final Dashboard shape depends on permissions.
 */
export function LoadingContent() {
  return (
    <div>
      <p role="status" className="text-label-lg text-ink-body">
        Memeriksa akunmu...
      </p>
      <div aria-hidden="true" className="mt-3 flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Bar className="h-8 w-[180px]" />
          <Bar className="h-3.5 w-[260px]" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <SkeletonCard className="h-24">
            <Bar className="h-3 w-[90px]" />
            <Bar className="h-6 w-[60px]" />
          </SkeletonCard>
          <SkeletonCard className="h-24">
            <Bar className="h-3 w-[90px]" />
            <Bar className="h-6 w-[60px]" />
          </SkeletonCard>
        </div>
        <SkeletonCard className="h-40">
          <Bar className="h-3.5 w-[140px]" />
          <Bar className="h-3 w-full" />
          <Bar className="h-3 w-full" />
        </SkeletonCard>
      </div>
    </div>
  );
}

/** Loading state with the app bar, for use before the shell exists. */
export function LoadingShell() {
  return (
    <AppFrame>
      <LoadingContent />
    </AppFrame>
  );
}
