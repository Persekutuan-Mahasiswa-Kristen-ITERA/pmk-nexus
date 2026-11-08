"use client";

import { forwardRef, type ReactNode } from "react";
import { CircleAlert } from "lucide-react";
import { AlertMessage, type AlertIcon } from "@/components/ui/alert-message";
import { buttonClass } from "@/components/ui/nx-button";
import { Sheet } from "@/components/ui/sheet";
import { fixCountText, COPY } from "./copy";

/**
 * Top-of-form message (design 3.4): either the list of fields to fix, each a link that moves focus to
 * the field, or one warning (server refused, network). Takes focus when it appears (role=alert).
 */
export const FormSummary = forwardRef<
  HTMLDivElement,
  { problems: { id: string; text: string }[]; message: { text: string; icon?: AlertIcon } | null }
>(function FormSummary({ problems, message }, ref) {
  if (problems.length > 0) {
    return (
      <div ref={ref} tabIndex={-1} role="alert" className="flex items-start gap-2 rounded-lg bg-danger-soft p-3 text-danger">
        <CircleAlert aria-hidden="true" className="size-5 shrink-0" strokeWidth={2} />
        <div className="min-w-0 text-body-md">
          <p>{fixCountText(problems.length)}</p>
          <ul className="mt-1 flex flex-col">
            {problems.map((problem) => (
              <li key={problem.id}>
                <a
                  href={`#${problem.id}`}
                  onClick={(event) => {
                    event.preventDefault();
                    const target = document.getElementById(problem.id);
                    target?.scrollIntoView({ block: "center" });
                    target?.focus();
                  }}
                  className="inline-flex min-h-11 items-center break-words underline underline-offset-2"
                >
                  {problem.text}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }
  if (message) {
    return (
      <div ref={ref} tabIndex={-1}>
        <AlertMessage role="alert" tone="warning" icon={message.icon}>
          {message.text}
        </AlertMessage>
      </div>
    );
  }
  return null;
});

/** A fieldset drawn as a card, its legend as the card title (design 3.4, 9.6). */
export function FormCard({ legend, children, id }: { legend: ReactNode; children: ReactNode; id?: string }) {
  return (
    <fieldset id={id} className="flex min-w-0 flex-col gap-3 rounded-xl border border-surface-line bg-surface p-4 shadow-elevation-1">
      <legend className="float-left mb-1 w-full text-headline-sm text-ink">{legend}</legend>
      {children}
    </fieldset>
  );
}

/** "Buang perubahan?" (design 3.4) before leaving a form with typed input. */
export function DiscardSheet({ open, onOpenChange, onDiscard }: { open: boolean; onOpenChange: (open: boolean) => void; onDiscard: () => void }) {
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={COPY.discardTitle}
      footer={
        <>
          <button type="button" onClick={onDiscard} className={buttonClass("primary")}>
            Buang
          </button>
          <button type="button" onClick={() => onOpenChange(false)} className={buttonClass("text", "self-center")}>
            Lanjut mengisi
          </button>
        </>
      }
    />
  );
}
