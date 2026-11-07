"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { cancelRequest } from "../server/borrowing-actions";
import { AlertMessage } from "@/components/ui/alert-message";
import { TextareaField } from "@/components/ui/form-fields";
import { buttonClass, Spinner } from "@/components/ui/nx-button";
import { Sheet } from "@/components/ui/sheet";
import { INVENTORY_LIMITS, inventoryErrorMessage } from "../types";
import { COPY, FIELD_ERRORS, tooLongText } from "./copy";
import { requestHref } from "./routes";

/**
 * "Batalkan pengajuan" and its dialog (design 10.4). Shown only when the detail's actions.canCancel
 * says so; the server action and the database decide again. The reason is optional while Diajukan and
 * required once Disetujui (actions.cancelReasonRequired). The dialog keeps what was typed on an error.
 */
export function CancelRequest({
  requestId,
  reference,
  version,
  reasonRequired,
}: {
  requestId: string;
  reference: string;
  version: number;
  reasonRequired: boolean;
}) {
  const router = useRouter();
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const busyRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<{ text: string; reload: boolean } | null>(null);

  async function submit() {
    if (busyRef.current) return;
    if (reasonRequired && reason.trim() === "") {
      setFieldError(FIELD_ERRORS.cancelReasonMissing);
      reasonRef.current?.focus();
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setFieldError(null);
    try {
      const result = await cancelRequest({ requestId, version, reason });
      if (result.ok) {
        setOpen(false);
        router.replace(requestHref(reference, "cancelled"), { scroll: true });
        router.refresh();
        return;
      }
      const e = result.error;
      if (e.code === "unauthenticated") {
        router.push(`/login?reason=session_ended&next=${encodeURIComponent(requestHref(reference))}`);
        return;
      }
      if (e.code === "reason_required" || e.code === "text_required") {
        setFieldError(FIELD_ERRORS.cancelReasonMissing);
        reasonRef.current?.focus();
      } else if (e.code === "text_too_long") {
        setFieldError(tooLongText("Alasan", INVENTORY_LIMITS.note));
        reasonRef.current?.focus();
      } else {
        setError({ text: inventoryErrorMessage(e, "cancel") ?? COPY.unavailable, reload: e.code === "state_changed" });
      }
    } catch {
      setError({ text: COPY.network, reload: false });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={buttonClass("outline")}>
        Batalkan pengajuan
      </button>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title="Batalkan pengajuan?"
        description={COPY.cancelBody}
        busy={busy}
        initialFocusRef={reasonRef}
        footer={
          <>
            {error ? (
              <div className="flex flex-col gap-2">
                <AlertMessage role="alert" tone="warning">
                  {error.text}
                </AlertMessage>
                {error.reload ? (
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      router.refresh();
                    }}
                    className={buttonClass("outline")}
                  >
                    Muat ulang
                  </button>
                ) : null}
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => void submit()}
              aria-busy={busy || undefined}
              className={buttonClass("primary", busy ? "cursor-progress" : undefined)}
            >
              {busy ? <Spinner /> : null}
              {busy ? "Membatalkan..." : "Batalkan pengajuan"}
            </button>
            <button
              type="button"
              aria-disabled={busy || undefined}
              onClick={() => !busy && setOpen(false)}
              className={buttonClass("text", "self-center")}
            >
              Kembali
            </button>
          </>
        }
      >
        <TextareaField
          ref={reasonRef}
          id="cancel-reason"
          label={reasonRequired ? "Alasan (wajib)" : "Alasan (boleh kosong)"}
          maxLength={INVENTORY_LIMITS.note}
          value={reason}
          readOnly={busy}
          onChange={(event) => setReason(event.target.value)}
          error={fieldError ?? undefined}
        />
      </Sheet>
    </>
  );
}
