"use client";

import { useRef, useState, type ReactNode, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { AlertMessage, type AlertIcon } from "@/components/ui/alert-message";
import { buttonClass, Spinner } from "@/components/ui/nx-button";
import { Sheet } from "@/components/ui/sheet";
import { minuteErrorMessage, MINUTE_COPY, type MinuteAction, type MinuteError, type MinuteResult } from "../types";
import { UI_COPY } from "./copy";

/** A message inside a dialog or form; `reload` adds "Muat ulang" (the data changed under the person). */
export type ActionError = { text: string; reload?: boolean; icon?: AlertIcon };

/** Errors that mean the screen shows old data: the only way forward is to load it again (R11). */
const RELOAD_CODES = new Set<MinuteError["code"]>(["state_changed", "not_found", "minute_voided", "closed_period", "no_active_period"]);

/** The contract's text for an error, with "Muat ulang" when the data changed. */
export function defaultActionError(error: MinuteError, action: MinuteAction): ActionError {
  return { text: minuteErrorMessage(error, action) ?? MINUTE_COPY.unavailable, reload: RELOAD_CODES.has(error.code) };
}

/** Back to login with the session-ended notice, returning to this page afterwards (auth-login F9). */
export function goToLogin(router: ReturnType<typeof useRouter>) {
  const next = `${window.location.pathname}${window.location.search}`;
  router.push(`/login?reason=session_ended&next=${encodeURIComponent(next)}`);
}

/**
 * Runs one Server Action for a dialog or a form: ignores a second press while busy, sends an ended
 * session to login, turns a thrown call into the network text and leaves every other refusal to
 * `onError` (return null when the caller marked a field itself).
 */
export function useMinuteAction() {
  const router = useRouter();
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ActionError | null>(null);

  async function run<T>(
    call: () => Promise<MinuteResult<T>>,
    handlers: { onOk: (data: T) => void; onError: (error: MinuteError) => ActionError | null },
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
      setError({ text: UI_COPY.network, icon: "wifi_off" });
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
          {UI_COPY.reload}
        </button>
      ) : null}
    </div>
  );
}

/**
 * Dialog for one named action (screens 5 and 6, "Tambah lampiran"): fields in the body; footer = error,
 * primary button (busy label with spinner) and the way back as a text button under it. The primary
 * button is never greyed: a refusal shows as a message.
 */
export function ActionSheet({
  open,
  onOpenChange,
  title,
  description,
  primaryLabel,
  cancelLabel,
  busy,
  error,
  onSubmit,
  initialFocusRef,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  primaryLabel: string;
  cancelLabel: string;
  busy: boolean;
  error: ActionError | null;
  onSubmit: () => void;
  initialFocusRef?: RefObject<HTMLElement | null>;
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
      footer={
        <>
          <ActionErrorBlock
            error={error}
            onReload={() => {
              onOpenChange(false);
              router.refresh();
            }}
          />
          <button
            type="button"
            onClick={onSubmit}
            aria-busy={busy || undefined}
            className={buttonClass("primary", busy ? "cursor-progress" : "nx-press")}
          >
            {busy ? <Spinner /> : null}
            {busy ? UI_COPY.saving : primaryLabel}
          </button>
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
