import type { MemberExportFormat, MemberStatusFilter } from "../types";

// Indonesian wording for the Data Anggota screen. Lines marked "spec" come from
// docs/modules/member-data.md (F2-F6); the others are proposals waiting for the owner (see report).

export const STATUS_OPTION_LABEL: Record<MemberStatusFilter, string> = {
  active: "Aktif", // spec M1
  inactive: "Nonaktif",
  all: "Semua",
};

export const EXPORT_FORMAT_LABEL: Record<MemberExportFormat, string> = {
  xlsx: "Excel (.xlsx)",
  csv: "CSV (.csv)",
  pdf: "PDF (.pdf)",
};

export const COPY = {
  searchPlaceholder: "Cari nama anggota...", // spec F2 proposal (no NIM)
  searchLabel: "Cari nama anggota",
  noMatch: "Tidak ada anggota yang cocok. Ubah pencarian atau filter.", // spec F6
  noActiveMembers: "Belum ada anggota aktif.", // proposal
  unavailable: "Terjadi gangguan. Coba lagi sebentar lagi.", // spec F6
  accessChanged: "Aksesmu sudah berubah. Masuk lagi atau hubungi admin PMK ITERA.", // spec F5 / F6
  network: "Tidak bisa terhubung. Periksa internetmu lalu coba lagi.", // login copy (D-017)
  searchTooLong: "Kata pencarian terlalu panjang. Pakai paling banyak 120 karakter.", // proposal
  filterInvalid: "Filter ini tidak bisa dipakai. Atur ulang filter, lalu coba lagi.", // proposal
  exportInvalid: "Ekspor ditolak karena filter tidak cocok. Muat ulang halaman, lalu coba lagi.", // proposal
} as const;

/** "Menampilkan 21-40 dari 187 anggota" (spec F4). */
export function rangeText(from: number, to: number, total: number): string {
  return `Menampilkan ${formatCount(from)}-${formatCount(to)} dari ${formatCount(total)} anggota`;
}

/** Thousands with a dot, as Indonesians write them ("1.204"). */
export function formatCount(value: number): string {
  return value.toLocaleString("id-ID");
}
