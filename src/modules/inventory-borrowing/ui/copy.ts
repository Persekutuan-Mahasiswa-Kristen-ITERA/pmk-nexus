import type { ItemNotice } from "./routes";

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

// ---- Part B: Operations, heads and BPH (design screens 4, 5, 8-13) ----
// Strings marked NEW are not in the design or the contract; they follow the design's wording pattern
// and wait for the owner's approval (listed in the frontend report).

export const STAFF_COPY = {
  // Kelola Barang (7, 8)
  manageListsEmpty: "Kategori dan lokasi masih kosong. Isi daftarnya dulu supaya bisa dipilih di form barang.", // 8.3
  manageListsLink: "Kategori dan lokasi", // 8 path
  manageStatusLabel: "Tampilkan barang", // NEW (accessible name of the Aktif / Nonaktif / Semua tags)
  itemSaved: "Perubahan disimpan.", // 7.5
  itemReactivated: "Barang diaktifkan kembali.", // 7.5
  codeAuto: "Dibuat otomatis saat disimpan.", // 7.2
  unitCodeAuto: "Kode dibuat otomatis saat disimpan.", // 7.2
  codeFixed: "Kode tidak bisa diubah.", // 7.3
  modeFixed: "Pilihan ini tidak bisa diubah setelah barang pernah dipinjam.", // 7.1
  onlyGoodLendable: "Hanya yang Baik yang bisa dipinjam.", // 7.2
  noCategoryOption: "Belum ada kategori", // 7.4
  noLocationOption: "Belum ada lokasi", // 7.4 ("or locations")
  addCategoryLink: "Tambah kategori", // 7.4
  addLocationLink: "Tambah lokasi", // 7.4 pattern
  modeMissing: "Pilih cara mencatat barang ini.", // 7.4
  nameMissing: "Isi nama barang.", // 7.4
  stockMissing: "Isi minimal satu barang.", // 7.4
  unitsMissing: "Tambahkan minimal satu unit.", // 7.4
  unitConditionMissing: "Pilih kondisi unit.", // 7.4
  quantityFromOne: "Isi angka bulat, mulai 1.", // 7.6a
  reasonMissing: "Tulis alasannya.", // 7.6c
  reasonWorseMissing: "Tulis alasannya, misalnya apa yang rusak.", // 7.6b
  writeOffHint: "Tulis hilang atau dibuang, dan alasannya.", // 7.6c
  writeOffQuantityBody: "Jumlah ini dikurangi dari stok. Riwayatnya tetap tersimpan.", // 7.6c
  archiveItemTitle: "Nonaktifkan barang?", // 7.6d
  archiveItemBody: "Barang ini hilang dari katalog dan dari form pengajuan. Kamu bisa mengaktifkannya lagi kapan saja.", // 7.6d
  archiveUnitBody: "Unit ini tidak bisa dipinjam lagi. Kamu bisa mengaktifkannya lagi kapan saja.", // NEW (unit variant of 7.6d)
  restoreTitle: "Ditemukan kembali", // contract history label
  restoreBody: "Unit {kode} kembali ke stok dengan kondisinya sekarang. Riwayat hilangnya tetap tersimpan.", // NEW (G7 / A-IB45)
  unitsLoadingLists: "Memuat daftar...", // 8.3

  // Kategori dan lokasi (8)
  listNameMissing: "Isi nama.", // 8.2
  listRenamed: "Nama diubah.", // 8.2
  listDeactivateBody: "Barang yang memakainya tetap memakai nama ini. Tidak bisa dipilih untuk barang baru.", // 8.2
  listKindNav: "Jenis daftar", // NEW (accessible name of the Kategori / Lokasi control)

  // Antrean (11, 14)
  queueSearchLabel: "Cari pengajuan", // NEW (hidden label)
  queueSearchPlaceholder: "Cari nama pemohon atau barang...", // 11.1
  queueLoading: "Memuat antrean...", // 11.5
  queueEmptyPending: "Tidak ada pengajuan yang menunggu.", // 11.5
  queueEmptyOther: "Tidak ada pengajuan di sini.", // 11.5
  queuePeriodLabel: "Periode", // NEW
  queueAllPeriods: "Semua periode", // NEW
  loneHeadHint: "Hanya kamu yang bisa menyetujui saat ini. Pengajuanmu sendiri menunggu kepala lain.", // 11.1
  openLoansInfo:
    "Daftar ini untuk serah terima pengurus. Isinya semua pengajuan yang belum selesai, termasuk dari periode sebelumnya.", // 14.1
  openLoansEmpty: "Tidak ada pengajuan yang belum selesai.", // 14.3
  openLoansExportIntro: "Unduh daftar peminjaman yang belum selesai sebagai:", // 15.2

  // Detail Pengajuan, head and Operations (11.2-11.4)
  ownRequestOneHead: "Saat ini hanya ada satu pemberi persetujuan, jadi pengajuan ini menunggu kepala lain.", // 11.2
  approveNoteLowered: "Tulis kenapa jumlahnya dikurangi.", // 11.3
  approveNothing: "Setujui minimal satu barang. Kalau tidak ada yang bisa dipinjamkan, tolak pengajuan ini.", // NEW
  rejectHint: "Pemohon akan membaca alasan ini.", // 11.3
  rejectMissing: "Tulis alasan penolakan, supaya pemohon tahu.", // 11.3
  extendNoteMissing: "Tulis alasan perpanjangan.", // 11.3
  correctTitle: "Kembalikan status ke Dipinjam?", // 11.4
  correctBody:
    "Pakai ini hanya untuk memperbaiki salah catat pengembalian. Koreksi hanya bisa sekali per pengajuan, dan ditolak kalau stok barang sudah berubah. Tindakan ini tercatat.", // 11.4
  correctMissing: "Tulis alasan koreksi.", // 11.4

  // Notices on the detail after a staff action (11.5, 12.3, 13.5)
  approved: "Pengajuan disetujui.",
  rejected: "Pengajuan ditolak.",
  extended: "Tanggal kembali diubah.",
  handedOver: "Serah terima tercatat. Status: Dipinjam.",
  returnedAll: "Pengembalian tercatat. Semua barang sudah kembali.",
  returnedIssue: "Pengembalian tercatat. Ada barang rusak atau hilang.",
  corrected: "Pengembalian dikoreksi. Status kembali Dipinjam.", // NEW

  // Serahkan barang (12)
  handoverLoading: "Memuat serah terima...", // 12.4
  handoverOwn: "Kamu mencatat serah terima pengajuanmu sendiri. Riwayat mencatat namamu sebagai pencatat.", // 12.1
  handoverNoteMissing: "Tulis kenapa jumlahnya kurang dari yang disetujui.", // 12.2
  addNote: "Tambah catatan", // 12.1
  searchCode: "Cari kode", // 12.1

  // Terima pengembalian (13)
  returnLoading: "Memuat pengembalian...", // 13.6
  returnOwn: "Kamu mencatat pengembalian pengajuanmu sendiri. Riwayat mencatat namamu sebagai pencatat.", // 13.6
  returnConditionMissing: "Pilih kondisi barang sekarang.", // 13.2
  returnNoteMissing: "Tulis catatan: apa yang rusak atau hilang.", // 13.2
  returnNothing: "Catat minimal satu barang yang kembali.", // NEW
  returnConfirmTitle: "Simpan pengembalian?", // 13.4
  waitForPhotos: "Tunggu sampai semua foto selesai diunggah.", // 13.3
  photoFailedSave: "Foto gagal diunggah. Coba lagi.", // 13.3
  photoHint: "Foto diperkecil otomatis sebelum diunggah.", // 13.1
  photoMax: "Maksimal 3 foto.", // 13.3
  photoStillTooLarge: "Foto masih terlalu besar setelah diperkecil. Coba foto lain.", // 13.3
  photoUnreadable: "Foto ini tidak bisa dibuka. Coba foto lain.", // BUG-IB-02, owner-approved 2026-11-09

  // Dashboard card (16)
  dashTitle: "Inventaris Status",
  dashLoading: "Memuat inventaris...",
  dashEmpty: "Belum ada barang di inventaris.",
  dashError: "Data inventaris belum bisa dimuat.",
  dashCatalogLink: "Lihat katalog",
} as const;

