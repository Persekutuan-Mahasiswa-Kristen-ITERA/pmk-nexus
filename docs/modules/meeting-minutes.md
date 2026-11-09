# Meeting Minutes / Notulensi Rapat (module spec)

> Status: **Approved 2026-11-09 (owner accepted all recommendations, D-027 / D-028).** One approval package in fast mode (D-026): this spec plus the screens in section 7 (including the Indonesian copy) count as the approved design; no separate UX round. Database, code, tests and docs proceed without stopping; owner approval is still needed before anything touches the hosted project. Nothing is built yet. Recorded in `docs/DECISIONS.md` (D-027 Meeting Minutes module rules; D-028 is the Finance module) and in the context document (section 5.4).
> Sources: `CLAUDE.md` (4-8, 11, 17, 18), `docs/PMK-NEXUS-context.md` (4, 5.1, 5.4, 6), `docs/DECISIONS.md` (D-008, D-011, D-013, D-014, D-019, D-020, D-021, D-022, D-023, D-025, D-026), `docs/OPEN_QUESTIONS.md` (B2, B17, B18, B19, B20, B22, C8, C9, A-LT13, F11), `docs/modules/access-control.md` (keys `minutes.*`, rules D04, D05, D15-D23, D26, D27, L1, L4-L8, L11, L12, R9, R11, R15, E4, E9, A-n1), `docs/modules/letters.md` (structure template and reused patterns), `docs/picore/schema-report.md` (org units and positions), `docs/design/stitch/screens.md` (08, 09, Dashboard card 1).
> Tags: **[ASSUMPTION]** = my guess, still open unless section 9 marks it decided (A-MN1 to A-MN18, section 9, copied to `docs/OPEN_QUESTIONS.md` section J). **[UNKNOWN]** = no source. **N1-N7** = owner questions (section 10), all answered 2026-11-09. **MN-01 to MN-30** = acceptance criteria (section 11). Locked rules of access control are always written "access control L7" and so on.
> No code, no SQL. PMK facts (meeting names, department lists, who attends) are NOT invented. Every sample value in Stitch is filler.

---

## 1. Purpose and scope

**Purpose.** Give PMK ITERA one searchable record of what was discussed and decided in its meetings, kept per organisational unit, so a new secretary can read what the last one wrote.

**Analogy.** The minute book of each department, plus a shelf in the BPH office with a copy of every book. The secretary writes in her own department's book only; the board can read every book.

**In scope**
- A list of minutes with search and filters, a detail page, and a form to record and correct a minute (Date, Meeting Title, Topic, Minutes Content, Decision, attachments, plus the owning unit that D-008 requires).
- Void ("Batalkan") with a reason; edit history; attachments in a private bucket.
- Export (Excel, CSV, PDF) with an append-only export log.
- The counts for the Dashboard "Notulensi Rapat" card (the card belongs to the Dashboard module).

**Out of scope (Phase 1)**
- A meeting schedule or agenda ("Terjadwal", "Mendatang", "+ Buat Agenda"): decided not in Phase 1 (N4 a, D-027). It can be added later as its own feature.
- Attendance lists, meeting time and place, action-item tracking, comments, e-signatures, notifications [A-MN1].
- Rich text, images inside the text, templates.
- Program of work (progja): not Phase 1. The module is self-contained (`src/modules/meeting-minutes`); minutes carry `period_id` and `org_unit_id`, so progja can later link a minute to an event by id without a rewrite.

NEXUS stores the minutes itself (schema `nexus`). Member identity is not copied: rows store `members.id`; names come from PI-CORE through `src/lib/picore/` at read time (D-010). No email, phone, NIM or NIP anywhere (access control L4).

---

## 2. Who uses it and who may do what

Rights come from permission keys (access control 2.1), never from a person. **No new key is needed.** "BPH secretary" = Sekretaris Jenderal, Sekretaris Umum 1 and 2 (D-008). "Department secretary" = role `sekretaris` (Sekretaris Departemen, Sekretaris Biro).

| Key | Unlocks | Scope | Default holders |
|---|---|---|---|
| `minutes.view` | Open the list and the detail; read attachments | all, own unit | Role `bph`, all (D04). Included in `minutes.manage`. Also role `kepala_departemen` (Kepala Departemen and Kepala Biro), own unit (new default rule D37, N1 b, D-027) |
| `minutes.manage` | Record, edit, void minutes; add and withdraw attachments. Includes view. The key text said "archive"; it is reworded to "void" (access control 2.1): void means a minute is kept and marked Dibatalkan, never deleted (A-MN15) | all, own unit | BPH secretaries, all (D17, D20, D23). Role `sekretaris`, own unit (D26) |
| `minutes.export` | Export | all, own unit | Role `bph`, all (D05). Role `sekretaris`, own unit (D27) |

"Own unit" = the `org_unit_id` of the assignment that matched the rule (access control 2.1). It is exactly one unit: a Sekretaris Departemen does not reach that department's divisions (B22). A person with two matching assignments gets both units (E9).

