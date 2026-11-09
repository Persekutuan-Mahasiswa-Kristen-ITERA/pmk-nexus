# Finance / Keuangan (module spec)

> Status: **Approved 2026-11-09 (owner accepted all recommendations, D-027 / D-028).** One approval package in fast mode (D-026): this spec plus the screens in section 7 (including the Indonesian copy) count as the approved design; no separate UX round. Database, code, tests and docs proceed without stopping, but **owner approval is still needed before anything touches the hosted project, and the security review is mandatory and extra strict for this module.** Nothing is built yet. Recorded in `docs/DECISIONS.md` (D-028 Finance module rules; D-027 is the Meeting Minutes module) and in the context document (section 5.3).
> Sources: `CLAUDE.md` (4-8, 11, 17, 18), `docs/PMK-NEXUS-context.md` (4, 5.1, 5.3, 6), `docs/DECISIONS.md` (D-007, D-011, D-012, D-013, D-014, D-019, D-020, D-021, D-022, D-023, D-025, D-026), `docs/OPEN_QUESTIONS.md` (B3, B6, B18, B20, B37, C8, A-LT13, F5, F9, F11), `docs/modules/access-control.md` (keys `finance.*`, rules D02, D03, D24, D25, L1, L4-L8, L11, L12, R9, R11, R15, E1, E4, E15, AC-14, AC-15, AC-39 to AC-41, AC-58, AC-68), `docs/modules/letters.md` (structure template and reused patterns), `docs/picore/schema-report.md` (positions), `docs/design/stitch/screens.md` (05, 06, 07, Dashboard card 1).
> Tags: **[ASSUMPTION]** = my guess, still open unless section 9 marks it decided (A-FN1 to A-FN21, section 9, copied to `docs/OPEN_QUESTIONS.md` section K). **[UNKNOWN]** = no source. **K1-K6** = owner questions (section 10), all answered 2026-11-09. **FN-01 to FN-40** = acceptance criteria (section 11). Locked rules of access control are always written "access control L7" and so on.
> No code, no SQL. PMK facts (bank accounts, budgets, committees, the real cash balance) are NOT invented. Every number, account and note in Stitch is filler.

---

## 1. Purpose and scope

**Purpose.** Give the Treasurer one trustworthy record of the money PMK ITERA receives and spends, per management period, and give the board a read-only, exportable view of it.

**Analogy.** A cash book that is written in ink. Entries are only added. A wrong line is not scratched out; it is struck through with a written reason, and a corrected line is added below it. The balance is always recomputed from the lines, never typed.

**In scope**
- Transactions: **Pemasukan** (income), **Pengeluaran** (expense) and one **Saldo awal** (opening balance) entry per period.
- Totals per period: Total Pemasukan, Total Pengeluaran, Total Saldo (context 5.3).
- List with search and filters, detail page, record form, void ("Batalkan") with a reason, proof files (receipts, transfer slips).
- Export (Excel, CSV, PDF) with an append-only export log.
- The numbers for the Dashboard "Finance" card (the card belongs to the Dashboard module).

**Out of scope (Phase 1)**
- Budgets (RAB) or budget-versus-actual, invoices, reimbursements, payments, bank integration or statement import.
- Several cash accounts (kas tunai, rekening bank): decided one cash pool in Phase 1 (K4 a); categories [A-FN11]; attachments other than proof.
- Approval workflows: no approval exists, so access control L6 does not apply (K6 a, decided: no second-person check).
- A member-facing "transparency" summary: finance keys can never go to every active member (access control L12), so it cannot be offered without a new exception. Not proposed.
- Program of work (progja): not Phase 1. The module is self-contained (`src/modules/finance`); every entry carries `period_id`, so a progja budget can later link to entries by id without a rewrite.

NEXUS stores the entries itself (schema `nexus`). Identity is not copied: rows store `members.id`; names come from PI-CORE through `src/lib/picore/` (D-010). No email, phone, NIM or NIP anywhere (access control L4).

---

## 2. Who uses it and who may do what

Rights come from permission keys (access control 2.1), never from a person. **No new key is needed.** All three keys are sensitive (L12, D-013): they can never be granted to "every active member", and any rule that grants them needs a written reason.

| Key | Unlocks | Default holders |
|---|---|---|
| `finance.view` | Open Finance; read entries, totals, proof files; Dashboard Finance card | Role `bph`: Ketua Umum, Sekretaris Jenderal, Sekretaris Umum 1/2, Bendahara Umum 1/2 (D02). Included in `finance.manage` |
| `finance.manage` | Record entries, void entries, add and withdraw proof. Includes view. **Never editing** (K2 a, decided): the key text now reads "Record, void and correct transactions (active period)"; "correct" means void and re-record, or a linked correction entry, never changing a saved entry | Role `bendahara`: Bendahara Umum 1 and 2 (D24, B3) |
| `finance.export` | Export | Role `bph` (D03) and role `bendahara` (D25, explicit so the Treasurer keeps export if D03 is disabled) |

Both Bendahara Umum positions carry roles `bph` and `bendahara`, so a Treasurer gets view through two rules; this is fine (union, access control R2).

| Actor | Read | Record, void, proof | Export |
|---|---|---|---|
| Treasurer (P-BEND, Bendahara Umum 1 or 2) | Yes | Yes, in the active period | Yes |
| Other BPH (P-KETUM, P-SEKJEN) | Yes | **No** | Yes |
| System Admin without a BPH or Treasurer position (P-ADMIN) | **No** (B18, AC-03) | No | No |
| System Admin who is also Treasurer (P-ADMIN-BEND) | Yes | Yes | Yes (through the position, AC-68) |
| Kepala Departemen, Sekretaris Departemen, Kepala Divisi, Staff, plain member, lecturer | No | No | No |
| Treasurer of a PREVIOUS period only (P-OLD) | No | No | No |
| Deactivated, unlinked, anonymous | No (access control L1) | No | No |

