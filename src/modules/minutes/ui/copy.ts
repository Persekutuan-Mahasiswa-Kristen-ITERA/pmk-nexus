// UI-only strings of the Meeting Minutes screens that the contract (MINUTE_COPY) does not hold. Each one
// repeats the wording the Letters screens already use for the same moment (src/modules/letters/ui/copy.ts),
// so the two modules read alike. All are GAP texts: listed in the frontend report for the tech lead to
// record as [ASSUMPTION] or move into the contract.

export const UI_COPY = {
  /** Network failure or timeout of a Server Action, upload or export (Letters 3.3). */
  network: "Tidak bisa terhubung. Periksa internetmu lalu coba lagi.",
  /** Busy label of every save button (Letters). */
  saving: "Menyimpan...",
  /** Button under a "Data sudah berubah" message (Letters 3.4). */
  reload: "Muat ulang",
  /** Search field label for screen readers (Letters "Cari surat"). */
  searchLabel: "Cari notulensi",
  /** Loading captions (Letters "Memuat surat..."). */
  loadingList: "Memuat notulensi...",
  loadingDashboard: "Memuat notulensi...",
  /** Unit select with more than one choice: the empty first option ("Pilih unit." without the period). */
  unitPlaceholder: "Pilih unit",
  /** File picker states (Letters 3.3). */
  resizing: "Memperkecil...",
  uploading: "Mengunggah {n}%",
  uploaded: "Terunggah",
  fileStillBusy: "Tunggu sampai semua berkas selesai diunggah.",
  fileUnreadable: "Berkas ini tidak bisa dibaca. Pilih berkas lain.",
  /** Edit page for a minute this person may read but not change (Letters 7.7 "Kembali ke surat"). */
  backToMinute: "Kembali ke notulensi",
} as const;
