# Inventory and Borrowing / Manajemen & Inventaris Barang (module spec)

> Status: **Approved; DB layer built 2026-11-07 (not on hosted).** The owner answered all questions IB1-IB15 on 2026-11-07 (section 12); recorded as D-022 in `docs/DECISIONS.md`, with a follow-up of the same date (caps, date cap, single correction, restore permission, field limits; section 11c). The database layer is committed as 7a8399a: `20261107100000_nexus_borrowing_access_rules.sql` (key `borrowing.handle`, rules D34-D36, D30 retired), `20261107100100_nexus_inventory_borrowing.sql` (16 tables, 44 functions) and `20261107100200_nexus_inventory_storage.sql` (private bucket `nexus-borrowing-evidence`, 1.5 MiB, JPG/PNG/WebP, 2 policies). None of the three is applied to the hosted project yet (pre-apply checks: `supabase/README.md` step 10). Security review of the DB layer: no CRITICAL or HIGH findings; L7 (no export rate limit) is accepted, as F5. **Update 2026-11-09:** server layer and all screens built and tested on the local stack (`docs/qa/inventory-borrowing.md`); two later migrations, `20261108100000_nexus_inventory_borrowing_fixes.sql` (contract follow-up) and `20261109100000_nexus_export_totals_and_evidence_window.sql` (export `total_count`, 24-hour upload cap), also not on hosted. Application-layer security review: `docs/DECISIONS.md` D-022 and `docs/OPEN_QUESTIONS.md` F8-F11.
> Sources: `CLAUDE.md` (4-8, 11, 14), `docs/PMK-NEXUS-context.md` (4, 5.1, 5.6, 6, 8), `docs/DECISIONS.md` (D-007, D-010, D-011, D-013, D-014, D-019, D-020, D-021, D-022), `docs/modules/access-control.md` (keys, D01, D09-D11, D28, D29, D31, D34-D36, L1, L4-L12, R3, R11, A-n5, B29), `docs/modules/member-data.md` (format and export pattern), `docs/design/stitch/screens.md` (12, 13, 14) and `html/12-*.html`, `html/13-*.html`, `docs/OPEN_QUESTIONS.md` (A6, A7, B4, C7, C9, section H), `docs/picore/schema-report.md` (org units and positions).
> Tags: **[ASSUMPTION]** = my guess, still needs the owner (A-IB2 to A-IB49, section 10, `docs/OPEN_QUESTIONS.md` section H). **[UNKNOWN]** = no source; never guessed. **IB1-IB15** (no dash) = the owner's answered questions, section 12. **IB-01 to IB-57** (dash, two digits) = acceptance criteria, section 11. Do not confuse the access-control rule number "L7" (old periods) with the security-review finding "L7" (export rate limit); the second is always written "review L7". Rule numbers "R1..." are local; access-control rules are written "access control R3" or by AC/L/D number.
> No code, no SQL, no visual design. PMK facts (item names, categories, locations) are NOT invented here. Everything Stitch shows (Drum Elektrik, Sekretariat PMK, Koordinator Logistik, Inv-001/LOG, 80%) is filler.

---

## 1. Purpose and scope

**Purpose.** Let the Operations team keep one trustworthy list of everything PMK ITERA owns (what exists, how many, what condition, where), and let every active member ask to borrow items, with a clear path: request, approval by a head, handover, return, plus history, overdue tracking and exports.

**Analogy.** A library desk. The catalog says what exists. A borrowing slip (request) is filled by the member and stamped by a head (never for their own slip). Any desk worker hands the item over and checks it back in, noting damage with a photo.

**In scope**
- One catalog for everything PMK owns, managed by Operations (IB3). Each item is either **individually tracked** (every physical unit has its own code and condition) or **quantity-based** (a count per condition), chosen when the item is created (IB1). Categories and locations are lists Ops maintains (IB10). Every unit, or every quantity-based item, gets an automatic code `INV-0001` (IB11).
- Borrowing: request by any active member, approval or rejection by a head with a note, extension by a head, handover, return (good, damaged, lost), cancel, overdue display, status history.
- Requests recorded by an Operations member for an outside party (IB15).
- "Peminjaman Saya" (own requests), the heads' queue and the Operations work list.
- Availability over a date range and quantity checks.
- Evidence photos for damaged or lost returns only (IB8, IB9).
- Exports (Excel, CSV, PDF) of the catalog and of borrowing, with an export log (IB13).
- The counts for the Dashboard "Inventaris Status" card (IB12); the card itself belongs to the Dashboard module.

**Out of scope (Phase 1)**
- Money: deposits, fines, damage payments (IB8: no deposit tracking).
- Notifications by email, WhatsApp or push (IB14).
- Catalog photos (IB9), barcode or QR scanning, stock-taking campaigns, purchase orders, depreciation, maintenance schedules.
- A lead time or a maximum loan duration (IB4, IB5).
- Contact details of borrowers or outside parties in NEXUS (IB14, L4).
- A screen to read the export log (comes later with the Member Data log screen, IB13, A-MD14).
- Program of work (progja): not Phase 1. This module is self-contained (`src/modules/inventory-borrowing`); progja can later link an event to a request by id without a rewrite [A-IB16].

NEXUS stores the inventory itself (it is NEXUS data, schema `nexus`). Member identity is NOT copied: requests store `members.id` and names are looked up from PI-CORE at read time through `src/lib/picore/` (D-010). The only people-related text NEXUS stores is the outside party's organisation name and contact person name typed by Ops (A-IB28).

---

## 2. Who uses it and who may do what

Rights come from permission keys (access-control amendment 2026-11-07), never from a person. "Operations" = any active-period assignment in `Departemen Operasional` or its divisions `Logistik` / `Akomodasi` (rules D28, D29, D31, D36, include child units). "Heads" = the positions `Kepala Departemen` (in Operasional) and `Kepala Divisi` (in Logistik or Akomodasi) (rules D34, D35).

| Key | Unlocks | Default holders |
|---|---|---|
| `inventory.view` | Open the module; read the catalog (items, units, stock, condition, location, codes, availability by date); the Dashboard "Inventaris Status" card | **Every active member** (D01, baseline) |
| `inventory.manage` | Add, edit, archive and reactivate items and units; change stock and condition; write off; **restore a written-off unit** (needs an active item, section 11c); maintain the category and location lists [A-IB2]. Includes view | Every Operations holder (D28). Power key: written reason (L12) |
| `inventory.export` | Export the catalog | BPH (D09), Operations (D29) |
| `borrowing.view_all` | See every request (own are always visible, L9) | BPH (D10); included in `approve` and `handle` |
| `borrowing.approve` | **Approve, reject, extend.** Includes view_all. Never on own requests (L6). Power key | Heads only (D34, D35) |
| `borrowing.handle` | **New key.** Record handover; record return (good, damaged, lost); cancel an approved request not yet picked up (reason); correct a wrong **return** (reason, once per request, section 11c; a handover cannot be corrected); record a request for an outside party. Includes view_all. NOT limited by L6. Power key (L12) | Every Operations holder (D36) |
| `borrowing.export` | Export borrowing requests | BPH (D11), Operations (D31) |
| fixed (L9, no key) | Submit a request; see own requests (status, decision note, timeline); cancel own request until pick-up | Every active member, cannot be disabled |

| Actor | Catalog | Request | Own requests | All requests | Approve, reject, extend | Handover, return, outside-party | Manage items | Export |
|---|---|---|---|---|---|---|---|---|
| Head of Operations (P-KADEP-OPS, Kepala Divisi Logistik/Akomodasi) | Yes | Yes | Yes | Yes | Yes, **except own request** | Yes (also own request) | Yes | Both |
| Other Operations member (P-STAFF-LOG, Staff in Akomodasi, Sekretaris Departemen Operasional) | Yes | Yes | Yes | Yes | **No** | Yes (also own request) | Yes | Both |
| BPH member (P-KETUM) | Yes | Yes | Yes | **View only** | No | No | No | Both |
| Operations Staff who is also BPH (P-OPS-BPH) | Yes | Yes | Yes | Yes | No (Staff is not a head) | Yes | Yes | Both |
| System Admin without Ops/BPH position (P-ADMIN) | Yes (D01) | Yes (L9) | Yes | **No** (B18 default a) | No | No | No | No |
| Staff outside Operations (P-STAFF-PUB), department secretary of another unit, plain member (P-PLAIN), lecturer (P-LECT) | Yes | Yes | Yes | No | No | No | No | No |
| Member with an Operations position only in a PREVIOUS period (P-OLD) | Yes | Yes | Yes | No | No | No | No | No |
| Deactivated, unlinked, anonymous | No | No | No | No | No | No | No | No (L1) |

