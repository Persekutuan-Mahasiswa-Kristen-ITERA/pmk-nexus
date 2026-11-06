import type { ReactNode } from "react";
import { AppBar } from "./app-bar";

/**
 * Page frame shared by login, status screens and the signed-in area:
 * app bar, then one centred column (max 448 px, Stitch content width) on the canvas.
 */
export function AppFrame({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <AppBar />
      <main className="w-full flex-1 px-4 pt-7 pb-6 md:pt-16">
        <div className="mx-auto w-full max-w-md">{children}</div>
      </main>
      {footer}
    </div>
  );
}
