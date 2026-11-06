// The 1 px divider under the bar is Stitch elevation level 3 (approved design 2.4).
const barClass = "flex h-16 w-full items-center justify-center gap-2 border-b border-walnut-line bg-walnut px-4"; // taste-skill-ignore

/**
 * NEXUS app bar, brand-only variant (docs/design/login.md 2.4).
 * Hamburger and bell are left out on purpose: their destinations depend on permissions and
 * do not exist yet, so they would be dead controls (R-24, R-26). The drawer adds them later.
 */
export function AppBar() {
  return (
    <header className={barClass}>
      {/* Crest slot: empty until the owner supplies the logo file (C12). Decorative. */}
      <span
        aria-hidden="true"
        className="size-7 shrink-0 rounded-full border border-gold-ring bg-surface-line"
      />
      <span className="font-heading text-headline-lg text-primary-foreground">PMK ITERA</span>
    </header>
  );
}
