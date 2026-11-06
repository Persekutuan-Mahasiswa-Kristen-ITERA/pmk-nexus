import type { LucideIcon } from "lucide-react";
import { CircleAlert, Clock, Info, TriangleAlert, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Inline message in three tones, always icon plus text (never colour alone):
 * error = the person typed something wrong; warning = not their fault, try again; info = just read.
 * docs/design/login.md 2.5a.
 */
export type AlertTone = "error" | "warning" | "info";
export type AlertIcon = "error" | "warning" | "schedule" | "wifi_off" | "info";

const toneClass: Record<AlertTone, string> = {
  error: "bg-danger-soft text-danger",
  warning: "border border-warn-line bg-warn-soft text-warn",
  info: "border border-ivory-line bg-ivory text-walnut",
};

const icons: Record<AlertIcon, LucideIcon> = {
  error: CircleAlert,
  warning: TriangleAlert,
  schedule: Clock,
  wifi_off: WifiOff,
  info: Info,
};

const defaultIcon: Record<AlertTone, AlertIcon> = {
  error: "error",
  warning: "warning",
  info: "info",
};

type AlertMessageProps = {
  tone: AlertTone;
  icon?: AlertIcon;
  /** "alert" for errors and warnings (read aloud at once), "status" for notices. */
  role?: "alert" | "status";
  id?: string;
  className?: string;
  children: React.ReactNode;
};

export function AlertMessage({ tone, icon, role, id, className, children }: AlertMessageProps) {
  const Icon = icons[icon ?? defaultIcon[tone]];
  return (
    <div id={id} role={role} className={cn("flex items-start gap-2 rounded-lg p-3", toneClass[tone], className)}>
      <Icon aria-hidden="true" className="size-5 shrink-0" strokeWidth={2} />
      <p className="text-body-md">{children}</p>
    </div>
  );
}
