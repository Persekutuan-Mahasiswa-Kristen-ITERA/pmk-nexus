// UI-only strings of the Finance screens that the contract (FINANCE_COPY) does not hold. Each one repeats
// the wording the Letters and Meeting Minutes screens already use for the same moment, so the modules read
// alike. All are GAP texts: listed in the frontend report for the tech lead to record as [ASSUMPTION] or
// move into the contract.

export const UI_COPY = {
  /** Network failure or timeout of a Server Action, upload or export (Letters 3.3). */
  network: "Tidak bisa terhubung. Periksa internetmu lalu coba lagi.",
  /** Busy label of every save button (Letters). */
  saving: "Menyimpan...",
  /** Button under a "Data sudah berubah" message (Letters 3.4). */
  reload: "Muat ulang",
  /** Search field label for screen readers. */
  searchLabel: "Cari transaksi",
  /** Loading captions. */
  loadingList: "Memuat transaksi...",
  loadingDashboard: "Memuat finance...",
  /** File picker states (Letters 3.3). */
  resizing: "Memperkecil...",
  uploading: "Mengunggah {n}%",
  uploaded: "Terunggah",
  fileStillBusy: "Tunggu sampai semua berkas selesai diunggah.",
  fileUnreadable: "Berkas ini tidak bisa dibaca. Pilih berkas lain.",
  /** Accessible names. */
  summaryLabel: "Ringkasan keuangan periode",
  typeSegments: "Jenis transaksi",
  /** Amount field: the sign of Rp is shown as a prefix box, not typed. */
  amountPrefix: "Rp",
  /** Period select: marks the active period inside the option text. */
  activeSuffix: "(aktif)",
  /** Table column headers (spec 7 screen 1: Tanggal, Keterangan, Jumlah, plus the number and type). */
  columns: { date: "Tanggal", number: "Nomor", description: "Keterangan", type: "Jenis", amount: "Jumlah", proof: "Bukti" },
  /** Check sheet: lines. */
  checkDescription: "Keterangan",
  checkProofCount: "Bukti: {n} berkas",
  /** Opening form copy that is not in the contract: the "Pakai angka ini" source when it is negative. */
  previousNegativeNote: "Saldo akhir periode sebelumnya minus, jadi tidak bisa dipakai sebagai angka awal.",
  /** Dashboard card / list: the opening line label shown as a figure. */
  openingFigure: "Saldo awal",
  /** Detail: a row without a value. */
  none: "-",
  /** Record form header line (screen 3 has none in the spec; reuses the page tone). */
  recordSubtitle: "Catatan keuangan tidak bisa diubah setelah disimpan.",
  openingSubtitle: "Dicatat sekali per periode, dari hitungan kas dan saldo bank yang sebenarnya.",
} as const;
