// Indonesian screen copy for Manajemen & Inventaris, word for word from
// docs/design/inventory-borrowing.md (section numbers in the comments). Error texts are NOT here:
// they come from the contract (inventoryErrorMessage, INVENTORY_ERROR_COPY) in ../types.ts. Only the
// per-field texts the contract leaves to the UI (code `null` there) are listed under FIELD_ERRORS.

export const COPY = {
  moduleTitle: "Manajemen & Inventaris", // 4.1
  navLabel: "Bagian inventaris", // 4.6
  unavailable: "Terjadi gangguan. Coba lagi sebentar lagi.", // 3.6 (= contract unavailable)
  network: "Tidak bisa terhubung. Periksa internetmu lalu coba lagi.", // 3.6
  noActivePeriod: "Belum ada periode aktif. Pengajuan belum bisa dibuat.", // 3.6
  searchTooLong: "Kata pencarian terlalu panjang. Pakai paling banyak 120 karakter.", // 3.6
  exportInvalid: "Ekspor ditolak karena filter tidak cocok. Muat ulang halaman, lalu coba lagi.", // 15.2
  stateChanged: "Data sudah berubah. Muat ulang.", // 3.6

  // Katalog (5)
  catalogSearchLabel: "Cari barang",
  catalogSearchPlaceholder: "Cari nama atau kode barang...",
  catalogLoading: "Memuat barang...",
  catalogEmpty: "Belum ada barang di inventaris.",
  catalogEmptyMember: "Barang akan muncul di sini setelah tim Operasional menambahkannya.",
  noMatch: "Tidak ada hasil. Ubah pencarian atau filter.",
  noCategory: "Tanpa kategori",
  noLocation: "Lokasi belum diatur",

  // Availability (6.2, 9.3)
  checking: "Memeriksa ketersediaan...",
  availabilityError: "Ketersediaan tidak bisa dimuat. Coba lagi.",
  availabilityLineError: "Ketersediaan tidak bisa dimuat.",
  noneFree: "Tidak tersedia pada tanggal itu. Coba tanggal lain.",
  inclusiveHint: "Sampai tanggal ini ikut dihitung.",
  pickDatesFirst: "Pilih tanggal untuk melihat ketersediaan.",
  noGoodStock: "Belum ada yang berkondisi baik, jadi barang ini belum bisa dipinjam.", // 6.3

  // Request form (9)
  formLoading: "Memuat form...",
  pickerEmpty: "Belum ada barang yang bisa dipinjam.",
  pickerNoMatch: "Tidak ada hasil. Ubah pencarian.",
  alreadyAdded: "Sudah ditambahkan",
  outsidePartyNote:
    "Kamu tercatat sebagai pencatat. Nomor telepon dan email tidak disimpan di NEXUS. Hubungi mereka di luar aplikasi.",
  discardTitle: "Buang perubahan?", // 3.4

  // Peminjaman Saya (10)
  requestsLoading: "Memuat pengajuan...",
  noRequests: "Kamu belum punya pengajuan.",
  noRequestsForFilter: "Tidak ada pengajuan di sini.",
  sent: "Pengajuan terkirim. Cek statusnya di Peminjaman Saya.", // 9 path
  cancelled: "Pengajuan dibatalkan.", // 10.5
  cancelBody: "Pengajuan tidak bisa dibuka lagi. Kamu bisa membuat pengajuan baru.", // 10.4
  photosError: "Foto tidak bisa dimuat. Coba lagi.", // 10.4
} as const;

/** "Pengajuan untuk {organisasi} tersimpan. Menunggu persetujuan." (9.4) */
export function sentOutsideText(orgName: string): string {
  return `Pengajuan untuk ${orgName} tersimpan. Menunggu persetujuan.`;
}

/** "Menampilkan 1-20 dari 42 barang" (5.1, 10.1). */
export function rangeText(from: number, to: number, total: number, noun: string, format: (n: number) => string): string {
  return `Menampilkan ${format(from)}-${format(to)} dari ${format(total)} ${noun}`;
}

/** Per-field texts for the error codes the contract marks `null` (design 9.2, 10.4). */
export const FIELD_ERRORS = {
  startMissing: "Pilih tanggal mulai.",
  endMissing: "Pilih tanggal akhir.",
  orgMissing: "Isi nama organisasi.",
  contactMissing: "Isi nama penanggung jawab.",
  linesMissing: "Tambahkan minimal satu barang.",
  quantityInvalid: "Isi angka bulat, mulai 1.",
  purposeMissing: "Isi keperluannya, misalnya nama kegiatan atau tim.",
  cancelReasonMissing: "Tulis alasan pembatalan.",
} as const;

/** "{Field} terlalu panjang. Pakai paling banyak {n} karakter." (9.2) */
export function tooLongText(field: string, max: number): string {
  return `${field} terlalu panjang. Pakai paling banyak ${max} karakter.`;
}

/** "Hanya {n} yang tersedia pada tanggal itu." (9.2, quantity field) */
export function onlyFreeText(n: number): string {
  return `Hanya ${n} yang tersedia pada tanggal itu.`;
}

/** "Ada {n} isian yang perlu diperbaiki." (3.4) */
export function fixCountText(n: number): string {
  return `Ada ${n} isian yang perlu diperbaiki.`;
}
