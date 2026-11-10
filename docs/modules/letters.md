# Letters / Surat Menyurat (module spec)

> Status: **Approved 2026-11-09 (owner accepted all recommendations L1-L11, D-025).** Step 1 of `CLAUDE.md` sections 9 and 18 is done. Nothing is built yet; the next step is the UX design of the missing screens (section 7), then the database layer. Recorded in `docs/DECISIONS.md` D-025. **Amended 2026-11-09 (G1): "Ambil nomor"** (L2 amendment, owner): the number is taken while a request is Diproses so it can be printed before signing (F6, 4.2, R19, R20). **Design approved 2026-11-09:** `docs/design/letters.md` (P1-P15 and G2-G17, section 10b), except that P6 and the "Nomor berikutnya" mismatch idea (design 12.5) are replaced by "Ambil nomor"; the design needs a revision for it.
> Sources: `CLAUDE.md` (4-8, 11), `docs/PMK-NEXUS-context.md` (4, 5.5, 6), `docs/DECISIONS.md` (D-007, D-008, D-009, D-010, D-011, D-013, D-014, D-019, D-020, D-021, D-022, D-024), `docs/OPEN_QUESTIONS.md` (A2, A4, A6, B17, B21, B23, C6, C10, section B-bis), `docs/modules/access-control.md` (keys, D06-D08, D15-D23, L1, L4-L12, R11, R15, E4, E8, E15, A-n9), `docs/modules/inventory-borrowing.md` and `docs/modules/member-data.md` (structure and patterns), `docs/design/stitch/screens.md` (10, 11) and `html/10-*.html`, `html/11-*.html`, `docs/design/stitch/comparison.md`, `docs/picore/schema-report.md`.
> Tags: **[ASSUMPTION]** = my guess, still needs the owner (A-LT1 to A-LT24, section 9, `docs/OPEN_QUESTIONS.md` section I; those settled by the L1-L11 answers are marked DECIDED). **[UNKNOWN]** = no source. **L1-L11** (no dash) = owner questions, all answered, section 10. **LT-01 to LT-52** (with LT-15a and LT-15b) = acceptance criteria, section 11. A bare "L1" to "L11" always means an owner question of this spec. The locked rules of access control (also numbered L1-L12) are always written "access control L6" and so on.
> No code, no SQL, no visual design. PMK facts (letter types, institution names, signatories) are NOT invented. Everything Stitch shows (Direktorat Jenderal Pajak, Rektorat, "Dokumen Disposisi", the statuses) is filler.

---

## 1. Purpose and scope

**Purpose.** Give PMK ITERA one trustworthy register of incoming and outgoing letters with their files, one official numbering, and a clear way for any member to ask the secretaries for a letter.

**Analogy.** The secretariat's logbook plus its filing cabinet. The logbook gives every letter one number and one line. The cabinet holds the scanned file. A request is a note on the secretary's desk: "please prepare this letter for me".

**In scope**
- Register of **Surat Masuk** and **Surat Keluar**: number, counterpart, subject (Perihal), dates, notes, files, status (Aktif or Dibatalkan).
- Numbering by the system in the provisional format of D-024, as a **setting** (section 4.3).
- Archive of letter files in a private bucket (the register is the archive; there is no separate archive screen, A-LT3).
- **Letter request flow**: any active member requests, a secretary processes, the requester gets the number and the file.
- Export of the register (Excel, CSV, PDF) with an export log.
- The counts for the Dashboard "Surat Menyurat" card (the card belongs to the Dashboard module, L11).

**Out of scope (Phase 1)**
- Generating letter documents from templates, or an e-signature (L1). The Ketua Umum's signature happens outside NEXUS; NEXUS stores the final file.
- Follow-up tracking of incoming letters (disposisi, assignment to a unit), unless the owner chooses it in L5.
- Notifications by email or push. The requester checks "Permohonan Saya" (same principle as IB14).
- Exporting the request list, a confidential-letter flag, letter templates, letter lists of institutions (counterparts are free text).
- Program of work (progja): not Phase 1. The module is self-contained (`src/modules/letters`); letters carry `period_id`, so progja can later link a letter to an event by id without a rewrite [A-LT22].

NEXUS stores the letters itself (NEXUS data, schema `nexus`). Member identity is not copied: rows store `members.id`; names are read from PI-CORE through `src/lib/picore/` at read time (D-010). No email, phone, NIM or NIP anywhere (access control L4).

---

## 2. Who uses it and who may do what

Rights come from permission keys (access control, section 2.1), never from a person. No new key is needed. "BPH secretary" = the positions Sekretaris Jenderal, Sekretaris Umum 1, Sekretaris Umum 2 (D-008, rules D15-D23).

| Key / fixed right | Unlocks | Default holders |
|---|---|---|
| `letters.view` | Open the register tabs; read letters and their files | Role `bph` (D06). Included in `letters.manage` |
| `letters.manage` | Register incoming and outgoing letters directly; edit their details; add files; void a number. Includes view. Power key (access control L12) | BPH secretaries (D15, D18, D21) |
| `letters.export` | Export the register | Role `bph` (D07) |
| `letter_requests.view_all` | See every request and its attachments (own are always visible) | Role `bph` (D08). Included in `process` |
| `letter_requests.process` | Accept (Diproses), take a number ("Ambil nomor"), reject, issue a letter (Diterbitkan) from a request. Includes view_all. Never on own requests (access control L6). Power key (access control L12) | BPH secretaries (D16, D19, D22) |
| fixed (access control L9, no key) | Submit a request; see own requests (status, number, processor note, files); download the issued file of own request (B23, owner question L9); cancel own request while Diajukan | Every active member, cannot be disabled |

| Actor | Register (read) | Register (write, void) | Own requests | All requests | Process requests | Export |
|---|---|---|---|---|---|---|
| BPH secretary (P-SEKJEN) | Yes | Yes | Yes | Yes | Yes, **except own request** | Yes |
| Other BPH (P-KETUM, P-BEND) | Yes | No | Yes | View only | No | Yes |
| Department or bureau secretary (P-SEKDEP) | **No** [B17] | No | Yes | No | No | No |
| System Admin without BPH position (P-ADMIN) | No (B18) | No | Yes | No | No | No |
| Plain member, Staff, lecturer (P-PLAIN, P-STAFF-PUB, P-LECT) | No | No | Yes | No | No | No |
| BPH secretary of a PREVIOUS period only (P-OLD) | No | No | Yes | No | No | No |
| Deactivated, unlinked, anonymous | No | No | No | No | No | No (access control L1) |

**Rules that follow**
- **Self-processing (access control L6).** Nobody accepts, takes a number for, rejects or issues their own request. It applies only to processing a request. A secretary who needs a letter for themselves uses direct registration (F4), which is not a request; the register row names the creator. This keeps the single-secretary case workable (A-n9) and is the honest consequence of the owner's rule D-008.
- **Direct registration needs `letters.manage`.** Taking a number and issuing from a request need only `letter_requests.process`; the "Ambil nomor" function creates the register row itself [A-LT4].
- **Without a key.** A direct link to the register or the queue shows the shared "no permission" page; API calls return no rows. Buttons without the key are absent, not greyed.
- **Drawer.** Every active member can open "Surat Menyurat" (to reach "Permohonan Saya"), so the drawer item is shown to every active member. This is an explicit exception to D-021 (D-025); the register tabs stay behind `letters.view`. See note 1 in section 12.
- **Scope** of all letter keys is "all" (access control 2.1); letters carry no org unit.

