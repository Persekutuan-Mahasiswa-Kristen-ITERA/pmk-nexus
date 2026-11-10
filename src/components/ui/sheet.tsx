"use client";

import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { Dialog } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Dialog that is a bottom sheet on phones and a centred 448 px dialog from 768 px
 * (docs/design/inventory-borrowing.md 3.3, X11). Radix Dialog gives the focus trap, Escape to close,
 * focus back on the opener, and an inert page behind it.
 *
 * Header: Playfair title plus a 44 px "Tutup". Body scrolls; header and footer stay. While `busy`,
 * closing is refused (Escape, veil, Tutup) so a running save is never cut off.
 *
 * Sheets opened from a plain button (not a Radix Trigger) would drop focus on <body> when they close;
 * the element that had focus when the sheet opened gets it back instead (R-32), unless the caller
 * decides where focus goes (`onCloseAutoFocus`).
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  busy = false,
  initialFocusRef,
  onCloseAutoFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Short text under the title, read as the dialog description. */
  description?: ReactNode;
  children?: ReactNode;
  /** Buttons, stacked full width (primary first, cancel as a text button under it). */
  footer?: ReactNode;
  busy?: boolean;
  /** Field to focus first; without it the dialog itself takes focus (title is read first). */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Where focus goes on close; call event.preventDefault() and focus something else (e.g. a new line). */
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (open && document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
      opener.current = document.activeElement;
    }
  }, [open]);

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (busy && !next) return;
        onOpenChange(next);
      }}
    >
      <Dialog.Portal>
        {/* Flat espresso veil at 40 %, no blur (same as the drawer). */}
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/40 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 motion-reduce:data-[state=open]:animate-none motion-reduce:data-[state=closed]:animate-none" />
        <Dialog.Content
          // Without a description, say so explicitly (Radix warns otherwise); with one, Radix links it.
          {...(description ? {} : { "aria-describedby": undefined })}
          onOpenAutoFocus={(event) => {
            if (initialFocusRef?.current) {
              event.preventDefault();
              initialFocusRef.current.focus();
            }
          }}
          onCloseAutoFocus={(event) => {
            if (onCloseAutoFocus) {
              onCloseAutoFocus(event);
              return;
            }
            const target = opener.current;
            if (target && target.isConnected) {
              event.preventDefault();
              target.focus();
            }
          }}
          className={cn(
            // Phone: sheet on the bottom edge, top corners 12 px, at most 90 % of the visible height.
            "fixed inset-x-0 bottom-0 z-50 flex max-h-[90dvh] flex-col rounded-t-xl border border-b-0 border-hairline bg-surface shadow-elevation-2",
            "pb-[env(safe-area-inset-bottom)] focus:outline-none",
            // Tablet and up: centred, 448 px, all corners 12 px.
            "md:inset-x-auto md:top-1/2 md:bottom-auto md:left-1/2 md:w-[28rem] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-xl md:border-b md:pb-0",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
            "duration-150 motion-reduce:data-[state=open]:animate-none motion-reduce:data-[state=closed]:animate-none",
          )}
        >
          <div className="flex items-start gap-3 border-b border-surface-line px-4 pt-4 pb-3">
            <div className="min-w-0 flex-1 pt-1.5">
              <Dialog.Title className="font-heading text-headline-lg text-title">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description className="mt-1 text-body-md text-ink-body">{description}</Dialog.Description>
              ) : null}
            </div>
            <Dialog.Close
              aria-disabled={busy || undefined}
              className="-mr-2 inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg px-2 text-label-lg text-walnut hover:bg-ivory"
            >
              <X aria-hidden="true" className="size-5" strokeWidth={2} />
              Tutup
            </Dialog.Close>
          </div>
          {children ? <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">{children}</div> : null}
          {footer ? <div className="flex flex-col gap-2 border-t border-surface-line px-4 pt-3 pb-4">{footer}</div> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
