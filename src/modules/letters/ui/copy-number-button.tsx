"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { COPY } from "./copy";

/**
 * "Salin nomor" (design 3.4, X9): copies the stored number text with the native clipboard. Fails
 * soft: when the browser refuses, the message says to select the number by hand. 44 px target.
 */
export function CopyNumberButton({ numberText }: { numberText: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function copy() {
    if (timer.current) clearTimeout(timer.current);
    try {
      if (!navigator.clipboard) throw new Error("no clipboard");
      await navigator.clipboard.writeText(numberText);
      setState("copied");
      // The check mark goes back to the copy icon after a while; the message stays readable until then.
      timer.current = setTimeout(() => setState("idle"), 4000);
    } catch {
      setState("failed");
    }
  }

  return (
    <div className="flex flex-col items-start">
      <button
        type="button"
        onClick={() => void copy()}
        className="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-label-lg text-walnut underline-offset-2 hover:bg-surface hover:underline"
      >
        {state === "copied" ? (
          <Check aria-hidden="true" className="size-[18px]" strokeWidth={2} />
        ) : (
          <Copy aria-hidden="true" className="size-[18px]" strokeWidth={2} />
        )}
        {COPY.copyNumber}
      </button>
      <p role="status" aria-live="polite" className="pb-1 text-body-sm text-ink-body empty:pb-0">
        {state === "copied" ? COPY.copied : state === "failed" ? COPY.copyFailed : ""}
      </p>
    </div>
  );
}
