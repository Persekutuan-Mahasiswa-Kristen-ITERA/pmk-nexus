"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, FileText, Upload } from "lucide-react";
import { FieldError } from "@/components/ui/field-error";
import { buttonClass, Spinner } from "@/components/ui/nx-button";
import { cn } from "@/lib/utils";
import {
  formatMinuteCopy,
  MINUTE_COPY,
  MINUTE_FILE_MAX_BYTES,
  MINUTE_FILE_MAX_MB,
  MINUTE_FILE_MIME_TYPES,
  MINUTE_FILE_UPLOAD_FIELDS,
  MINUTE_IMAGE_RESIZE_LONG_SIDE_PX,
  MINUTE_LIMITS,
  MINUTE_ROUTES,
  minuteErrorMessage,
  sniffMinuteFileType,
  type MinuteError,
  type MinuteFileMimeType,
  type MinuteFileRefInput,
  type MinuteFileUploadResult,
} from "../types";
import { goToLogin } from "./action-sheet";
import { UI_COPY } from "./copy";
import { formatFileSize } from "./format";

/** JPEG quality steps tried until a resized photo fits 5 MiB (spec 4.4). */
const QUALITY_STEPS = [0.88, 0.8, 0.7, 0.6, 0.5];
const UPLOAD_TIMEOUT_MS = 90_000;

type Tile = {
  key: number;
  status: "resizing" | "uploading" | "done" | "failed";
  progress: number;
  name: string;
  mimeType: MinuteFileMimeType;
  sizeBytes: number;
  /** Object URL of an image (thumbnail); revoked when the tile goes. */
  preview: string | null;
  blob: Blob | null;
  ref: MinuteFileRefInput | null;
  error: string | null;
};

/** What the form needs: the uploaded files in the order chosen, and whether anything is busy or failed. */
export type FileSummary = { files: MinuteFileRefInput[]; pending: boolean; failed: boolean; count: number };

export const EMPTY_FILES: FileSummary = { files: [], pending: false, failed: false, count: 0 };

const F = MINUTE_COPY.form;

/**
 * The attachment picker of the record form and the "Tambah lampiran" sheet (Stitch 08 "Unggah Lampiran",
 * spec 4.4, N6 a): a dashed area "Ketuk untuk memilih berkas" opens the chooser (on a phone it also offers
 * the camera). PDF, JPG or PNG, 5 MB, at most `max` files. Photos larger than about 2000 px on the long
 * side are made smaller in the browser first; a PDF is never changed. Each file uploads as soon as it is
 * chosen (POST /api/minutes/files), so a weak connection shows before the save. A picked file shows its
 * name, size and "Hapus" (removes it from the form; files never attached to a minute are not records).
 */
