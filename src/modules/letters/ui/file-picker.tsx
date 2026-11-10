"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Camera, CircleCheck, FileText, FolderOpen } from "lucide-react";
import { FieldError } from "@/components/ui/field-error";
import { buttonClass, Spinner } from "@/components/ui/nx-button";
import {
  LETTER_FILE_MAX_BYTES,
  LETTER_FILE_MAX_MB,
  LETTER_FILE_MIME_TYPES,
  LETTER_FILE_UPLOAD_FIELDS,
  LETTER_FILE_UPLOAD_ROUTE,
  LETTER_IMAGE_RESIZE_LONG_SIDE_PX,
  LETTER_LIMITS,
  letterErrorMessage,
  sniffLetterFileType,
  type LetterError,
  type LetterFileMimeType,
  type LetterFileRefInput,
  type LetterFileUploadResult,
} from "../types";
import { goToLogin } from "./action-sheet";
import { COPY } from "./copy";
import { formatFileSize } from "./format";

/** JPEG quality steps tried until a resized photo fits 5 MiB (design 3.3, G14). */
const QUALITY_STEPS = [0.88, 0.8, 0.7, 0.6, 0.5];
const UPLOAD_TIMEOUT_MS = 90_000;

type Tile = {
  key: number;
  status: "resizing" | "uploading" | "done" | "failed";
  progress: number;
  name: string;
  mimeType: LetterFileMimeType;
  sizeBytes: number;
  /** Object URL of an image (thumbnail); revoked when the tile goes. */
  preview: string | null;
  blob: Blob | null;
  ref: LetterFileRefInput | null;
  error: string | null;
};

/** What the form needs: the uploaded files in the order chosen, and whether anything is busy or failed. */
export type FileSummary = { files: LetterFileRefInput[]; pending: boolean; failed: boolean; count: number };

export const EMPTY_FILES: FileSummary = { files: [], pending: false, failed: false, count: 0 };

/**
 * FilePicker (design 3.3), the Inventory photo picker adapted to letters: PDF, JPG or PNG, 5 MB, at most
 * `max` files. "Ambil foto" opens the rear camera on a phone (a photo of a paper letter is the main case
 * there); "Pilih berkas" opens the file chooser. Large photos are made smaller in the browser (long side
 * about 2000 px, JPEG quality lowered until under 5 MB); a PDF is never changed. Each file uploads as
 * soon as it is chosen, through POST /api/letters/files, so a weak connection shows while the person
 * still holds the paper. Files never attached to a saved letter or request are not records.
 */