---

## 3. User flows

Common: every step runs on the server. Each page and action checks session, active member (access control L1) and the key before anything else. Mobile-first, 390 px. Texts are proposals for the UX designer. Dates are Jakarta calendar dates.

### F1. Browse the register (`letters.view`)
1. The user opens "Surat Menyurat". Holders see the register tabs "Surat Masuk" and "Surat Keluar" **without a bracket count** (design P2: a count cannot follow the search and filters; the counts are in the header tiles). Only "Antrean" shows "(n)" for requests that need action. Others see only the request area (F5).
2. List per tab, newest registered first: number, counterpart, Perihal, date, a mark when files exist. **Chips only for "Dibatalkan" and "Nomor lama"** (design P3): Aktif is the quiet default and has no chip. Search by number, counterpart and Perihal. Filters: period ("Periode aktif" default, "Semua periode"; no single old period, design G8), year of the number, status, "Tanpa berkas". Pagination on the server (page size 20 [A-LT15]).
3. Letter detail: all fields, files ("Lihat" opens a short-lived signed link), who registered it and when, edit history, linked request if any. Never any email or phone.
4. Empty: "Belum ada surat." (managers also see the register button). Error: "Terjadi gangguan. Coba lagi." with retry (fail closed, no sign-out).

### F2. Register an incoming letter (`letters.manage`)
1. The manager taps the register button on the "Surat Masuk" tab (design missing).
2. Fields: **received date** (required, default today, not in the future), **sender** (required, free text), **Perihal** (required), letter date (optional), the sender's own letter number (optional free text), notes (optional), files (optional, L5/L8).
3. The server validates, assigns the next `SM` number for the current year (section 4.3) in the same transaction as the insert, saves status Aktif and `period_id` = active period, and writes a history row.
4. The user sees the saved letter with its number. No active period: "Belum ada periode aktif. Surat belum bisa dicatat." (R11).

### F3. Register an outgoing letter directly (`letters.manage`) [L4]
Same as F2 on the "Surat Keluar" tab: letter date (required, default today), **addressee** (required), Perihal (required), notes, files (optional). The server assigns the next `SK` number. The record has no linked request.

### F4. Edit, add files, void (`letters.manage`)
1. **Edit** letter date, received date (design G3), counterpart, Perihal, notes, own letter number: only for an Aktif letter of the ACTIVE period (access control L7). Each edit writes a history row with before and after (owner question L6). The number, the type and the year are never editable.
2. **Add a file** to an Aktif letter of the active period. A wrong file is marked "Ditarik" with a reason; the record and the stored file stay (access control L5), and only managers see withdrawn files [A-LT9]. Withdrawn files do not count toward the limit of 3, and the last visible file of a letter that came from a request cannot be withdrawn until a replacement is added (design G4).
3. **Void ("Batalkan nomor")**: required reason. The row stays in the register as "Dibatalkan", the number stays used and is never reissued, files stay. A voided letter is read-only and cannot be restored [A-LT8]; the correct letter gets a new number.
4. A letter of a non-active period is read-only (access control L7).
5. **A letter whose request is still open** (the number was taken with "Ambil nomor", the request is Diproses) cannot be voided, and gets no file, through the register. The processor finishes it with "Terbitkan" or ends it by rejecting the request (F6) [A-LT24].

### F5. A member requests a letter (every active member)
1. The member opens "Surat Menyurat" > "Permohonan Saya" > "Ajukan Surat" (designed in `docs/design/letters.md`).
2. Fields (L3, recommended set): **Perihal** (required, what the letter is about), **Ditujukan kepada** (required, who receives it), **Keperluan** (required, free text: what is needed, event, context), **Atas nama** (optional free text, unit or committee), **Dibutuhkan paling lambat** (optional date), **lampiran** (optional, up to 3 files, same limits as section 4.4).
3. The server re-validates everything (never trusts the form): active member, active period exists (R11), field lengths, request caps (L10), file rules. It saves status **Diajukan**, period = active period, requester = session member (never client input).
4. The member lands on the request detail: fields, status timeline, "Cek statusnya di Permohonan Saya." No active period: "Belum ada periode aktif. Permohonan belum bisa dibuat."
5. A submitted request cannot be edited; cancel and resubmit [A-LT10].

### F6. A secretary processes the queue (`letter_requests.process`)
1. The secretary opens "Antrean Permohonan": default filter "Diajukan", oldest first, with a count. Filters: status, date range, requester name, "Belum selesai (semua periode)".
2. They open a request: all fields, attachments, requester name (from PI-CORE). Own request: action buttons absent with "Tidak bisa memproses permohonanmu sendiri." (access control L6).
3. **Proses** moves it to Diproses (optional note; from here the requester can no longer cancel). If only one `process` holder exists, the queue shows a hint (access control A-n9).
4. **Ambil nomor** (only from Diproses, once per request; amendment L2, D-025 G1): the number must be printed on the letter before it is signed, so it is taken first. In one transaction the server assigns the next `SK` number (same rules as 4.3, never reused) and creates the linked outgoing register row (status Aktif, **no file yet**, period = active period). The status stays Diproses. The requester sees the number in the request detail; they get no file yet.
5. **Terbitkan** (only from Diproses after the number was taken): the secretary uploads at least one final signed file (required: the requester will download it) and may correct Perihal, addressee and letter date (not the number). In one transaction the server attaches the files to the existing register row and sets the request to **Diterbitkan**. If the upload or the save fails, nothing changes; the number stays taken and the request stays Diproses. Terbitkan without a taken number is not offered [A-LT23].
6. **Tolak** needs a note, from Diajukan or Diproses; status Ditolak. If a number was already taken, the same transaction **voids the linked register row** (Dibatalkan) with the rejection note as the void reason; the number stays used and is never reissued. This is how an abandoned letter ends.
7. Two secretaries acting at once: the second action fails with "Data sudah berubah. Muat ulang." because the starting status or the taken number no longer matches; pressing "Ambil nomor" twice at the same moment uses exactly one number.

### F7. The requester follows and collects
1. "Permohonan Saya" lists own requests with a status chip, newest first: Diajukan, Diproses, Diterbitkan, Ditolak, Dibatalkan.
2. In the detail the requester sees the timeline, the processor's note (always required on rejection), the **letter number as soon as it is taken** (status still Diproses), and, once Diterbitkan, the **file** (download through a short-lived signed link; B23, owner question L9). If the request is rejected after the number was taken, the requester sees the rejection note, and the file and the void reason of the register row stay internal (design G5).
3. **Cancel** is possible only while Diajukan (access control L9: "before it is processed", read here as: before it leaves Diajukan [A-LT6]). Reason optional. Status Dibatalkan.
4. A Ditolak or Dibatalkan request offers "Ajukan lagi" (prefilled), a new request.