**Rules that follow**
- Enforced in server code AND RLS on every table (CLAUDE.md 11, access control R10). A direct API call with a valid token must give the same result as the UI.
- Writes happen only through server functions: no user holds direct insert, update or delete rights on Finance tables.
- Buttons without the key are absent, not greyed. A direct link without `finance.view` shows the shared "no permission" page; API calls return no rows. The drawer item "Finance" shows only to `finance.view` holders (D-021).
- Either Treasurer may void an entry recorded by the other (K6 a, decided); the history names who did it.
- Known risk, accepted earlier (B37): a PI-CORE position-derived admin can create an assignment for themselves, for example a vacant Bendahara Umum 2, and NEXUS then grants Finance. NEXUS cannot fix this; it matters most for this module. Mitigation: raise it with the PI-CORE maintainer **before go-live** (suggest assignment writes for super_admin only); later a NEXUS report of assignments made shortly before finance activity (D-028).
- Treasurers and BPH read all periods (L8); only the active period can be written (L7).

---

## 3. User flows

Every step runs on the server. Each page and action checks session, active member (access control L1) and the key first. Mobile-first, 390 px. Dates are Jakarta calendar dates (WIB). Copy is in section 7.

### F1. Browse (`finance.view`)
1. The user opens "Finance". The header card shows the period selector (default: the active period) and the totals of the selected period: **Total Saldo**, **Total Pemasukan**, **Total Pengeluaran**, plus the opening balance line (K3).
2. List, newest date first (then newest number): date, number (`KAS-0012`), Keterangan, amount with sign, a chip for the type (Pemasukan, Pengeluaran, Saldo awal) and "Dibatalkan", a paperclip when a proof exists. Search on Keterangan, Catatan and number. Filters: Jenis, date range, "Tampilkan yang dibatalkan" (off by default), "Tanpa bukti". Server pagination, page size 20 [A-FN13].
3. The tiles always show the whole selected period, not the filtered rows; a "Hasil" line shows the filtered count [A-FN3].
4. An old period shows the banner "Periode {label} sudah selesai. Datanya hanya bisa dibaca."

### F2. Record income or expense (`finance.manage`)
1. The Treasurer taps "Catat transaksi".
2. Fields: **Jenis** (Pemasukan or Pengeluaran), **Tanggal** (default today, not in the future), **Jumlah (Rp)** (whole rupiah, 1 to 9.999.999.999 [A-FN1]), **Keterangan** (required), **Catatan** (optional), **Bukti** (optional, up to 3 files, K5).
3. A check sheet ("Cek dulu") repeats type, amount, date and Keterangan and says the entry cannot be changed afterwards. If the date is outside the period's start and end dates (informational in PI-CORE) the sheet adds a soft warning.
4. The server re-validates everything: active member, key, active period (R11), integer amount in range, date, field limits, file rules, and an idempotency token (pressing "Simpan" twice, or a retry after a timeout, saves one entry [A-FN10]). It saves status Aktif, `period_id` = the active period, recorder = the session member, the next number, and a history row.
5. She lands on the detail page. No active period: "Belum ada periode aktif. Transaksi belum bisa dicatat."

### F3. Record the opening balance (`finance.manage`) [K3 a: decided carry-over rule]
1. A hint on the Finance page (managers only, when the active period has no active Saldo awal): "Saldo awal periode ini belum dicatat." with the button "Catat saldo awal".
2. Same form, Jenis fixed to "Saldo awal". It shows the previous period's closing balance as a hint with the button "Pakai angka ini" (it does not prefill silently). The Treasurer should count the real cash and bank money and type that number.
3. At most one active Saldo awal per period (A-FN21). A wrong one is voided and a new one recorded. Saldo awal is not counted as income.

### F4. Void (`finance.manage`) [K2 a: decided, never edit]
1. "Batalkan transaksi" on the detail of an Aktif entry **of the active period**. Reason required.
2. The entry stays, shows "Dibatalkan" with who, when and why, and is excluded from every total. It cannot be restored. The detail then offers "Catat ulang": the record form prefilled with a copy, for the corrected entry.
3. An entry of an old period cannot be voided or changed (access control L7, AC-41), see F5.

### F5. Correct an old-period entry (`finance.manage`) [K2]
1. On an old-period detail the Treasurer sees "Transaksi periode lama tidak bisa dibatalkan. Catat koreksi di periode aktif." and the button "Buat koreksi".
2. The record form opens in the active period with the opposite type, the same amount and Keterangan "Koreksi {nomor}: ", and a link "Koreksi atas {nomor}". She sets the right amount and writes why. The correction is an ordinary entry with a link; the old period's totals are not restated [A-FN8].

### F6. Proof files (`finance.manage`)
1. Proof can be added to an Aktif entry of the active period (at recording or later). A wrong file is withdrawn ("Tarik berkas") with a reason; the record and the stored file stay (access control L5); only managers see withdrawn files; they do not count toward the limit of 3.
2. Readers with `finance.view` open a proof through a short-lived signed link.

### F7. Export (`finance.export`)
1. One "Ekspor" button with a menu Excel, CSV, PDF. Absent without the key.
2. The server rebuilds the list of the selected period with the current search and filters, ALL matching rows, same order as the screen. The file starts with a summary of the whole period (period label, Saldo awal, Total Pemasukan, Total Pengeluaran, Total Saldo, export date in WIB, the filters used). Voided entries appear with status "Dibatalkan" and their reason. Proof contents and links are never exported.
3. One append-only log row is written before the file is returned (who, when, format, filters, period, row count; no PII, no search text, no amounts). If the log write fails, no file is returned (like Member Data A-MD12). Too many rows (see 8): refused with a message.

