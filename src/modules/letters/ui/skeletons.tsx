import { SkeletonBar } from "@/components/ui/skeleton-bar";
import { ListColumn, NarrowPage } from "./letters-header";

// First-load shapes (design 3.4, 5.3, 6.4, 10.5, 11.2, 13.5): ivory bars at the real sizes with the
// loading sweep (D-023), and a caption for screen readers and sighted people alike.

function Caption({ text }: { text: string }) {
  return (
    <p role="status" className="text-body-sm text-ink-body">
      {text}
    </p>
  );
}

function HeaderBars() {
  // Same frame as the header card so nothing jumps when the page arrives.
  return (
    <div aria-hidden="true" className="flex flex-col gap-4">
      <div className="nx-header-card flex flex-col gap-3 rounded-xl border border-gold-tint-line p-5 shadow-elevation-1 md:p-7">
        <div className="h-8 w-[150px] rounded-full border border-gold-tint-line bg-surface" />
        <SkeletonBar className="h-8 w-[200px]" />
        <SkeletonBar className="h-4 w-[180px]" />
      </div>
      <SkeletonBar className="h-16 w-full rounded-xl" />
    </div>
  );
}

const WIDTHS = [72, 58, 80, 64, 70, 52];

/** Register list: six letter cards (number bar 150 x 14, two text bars, meta bar; 5.3). */
export function RegisterSkeleton() {
  return (
    <ListColumn wide>
      <HeaderBars />
      <div aria-hidden="true" className="flex flex-col gap-3">
        <SkeletonBar className="h-12 w-full rounded-lg" />
        <SkeletonBar className="h-12 w-full rounded-lg" />
      </div>
      <Caption text="Memuat surat..." />
      <div aria-hidden="true" className="flex flex-col gap-2.5">
        {WIDTHS.map((width, i) => (
          <div key={i} className="flex flex-col gap-2 rounded-xl border border-surface-line bg-surface p-4 shadow-elevation-1">
            <SkeletonBar className="h-3.5 w-[150px]" />
            <SkeletonBar className="h-3.5" width={`${width - 20}%`} />
            <SkeletonBar className="h-3.5" width={`${width}%`} />
            <SkeletonBar className="mt-1 h-3 w-[140px]" />
          </div>
        ))}
      </div>
    </ListColumn>
  );
}

/** Permohonan Saya and Antrean: request cards. */
export function RequestListSkeleton({ text }: { text: string }) {
  return (
    <ListColumn>
      <HeaderBars />
      <Caption text={text} />
      <div aria-hidden="true" className="flex flex-col gap-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex flex-col gap-2 rounded-xl border border-surface-line bg-surface p-4 shadow-elevation-1">
            <div className="flex justify-between gap-3">
              <SkeletonBar className="h-4 w-[55%]" />
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

/** Details, forms and settings: a title, an optional plate and three flat cards. */
export function DetailSkeleton({ text, plate = false }: { text: string; plate?: boolean }) {
  return (
    <NarrowPage>
      <div aria-hidden="true" className="flex flex-col gap-2">
        <SkeletonBar className="h-4 w-24" />
        <SkeletonBar className="h-7 w-[60%]" />
      </div>
      <Caption text={text} />
      {plate ? (
        <div aria-hidden="true" className="flex flex-col gap-2 rounded-xl border border-gold-tint-line bg-gold-tint p-4">
          <SkeletonBar className="h-3 w-20" />
          <SkeletonBar className="h-6 w-[210px]" />
        </div>
      ) : null}
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
