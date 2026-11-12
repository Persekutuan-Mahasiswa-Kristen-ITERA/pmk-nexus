"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FileText, LayoutDashboard, Mail, Package, Users, Wallet, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { isActiveHref, type NavData, type NavIcon } from "./nav";

const ICONS: Record<NavIcon, LucideIcon> = {
  dashboard: LayoutDashboard,
  group: Users,
  finance: Wallet,
  minutes: FileText,
  letters: Mail,
  inventory: Package,
};

/** Persistent desktop navigation. The mobile drawer remains the compact touch-first alternative. */
export function DesktopNav({ nav }: { nav: NavData }) {
  const pathname = usePathname();

  return (
    <aside className="hidden w-64 shrink-0 border-r border-surface-line bg-drawer lg:flex lg:flex-col">
      <nav aria-label="Menu utama" className="flex-1 overflow-y-auto px-4 py-7">
        <p className="mb-4 px-3 font-heading text-headline-sm font-semibold text-title">Ruang kerja</p>
        <ul className="flex flex-col gap-1.5">
          {nav.items.map((item) => {
            const Icon = ICONS[item.icon];
            const active = isActiveHref(pathname, item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex min-h-11 items-center gap-3 rounded-lg px-3 text-label-lg transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-walnut motion-reduce:transition-none",
                    active ? "bg-title font-bold text-primary-foreground" : "text-ink-body hover:bg-ivory hover:text-ink",
                  )}
                >
                  <Icon aria-hidden="true" className={cn("size-5 shrink-0", active ? "text-gold-ring" : "text-walnut")} strokeWidth={2} />
                  <span className="min-w-0">{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="border-t border-surface-line px-5 py-5">
        <p className="text-body-sm text-ink-body">Masuk sebagai {nav.memberName}.</p>
        {nav.periodLabel ? <p className="mt-1 text-body-sm text-ink-body">Periode {nav.periodLabel}</p> : null}
      </div>
    </aside>
  );
}