### F8. Export (`letters.export`)
1. One "Ekspor" button with a menu Excel, CSV, PDF (same pattern as Data Anggota). Absent without the key.
2. The server rebuilds the list of the active tab with the current search and filters, ALL matching rows, same order and columns as the screen (R15). Voided letters appear with status "Dibatalkan", so number gaps are explainable. File contents and links are not exported.
3. One append-only export-log row is written before the file is returned (who, when, tab, format, filters, period; no PII, no search text). If the log write fails, no file is returned (same as Member Data A-MD12). Dates in WIB (D-020 writers).

### F9. Period change
1. When PI-CORE switches the active period, the next request sees the new period; no logout, no deploy (access control R3).
2. Letters and requests keep the `period_id` of creation. Old-period letters are read-only and readable by current `letters.view` holders (access control L7, L8). The numbering year does not reset on a period change (the year in the number is the calendar year, A-LT1).
3. **Open requests** (Diajukan, Diproses) of an old period stay actionable by current `process` holders (access control L7, E8), including taking a number, issuing and rejecting. A number taken after the switch creates its letter in the ACTIVE period, linked to the old request; a letter whose number was taken before the switch keeps its old period and, as an open item, still receives its final file at Terbitkan [A-LT20].
4. Requesters still see their own old requests and issued files (access control L9).
5. Handover helper: queue filter "Belum selesai (semua periode)" (belongs in the new-period guide).

### States (all screens)
| State | Behavior |
|---|---|
| Loading | Skeleton rows; controls usable |
| No match | "Tidak ada hasil. Ubah pencarian atau filter." + Reset |
| Error or PI-CORE or `nexus` unreachable | "Terjadi gangguan. Coba lagi." with retry; never "no access" |
| Session ended | Redirect to login (auth-login F9) |
| Right removed while open | Next action fails with "Aksesmu sudah berubah..." |
| Conflict (status changed by someone else) | "Data sudah berubah. Muat ulang." |
| File upload fails | The step is not saved; "Berkas gagal diunggah. Coba lagi." Registering a letter uses no number; on Terbitkan the number taken earlier stays taken and the request stays Diproses |

---

## 4. Data and rules

### 4.1 Tables (plain words, schema `nexus`; the database engineer decides names)
All tables: RLS on, default deny, explicit policies (CLAUDE.md 11). Creator ids are `members.id` from the session. No foreign keys into PI-CORE (access control 7.2).

| Table | One row is | Key fields | Notes |
|---|---|---|---|
| Letters | one register entry | type (incoming or outgoing), **number text** plus its parts (type code, year, sequence), letter date, received date (incoming), counterpart, counterpart's own number (incoming), Perihal, notes, status (Aktif or Dibatalkan), void reason, source request id (outgoing, optional), period id, created by/at, updated by/at | The number text is stored, never recomputed, so a format change never renumbers old letters. Never deleted |
| Letter files | one stored file (of a letter or of a request) | parent, storage path, original name, size, type, uploaded by/at, withdrawn flag and reason | Private bucket. Never purged (access control L5) |
| Letter requests | one request | requester of record, Perihal, addressee, purpose text, on-behalf-of text, needed-by date, status, processor, processed at, processor note, linked letter id (set when the number is taken), period id, created at | Never edited after submit [A-LT10] |
| Request status history | one status change | request, from, to, who, when, note, period id | Append-only; basis of the timeline |
| Letter history | one edit, void or file action | letter, kind, before, after, reason, who, when | Append-only |
| Number counters | the last used sequence per type and calendar year | type, year, last value | Updated in the same transaction as the letter insert (direct registration or "Ambil nomor"), so two secretaries never get the same number and a failed save uses none |
| Numbering settings | the format | prefix, type codes (incoming, outgoing), digits, separator, year included | See 4.3 |
| Export log | one successful export | tab, who, when, format, filters, period id | Append-only, no PII, no search text, no rows |

### 4.2 Request state machine

| From | To | Who | Conditions |
|---|---|---|---|
| (new) | Diajukan | Any active member, own request | Active period; caps (L10); fields valid |
| Diajukan | Dibatalkan | The requester | Before processing (access control L9) |
| Diajukan | Diproses | `process` holder, not the requester | Optional note |
| Diproses | Diproses ("Ambil nomor") | same | Once per request. Not a status change: assigns the next SK number and creates the linked register row (Aktif, no file) in one transaction. Amendment of L2 (D-025, G1) |
| Diajukan, Diproses | Ditolak | same | Note required. If a number was taken, the linked register row is voided (Dibatalkan) with this note in the same transaction; the number stays used |
| Diproses | Diterbitkan | same | Only after the number was taken; at least one final file attached to the existing register row [A-LT23] |
| Diterbitkan, Ditolak, Dibatalkan | none | - | Terminal. A new request is the way forward |

Register letter status: **Aktif** to **Dibatalkan** (void) only. A letter linked to an open request (Diproses) cannot be voided through the register; the request is rejected instead [A-LT24]. Voiding the letter behind a Diterbitkan request does not change the request; the request detail shows "Nomor dibatalkan" and the requester files a new request, or a manager registers a replacement directly [A-LT11].

### 4.3 Numbering (D-024, provisional)
- Format today: incoming `PMK/NEX/SM/{year}/{seq}`, outgoing `PMK/NEX/SK/{year}/{seq}`, seq three digits (`001`). Example only: `PMK/NEX/SK/2026/001`.
- Prefix, type codes, digit count, separator and year inclusion are stored in the numbering settings, not in code. Changing them affects only letters numbered afterwards.
- **Working assumptions** (confirm with the PMK secretaries; A2, C6): the system assigns the number when a letter is registered directly or when a processor presses "Ambil nomor" on a request (so the number can be printed before signing), nobody types it; one sequence per type; the sequence restarts at 001 every calendar year (Asia/Jakarta, the year at the moment the number is assigned, regardless of the letter date and of the period); a number is never reused, also after a void.
- Past 999 the sequence simply grows to four digits.
- Who edits the numbering settings: the System Admin on the NEXUS settings screen, every change logged; BPH secretaries read the settings [A-LT12]. No new permission key.
- **Continuing numbers PMK already issued before NEXUS (L7 b, decided):** the System Admin sets the next sequence per type and year once at go-live (it can only go up, with a reason, for the current year only; design G6). Old letters may be registered with their original number typed by hand and marked "Nomor lama"; such a number does not move the counter, must be unique per type, and is the only case where a person types a number. [UNKNOWN] whether PMK's old numbers use this format (A2 stays provisional).

### 4.4 Files [A-LT13, L8]
Private bucket, short-lived signed links (300 seconds, as A-IB51), only the server issues them. A file is readable by (a) `letters.view` holders for register letters and by (b) the requester and `letter_requests.view_all` holders for request attachments and for the issued file of the request. Limits (L8 b, decided): PDF, JPG and PNG only, 5 MB each, at most 3 files per letter or request; images are resized in the browser. Uploaded files never attached to a saved letter or request are not kept as records; a cap of 10 unattached uploads per member per 24 hours limits abuse (the same pattern as A-IB43, F11).