**Rules that follow**
- **L6 (self-approval), amended.** For borrowing it blocks only approve, reject and extend of your own request (D-022, IB2). A head cannot approve, reject or extend their own request; another head must. Recording the handover and return of your own request is allowed; the history row shows who recorded it. Known risk: a holder could record their own return falsely. The only defence is the append-only history and the evidence photo for damaged or lost returns.
- **B29 (single approver), sharper now.** There are at most three heads by default (Kepala Departemen, Kepala Divisi Logistik, Kepala Divisi Akomodasi). If only one head is in office, their own request waits for a second head; the requester sees "Menunggu persetujuan" and the heads' queue shows a hint that only one approver exists. No override (B29, locked). The admin may add a rule for another position (logged, with a written reason).
- **Without a key.** A direct link to the heads' queue or the work list shows the shared "no permission" page. API calls return no rows or an error. Buttons without the matching key are absent, not greyed out. The drawer item "Manajemen & Inventaris" shows for every active member once the module is built (D-021, `inventory.view` is baseline).
- **System Admin (B18).** Sees what a plain member sees unless the admin also holds an Operations or BPH position, or adds a rule (logged, flagged self-benefit, D-012).
- **Lecturers** are baseline members (B15 stays open): they may browse and request [A-IB3].
- **Own units.** The catalog keys accept only scope "all"; items have no owner unit (IB3).

---

## 3. User flows

Common: every step runs on the server. Each page and action first checks session, active member (L1) and the key. Mobile-first, 390 px. All texts are proposals for the UX designer and owner. Dates are calendar dates in Asia/Jakarta.

### F1. Browse the catalog (everyone)
1. The member opens "Manajemen & Inventaris".
2. A list of active items: code, name, category, location, quantity in good condition out of total, a condition chip. For an individually tracked item the row expands to its units (code, condition, location). Search by name or code; filters by category, location and condition. [A-IB5] Archived items and units are hidden from members.
3. Item detail: description, stock per condition, units, and "Cek ketersediaan": pick a date range, see "Tersedia n dari m". It never shows who holds an item (R8).
4. Empty: "Belum ada barang di inventaris." (managers also see "Tambah barang"). Loading: skeleton rows. Error: "Terjadi gangguan. Coba lagi." with retry (fail closed, no sign-out).

### F2. Manage items (`inventory.manage`)
1. The manager taps "Tambah barang" (design missing) and **chooses the mode**: individually tracked or quantity-based. The mode cannot be changed once the item has borrowing history [A-IB25].
2. Common fields: name (required), description, category and location from the lists.
3. Individually tracked: add one or more units (each gets its own `INV-` code, its own condition, its own location). Quantity-based: enter the count per condition (Baik, Perlu servis, Rusak); the item gets one `INV-` code. The server assigns codes (IB11); nobody types or edits a code.
4. The server validates (name 1-120 characters, description up to 1000, category up to 60, location up to 80, whole numbers from 0 to 9999 per condition, list values, fixed conditions; section 11c) and writes a history row "dibuat".
5. **Edit** any field. Every change of stock or condition writes a history row (who, when, from, to, optional note) [A-IB6]. A quantity moved to a worse condition or written off needs a note. Moving a quantity or a unit out of Baik cannot reduce the lendable quantity below what is reserved by approved or borrowed requests for any day (R3).
6. **Write-off (hilang, dibuang):** an individual unit gets status Hilang (its code stays in history, never reused); a counted item loses that quantity from its total. Note required. Never a delete (L5). **Restore ("Ditemukan kembali")**: a written-off unit can be brought back by a holder of `inventory.manage` (not by `borrowing.handle`, owner decision 2026-11-07 after the security review, amends A-IB45); the item must be active; reason required; the history row keeps the original write-off.
7. **Archive** ("Nonaktifkan") an item or a unit: blocked while it has an open request line or is on loan. The message names the count, never the borrower. Archived entries disappear from members' lists and from request forms; managers see them with the filter "Nonaktif"; exports include them only with the filter. "Aktifkan kembali" restores.
8. **Lists.** A manager adds, renames or deactivates categories and locations. Both lists start empty; the owner supplies the first values (IB10). A deactivated entry stays on the items that use it.
9. A manager who is not a holder of `borrowing.view_all` (custom rules only) sees only "masih ada peminjaman terbuka" when blocked, no names.

### F3. A member requests a borrowing (every active member)
1. The member taps "+ Ajukan Peminjaman" (screen missing; Stitch has the button only).
2. Form: choose one or more items and a quantity per item (an individually tracked item is requested by quantity, the specific units are chosen at handover [A-IB29]); start date and end date (planned return day, inclusive); "Keperluan / kegiatan" free text (what it is for; a team or event name goes here); optional note. No lead time applies (IB4) and no loan length is limited in practice (IB5), except the technical date cap: the end date is at most 365 days after the start date (section 11c). At most 50 lines per request, at most 200 units per line; purpose and note up to 500 characters.
3. For each line the form shows live availability for the range (R3, R4) and blocks quantities above what is free. Start date cannot be in the past (Jakarta date). Only items in Baik condition and active are offered.
4. The server re-validates everything (never trusts the form): active member, active period exists (R11), items active, quantities, dates, availability, and the caps of section 11c (at most 5 open Diajukan requests per member; at most 20 new requests per Jakarta day). It saves status **Diajukan**, period = active period, requester = session member (never client input).
5. The member lands on the request detail ("Detail Tiket"): reference, lines, dates, status timeline, and the text "Cek statusnya di Peminjaman Saya."
6. No active period: "Belum ada periode aktif. Pengajuan belum bisa dibuat." If availability changed between form and save: "Stok berubah. Cek lagi" and the form keeps the input.

### F4. A head reviews (`borrowing.approve`)
1. The head opens "Antrean persetujuan" (design missing): default filter "Menunggu persetujuan", oldest first, with a count. Other filters: status, date range, item, requester name, "Terlambat".
2. The head opens a request: lines, dates, purpose, requester name (PI-CORE name; for an outside-party request the organisation and the contact person name), availability per line right now, warnings ("2 pengajuan lain berstatus Diajukan di tanggal yang sama"; pending requests hold nothing, IB6). Own requests: buttons absent with "Tidak bisa memproses pengajuanmu sendiri" (L6).
3. **Approve** (optional note; a lower quantity per line is allowed with a note [A-IB14]) or **Reject** (note required).
4. At approval the server re-checks availability inside one database transaction that locks the item's rows, so two heads acting at once cannot over-book (R5). If it fails: "Stok tidak cukup di tanggal itu" and the request stays Diajukan.
5. Result: **Disetujui** or **Ditolak**, note, approver and time, one history row. From approval on, the quantity is held (IB6). The requester sees it in "Peminjaman Saya".
6. Empty queue: "Tidak ada pengajuan yang menunggu."

### F5. Handover / pick-up (`borrowing.handle`)
1. An Operations member opens "Daftar kerja" (design missing, work list: approved requests waiting for pick-up, loans out, overdue) and opens an approved request. Any Operations member may do this, including for a request they made themselves (IB2).
2. Per line: quantity actually handed over (at most the approved quantity; may be lower). For an individually tracked item the member **chooses the specific units** (by `INV-` code) among units in Baik condition that are not on another open loan [A-IB29]. Optional condition note.
3. Status **Dipinjam** [A-IB8: not before the start date]; handed quantities count as on loan; history row names the recorder. If nothing is handed over, the request is cancelled instead (F7).
4. An approved request not picked up still holds its stock. After the start date it is shown "Belum diambil" (derived, R9); a handle holder may cancel it with a reason (F7).

### F6. Return (`borrowing.handle`)
1. An Operations member opens a borrowed request (also their own) and taps "Terima pengembalian".
2. Per line (or per chosen unit for individually tracked items) the member records one outcome for the outstanding quantity: **kembali baik** (tick, note optional), **kembali rusak** or **hilang**. For **rusak** the member states the resulting condition (Perlu servis or Rusak) [A-IB30]. For **rusak and hilang**, a note AND at least one photo are required; the save is refused without both (IB8). Photos are resized in the browser before upload [A-IB31] and kept for good in a private bucket.
3. Server effects: kembali baik frees the stock **immediately**: the unit or quantity is lendable again the moment the return is recorded, even for a request that includes the same day (A-IB18 answered). Rusak moves that unit or quantity to the stated condition and writes a history row linked to the request. Hilang writes the unit off (status Hilang, code stays) or reduces the counted total, with a history row. Nothing is deleted.
4. A partial return is allowed: lines keep their outstanding quantity and the request stays **Dipinjam** ("Sebagian kembali") until nothing is outstanding. Then **Dikembalikan**; a flag "ada masalah" shows when any line was rusak or hilang.
5. NEXUS tracks no deposit, fine or replacement (IB8). The note and the photo are the record.
6. **Correction (only for returns).** A `borrowing.handle` holder may correct a wrong return once per request, with a reason. It is refused if the stock of the item changed since the return was recorded (for example the unit was lent again or its condition was edited). There is no correction of a handover; a mistaken handover is handled by the normal flow and a note.

