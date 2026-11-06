"use client";

import { createContext, useContext, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Spinner } from "@/components/ui/nx-button";
import { cn } from "@/lib/utils";

type Navigate = (href: string, options?: { replace?: boolean; scroll?: boolean }) => void;

type ListNavigation = { navigate: Navigate; refresh: () => void; pending: boolean };

const ListNavigationContext = createContext<ListNavigation | null>(null);

/**
 * One transition for every list change (search, filters, pages, retry). The old rows stay on screen
 * until the new ones arrive, and the results area says it is busy instead of flashing a skeleton
 * (spec F6: controls stay usable while the list reloads).
 */
export function ListNavigationProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const navigate: Navigate = (href, options = {}) => {
    startTransition(() => {
      const scroll = options.scroll ?? false;
      if (options.replace) router.replace(href, { scroll });
      else router.push(href, { scroll });
    });
  };

  const refresh = () => startTransition(() => router.refresh());

  return (
    <ListNavigationContext.Provider value={{ navigate, refresh, pending }}>{children}</ListNavigationContext.Provider>
  );
}

export function useListNavigation(): ListNavigation {
  const value = useContext(ListNavigationContext);
  if (!value) throw new Error("useListNavigation must be used inside ListNavigationProvider");
  return value;
}

/** Results area: dimmed and marked busy while a list change loads. No motion beyond the fade. */
export function PendingRegion({ children, className }: { children: ReactNode; className?: string }) {
  const { pending } = useListNavigation();
  return (
    <div
      aria-busy={pending || undefined}
      className={cn("transition-opacity duration-150 motion-reduce:transition-none", pending && "opacity-60", className)}
    >
      {children}
    </div>
  );
}

/** A real link that changes the list inside the shared transition (falls back to a normal load). */
export function ListLink({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  const { navigate } = useListNavigation();
  return (
    <a
      href={href}
      className={className}
      onClick={(event) => {
        if (!isPlainClick(event)) return;
        event.preventDefault();
        navigate(href);
      }}
    >
      {children}
    </a>
  );
}

/** "Coba lagi": reloads the list data for the same address. */
export function RetryButton({ className }: { className?: string }) {
  const { refresh, pending } = useListNavigation();
  return (
    <button
      type="button"
      onClick={() => {
        if (!pending) refresh();
      }}
      aria-busy={pending || undefined}
      className={className}
    >
      {pending ? <Spinner /> : null}
      {pending ? "Memeriksa..." : "Coba lagi"}
    </button>
  );
}

/** Plain left click without modifier keys: safe to handle in the page instead of a full load. */
export function isPlainClick(event: React.MouseEvent): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}