**Free-tier note (warn the owner).** Supabase free storage is about 1 GB and is shared with meeting minutes and borrowing evidence. [ASSUMPTION] If PMK handles about 150 letters a year at about 1.5 files and 1 MB per file, letters alone use about 200 MB a year, so the storage lasts a few years at best. Phone photos of letters are 3 to 5 MB, so the plan is a 5 MB cap and browser-side resizing of images. Record the real usage at each period handover.

---

## 5. Business rules and edge cases

| # | Rule or case | Expected behavior |
|---|---|---|
| R1 | Who may request | Any active member (access control L9): BPH, secretaries, department secretaries, lecturers, the admin. Requester = signed-in member |
| R2 | Gap-free numbers | A number is consumed only when a letter row is saved (direct registration or "Ambil nomor"). A failed save, a failed upload or a rolled-back transaction uses none. The only gaps are voided numbers (including letters abandoned after "Ambil nomor"), which stay visible |
| R3 | Concurrency | Two secretaries registering or taking a number at the same moment get different numbers (counter updated under lock). Two acting on the same request, for example both pressing "Ambil nomor": the second fails with "Data sudah berubah" and exactly one number is used |
| R4 | Year rollover | On the first Jakarta day of a year the next number of each type is `001`. A letter registered on 3 January with a letter date of 30 December gets a 2027 number and keeps its 2026 letter date [A-LT1] |
| R5 | Format change mid-year | New letters use the new format with the continuing sequence; old numbers are untouched. A settings change that would repeat an existing number text is refused |
| R6 | Period change | See F9. Numbering is by calendar year, ownership by period; a period switch in the middle of a year does not reset the sequence |
| R7 | No active period | Creating requests, registering, taking a number and issuing are rejected with a banner (access control R11). Officers' rule-based rights match nothing (E4), so the register is not readable either; own requests stay readable (access control L9) |
| R8 | Requester deactivated | They lose access at once (access control L1). Their Diajukan request can be rejected with a note, or processed anyway (a taken number is voided if it is then rejected); a Diterbitkan request keeps its file; the secretary sees an info marker (design G12); the name stays on the record (AC-45) |
| R9 | Secretary deactivated or replaced | Records stay with their name. The successor holds the rights on the next request; nothing is touched (E10) |
| R10 | Several assignments | Rights are the union (R2 of access control). A person who is Sekretaris Umum 2 and Staff in Logistik still cannot process their own request (access control L6 matches on `members.id`) |
| R11 | Single secretary | That person cannot process their own request; the hint appears (A-n9); they register their own letter directly (section 2) |
| R12 | Nobody holds `process` or `manage` | Requests wait; the System Admin sees the "nobody can use it" warning (access control E15) and cannot process either (access control L2, R7). Requesters see "Menunggu" |
| R13 | Voided number of a request-issued letter | Diterbitkan request: request unchanged, flag "Nomor dibatalkan" shown (section 4.2). Open request (Diproses): the letter cannot be voided through the register; rejecting the request voids it [A-LT24] |
| R19 | Number taken, letter never finished | The processor rejects the request with a reason; the register row becomes Dibatalkan with that reason and stays in the register and the export; the number stays used and is never reissued. The requester cannot cancel after Diproses (only while Diajukan) |
| R20 | Number printed before signing | The requester and the processor see the taken number before the letter exists as a file, so the printed letter can carry it; the register row shows "Tanpa berkas" until Terbitkan |
| R14 | Privacy | The register shows letters, never member data. Requester names come only from `src/lib/picore/`. Counterparts and Perihal are free text and can be sensitive: they are visible only to `letters.view` holders and to the requester of that request (access control R9) |
| R15 | Old-period records | Read-only except open requests; readable by current view holders; own requests always readable (access control L7, L8, L9) |
| R16 | Time zone | "Today", future-date checks, numbering year, caps and exports use Asia/Jakarta (WIB, UTC+7); timestamps are stored in UTC and shown in WIB |
| R17 | Delete | No screen, function or call deletes a letter, file, request, history row or log row (access control L5). Void and withdraw replace delete |
| R18 | Many rows | Server pagination; the search never reads other members' requests |

---

## 6. Stitch conflicts (filler flagged, not adopted)

| Stitch content (screens 10, 11, Dashboard card) | Problem | Decision |
|---|---|---|
| Counterparts "Direktorat Jenderal Pajak", "Rektorat Institut Teknologi Sumatera", "Badan Kerjasama Mahasiswa Kristen Lampung" and the sample subjects | Sample values | Real data entered by secretaries |
| Status badges "Resmi / Terverifikasi", "Verifikasi (5)", "Disetujui (12)", "Menunggu (5)", "Sedang Diproses", "Status: Disetujui", "1 Dokumen Disposisi" | No source defines these letter statuses | Register status is only Aktif or Dibatalkan (L5); request statuses of section 4.2 |
| An SK letter listed under the "Surat Masuk" tab; the Dashboard shows an SM number under "Surat Keluar" | Inconsistent filler | Each tab lists only its own type |
| Floating pill "+ Buat Surat Baru" | Leads nowhere; pills are for status chips only (CLAUDE.md 8) and the owner's rule that Stitch pill exceptions need approval | UX designer proposes the register button and the request button; owner approves |
| "Unduh PDF" and "Lihat Surat" on every card, visible to all | Files follow the rights of section 4.4 and may be images | Buttons only for allowed users; one "Lihat" opening a signed link |
| Counts "8", "14", "22 Dokumen", "Halaman 1 dari 4" | Sample numbers | Real counts and server pagination |
| Dashboard card "Dokumen Resmi Terakhir" with the latest letter, counterpart and subject, buttons "Surat Masuk (4)" and "Surat Keluar (12)" | Shows letter subjects on the Dashboard to everyone | Card only for `letters.view` holders (access control A-n1), counts only, see L11 |
| Chip "ARSIP ELEKTRONIK", sub "Arsip & Manajemen Dokumen Resmi PMK ITERA" | Fine as a title area | Keep if the designer likes it; copy is not a decision |
| No request flow, no forms, no detail, no empty or error states | Missing | Section 7 |
| Search "Cari nomor surat atau perihal..." | Matches the spec | Keep; also counterpart |

---

## 7. Screens: what exists in Stitch and what the UX designer must design

Stitch 10 and 11 give one list page (tabs, search, status chips, cards). None of the following exists:

1. **Module landing, role-aware:** register tabs for `letters.view` holders; "Permohonan Saya" and "Ajukan Surat" for everyone; "Antrean Permohonan" for `process` holders.
2. **Register list** per tab (search, filters, pagination, empty, loading, error) with the "Ekspor" menu.
3. **Letter detail** with files, history and the void action.
4. **Register form** for incoming letters and for outgoing letters (fields of F2, F3), with file picker and the number shown after saving, never typed.
5. **Void dialog** (required reason) and **file withdraw dialog**.
6. **Request form** (F5), including attachments.
7. **Permohonan Saya** list and **request detail** (timeline, note, number and file after issue, cancel, "Ajukan lagi").
8. **Antrean Permohonan** list and **request review** (Proses, Tolak with note, Terbitkan with final file and editable Perihal, addressee, date; own-request and single-secretary states).
9. **Numbering settings** screen for the System Admin (read-only for BPH secretaries), on the NEXUS settings area.
10. **Dashboard card** "Surat Menyurat" (L11).
11. Shared: no-permission page, "no active period" banner, system messages.

