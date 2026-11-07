"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Image as ImageIcon } from "lucide-react";
import { AlertMessage } from "@/components/ui/alert-message";
import { buttonClass, Spinner } from "@/components/ui/nx-button";
import { Sheet } from "@/components/ui/sheet";
import type { EvidencePhotoLink, InventoryResult } from "../types";
import { COPY } from "./copy";
import { requestHref } from "./routes";

type LoadState = { kind: "idle" } | { kind: "loading" } | { kind: "ok"; links: EvidencePhotoLink[] } | { kind: "error" };

/**
 * "Foto bukti ({n})" and its viewer sheet (design 10.4). The photos are private; the server signs
 * short-lived links (A-IB51) each time the sheet opens, so an old link is never reused.
 */
export function EvidencePhotos({
  requestId,
  reference,
  photoIds,
  itemName,
  loadPhotos,
}: {
  requestId: string;
  reference: string;
  /** The line's photos (of non-reversed returns). */
  photoIds: number[];
  itemName: string;
  /** Server Action that signs the request's photo links (passed in by the page). */
  loadPhotos: (requestId: string) => Promise<InventoryResult<EvidencePhotoLink[]>>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<LoadState>({ kind: "idle" });

  async function load() {
    setState({ kind: "loading" });
    try {
      const result = await loadPhotos(requestId);
      if (result.ok) {
        setState({ kind: "ok", links: result.data.filter((link) => photoIds.includes(link.photoId)) });
        return;
      }
      if (result.error.code === "unauthenticated") {
        router.push(`/login?reason=session_ended&next=${encodeURIComponent(requestHref(reference))}`);
        return;
      }
      setState({ kind: "error" });
    } catch {
      setState({ kind: "error" });
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          void load();
        }}
        className="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-label-lg text-walnut underline underline-offset-2 hover:bg-ivory"
      >
        <ImageIcon aria-hidden="true" className="size-4" strokeWidth={2} />
        Foto bukti ({photoIds.length})
      </button>
      <Sheet open={open} onOpenChange={setOpen} title="Foto bukti" description={itemName}>
        <div role="status" aria-live="polite">
          {state.kind === "loading" ? (
            <p className="flex items-center gap-2 text-body-md text-ink-body">
              <Spinner />
              Memuat foto...
            </p>
          ) : null}
        </div>
        {state.kind === "error" ? (
          <div className="flex flex-col gap-3">
            <AlertMessage role="alert" tone="warning">
              {COPY.photosError}
            </AlertMessage>
            <button type="button" onClick={() => void load()} className={buttonClass("outline")}>
              Coba lagi
            </button>
          </div>
        ) : null}
        {state.kind === "ok" ? (
          <ul className="flex flex-col gap-3">
            {state.links.map((link, index) => (
              <li key={link.photoId}>
                {/* Signed Storage links expire in minutes; next/image would cache them past that. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={link.url}
                  alt={`Foto bukti ${index + 1} dari ${state.links.length}, ${itemName}`}
                  loading="lazy"
                  className="w-full rounded-lg border border-surface-line bg-ivory"
                />
              </li>
            ))}
          </ul>
        ) : null}
      </Sheet>
    </>
  );
}