### F8. Period change and handover
1. When PI-CORE switches the active period, the next request sees it (access control R3). Entries keep their `period_id`; old periods are read-only and readable by current `finance.view` holders (L7, L8). The new Treasurer can record on the first request (AC-39); the old Treasurer has no access (AC-40).
2. The new Treasurer records the **Saldo awal** (F3). Until then viewers see "Saldo awal belum dicatat. Saldo di bawah belum termasuk kas dari periode sebelumnya." The new-period guide gets a step: count the cash and bank balance with the outgoing Treasurer, then record Saldo awal.
3. If an admin re-activates an older period in PI-CORE, that period becomes writable again and the newer one read-only; totals are computed live, so nothing needs repair.

### States (all screens)
| State | Behavior |
|---|---|
| Loading | Skeleton rows; controls usable |
| No match | "Tidak ada hasil. Ubah pencarian atau filter." + Reset |
| Error, PI-CORE or `nexus` unreachable | "Terjadi gangguan. Coba lagi." with retry; never "no access"; no sign-out; never show a stale or partial balance |
| Session ended | Redirect to login (auth-login F9) |
| Right removed while open | Next action fails with "Aksesmu sudah berubah..." |
| Conflict (entry already voided, opening already recorded) | "Data sudah berubah. Muat ulang." |
| Upload fails | The step is not saved; "Berkas gagal diunggah. Coba lagi." |

---

## 4. Data and rules

### 4.1 Tables (plain words, schema `nexus`; the database engineer decides names)
All tables: RLS on, default deny, explicit policies. Writes only through server functions. Creator ids are `members.id` from the session. No foreign keys into PI-CORE (access control 7.2).

| Table | One row is | Key fields | Notes |
|---|---|---|---|
| Finance entries | one ledger line | number (`KAS-0001`), type (income, expense, opening), **amount as a whole-rupiah integer, always positive**, date, Keterangan, Catatan, status (Aktif or Dibatalkan), void reason and who/when, "corrects" (optional link to another entry), period id, recorded by/at, idempotency token | The sign comes from the type. The database refuses any update of type, amount, date, period or number, and any delete. Only the void columns change, once |
| Entry files | one proof file | entry id, storage path, original name, size, type, uploaded by/at, withdrawn flag, reason, who/when | Private bucket. Never purged (access control L5). Readable only by `finance.view` holders |
| Entry history | one action | entry id, kind (recorded, proof added, proof withdrawn, voided), reason, who, when | Append-only |
| Number counter | the last used number | last value | Updated in the same transaction as the entry; never reused, also after a void |
| Export log | one successful export | who, when, format, filters, period id, row count | Append-only, no PII, no amounts. May share the log table of other modules |

**There is no stored balance.** Totals and the balance are computed by the database from the entries each time. A stored running balance could drift or be edited; a computed one cannot.

### 4.2 Money rules
- Amounts are **whole rupiah**, stored as an integer type, never a floating-point type, anywhere (database, server code, exports). Input is parsed from digits only; "12.5", "1e3", "-5", "0", empty and letters are refused. Range 1 to 9.999.999.999 [A-FN1] (fits safely in a JavaScript integer).
- **Total Pemasukan** = sum of Aktif income entries of the period. **Total Pengeluaran** = sum of Aktif expense entries. **Saldo awal** = the Aktif opening entry (0 if none). **Total Saldo** = Saldo awal + Total Pemasukan - Total Pengeluaran. Voided entries count in nothing (A-FN3).
- Display: "Rp 1.250.000" (format example only), tabular numbers, a plus or minus sign next to the colour (never colour alone). CSV holds plain integers without separators; Excel holds integer cells with a number format; PDF holds the "Rp" format.
- A negative Saldo is allowed and shown with a hint (A-FN9); it usually means income or an opening balance is missing.

### 4.3 State machine
Entry: **Aktif** to **Dibatalkan** only. A voided entry cannot be restored, changed, or given proof.

### 4.4 Files [K5 a: proof optional, decided]
Private bucket, signed links of 300 seconds, issued only by the server to `finance.view` holders. Limits (reuse of Letters L8): PDF, JPG, PNG, 5 MB each, up to 3 per entry, real type checked by the first bytes, images resized in the browser to about 2000 px on the long side. Uploads go to the uploader's own folder before the entry exists; files never attached to a saved entry are not shown; at most 10 unattached uploads per member per 24 hours (A-LT13, F11 pattern).

**Free-tier note.** Storage is about 1 GB, shared by all modules. [ASSUMPTION, my estimate] Finance proofs about 150 MB a year (about 300 expenses, one photo each, about 0.5 MB). The total across modules is about 560 MB a year; see `docs/modules/meeting-minutes.md` N7 for the decision. Receipt photos are the biggest single driver, which is why K5 recommends proof that is optional but visible when missing.

---

## 5. Business rules and edge cases

