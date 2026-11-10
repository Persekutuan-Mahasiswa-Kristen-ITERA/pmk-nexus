"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Dialog } from "radix-ui";
import { LayoutDashboard, Mail, Menu, Package, Users, X, type LucideIcon } from "lucide-react";
import { SignOutAction } from "@/components/auth/sign-out-action";
import { cn } from "@/lib/utils";
import { isActiveHref, type NavData, type NavIcon } from "./nav";

const ICONS: Record<NavIcon, LucideIcon> = {
  dashboard: LayoutDashboard,
  group: Users,
  letters: Mail, // an envelope: the drawer item for letters (letters design 4.1)
  inventory: Package, // a box: the drawer item for items and loans (design 4.1)
};

// 44 px hit area on the walnut bar (Stitch draws 40 px; raised for touch, R-03).
const triggerClass =
  "inline-flex size-11 items-center justify-center rounded-lg text-primary-foreground hover:bg-walnut-hover focus-visible:outline-primary-foreground";

/**
 * Hamburger plus the Stitch light drawer (D-014, D-021). Radix Dialog gives the focus trap,
 * Escape to close, focus back on the hamburger, and inert page content behind it.
 */
export function NavDrawer({ nav }: { nav: NavData }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const activeRef = useRef<HTMLAnchorElement>(null);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger className={triggerClass} aria-label="Buka menu">
        <Menu aria-hidden="true" className="size-6" strokeWidth={2} />
      </Dialog.Trigger>
      <Dialog.Portal>
        {/* Flat espresso veil, no blur: the drawer is the only raised surface (R-10). */}
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/40 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 motion-reduce:data-[state=open]:animate-none motion-reduce:data-[state=closed]:animate-none" />
        <Dialog.Content
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => {
            // Start on the current page's item so Tab and Enter continue from "where am I".
            if (activeRef.current) {
              event.preventDefault();
              activeRef.current.focus();
            }
          }}
          className={cn(
            "fixed inset-y-0 left-0 z-50 flex w-72 max-w-[80vw] flex-col border-r border-surface-line bg-drawer shadow-elevation-2",
            "pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] focus:outline-none",
            "data-[state=open]:animate-in data-[state=open]:slide-in-from-left data-[state=closed]:animate-out data-[state=closed]:slide-out-to-left",
            // The state variants are more specific than plain motion-reduce:animate-none (BUG-MD-02).
            "duration-250 ease-(--nx-ease-out) motion-reduce:data-[state=open]:animate-none motion-reduce:data-[state=closed]:animate-none",
          )}
        >
          <div className="flex items-center gap-3 border-b border-surface-line px-4 py-4">
            {/* PMK ITERA seal (D-023); the title next to it names the app, so alt is empty. */}
            <Image src="/brand/pmk-logo-192.png" alt="" width={44} height={44} className="size-11 shrink-0" />
            <div className="min-w-0 flex-1">
              <Dialog.Title className="font-heading text-headline-lg font-bold text-title">PMK-NEXUS</Dialog.Title>
              <p className="text-body-sm text-ink-body">Institut Teknologi Sumatera</p>
            </div>
            <Dialog.Close
              aria-label="Tutup menu"
              className="-mr-2 inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-ink-body hover:bg-ivory"
            >
              <X aria-hidden="true" className="size-5" strokeWidth={2} />
            </Dialog.Close>
          </div>

          <nav aria-label="Menu utama" className="flex-1 overflow-y-auto px-3 py-3">
            {/* Items follow the panel in by 30 ms steps (nx-rise-list); off with reduced motion. */}
            <ul className="nx-rise-list flex flex-col gap-1">
              {nav.items.map((item) => {
                const Icon = ICONS[item.icon];
                const active = isActiveHref(pathname, item.href);
                return (
                  <li key={item.href}>
                    <Link
                      ref={active ? activeRef : undefined}
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      onClick={() => setOpen(false)}
                      // Type size outside cn(): see buttonClass in components/ui/nx-button.tsx.
                      className={`text-label-lg ${cn(
                        "flex min-h-11 items-center gap-3 rounded-lg px-4 transition-[color,background-color,transform] duration-150 active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100",
                        active
                          ? "bg-title font-bold text-primary-foreground focus-visible:outline-title"
                          : "text-ink-body hover:bg-ivory hover:text-ink",
                      )}`}
                    >
                      <Icon
                        aria-hidden="true"
                        className={cn("size-5 shrink-0", active ? "text-gold-ring" : "text-walnut")}
                        strokeWidth={2}
                      />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className="border-t border-surface-line px-4 pt-3 pb-4">
            <p className="text-body-sm text-ink-body">Masuk sebagai {nav.memberName}.</p>
            {nav.periodLabel ? <p className="text-body-sm text-ink-body">Periode {nav.periodLabel}</p> : null}
            <div className="mt-2">
              <SignOutAction variant="text" />
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