### F7. Cancel
1. **Requester, Diajukan:** "Batalkan pengajuan" (L9); reason optional. Status **Dibatalkan**.
2. **Requester, Disetujui, before pick-up:** allowed, reason required (IB7). Frees the held stock.
3. **A `borrowing.handle` holder:** may cancel an approved request that was not picked up, with a reason (for example the requester was deactivated or the item was withdrawn) [A-IB34]. A Diajukan request of a deactivated member is rejected by a head with a note.
4. After handover nobody cancels: the loan ends only by return.

### F8. Extend (`borrowing.approve`)
1. A head opens an approved or borrowed request and taps "Ubah tanggal kembali", picks a later end date and writes a note (required).
2. The server checks availability for the added days like a new approval (R5) [A-IB26]. If an approved request conflicts: "Bentrok dengan pengajuan lain".
3. The end date changes; an extension history row stores old date, new date, who, when, note; the status does not change. A head cannot extend their own loan (L6); another head does. There is no loan maximum (IB5) beyond the date cap: the new end date is at most 365 days after the ORIGINAL start date; a longer loan needs a new request (section 11c).

### F9. Overdue (derived, nothing stored or sent)
1. A request is **Terlambat** when its status is Dipinjam, some line still has outstanding quantity, and the end date is before today (Asia/Jakarta).
2. A chip shows it on the requester's list and detail, at the top of the work list and the heads' queue (filter "Terlambat"), and to BPH in the all-requests view.
3. An overdue line keeps holding its quantity until returned (R4).
4. Extending (F8) is the head's tool; otherwise the borrower is asked outside the app (IB14).

### F10. An Operations member records a request for an outside party (`borrowing.handle`)
1. In "+ Ajukan Peminjaman" an Operations member sees the extra choice "Untuk pihak luar" (design missing, a recording form) [A-IB28].
2. Required: organisation name and contact person name (free text). No phone, no email field exists (IB14, L4). The rest is as F3.
3. The recording member is the **requester of record**: it appears in their "Peminjaman Saya", they may cancel it while Diajukan or Disetujui, and L6 blocks them from approving, rejecting or extending it.
4. It follows the normal path: a head approves, any Operations member hands over and takes back (the recorder too, IB2).

### F11. Period change with open loans
1. The active period switches in PI-CORE. No logout, no deploy (access control R3).
2. Open requests (Diajukan, Disetujui, Dipinjam) keep the period in which they were created. They stay actionable by whoever holds the matching key now (L7, AC-42): approve/reject/extend by `borrowing.approve`, handover/return by `borrowing.handle`.
3. Closed requests (Dikembalikan, Ditolak, Dibatalkan) of the old period are read-only. Viewing them follows the CURRENT `borrowing.view_all` right (L8); the requester still sees their own (L9).
4. Items, units, lists and codes are not period-scoped (A-n5): nothing changes there.
5. **Handover helper** [A-IB11]: the work list and the heads' queue have a filter "Belum selesai (semua periode)" and the open-loans export, so the outgoing team can hand a list to the new team. This belongs in the "how to start a new period" guide.
6. Between periods there may be a moment with no active period; Operations rules (S3) then match nothing (R11), so nobody can approve, hand over or take returns until the new period is active (R12).

### F12. Export (`inventory.export` / `borrowing.export`)
1. One "Ekspor" button with a menu Excel, CSV, PDF (as Data Anggota, M5). Absent for users without the matching key.
2. The server rebuilds the list with the current search and filters, ALL matching rows, same order, same columns as the screen, never more than the user may view (access control R15).
3. Files are generated on the server with the shared writers (D-020), stored nowhere, dates in WIB, header shows the period label and export date [A-IB12].
4. Before the file is returned, one row is written to the export log (section 4, IB13). If it cannot be written, no file is returned [A-IB33].

### States (all screens)
| State | Behavior |
|---|---|
| Loading | Skeleton rows; controls usable |
| Empty catalog / list | Plain text per list; add button only for managers |
| No match | "Tidak ada hasil. Ubah pencarian atau filter." + Reset |
| Error / PI-CORE or `nexus` unreachable | "Terjadi gangguan. Coba lagi." with retry; never "no access" |
| Session ended | Redirect to login (auth-login F9) |
| Right removed while open | Next action fails with "Aksesmu sudah berubah..." |
| Conflict (stock or status changed by someone else) | "Data sudah berubah. Muat ulang." The server rejects a transition whose starting status no longer matches, so two people cannot both approve or return the same request |
| Photo upload fails on a damaged or lost return | The line is not saved; "Foto gagal diunggah. Coba lagi." |

---

## 4. Data model (plain words, schema `nexus`; names are for orientation, the database engineer decides)

All tables: RLS on, default deny, explicit policies (CLAUDE.md 11). Creator ids are `members.id` taken from the session. No foreign keys into PI-CORE (access control 7.2).

| Table | One row is | Key fields | Notes |
|---|---|---|---|
| Items | one catalog entry | name, description, **mode** (individual or counted), category, status (active/archived), code (counted items only), created by/at, updated by/at | Not period-scoped (A-n5). Never deleted, only archived. Mode locked once the item has borrowing history [A-IB25] |
| Units | one physical unit of an individually tracked item | item, **code**, condition (Baik, Perlu servis, Rusak), location, status (active, archived, Hilang), note | Codes never reused. A lost unit stays with status Hilang |
| Item stock | quantity of a counted item in one condition | item, condition, quantity, location | Total = sum. Only the Baik quantity is lendable |
| Code sequence | the one `INV-` counter | next number | Assigned by the database in the same transaction as the insert, so two creations never get the same code (IB11, A-IB27). Numbers beyond 9999 grow (`INV-10000`) |
| Categories, locations | one list entry | name, active flag, sort order | Maintained by `inventory.manage`; deactivate, never delete; start EMPTY (IB10) |
| Item history | one change to an item or unit | item/unit, kind (created, edited, condition move, write-off, archived, reactivated), from/to, quantity, note, request id if caused by a return, who, when, active period id | Append-only. No update, no delete, even by the admin |
| Borrowing requests | one request (header) | reference, **requester of record**, outside-party block (flag, organisation name, contact person name; empty for member requests), period (active at creation), purpose, note, start date, end date (current), status, decided by/at, decision note, handed over by/at, last returned at, flag has-issue, created at | Dates are plain Jakarta calendar dates. Terlambat, Belum diambil, Sebagian kembali are computed, not stored |
| Request lines | one item inside a request | request, item, quantity requested, quantity approved, quantity handed over, line note | Outstanding = handed over minus all return outcomes; never negative |
| Line units | one specific unit handed over (individually tracked items) | line, unit | One unit cannot sit on two open loans |
| Line returns | one return outcome | line, unit (empty for counted items), quantity, outcome (kembali baik, kembali rusak, hilang), resulting condition (for rusak), note, recorded by/at | Note required for rusak and hilang. Append-only |
| Evidence photos | one private file | line return, storage path, size, type, uploaded by/at | Required for rusak and hilang: at least one, at most three [A-IB31]. Resized in the browser. Private bucket, short-lived signed URLs, visible to `borrowing.view_all` holders and the requester (L9, L11). **Never purged and never deleted (L5)** |
| Extension history | one change of end date | request, old end date, new end date, who (a head), when, note | Append-only |
| Status history | one status change of a request | request, from, to, who, when, note, active period id | Append-only; basis of the timeline |
| Export log | one successful export | module (inventory or borrowing), who, when, format, filters, period id | Append-only, no PII, no exported rows [A-IB33]. Read through the database until the log screen exists |

**Request state machine**

| From | To | Who may trigger | Conditions |
|---|---|---|---|
| (new) | Diajukan | Any active member for their own request; or a `borrowing.handle` holder recording for an outside party (requester of record = the recorder) | Active period exists; items active and in Baik; quantities within availability; dates valid |
| Diajukan | Dibatalkan | The requester of record (L9) | Not yet decided |
| Diajukan | Disetujui | `borrowing.approve` holder (a head), not the requester (L6) | Availability re-checked in the transaction (R5) |
| Diajukan | Ditolak | same | Note required |
| Disetujui | Dibatalkan | The requester of record (reason required, IB7); or a `borrowing.handle` holder (reason required, [A-IB34]) | Before handover |
| Disetujui | Dipinjam | `borrowing.handle` holder (including the requester themselves) | At least one line handed over |
| Dipinjam | Dipinjam (sebagian kembali) | `borrowing.handle` holder | Some, not all, outstanding quantity closed |
| Dipinjam | Dikembalikan | same | Outstanding = 0 on every line; note and photo recorded for every rusak/hilang |
| Dikembalikan | Dipinjam | `borrowing.handle` holder, reason required | Correction of a wrong RETURN only; once per request; refused if the stock changed since the return (section 11c); logged [A-IB15] |
| Dibatalkan, Ditolak | none | - | Terminal. A new request is the way forward |