| # | Rule or case | Expected behavior |
|---|---|---|
| R1 | Immutable ledger | After saving, nothing about an entry can change except the void. Even a direct call by the Treasurer is refused by the database. A typo is fixed by void and "Catat ulang" (K2) |
| R2 | No delete | No screen, function or call deletes an entry, proof, history row or log row (access control L5) |
| R3 | Period | `period_id` is the active period at saving, never client input. Entries cannot move between periods. A switch makes the old period read-only (access control L7) |
| R4 | No active period | Recording is refused with a banner (access control R11); Treasurer and BPH read nothing (E4) |
| R5 | Date versus period | The date is free (not in the future, any past date) [A-FN4]. A date outside the period's dates gives a soft warning only, because PI-CORE says those dates are informational. A transaction from last month entered in this period belongs to this period |
| R6 | Old-period error | Cannot be voided or edited. The Treasurer records a correction in the active period with a link (F5). The old period's own totals stay as they were |
| R7 | Opening balance | At most one Aktif Saldo awal per period; may be recorded after other entries; included in Total Saldo; not counted as income |
| R8 | Double submit and retries | An idempotency token per form submit means one entry even if the phone retries (A-FN10). A soft hint "Transaksi serupa sudah dicatat hari ini" is a possible later helper, not required |
| R9 | Concurrency | Two voids of the same entry: one wins, the other gets "Data sudah berubah. Muat ulang." Two Treasurers recording at once get different numbers (the counter is updated under lock); a failed save uses none |
| R10 | Recorder deactivated or replaced | Their entries stay with their name (AC-45). The successor manages the active period on the next request (E10) |
| R11 | Single Treasurer | One holder can record and void everything; there is no second-person rule (K6). The history shows who |
| R12 | Nobody holds `finance.manage` | The page is read-only for BPH; the System Admin sees the "nobody can use it" warning and cannot record either (access control E15, R7) |
| R13 | Hosted data safety | Finance is the most sensitive module. Before it is applied to the hosted project: backup first, the owner's approval, and the security review closed (D-026) |
| R14 | Time zone | "Today", future-date checks and export dates use Asia/Jakarta (WIB); timestamps are stored in UTC |
| R15 | Privacy | Entries and proof can name people ("reimburse ke ..."). Visible only to the keys above. Recorder names come from PI-CORE only. Reading Finance is not logged; exports are [A-FN16] |
| R16 | Text safety | Keterangan and Catatan are plain text. Escape on screen. In CSV and Excel, a text value starting with `=`, `+`, `-` or `@` must not be run as a formula (A-FN14) |
| R17 | Many rows | Server pagination; search runs inside readable rows only |
| R18 | Go-live | History before NEXUS stays outside NEXUS. At go-live the Treasurer records the Saldo awal and may enter earlier real-dated entries of the active period [A-FN18] |

---

## 6. Stitch conflicts (filler flagged, not adopted)

| Stitch content (screens 05, 06, 07, Dashboard card) | Problem | Decision |
|---|---|---|
| All amounts ("Rp 999.999.999", "Rp 100.000.000", "Rp 899.999.999", row amounts) and row texts ("Persembahan Ibadah Padang", "Sewa Gedung Retret", ...) | Sample values | Real data only |
| Badges "12%" and "4.2%", "+12.4% vs bln lalu", "Surplus", "Terkontrol", "Tercatat TA 2026", "Anggaran RKA" | Invented metrics and a budget concept NEXUS does not have | Dropped |
| "Rekening Giro Utama Kas Operasional", "Rekening BNI Resmi PMK (No. Rek 182-004-9811)", "Update per 24 Oktober 2026" | Invented bank account and date | Dropped. One cash pool (K4 a, decided) |
| Badge "Aktif / Klir", panel label "KAS LIKUID TERSEDIA" | Invented status wording | Dropped; the hero is "Total Saldo" |
| Gradient accent bar on the hero card | Decoration against the D-023 style | Dropped |
| Sub-line under each row ("Divisi Kerohanian", "Inventaris Musik", "5 Departemen", "Panitia Retret Akbar") | Invented fields; committees are not PI-CORE entities | Dropped; free Keterangan and Catatan |
| Note card "Transparansi Dana Terverifikasi": "...diverifikasi oleh Bendahara Umum PMK ITERA bersama Badan Pengawas Organisasi sesuai dengan AD/ART..." | A verification claim and a supervisory body nobody defined (K6 a: no second-person check) | Dropped |
| Chip "4 Data Terbaru" and pagination "Halaman 1 dari 5" | Sample counts | Real count; server pagination keeps the "Halaman x dari y" pattern |
| Income chip green and expense chip amber, expense amount red | Keep the palette; add a sign so colour is not the only cue | Kept with +/- signs |
| Button "Input Kas" | Leads nowhere | "Catat transaksi", managers only, active period only |
| Button "Unduh Transkrip / Cetak Laporan" visible to all | Export is a separate right | "Ekspor" menu (Excel, CSV, PDF) for `finance.export` |
| Search "Cari transaksi..." and the "Filter" button | Matches the need | Kept; filter opens a sheet |
| Screen 07 is labelled "Finance (390px)" but holds the Dashboard | Mislabelled | Ignored; 05 and 06 are the same content (animated or static) |
| Dashboard Finance card: "Total Saldo Terverifikasi", "Buku Kas Umum Bersih", "Kelola Transkrip Keuangan" | "Terverifikasi" is a claim nobody defined | Card shows Saldo, Pemasukan, Pengeluaran of the active period for `finance.view` holders only |
| Drawer and H1 in English ("Finance") | Mixed languages | Kept as in context section 6 [A-FN12]; "Keuangan" is the alternative |
| No form, detail, void, empty, error, no-period screens | Missing | Section 7 |

---

## 7. Screens

Stitch has the landing page only (05, 06). The rest is missing and is described here in words, so no separate UX round is needed. Style follows D-014 and D-023 (header card, 12 px cards, 8 px controls, chips only for status and filters, fields 44 px high with 16 px text per D-017, tabular numbers for money). Copy uses "kamu" and short sentences. Rupiah values in this section are format examples, not data.

