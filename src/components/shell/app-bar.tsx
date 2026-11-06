import type { NavData } from "./nav";
import { NavDrawer } from "./nav-drawer";

// The 1 px divider under the bar is Stitch elevation level 3 (approved design 2.4).
const barClass = "grid h-16 w-full grid-cols-[2.75rem_1fr_2.75rem] items-center gap-2 border-b border-walnut-line bg-walnut px-2"; // taste-skill-ignore

/**
 * NEXUS app bar (Stitch, D-014). With `nav` (signed-in member) the hamburger opens the side drawer;
 * without it (login, status screens) the bar is brand only, so no menu leads anywhere it should not.
 * The bell is left out on purpose: there are no notifications yet, so it would be a dead control (R-26).
 */
export function AppBar({ nav }: { nav?: NavData }) {
  return (
    <header className={barClass}>
      <div className="flex justify-start">{nav ? <NavDrawer nav={nav} /> : null}</div>
      <div className="flex items-center justify-center gap-2">
        {/* Crest slot: empty until the owner supplies the logo file (C12). Decorative. */}
        <span
          aria-hidden="true"
          className="size-7 shrink-0 rounded-full border border-gold-ring bg-surface-line"
        />
        <span className="font-heading text-headline-lg text-primary-foreground">PMK ITERA</span>
      </div>
      {/* Keeps the brand centred; the bell would sit here. */}
      <div aria-hidden="true" />
    </header>
  );
}
