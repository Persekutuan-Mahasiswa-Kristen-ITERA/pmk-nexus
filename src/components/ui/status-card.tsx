"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** The one raised surface on a screen: white, 1 px border, Stitch elevation 1, radius 12. */
export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <section className={cn("rounded-xl border border-surface-line bg-surface p-5 shadow-elevation-1", className)}>
      {children}
    </section>
  );
}

/**
 * Card for a full-screen state (no access, password pending, error).
 * Focus moves to the title on load so a screen reader reads the message first (design 5.4, 6.4, 8.2).
 */
export function StatusCard({
  title,
  icon,
  body,
  children,
}: {
  title: string;
  icon?: ReactNode;
  body: ReactNode;
  children: ReactNode;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <Card>
      <div className="flex items-center gap-2">
        {icon}
        <h1 ref={headingRef} tabIndex={-1} className="font-heading text-display-sm text-title">
          {title}
        </h1>
      </div>
      <p className="mt-1 text-body-md text-ink-body">{body}</p>
      <div className="mt-5">{children}</div>
    </Card>
  );
}