The request flow (screens 6 to 8) was the missing design of A6. It is now designed in `docs/design/letters.md` and approved (section 10b), except for the number-on-the-file part, which "Ambil nomor" changes and which needs a design revision.

---

## 8. Export, log and Dashboard

| Export | Key | Who (default) | Content |
|---|---|---|---|
| Register, active tab (incoming or outgoing) | `letters.export` | BPH (D07) | Number, type, letter date, received date (incoming), counterpart, counterpart's own number, Perihal, notes, status (incl. Dibatalkan and void reason), request reference if any, period, registered by (name), file count |

- Formats and writers follow D-019/D-020 and `src/lib/export/`. Header shows the period filter and export date in WIB [A-LT16]. Members cannot export their own requests [A-LT17].
- **Export log:** one append-only row per successful export, no PII, no exported rows; no export without a log row. The screen to read the log comes later with the Member Data log screen (A-MD14); no new key is created now.
- **Dashboard card (L11).** Counts only, no letter titles. The count definitions are in L11 option (a).

---

## 9. Assumptions

All [ASSUMPTION] until the owner confirms, except the rows marked **DECIDED**, which the owner's answers L1-L11 of 2026-11-09 settled (D-025). Copied to `docs/OPEN_QUESTIONS.md` section I.

| Id | Assumption |
|---|---|
| A-LT1 | Numbering year = the Jakarta calendar year when the number is assigned (not the letter date, not the period). One sequence per type. Inherited from D-024's working assumptions (A2, C6); stays provisional |
| A-LT2 | **DECIDED (L3 b).** A request carries the optional text "Atas nama" instead of a unit list, because committees and teams are not PI-CORE entities (B7) |
| A-LT3 | The register is the archive. There is no separate "archive" action or screen; "archive" in the key text means files are kept (access control keys `letters.manage`) |
| A-LT4 | Issuing from a request needs only `letter_requests.process`; the function creates the register row. Direct registration needs `letters.manage` |
| A-LT5 | **SUPERSEDED 2026-11-09 (L2 amendment, D-025 G1).** Was: a secretary may issue directly from Diajukan. Now the path is always Diajukan, Diproses, "Ambil nomor", Terbitkan |
| A-LT6 | "Processed" in access control L9 means "leaves Diajukan": the requester cancels only while Diajukan |
| A-LT7 | A request needs an active period; a requester who is a lecturer may request (B15 stays open) |
| A-LT8 | A voided letter cannot be restored; the correction is a new letter with a new number |
| A-LT9 | A wrong file is withdrawn (kept and hidden from non-managers), never deleted |
| A-LT10 | A submitted request cannot be edited; cancel and resubmit (same as A-IB7) |
| A-LT11 | Voiding the letter behind an issued request leaves the request Diterbitkan with a visible "Nomor dibatalkan" flag |
| A-LT12 | The numbering settings are edited by the System Admin, logged, and readable by BPH secretaries |
| A-LT13 | **At most 3 files per letter or request, types and size: DECIDED (L8 b: PDF, JPG, PNG, 5 MB each).** Still an assumption: signed links last 300 seconds; at most 10 unattached uploads per member per 24 hours |
| A-LT14 | Department and bureau secretaries read nothing of the register (B17 default); the admin can add a rule, logged. No confidential flag exists in Phase 1 |
| A-LT15 | Page size 20; search on number, counterpart and Perihal; the period filter defaults to the active period |
| A-LT16 | Export header shows the period filter and export date in WIB, like Member Data |
| A-LT17 | Members cannot export their own requests; the request list is not exportable in Phase 1 |
| A-LT18 | Field limits: Perihal 200 characters, counterpart 150, purpose text 1000, notes and processor notes 500, on-behalf-of 120, own letter number 60 |
| A-LT19 | A received date cannot be in the future; the letter date of an outgoing letter may be today or earlier [no future dating] |
| A-LT20 | **Amended 2026-11-09 (G1).** A number taken after a period change creates its letter in the ACTIVE period, linked to the old request; a letter whose number was taken before keeps its old period and, as an open item, still receives its final file at Terbitkan |
| A-LT21 | The queue has a filter "Belum selesai (semua periode)" for the handover |
| A-LT22 | Progja can later link to a letter by id without a rewrite |
| A-LT23 | **New 2026-11-09 (G1).** Terbitkan needs a taken number (no issue without "Ambil nomor"), because a file without the printed NEXUS number is the problem the amendment fixes. "Proses" is therefore no longer optional |
| A-LT24 | **New 2026-11-09 (G1).** While the linked request is Diproses, the register letter cannot be voided or get files through the register; the processor uses Terbitkan or rejects the request. This keeps one way to end the request and no half-closed state |

---

## 10. Questions for the owner

**All eleven questions were answered on 2026-11-09: the owner accepted every recommendation as written (D-025).** The options and recommendations stay below as the record; the chosen option is tagged under each question.

**L1. Does NEXUS write the letter documents, or only register and archive finished files?** **[ANSWERED 2026-11-09: (a)]** Register and archive only; signing stays outside NEXUS; A4 (sample formats) is not needed in Phase 1. (This decides whether A4, sample official formats, is needed.)
- (a) Register and archive only. Secretaries write the letter in Word or Google Docs, get it signed, then upload the final file.
- (b) NEXUS fills a template per letter type and produces the PDF (needs A4: sample formats, letterhead, signatory rules).
- (c) (a) now, (b) as a later phase.
- **Recommendation: (a).** It matches the Phase 1 scope in the context document and needs no official formats. Signing stays outside NEXUS. Choose (c) if you expect templates soon; the data model does not block it.

**L2. What is the status path of a letter request, and when does the number appear?** **[ANSWERED 2026-11-09: (b)]** Diajukan, Diproses, then Diterbitkan, Ditolak or Dibatalkan; the number is assigned only at Diterbitkan, together with the file.
- (a) Diajukan, then Diterbitkan or Ditolak (or Dibatalkan). One step: the secretary finishes the letter offline and then records the result.
- (b) Diajukan, Diproses (secretary accepted, requester can no longer cancel), then Diterbitkan, Ditolak or Dibatalkan. The number is assigned only at Diterbitkan, together with the file.
- (c) (b) plus Disetujui, with the number reserved at approval and the file added later.
- **Recommendation: (b).** The requester sees someone is working on it, and no number is used by a letter that is never finished. (c) creates numbers without files.
- **Amendment 2026-11-09 (owner, design gap G1 "Ambil nomor").** The number must be printed on the letter before it is signed, so assigning it only at Diterbitkan together with the final file (as chosen) could never put the NEXUS number on the file. New rule: while a request is Diproses a processor presses "Ambil nomor"; the system assigns the next SK number at once and creates the linked register row (Aktif, no file); the requester sees the number. Later the processor uploads the final signed file and the status becomes Diterbitkan (file required). An abandoned letter is ended by rejecting the request with a reason: the register row is voided with that reason and the number stays used. The owner chose this over (1) a "Nomor berikutnya" preview with a mismatch warning (design P6 b) and (2) the number at Diterbitkan with no preview. This changes the L2 sentence "the number is assigned only at Diterbitkan". Requester cancel stays "only while Diajukan"; direct registration (L4) is unchanged.

