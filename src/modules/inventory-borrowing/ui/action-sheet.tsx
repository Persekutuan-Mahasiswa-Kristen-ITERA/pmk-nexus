"use client";

import { useRef, useState, type ReactNode, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { AlertMessage, type AlertIcon } from "@/components/ui/alert-message";
import { buttonClass, Spinner } from "@/components/ui/nx-button";
import { Sheet } from "@/components/ui/sheet";
import { inventoryErrorMessage, type InventoryAction, type InventoryError, type InventoryResult } from "../types";
import { COPY } from "./copy";

/** A message inside a dialog or form; `reload` adds "Muat ulang" (data changed under the person). */
export type ActionError = { text: string; reload?: boolean; icon?: AlertIcon };

/** Errors that mean the screen shows old data: the only way forward is to load it again. */
const RELOAD_CODES = new Set(["state_changed", "not_found", "invalid_period", "stock_mismatch"]);

/** The contract's text for an error, with "Muat ulang" when the data changed (design 3.6). */
export function defaultActionError(error: InventoryError, action: InventoryAction, formatDate?: (date: string) => string): ActionError {
  return {
    text: inventoryErrorMessage(error, action, { formatDate }) ?? COPY.unavailable,
    reload: RELOAD_CODES.has(error.code),
  };
}

/** Back to login with the session-ended notice, returning to this page afterwards (auth-login F9). */
export function goToLogin(router: ReturnType<typeof useRouter>) {
  const next = `${window.location.pathname}${window.location.search}`;
  router.push(`/login?reason=session_ended&next=${encodeURIComponent(next)}`);
}

/**
 * Runs one Server Action for a dialog or a form: ignores a second press while busy, sends an ended
 * session to login, turns a network failure into the "Tidak bisa terhubung" text, and leaves every
 * other refusal to `onError` (return null when the caller marked a field itself).
 */
export function useInventoryAction() {
  const router = useRouter();
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ActionError | null>(null);

  async function run<T>(
    call: () => Promise<InventoryResult<T>>,
    handlers: { onOk: (data: T) => void; onError: (error: InventoryError) => ActionError | null },
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

  return { router, busy, error, setError, run };
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
 * Dialog for one named action (design 3.3): fields in the body; footer = error, primary button (busy
 * label with spinner), and the cancel text button under it. The primary button is never greyed: a
 * refusal shows as a message (K8). `hidePrimary` drops it when the action is blocked for good.
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

/** Small notice that a staff save went through (role=status), shown at the top of a screen. */
export function SavedNotice({ text }: { text: string | null }) {
  return (
    <div role="status" aria-live="polite" className="empty:hidden">
      {text ? (
        <AlertMessage tone="success">{text}</AlertMessage>
      ) : null}
    </div>
  );
}
