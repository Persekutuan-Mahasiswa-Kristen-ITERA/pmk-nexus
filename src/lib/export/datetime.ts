// Dates for export file names and headers. PMK ITERA is in Lampung, so every export uses Western
// Indonesia Time (Asia/Jakarta, UTC+7, no daylight saving) regardless of the server's time zone
// (Vercel runs in UTC).

export const EXPORT_TIME_ZONE = "Asia/Jakarta";

type Parts = { year: string; month: string; day: string; hour: string; minute: string };

function jakartaParts(date: Date): Parts {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: EXPORT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "00";
  return { year: pick("year"), month: pick("month"), day: pick("day"), hour: pick("hour"), minute: pick("minute") };
}

/** "2026-11-06" in Asia/Jakarta (file names). */
export function jakartaDate(date: Date): string {
  const p = jakartaParts(date);
  return `${p.year}-${p.month}-${p.day}`;
}

/** "2026-11-06 23:40 WIB" in Asia/Jakarta (export headers). Numeric, so no month names to translate. */
export function jakartaDateTime(date: Date): string {
  const p = jakartaParts(date);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute} WIB`;
}

/** `attachment` header with a plain ASCII file name (callers build the name from fixed text and a date). */
export function attachmentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^A-Za-z0-9._-]/g, "_");
  return `attachment; filename="${ascii}"`;
}
