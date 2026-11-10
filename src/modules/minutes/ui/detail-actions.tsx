"use client";

import { useRef, useState } from "react";
import { Plus } from "lucide-react";
import { TextareaField } from "@/components/ui/form-fields";
import { buttonClass } from "@/components/ui/nx-button";
import {
  formatMinuteCopy,
  MINUTE_COPY,
  MINUTE_ERROR_COPY,
  MINUTE_ERROR_COPY_VARIANTS,
  MINUTE_LIMITS,
  minuteErrorMessage,
} from "../types";
import { ActionSheet, defaultActionError, useMinuteAction } from "./action-sheet";
import { UI_COPY } from "./copy";
import { EMPTY_FILES, FilePicker, type FileSummary } from "./file-picker";
import { minuteHref } from "./routes";
import { addMinuteFiles, voidMinute } from "./server-actions";

/** "Tambah lampiran" (F5): managers of the unit, an Aktif minute of the active period, room left. */
export function AddFilesButton({ minuteId, version, room }: { minuteId: string; version: number; room: number }) {
  const [open, setOpen] = useState(false);
  // A fresh picker each time the sheet opens (files chosen and closed without saving are not records).
  const [round, setRound] = useState(0);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setRound((n) => n + 1);
          setOpen(true);
        }}
        className={buttonClass("outline", "nx-press mt-3")}
      >
        <Plus aria-hidden="true" className="size-5" strokeWidth={2} />
        {MINUTE_COPY.detail.addFiles}
      </button>
      <AddFilesSheet key={round} open={open} onOpenChange={setOpen} minuteId={minuteId} version={version} room={room} />
    </>
  );
}

function AddFilesSheet({
  open,
  onOpenChange,
  minuteId,
  version,
  room,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  minuteId: string;
  version: number;
  room: number;
}) {
  const { router, busy, error, setError, run } = useMinuteAction();
  const [files, setFiles] = useState<FileSummary>(EMPTY_FILES);
  const [filesError, setFilesError] = useState<string | null>(null);

  function submit() {
    setFilesError(null);
    if (files.pending) {
      setError({ text: UI_COPY.fileStillBusy });
      return;
    }
    if (files.failed) {
      setError({ text: minuteErrorMessage({ code: "unavailable" }, "upload") ?? MINUTE_COPY.unavailable });
      return;
    }
    if (files.files.length === 0) {
      setFilesError(MINUTE_ERROR_COPY.file_required);
      document.getElementById("minute-add-files")?.focus();
      return;
    }
    void run(() => addMinuteFiles({ minuteId, version, files: files.files }), {
      onOk: () => {
        onOpenChange(false);
        router.replace(minuteHref(minuteId, "files_added"), { scroll: true });
        router.refresh();
      },
      onError: (e) => {
        if (e.code === "file_required") {
          setFilesError(MINUTE_ERROR_COPY.file_required);
          return null;
        }
        return defaultActionError(e, "addFiles");
      },
    });
  }

  return (
    <ActionSheet
      open={open}
      onOpenChange={onOpenChange}
      title={MINUTE_COPY.addFiles.title}
      description={formatMinuteCopy(MINUTE_COPY.addFiles.room, { n: room })}
      primaryLabel={MINUTE_COPY.addFiles.submit}
      cancelLabel={MINUTE_COPY.form.cancel}
      busy={busy}
      error={error}
      onSubmit={submit}
    >
      <FilePicker
        id="minute-add-files"
        max={room}
        disabled={busy}
        onChange={(summary) => {
          setFiles(summary);
          if (summary.files.length > 0) setFilesError(null);
        }}
        error={filesError}
      />
    </ActionSheet>
  );
}

/** "Batalkan notulensi" (spec 7 screen 5): reason required; the minute stays as Dibatalkan, never restored. */
export function VoidMinuteButton({ minuteId, version }: { minuteId: string; version: number }) {
  const V = MINUTE_COPY.voidDialog;
  const [open, setOpen] = useState(false);
  const { router, busy, error, setError, run } = useMinuteAction();
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);

  function submit() {
    if (reason.trim() === "") {
      setReasonError(MINUTE_ERROR_COPY_VARIANTS.reasonRequired.void);
      reasonRef.current?.focus();
      return;
    }
    void run(() => voidMinute({ minuteId, version, reason }), {
      onOk: () => {
        setOpen(false);
        router.replace(minuteHref(minuteId, "voided"), { scroll: true });
        router.refresh();
      },
      onError: (e) => {
        if (e.code === "reason_required" || e.code === "text_too_long") {
          setReasonError(minuteErrorMessage(e, "void"));
          reasonRef.current?.focus();
          return null;
        }
        return defaultActionError(e, "void");
      },
    });
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={buttonClass("outline", "nx-press")}>
        {MINUTE_COPY.detail.void}
      </button>
      <ActionSheet
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setError(null);
        }}
        title={V.title}
        description={V.body}
        primaryLabel={V.confirm}
        cancelLabel={V.back}
        busy={busy}
        error={error}
        onSubmit={submit}
        initialFocusRef={reasonRef}
      >
        <TextareaField
          ref={reasonRef}
          id="minute-void-reason"
          label={V.reason}
          value={reason}
          maxLength={MINUTE_LIMITS.reason}
          readOnly={busy}
          error={reasonError ?? undefined}
          onChange={(event) => {
            setReason(event.target.value);
            setReasonError(null);
          }}
        />
      </ActionSheet>
    </>
  );
}
