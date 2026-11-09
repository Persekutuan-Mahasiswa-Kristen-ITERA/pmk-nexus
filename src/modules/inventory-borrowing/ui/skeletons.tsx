import { ListColumn, NarrowPage } from "./inventory-header";
import { SkeletonBar } from "./states";

// First-load shapes (design 5.3, 6.4, 9.5, 10.5): ivory bars at the real sizes with a light sweep (D-023
// round 2), a caption in body brown for screen readers and sighted people alike.

function Caption({ text }: { text: string }) {
  return (
    <p role="status" className="text-body-sm text-ink-body">
      {text}
    </p>
  );
}

function HeaderBars() {
  // Same frame as the header card (D-023) so nothing jumps when the page arrives.
  return (
    <div aria-hidden="true" className="flex flex-col gap-4">
      <div className="nx-header-card flex flex-col gap-3 rounded-xl border border-gold-tint-line p-5 shadow-elevation-1">
        <div className="h-8 w-[150px] rounded-full border border-gold-tint-line bg-surface" />
        <SkeletonBar className="h-8 w-[220px]" />
        <SkeletonBar className="h-8 w-[160px]" />
      </div>
      <SkeletonBar className="h-16 w-full rounded-xl" />
    </div>
  );
}

const ROW_WIDTHS = [64, 48, 72, 56, 68, 44];

export function CatalogSkeleton() {
  return (
    <ListColumn>
      <HeaderBars />
      <div aria-hidden="true" className="flex flex-col gap-3">
        <SkeletonBar className="h-12 w-full rounded-lg" />
        <SkeletonBar className="h-12 w-full rounded-lg" />
      </div>
      <Caption text="Memuat barang..." />
      <div aria-hidden="true" className="flex flex-col gap-2.5 md:hidden">
        {ROW_WIDTHS.map((width, i) => (
          <div key={i} className="flex items-start gap-3 rounded-xl border border-surface-line bg-surface px-4 py-4 shadow-elevation-1">
            <SkeletonBar className="size-11 shrink-0 rounded-lg" />
            <div className="flex flex-1 flex-col gap-2 pt-1">
              <SkeletonBar className="h-4" width={`${width}%`} />
              <SkeletonBar className="h-3 w-[180px]" />
            </div>
            <SkeletonBar className="h-4 w-12" />
          </div>
        ))}
      </div>
      <div aria-hidden="true" className="hidden overflow-hidden rounded-xl border border-surface-line bg-surface shadow-elevation-1 md:block">
        <div className="h-9 border-b border-hairline bg-ivory" />
        {ROW_WIDTHS.map((width, i) => (
          <div
            key={i}
            className={`flex items-start gap-3 border-t border-row-line px-4 py-3.5 first:border-t-0 ${i % 2 ? "bg-zebra" : "bg-surface"}`}
          >
            <div className="flex flex-1 flex-col gap-2">
              <SkeletonBar className="h-3.5" width={`${width}%`} />
              <SkeletonBar className="h-3 w-[200px]" />
            </div>
            <SkeletonBar className="h-3.5 w-12" />
          </div>
        ))}
      </div>
    </ListColumn>
  );
}

export function RequestListSkeleton({ text = "Memuat pengajuan..." }: { text?: string }) {
  return (
    <ListColumn>
      <HeaderBars />
      <Caption text={text} />
      <div aria-hidden="true" className="flex flex-col gap-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex flex-col gap-2 rounded-xl border border-surface-line bg-surface p-4 shadow-elevation-1">
            <div className="flex justify-between">
              <SkeletonBar className="h-4 w-24" />
              <SkeletonBar className="h-6 w-20 rounded-full" />
            </div>
            <SkeletonBar className="h-3.5 w-[70%]" />
            <SkeletonBar className="h-3 w-[45%]" />
          </div>
        ))}
      </div>
    </ListColumn>
  );
}

/** Detail pages and the request form: a title and three flat cards. */
export function DetailSkeleton({ text }: { text: string }) {
  return (
    <NarrowPage>
      <div aria-hidden="true" className="flex flex-col gap-2">
        <SkeletonBar className="h-4 w-24" />
        <SkeletonBar className="h-7 w-[60%]" />
      </div>
      <Caption text={text} />
      {[0, 1, 2].map((i) => (
        <div key={i} aria-hidden="true" className="flex flex-col gap-2.5 rounded-xl border border-surface-line bg-surface p-4 shadow-elevation-1">
          <SkeletonBar className="h-4 w-28" />
          <SkeletonBar className="h-3.5 w-[80%]" />
          <SkeletonBar className="h-3.5 w-[55%]" />
        </div>
      ))}
    </NarrowPage>
  );
}