| Actor | Read | Record, edit, void | Export |
|---|---|---|---|
| BPH secretary (P-SEKJEN) | All units | All units | All |
| Other BPH (P-KETUM, P-BEND) | All units | No | All |
| Department or bureau secretary (P-SEKDEP) | Own unit only | Own unit only | Own unit only |
| Kepala Departemen / Kepala Biro | Own unit only (rule D37, N1 b); read only | No | No |
| System Admin without a BPH position (P-ADMIN) | No (B18) | No | No |
| Staff, plain member, lecturer, Kepala Divisi | No (B19) | No | No |
| Secretary or BPH of a PREVIOUS period only (P-OLD) | No | No | No |
| Deactivated, unlinked, anonymous | No (access control L1) | No | No |

**Rules that follow**
- Enforced in server code AND RLS on every table (CLAUDE.md 11, access control R10). A direct API call with a valid token must give the same result as the UI.
- Buttons without the key are absent, not greyed. A direct link without `minutes.view` shows the shared "no permission" page; API calls return no rows.
- **Drawer (D-021).** "Notulensi Rapat" is shown only to `minutes.view` holders. No exception is needed here (unlike Letters).
- L6 (no self-approval) does not apply: nothing in this module needs a second person's approval.
- A voided minute and a minute of a non-active period are read-only for everyone (access control L7).

---

## 3. User flows

Every step runs on the server. Each page and action checks session, active member (access control L1), the key and the unit scope before anything else. Mobile-first, 390 px. Dates are Jakarta calendar dates (WIB). Copy is in section 7.

### F1. Browse (`minutes.view`)
1. The user opens "Notulensi Rapat". The header card shows the active period and two tiles (minutes in the period, date of the latest meeting).
2. List, newest meeting date first (then newest recorded): meeting date, unit, title, topic (one line), a mark with the file count. A chip only for "Dibatalkan". Search on title, topic and content. Filters: Unit (offered only when the user can read more than one unit), Periode ("Periode aktif" default, "Semua periode"), Status ("Aktif" default, "Dibatalkan", "Semua"). Server pagination, page size 20 [A-MN6].
3. Rows outside the user's scope are never returned. A department secretary sees only her unit(s); the Unit filter is hidden when there is one.
4. Empty, no-match, loading and error states: section 7.

