// Date, number and size display for the Meeting Minutes screens (same rules as Letters, kept here so the
// module stays self-contained). Dates arrive as "YYYY-MM-DD" Jakarta days; timestamps as ISO strings
// shown in WIB (R14).

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

/** "17 Okt 2026". */
export function formatDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return date;
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

const WIB = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Jakarta",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function wibParts(iso: string): Record<string, string> | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return Object.fromEntries(WIB.formatToParts(date).map((p) => [p.type, p.value]));
}

/** "17 Okt 2026, 10.12 WIB". */
export function formatDateTime(iso: string): string {
  const map = wibParts(iso);
  if (!map) return "";
  const hour = map.hour === "24" ? "00" : map.hour;
  return `${Number(map.day)} ${MONTHS[Number(map.month) - 1]} ${map.year}, ${hour}.${map.minute} WIB`;
}

/** The Jakarta calendar day of a timestamp, "17 Okt 2026". */
export function formatDay(iso: string): string {
  const map = wibParts(iso);
  if (!map) return "";
  return `${Number(map.day)} ${MONTHS[Number(map.month) - 1]} ${map.year}`;
}

/** Thousands with a dot ("1.204"). */
export function formatCount(value: number): string {
  return value.toLocaleString("id-ID");
}

/** "1,2 MB" (decimal comma); very small files read "0,1 MB". */
export function formatFileSize(bytes: number | null): string | null {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return null;
  const mb = Math.max(0.1, bytes / (1024 * 1024));
  return `${mb.toLocaleString("id-ID", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB`;
}
