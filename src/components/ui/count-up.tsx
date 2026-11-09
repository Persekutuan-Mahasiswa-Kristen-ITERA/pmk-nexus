"use client";

import { useEffect, useRef } from "react";

const COUNT_MS = 600;
/** How far into its entrance a card may be for the count to start (the card is still near opacity 0). */
const FRESH_MS = 60;

function format(value: number): string {
  return value.toLocaleString("id-ID");
}

/**
 * A figure that counts up from 0 while its card is still arriving (D-023 round 2, like PI-CORE).
 * The server already renders the final value, so there is no "0" in the HTML and no layout shift
 * (tabular figures). The count runs only when:
 * - motion is allowed (prefers-reduced-motion: reduce shows the final value at once),
 * - the entrance animation around the figure has only just started (client navigation, a card that
 *   streams in after the script). On a first page load the script usually arrives after the card is
 *   on screen; then the number simply stays, so a figure never jumps back to 0 in front of the reader.
 * Screen readers get the final value from the sr-only copy; the counting digits are aria-hidden.
 */
export function CountUp({ value, className, announce = true }: { value: number; className?: string; announce?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || value < 10) return; // small numbers have nothing to count
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const arriving =
      typeof document.getAnimations === "function" &&
      document.getAnimations().some((animation) => {
        const target = animation.effect instanceof KeyframeEffect ? animation.effect.target : null;
        // Only at the very start of the entrance (the card is still transparent). Later, the reader may
        // already see the final number, and counting from 0 would look like the value dropped.
        const started = Number(animation.currentTime ?? 0);
        return animation.playState === "running" && started < FRESH_MS && target instanceof Element && target.contains(el);
      });
    if (!arriving) return;

    const start = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / COUNT_MS);
      const eased = 1 - (1 - progress) * (1 - progress); // ease-out quad
      el.textContent = format(Math.round(value * eased));
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    el.textContent = format(0);
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
      el.textContent = format(value);
    };
  }, [value]);

  return (
    <>
      {/* key: React must not reuse this text node after the effect has rewritten it. */}
      <span key={value} ref={ref} aria-hidden={announce ? true : undefined} className={className}>
        {format(value)}
      </span>
      {announce ? <span className="sr-only">{format(value)}</span> : null}
    </>
  );
}