### F2. Read a minute (`minutes.view`)
1. Tap a row to open the detail: date, unit, period, recorded by and when, topic, minutes content, decision, attachments ("Lihat" opens a short-lived signed link), edit history.
2. Readers see the history with before and after of each change (a minute's history is as sensitive as the minute); withdrawn files are visible to managers only [A-MN7].
3. No active period: officers' rule-based rights match nothing (access control R11), so the list is not readable either.

### F3. Record a minute (`minutes.manage`)
1. The manager taps "Catat notulensi".
2. Fields: **Unit** (required; a select limited to the units she may write for; a plain read-only line when there is only one), **Tanggal Rapat** (required, default today, not in the future), **Judul Rapat** (required), **Topik Bahasan** (required), **Isi Notulensi** (required), **Keputusan & Tindak Lanjut** (optional [A-MN2]), attachments (optional, up to 3, N6).
3. The server re-validates everything: active member, active period (R11), the unit is one she may write for (checked against her scope, not the client), field limits, file rules. It saves status Aktif, `period_id` = the active period, creator = the session member, and writes a history row ("Dicatat").
4. She lands on the detail page. If she leaves the form with unsaved typing, the browser asks first (A-MN11).
5. No active period: "Belum ada periode aktif. Notulensi belum bisa dicatat."

### F4. Edit (`minutes.manage`) [N3 a: decided, no draft]
1. "Ubah" on the detail: only for an Aktif minute of the ACTIVE period inside her scope (access control L7).
2. Editable: date, title, topic, content, decision. Not editable: unit and period [A-MN4]. A wrong unit is fixed by voiding and recording again.
3. Each save writes one history row with before and after of the changed fields. Two managers saving at once: the second gets "Data sudah berubah. Muat ulang." (optimistic check).

### F5. Void, files (`minutes.manage`)
1. **Void ("Batalkan notulensi")**: reason required. The row stays, shows "Dibatalkan", is read-only, cannot be restored [A-MN15]; the files stay.
2. **Add a file** to an Aktif minute of the active period. **Withdraw** a wrong file ("Tarik berkas") with a reason: the record and the stored file stay (access control L5); only managers see it; withdrawn files do not count toward the limit of 3.

### F6. Export (`minutes.export`)
1. One "Ekspor" button with a menu Excel, CSV, PDF (same pattern as Data Anggota). Absent without the key.
2. The server rebuilds the list with the current search and filters inside the user's scope, ALL matching rows, same order as the screen (R13). Voided minutes appear with their status. Content and decision are exported in full; links are never exported.
3. From a detail page, "Ekspor" exports that one minute [A-MN8].
4. One append-only log row is written before the file is returned (who, when, format, filters or minute id, period; no PII, no search text, no rows). If the log write fails, no file is returned (like Member Data A-MD12). Too many rows (see 8): refused with a message.

### F7. Period change
1. When PI-CORE switches the active period, the next request sees it (access control R3). Minutes keep their `period_id`, so old minutes are read-only and readable by current view holders (access control L7, L8).
2. A new Sekretaris Departemen of the same unit reads that unit's minutes from earlier periods (the scope is the unit, not the period). The previous secretary, with no assignment now, has no access (AC-40).
3. The Periode filter "Semua periode" is the handover helper.

### States (all screens)
| State | Behavior |
|---|---|
| Loading | Skeleton rows; controls usable |
| No match | "Tidak ada hasil. Ubah pencarian atau filter." + Reset |
| Error, PI-CORE or `nexus` unreachable | "Terjadi gangguan. Coba lagi." with retry; never "no access"; no sign-out |
| Session ended | Redirect to login (auth-login F9) |
| Right removed while open | Next action fails with "Aksesmu sudah berubah..." |
| Conflict | "Data sudah berubah. Muat ulang." |
| Upload fails | The step is not saved; "Berkas gagal diunggah. Coba lagi." |

---

## 4. Data and rules

### 4.1 Tables (plain words, schema `nexus`; the database engineer decides names)
All tables: RLS on, default deny, explicit policies. Writes only through server functions (no direct insert, update or delete grants for users). Creator ids are `members.id` from the session. No foreign keys into PI-CORE (access control 7.2).

| Table | One row is | Key fields | Notes |
|---|---|---|---|
| Minutes | one meeting record | unit id (`org_unit_id`), period id, meeting date, title, topic, content, decision, status (Aktif or Dibatalkan), void reason and who/when, created by/at, updated by/at, a version counter for the conflict check | Never deleted. RLS: all for `minutes.view` scope all, rows of the user's units for scope own unit |
| Minute files | one stored file | minute id, storage path, original name, size, type, uploaded by/at, withdrawn flag, reason, who/when | Private bucket. Never purged (access control L5). Readable only by someone who may read the parent minute |
| Minute history | one change | minute id, kind (recorded, edited, voided, file added, file withdrawn), before, after, reason, who, when | Append-only |
| Export log | one successful export | who, when, format, filters or minute id, period id, row count | Append-only, no PII. May share the table of Member Data and Letters (database engineer's call) |

### 4.2 State machine
Minute: **Aktif** to **Dibatalkan** only. Nothing else. A voided minute cannot be edited, cannot get files, cannot be restored.

### 4.3 Units a minute may belong to [N2 c: decided]
The unit list is read from PI-CORE `org_units` (active units). Decided list (N2 c, D-027): `BPH PMK ITERA`, the departments, the bureau, and the root `PMK ITERA` shown as "Seluruh organisasi" for plenary meetings. Divisions are not offered: a division meeting is recorded under its department (A-MN18, decided), like the unit filter of Data Anggota (A-MD2). A BPH secretary may choose any of the list; a department secretary only her own unit(s). Minutes under "Seluruh organisasi" are readable by BPH only (scope all), because no department or bureau secretary or head holds that unit. One minute has exactly one unit [A-MN4].

### 4.4 Files [N6 a: decided]
Private bucket, signed links of 300 seconds, issued only by the server to a user who may read the parent minute (access control R9, AC-48). Limits (decided, N6 a, D-027; same as Letters L8): PDF, JPG, PNG, 5 MB each, up to 3 per minute, real type checked by the first bytes, images resized in the browser to about 2000 px on the long side. Uploads go to the uploader's own folder before the minute exists; files never attached to a saved minute are not shown, and at most 10 unattached uploads per member per 24 hours are accepted (same pattern as A-LT13, F11). A wrong file is withdrawn, never deleted.

**Free-tier warning (owner decision N7 a, D-027).** Keep the N6 limits, resize images in the browser, check the real storage usage at every period handover (a step in the handover guide) and warn the owner at 70% of the quota (about 700 MB); at that point the owner decides between cleaning old files and paying. Supabase free storage is about 1 GB, shared by letters, minutes, finance proofs and borrowing evidence. [ASSUMPTION, my estimate] Minutes about 150 MB a year (about 100 minutes, 1.5 files, 1 MB each). With the existing estimates (letters about 200 MB, borrowing about 60 MB) and finance proofs (about 150 MB, `docs/modules/finance.md`) the total is about 560 MB a year, so the free tier lasts about 2 years. All of these are guesses; measure real usage at each period handover.

---

## 5. Business rules and edge cases

| # | Rule or case | Expected behavior |
|---|---|---|
| R1 | One owner unit | Every minute has one unit, chosen at creation, never changed. A joint meeting of two departments is recorded once, under one unit (or under "Seluruh organisasi" with N2 (c)) |
| R2 | Period | `period_id` is the active period at the moment of saving, not derived from the meeting date. A late minute for a meeting of the previous period is saved in the new period and is editable there |
| R3 | Period change | See F7. Old minutes are read-only (access control L7), readable by current view holders in scope (L8). There is no correction path for an old-period minute; accepted, because L7 is locked. A new minute may refer to it in its text |
| R4 | No active period | Recording is refused with a banner (access control R11); officers read nothing (E4); baseline members never read minutes anyway |
| R5 | Author deactivated | Their minutes stay, their name stays (AC-45). Another manager in scope can edit or void them in the active period |
| R6 | Secretary replaced or moved | Rights follow the current assignment on the next request (E10). A secretary who moves to another unit loses the old unit's minutes at once; the minutes stay with the unit |
| R7 | Several assignments | Union of rights and of units (E9, E1). A BPH secretary who is also Sekretaris Departemen has "all" |
| R8 | Unit changes in PI-CORE | The unit name is read live, including inactive units, so a renamed unit shows its new name on old minutes. If a unit is deleted and recreated (new id), old minutes keep the old id and stay readable by scope all (access control E3); a department secretary would not reach them. The settings screen cannot repair this; the System Admin must ask for a data fix |
| R9 | Meeting date | Not in the future; any past date [A-MN5]. If the date lies outside the period's start and end dates (informational in PI-CORE) the form shows a soft warning, no block |
| R10 | Text safety | All fields are plain text. Line breaks are kept; nothing is interpreted as HTML or Markdown; screens and exports escape it (the Content-Security-Policy is still open, `OPEN_QUESTIONS.md` F1, so this matters) |
| R11 | Concurrency | Edit and void check the version; the second writer gets "Data sudah berubah. Muat ulang." |
| R12 | Delete | No screen, function or call deletes a minute, file, history row or log row (access control L5). Void and withdraw replace delete |
| R13 | Export never exceeds view | The export uses the same scope as the list (access control R15). A hand-made filter for a unit outside the scope returns nothing |
| R14 | Time zone | "Today", future-date checks, caps and export dates use Asia/Jakarta (WIB); timestamps are stored in UTC |
| R15 | Privacy | Minutes can hold sensitive talk (personnel, money). They are readable only by the keys above. `minutes.view` is not a sensitive key (access control L12 does not cover it), so the System Admin could grant it to every member; no default rule does, and N1 does not recommend it |
| R16 | Many rows | Server pagination; search runs inside the visible rows only |

---

## 6. Stitch conflicts (filler flagged, not adopted)

| Stitch content (screens 08, 09, Dashboard card) | Problem | Decision |
|---|---|---|
| Prefilled sample values: "Rapat Koordinasi BPH & Koordinator Divisi", "Persiapan Natal Bersama...", three decisions about "Natal 15 Desember 2026" and "RAB 2 November 2026", date 2026-10-24 | Sample data | Fields start empty (date = today) |
| Chips "Sistem Dokumen Terverifikasi" and "v2.4 NEXUS", footer "Sistem Administrasi Resmi" | Filler claims and a version string | Dropped |
| Chip "Disimpan terenkripsi di Cloud ITERA" | Not true: files sit in a private Supabase bucket | Dropped |
| "Mendukung format PDF, DOCX (Maksimal 10MB)" | New rule, conflicts with Letters L8 | Decided N6 (a): text "PDF, JPG, atau PNG. Maksimal 5 MB, sampai 3 berkas." Answers C9 |
| Button "Simpan Draft" | A draft state nobody defined | Decided N3 (a): dropped |
| Breadcrumb "Administrasi > Notulensi Rapat" and the subtitle "...Pertemuan Pengurus" | No "Administrasi" area exists; "Pengurus" suggests board meetings only | Back link instead; neutral subtitle |
| No unit field | D-008 needs one | Added (section 7, screen 3) |
| "Keputusan & Tindak Lanjut *" marked required | A briefing may have no decision | Optional [A-MN2] |
| Red text button "Batal" | Cancel is not destructive | Neutral outline button |
| Dashboard "Recent Meetings": statuses Selesai, Terjadwal, Mendatang; chip "3 Rapat"; "+ Buat Agenda"; sample names "Rapat Koordinasi 2026-07-17"; link "Buka Arsip Notulensi Lengkap" | A schedule nobody defined (C8); titles shown to everyone | Decided N4 (a) and N5 (a): no statuses, no "Buat Agenda", counts only. Answers C8 |
| No drawer markup on 08 and 09 | Incomplete screen | The drawer of the other screens is used |
| Animated variant 09 | Motion only | Motion follows D-023, not copied |
| No list, detail, edit, void, export, empty or error screen | Missing | Section 7 |

---

## 7. Screens

Stitch has one form (08, 09). Everything else is missing and is described here in words, so no separate UX round is needed. Style follows D-014 and D-023 (header card, 12 px cards, 8 px controls, chips only for status and filters, fields 44 px high with 16 px text per D-017). Copy uses "kamu" and short sentences.

**Screen 1. List** (`/notulensi`; Stitch has none).
- Header card: H1 "Notulensi Rapat", line "Periode {label}". Two tiles: "Notulensi periode ini" (number) and "Rapat terakhir" (date, or "-").
- Row of controls: search field "Cari judul, topik, atau isi..."; a "Filter" button opening a sheet with "Unit", "Periode", "Status" and "Reset". Managers see the primary button "Catat notulensi"; export holders see "Ekspor".
- Cards on phones, table from 1024 px (Tanggal, Unit, Judul, Topik, Berkas). Card: line "17 Okt 2026 · Departemen Internal" (example format), title bold, topic one line, "2 berkas" with a paperclip, chip "Dibatalkan" only when void.
- Empty: "Belum ada notulensi." (managers add "Catat notulensi pertama lewat tombol di atas."). No match: "Tidak ada hasil. Ubah pencarian atau filter." Error: "Terjadi gangguan. Coba lagi."
- No active period banner (managers): "Belum ada periode aktif. Notulensi belum bisa dicatat."

**Screen 2. Detail** (Stitch has none). Back link "Kembali ke daftar". H1 "Detail Notulensi". Card 1 "Data Pertemuan": "Tanggal rapat", "Unit", "Periode", "Dicatat oleh {nama}, {tanggal}". Card 2: "Topik bahasan", "Isi notulensi", "Keputusan dan tindak lanjut" (when empty: "Tidak ada keputusan yang dicatat."). Card 3 "Lampiran": one row per file with "Lihat"; empty "Tidak ada lampiran." Card 4 "Riwayat": timeline "Dicatat oleh {nama}", "Diubah oleh {nama}" (tap for before and after), "Dibatalkan oleh {nama}". Void block: "Dibatalkan oleh {nama} pada {tanggal}. Alasan: {alasan}". Old period: note "Notulensi periode lama hanya bisa dibaca." Manager actions: "Ubah", "Tambah lampiran", "Batalkan notulensi"; export holders: "Ekspor" ("Unduh notulensi ini sebagai:").

**Screen 3. Record form** (Stitch 08, adapted). Back link "Kembali ke daftar", H1 "Catat Notulensi", subtitle "Catatan rapat dan keputusannya."
- Card "Data Pertemuan": "Unit" (select; with one unit a read-only line with the hint "Sesuai jabatanmu."), "Tanggal Rapat", "Judul Rapat" (placeholder "Contoh: Rapat evaluasi bulanan"), "Topik Bahasan" (placeholder "Pokok bahasan rapat").
- Card "Risalah & Hasil Rapat": "Isi Notulensi" (5 rows, placeholder "Tuliskan poin pembahasan dan catatan penting..."), "Keputusan & Tindak Lanjut (boleh kosong)" (4 rows).
- Card "Lampiran": dashed area "Ketuk untuk memilih berkas", help "PDF, JPG, atau PNG. Maksimal 5 MB, sampai 3 berkas." (N6 a). A picked file shows name, size and "Hapus" (removes it from the form before saving).
- Buttons: primary "Simpan Notulensi", outline "Batal".
- Errors under fields: "Isi tanggal rapat." "Tanggal rapat tidak boleh di masa depan." "Judul wajib diisi." "Topik wajib diisi." "Isi notulensi wajib diisi." "Terlalu panjang (maksimal {n} karakter)." File: "Hanya PDF, JPG, atau PNG." "Berkas terlalu besar (maksimal 5 MB)." "Maksimal 3 berkas." Unit not allowed: "Kamu tidak bisa mencatat notulensi untuk unit ini."
- Leave prompt (sheet): "Keluar dari halaman ini?" / "Perubahan belum disimpan." / "Tetap di sini", "Keluar".
- Success message: "Notulensi tersimpan."

**Screen 4. Edit form.** Same as screen 3, H1 "Ubah Notulensi", the Unit shown read-only, button "Simpan Perubahan", message "Perubahan tersimpan."

**Screen 5. Void dialog.** Title "Batalkan notulensi?" Body "Notulensi tetap tersimpan sebagai Dibatalkan, tidak bisa diubah, dan tidak bisa dikembalikan." Field "Alasan pembatalan" (required). Buttons "Ya, batalkan" and "Kembali". Missing reason: "Tulis alasan pembatalan."

**Screen 6. Withdraw-file dialog.** Title "Tarik berkas?" Body "Berkas disembunyikan dari pembaca dan hanya terlihat oleh pengelola. Berkasnya tidak dihapus." Field "Alasan". Buttons "Tarik berkas" and "Kembali".

**Screen 7. Export menu.** Same as Data Anggota: "Unduh semua hasil filter sebagai:" Excel, CSV, PDF; busy "Menyiapkan file..."; done "Unduhan dimulai: {file}"; too many rows "Terlalu banyak data untuk satu file. Persempit dengan filter periode atau unit."

**Screen 8. Dashboard card** (layout belongs to the Dashboard module). Decided N5 (a): title "Notulensi Rapat", "{n} notulensi di periode {label}", "Rapat terakhir {tanggal}", link "Buka notulensi". Scope-limited (a department secretary counts her unit only). Empty "Belum ada notulensi di periode ini." Error inside the card only: "Data notulensi belum bisa dimuat." with "Coba lagi".

**Screen 9. Shared.** No-permission page, "no active period" banner, system messages: reuse the existing shared ones.

**Nothing in this module needs a separate UX round.** The visual finish of screens 1 to 3 follows the D-023 rollout; the frontend engineer builds them with the design skills.

---

## 8. Export, log and Dashboard

| Export | Key | Who (default) | Content |
|---|---|---|---|
| Minutes list (current filters, scope-limited) or one minute | `minutes.export` | BPH all (D05), department secretaries own unit (D27) | Meeting date, unit, title, topic, content, decision, status (with void reason), period, recorded by (name), recorded at, file count |

- Formats and writers follow D-019 and D-020 (`src/lib/export/`). Header shows the period filter and export date in WIB [A-MN16]. PDF shows each minute as its own block (title, meta, content, decision), not a table cell.
- Row guard as in D-022: the server counts first (`total_count`) and refuses when more than 1000 rows match or when fewer rows arrive than counted; the message tells the user to narrow the filter.
- One append-only log row per successful export, no PII, no exported rows; no export without a log row. The screen to read the log comes later with the Member Data log screen (A-MD14); no new key now.
- **Dashboard card.** Counts only (N5 a, decided): no titles, so a sensitive title never leaves the module.

---

## 9. Assumptions

All [ASSUMPTION] until the owner confirms, except the rows marked DECIDED. The 2026-11-09 answers settled: A-MN18 (N2 c), the file type, size and count part of A-MN9 (N6 a), and the "no schedule" and "counts only, no titles" parts of the out-of-scope list and A-MN13 (N4 a, N5 a). A-MN15 (void, not restorable) follows N3 (a) for the void itself; "not restorable" stays an assumption. Copied to `docs/OPEN_QUESTIONS.md` section J.

| Id | Assumption |
|---|---|
| A-MN1 | No attendee list, meeting time, place or action tracking in Phase 1 (not in context 5.4 or Stitch). A free "Peserta" text or a member picker can be added later without a rewrite |
| A-MN2 | "Keputusan & Tindak Lanjut" is optional (Stitch marks it required). The other four text fields and the unit are required |
| A-MN3 | Limits: title 150 characters, topic 200, content 20000, decision 5000, void and withdraw reasons 500. Plain text only |
| A-MN4 | The unit is fixed after saving; one unit per minute. A wrong unit is fixed by void and re-record. "Salin jadi baru" is a possible later helper |
| A-MN5 | The meeting date is not in the future; any past date is accepted; the period is the active period at saving |
| A-MN6 | Search covers title, topic and content (case-insensitive, inside visible rows). Page size 20. Sort: meeting date newest first, then newest recorded. Filters: Unit, Periode (active or all), Status (default Aktif) |
| A-MN7 | Every reader of a minute sees its edit history with before and after; withdrawn files are visible to managers only |
| A-MN8 | The list export is all rows matching the filters and scope. A single-minute export from the detail uses the same endpoint (its log row stores the minute id) |
| A-MN9 | File handling reuses Letters. **DECIDED (N6 a): PDF, JPG, PNG, 5 MB, up to 3.** Still an assumption: signed links 300 seconds, unattached uploads capped at 10 per member per 24 hours, withdrawn files do not count toward the 3, magic-byte check, browser resize to about 2000 px |
| A-MN10 | A minute has no number or reference code |
| A-MN11 | Leaving the form with unsaved typing asks first; no draft is stored in the browser |
| A-MN12 | The unit name is read live from PI-CORE at read time, inactive units included |
| A-MN13 | Header tiles and the Dashboard card count Aktif minutes of the active period inside the user's scope |
| A-MN14 | The drawer label and H1 are "Notulensi Rapat" (context section 6, Stitch) |
| A-MN15 | Void cannot be restored; there is no separate "archive" action (the word in the key text means void) |
| A-MN16 | Export header shows the period filter and export date in WIB; no file links in exports |
| A-MN17 | A minute of a deactivated unit stays readable by scope |
| A-MN18 | **DECIDED (N2 c, D-027):** unit list is BPH, the departments, the bureau and "Seluruh organisasi"; divisions are not offered; their meetings are recorded under the department |

---

## 10. Questions for the owner

Seven owner-level questions, **all answered 2026-11-09: the owner accepted every recommendation (D-027).** Options are kept below for the record. Everything else is an assumption above.

**N1. Who may read minutes?** [ANSWERED 2026-11-09: (b)] (B17, B19; D-008 fixes only who may WRITE.)
- (a) Default today: BPH reads all; a department or bureau secretary reads her own unit; nobody else.
- (b) (a) plus the Kepala Departemen or Kepala Biro reads the minutes of their own unit (new default rule D37: role `kepala_departemen`, `minutes.view`, own unit; read only, no export).
- (c) (a) plus every member of a unit reads their own unit's minutes (needs a unit-wide rule).
- **Owner answer 2026-11-09: (b), as recommended.** The head attends the meetings and is responsible for the decisions, yet under (a) could not read the record. (c) opens talk that may be sensitive. Becomes default rule D37 (access control section 3). The System Admin can change it later (D-011).

**N2. Which units may a minute belong to?** [ANSWERED 2026-11-09: (c)] (D-008 needs one owning unit; divisions have no secretary.)
- (a) BPH, the 7 departments and the bureau only; a division meeting goes under its department.
- (b) Any unit including divisions (only BPH secretaries can record those, because a department secretary's scope is exactly her department).
- (c) (a) plus the root "Seluruh organisasi" for plenary meetings (readable by BPH only).
- **Owner answer 2026-11-09: (c), as recommended.** It matches how Data Anggota groups units and gives plenaries a home. Choose (b) only if divisions have their own note-takers.

**N3. Can a minute be corrected after saving, and is there a draft?** [ANSWERED 2026-11-09: (a)] (Stitch shows "Simpan Draft".)
- (a) No draft. A manager edits an Aktif minute of the active period; every edit leaves a history row with before and after; a wrong or duplicate minute is voided with a reason.
- (b) Draft first (private to managers of that unit), then "Terbitkan" locks it; later changes are dated revisions.
- (c) No edits at all: void and record again.
- **Owner answer 2026-11-09: (a), as recommended.** Same pattern as Letters, simple, and the history keeps it honest. (b) adds a visibility rule per status for a small gain.

**N4. Do meetings need a schedule or status?** [ANSWERED 2026-11-09: (a); answers C8] (C8: Stitch Dashboard shows Selesai, Terjadwal, Mendatang and "+ Buat Agenda".)
- (a) No. NEXUS records minutes after a meeting; a minute has no status except Aktif or Dibatalkan.
- (b) Add planned meetings (date, title, unit) that later become minutes.
- **Owner answer 2026-11-09: (a), as recommended.** Nothing in the context document asks for an agenda, and (b) is a second feature (calendar, who plans, reminders). It can be added later.

**N5. What does the Dashboard "Recent Meetings" card show?** [ANSWERED 2026-11-09: (a)] (Context 5.1 lists "latest meetings"; Letters chose counts only.)
- (a) Counts and the date of the latest meeting, no titles: "{n} notulensi di periode {label}", "Rapat terakhir {tanggal}".
- (b) The latest 3 titles with date and unit, limited to what the user may read.
- (c) No card.
- **Owner answer 2026-11-09: (a), as recommended.** A title can be sensitive and the Dashboard is the first page; (b) is acceptable if the owner wants it.

**N6. Which attachments are accepted?** [ANSWERED 2026-11-09: (a); answers C9] (C9: Stitch says PDF/DOCX, 10 MB.)
- (a) Same as Letters: PDF, JPG, PNG, 5 MB each, up to 3 per minute; images resized in the browser.
- (b) PDF and DOCX, 10 MB each, up to 3 (Stitch).
- (c) No attachments in Phase 1; everything is typed into NEXUS.
- **Owner answer 2026-11-09: (a), as recommended.** One rule for all modules, and phone photos of an attendance sheet work. DOCX is editable and large; (b) uses the shared 1 GB twice as fast.

**N7. What is the plan for the 1 GB free storage?** [ANSWERED 2026-11-09: (a)] (Cross-module: letters, minutes, finance proofs, borrowing evidence; estimate about 560 MB a year, all guesses.)
- (a) Keep the limits of N6 and Finance K5, resize images, and check real usage at every period handover; warn the owner at 70%; decide then between cleaning old files and paying.
- (b) Tighter limits now: 3 MB per file and 2 files per record.
- (c) Plan for a paid Supabase plan from the start.
- **Owner answer 2026-11-09: (a), as recommended.** No cost now, nothing thrown away, and real numbers replace guesses. The handover guide gets a "check storage" step.

---

## 11. Acceptance criteria

Personas: `docs/modules/access-control.md` section 9. Default rules apply unless stated. Every criterion is tested through the UI AND by a direct call with that persona's token. They follow the owner's answers of section 10 (all recommendations accepted, 2026-11-09, D-027).

**Permissions and scope**
- MN-01 P-SEKJEN can record, edit, void and export minutes of any allowed unit and add files.
- MN-02 P-SEKDEP (Departemen Internal) can record, edit and void minutes only for Departemen Internal; the unit select offers only that unit; a direct call with another unit's id is refused.
- MN-03 P-SEKDEP cannot read minutes of another unit (list, detail, files, export); the API returns zero rows (AC-18).
- MN-04 P-KETUM and P-BEND can read all minutes and export; they cannot record, edit, void or add files (AC-07 pattern).
- MN-05 (N1 b) A Kepala Departemen reads the minutes of their own unit only and cannot edit or export; with rule D37 disabled they read nothing.
- MN-06 P-PLAIN, P-STAFF-PUB, P-LECT, P-ADMIN (no assignment), P-OLD, P-INACTIVE and P-UNLINKED read no minute; the drawer item is absent for them (AC-29, AC-32, AC-40).
- MN-07 A user with Sekretaris Departemen in two units can record minutes for both and for no other unit (AC-21).
- MN-08 After a secretary's assignment moves to another unit, her next request no longer returns the old unit's minutes.

**Record, edit, void**
- MN-09 Recording validates on the server: required fields, limits of A-MN3, a meeting date not in the future, an allowed unit; the saved creator is the session member and the period is the active period, never client input.
- MN-10 With no active period, recording is refused with the banner text, and officers read nothing (access control R11).
- MN-11 Editing works only on an Aktif minute of the active period inside the user's scope; each save writes one history row with before and after; unit and period cannot be changed even by a direct call.
- MN-12 A minute of a non-active period cannot be edited, voided or given files by any persona (access control L7).
- MN-13 Voiding needs a reason; the minute stays in the list with the chip "Dibatalkan", is read-only, cannot be restored, and appears in the export with its status.
- MN-14 Two managers saving the same minute at once: exactly one succeeds, the other gets "Data sudah berubah. Muat ulang.".
- MN-15 No screen, function or call deletes a minute, file, history row or export-log row, for any persona including P-ADMIN (AC-51).
- MN-16 Text typed as `<script>` or HTML in any field is shown as plain text on screen and in exports and never runs.

**Files**
- MN-17 Only types and sizes allowed by N6 are accepted (checked by the real file type, not the name); a fourth file, an oversized file or another type is refused, also by direct upload.
- MN-18 The bucket is private; a file link is signed, expires within minutes, and is returned only to a user who may read the parent minute; a P-SEKDEP asking for a file of another unit gets nothing (AC-48).
- MN-19 A withdrawn file keeps its record and stored file, is visible only to managers, and does not count toward the limit of 3.
- MN-20 More than 10 unattached uploads by one member in 24 hours are refused; unattached files never show as minute files.

**Browse and search**
- MN-21 Search finds a minute by part of its title, topic or content, case-insensitively, and returns only rows the user may read.
- MN-22 The Unit filter is offered only when the user can read more than one unit; Periode and Status filters work with server pagination of 20.

**Period, deactivation**
- MN-23 After a period switch, old minutes stay readable to current holders in scope and are read-only; a new Sekretaris Departemen of the same unit reads that unit's earlier minutes; P-OLD does not (AC-38, AC-40).
- MN-24 When an author is deactivated, their minutes remain and their name still shows (AC-45).

**Export and Dashboard**
- MN-25 P-KETUM and P-SEKJEN see "Ekspor"; P-SEKDEP sees it for her unit only; P-PLAIN does not, and a direct export call is refused.
- MN-26 Excel, CSV and PDF contain all rows matching the current filters inside the user's scope, in screen order, with the same count as the screen, dates in WIB and voided minutes marked; a P-SEKDEP export with another unit's filter returns nothing; a single-minute export from the detail works.
- MN-27 Each successful export writes exactly one log row (who, when, format, filters or minute id, period, row count); a refused export, or one whose log write fails, writes none and returns no file; the row holds no PII and cannot be updated or deleted.
- MN-28 (N5 a) The Dashboard card is shown only to `minutes.view` holders, counts only Aktif minutes in their scope, shows no titles, and shows an empty state when there are none.

**Quality**
- MN-29 At 390 px every screen works without horizontal page scroll; fields are at least 44 px high with 16 px text (D-017); leaving the form with unsaved typing asks first.
- MN-30 A pgTAP test per persona proves RLS: zero rows for denied users on minutes, files, history and export log, including own-unit isolation; every `nexus` table of this module has RLS enabled and no direct write grant; no response, screen or export contains email, phone, NIM or NIP, and names come from PI-CORE only through `src/lib/picore/`.

---

## 12. Notes for other documents (contradictions and gaps found)

1. **Context 5.4 had no unit field**, but D-008 and access control 7.2 need `org_unit_id` on every minute. This spec adds it (screen 3). Resolved 2026-11-09: context section 5.4 now lists "Unit".
2. **Context 5.1 and Stitch "Recent Meetings"** show titles and statuses (Selesai, Terjadwal, Mendatang) that nothing defines (C8). Letters decided counts only (D-025 L11). Resolved 2026-11-09 (N4 a, N5 a): no statuses, counts only.
3. **Access control key text for `minutes.manage` says "archive minutes".** Read as void (A-MN15), the same reading as A-LT3 for letters. Resolved 2026-11-09: the key text in `docs/modules/access-control.md` now says "void".
4. **C9 (PDF/DOCX, 10 MB) versus Letters L8 (PDF/JPG/PNG, 5 MB, no DOCX).** Two rules for the same storage; resolved 2026-11-09 by N6 (a): one rule (PDF, JPG, PNG, 5 MB), C9 answered.
5. **B19 (unit members cannot read their unit's minutes) leaves the unit head unable to read** the record of their own department. Raised as N1; resolved 2026-11-09 with (b): default rule D37 added in `docs/modules/access-control.md` (enabled rules 35 to 36; no new key). `minutes.view` is not sensitive, so no written reason is required, but the seed should carry a note.
6. **Divisions have no secretary** (schema report section 8: Sekretaris exists only for departments and the bureau), so D-008 leaves division meetings without an owner. Resolved 2026-11-09 (N2 c): division meetings are recorded under the department.
7. **Free tier.** Letters, minutes, finance proofs and borrowing evidence share about 1 GB (N7 a decided: check usage at each handover, warn at 70%; `OPEN_QUESTIONS.md` C9, F11).
8. **Security ordering.** Minutes render user text and the Content-Security-Policy is still open (F1). The plain-text rule (R10, MN-16) is the mitigation until F1 is done.
