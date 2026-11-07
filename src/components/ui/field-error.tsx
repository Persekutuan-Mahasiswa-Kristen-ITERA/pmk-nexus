import { CircleAlert } from "lucide-react";

/**
 * Error under a field (design inventory-borrowing 3.4): body-sm, #932924, small icon, linked to the
 * field with aria-describedby. Icon plus text, so colour is never the only signal.
 */
export function FieldError({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <p id={id} className="flex items-start gap-1.5 text-body-sm text-danger">
      <CircleAlert aria-hidden="true" className="mt-px size-4 shrink-0" strokeWidth={2} />
      <span>{children}</span>
    </p>
  );
}

/** aria-describedby value from optional ids (hint, error). */
export function describedBy(...ids: (string | null | undefined | false)[]): string | undefined {
  const list = ids.filter(Boolean).join(" ");
  return list === "" ? undefined : list;
}
