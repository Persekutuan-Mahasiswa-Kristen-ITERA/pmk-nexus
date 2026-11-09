"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Camera, CircleCheck, Images } from "lucide-react";
import { FieldError } from "@/components/ui/field-error";
import { buttonClass, Spinner } from "@/components/ui/nx-button";
import {
  EVIDENCE_MAX_BYTES,
  EVIDENCE_MIME_TYPES,
  EVIDENCE_ORIGINAL_MAX_BYTES,
  EVIDENCE_ORIGINAL_MAX_MB,
  EVIDENCE_PHOTOS_MAX,
  EVIDENCE_RESIZE_LONG_SIDE_PX,
  EVIDENCE_UPLOAD_FIELDS,
  EVIDENCE_UPLOAD_ROUTE,
  inventoryErrorMessage,
  type EvidenceUploadResult,
  type InventoryError,
} from "../types";
import { goToLogin } from "./action-sheet";
import { COPY, STAFF_COPY } from "./copy";

/** JPEG quality steps tried until the file fits the bucket limit (A-IB31). */
const QUALITY_STEPS = [0.85, 0.75, 0.65, 0.55, 0.45];
const UPLOAD_TIMEOUT_MS = 60_000;

type Photo = {
  key: number;
  status: "resizing" | "uploading" | "done" | "failed";
  progress: number;
  /** Object URL of the resized photo (thumbnail); revoked when the tile goes. */
  preview: string | null;
  blob: Blob | null;
  path: string | null;
  error: string | null;
};

/** What the form needs to know: the uploaded paths, and whether anything is still busy or failed. */
export type PhotoSummary = { paths: string[]; pending: boolean; failed: boolean };

/**
 * "Foto bukti" for one damaged or lost outcome (design 13.1, 13.3; P8 upload on pick). Each photo is
 * resized in the browser (long side 1280 px, JPEG quality lowered until it fits 1.5 MiB) and uploaded
 * through POST /api/inventory/evidence as soon as it is ready, so a weak connection shows up while the
 * person is still at the desk. Originals above 15 MB are refused before any work (A-IB52).
 */
