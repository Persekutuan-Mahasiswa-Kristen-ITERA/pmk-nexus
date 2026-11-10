"use client";

import { useRef, useState } from "react";
import { Plus } from "lucide-react";
import { TextareaField } from "@/components/ui/form-fields";
import { buttonClass } from "@/components/ui/nx-button";
import { LETTER_LIMITS, letterErrorMessage, type LetterDetail } from "../types";
import { ActionSheet, defaultActionError, useLetterAction } from "./action-sheet";
import { COPY, filesRoomText } from "./copy";
import { EMPTY_FILES, FilePicker, type FileSummary } from "./file-picker";
import { letterHref } from "./routes";
import { addLetterFiles, voidLetter } from "./server-actions";

/** "+ Tambah berkas" on the Berkas card (design 6.3, 8.3): managers, Aktif letter, fewer than 3 files. */
export function AddFilesButton({ letterId, version, room }: { letterId: string; version: number; room: number }) {
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
        className={buttonClass("outline", "mt-3")}
      >
        <Plus aria-hidden="true" className="size-5" strokeWidth={2} />
        Tambah berkas
      </button>
      <AddFilesDialog key={round} open={open} onOpenChange={setOpen} letterId={letterId} version={version} room={room} />
    </>
  );
}

function AddFilesDialog({
  open,
  onOpenChange,
  letterId,
  version,
  room,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  letterId: string;
  version: number;
  room: number;
}) {
  const { router, busy, error, setError, run } = useLetterAction();
  const [files, setFiles] = useState<FileSummary>(EMPTY_FILES);
  const [filesError, setFilesError] = useState<string | null>(null);

  function submit() {
    setFilesError(null);
    if (files.pending) {
      setError({ text: COPY.fileStillBusy });
      return;
    }
    if (files.failed) {
      setError({ text: COPY.fileFailed });
      return;
    }
    if (files.files.length === 0) {
      setFilesError(COPY.fileRequired);
      document.getElementById("add-files")?.focus();
      return;
    }
    void run(() => addLetterFiles({ letterId, version, files: files.files }), {
      onOk: () => {
        onOpenChange(false);
        router.replace(letterHref(letterId, "files_added"), { scroll: true });
        router.refresh();
      },
      onError: (e) => {
        if (e.code === "file_required") {
          setFilesError(COPY.fileRequired);
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
      title={COPY.addFilesTitle}
      description={filesRoomText(room)}
      primaryLabel="Simpan berkas"
      busy={busy}
      error={error}
      onSubmit={submit}
    >
      <FilePicker
        id="add-files"
        label="Berkas"
        max={room}
        action="uploadLetterFile"
        onChange={(summary) => {
          setFiles(summary);
          if (summary.files.length > 0) setFilesError(null);
        }}
        error={filesError}
      />
    </ActionSheet>
  );
}

/** "Batalkan nomor" (design 8.1): reason required; the number stays in the register as Dibatalkan. */
export function VoidLetterButton({ detail }: { detail: LetterDetail }) {
  const [open, setOpen] = useState(false);
  const { router, busy, error, setError, run } = useLetterAction();
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);

  function submit() {
    if (reason.trim() === "") {
      setReasonError(COPY.voidMissing);
      reasonRef.current?.focus();
      return;
    }
    void run(() => voidLetter({ letterId: detail.letterId, version: detail.version, reason }), {
      onOk: () => {
        setOpen(false);
        router.replace(letterHref(detail.letterId, "voided"), { scroll: true });
        router.refresh();
      },
      onError: (e) => {
        if (e.code === "reason_required") {
          setReasonError(COPY.voidMissing);
          reasonRef.current?.focus();
          return null;
        }
        if (e.code === "text_too_long") {
          setReasonError(letterErrorMessage(e, "void"));
          reasonRef.current?.focus();
          return null;
        }
        return defaultActionError(e, "void");
      },
    });
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={buttonClass("outline")}>
        Batalkan nomor
      </button>
      <ActionSheet
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setError(null);
        }}
        title={COPY.voidTitle}
        description={
          <>
            Nomor <strong className="font-bold text-ink tabular-nums">{detail.numberText}</strong> tetap tercatat di register sebagai
            Dibatalkan dan tidak akan dipakai lagi. Suratnya tidak bisa dipulihkan. Kalau suratnya masih perlu, catat surat baru dengan
            nomor baru.
          </>
        }
        primaryLabel="Batalkan nomor"
        cancelLabel="Kembali"
        busy={busy}
        error={error}
        onSubmit={submit}
        initialFocusRef={reasonRef}
      >
        {detail.fromRequest ? (
          <p className="text-body-md text-ink-body">
            {detail.request
              ? `Surat ini diterbitkan dari permohonan ${detail.request.subject}. `
              : "Surat ini diterbitkan dari permohonan. "}
            Permohonannya tetap berstatus Diterbitkan dan pemohon akan melihat tanda Nomor dibatalkan.
          </p>
        ) : null}
        <TextareaField
          ref={reasonRef}
          id="void-reason"
          label="Alasan (wajib)"
          value={reason}
          maxLength={LETTER_LIMITS.reason}
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