**Actions that change data but not the status**

| Action | Who | Conditions |
|---|---|---|
| Extend the end date (Disetujui or Dipinjam) | `borrowing.approve` holder, not the requester (L6) | Note required; availability checked; extension history row |
| Edit a submitted request | nobody | Cancel and resubmit instead [A-IB7] |

Not allowed: skipping states; any backward move except the one return correction per request; any delete; editing lines of a processed request.

With no active period no transition works: creating needs a period, and the Operations rules (S3) match nothing, so even open requests cannot be processed until a period is active (R11, R12, access control E4). With an active period, open requests of older periods stay actionable by current holders (L7).

**Retention.** No permanent delete anywhere (L5). Items and units archive; requests end in a terminal status; history tables are append-only; evidence photos and their records stay. A deactivated member's requests and names stay.

---

## 5. Business rules and edge cases

| # | Rule or case | Expected behavior |
|---|---|---|
| R1 | Who may request | Any active member (L9), including Operations, BPH, lecturers and the admin; requester = the signed-in member. Outside parties are recorded by an Operations member (F10), never by themselves |
| R2 | One request, several items | Allowed. Each line is checked and closed on its own; the request is Dikembalikan only when all lines are closed |
| R3 | Quantity check | Requested quantity per line is a whole number from 1 up to the free quantity for the whole date range. Free = lendable quantity (units or count in Baik, active) minus outstanding quantity of overlapping requests that are Disetujui or Dipinjam. Items in Perlu servis or Rusak are not lendable (IB10) |
| R4 | Overlap and overdue | Two ranges overlap if they share at least one day (end date inclusive). A returned item is free again immediately, not from D+1 (owner 2026-11-07, A-IB18 answered). An overdue line holds its quantity until actually returned |
| R5 | Double booking | The database, not only the page, prevents over-booking: approval and extension re-check free quantity while holding a lock on the item, and a database rule rejects any state in which approved plus borrowed quantity exceeds the lendable stock on any day. Two heads at the same time: the second gets "Stok tidak cukup" |
| R6 | Pending requests and stock | Diajukan requests hold nothing (IB6); only Disetujui and Dipinjam hold stock. The review screen warns about overlapping pending requests |
| R7 | Borrowing your own unit's items | Items have no owner unit (IB3). A member borrowing for their department is a normal request. An Operations member requests like anyone; a head must approve (another head if the requester is a head) |
| R8 | Privacy of availability | Members see counts and free/taken dates ("Tersedia 2 dari 4 tanggal 10-12"), never who holds the item. Other members' requests are not readable (L9). The answer comes from a restricted database function (D-010 pattern), not from reading other rows |
| R9 | Derived flags | Terlambat (F9), Belum diambil (approved, start date passed), Sebagian kembali. Computed on read with today's date in Asia/Jakarta; no background job on the free tier |
| R10 | Individually tracked items | Reserved by quantity at approval; the unit is chosen at handover [A-IB29]. At handover only units in Baik that are on no other open loan are offered. If fewer lendable units remain than approved (a unit went to service meanwhile), the handler hands over fewer and notes why |
| R11 | No active period | Creating a request is rejected (access control R11, AC-43). The catalog stays readable (baseline D01). Operations rights (S3) match nothing, so managing items and processing requests also stop (E4); a banner explains |
| R12 | Gap risk | Items on loan while no active period exists cannot be received back in NEXUS. Operational rule for the handover guide: activate the new period first, then process returns |
| R13 | Requester deactivated mid-loan | They lose access at once (L1). Requests remain with their name. A borrowed request stays Dipinjam; an Operations member records the return; overdue keeps showing. Approved, not picked up: a handle holder cancels with a reason [A-IB34]. Diajukan: a head rejects with a note. NEXUS shows no phone or email (L4); contact happens outside the app (IB14) |
| R14 | Head deactivated or loses the right | Another head acts. If none holds `borrowing.approve`, the admin sees the "nobody can use it" warning (access control section 5) |
| R15 | Approve/reject/extend own request (L6) | Blocked on the server and by RLS even if a rule grants the key (AC-57). Buttons absent. Recording own handover or return is allowed (IB2) |
| R16 | Single head (B29, locked) | A head's own request waits for a second head; hint on screen; no override |
| R17 | Item or unit archived while requests are approved | Blocked by F2 step 7. If a rule change makes it happen anyway, the request shows the item as "Tidak aktif" and Operations must cancel it |
| R18 | Stock lowered under open reservations | Blocked (F2 step 5). The message says how many are reserved, not by whom |
| R19 | Time zone | Dates are calendar dates in Asia/Jakarta (WIB, UTC+7, no daylight saving). "Today", past-date checks, overdue and exports use Jakarta dates, not UTC. A request saved at 00:30 WIB belongs to the Jakarta day. Timestamps are stored in UTC and shown in WIB |
| R20 | Duplicate lines | The same item twice in one request is merged or rejected |
| R21 | Many rows | Lists paginate on the server (page size 20 [A-IB20]); search by item name, code and requester name |
| R22 | Mode of an item | Individual or counted, chosen at creation, locked after the first borrowing history [A-IB25]. To change it, create a new item |
| R23 | Codes | `INV-` codes are assigned by the database, are unique, never reused and never edited, including for archived and lost units (IB11) |
| R24 | Evidence photos | Required for every rusak or hilang outcome, never for good returns. Resized in the browser, stored privately, never purged (IB9). A deactivated requester's photos stay |
| R25 | Mistaken return (or handover) | A wrong RETURN has one reasoned correction per request, refused if the stock changed since (A-IB15, section 11c). A handover has no correction; every other fix is a new history row and a note |
| R26 | Outside-party request | The requester of record is the recording Operations member (F10). Organisation and contact person name are the only data about the outside party; no phone or email is stored (IB14, L4). If the recorder is deactivated, the request stays and any Operations member hands over and takes back |
| R27 | Old-period records | Read per L8; own requests always readable (L9); no edit (L7) except open items |
| R28 | Holder of `inventory.manage` without `borrowing.view_all` | Possible only with custom rules; sees no requests; see F2 step 9 |
| R29 | Request caps | Per member: at most 5 open (Diajukan) requests and at most 20 new requests per Jakarta day. A request recorded for an outside party counts toward the RECORDER's caps. Over the cap: the request is refused with a clear message (section 11c) |
| R30 | Date cap | `end_date` is at most `start_date` + 365 days, on submit and on every extension (counted from the original start date). A longer loan needs a new request |
| R31 | Size limits | Field, stock, line and photo limits of section 11c, enforced by the database as well as the page |

---

## 6. Stitch conflicts (filler flagged, not adopted)

| Stitch content (screens 12, 13, 14) | Problem | Decision |
|---|---|---|
| One scroll showing loan cards of all borrowers to anyone | Members may see only their own requests (L9) | Split: catalog for everyone, "Peminjaman Saya", queue and work list for the holders of the keys |
| Loan badge "Tersedia" | Availability belongs to the item, not to a request | Request statuses of section 4; availability on the item |
| Borrower "Tim Ibadah Padang", "Divisi Persekutuan", "Panitia Dies Natalis" | Requests belong to a member; teams are not PI-CORE entities (B7) | Requester = member; team or event goes in "Keperluan"; outsiders via F10 |
| "Detail Tiket" link | No screen | Request detail screen (section 9) |
| Notice "diajukan maksimal H-3 kegiatan dan divalidasi oleh Koordinator Logistik" (13: "Koordinator Inventaris Divisi Logistik", chip "Divisi Rumah Tangga & Logistik") | H-3 is filler (IB4); "Koordinator" is no PI-CORE position | Removed. Approvers are the heads (IB2) |
| Tiles "Total Aset 12 Unit / Dipinjam 2 Unit / Siap Pakai 10 Unit" (12, 14) vs "Kondisi Baik 91%" (13); dashboard "80%" | Inconsistent; the owner dropped the percentage (IB12) | Counts only; see section 8 |
| Item codes "Inv-001/LOG", "Inv-004/AUD" (13) | Invented unit suffixes | Automatic `INV-0001` only (IB11) |
| Condition "Servis" | Owner fixed the list: Baik, Perlu servis, Rusak | Use the fixed three |
| Sample locations (Sekretariat PMK, Box Audio GK 1, Lemari BPH, Ruang Logistik), context "OK 1" | Not confirmed | Lists start empty (IB10) |
| "Unduh Rekap Aset (PDF)" visible to all, PDF only | Export needs `*.export`; three formats (D-020, M5) | One "Ekspor" button, keys, 3 formats |
| Context sample "Drum, 5 units" vs Stitch "Drum Elektrik 1 Unit" | Sample data disagree | Real data entered by Ops |
| "3 Aktivitas" and one list for loans | Not a defined concept | Status counts per role |
| Pagination only in 13 | Inconsistent | Server pagination as Data Anggota |
| No empty/error states, item form, request/approval/handover/return screens | Missing | Section 9 |
| Header bell with a permanent gold dot | No notification system (section 7) | The bell must not imply notifications for this module |
| Drawer label "Manajemen & Inventaris" (12) vs "...Barang" (context) | Cosmetic | Follow the Stitch drawer wording (D-014) |

