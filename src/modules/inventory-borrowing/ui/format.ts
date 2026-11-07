// Date and number display for the inventory screens (docs/design/inventory-borrowing.md 3.5).
// Dates arrive as "YYYY-MM-DD" Jakarta calendar days; timestamps as ISO strings shown in WIB.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

function parts(date: string): { y: number; m: number; d: number } {
  const [y, m, d] = date.split("-").map(Number);
  return { y, m, d };
}

/** "10 Des 2026". */
export function formatDate(date: string): string {
  const { y, m, d } = parts(date);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/**
 * Range: same day "10 Des 2026"; same month "10-12 Des 2026"; across months "30 Nov-2 Des 2026";
 * across years "30 Des 2026-2 Jan 2027".
 */
export function formatRange(start: string, end: string): string {
  if (start === end) return formatDate(start);
  const a = parts(start);
  const b = parts(end);
  if (a.y !== b.y) return `${formatDate(start)}-${formatDate(end)}`;
  if (a.m !== b.m) return `${a.d} ${MONTHS[a.m - 1]}-${b.d} ${MONTHS[b.m - 1]} ${b.y}`;
  return `${a.d}-${b.d} ${MONTHS[b.m - 1]} ${b.y}`;
}

/** Short range without the year when both dates are in the current year ("10-12 Des"), for line hints. */
export function formatRangeShort(start: string, end: string, today: string): string {
  const year = today.slice(0, 4);
  const full = formatRange(start, end);
  if (start.slice(0, 4) === year && end.slice(0, 4) === year) return full.replace(` ${year}`, "");
  return full;
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

/** "9 Des 2026, 14.05 WIB". */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const map = Object.fromEntries(WIB.formatToParts(date).map((p) => [p.type, p.value]));
  const hour = map.hour === "24" ? "00" : map.hour;
  return `${Number(map.day)} ${MONTHS[Number(map.month) - 1]} ${map.year}, ${hour}.${map.minute} WIB`;
}

/** Thousands with a dot, as Indonesians write them ("1.204"). */
export function formatCount(value: number): string {
  return value.toLocaleString("id-ID");
}
