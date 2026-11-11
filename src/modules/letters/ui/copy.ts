// Screen copy of the Letters module, word for word from docs/design/letters.md (section numbers in the
// comments). Error texts live in the contract (types.ts: letterErrorMessage). Strings marked NEW are
// not in the design or the contract: they follow its wording and are listed in the frontend report.

export const COPY = {
  moduleTitle: "Surat Menyurat",
  navLabel: "Bagian surat menyurat", // 4.6
  leadRegister: "Arsip surat resmi PMK ITERA.", // 3.1
  leadMember: "Ajukan surat ke sekretaris dan pantau prosesnya di sini.", // 3.1
  noPeriodRequest: "Belum ada periode aktif. Permohonan belum bisa dibuat.", // 3.4
  numberTakenLead: "Nomor diambil: ", // 3.4, number in bold after it
  numberTakenTail: ". Pakai nomor ini di suratnya, lalu terbitkan dengan berkas finalnya.",
  noPeriodLetter: "Belum ada periode aktif. Surat belum bisa dicatat.", // 3.4, 7.7
  unavailable: "Terjadi gangguan. Coba lagi sebentar lagi.",
  network: "Tidak bisa terhubung. Periksa internetmu lalu coba lagi.", // 3.3
  stateChanged: "Data sudah berubah. Muat ulang.", // 3.4
  discardTitle: "Buang perubahan?", // inventory 3.4

  // Register list (5)
  searchLabel: "Cari surat", // 5.2
  searchIncoming: "Cari nomor, pengirim, atau perihal...", // 5.1
  searchOutgoing: "Cari nomor, tujuan, atau perihal...", // 5.1
  filterTitle: "Filter Surat", // 5.1
  withoutFiles: "Tanpa berkas", // 5.1
  emptyIncoming: "Belum ada surat masuk.", // 5.3
  emptyOutgoing: "Belum ada surat keluar.", // 5.3
  emptyManager: "Catat surat pertama dengan tombol di atas.", // 5.3
  emptyViewer: "Surat akan muncul di sini setelah sekretaris mencatatnya.", // 5.3
  emptyPeriod: "Belum ada surat di periode ini.", // 5.3
  noMatch: "Tidak ada hasil. Ubah pencarian atau filter.", // 5.3, 11.2
  noFile: "Belum ada berkas", // 5.2
  awaitingFile: "Menunggu file final", // 5.2
  fromRequest: "Dari permohonan", // 5.1
  exportNote: "Surat yang dibatalkan ikut diunduh dengan statusnya.", // 14.2

  // Number plate (3.2, 3.4)
  plateLabel: "Nomor surat",
  copyNumber: "Salin nomor",
  copied: "Nomor disalin.",
  copyFailed: "Nomor tidak bisa disalin. Pilih nomornya lalu salin sendiri.",

  // Letter detail (6)
  letterNotFound: "Surat ini tidak ditemukan.",
  backToList: "Kembali ke daftar",
  filesTitle: "Berkas",
  noFiles: "Belum ada berkas.", // 6.4
  managerNoFiles: "Belum ada berkas. Tambahkan berkas setelah suratnya selesai.", // 6.2
  filesFull: "Sudah 3 berkas. Tarik satu kalau perlu menggantinya.", // 6.3
  fileOpenFailed: "Berkas tidak bisa dibuka. Coba lagi.", // 3.4
  historyTitle: "Riwayat",
  detailsTitle: "Rincian",

  // Notices (6.4, 7.5)
  edited: "Perubahan disimpan.",
  filesAdded: "Berkas ditambahkan.",
  fileWithdrawn: "Berkas ditarik.",
  voided: "Nomor dibatalkan.",
  registerAnother: "Catat surat lain", // 7.5, X9
  registeredLead: "Surat dicatat. Nomornya ", // 7.5, number in bold after it

  // Register form (7)
  numberAutoIncoming: "Dibuat otomatis saat disimpan dan tidak bisa diubah.", // 7.1
  numberSettingsLink: "Lihat pengaturan nomor.", // 7.1
  numberAutoOutgoing:
    "Dibuat otomatis saat disimpan. Catat dulu untuk mendapat nomor, lalu tulis suratnya dengan nomor itu dan tambahkan berkasnya nanti.", // 7.2
  numberLegacyFirstCard: "Ditulis sendiri di bawah.", // 7.1 ("Nomor surat: ditulis sendiri di bawah")
  legacyTitle: "Surat lama", // 7.1
  legacyHint: "Pilih ini untuk mencatat surat yang sudah punya nomor dari sebelum NEXUS.", // 7.1
  legacyInfo:
    "Nomor ini dicatat apa adanya dan tidak menggeser urutan nomor otomatis. Nomor yang sudah ada tidak bisa dicatat dua kali.", // 7.1
  legacyCheckTitle: "Periksa nomor lama", // 7.5 (P9)
  numberLocked: "Nomor tidak bisa diubah.", // 7.3
  nothingChanged: "Belum ada yang diubah.", // 7.5
  firstUseHint:
    "Nomor pertama akan menjadi 001. Kalau PMK sudah punya surat bernomor tahun ini, minta System Admin mengatur nomor berikutnya dulu.", // 7.6
  notEditable: "Surat ini tidak bisa diubah.", // 7.7
  backToLetter: "Kembali ke surat", // 7.7

  // Dialogs on the letter detail (8)
  voidTitle: "Batalkan nomor?",
  voidMissing: "Tulis alasan pembatalan.",
  withdrawTitle: "Tarik berkas?",
  withdrawMissing: "Tulis kenapa berkas ini ditarik.",
  withdrawBlocked: "Ini satu-satunya berkas yang dilihat pemohon. Tambahkan berkas pengganti dulu, lalu tarik yang salah.",
  addFilesTitle: "Tambah berkas",

  // FilePicker (3.3)
  fileHint: "PDF, JPG, atau PNG. Paling besar 4 MB.",
  fileResizeHint: "Foto diperkecil otomatis sebelum diunggah.",
  fileMax: "Maksimal 3 berkas.",
  fileStillBusy: "Tunggu sampai semua berkas selesai diunggah.",
  fileFailed: "Berkas gagal diunggah. Coba lagi.",
  fileUnreadable: "Berkas ini tidak bisa dibaca. Pilih berkas lain.", // NEW: a picked image that cannot be decoded

  // Request form (9)
  requestFormInfo: "Sekretaris akan menyiapkan dan menerbitkan suratnya. Kamu bisa mengunduh hasilnya di Permohonan Saya.", // 9.1
  againInfo: "Diisi dari permohonan sebelumnya. Periksa lagi sebelum mengirim.", // 9.1
  subjectHint: "Tulis pokok isi surat dalam satu kalimat.",
  addresseeHint: "Nama orang atau lembaga yang menerima surat.",
  purposeHint: "Jelaskan apa yang dibutuhkan: kegiatan, tanggal, dan hal lain yang perlu masuk ke surat.",
  onBehalfHint: "Isi kalau suratnya atas nama panitia atau tim, misalnya nama kegiatan.",
  neededByHint: "Sekretaris melihat tanggal ini di antrean.",
  attachmentsHint: "Lampirkan berkas pendukung, misalnya proposal atau draf.",
  sent: "Permohonan terkirim. Cek statusnya di Permohonan Saya.", // 9.4

  // Permohonan Saya (10)
  noRequests: "Kamu belum punya permohonan.", // 10.5
  noRequestsForFilter: "Tidak ada permohonan di sini.", // 10.5
  requestNotFound: "Permohonan ini tidak ditemukan.", // 10.5
  cancelled: "Permohonan dibatalkan.", // 10.4
  cancelTitle: "Batalkan permohonan?",
  cancelText: "Permohonan tidak bisa dibuka lagi. Kamu bisa membuat permohonan baru.",

  // Antrean (11)
  queueEmptyWaiting: "Tidak ada permohonan yang menunggu.",
  queueEmptyOther: "Tidak ada permohonan di sini.",
  handoverInfo:
    "Daftar ini untuk serah terima pengurus. Isinya semua permohonan yang belum selesai, termasuk dari periode sebelumnya.", // 11.3
  handoverEmpty: "Tidak ada permohonan yang belum selesai.",
  loneProcessor: "Hanya kamu yang bisa memproses saat ini. Permohonanmu sendiri menunggu sekretaris lain.", // 3.4
  ownMarker: "Pengajuanmu",

  // Review (12)
  ownRequest: "Tidak bisa memproses permohonanmu sendiri. Sekretaris lain yang memutuskan.", // 3.4
  ownRequestManager: "Kamu bisa mencatat suratmu langsung di Surat Keluar.", // 3.4
  ownRequestLone: "Saat ini hanya ada satu sekretaris yang bisa memproses, jadi permohonan ini menunggu sekretaris lain.", // 12.1
  requesterInactive: "Pemohon sudah tidak aktif. Permohonan tetap bisa diproses.", // 12.1
  awaitingFileProcessor:
    "Nomor sudah diambil, menunggu file final. Tulis suratnya dengan nomor ini, minta tanda tangan, lalu unggah berkasnya lewat Terbitkan surat.", // 3.4
  processTitle: "Proses permohonan?",
  processText: "Pemohon akan melihat permohonannya sedang diproses dan tidak bisa membatalkannya lagi.",
  processed: "Permohonan diproses.",
  takeTitle: "Ambil nomor surat?",
  takeText:
    "Sistem membuat nomor surat sekarang, dan nomor itu langsung final. Nomor tidak bisa diubah dan tidak akan dipakai lagi, juga kalau permohonan ini nanti ditolak. Pemohon bisa melihat nomornya. Berkas suratnya menyusul setelah suratnya ditandatangani.",
  rejectTitle: "Tolak permohonan?",
  rejectHint: "Pemohon akan membaca alasan ini.",
  rejectMissing: "Tulis alasan penolakan, supaya pemohon tahu.",
  rejected: "Permohonan ditolak.",
  actionsTitle: "Tindakan", // 12.1

  // Terbitkan (12.3)
  issueTitle: "Terbitkan surat",
  issuePlateNote: "Nomor ini sudah diambil dan tidak bisa diubah. Pastikan berkas finalnya memakai nomor ini.",
  issueNeedsNumber: "Ambil nomor dulu sebelum menerbitkan surat.",
  backToRequest: "Kembali ke permohonan",
  issueCheckTitle: "Terbitkan surat ini?",
  seeInRegister: "Lihat di register",
  fileRequired: "Tambahkan minimal satu berkas surat.",

  // Penomoran Surat (13)
  numberingTitle: "Penomoran Surat",
  numberingInfo: "Perubahan hanya berlaku untuk surat yang dinomori sesudahnya. Nomor yang sudah ada tidak berubah.",
  numberingReadOnly: "Hanya System Admin yang bisa mengubah penomoran. Hubungi admin PMK ITERA kalau ada yang perlu diubah.",
  numberingNotSet: "Kalau PMK sudah punya surat bernomor tahun ini, atur nomor berikutnya dulu sebelum sekretaris mencatat surat.",
  nextTitle: "Nomor berikutnya",
  formatTitle: "Format nomor",
  previewTitle: "Hasilnya untuk nomor berikutnya",
  formatCheckTitle: "Simpan format baru?",
  formatSaved: "Format disimpan.",
  setNextTitle: "Atur nomor berikutnya",
  nextSet: "Nomor berikutnya diatur.",
  setNextReasonPlaceholder: "Contoh: melanjutkan nomor dari buku surat.",
  setNextReasonMissing: "Tulis alasannya.",
  historyEmpty: "Belum ada perubahan.",
  changeHistoryTitle: "Riwayat perubahan",

  // Dashboard card (15)
  dashTitle: "Surat Menyurat",
  dashEmpty: "Belum ada surat di periode ini.",
  dashLoading: "Memuat data surat...",
  dashError: "Data surat belum bisa dimuat.",
  dashLink: "Buka register",

  // Skeleton captions (3.4)
  loadingLetters: "Memuat surat...",
  loadingRequests: "Memuat permohonan...",
  loadingQueue: "Memuat antrean...",
  loadingForm: "Memuat form...",
  loadingSettings: "Memuat pengaturan...",
} as const;

/** "Ada {n} isian yang perlu diperbaiki." (inventory 3.4) */
export function fixCountText(n: number): string {
  return `Ada ${n} isian yang perlu diperbaiki.`;
}

/** "Menampilkan 1-20 dari 42 surat" (5.1). */
export function rangeText(from: number, to: number, total: number, noun: string, format: (n: number) => string): string {
  return `Menampilkan ${format(from)}-${format(to)} dari ${format(total)} ${noun}`;
}

/** "Surat terbit. Berkas dipasang pada nomor {nomor}." (12.7) */
export function issuedText(numberText: string): string {
  return `Surat terbit. Berkas dipasang pada nomor ${numberText}.`;
}

/** "Permohonan ditolak. Nomor {nomor} dibatalkan di register." (12.2) */
export function rejectedWithNumberText(numberText: string): string {
  return `Permohonan ditolak. Nomor ${numberText} dibatalkan di register.`;
}

/** "Boleh menambah {n} berkas lagi." (8.3) */
export function filesRoomText(n: number): string {
  return `Boleh menambah ${n} berkas lagi.`;
}