**Screen 1. Finance page** (`/finance`; Stitch 05 and 06, adapted).
- Header card: H1 "Finance", line "Periode {label}" with a select "Periode" (all periods that have data, active first). Old period: banner "Periode {label} sudah selesai. Datanya hanya bisa dibaca."
- Hero tile "Total Saldo" (large, for example "Rp 1.250.000"); below it two tiles "Total Pemasukan" and "Total Pengeluaran"; a small line "Saldo awal Rp 500.000". Hints: no opening balance, managers "Saldo awal periode ini belum dicatat." with the button "Catat saldo awal", viewers "Saldo awal belum dicatat. Saldo di bawah belum termasuk kas dari periode sebelumnya."; negative balance "Saldo minus. Cek apakah ada pemasukan atau saldo awal yang belum dicatat."
- Actions row: primary "Catat transaksi" (managers, active period only), "Ekspor" menu (export holders).
- Search "Cari keterangan atau nomor KAS..."; "Filter" sheet with "Jenis" (Semua, Pemasukan, Pengeluaran, Saldo awal), "Dari tanggal", "Sampai tanggal", switch "Tampilkan yang dibatalkan", checkbox "Tanpa bukti", and "Reset". A line "Hasil: {n} transaksi".
- List: cards on phones, table from 1024 px (Tanggal, Keterangan, Jumlah, as Stitch; plus a Jenis chip and the number). Card: date "15 Okt 2026", number "KAS-0012", Keterangan, amount "+Rp 4.500.000" or "-Rp 1.250.000", chip, paperclip when proof exists. Voided: amount struck through, chip "Dibatalkan".
- Empty: "Belum ada transaksi di periode ini." (managers add "Catat transaksi pertama lewat tombol di atas."). No match: "Tidak ada hasil. Ubah pencarian atau filter." Error: "Terjadi gangguan. Coba lagi."

**Screen 2. Detail** (missing). Back link "Kembali ke Finance". H1 "Detail Transaksi". Card 1: "Nomor", "Tanggal", "Jenis", "Jumlah" (large), "Keterangan", "Catatan", "Koreksi atas {nomor}" (a link, when present), "Periode", "Dicatat oleh {nama}, {tanggal}". Card 2 "Bukti": one row per file with "Lihat"; empty "Tanpa bukti." Card 3 "Riwayat": timeline "Dicatat oleh {nama}", "Bukti ditambahkan", "Dibatalkan oleh {nama}". Void block: "Dibatalkan oleh {nama} pada {tanggal}. Alasan: {alasan}". Manager actions (active period, Aktif): "Tambah bukti", "Batalkan transaksi"; after a void: "Catat ulang"; old period: the sentence "Transaksi periode lama tidak bisa dibatalkan. Catat koreksi di periode aktif." with "Buat koreksi". Export holders: "Ekspor".

**Screen 3. Record form** (missing). Back link "Kembali ke Finance", H1 "Catat Transaksi".
- "Jenis": two segments "Pemasukan" and "Pengeluaran". "Tanggal" (default today). "Jumlah (Rp)": numeric keypad, digits only, dots inserted while typing, help "Angka bulat, tanpa titik atau koma." "Keterangan" (help "Tulis singkat dan jelas."). "Catatan (boleh kosong)". "Bukti (boleh kosong)": dashed area "Ketuk untuk memilih berkas", help "Foto nota atau bukti transfer. PDF, JPG, atau PNG, maksimal 5 MB, sampai 3 berkas." (follows K5).
- Buttons: primary "Lanjut" (opens the check sheet), outline "Batal".
- **Check sheet** "Cek dulu": "{Jenis} Rp {jumlah} pada {tanggal}." then the Keterangan, then "Setelah disimpan, transaksi tidak bisa diubah. Kalau salah, kamu hanya bisa membatalkannya." Date outside the period: "Tanggal ini di luar masa periode {label}. Tetap simpan?" Buttons "Simpan transaksi" and "Kembali".
- Errors: "Isi jumlah dengan angka bulat, minimal Rp 1." "Jumlah terlalu besar (maksimal Rp 9.999.999.999)." "Tanggal tidak boleh di masa depan." "Keterangan wajib diisi." "Terlalu panjang (maksimal {n} karakter)." Files: "Hanya PDF, JPG, atau PNG." "Berkas terlalu besar (maksimal 5 MB)." "Maksimal 3 berkas." No period: "Belum ada periode aktif. Transaksi belum bisa dicatat."
- Success message: "Transaksi {nomor} tersimpan."
- Leave prompt with unsaved input: "Keluar dari halaman ini?" / "Perubahan belum disimpan." / "Tetap di sini", "Keluar".

**Screen 4. Opening balance form** (missing). H1 "Catat Saldo Awal". Hint "Saldo akhir periode {label}: Rp {jumlah}." with the text button "Pakai angka ini". Help under "Jumlah (Rp)": "Hitung kas dan saldo bank yang benar-benar ada, lalu isi angkanya." Keterangan default "Saldo awal periode {label}" (editable). Same check sheet. If one already exists: "Saldo awal periode ini sudah dicatat. Batalkan yang lama kalau angkanya salah." Jenis is fixed, not selectable.

**Screen 5. Correction form.** Screen 3 opened by "Buat koreksi": opposite type, same amount, Keterangan "Koreksi {nomor}: ", and a read-only line "Koreksi atas {nomor}". "Catat ulang" opens screen 3 with a copy of the voided entry and no link.

**Screen 6. Void dialog.** Title "Batalkan transaksi?" Body "{nomor} tetap tampil sebagai Dibatalkan dan tidak dihitung di total. Ini tidak bisa dikembalikan." Field "Alasan pembatalan" (required). Buttons "Ya, batalkan transaksi" and "Kembali". Missing reason: "Tulis alasan pembatalan." Success: "Transaksi dibatalkan."

**Screen 7. Withdraw-proof dialog.** Title "Tarik berkas?" Body "Berkas disembunyikan dari pembaca dan hanya terlihat oleh pengelola. Berkasnya tidak dihapus." Field "Alasan". Buttons "Tarik berkas" and "Kembali".

**Screen 8. Export menu.** Same as Data Anggota: "Unduh semua hasil filter sebagai:" Excel, CSV, PDF; busy "Menyiapkan file..."; done "Unduhan dimulai: {file}"; too many rows "Terlalu banyak data untuk satu file. Persempit dengan filter tanggal."

**Screen 9. Dashboard card** (layout belongs to the Dashboard module). Title "Finance", line "Periode {label}", big "Total Saldo", two small lines "Pemasukan" and "Pengeluaran", link "Buka Finance". No percentage, no growth badge. Empty "Belum ada transaksi." No period "Belum ada periode aktif." Error inside the card only: "Data finance belum bisa dimuat." with "Coba lagi". Shown only to `finance.view` holders.