export function PhotoPicker({
  id,
  requestId,
  onChange,
  error,
}: {
  /** Base id; the "Pilih dari galeri" button gets it so the form summary can move focus there. */
  id: string;
  requestId: string;
  onChange: (summary: PhotoSummary) => void;
  error: string | null;
}) {
  const router = useRouter();
  const coarse = useCoarsePointer();
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const nextKey = useRef(1);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [pickError, setPickError] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");

  // Report up whenever the tiles change.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });
  useEffect(() => {
    onChangeRef.current({
      paths: photos.flatMap((p) => (p.status === "done" && p.path ? [p.path] : [])),
      pending: photos.some((p) => p.status === "resizing" || p.status === "uploading"),
      failed: photos.some((p) => p.status === "failed"),
    });
  }, [photos]);

  // Free the thumbnails when the block closes (the outcome went back to zero, or the page left).
  const photosRef = useRef(photos);
  useEffect(() => {
    photosRef.current = photos;
  });
  useEffect(
    () => () => {
      for (const p of photosRef.current) if (p.preview) URL.revokeObjectURL(p.preview);
    },
    [],
  );

  function patch(key: number, next: Partial<Photo>) {
    setPhotos((prev) => prev.map((p) => (p.key === key ? { ...p, ...next } : p)));
  }

  function numberOf(key: number): number {
    return photosRef.current.findIndex((p) => p.key === key) + 1;
  }

  async function send(key: number, blob: Blob) {
    patch(key, { status: "uploading", progress: 0, error: null });
    const result = await uploadPhoto(requestId, blob, (progress) => patch(key, { progress }));
    if (result.kind === "ok") {
      patch(key, { status: "done", path: result.path, progress: 100 });
      setAnnounce(`Foto ${numberOf(key)} terunggah`);
      return;
    }
    if (result.kind === "error" && result.error.code === "unauthenticated") {
      goToLogin(router);
      return;
    }
    const text =
      result.kind === "network" ? COPY.network : (inventoryErrorMessage(result.error, "uploadPhoto") ?? STAFF_COPY.photoFailedSave);
    patch(key, { status: "failed", error: text });
    setAnnounce(`Foto ${numberOf(key)} gagal diunggah`);
  }

  async function add(file: File) {
    if (!(EVIDENCE_MIME_TYPES as readonly string[]).includes(file.type)) {
      setPickError(inventoryErrorMessage({ code: "invalid_photo", ref: null }, "uploadPhoto"));
      return;
    }
    if (file.size > EVIDENCE_ORIGINAL_MAX_BYTES) {
      setPickError(inventoryErrorMessage({ code: "photo_too_large", maxMb: EVIDENCE_ORIGINAL_MAX_MB }, "uploadPhoto"));
      return;
    }
    const key = nextKey.current++;
    setPhotos((prev) => [...prev, { key, status: "resizing", progress: 0, preview: null, blob: null, path: null, error: null }]);
    let blob: Blob;
    try {
      blob = await resizePhoto(file);
    } catch (error) {
      setPhotos((prev) => prev.filter((p) => p.key !== key));
      // Only a decoded photo that stays over the limit is "too large"; anything else (corrupt file, a non-image
      // renamed to .jpg, no canvas) cannot be read at all (BUG-IB-02).
      setPickError(error instanceof PhotoTooLargeError ? STAFF_COPY.photoStillTooLarge : STAFF_COPY.photoUnreadable);
      return;
    }
    patch(key, { blob, preview: URL.createObjectURL(blob) });
    await send(key, blob);
  }

  function onPick(files: FileList | null) {
    setPickError(null);
    if (!files) return;
    const room = EVIDENCE_PHOTOS_MAX - photosRef.current.length;
    for (const file of [...files].slice(0, Math.max(0, room))) void add(file);
  }

  function remove(photo: Photo) {
    if (photo.preview) URL.revokeObjectURL(photo.preview);
    setPhotos((prev) => prev.filter((p) => p.key !== photo.key));
  }

  const full = photos.length >= EVIDENCE_PHOTOS_MAX;
  const errorId = `${id}-error`;

  return (
    <div role="group" aria-labelledby={`${id}-label`} aria-describedby={error ? errorId : undefined} className="flex flex-col gap-2">
      <p id={`${id}-label`} className="text-label-lg text-ink-label">
        Foto bukti (wajib, 1 sampai {EVIDENCE_PHOTOS_MAX})
      </p>
      <p className="-mt-1 text-body-sm text-ink-body">{STAFF_COPY.photoHint}</p>

      {full ? (
        <p className="text-body-sm text-ink-body">{STAFF_COPY.photoMax}</p>
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
            onClick={() => galleryRef.current?.click()}
            className={buttonClass("outline", coarse ? "px-3" : "px-3 min-[360px]:col-span-2")}
          >
            <Images aria-hidden="true" className="size-5" strokeWidth={2} />
            Pilih dari galeri
          </button>
        </div>
      )}
      <input
        ref={cameraRef}
        type="file"
        accept={EVIDENCE_MIME_TYPES.join(",")}
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
        ref={galleryRef}
        type="file"
        accept={EVIDENCE_MIME_TYPES.join(",")}
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

      {photos.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {photos.map((photo, index) => (
            <li key={photo.key} role="group" aria-label={`Foto bukti ${index + 1}`} className="flex items-start gap-3">
              <div className="size-[72px] shrink-0 overflow-hidden rounded-lg border border-surface-line bg-ivory">
                {photo.preview ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a local object URL, not an optimisable asset
                  <img src={photo.preview} alt={`Foto bukti ${index + 1}`} className="size-full object-cover" />
                ) : null}
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <p className="text-body-md font-semibold text-ink">Foto {index + 1}</p>
                <TileStatus photo={photo} />
                <div className="flex flex-wrap gap-x-2">
                  {photo.status === "failed" && photo.blob ? (
                    <button
                      type="button"
                      aria-label={`Coba lagi foto ${index + 1}`}
                      onClick={() => photo.blob && void send(photo.key, photo.blob)}
                      className={buttonClass("text", "-ml-2")}
                    >
                      Coba lagi
                    </button>
                  ) : null}
                  {photo.status === "done" || photo.status === "failed" ? (
                    <button
                      type="button"
                      aria-label={`Hapus foto ${index + 1}`}
                      onClick={() => remove(photo)}
                      className={buttonClass("text", photo.status === "failed" ? undefined : "-ml-2")}
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

function TileStatus({ photo }: { photo: Photo }) {
  if (photo.status === "resizing") {
    return (
      <p className="flex items-center gap-1.5 text-body-sm text-ink-body">
        <Spinner />
        Memperkecil...
      </p>
    );
  }
  if (photo.status === "uploading") {
    return (
      <div className="flex flex-col gap-1">
        <p className="text-body-sm text-ink-body tabular-nums">Mengunggah {photo.progress}%</p>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={photo.progress}
          aria-label="Unggahan foto"
          className="h-1.5 w-full overflow-hidden rounded-sm bg-ivory"
        >
          <div className="h-full bg-walnut" style={{ width: `${photo.progress}%` }} />
        </div>
      </div>
    );
  }
  if (photo.status === "done") {
    return (
      <p className="flex items-center gap-1.5 text-body-sm text-success">
        <CircleCheck aria-hidden="true" className="size-4" strokeWidth={2} />
        Terunggah
      </p>
    );
  }
  return <p className="text-body-sm text-danger">{photo.error ?? "Gagal diunggah."}</p>;
}

/** True on touch-first devices, where "Ambil foto" opens the camera; computers only get the file chooser. */
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

/** Draws the photo at most 1280 px on its long side and lowers JPEG quality until it fits the bucket. */
async function resizePhoto(file: File): Promise<Blob> {
  const image = await decode(file);
  const longSide = Math.max(image.width, image.height);
  const scale = Math.min(1, EVIDENCE_RESIZE_LONG_SIDE_PX / longSide);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("no canvas");
  // A white ground, so a transparent PNG does not turn black as a JPEG.
  context.fillStyle = "white";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image.source, 0, 0, canvas.width, canvas.height);
  image.close();
  for (const quality of QUALITY_STEPS) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (blob && blob.size <= EVIDENCE_MAX_BYTES) return blob;
  }
  throw new PhotoTooLargeError();
}

/** The photo decoded fine but no JPEG quality step fits the bucket limit. */
class PhotoTooLargeError extends Error {}

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

type UploadOutcome = { kind: "ok"; path: string } | { kind: "error"; error: InventoryError } | { kind: "network" };

/** POST multipart to the evidence route with upload progress (fetch has no upload progress). */
function uploadPhoto(requestId: string, blob: Blob, onProgress: (percent: number) => void): Promise<UploadOutcome> {
  return new Promise((resolve) => {
    const form = new FormData();
    form.append(EVIDENCE_UPLOAD_FIELDS.requestId, requestId);
    form.append(EVIDENCE_UPLOAD_FIELDS.file, blob, "foto.jpg");
    const xhr = new XMLHttpRequest();
    xhr.open("POST", EVIDENCE_UPLOAD_ROUTE);
    xhr.timeout = UPLOAD_TIMEOUT_MS;
    xhr.responseType = "text";
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.min(99, Math.round((event.loaded / event.total) * 100)));
    };
    xhr.onload = () => {
      const body = parse(xhr.responseText);
      if (xhr.status === 200 && body && typeof (body as EvidenceUploadResult).path === "string") {
        resolve({ kind: "ok", path: (body as EvidenceUploadResult).path });
        return;
      }
      const error = (body as { error?: InventoryError } | null)?.error;
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