/** "{n} unit disimpan: INV-0043 sampai INV-0045." (7.5); one unit names its single code (NEW variant). */
export function unitsSavedText(count: number, first: string, last: string): string {
  return count === 1 || first === last ? `1 unit disimpan: ${first}.` : `${count} unit disimpan: ${first} sampai ${last}.`;
}

/** The success text for an item notice from the address (design 7.5); null when there is none. */
export function itemNoticeText(notice: ItemNotice | null): string | null {
  if (!notice) return null;
  switch (notice.kind) {
    case "created_quantity":
      return itemSavedText(notice.code);
    case "created_tracked":
      return unitsSavedText(notice.count, notice.first, notice.last);
    case "saved":
      return STAFF_COPY.itemSaved;
    case "reactivated":
      return STAFF_COPY.itemReactivated;
  }
}

/** "Barang disimpan. Kodenya INV-0042." (7.5) */
export function itemSavedText(code: string): string {
  return `Barang disimpan. Kodenya ${code}.`;
}

/** "Pengembalian tercatat. Masih di peminjam: {n}." (13.5) */
export function returnedPartialText(n: number): string {
  return `Pengembalian tercatat. Masih di peminjam: ${n}.`;
}

/** "{n} pengajuan lain berstatus Diajukan di tanggal yang sama. ..." (11.2) */
export function pendingOverlapText(n: number): string {
  return `${n} pengajuan lain berstatus Diajukan di tanggal yang sama. Menyetujui satu bisa membuat yang lain tidak kebagian.`;
}

/** Card warning line "2 pengajuan lain di tanggal sama" (11.1). */
export function pendingOverlapShort(n: number): string {
  return `${n} pengajuan lain di tanggal sama`;
}

/** "Hanya {n} unit baik yang bisa diserahkan, padahal disetujui {m}. ..." (12.2) */
export function fewUnitsText(n: number, m: number): string {
  return `Hanya ${n} unit baik yang bisa diserahkan, padahal disetujui ${m}. Serahkan yang ada dan tulis alasannya.`;
}

/** "Dipilih 1, disetujui 2. Tulis kenapa jumlahnya kurang." (12.1); quantity items say "Diserahkan" (NEW). */
export function handoverShortText(verb: "Dipilih" | "Diserahkan", n: number, m: number): string {
  return `${verb} ${n}, disetujui ${m}. Tulis kenapa jumlahnya kurang.`;
}

/** "Pilih tanggal setelah {tanggal sekarang}." (11.3) */
export function extendAfterText(date: string): string {
  return `Pilih tanggal setelah ${date}.`;
}

/** "Jumlah melebihi yang belum kembali ({n})." (13.2) */
export function overReturnText(n: number): string {
  return `Jumlah melebihi yang belum kembali (${n}).`;
}

/** "Isi angka bulat, paling banyak {n}." (12.2) */
export function atMostText(n: number): string {
  return `Isi angka bulat, paling banyak ${n}.`;
}

/** "Pilih paling banyak {n} unit." (12.2) */
export function atMostUnitsText(n: number): string {
  return `Pilih paling banyak ${n} unit.`;
}
