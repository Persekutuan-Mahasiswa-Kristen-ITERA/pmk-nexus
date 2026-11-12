import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { AppBar } from "./app-bar";
import { DesktopNav } from "./desktop-nav";
import type { NavData } from "./nav";

/**
 * Page frame shared by login, status screens and the signed-in area: app bar, then the content
 * column on the canvas. `column="narrow"` centres a 448 px column (Stitch content width); with
 * `column="page"` each page sets its own width (lists need more room on a desktop).
 */
export function AppFrame({
  children,
  footer,
  nav,
  column = "narrow",
}: {
  children: ReactNode;
  footer?: ReactNode;
  nav?: NavData;
  column?: "narrow" | "page";
}) {
  return (
    <div className="flex min-h-dvh flex-col">
      <AppBar nav={nav} />
      <div className="flex min-h-0 flex-1">
        {nav ? <DesktopNav nav={nav} /> : null}
        <main className="min-w-0 w-full flex-1 px-4 pt-7 pb-6 md:px-8 md:pt-10 xl:px-10">
          <div className={cn("mx-auto w-full", column === "narrow" && "max-w-md")}>{children}</div>
        </main>
      </div>
      {footer}
    </div>
  );
}

/** Narrow centred column for pages inside `column="page"` (Dashboard, status cards). */
export function NarrowColumn({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-md">{children}</div>;
}
