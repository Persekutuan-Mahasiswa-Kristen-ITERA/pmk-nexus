"use client";

import { forwardRef, useRef, useState, type ReactNode, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert } from "lucide-react";
import { AlertMessage, type AlertIcon } from "@/components/ui/alert-message";
import { buttonClass, Spinner } from "@/components/ui/nx-button";
import { Sheet } from "@/components/ui/sheet";
import { letterErrorMessage, type LetterAction, type LetterError, type LetterResult, type LetterType } from "../types";
import { COPY, fixCountText } from "./copy";

/** A message inside a dialog or form; `reload` adds "Muat ulang" (the data changed under the person). */
export type ActionError = { text: string; reload?: boolean; icon?: AlertIcon };

/** Errors that mean the screen shows old data: the only way forward is to load it again (design 3.4). */
const RELOAD_CODES = new Set<LetterError["code"]>([
  "state_changed",
  "not_found",
  "request_open",
  "year_not_current",
  "letter_voided",
  "closed_period",
  "number_not_taken",
]);

/** The contract's text for an error, with "Muat ulang" when the data changed. */
export function defaultActionError(error: LetterError, action: LetterAction, letterType?: LetterType): ActionError {
  return {
    text: letterErrorMessage(error, action, { letterType }) ?? COPY.unavailable,
    reload: RELOAD_CODES.has(error.code),
  };
}

/** Back to login with the session-ended notice, returning to this page afterwards (auth-login F9). */
export function goToLogin(router: ReturnType<typeof useRouter>) {
  const next = `${window.location.pathname}${window.location.search}`;
  router.push(`/login?reason=session_ended&next=${encodeURIComponent(next)}`);
}

/**
 * Runs one Server Action for a dialog or a form: ignores a second press while busy (one press, one
 * number), sends an ended session to login, turns a thrown call into the "Tidak bisa terhubung" text
 * and leaves every other refusal to `onError` (return null when the caller marked a field itself).
 */
export function useLetterAction() {
  const router = useRouter();
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ActionError | null>(null);

  async function run<T>(
    call: () => Promise<LetterResult<T>>,
    handlers: { onOk: (data: T) => void; onError: (error: LetterError) => ActionError | null },
  ): Promise<void> {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await call();
      if (result.ok) {
        handlers.onOk(result.data);
        return;
      }
      if (result.error.code === "unauthenticated") {
        goToLogin(router);
        return;
      }
      setError(handlers.onError(result.error));
    } catch {
      setError({ text: COPY.network, icon: "wifi_off" });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return { router, busy, error, setError, run, busyRef };
}

/** One error message above the buttons, with "Muat ulang" when the data changed. */
export function ActionErrorBlock({ error, onReload }: { error: ActionError | null; onReload: () => void }) {
  if (!error) return null;
  return (
    <div className="flex flex-col gap-2">
      <AlertMessage role="alert" tone="warning" icon={error.icon}>
        {error.text}
      </AlertMessage>
      {error.reload ? (
        <button type="button" onClick={onReload} className={buttonClass("outline")}>
          Muat ulang
        </button>
      ) : null}
    </div>
  );
}

/**
 * Dialog for one named action (design 8, 12.2; Inventory 3.3): fields in the body; footer = error,
 * primary button (busy label with spinner), and the cancel text button under it. The primary button
 * is never greyed: a refusal shows as a message (K8). `hidePrimary` drops it when the action is
 * blocked for good (the last issued file, 8.2).
 */
export function ActionSheet({
  open,
  onOpenChange,
  title,
  description,
  primaryLabel,
  busyLabel = "Menyimpan...",
  cancelLabel = "Batal",
  busy,
  error,
  hidePrimary = false,
  onSubmit,
  initialFocusRef,
  onCloseAutoFocus,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  primaryLabel: string;
  busyLabel?: string;
  cancelLabel?: string;
  busy: boolean;
  error: ActionError | null;
  hidePrimary?: boolean;
  onSubmit: () => void;
  initialFocusRef?: RefObject<HTMLElement | null>;
  onCloseAutoFocus?: (event: Event) => void;
  children?: ReactNode;
}) {
  const router = useRouter();
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      busy={busy}
      initialFocusRef={initialFocusRef}
      onCloseAutoFocus={onCloseAutoFocus}
      footer={
        <>
          <ActionErrorBlock
            error={error}
            onReload={() => {
              onOpenChange(false);
              router.refresh();
            }}
          />
          {hidePrimary ? null : (
            <button
              type="button"
              onClick={onSubmit}
              aria-busy={busy || undefined}
              className={buttonClass("primary", busy ? "cursor-progress" : undefined)}
            >
              {busy ? <Spinner /> : null}
              {busy ? busyLabel : primaryLabel}
            </button>
          )}
          <button
            type="button"
            aria-disabled={busy || undefined}
            onClick={() => !busy && onOpenChange(false)}
            className={buttonClass("text", "self-center")}
          >
            {cancelLabel}
          </button>
        </>
      }
    >
      {children ? <div className="flex flex-col gap-4">{children}</div> : null}
    </Sheet>
  );
}

/**
 * Top-of-form message (Inventory 3.4): either the list of fields to fix, each a link that moves focus
 * to the field, or one warning (server refused, network). Takes focus when it appears (role=alert).
 */
export const FormSummary = forwardRef<
  HTMLDivElement,
  { problems: { id: string; text: string }[]; message: ActionError | null; onReload?: () => void }
>(function FormSummary({ problems, message, onReload }, ref) {
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
      <div ref={ref} tabIndex={-1} className="flex flex-col gap-2">
        <AlertMessage role="alert" tone="warning" icon={message.icon}>
          {message.text}
        </AlertMessage>
        {message.reload && onReload ? (
          <button type="button" onClick={onReload} className={buttonClass("outline")}>
            Muat ulang
          </button>
        ) : null}
      </div>
    );
  }
  return null;
});

/** A fieldset drawn as a card, its legend as the card title (Inventory 3.4, design 7.8). */
export function FormCard({ legend, children, id }: { legend: ReactNode; children: ReactNode; id?: string }) {
  return (
    <fieldset id={id} className="flex min-w-0 flex-col gap-4 rounded-xl border border-surface-line bg-surface p-4 shadow-elevation-1">
      <legend className="float-left mb-0 w-full text-headline-sm text-ink">{legend}</legend>
      {children}
    </fieldset>
  );
}

/** "Buang perubahan?" before leaving a form with typed input (Inventory 3.4). */
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