export function FilePicker({
  id,
  label,
  hint,
  max = LETTER_LIMITS.filesPerParent,
  action,
  onChange,
  error,
}: {
  /** Base id; the "Pilih berkas" button gets it so a form summary can move focus there. */
  id: string;
  label: string;
  /** Extra line under the format hint ("Lampirkan berkas pendukung ..."). */
  hint?: string;
  /** Room left (3, or fewer on "Tambah berkas"). */
  max?: number;
  action: "uploadLetterFile" | "uploadRequestFile";
  onChange: (summary: FileSummary) => void;
  error?: string | null;
}) {
  const router = useRouter();
  const coarse = useCoarsePointer();
  const cameraRef = useRef<HTMLInputElement>(null);
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

  async function send(key: number, blob: Blob, name: string, mimeType: LetterFileMimeType) {
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
      setAnnounce(`Berkas ${numberOf(key)} terunggah`);
      return;
    }
    if (result.kind === "error" && result.error.code === "unauthenticated") {
      goToLogin(router);
      return;
    }
    const text = result.kind === "network" ? COPY.network : (letterErrorMessage(result.error, action) ?? COPY.fileFailed);
    patch(key, { status: "failed", error: text, mimeType });
    setAnnounce(`Berkas ${numberOf(key)} gagal diunggah`);
  }

  async function add(file: File) {
    const type = await realType(file);
    if (type === null) {
      setPickError(letterErrorMessage({ code: "invalid_file", field: "file", ref: null }, action));
      return;
    }
    if (type === "application/pdf" && file.size > LETTER_FILE_MAX_BYTES) {
      setPickError(tooLargeText(action));
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
    let mimeType: LetterFileMimeType = type;
    if (isImage) {
      try {
        const resized = await shrinkImage(file, type);
        blob = resized.blob;
        mimeType = resized.type;
        if (resized.type !== type) name = renameTo(file.name, "jpg");
      } catch (error) {
        setTiles((prev) => prev.filter((t) => t.key !== key));
        setPickError(error instanceof TooLargeError ? tooLargeText(action) : COPY.fileUnreadable);
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
    if (picked.length > room) setPickError(COPY.fileMax);
    for (const file of picked.slice(0, Math.max(0, room))) void add(file);
  }

  function remove(tile: Tile) {
    if (tile.preview) URL.revokeObjectURL(tile.preview);
    setTiles((prev) => prev.filter((t) => t.key !== tile.key));
    setPickError(null);
  }

  const full = tiles.length >= max;
  const errorId = `${id}-error`;
  const accept = LETTER_FILE_MIME_TYPES.join(",");

  return (
    <div role="group" aria-labelledby={`${id}-label`} aria-describedby={error ? errorId : undefined} className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <p id={`${id}-label`} className="text-label-lg text-ink-label">
          {label}
        </p>
        <p className="text-body-sm text-ink-body">{COPY.fileHint}</p>
        <p className="text-body-sm text-ink-body">{COPY.fileResizeHint}</p>
        {hint ? <p className="text-body-sm text-ink-body">{hint}</p> : null}
      </div>

      {full ? (
        <p className="text-body-sm text-ink-body">{COPY.fileMax}</p>
      ) : (
        <div className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-2">
          {coarse ? (
            <button type="button" onClick={() => cameraRef.current?.click()} className={buttonClass("outline", "px-3")}>
              <Camera aria-hidden="true" className="size-5" strokeWidth={2} />
              Ambil foto
            </button>
          ) : null}
          <button
            id={id}
            type="button"
            onClick={() => chooserRef.current?.click()}
            className={buttonClass("outline", coarse ? "px-3" : "px-3 min-[360px]:col-span-2")}
          >
            <FolderOpen aria-hidden="true" className="size-5" strokeWidth={2} />
            Pilih berkas
          </button>
        </div>
      )}
      <input
        ref={cameraRef}
        type="file"
        accept="image/jpeg,image/png"
        capture="environment"
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
        onChange={(event) => {
          onPick(event.target.files);
          event.target.value = "";
        }}
      />
      <input
        ref={chooserRef}
        type="file"
        accept={accept}
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
        <ul className="flex flex-col gap-2.5">
          {tiles.map((tile, index) => (
            <li key={tile.key} role="group" aria-label={`Berkas ${index + 1}`} className="flex items-start gap-3">
              <FileThumb tile={tile} index={index} />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <p className="text-body-md font-semibold break-words text-ink">{tile.name}</p>
                <TileStatus tile={tile} />
                <div className="flex flex-wrap gap-x-2">
                  {tile.status === "failed" && tile.blob ? (
                    <button
                      type="button"
                      aria-label={`Coba lagi berkas ${index + 1}`}
                      onClick={() => tile.blob && void send(tile.key, tile.blob, tile.name, tile.mimeType)}
                      className={buttonClass("text", "-ml-2")}
                    >
                      Coba lagi
                    </button>
                  ) : null}
                  {tile.status === "done" || tile.status === "failed" ? (
                    <button
                      type="button"
                      aria-label={`Hapus berkas ${index + 1}`}
                      onClick={() => remove(tile)}
                      className={buttonClass("text", tile.status === "failed" && tile.blob ? undefined : "-ml-2")}
                    >
                      Hapus
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

/** 72 px tile: a thumbnail for an image, a document tile with the word "PDF" for a PDF (design 3.3). */
function FileThumb({ tile, index }: { tile: Tile; index: number }) {
  return (
    <div className="flex size-[72px] shrink-0 items-center justify-center overflow-hidden rounded-lg border border-surface-line bg-ivory">
      {tile.preview ? (
        // eslint-disable-next-line @next/next/no-img-element -- a local object URL, not an optimisable asset
        <img src={tile.preview} alt={`Pratinjau berkas ${index + 1}`} className="size-full object-cover" />
      ) : tile.mimeType === "application/pdf" ? (
        <span className="flex flex-col items-center gap-0.5 text-walnut">
          <FileText aria-hidden="true" className="size-6" strokeWidth={1.75} />
          <span className="text-label-sm font-bold">PDF</span>
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
        Memperkecil...
      </p>
    );
  }
  if (tile.status === "uploading") {
    return (
      <div className="flex flex-col gap-1">
        <p className="text-body-sm text-ink-body tabular-nums">Mengunggah {tile.progress}%</p>
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
          Terunggah
          <CircleCheck aria-hidden="true" className="size-4" strokeWidth={2} />
        </span>
      </p>
    );
  }
  return <p className="text-body-sm text-danger">{tile.error ?? COPY.fileFailed}</p>;
}

function tooLargeText(action: "uploadLetterFile" | "uploadRequestFile"): string {
  return (
    letterErrorMessage({ code: "file_too_large", field: "file", ref: null, maxMb: LETTER_FILE_MAX_MB }, action) ?? COPY.fileFailed
  );
}

function renameTo(name: string, ext: string): string {
  const dot = name.lastIndexOf(".");
  return `${dot > 0 ? name.slice(0, dot) : name}.${ext}`;
}

/** The real type from the first bytes (LT-26), so a renamed file is refused before any upload. */
async function realType(file: File): Promise<LetterFileMimeType | null> {
  try {
    const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
    return sniffLetterFileType(head);
  } catch {
    return null;
  }
}

/** True on touch-first devices, where "Ambil foto" opens the camera; computers only get the chooser. */
function useCoarsePointer(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const query = window.matchMedia("(pointer: coarse)");
      query.addEventListener("change", notify);
      return () => query.removeEventListener("change", notify);
    },
    () => window.matchMedia("(pointer: coarse)").matches,
    () => false,
  );
}

class TooLargeError extends Error {}

/**
 * Keeps a small image as it is. A large one (long side over about 2000 px, or over 5 MB) is drawn at
 * most 2000 px on its long side as JPEG, quality lowered in steps until it fits, so printed text on a
 * photographed letter stays readable.
 */
async function shrinkImage(file: File, type: LetterFileMimeType): Promise<{ blob: Blob; type: LetterFileMimeType }> {
  const image = await decode(file);
  const longSide = Math.max(image.width, image.height);
  if (longSide <= LETTER_IMAGE_RESIZE_LONG_SIDE_PX && file.size <= LETTER_FILE_MAX_BYTES) {
    image.close();
    return { blob: file, type };
  }
  const scale = Math.min(1, LETTER_IMAGE_RESIZE_LONG_SIDE_PX / longSide);
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
    if (blob && blob.size <= LETTER_FILE_MAX_BYTES) return { blob, type: "image/jpeg" };
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

type UploadOutcome = { kind: "ok"; data: LetterFileUploadResult } | { kind: "error"; error: LetterError } | { kind: "network" };

/** POST multipart to the upload route with progress (fetch has no upload progress). */
function uploadFile(blob: Blob, name: string, onProgress: (percent: number) => void): Promise<UploadOutcome> {
  return new Promise((resolve) => {
    const form = new FormData();
    form.append(LETTER_FILE_UPLOAD_FIELDS.file, blob, name);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", LETTER_FILE_UPLOAD_ROUTE);
    xhr.timeout = UPLOAD_TIMEOUT_MS;
    xhr.responseType = "text";
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.min(99, Math.round((event.loaded / event.total) * 100)));
    };
    xhr.onload = () => {
      const body = parse(xhr.responseText);
      const ok = body as LetterFileUploadResult | null;
      if (xhr.status === 200 && ok && typeof ok.path === "string" && typeof ok.name === "string") {
        resolve({ kind: "ok", data: ok });
        return;
      }
      const error = (body as { error?: LetterError } | null)?.error;
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
