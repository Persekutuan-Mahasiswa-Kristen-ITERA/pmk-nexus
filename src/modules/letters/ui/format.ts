// Date, number and size display for the Letters screens (design 3.2, inventory-borrowing 3.5).
// Dates arrive as "YYYY-MM-DD" Jakarta calendar days; timestamps as ISO strings shown in WIB.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

/** "14 Okt 2026". */
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

/** "14 Okt 2026, 10.12 WIB". */
export function formatDateTime(iso: string): string {
  const map = wibParts(iso);
  if (!map) return "";
  const hour = map.hour === "24" ? "00" : map.hour;
  return `${Number(map.day)} ${MONTHS[Number(map.month) - 1]} ${map.year}, ${hour}.${map.minute} WIB`;
}

/** The Jakarta calendar day of a timestamp, "14 Okt 2026" (list cards say the day, not the minute). */
export function formatDay(iso: string): string {
  const map = wibParts(iso);
  if (!map) return "";
  return `${Number(map.day)} ${MONTHS[Number(map.month) - 1]} ${map.year}`;
}

/** Thousands with a dot, as Indonesians write them ("1.204"). */
export function formatCount(value: number): string {
  return value.toLocaleString("id-ID");
}

/** "1,2 MB" (decimal comma, design 3.3); very small files show "0,1 MB" rather than "0,0 MB". */
export function formatFileSize(bytes: number | null): string | null {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return null;
  const mb = Math.max(0.1, bytes / (1024 * 1024));
  return `${mb.toLocaleString("id-ID", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB`;
}

/**
 * The letter number split after every separator, so a long number wraps at "/" (design 3.2, K3).
 * Returns the parts; the screen puts a <wbr> between them. The stored text is never changed.
 */
export function numberParts(numberText: string): string[] {
  return numberText.split(/(?<=[/.-])/);
}

/** "PMK NEX SM 2026 012": the number read as one phrase by a screen reader (design 3.2). */
export function spokenNumber(numberText: string): string {
  return numberText.replace(/[/.-]+/g, " ").trim();
}

/** "BU" from "Budi Utomo"; one word gives its first two letters. Decorative only. */
export function initials(name: string | null): string {
  const words = (name ?? "").split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