Style follows `docs/design/stitch/design-system.md` (8 px buttons and inputs, 12 px cards, pills only for status chips, 44 px fields). Variants 12 (hard-coded hex) and 13 (tokens) differ; the UX designer proposes one using theme tokens.

---

## 7. Notifications (none, IB14)

NEXUS has no email, push or WhatsApp channel in Phase 1. Instead:
- **Requester:** "Peminjaman Saya" is the status page: a chip per request (Diajukan, Disetujui, Ditolak, Dibatalkan, Dipinjam, Terlambat, Dikembalikan), the head's note (required on rejection), the timeline, the current end date. After submitting, the app says "Cek statusnya di Peminjaman Saya."
- **Heads:** the queue shows the count of waiting requests at the top of the module. **Operations:** the work list shows approved requests awaiting pick-up, loans out and overdue loans. [A-IB21] A drawer badge and a Dashboard line for waiting approvals are proposals for the Dashboard module.
- **Overdue:** chip and filter only (F9).
- Consequence to tell the owner: a request waits until someone opens the app. Agree a habit (for example the heads check the queue daily). Contacting borrowers happens outside NEXUS because phone and email are never shown (L4). Email notifications may come in a later phase.

---

## 8. Export, log and Dashboard

| Export | Key | Who (default) | Content | Notes |
|---|---|---|---|---|
| Inventory | `inventory.export` | BPH (D09), Operations (D29) | Code, item, mode, category, location, condition, quantity per condition, status (active/archived/Hilang); individually tracked items one row per unit | Respects the search and filters; archived only with the filter |
| Borrowing | `borrowing.export` | BPH (D11), Operations (D31) | Reference, requester (or organisation and contact person for outside parties), purpose, items and quantities, units handed over (codes), start/end dates, extensions count, status, decision, handover and return dates, return outcomes, has-issue flag, period | Respects filters (status, dates, item, period). Evidence photos are not exported |

- A member cannot export their own requests [A-IB22].
- Formats, writers and the "Ekspor" button follow D-019/D-020 and `src/lib/export/`; dates in WIB.
- **Export log (IB13):** every successful export writes one append-only row (module, who = `members.id` from the session, when, format, filters, period id). No PII, no exported rows. Same pattern as Member Data: if the row cannot be written, no file is returned [A-IB33]. The screen to read the log comes later together with the Member Data log screen (A-MD14); until then it is readable only through the database. No key for reading the log is created now.

**Dashboard card "Inventaris Status" (IB12).** No percentage anywhere. The card shows counts, for example "42 unit baik · 5 dipinjam · 3 perlu servis" (exact wording at design time). Definitions [A-IB32]: baik = units or quantity in Baik condition, including those on loan; dipinjam = units or quantity out on a loan right now; perlu servis = units or quantity in Perlu servis. Archived entries and lost units are not counted; Rusak is not shown on the card. Shown to every active member (D01, access control A-n1). Empty state: neutral text, no "0%".

---

## 9. Screens: what exists in Stitch and what the UX designer must design

Stitch 12/13/14 give one landing page that mixes everything. None of the following exists in Stitch:

1. **Module landing, role-aware:** catalog for everyone, "Peminjaman Saya", plus the heads' queue and the Operations work list for the holders of the keys. Replaces the single scroll of 12/13.
2. **Catalog list** (search by name and code; filters category, location, condition; expandable units for individually tracked items; empty, loading, error states).
3. **Item detail** with units, stock per condition and the availability-by-date check.
4. **Item form** (add/edit): mode choice first, then name, description, category, location, units or counts per condition, archive/reactivate. **No photo upload.** Codes are shown, never typed.
5. **Condition change and write-off dialog** (with required note).
6. **Lists screen** for categories and locations (add, rename, deactivate).
7. **Borrowing request form** (item picker with quantity, date range with live availability, purpose, note).
8. **Recording form for an outside party** (the same form with "Untuk pihak luar": organisation name, contact person name).
9. **Peminjaman Saya** and the **request detail ("Detail Tiket")** with status timeline, extension history, decision note and cancel action (reason field after approval).
10. **Heads' queue** with filters, the overdue filter, request review, **approve/reject dialog** (note rule), conflict and pending-overlap warnings, the "own request" and "single approver" states.
11. **Extend dialog** (new end date, required note, conflict message).
12. **Operations work list** (waiting for pick-up, loans out, overdue, "belum selesai (semua periode)").
13. **Handover screen** (per-line quantity, unit picker by code for individually tracked items, note).
14. **Return screen** (per line or unit: kembali baik / kembali rusak / hilang, resulting condition, required note, **photo picker with in-browser resize** for rusak and hilang, partial return).
15. **Export menu** (reuse the Data Anggota pattern). The export-log screen is NOT designed now.
16. **Dashboard card "Inventaris Status"** with counts, and an optional "menunggu persetujuan" line for heads.
17. Shared: no-permission page, "no active period" banner, system messages.

---

## 10. Assumptions

Active assumptions (all [ASSUMPTION] until the owner confirms; copied to `docs/OPEN_QUESTIONS.md` section H). **Answered by the owner and therefore no longer assumptions:** A-IB1 (IB2), A-IB4 (IB3), A-IB9 (IB7), A-IB10 (IB5), A-IB13 and A-IB23 (IB10), A-IB17 (IB15), A-IB19 (IB6). **Also answered or decided on 2026-11-07 (follow-up):** A-IB18 (a returned item is free immediately), A-IB36 (decided by the database engineer), A-IB43 (limits, section 11c), A-IB45 (amended: `inventory.manage`), plus the caps and the date cap (A-IB47, A-IB48).

| Id | Assumption |
|---|---|
| A-IB2 | `inventory.manage` also covers the category and location lists |
| A-IB3 | Lecturers may browse and request like every active member (L9) |
| A-IB5 | Archived items and units are hidden from members and request forms; visible to managers by filter |
| A-IB6 | Every stock or condition change writes a history row; write-offs need a note |
| A-IB7 | A submitted request cannot be edited; cancel and resubmit |
| A-IB8 | Handover cannot be recorded before the request's start date |
| A-IB11 | The queue and work list have a "Belum selesai (semua periode)" filter and an open-loans export for period handover |
| A-IB12 | Export header shows the period label and export date in WIB, like Member Data |
| A-IB14 | A head may approve a lower quantity per line, with a note |
| A-IB15 | One reasoned correction exists: Dikembalikan back to Dipinjam, by a `borrowing.handle` holder. **Narrowed by the owner 2026-11-07:** returns only (no handover correction), once per request, refused if the stock changed since the return |
| A-IB16 | Progja can later link to a request by id without a rewrite |
| A-IB18 | A date range is inclusive. **Answered 2026-11-07:** a returned item is free again immediately (replaces "free from D+1") |
| A-IB20 | Page size 20 |
| A-IB21 | Drawer badge and Dashboard line for waiting approvals are proposals for other modules |
| A-IB22 | Members cannot export their own requests |
| A-IB24 | The request reference is system generated; its format is not a letter number and is chosen at build time |
| A-IB25 | The mode of an item (individual or counted) cannot change once it has borrowing history; create a new item instead |
| A-IB26 | Extending is an approve-type action: needs `borrowing.approve`, is blocked on your own loan (L6), is checked against availability like a new approval, and is logged in the extension history |
| A-IB27 | Code `INV-0001`: one sequence, never reused, assigned by the database; per unit for individually tracked items, per item for counted items; archived and lost entries keep their code; numbers beyond 9999 just grow |
| A-IB28 | APPROVED by the owner 2026-11-07: an outside-party request stores organisation name and contact person name only; the recording Operations member is the requester of record; L6 blocks them from approving it; any Operations holder may record one |
| A-IB29 | For individually tracked items the requester picks the item and a quantity; stock is reserved by quantity at approval; the Operations member chooses the specific units (by code) at handover |
| A-IB30 | A damaged return states the resulting condition (Perlu servis or Rusak). A lost unit is a write-off: it stays in history with status Hilang and its code; for counted items the total drops |
| A-IB31 | Evidence photos: 1 to 3 per damaged or lost outcome, resized in the browser to a long side of about 1280 px (the database and the bucket accept at most 1.5 MiB each, JPG, PNG or WebP only, A-IB43); private bucket; viewable by `borrowing.view_all` holders and the requester; never purged. Free-tier note: Supabase storage is about 1 GB (`docs/OPEN_QUESTIONS.md` C9, verify before launch); at 300 KB a photo, even 100 damaged returns a year with 2 photos is about 60 MB a year |
| A-IB32 | Dashboard counts: units in Baik (including on loan), units on loan now, units in Perlu servis; archived and lost excluded; Rusak not on the card; wording at design time |
| A-IB33 | The export log has one row per successful export of the catalog or of borrowing; sharing the Member Data table is the database engineer's call; readable only through the database until the log screen exists; no export without a log row |
| A-IB34 | A `borrowing.handle` holder may cancel an approved request not picked up (reason required); a head rejects a Diajukan request of a deactivated member with a note |
| A-IB35 | Any head of Operations may approve any request, not only requests for their own division |
| A-IB36 | **Decided 2026-11-07 (database engineer; reason in the header of migration `20261107100000`):** `borrowing.handle` is treated like `borrowing.approve` in the catalog: never grantable to "every active member", written reason required (L12). It is NOT sensitive (`is_sensitive` = false) and never baseline |
| A-IB43 | **Decided 2026-11-07:** limits listed in section 11c (item name 120, description 1000, purpose and notes 500, category 60, location 80, outside-party names 120; stock 0-9999 per condition; at most 50 lines per request, 200 units per line; 1-3 photos of 1.5 MiB; at most 10 unattached uploads per request folder; since 2026-11-09 counted over the last 24 hours only) |
| A-IB45 | **Amended 2026-11-07 (tech lead decision after the security review):** a written-off (Hilang) unit is restored ("Ditemukan kembali") by a holder of `inventory.manage`, only when the item is active; no longer by `borrowing.handle` |
| A-IB47 | **Answered 2026-11-07:** per member at most 5 open (Diajukan) requests and at most 20 new requests per Jakarta day; outside-party requests count toward the recorder's caps |
| A-IB48 | **Answered 2026-11-07:** `end_date` is at most `start_date` + 365 days, also for extensions (counted from the original start); a longer loan needs a new request |
| A-IB49 | [ASSUMPTION] The "open" cap of 5 counts Diajukan requests only (not Disetujui or Dipinjam); the daily cap of 20 counts every request created that Jakarta day, even if it is cancelled later. Needs the owner's confirmation |