**Screen 10. Shared.** No-permission page, "no active period" banner, system messages: reuse the existing shared ones.

**Nothing here needs a separate UX round.** The visual finish of screens 1 to 3 follows the D-023 rollout; the frontend engineer builds them with the design skills.

---

## 8. Export, log and Dashboard

| Export | Key | Who (default) | Content |
|---|---|---|---|
| Entries of the selected period (current filters) | `finance.export` | BPH (D03), Treasurers (D25) | Number, date, type, Keterangan, Catatan, amount (whole rupiah), status (with void reason), "koreksi atas", recorded by (name), recorded at, proof yes or no, period. Summary block first (A-FN14) |

- Formats and writers follow D-019 and D-020 (`src/lib/export/`). Excel: integer cells with a number format. CSV: plain integers, no separators, formula-safe text. PDF: "Rp" format with a summary box. Dates in WIB.
- Row guard as in D-022: the server counts first (`total_count`) and refuses when more than 1000 rows match or when fewer rows arrive than counted; the message tells the user to narrow by date.
- One append-only log row per successful export; no export without a log row. **Gap:** the screen to read this log does not exist yet and there is no key to read it, so for now only the database shows it. For Finance this is weaker than for other modules; raise it again when the Member Data log screen (A-MD14) is designed (A-FN15).
- **Dashboard card.** Saldo, Pemasukan and Pengeluaran of the active period, for `finance.view` holders only; no percentages.

---

## 9. Assumptions

All [ASSUMPTION] until the owner confirms, except the rows marked DECIDED. The 2026-11-09 answers settled: the correction rule A-FN8 and the no-edit rule behind A-FN7 (K2 a), A-FN17 (K6 a), the carry-over and go-live parts of A-FN18 and A-FN21 (K3 a: "Saldo awal" typed once per period, previous closing as a hint), and that proof is optional with a mark and filter in A-FN6 and A-FN13 (K5 a). Copied to `docs/OPEN_QUESTIONS.md` section K.

| Id | Assumption |
|---|---|
| A-FN1 | Amounts are whole rupiah, stored as an integer, always positive, from 1 to 9.999.999.999; the type gives the sign; no decimals, no zero, no negative input |
| A-FN2 | Entry number `KAS-0001`: one sequence, assigned by the database, never reused, also after a void (same pattern as `PJM-0001` and `INV-0001`) |
| A-FN3 | Totals exclude voided entries and the opening entry; Total Saldo = Saldo awal + Pemasukan - Pengeluaran per period, computed by the database. The tiles always show the whole period, not the filter |
| A-FN4 | The date is not in the future; any past date; the period is the active period at saving; outside the period's start and end dates (if PI-CORE has them) a soft warning, no block |
| A-FN5 | Limits: Keterangan 200 characters, Catatan 500, void and withdraw reasons 500. Plain text |
| A-FN6 | Proof: PDF, JPG, PNG, 5 MB, up to 3, magic-byte check, browser resize to about 2000 px, signed links 300 seconds, unattached uploads capped at 10 per member per 24 hours, withdrawn files kept and hidden from non-managers and not counted toward the 3. Proof can be added while the entry is Aktif and in the active period |
| A-FN7 | Void: any `finance.manage` holder, only Aktif entries of the active period, reason required, not restorable, whole entry only. "Catat ulang" copies a voided entry into the form |
| A-FN8 | **DECIDED (K2 a, D-028):** an old-period entry is corrected by a new entry in the active period with an optional link "Koreksi atas {nomor}" (the target must exist and be Aktif); the old period's totals are not restated |
| A-FN9 | A negative Total Saldo is allowed and shown with a hint; never blocked |
| A-FN10 | Each form submit carries an idempotency token; a double tap or a retry saves one entry |
| A-FN11 | No categories in Phase 1 (not in context 5.3); a category column can be added later without a rewrite. No sub-line per row |
| A-FN12 | Drawer label and H1 stay "Finance" (context section 6, Stitch); "Keuangan" is the alternative |
| A-FN13 | Search covers Keterangan, Catatan and number; page size 20; sort date newest first, then number newest; filters Jenis, date range, show Dibatalkan (off), "Tanpa bukti"; period select |
| A-FN14 | Export header summarises the whole period and lists the filters; text cells that begin with `=`, `+`, `-` or `@` are neutralised; no links or file contents; row cap 1000 with `total_count` (D-022) |
| A-FN15 | No key and no screen to read the Finance export log yet; readable only in the database until the log screen exists (A-MD14) |
| A-FN16 | Viewing Finance is not logged; only exports are |
| A-FN17 | **DECIDED (K6 a, D-028):** both Treasurers have equal rights; either may void the other's entry; no approval, so access control L6 is not involved |
| A-FN18 | History before go-live stays outside NEXUS; at go-live the Treasurer records Saldo awal and may add real-dated entries of the active period |
| A-FN19 | The System Admin without a Finance rule sees nothing (B18); a rule granting Finance to the admin's own position is logged as "self-benefit" (D-012) |
| A-FN20 | The Dashboard card shows Saldo, Pemasukan, Pengeluaran of the active period to `finance.view` holders; no percentages or growth |
| A-FN21 | At most one Aktif Saldo awal per period; it may be recorded after other entries; a wrong one is voided and re-recorded |

---

## 10. Questions for the owner

Six owner-level questions (rules, money, rights, retention), **all answered 2026-11-09: the owner accepted every recommendation (D-028).** Options are kept below for the record. Everything else is an assumption above.

