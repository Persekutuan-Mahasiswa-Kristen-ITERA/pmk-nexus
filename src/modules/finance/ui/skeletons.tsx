import { SkeletonBar } from "@/components/ui/skeleton-bar";
import { UI_COPY } from "./copy";
import { ListColumn, NarrowPage } from "./states";

// First-load shapes: ivory bars at the real sizes with the loading sweep (D-023), and a caption that
// says what is loading, for screen readers and sighted people alike.

function Caption() {
  return (
    <p role="status" className="text-body-sm text-ink-body">
      {UI_COPY.loadingList}
    </p>
  );
}

const WIDTHS = [72, 58, 80, 64, 70, 52];

/** The list: the header card with the balance tile, the controls and six entry cards. */
export function ListSkeleton() {
  return (
    <ListColumn>
      <div aria-hidden="true" className="nx-header-card flex flex-col gap-3 rounded-xl border border-gold-tint-line p-5 shadow-elevation-1 md:p-7">
        <div className="h-8 w-[150px] rounded-full border border-gold-tint-line bg-surface" />
        <SkeletonBar className="h-8 w-[220px]" />
        <SkeletonBar className="h-4 w-[200px]" />
        <div className="mt-1 flex flex-col gap-2 md:max-w-xl">
          <div className="flex flex-col gap-2 rounded-lg border border-gold-tint-line bg-surface px-4 pt-3 pb-3.5">
            <SkeletonBar className="h-3 w-[30%]" />
            <SkeletonBar className="h-8 w-[60%]" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            {[0, 1].map((i) => (
              <div key={i} className="flex flex-col gap-2 rounded-lg border border-gold-tint-line bg-surface px-3 pt-2.5 pb-3">
                <SkeletonBar className="h-3 w-[70%]" />
                <SkeletonBar className="h-5 w-[80%]" />
              </div>
            ))}
          </div>
        </div>
      </div>
      <div aria-hidden="true" className="flex flex-col gap-2">
        <SkeletonBar className="h-12 w-full rounded-lg" />
        <SkeletonBar className="h-11 w-28 rounded-lg" />
      </div>
      <Caption />
      <div aria-hidden="true" className="flex flex-col gap-2.5">
        {WIDTHS.map((width, i) => (
          <div key={i} className="flex flex-col gap-2 rounded-xl border border-surface-line bg-surface p-4 shadow-elevation-1">
            <SkeletonBar className="h-3 w-[170px]" />
            <SkeletonBar className="h-4" width={`${width}%`} />
            <SkeletonBar className="h-3.5" width={`${width - 18}%`} />
          </div>
        ))}
      </div>
    </ListColumn>
  );
}

/** Detail: back link, title, the amount plate and three flat cards. */
export function DetailSkeleton() {
  return (
    <NarrowPage>
      <div aria-hidden="true" className="flex flex-col gap-2">
        <SkeletonBar className="h-4 w-32" />
        <SkeletonBar className="h-7 w-[60%]" />
      </div>
      <Caption />
      <div aria-hidden="true" className="flex flex-col gap-2 rounded-xl border border-gold-tint-line bg-gold-tint p-4">
        <SkeletonBar className="h-3 w-20" />
        <SkeletonBar className="h-6 w-[80%]" />
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} aria-hidden="true" className="flex flex-col gap-2.5 rounded-xl border border-surface-line bg-surface p-4 shadow-elevation-1">
          <SkeletonBar className="h-4 w-32" />
          <SkeletonBar className="h-3.5 w-[85%]" />
          <SkeletonBar className="h-3.5 w-[60%]" />
        </div>
      ))}
    </NarrowPage>
  );
}

/** The record and opening forms: title and the form cards with field-height bars. */
export function FormSkeleton() {
  return (
    <NarrowPage>
      <div aria-hidden="true" className="flex flex-col gap-2">
        <SkeletonBar className="h-4 w-32" />
        <SkeletonBar className="h-7 w-[55%]" />
        <SkeletonBar className="h-4 w-[65%]" />
      </div>
      <Caption />
      {[3, 2, 1].map((fields, i) => (
        <div key={i} aria-hidden="true" className="flex flex-col gap-3 rounded-xl border border-surface-line bg-surface p-4 shadow-elevation-1">
          <SkeletonBar className="h-4 w-36" />
          {[...Array(fields).keys()].map((j) => (
            <div key={j} className="flex flex-col gap-1.5">
              <SkeletonBar className="h-3 w-24" />
              <SkeletonBar className="h-12 w-full rounded-lg" />
            </div>
          ))}
        </div>
      ))}
    </NarrowPage>
  );
}