---

## 11. Acceptance criteria

Personas: `docs/modules/access-control.md` section 9. Defaults D01, D09-D11, D28, D29, D31, D34-D36 apply unless stated. The Operations personas are P-KADEP-OPS (head), a Kepala Divisi in Logistik or Akomodasi, P-STAFF-LOG, a Staff in Akomodasi and a Sekretaris Departemen Operasional. Every criterion is meant to be tested through the UI AND by a direct call with that persona's token.

**Catalog and permissions**
- IB-01 P-PLAIN, P-STAFF-PUB, P-LECT, P-KETUM and P-ADMIN (no assignment) can open the module and read the catalog; none sees "Tambah barang", the item form, the lists screen, the queue or the work list; a direct call to create or edit an item with their token is rejected.
- IB-02 Every Operations persona (including a Sekretaris Departemen Operasional) can add, edit, archive and reactivate items and units, move stock between conditions, write off, and edit the category and location lists (D28).
- IB-03 P-INACTIVE, P-UNLINKED and a request without a session get nothing from any function of this module, even with a still-valid token (L1).
- IB-04 P-KETUM can see all requests and export both lists, and cannot approve, hand over, receive a return or edit an item (AC-07).
- IB-05 P-ADMIN (no assignment) cannot read another member's request (B18 default a).
- IB-06 If rules D28, D29, D31 or D34-D36 are disabled, the matching holders lose the power on their next request, with no logout (AC-25).

**Items, codes, lists, conditions (IB1, IB3, IB10, IB11)**
- IB-07 (IB1) When an item is created the manager must choose individual or counted. An individually tracked item has units, each with its own code and condition; a counted item has one count per condition and one code; the total of a counted item equals the sum of its counts.
- IB-08 (IB1) Once an item has any request line, its mode cannot be changed by UI or direct call.
- IB-09 (IB11) Codes have the form `INV-` plus at least four digits, are assigned by the database, are unique, increase, and are never reused, even after the unit or item is archived or lost. Two items created at the same moment get different codes. No screen or call lets anyone type or edit a code.
- IB-10 (IB10) Category and location lists start empty; Ops can add, rename and deactivate entries; nothing can be deleted; a deactivated entry stays on existing items.
- IB-11 (IB10) The condition list is exactly Baik, Perlu servis, Rusak and cannot be edited by anyone; only Baik is offered on a request form and only Baik units or quantity can be handed over.
- IB-12 (IB3) Every active member sees all active items in the one catalog, whatever unit or department holds them; no screen offers per-unit item ownership.
- IB-13 Archiving an item or unit with an open request line, or lowering its lendable stock under the reserved quantity, is refused; the message reveals no requester name.

**Requests (L9, IB4, IB5, IB6, IB7)**
- IB-14 Any active member can submit a request for active items within availability; the saved requester is the session member, never a client-supplied id.
- IB-15 P-PLAIN reads only their own requests, status, decision note and timeline; another member's request is not returned by the API (AC-27).
- IB-16 (IB4, IB5) A request starting today or tomorrow is accepted (no lead time), and a request spanning 90 days is accepted (no practical maximum; only the 365-day date cap of IB-51 applies). A request is rejected with a clear message when: no active period (AC-43), item archived or not in Baik, quantity above the free quantity, quantity below 1 or not a whole number, end before start, start before today (Asia/Jakarta), or the same item twice.
- IB-17 (IB7) The requester can cancel their own request while Diajukan; while Disetujui and not picked up, cancel works only with a reason; after Dipinjam no cancel exists. Another member cannot cancel it (AC-30). A cancelled request stays in history and cannot be reopened.
- IB-18 Members see availability counts and dates for an item but never who holds it.
- IB-19 (IB6) A Diajukan request does not reduce availability for others; a Disetujui or Dipinjam request does.

**Approval and extension (IB2, IB5, L6)**
- IB-20 (IB2) Only P-KADEP-OPS and a Kepala Divisi of Logistik or Akomodasi can approve, reject or extend; P-STAFF-LOG, a Staff in Akomodasi, a Sekretaris Departemen Operasional, P-STAFF-PUB and P-KETUM cannot, by UI or direct call.
- IB-21 Rejection without a note is refused; approval stores approver, time and note and writes a history row.
- IB-22 A head cannot approve, reject or extend their own request, even if a custom rule grants `borrowing.approve` (AC-57); another head can.
- IB-23 With only one head in office, that head's own request stays Diajukan and the hint appears; no override exists (B29).
- IB-24 Two approvals of overlapping requests that together exceed the free quantity cannot both succeed, including when sent at the same moment (R5).
- IB-25 (IB5) A head can extend an approved or borrowed request with a required note; the extension is checked for availability; each extension writes one extension history row (old date, new date, who, when, note); the status does not change; a non-head cannot extend.

**Handover and return (IB2, IB8, IB9)**
- IB-26 (IB2) Every Operations persona (head, staff, Sekretaris Departemen) can record handover and return; a non-Operations member cannot; recording one's own request's handover and return is allowed, and the history row names the recorder.
- IB-27 Handover quantity is at most the approved quantity; for an individually tracked item the handler selects specific units in Baik that are on no other open loan; one unit cannot be on two open loans.
- IB-28 Return per line must account for the whole outstanding quantity as baik, rusak or hilang; a partial return keeps the request Dipinjam; Dikembalikan is set only when all lines are closed.
- IB-29 (IB8) A good return needs no photo and no note. A rusak or hilang outcome without both a note and at least one photo is refused; photos are resized in the browser, stored in a private bucket, and served by short-lived signed URLs only to `borrowing.view_all` holders and the requester.
- IB-30 A damaged return moves that unit or quantity to the stated condition (Perlu servis or Rusak) and writes a history row linked to the request; a lost return writes the unit off (status Hilang, code kept) or reduces the counted total; nothing is deleted.
- IB-31 (IB8) No screen, field or export holds a deposit, fine or payment.
- IB-32 (IB9) No function deletes or replaces an evidence photo; the file and its record remain after the item or request is archived; the item form has no photo upload.

**Outside parties (IB15)**
- IB-33 Every Operations persona can record a request for an outside party with an organisation name and a contact person name (both required); no phone or email field exists; a non-Operations member does not see the option.
- IB-34 The recording member is the requester of record, sees it in "Peminjaman Saya", and cannot approve, reject or extend it; a head approves it; any Operations member (including the recorder) hands over and takes back.