**K1. Who may see Finance, and who may export?** [ANSWERED 2026-11-09: (a); answers B6 for Finance] (B6, a default today.)
- (a) All six BPH positions read everything and export; the two Treasurers also record and void. (Default rules D02, D03, D24, D25.)
- (b) Only Ketua Umum, Sekretaris Jenderal and the two Treasurers read and export.
- (c) All BPH see only the totals, details only the Ketua Umum and the Treasurers (needs a new permission key and a new design).
- **Owner answer 2026-11-09: (a), as recommended.** It is the existing default, simple, and every BPH member shares responsibility for the money. The System Admin can narrow it later with a logged rule (D-011). Department heads and the System Admin alone see nothing.

**K2. How are mistakes corrected?** [ANSWERED 2026-11-09: (a)] (Context 5.3 says nothing; the key text says "edit (active period), void".)
- (a) Never edit. Void an entry of the active period with a reason, then record the right one ("Catat ulang"). A mistake in an old period is corrected by a new, linked entry in the active period. Only proof files can be added later.
- (b) (a), plus Keterangan and Catatan can be edited with a history row (money fields never).
- (c) Everything editable in the active period with a history row.
- **Owner answer 2026-11-09: (a), as recommended.** Money records must not change quietly. The cost is one extra void for a typo, softened by "Catat ulang". The key text of `finance.manage` and AC-14, AC-15, AC-58 are reworded accordingly (section 12, access control).

**K3. Does the closing balance of a period carry over to the next period?** [ANSWERED 2026-11-09: (a)] (Context 5.1 shows one "current balance"; 5.3 ties transactions to a period.)
- (a) Yes, through a "Saldo awal" entry the Treasurer records once per period after counting the real cash and bank money; the screen shows the previous closing balance as a hint. This also covers go-live.
- (b) Yes, automatically: the opening balance is the previous period's closing balance, with no typing (go-live still needs one manual entry).
- (c) No. Each period starts at Rp 0 and Total Saldo is per period only.
- **Owner answer 2026-11-09: (a), as recommended.** Money does not reset at handover. Typing the counted amount makes the Treasurer check the real cash, and any difference from the books becomes visible. (b) hides a mismatch; (c) makes "Total Saldo" meaningless for the organisation.

**K4. Does PMK keep one cash pool, or several accounts?** [ANSWERED 2026-11-09: (a)] (Stitch shows a bank account; the context says nothing.)
- (a) One pool in Phase 1: all money is one balance; the bank or cash detail goes into Keterangan.
- (b) An account field (for example Tunai, Bank) with a balance per account; the owner names the accounts.
- **Owner answer 2026-11-09: (a), as recommended.** Nothing in the context defines accounts, and adding one later is a small change.

**K5. Is proof (nota, bukti transfer) required?** [ANSWERED 2026-11-09: (a)]
- (a) Optional for every entry. Entries without proof carry a visible mark and a filter "Tanpa bukti".
- (b) Required for every Pengeluaran.
- (c) Required for a Pengeluaran above an amount the owner names.
- **Owner answer 2026-11-09: (a), as recommended.** A lost receipt must not stop an honest entry, and a threshold would be an invented number. The mark and filter let the board see the gaps; review after one period. Proof also drives storage (about 150 MB a year, N7 in the minutes spec).