export function FilePicker({
  id,
  max = MINUTE_LIMITS.filesPerMinute,
  onChange,
  error,
  disabled = false,
}: {
  /** Id of the dashed button, so a form can move focus there. */
  id: string;
  /** Room left (3, or fewer in "Tambah lampiran"). */
  max?: number;
  onChange: (summary: FileSummary) => void;
  error?: string | null;
  disabled?: boolean;
}) {
  const router = useRouter();
  const chooserRef = useRef<HTMLInputElement>(null);
  const nextKey = useRef(1);
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [pickError, setPickError] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");

  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });
  useEffect(() => {
    onChangeRef.current({
      files: tiles.flatMap((t) => (t.status === "done" && t.ref ? [t.ref] : [])),
      pending: tiles.some((t) => t.status === "resizing" || t.status === "uploading"),
      failed: tiles.some((t) => t.status === "failed"),
      count: tiles.length,
    });
  }, [tiles]);

  const tilesRef = useRef(tiles);
  useEffect(() => {
    tilesRef.current = tiles;
  });
  useEffect(
    () => () => {
      for (const t of tilesRef.current) if (t.preview) URL.revokeObjectURL(t.preview);
    },
    [],
  );

  function patch(key: number, next: Partial<Tile>) {
    setTiles((prev) => prev.map((t) => (t.key === key ? { ...t, ...next } : t)));
  }

  function numberOf(key: number): number {
    return tilesRef.current.findIndex((t) => t.key === key) + 1;
  }

  async function send(key: number, blob: Blob, name: string, mimeType: MinuteFileMimeType) {
    patch(key, { status: "uploading", progress: 0, error: null });
    const result = await uploadFile(blob, name, (progress) => patch(key, { progress }));
    if (result.kind === "ok") {
      patch(key, {
        status: "done",
        progress: 100,
        name: result.data.name,
        sizeBytes: result.data.sizeBytes,
        ref: { path: result.data.path, name: result.data.name },
      });
      setAnnounce(`Berkas ${numberOf(key)} ${UI_COPY.uploaded.toLowerCase()}`);
      return;
    }
    if (result.kind === "error" && result.error.code === "unauthenticated") {
      goToLogin(router);
      return;
    }
    const text = result.kind === "network" ? UI_COPY.network : (minuteErrorMessage(result.error, "upload") ?? MINUTE_COPY.unavailable);
    patch(key, { status: "failed", error: text, mimeType });
    setAnnounce(text);
  }

  async function add(file: File) {
    const type = await realType(file);
    if (type === null) {
      setPickError(MINUTE_COPY_INVALID_FILE);
      return;
    }
    if (type === "application/pdf" && file.size > MINUTE_FILE_MAX_BYTES) {
      setPickError(MINUTE_COPY_TOO_LARGE);
      return;
    }
    const key = nextKey.current++;
    const isImage = type !== "application/pdf";
    setTiles((prev) => [
      ...prev,
      {
        key,
        status: isImage ? "resizing" : "uploading",
        progress: 0,
        name: file.name,
        mimeType: type,
        sizeBytes: file.size,
        preview: null,
        blob: null,
        ref: null,
        error: null,
      },
    ]);

    let blob: Blob = file;
    let name = file.name;
    let mimeType: MinuteFileMimeType = type;
    if (isImage) {
      try {
        const resized = await shrinkImage(file, type);
        blob = resized.blob;
        mimeType = resized.type;
        if (resized.type !== type) name = renameTo(file.name, "jpg");
      } catch (error) {
        setTiles((prev) => prev.filter((t) => t.key !== key));
        setPickError(error instanceof TooLargeError ? MINUTE_COPY_TOO_LARGE : UI_COPY.fileUnreadable);
        return;
      }
      patch(key, { preview: URL.createObjectURL(blob), sizeBytes: blob.size, name, mimeType });
    }
    patch(key, { blob });
    await send(key, blob, name, mimeType);
  }

  function onPick(files: FileList | null) {
    setPickError(null);
    if (!files) return;
    const room = max - tilesRef.current.length;
    const picked = [...files];
    if (picked.length > room) setPickError(MINUTE_COPY_FILE_COUNT);
    for (const file of picked.slice(0, Math.max(0, room))) void add(file);
  }

  function remove(tile: Tile) {
    if (tile.preview) URL.revokeObjectURL(tile.preview);
    setTiles((prev) => prev.filter((t) => t.key !== tile.key));
    setPickError(null);
  }

  const full = tiles.length >= max;
  const errorId = `${id}-error`;
  const helpId = `${id}-help`;

  return (
    <div className="flex flex-col gap-3">
      {full ? (
        <p id={helpId} className="text-body-sm text-ink-body">
          {MINUTE_COPY_FILE_COUNT}
        </p>
      ) : (
        <button
          id={id}
          type="button"
          disabled={disabled}
          aria-describedby={error ? errorId : undefined}
          onClick={() => chooserRef.current?.click()}
          className={cn(
            "group flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-5 text-center transition-colors duration-150 motion-reduce:transition-none",
            error ? "border-danger bg-danger-soft/40" : "border-field-line bg-field hover:border-walnut hover:bg-ivory/60",
            "disabled:cursor-not-allowed",
          )}
        >
          <span
            aria-hidden="true"
            className="inline-flex size-12 items-center justify-center rounded-full bg-ivory text-walnut transition-transform duration-150 group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100"
          >
            <Upload className="size-6" strokeWidth={2} />
          </span>
          <span className="text-label-lg text-walnut">{F.filePicker}</span>
          <span id={helpId} className="text-body-sm text-ink-body">
            {max < MINUTE_LIMITS.filesPerMinute ? formatMinuteCopy(MINUTE_COPY.addFiles.room, { n: max }) : F.fileHelp}
          </span>
        </button>
      )}
      <input
        ref={chooserRef}
        type="file"
        accept={MINUTE_FILE_MIME_TYPES.join(",")}
        multiple
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
        onChange={(event) => {
          onPick(event.target.files);
          event.target.value = "";
        }}
      />

      {pickError ? (
        <p role="alert" className="text-body-sm text-danger">
          {pickError}
        </p>
      ) : null}

      {tiles.length > 0 ? (
        <ul className="flex flex-col divide-y divide-row-line">
          {tiles.map((tile, index) => (
            <li key={tile.key} role="group" aria-label={`Berkas ${index + 1}`} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
              <FileThumb tile={tile} index={index} />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <p className="text-body-md font-semibold break-words text-ink">{tile.name}</p>
                <TileStatus tile={tile} />
                <div className="-ml-2 flex flex-wrap gap-x-1">
                  {tile.status === "failed" && tile.blob ? (
                    <button
                      type="button"
                      aria-label={`${MINUTE_COPY.dashboard.retry} berkas ${index + 1}`}
                      onClick={() => tile.blob && void send(tile.key, tile.blob, tile.name, tile.mimeType)}
                      className={buttonClass("text")}
                    >
                      {MINUTE_COPY.dashboard.retry}
                    </button>
                  ) : null}
                  {tile.status === "done" || tile.status === "failed" ? (
                    <button
                      type="button"
                      aria-label={`${F.fileRemove} berkas ${index + 1}`}
                      onClick={() => remove(tile)}
                      className={buttonClass("text")}
                    >
                      {F.fileRemove}
                    </button>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      <p role="status" aria-live="polite" className="sr-only">
        {announce}
      </p>
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
    </div>
  );
}

const MINUTE_COPY_INVALID_FILE = minuteErrorMessage({ code: "invalid_file", field: "file", ref: null }, "upload") ?? MINUTE_COPY.unavailable;
const MINUTE_COPY_TOO_LARGE =
  minuteErrorMessage({ code: "file_too_large", field: "file", ref: null, maxMb: MINUTE_FILE_MAX_MB }, "upload") ?? MINUTE_COPY.unavailable;
const MINUTE_COPY_FILE_COUNT =
  minuteErrorMessage({ code: "file_count", field: "files", count: MINUTE_LIMITS.filesPerMinute }, "upload") ?? MINUTE_COPY.unavailable;

/** 56 px tile: a thumbnail for an image, a document mark with "PDF" for a PDF. */
function FileThumb({ tile, index }: { tile: Tile; index: number }) {
  return (
    <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-gold-tint-line bg-gold-tint">
      {tile.preview ? (
        // eslint-disable-next-line @next/next/no-img-element -- a local object URL, not an optimisable asset
        <img src={tile.preview} alt={`Pratinjau berkas ${index + 1}`} className="size-full object-cover" />
      ) : tile.mimeType === "application/pdf" ? (
        <span aria-hidden="true" className="flex flex-col items-center gap-0.5 text-walnut">
          <FileText className="size-5" strokeWidth={1.75} />
          <span className="text-label-sm leading-none font-bold">PDF</span>
        </span>
      ) : null}
    </div>
  );
}

function TileStatus({ tile }: { tile: Tile }) {
  const size = formatFileSize(tile.sizeBytes);
  if (tile.status === "resizing") {
    return (
      <p className="flex items-center gap-1.5 text-body-sm text-ink-body">
        <Spinner />
        {UI_COPY.resizing}
      </p>
    );
  }
  if (tile.status === "uploading") {
    return (
      <div className="flex flex-col gap-1">
        <p className="text-body-sm text-ink-body tabular-nums">{formatMinuteCopy(UI_COPY.uploading, { n: tile.progress })}</p>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={tile.progress}
          aria-label={`Unggahan ${tile.name}`}
          className="h-1.5 w-full overflow-hidden rounded-sm bg-ivory"
        >
          <div className="h-full bg-walnut transition-[width] duration-150 motion-reduce:transition-none" style={{ width: `${tile.progress}%` }} />
        </div>
      </div>
    );
  }
  if (tile.status === "done") {
    return (
      <p className="flex flex-wrap items-center gap-x-1.5 text-body-sm text-ink-body tabular-nums">
        {size ? <span>{size}</span> : null}
        {size ? <span aria-hidden="true">·</span> : null}
        <span className="inline-flex items-center gap-1 text-success">
          {UI_COPY.uploaded}
          <CircleCheck aria-hidden="true" className="size-4" strokeWidth={2} />
        </span>
      </p>
    );
  }
  return <p className="text-body-sm text-danger">{tile.error ?? MINUTE_COPY.unavailable}</p>;
}

function renameTo(name: string, ext: string): string {
  const dot = name.lastIndexOf(".");
  return `${dot > 0 ? name.slice(0, dot) : name}.${ext}`;
}

/** The real type from the first bytes, so a renamed file is refused before any upload (MN-17). */
async function realType(file: File): Promise<MinuteFileMimeType | null> {
  try {
    const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
    return sniffMinuteFileType(head);
  } catch {
    return null;
  }
}

class TooLargeError extends Error {}

/**
 * Keeps a small image as it is. A large one (long side over about 2000 px, or over 5 MB) is drawn at most
 * 2000 px on its long side as JPEG, quality lowered in steps until it fits, so handwriting on a photographed
 * page stays readable.
 */
async function shrinkImage(file: File, type: MinuteFileMimeType): Promise<{ blob: Blob; type: MinuteFileMimeType }> {
  const image = await decode(file);
  const longSide = Math.max(image.width, image.height);
  if (longSide <= MINUTE_IMAGE_RESIZE_LONG_SIDE_PX && file.size <= MINUTE_FILE_MAX_BYTES) {
    image.close();
    return { blob: file, type };
  }
  const scale = Math.min(1, MINUTE_IMAGE_RESIZE_LONG_SIDE_PX / longSide);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext("2d");
  if (!context) {
    image.close();
    throw new Error("no canvas");
  }
  // A white ground, so a transparent PNG does not turn black as a JPEG.
  context.fillStyle = "white";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image.source, 0, 0, canvas.width, canvas.height);
  image.close();
  for (const quality of QUALITY_STEPS) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (blob && blob.size <= MINUTE_FILE_MAX_BYTES) return { blob, type: "image/jpeg" };
  }
  throw new TooLargeError();
}

type Decoded = { source: CanvasImageSource; width: number; height: number; close: () => void };

/** createImageBitmap honours the camera's rotation; an <img> is the fallback for older browsers. */
async function decode(file: File): Promise<Decoded> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch {
      // Fall through to the <img> path.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

type UploadOutcome = { kind: "ok"; data: MinuteFileUploadResult } | { kind: "error"; error: MinuteError } | { kind: "network" };

/** POST multipart to the upload route with progress (fetch has no upload progress). */
function uploadFile(blob: Blob, name: string, onProgress: (percent: number) => void): Promise<UploadOutcome> {
  return new Promise((resolve) => {
    const form = new FormData();
    form.append(MINUTE_FILE_UPLOAD_FIELDS.file, blob, name);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", MINUTE_ROUTES.fileUpload);
    xhr.timeout = UPLOAD_TIMEOUT_MS;
    xhr.responseType = "text";
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.min(99, Math.round((event.loaded / event.total) * 100)));
    };
    xhr.onload = () => {
      const body = parse(xhr.responseText);
      const ok = body as MinuteFileUploadResult | null;
      if (xhr.status === 200 && ok && typeof ok.path === "string" && typeof ok.name === "string") {
        resolve({ kind: "ok", data: ok });
        return;
      }
      const error = (body as { error?: MinuteError } | null)?.error;
      if (error && typeof error.code === "string") resolve({ kind: "error", error });
      else if (xhr.status === 401) resolve({ kind: "error", error: { code: "unauthenticated" } });
      else resolve({ kind: "error", error: { code: "unavailable" } });
    };
    xhr.onerror = () => resolve({ kind: "network" });
    xhr.ontimeout = () => resolve({ kind: "network" });
    xhr.send(form);
  });
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