**Overdue and dates**
- IB-35 A request that is Dipinjam with an end date before today (Asia/Jakarta) shows "Terlambat" to the requester, the queue, the work list and BPH; nothing is stored or sent. A test at 23:30 UTC (06:30 WIB next day) uses the Jakarta date.
- IB-36 An overdue line keeps blocking its quantity: a new request overlapping the day after the old end date cannot take it until it is returned.
- IB-37 Two ranges that share only one day are treated as overlapping.
**Edge cases**
- IB-38 After the active period switches, open requests keep their old period and can be processed by current holders (heads for approve/reject/extend, Operations for handover/return); P-OLD cannot (AC-42, L7). Closed requests of the old period are read-only; a current `borrowing.view_all` holder can read them; the requester reads their own.
- IB-39 When a requester is deactivated, their open requests remain, Operations can still record the return, their name still shows, nothing is deleted or auto-cancelled; they cannot sign in (AC-44, AC-45).
- IB-40 With no active period, requests cannot be created, the catalog stays readable, and a banner says so (R11, E4).

**Never delete, history and privacy**
- IB-41 No screen, function or direct call deletes an item, unit, request, line, history row, evidence photo record or export-log row; a direct delete with any persona's token, including P-ADMIN, is rejected. History tables accept inserts only through the server functions.
- IB-42 No response, screen or export contains email, phone, NIM or NIP of anyone; requester names come from PI-CORE only through `src/lib/picore/`; the only person-related text NEXUS stores is the outside party's organisation and contact person name.

**Export, log, Dashboard, notifications (IB12, IB13, IB14)**
- IB-43 P-STAFF-LOG, any Operations persona and P-KETUM see "Ekspor" for both lists; P-PLAIN and P-STAFF-PUB do not, and a direct export call with their token is refused. Excel, CSV and PDF each contain all rows matching the current filters, in screen order, with the same count as the screen, and dates in WIB.
- IB-44 (IB13) Each successful export writes exactly one log row with the module, the exporter's `members.id`, time, format, filters and period; a refused export, or one whose log write fails, writes none and returns no file; the row has no PII and cannot be updated or deleted.
- IB-45 (IB12) The Dashboard card shows counts and no percentage anywhere; it appears for every active member (D01); archived and lost entries are excluded; with no items it shows a neutral empty state.
- IB-46 (IB14) No email, push or WhatsApp is sent; "Peminjaman Saya" shows status, decision note, timeline and end date; no contact field exists on any request.

**Quality**
- IB-47 At 390 px width every screen of this module works without horizontal page scroll; fields are at least 44 px high with 16 px text (D-017).
- IB-48 A pgTAP test per persona proves RLS: zero rows for denied users on requests, lines, returns, evidence, history and export log; the availability function returns counts only; every `nexus` table of this module has RLS enabled. The same request cannot be approved or returned twice: the second action fails with "Data sudah berubah" and the history has one row.

**Follow-up criteria (owner decisions of 2026-11-07, section 11c)**
- IB-49 A member with 5 requests in status Diajukan cannot submit a sixth, by UI or by a direct call; after one is decided or cancelled they can. Requests in Disetujui or Dipinjam do not count [A-IB49].
- IB-50 A member who has created 20 requests on one Jakarta day cannot create a 21st that day; the count restarts on the next Jakarta day (a request saved at 23:30 UTC belongs to the next Jakarta day). An outside-party request recorded by an Operations member counts toward the recorder's caps, not toward any other person.
- IB-51 A request whose end date is later than start date + 365 days is refused; start + 365 days is accepted. An extension is refused when the new end date is later than the ORIGINAL start date + 365 days, whatever earlier extensions did. The message tells the user to make a new request.
- IB-52 After a return of a unit or quantity in good condition is recorded, the next free-quantity check counts it as available at once, including for a request whose range contains today or the original end date.
- IB-53 A return can be corrected only by a `borrowing.handle` holder, with a reason, only once per request; a second correction is refused. The correction is refused when the stock of the item changed since the return. No function corrects a handover.
- IB-54 Restoring a written-off (Hilang) unit works for a holder of `inventory.manage` and only when the item is active; a holder of `borrowing.handle` without `inventory.manage` is refused; a restore on an archived item is refused; a reason is required and the original write-off history row stays.
- IB-55 Over-long input is refused by the database even when the page is bypassed: item name above 120, description above 1000, purpose or notes above 500, category above 60, location above 80, outside-party organisation or contact name above 120 characters; stock below 0 or above 9999 in any condition; more than 50 lines in a request; more than 200 units in a line.
- IB-56 A damaged or lost outcome accepts 1 to 3 photos, each at most 1.5 MiB and of type JPG, PNG or WebP; a fourth photo, a larger file or another type is refused; more than 10 unattached uploads in one request folder within 24 hours are refused (older unattached uploads no longer count, migration 20261109100000). Photos are in the private bucket `nexus-borrowing-evidence` and are readable only through signed URLs by `borrowing.view_all` holders and the requester.
- IB-57 After the DB-layer migrations are applied, the permission catalog has 22 keys, the default rules are 35 enabled plus 1 retired (D30), and "restore default access rules" does not re-enable D30 (access control AC-77).

---

## 11b. Design decisions (2026-11-07)

From the design review of `docs/design/inventory-borrowing.md` (section 23): stock changes only through reasoned dialogs (P6); request reference `PJM-0001` (one sequence, never reused, set by the database); optional "Tersedia pada tanggal" catalog filter backed by a bulk availability function; Dashboard card "{n} unit baik, {m} di antaranya sedang dipinjam" + "{k} perlu servis". Further design assumptions: A-IB37..A-IB46 (`docs/OPEN_QUESTIONS.md` section H). A-IB24 (request reference format) is answered by `PJM-0001`.

## 11c. Owner decisions of 2026-11-07 (follow-up, recorded in D-022)

Taken after the DB layer was written. They replace or sharpen earlier wording; where this section and an earlier section disagree, this section wins.

| Topic | Decision |
|---|---|
| Open requests | At most 5 open (Diajukan) requests per member [A-IB49: Diajukan only] |
| Daily cap | At most 20 new requests per member per Jakarta day |
| Outside parties | Requests recorded for an outside party count toward the recorder's caps |
| Date cap | `end_date` is at most `start_date` + 365 days. Extensions are counted from the ORIGINAL start date; a longer loan needs a new request |
| Return frees stock | A returned item is free again immediately (replaces "free from D+1" in A-IB18) |
| Correction | Only for returns; only once per request; refused if the stock changed since the return. No handover correction |
| Restore a written-off unit | Needs `inventory.manage` and an active item (tech lead decision after the security review; replaces `borrowing.handle` in A-IB45) |

**Field limits (A-IB43)**

| Field | Limit |
|---|---|
| Item name | 120 characters |
| Item description | 1000 characters |
| Request purpose and notes (all notes) | 500 characters |
| Category | 60 characters |
| Location | 80 characters |
| Outside-party organisation and contact person names | 120 characters each |
| Stock | 0 to 9999 per condition |
| Lines per request | at most 50 |
| Units per line | at most 200 |
| Photos per damaged or lost outcome | 1 to 3, each at most 1.5 MiB, JPG, PNG or WebP |
| Unattached uploads | at most 10 per request folder (uploads never attached to a saved return, A-IB39) |

Note on IB5: the owner's "no maximum duration" is kept; the 365-day cap is a technical guard against typing errors and runaway extensions, not a business limit on normal loans.

---

## 12. Questions and owner answers (record)

All answered by the owner on 2026-11-07 (D-022). Each answer is tagged under its question; the options and my original recommendation are kept as the record.

**IB1. Quantity-based or individually tracked items?** (shapes the whole data model) **[ANSWERED 2026-11-07: (d) hybrid]** Each item is either individually tracked (one row per unit, own condition) or quantity-based (count per condition); Ops picks the mode when creating the item. [ASSUMPTION A-IB25] The mode cannot be changed after the item has any borrowing history (create a new item instead).
- (a) Quantity only, one condition per item row: split into two rows when conditions differ ("Stand Mic Boom" and "Stand Mic Boom (servis)"). Simplest.
- (b) Quantity with a count per condition: total = baik + servis + rusak.
- (c) Every physical unit is its own record (own code, own history).
- (d) Hybrid: each item chooses "counted" or "individual".
- **Recommendation: (b).** Matches Stitch (a row of 4 units where some need servis) and the damaged/lost returns, without typing every cable. Individual units (c/d) can be added later by adding a units table. Section 4 assumes (b).