**K6. Does a second person check each entry?** [ANSWERED 2026-11-09: (a)] (Stitch's "diverifikasi oleh ... Badan Pengawas" suggests it; nothing defines it.)
- (a) No. Either Treasurer records and voids; the history shows who.
- (b) The other Treasurer marks an entry "Terverifikasi" (no effect on totals), and unverified entries are marked.
- **Owner answer 2026-11-09: (a), as recommended.** No approval exists in the context, there may be only one Treasurer in office, and (b) adds a status and a self-check rule (L6). Control comes from the immutable history, the BPH read access and the logged exports.

---

## 11. Acceptance criteria

Personas: `docs/modules/access-control.md` section 9. Default rules apply unless stated. Every criterion is tested through the UI AND by a direct call with that persona's token. They follow the owner's answers of section 10 (all recommendations accepted, 2026-11-09, D-028).

**Permissions**
- FN-01 P-BEND can record, void, add proof to and export entries of the active period.
- FN-02 P-KETUM and P-SEKJEN can read all entries and totals and export; they cannot record, void or add proof; direct calls with their tokens are rejected.
- FN-03 P-ADMIN (no assignments), P-SEKDEP, P-KADEP-OPS, P-STAFF-LOG, P-PLAIN and P-LECT get no Finance data by UI or API; the drawer item and the Dashboard card are absent (AC-03, AC-29).
- FN-04 P-OLD, P-INACTIVE, P-UNLINKED and a request without a session get nothing (access control L1, AC-40).
- FN-05 Granting any `finance.*` key to "every active member", or without a written reason, is rejected by the database (access control L12).
- FN-06 If rules D02 and D24 are disabled, the holders lose the matching power on their next request; P-ADMIN-BEND receives Finance through the position, P-ADMIN does not (AC-68).
- FN-07 A Treasurer deactivated mid-session fails on the next request (AC-44).

**Money**
- FN-08 An amount is accepted only as a whole number from 1 to 9.999.999.999; "12.5", "1e3", "-5", "0", empty, letters and larger values are refused by the form, by the server and by the database.
- FN-09 The amount column is an integer type; no floating-point type is used in the database, server code or export. A period with 10,000 entries of Rp 1 totals exactly Rp 10.000.
- FN-10 Total Pemasukan, Total Pengeluaran and Total Saldo follow section 4.2: Saldo awal 1.000.000, Pemasukan 500.000 and Pengeluaran 200.000 give Total Saldo 1.300.000; voiding a Pengeluaran of 100.000 changes Total Pengeluaran and Total Saldo accordingly; a voided entry counts in nothing.
- FN-11 A negative Total Saldo is shown with the hint and is not blocked.
- FN-12 The date of a new entry cannot be in the future; at 23:30 UTC the Jakarta date is used.

**Immutability, void, correction**
- FN-13 After saving, no persona can change date, type, amount, period, number, Keterangan or Catatan of an entry (K2 a), by UI or by direct call; the database refuses the update.
- FN-14 No screen, function or call deletes an entry, proof, history row or export-log row, for any persona including P-ADMIN (AC-51).
- FN-15 Voiding needs a reason and works only on an Aktif entry of the active period; the entry stays in the list as "Dibatalkan" with who, when and why, is excluded from totals, cannot be restored, and a second void is refused.
- FN-16 An entry of a non-active period cannot be voided or given proof (access control L7, AC-41); a correction entry in the active period with a link to it works and shows "Koreksi atas {nomor}".
- FN-17 Pressing "Simpan" twice, or a retry with the same token, saves exactly one entry.
- FN-18 The number is assigned by the database, increases, is never reused (also after a void), and two simultaneous saves get different numbers.
- FN-19 Every record, proof and void action writes one history row (who, when, reason); history rows cannot be edited or deleted.

**Opening balance and period**
- FN-20 At most one Aktif Saldo awal exists per period; a second is refused; after a void a new one is accepted; it is not counted as income.
- FN-21 The opening form shows the previous period's closing balance as a hint, never as a silent prefill.
- FN-22 The period of a new entry is the active period, never client input; with no active period recording is refused with the banner text (AC-43).
- FN-23 After a period switch the new Treasurer records on the first request and reads old periods read-only; the totals per period follow the selected period; the Dashboard card shows the active period only (AC-39, AC-41).
- FN-24 A date outside the period's dates shows a warning in the check sheet and does not block saving.

**Files**
- FN-25 Only the types and sizes of K5's rule are accepted (checked by the real file type); a fourth file, an oversized file or another type is refused, also by direct upload.
- FN-26 The bucket is private; a proof link is signed, expires within minutes, and is returned only to `finance.view` holders; a P-PLAIN request for a link returns nothing.
- FN-27 A withdrawn proof keeps its record and stored file, is visible only to managers, and does not count toward the limit of 3; entries without proof show the mark and appear under the filter "Tanpa bukti".

**Export**
- FN-28 "Ekspor" is visible only with `finance.export`; a direct export call without it, or without view (R15), is refused.
- FN-29 Excel, CSV and PDF contain the summary of the whole period and all rows matching the current filters, in screen order, with the same count as the screen, dates in WIB, voided entries marked with their reason, integer amounts, and no links.
- FN-30 A Keterangan or Catatan starting with `=`, `+`, `-` or `@` is not executed as a formula when the CSV or Excel file is opened.
- FN-31 Each successful export writes exactly one log row (who, when, format, filters, period, row count); a refused export, or one whose log write fails, writes none and returns no file; the row holds no PII and no amounts and cannot be updated or deleted.
- FN-32 An export that would exceed the row limit, or that receives fewer rows than counted, is refused with the message; an export of exactly 1000 complete rows works.

**Dashboard and quality**
- FN-33 The Dashboard Finance card is shown only to `finance.view` holders, shows Saldo, Pemasukan and Pengeluaran of the active period without a percentage, and shows its error inside the card only.
- FN-34 No response, screen or export contains email, phone, NIM or NIP; recorder names come from PI-CORE only through `src/lib/picore/` (AC-47).
- FN-35 A pgTAP test per persona proves RLS: zero rows for denied users on entries, files, history, counter and export log; every `nexus` table of this module has RLS enabled and no direct write grant for users.
- FN-36 At 390 px every screen works without horizontal page scroll; fields are at least 44 px high with 16 px text (D-017); the amount field opens the numeric keypad; money uses tabular numbers.
- FN-37 Text typed as `<script>` in Keterangan or Catatan shows as plain text and never runs.
- FN-38 Entries by a deactivated recorder remain and show their name (AC-45).
- FN-39 The module is self-contained and every entry carries `period_id`; nothing in it prevents a later link from progja by id.
- FN-40 The security review of this module is closed with no CRITICAL or HIGH finding before the owner is asked to apply it to the hosted project.

---

## 12. Notes for other documents (contradictions and gaps found)

1. **Key text `finance.manage` says "Create, edit (active period), void"**, and AC-14 says "create, edit, void", AC-15 and AC-58 say "edit". K2 (a) decided: no editing. Resolved 2026-11-09: the key text and AC-14, AC-15, AC-58 in `docs/modules/access-control.md` now say "record, void, correct". The locked rule L7 ("Finance corrections go into the active period") fits the decision.
2. **AC-41 ("cannot edit or void" an old period) and L7** are consistent with F5: an old-period error is corrected by a new linked entry, never by changing the old one.
3. **Context 5.1 ("current balance") versus 5.3 (transactions tied to a period)**: without carry-over the "current balance" would mean only this period's. K3 (a) decided: Total Saldo of the active period, with the typed "Saldo awal", is the organisation's live balance.
4. **Stitch invents things the context does not have**: a bank account, a budget (RKA), growth percentages, a supervisory body ("Badan Pengawas Organisasi", AD/ART) and "terverifikasi" claims. All dropped (section 6); K6 (a) decided: no verification step.
5. **Stitch screen 07 is the Dashboard** under a Finance label (known, `screens.md`).
6. **Admin sees no Finance (B18) and PI-CORE position-derived admins can self-assign as Treasurer (B37).** The second is a known, accepted risk that is most serious here; to be raised with the PI-CORE maintainer before go-live (D-028).
7. **Finance export log has no reader** (A-FN15), unlike Member Data (`member_data.view_export_log`). Decide when the log screen is designed.
8. **Free tier.** Finance proofs add to the shared 1 GB (minutes spec N7, `OPEN_QUESTIONS.md` F11).
9. **Drawer language.** "Finance" is English while the rest of the app is Indonesian; kept because the context lists it (A-FN12). One-line change if the owner prefers "Keuangan".