**L3. What does a letter request contain?** **[ANSWERED 2026-11-09: (b)]** Perihal, Ditujukan kepada, Keperluan, plus optional "Atas nama", "Dibutuhkan paling lambat" and up to 3 attachments.
- (a) Perihal, Ditujukan kepada, Keperluan (free text).
- (b) (a) plus "Atas nama" (optional), "Dibutuhkan paling lambat" (optional date) and optional attachments (up to 3 files).
- (c) A separate form per letter type (needs PMK's list of letter types and A4).
- **Recommendation: (b).** Enough for the secretary to write the letter without chasing the requester, and no invented letter types.

**L4. Is an outgoing letter always created from a request, or may a secretary register one directly?** **[ANSWERED 2026-11-09: (a)]** Both: direct registration and request issue create the same kind of outgoing register row.
- (a) Both. A secretary registers a letter directly; a request issue creates the same kind of outgoing register row.
- (b) Only through requests (a secretary who needs a letter files a request, and another secretary processes it).
- (c) Only directly; requests are only notes.
- **Recommendation: (a).** Most official letters (to the campus, partners, churches) are written by the secretaries themselves; forcing a request would make the single-secretary case impossible (the rule that nobody processes their own request stays in force).

**L5. Do register entries have a workflow status (for example for incoming letters: new, followed up, done, or a disposition)?** **[ANSWERED 2026-11-09: (a)]** No; a register entry is a record with status Aktif or Dibatalkan. The Stitch statuses are not adopted.
- (a) No. A register entry is a record with status Aktif or Dibatalkan.
- (b) Incoming letters get a follow-up status (needs PMK's definitions and who may change it).
- (c) Adopt the Stitch statuses (Verifikasi, Disetujui, Menunggu): not recommended, nobody defined them.
- **Recommendation: (a).** Nothing in the context document asks for a workflow; (b) can be added later when PMK says what the statuses mean.

**L6. How are mistakes in a registered letter corrected?** **[ANSWERED 2026-11-09: (a)]** Details are editable by a manager in the active period with a history row; the number is never editable; a wrong letter is voided with a reason and its number is never reused.
- (a) Details (date, counterpart, Perihal, notes) can be edited by a manager in the active period with a history row; the number is never editable; a wrong letter is voided with a reason, stays visible as "Dibatalkan", and its number is never reused.
- (b) Nothing is editable. Void and register again.
- (c) The number can also be edited by a manager, with a log.
- **Recommendation: (a).** Typing mistakes are common; changing a number that may already be on a printed letter is not allowed, which keeps the sequence trustworthy.

**L7. How does numbering continue from letters PMK already issued before NEXUS?** (If paper letters already used `PMK/.../2026/045`, a fresh counter would repeat numbers.) **[ANSWERED 2026-11-09: (b)]** The System Admin sets the next sequence per type and year once at go-live, and old letters may be registered with their original number typed by hand, marked "Nomor lama" (does not move the counter; refused if the text already exists).
- (a) The System Admin sets the next sequence per type and year once at go-live (for example SK continues from 046). Old letters are not entered.
- (b) (a), and old letters may also be registered with their original number typed by hand and marked "Nomor lama" (does not move the counter; refused if the text already exists).
- (c) Start fresh at 001 at go-live; old letters stay on paper.
- **Recommendation: (b).** The archive becomes complete and numbers never clash. It needs one narrow exception to "nobody types a number", limited to letters marked "Nomor lama". [UNKNOWN] whether PMK's old numbers even use this format (A2 stays provisional).

**L8. Which files are accepted, and how big?** **[ANSWERED 2026-11-09: (b)]** PDF, JPG and PNG, 5 MB each, up to 3 files per letter or request; images are resized in the browser. (Storage is about 1 GB for everything, see 4.4.)
- (a) PDF only, 5 MB, up to 3 files per letter.
- (b) PDF, JPG and PNG, 5 MB each, up to 3 files per letter; images are resized in the browser.
- (c) PDF, DOCX, JPG and PNG, 10 MB (like the minutes assumption C9).
- **Recommendation: (b).** Secretaries often have a phone photo of an incoming letter, and PDF keeps the archive readable. Editable DOCX files are not needed because the archive keeps the final signed letter.

**L9. May the requester download the issued letter file from their own request?** **[ANSWERED 2026-11-09: (a)]** Yes, number and file, for their own request only. Answers B23. (Answers B23; today a default.)
- (a) Yes, number and file.
- (b) Number and status only; the secretary hands the letter over outside NEXUS.
- **Recommendation: (a).** It is the point of the request flow, and it follows the own-record right (access control L9). The requester can read only their own request's file, never the register.

**L10. Should there be limits on how many requests one member can file?** **[ANSWERED 2026-11-09: (b)]** At most 5 open requests (Diajukan or Diproses) and at most 10 new requests per Jakarta day. (Like A-IB47 for borrowing.)
- (a) At most 5 open requests (Diajukan or Diproses) and at most 20 new requests per Jakarta day, as in borrowing.
- (b) At most 5 open and at most 10 new per Jakarta day.
- (c) No limit.
- **Recommendation: (b).** Letter requests are rarer than borrowing and each one costs a secretary real work; 10 a day is already generous. The caps are checked by the database too.

**L11. What does the Dashboard "Surat Menyurat" card (C10) show, if there is one?** **[ANSWERED 2026-11-09: (a)]** A card for `letters.view` holders with counts of incoming and outgoing letters in the active period, and for `process` holders also the waiting requests; no letter titles. Answers C10.
- (a) A card for `letters.view` holders: counts "{n} surat masuk, {m} surat keluar" in the active period, and for `process` holders also "{k} permohonan menunggu". No letter titles.
- (b) (a) plus the Stitch tile with the latest letter (number, counterpart, Perihal).
- (c) No card in Phase 1.
- **Recommendation: (a).** Counts are useful and safe; the latest-letter tile would show subjects on the Dashboard. Regular members have no card because they have no view right (access control A-n1); they use "Permohonan Saya".

---

## 10b. Design approved 2026-11-09 (`docs/design/letters.md`)

The owner accepted all proposals P1-P15 and the gap recommendations G2-G17 of the design, with one exception: P6 (number on the final file) and design section 12.5 are replaced by the "Ambil nomor" amendment of L2 (the UX designer revises the Proses, review and Terbitkan screens: an "Ambil nomor" action, the number shown to the requester before the file exists, Terbitkan without a number preview). Where the design differs from the wording of this spec, the design wins on these points, and the spec above already follows them:

| Point | Decision |
|---|---|
| P1 | Four segments in the module: Surat Masuk, Surat Keluar, Permohonan Saya, Antrean; a member sees only the ones she may use |
| P2 | No bracket count on the register tabs (counts are in the header tiles); only Antrean keeps "(n)" for requests needing action. Deviation from the earlier wording of F1 |
| P3 | A register row shows a chip only for "Dibatalkan" and "Nomor lama"; Aktif has no chip. Deviation from the earlier wording of F1 |
| P4, P5 | Wide register as a table from 1024 px; the helpers "Salin nomor" and "Catat surat lain" are kept |
| P7-P10 | Check sheet before issuing; button order on the review page; "Nomor lama" as a checkbox card with a check sheet showing the typed number; first-use hint when no numbering start was set |
| P11 | Numbering settings as two cards (next number, format) plus a change history; the next number can only go up, with a reason |
| P12 | Dashboard card with counts only |
| P13-P15 | Chip colours (Diproses amber, Dibatalkan grey); "Ajukan lagi" on Ditolak and Dibatalkan (attachments not copied); "Lewat tanggal" chip for secretaries |
| G2 | Requests have no reference code |
| G3 | The received date of an incoming letter is editable, with history |
| G4 | Withdrawn files do not count toward the limit of 3; the last visible file of a letter that came from a request cannot be withdrawn until a replacement is added |
| G5 | After a void, the requester cannot download the file and does not see the void reason; they see "Nomor dibatalkan" and a way to ask again |
| G6 | The next sequence can only go up, with a reason, for the current year only; a "never set" flag feeds the first-use hint |
| G7 | "Nomor lama" uses the active period; the typed number is checked in a sheet before saving; a wrong one is voided and registered again |
| G8 | Register sort: newest registered first; period filter only "Periode aktif" and "Semua periode" |
| G9 | Header tiles and Dashboard card count Aktif letters only; "menunggu" counts Diajukan requests of all periods |
| G10 | The numbering settings screen is designed alone with a "Kembali" link; the settings area shell needs its own design |
| G11 | The requester sees the names of the secretary who processed or issued (PI-CORE names only) |
| G12 | Info marker for the secretary when the requester is no longer active |
| G13-G17 | A secretary lands on the first segment she has (Surat Masuk); images resized to about 2000 px long side; attachments not copied on "Ajukan lagi"; "Dibutuhkan paling lambat" is only a hint; icons named by meaning |

---

## 10c. Build status and security review (2026-11-10)

- **Built (local stack only):** database (migrations `20261110100000` and `20261110100100`), server layer and screens. Commits: 93295a1 (derived flags return false, never null), dacf327 (server layer and screens), 5f5874a (file-name fix). QA record: `docs/qa/letters.md` (in progress). Nothing is applied to the hosted project.
- **Security review (read-only reviewer): no CRITICAL, no HIGH finding.**
  - **MEDIUM, open (owner undecided):** files uploaded to `nexus-letter-files` but never attached to a letter or request are never deleted. Any active member may upload 10 files of 5 MB per rolling 24 hours (about 50 MB a day per member), which could fill the 1 GB free tier. Tracked as `OPEN_QUESTIONS.md` F11, now for all modules with uploads, [PLANNED] before go-live, P1. Options: (a) scheduled server-side cleanup of objects older than 48 h with no row in the file table (recommended; never touches attached files), (b) lower caps such as 5 per 24 h, (c) a monthly manual cleanup query in the ops guide.
  - **LOW, fixed (5f5874a):** file names also drop bidi-override and zero-width characters (U+200B-200F, U+202A-202E, U+2066-2069).
  - **LOW, accepted for now (A-LT28):** exports have no per-member rate limit (same as Inventory); the PDF check is magic bytes "%PDF-" only, files are served from the storage origin with 300-second signed links (no script on the app origin); the login `next` parameter is already guarded by `safeRedirectPath` in `src/lib/auth/redirect.ts` (verified).
- Recorded in `docs/DECISIONS.md` (D-025 build status and review).

## 11. Acceptance criteria

Personas: `docs/modules/access-control.md` section 9. Defaults D06-D08 and D15-D23 apply unless stated. Every criterion is tested through the UI AND by a direct call with that persona's token. They assume the recommended answers of section 10; the owner's real answers adjust them.

**Permissions**
- LT-01 P-SEKJEN can register incoming and outgoing letters directly, edit them in the active period, add files, void a number, and process a request submitted by another member.
- LT-02 P-KETUM and P-BEND can read the register, see all requests and export, and cannot register, edit, void or process; direct calls with their tokens are rejected.
- LT-03 P-SEKDEP, P-PLAIN, P-STAFF-PUB, P-LECT and P-ADMIN (no assignment) cannot read the register, the queue or another member's request, and cannot export; the drawer item opens only the request area for them.
- LT-04 P-INACTIVE, P-UNLINKED and a request without a session get nothing from any function of this module (access control L1). P-OLD (Sekjen of the previous period only) cannot read the register after the switch (AC-40) but still reads their own requests.
- LT-05 If rules D15-D23 are disabled, the holders lose the matching power on their next request, with no logout (AC-25 pattern).
- LT-06 Granting `letters.manage` or `letter_requests.process` to "every active member", or without a written reason, is rejected by the database (access control L12).

**Requests**
- LT-07 Any active member can submit a request; the saved requester is the session member, never a client-supplied id; period = active period.
- LT-08 A request is rejected with a clear message when: no active period, a required field is empty or over its limit, an attachment is of a wrong type or too big, or a cap of L10 is reached.
- LT-09 A member reads only their own requests (status, note, number, file); another member's request is not returned by the API (AC-27).
- LT-10 The requester can cancel only while Diajukan; after Diproses cancel is refused; another member cannot cancel it (AC-30).
- LT-11 P-SEKJEN cannot accept, take a number for ("Ambil nomor"), reject or issue their own request, even if a custom rule grants `letter_requests.process` (AC-12, AC-57); another BPH secretary can. P-SEKJEN can still register a letter directly.
- LT-12 Rejection without a note is refused; every transition writes one history row with who, when and note.
- LT-13 (amended, D-025 G1) "Ambil nomor" works only on a Diproses request and only once: in one transaction it assigns the next SK number and creates the linked outgoing register row (Aktif, no file, period = active period); the request stays Diproses. Issuing (Terbitkan) works only on a Diproses request whose number was taken and needs at least one final file attached to that existing row; it sets Diterbitkan. A failure (upload, validation) leaves the request Diproses with its number still taken and uses no further number. Terbitkan on a request without a taken number is refused, also by direct call.
- LT-14 As soon as the number is taken the requester sees it (no file yet); after Terbitkan they can download the file through a short-lived signed link; they still cannot open the register or other letters (owner question L9).
- LT-15 Two secretaries pressing "Ambil nomor" or "Terbitkan" on the same request at once: exactly one succeeds, the other gets "Data sudah berubah", and exactly one number is used.
- LT-15a Rejecting a Diproses request whose number was taken sets Ditolak and, in the same transaction, voids the linked register row (Dibatalkan) with the rejection note as reason; the number stays used and is never reissued; the row stays in the register and the export. The requester sees the rejection note, not the register row, its file or its void reason.
- LT-15b While the linked request is Diproses, the register letter cannot be voided and gets no file through the register screens or a direct call; the requester cannot cancel after Diproses.
- LT-16 With only one `process` holder, the queue shows the hint (A-n9); with none, the System Admin sees the "nobody can use it" warning (AC-64).

**Register and numbering**
- LT-17 A new incoming letter gets `PMK/NEX/SM/{year}/{seq}` and a new outgoing letter `PMK/NEX/SK/{year}/{seq}`, seq three digits, from the settings, not from code; no screen or call lets anyone type or edit a number (except letters marked "Nomor lama" if L7 (b) is chosen).
- LT-18 The sequence is per type and per Jakarta calendar year; the first letter of a new year is `001`; a letter saved at 23:30 UTC on 31 December belongs to the next Jakarta year; a period switch does not reset it.
- LT-19 Two letters created at the same moment (direct registration or "Ambil nomor") get different numbers; a failed save consumes none; the only gaps are voided numbers, including those of letters abandoned after "Ambil nomor".
- LT-20 Changing the numbering settings changes only letters numbered afterwards; existing numbers are unchanged; a change that would produce an existing number text is refused.
- LT-21 Register and edit validate on the server: required fields (incoming: received date, sender, Perihal; outgoing: letter date, addressee, Perihal), limits of A-LT18, a received date not in the future, a letter date not in the future.
- LT-22 Editing details of an Aktif letter of the active period writes a history row with before and after; the number, type and year are not editable; a letter of a non-active period or a voided letter is read-only (access control L7).
- LT-23 Voiding requires a reason; the letter stays in the register as "Dibatalkan", keeps its number and files, and its number is never reissued; the export shows it with its status.
- LT-24 If the voided letter came from a request, the request stays Diterbitkan and shows "Nomor dibatalkan".
- LT-25 Search finds a letter by part of the number, counterpart or Perihal, case-insensitively, and never reads other fields.

**Files**
- LT-26 Only types and sizes allowed by L8 are accepted (checked by the real file type, not the name); a fourth file, an oversized file or another type is refused, also by direct upload.
- LT-27 The bucket is private; a file link is a signed link that expires within minutes and is returned only to a user who may read the parent (LT-03, LT-14); another member's link request returns nothing.
- LT-28 No function deletes or replaces a file; a withdrawn file keeps its record and stored file and is visible only to managers.
- LT-29 More than 10 unattached uploads by one member in 24 hours are refused; unattached files are never shown as letter files.

**Period, deactivation, edge cases**
- LT-30 After a period switch, a Diajukan or Diproses request stays actionable by current `process` holders (Proses, Ambil nomor, Terbitkan, Tolak). A number taken after the switch creates its letter in the active period, linked to the old request; a letter whose number was taken before the switch keeps its old period and still receives its final file at Terbitkan. A closed old-period request or letter is read-only (access control L7, E8).
- LT-31 With no active period, requests, registrations and "Ambil nomor" are refused with a banner, and own requests stay readable (access control R11, L9).
- LT-32 When a requester is deactivated, their requests and issued files remain, their name still shows, and they cannot sign in (AC-44, AC-45).
- LT-33 A person with two assignments gets the union of rights and is still blocked from processing their own request (R10).

**Never delete, history and privacy**
- LT-34 No screen, function or call deletes a letter, file, request, history row or export-log row, with any persona's token including P-ADMIN; history tables accept inserts only through server functions.
- LT-35 No response, screen or export contains email, phone, NIM or NIP; requester and creator names come from PI-CORE only through `src/lib/picore/`.
- LT-36 The register and requests are not readable by anyone outside the keys of section 2, and a signed link is never placed in an export.

**Export, log, Dashboard**
- LT-37 P-KETUM and P-SEKJEN see "Ekspor"; P-SEKDEP and P-PLAIN do not, and a direct export call with their token is refused.
- LT-38 Excel, CSV and PDF each contain all rows matching the current tab, search and filters, in screen order, with the same count as the screen, dates in WIB, and voided letters marked.
- LT-39 Each successful export writes exactly one log row (tab, exporter's `members.id`, time, format, filters, period); a refused export, or one whose log write fails, writes none and returns no file; the row holds no PII and cannot be updated or deleted.
- LT-40 The Dashboard card (if L11 chooses one) is shown only to `letters.view` holders, shows counts and no letter titles, and shows a neutral empty state.

**Settings, quality**
- LT-41 Only the System Admin can change the numbering settings; the change is logged with before and after; BPH secretaries can read it; P-PLAIN cannot.
- LT-42 At 390 px width every screen works without horizontal page scroll; fields are at least 44 px high with 16 px text (D-017).
- LT-43 A pgTAP test per persona proves RLS: zero rows for denied users on letters, files, requests, history, counters and export log; every `nexus` table of this module has RLS enabled.
- LT-44 Over-long input is refused by the database even when the page is bypassed (limits of A-LT18, caps of L10).
- LT-45 The request caps (L10) hold by UI and by direct call; the daily cap counts Jakarta days.
- LT-46 The drawer item "Surat Menyurat" shows for every active member and no register tab shows without `letters.view`.
- LT-47 The numbering year, "today" checks and caps use Asia/Jakarta (a test at 23:30 UTC uses the Jakarta date).
- LT-48 The module is self-contained and every letter and request carries `period_id`; nothing in it prevents a later link from progja by id.
- LT-49 (design P2, P3) The register tabs "Surat Masuk" and "Surat Keluar" show no bracket count; only "Antrean" shows "(n)" for requests needing action. A register row shows a chip only for "Dibatalkan" and "Nomor lama"; an Aktif letter has no chip.
- LT-50 (design G4) Withdrawn files do not count toward the limit of 3; the last visible file of a letter that came from a request cannot be withdrawn until a replacement is added.
- LT-51 (design G6) The next sequence set by the System Admin can only go up, needs a reason and applies to the current year; there is a flag "never set" for the first-use hint.
- LT-52 (design G9) The header tiles and the Dashboard card count Aktif letters only; "permohonan menunggu" counts Diajukan requests of all periods.

---

## 12. Notes for other documents (contradictions and gaps found) and how they were resolved (D-025)

1. **D-021 versus this module. RESOLVED (tech lead decision, D-025).** The "Surat Menyurat" drawer item is shown to every active member, because everyone may file requests (access control L9); register tabs stay behind `letters.view`. This is an explicit exception to D-021. No new key, no baseline `letters.view`.
2. **Access control L9 versus the key texts. RESOLVED (A-LT6, A-LT3).** "Processed" means "leaves Diajukan" (Diproses exists, L2 b); the number is assigned at Diterbitkan. The key text "archive" in `letters.manage` means files are kept in the register; there is no separate archive action.
3. **Two ways to a number. RESOLVED (A-LT4).** `letters.manage` registers directly; `letter_requests.process` issues from a request and the function creates the register row.
4. **Access control L6 and direct registration.** The self-processing block cannot stop a secretary who registers their own letter directly. Intended, since a register entry is not a request; named so no one is surprised.
5. **Numbering year versus period.** Periods follow the management term (for example 2026/2027), numbers follow the calendar year (D-024). Both are kept; the combination is described in R4 and R6.
6. **`docs/PMK-NEXUS-context.md` 5.5 and section 8** called the numbering format an assumption and listed A2 and A4 as open. Updated 2026-11-09 after the approval (D-024, D-025).
7. **Stitch** lists an SM number under "Surat Keluar" on the Dashboard card and an SK letter under the "Surat Masuk" tab (`comparison.md`); both are filler.
8. **Free tier.** Letters, minutes (C9) and borrowing evidence (F11) share about 1 GB of storage. Check real usage before go-live.
