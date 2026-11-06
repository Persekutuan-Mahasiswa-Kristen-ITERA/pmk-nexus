/** Flat placeholder bar. No shimmer, no pulse (MOTION 1). */
function Bar({ className, width }: { className: string; width?: string }) {
  return <div style={width ? { width } : undefined} className={`max-w-full rounded-sm bg-ivory ${className}`} />;
}

const ROWS = [62, 48, 70, 55, 66, 44];

/**
 * First load of Data Anggota (spec F1 step 3): the shape of the screen with skeleton rows and no
 * member data, because the permission check has not finished yet.
 */
export default function Loading() {
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-5 md:max-w-3xl">
      <p role="status" className="sr-only">
        Memuat data anggota...
      </p>
      <div aria-hidden="true" className="contents">
        <div className="flex items-end justify-between gap-4 border-b border-surface-line pb-3">
          <div className="flex flex-col gap-2">
            <Bar className="h-8 w-[200px]" />
            <Bar className="h-3.5 w-[120px]" />
          </div>
          <Bar className="h-12 w-[88px]" />
        </div>
        <Bar className="h-12 w-full rounded-lg" />
        <div className="flex flex-col gap-3 rounded-xl border border-surface-line bg-surface p-4 shadow-elevation-1">
          <Bar className="h-3.5 w-[120px]" />
          <div className="grid grid-cols-2 gap-3">
            <Bar className="h-12 w-full rounded-lg" />
            <Bar className="h-12 w-full rounded-lg" />
          </div>
        </div>
        <div className="overflow-hidden rounded-xl border border-surface-line bg-surface shadow-elevation-1">
          <div className="h-9 border-b border-hairline bg-ivory" />
          {ROWS.map((width, i) => (
            <div
              key={i}
              className={`flex items-center gap-3 border-t border-row-line px-3 py-3.5 first:border-t-0 ${i % 2 ? "bg-zebra" : "bg-surface"}`}
            >
              <Bar className="h-3 w-4" />
              <Bar className="h-3.5" width={`${width}%`} />
              <Bar className="ml-auto h-6 w-14 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