**IB2. Who may approve and hand over?** **[ANSWERED 2026-11-07: (b)]** Only heads approve or reject: Kepala Departemen Operasional and the Kepala Divisi of its divisions. Any Operations holder hands over and takes returns. Needs a catalog change: split `borrowing.approve` (heads) from a new key for handover/return (all Operations), and new default rules using unit Operasional + child units + position limit (one rule per head position). Access-control spec and migration to be amended. Sub-question A-IB1 answered (owner, 2026-11-07): L6 blocks only approve/reject of your own request; recording handover and return of your own request is ALLOWED. Risk noted: a holder could record their own return falsely; the history shows who recorded it.
- (a) Any Operations holder (default D30, current).
- (b) Only Kepala Departemen and Kepala Divisi approve; staff hand over and take returns. Needs a catalog change: a separate key, because A-n7 puts both in `borrowing.approve`.
- (c) One named coordinator (Stitch's "Koordinator"): not possible, no individual rules (L10), and it is B29's single-approver trap.
- **Recommendation: (a)** with L6, the history and the "self-benefit" log. Revisit if misuse appears. Sub-question: A-IB1 (own request also blocked for handover and return): yes?

**IB3. What does the catalog cover and who owns items?** **[ANSWERED 2026-11-07: (a)]** One catalog for everything PMK owns, managed by Operations.
- (a) Everything PMK owns, one catalog, managed by Operations.
- (b) Operations items only; other departments keep their own lists elsewhere.
- (c) Each department manages its own items: not possible with the current keys (scope "all" only).
- **Recommendation: (a).**

**IB4. Is there a lead-time rule ("H-3", C7)?** **[ANSWERED 2026-11-07: (a)]** No lead time; Stitch's H-3 is filler.
- (a) No lead time.
- (b) Yes, a fixed number of days before the start date (the owner gives the number).
- (c) Lead time only for some items (needs an item flag).
- **Recommendation: (a) at first, (b) if the owner confirms H-3** (Stitch's H-3 is filler, [UNKNOWN]). If (b), the form blocks late requests and the date check uses Jakarta dates.

**IB5. Maximum loan duration and extension?** **[ANSWERED 2026-11-07: (c)]** No maximum; Ops may extend the end date with a note. [ASSUMPTION A-IB26] Extending is an approval-type action, so it needs the heads' approve key (IB2), is blocked on your own loan (L6), and is checked against availability like a new approval.
- (a) No limit; Ops decides at approval.
- (b) Maximum number of days (value from the owner), enforced on the form.
- (c) (a) plus Ops may extend the end date with a note.
- **Recommendation: (a) plus extension by Ops (A-IB10).** Hard limits invented now would be guesses.

**IB6. When does a request hold stock?** **[ANSWERED 2026-11-07: (a)]** Only after approval; Ops sees a warning about overlapping pending requests.
- (a) Only after approval (default here, A-IB19).
- (b) From submission (first come first served; a pending request can block others).
- **Recommendation: (a)** with a warning on overlapping pending requests.

**IB7. May the requester cancel after approval but before pick-up?** **[ANSWERED 2026-11-07: (a)]** Yes, with a reason. L9 text to be widened accordingly (access-control amendment).
- (a) Yes, with a reason (A-IB9).
- (b) No, only before processing (strict L9 text); Ops cancels on request.
- **Recommendation: (a).** It only frees stock; confirm it widens L9 slightly.

**IB8. Return check: deposit, photo, consequences?** **[ANSWERED 2026-11-07: (b)]** Good returns: tick plus optional note. Damaged or lost: note AND photo required. No deposit tracking in NEXUS.
- (a) None: note only.
- (b) Optional photo, and a photo and note required only for damaged or lost.
- (c) Photo always at handover and at return.
- (d) A deposit (money or ID card). NEXUS would not track it (Finance is separate); the physical practice stays outside the app.
- **Recommendation: (b), no deposit tracking in Phase 1.** [UNKNOWN] whether PMK takes deposits or asks borrowers to replace lost items.

**IB9. Item photos (free-tier impact)?** **[ANSWERED 2026-11-07: (a)]** No catalog photos. Photos exist only as evidence for damaged/lost returns (IB8), resized in the browser before upload, kept (evidence, never purged).
- (a) No photos.
- (b) One optional photo per item, resized in the browser (long side about 1280 px, 1 MB maximum).
- (c) (b) plus handover/return photos (IB8).
- Storage: Supabase free tier is about 1 GB (`docs/OPEN_QUESTIONS.md` C9; verify before launch). Unresized phone photos are 3-5 MB; 50 items at 300 KB is about 15 MB; 100 loans a year with 2 photos at 300 KB is about 60 MB a year. The risk is mostly unresized photos and minutes attachments sharing the same 1 GB. Replacing a photo: does the old file stay (L5 spirit) or get purged to save space?
- **Recommendation: (b) now, (c) only for damaged/lost, purge old item photos on replacement** (they are catalog pictures, not evidence); owner confirms.

**IB10. Categories, locations and conditions: which values?** [UNKNOWN] No source lists them. **[ANSWERED 2026-11-07: (b)]** Categories and locations are lists Ops maintains (add, rename, deactivate), starting empty. Conditions (fixed, owner 2026-11-07): Baik, Perlu servis, Rusak; only Baik is lendable; lost = write-off, not a condition (A-IB23 confirmed).
- (a) Free text per item.
- (b) Lists that Ops maintains (add, rename, deactivate), starting empty; the owner supplies the first values.
- (c) Fixed lists set by the developer.
- Conditions need a short fixed list either way; proposal for discussion: Baik, Perlu servis, Rusak (Stitch shows "Baik", "Servis"). Lost items are a write-off, not a condition.
- **Recommendation: (b) for categories and locations; fixed condition list (A-IB23).**

**IB11. Item codes (Stitch 13: "Inv-001/LOG")?** [UNKNOWN] numbering rule. **[ANSWERED 2026-11-07: (c)]** Automatic code `INV-0001`: one sequence, never reused, assigned by the database. Individually tracked items: one code per unit; quantity-based items: one code per item. [ASSUMPTION A-IB27] Archived items keep their code; numbers beyond 9999 simply grow (INV-10000).
- (a) None: name and location identify an item.
- (b) Optional free-text code, unique when filled.
- (c) Automatic code in a format the owner defines.
- **Recommendation: (b)** until the owner supplies a format (same caution as letter numbering).

**IB12. Dashboard "Inventaris Status 80%" (CLAUDE.md Q7, A7): what does it measure?** [UNKNOWN] **[ANSWERED 2026-11-07: (d)]** No percentage. The card shows counts, e.g. "42 unit baik · 5 dipinjam · 3 perlu servis" (exact wording at design time). Answers CLAUDE.md Q7: the Stitch percentage is dropped (design deviation approved by the owner).
- (a) Share of units in good condition: good / total (excluding archived and lost). Stable over time. Matches "Terawat" and Stitch 13 "Kondisi Baik".
- (b) Share of units ready to use now: good and not on loan. Matches "Barang Siap Pakai" but moves with every loan.
- (c) Share of items that have at least one good unit (counts item rows, not units).
- (d) No percentage: show "x dari y unit sedang dipinjam / z perlu servis".
- **Recommendation: (a)**, caption "Kondisi baik", with loans shown separately. Stitch itself is inconsistent (83% in 12, 91% in 13). Card visible to every active member (D01, A-n1).

**IB13. Are exports logged?** **[ANSWERED 2026-11-07: (c)]** Logged now (append-only, no PII), same pattern as Member Data; the reading screen comes later together with the Member Data log screen (A-MD14).
- (a) No log (not sensitive).
- (b) Log, with a screen readable by System Admin and BPH through a new catalog key (catalog change).
- (c) Log written now (append-only, no PII), readable only via the database until a screen is approved (same state as Member Data A-MD14).
- **Recommendation: (c).**

**IB14. Notifications and contacting borrowers?** **[ANSWERED 2026-11-07: (a)]** In-app status only; contact happens outside NEXUS. Email notifications may come in a later phase.
- (a) In-app status only (section 7); contacting borrowers happens outside NEXUS (L4 forbids PI-CORE phone/email).
- (b) Add an optional "kontak" field on the request, typed by the requester (stores personal data in NEXUS).
- (c) Email notifications in a later phase.
- **Recommendation: (a) for Phase 1.** Raise (c) when the owner sees how often requests wait.

**IB15. May people outside PMK borrow (other campus groups, churches)?** **[ANSWERED 2026-11-07: (b)]** Ops may create a request on behalf of an outside party. [ASSUMPTION A-IB28] The request stores the outside party's organisation name and a contact person name only (no phone/email in NEXUS; contact happens outside the app); the Ops member who records it is the requester of record, so L6 blocks them from approving it; any Operations holder may record one; it then follows the normal approval by a head. Approved by the owner as written (2026-11-07).
- (a) No: members only; the member who arranges it requests and is responsible; the outside party is named in the free "Keperluan" text.
- (b) Ops creates requests on behalf of an outside party (needs a "requested for" field and a rule for L6).
- (c) A separate outside-borrower list with contact details (personal data stored in NEXUS).
- **Recommendation: (a).**
