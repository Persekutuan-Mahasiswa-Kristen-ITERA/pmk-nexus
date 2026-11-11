# PMK-NEXUS: Project Context

> Reference document for the PMK-NEXUS project. Written in English for the AI assistant. The project owner communicates in Indonesian.
> Status legend: **[DECIDED]** = final decision, **[ASSUMPTION]** = needs confirmation, **[PLANNED]** = future work, **[UNKNOWN]** = information still missing.
> Last updated: 2026-11-11 (Finance and Meeting Minutes built and tested locally, sections 5.3 and 5.4 status lines). Earlier: 2026-11-09 (Finance and Meeting Minutes decided, D-028 and D-027: sections 4, 5.1, 5.3 and 5.4 rewritten). Earlier: 2026-11-09 (Letters amendment "Ambil nomor" and design approval, D-025: section 5.5 and section 8 item 8). Earlier: 2026-11-09 (Letters decided, D-025: section 5.5 rewritten, section 8 items 4, 6, 8 updated). Earlier: 2026-11-09 (section 5.6 marked implemented on the local stack). Earlier: 2026-11-07 (Inventory and Borrowing decided, D-022: sections 4, 5.1, 5.6, 6, 8 updated). Earlier: 2026-11-07 (section 5.2 marked implemented on the local stack). Earlier: 2026-11-06 (sections 2, 4, 5.1, 5.2 and 8 updated for Member Data, D-019; section 6 replaced by the Stitch design, D-014; section 8 item 12 answered). Earlier: 2026-11-05 (sections 2, 3, 4, 7, 8, verified PI-CORE schema).

---

## 1. Project Overview

**Name:** PMK-NEXUS (sometimes written "PI-NEXUS" in PI-CORE documents; these refer to the same system. The name is still to be unified.)

**Organization:** PMK ITERA (Persekutuan Mahasiswa Kristen, Institut Teknologi Sumatera), a Christian student fellowship at a university in Indonesia.

**Purpose:** Be the integrated control center for all administrative and operational processes of PMK ITERA.

**Primary users:** The operations division and the administration division (secretary, treasurer), plus the board (BPH), department heads, staff, committee members, and regular members.

**Project owner profile:** A student who is still learning software development. Explanations must be simple and include reasons, not only answers.

### What the system helps with
- **Operations:** managing inventory items, managing item borrowing, and everything related to PMK operations.
- **Administration:** incoming and outgoing letters, letter storage/archive, letter requests, meeting minutes, finance records, and member data.

### Future vision [PLANNED]
Program of work (progja) management. Not part of Phase 1, but the architecture must not block it.

---

## 2. Ecosystem and PI-CORE

NEXUS is one application in an ecosystem centered on **PI-CORE**.

**PI-CORE** is the digital master ledger of the organization. It records who the members are, what their positions are, in which management period, and who may manage the system. Other apps (NEXUS and later ones) should *ask* PI-CORE instead of keeping their own member lists.

Analogy: PI-CORE is the HR department plus the access-card system of a building. Other apps are the rooms that check the card.

### PI-CORE core concepts (original conceptual design; see "Real PI-CORE schema" below for what is actually built)

| Concept | Meaning |
|---|---|
| Member | A person with an account and a profile |
| Role | Category of management: BPH, Department Head, Secretary, Treasurer, Staff, Committee |
| Position | Specific title within a role, e.g. "Ketua Umum" (Chairperson) |
| Period | Management year, e.g. 2026/2027. Only one is active at a time |
| Assignment | Binds a member to a role and position in a period |

Examples:
- Grace has the assignment "BPH, Ketua Umum, 2026/2027".
- Daniel can have two assignments at once, e.g. "Staff" and "Committee" in the same period.
- Assignments belong to a period, so history is preserved when management changes.

### Real PI-CORE schema [DECIDED: verified 2026-11-05]

Source: PI-CORE repo `/home/fycode/Documents/pi-core-v2`, migrations folder (5 migrations). Full report: `docs/picore/schema-report.md`. Re-check it whenever PI-CORE adds a migration.

| Concept | How PI-CORE really stores it |
|---|---|
| Member | Table `public.members`. Linked to login by `user_id` -> `auth.users`. Has `access_level`, `is_active`, `member_type` (`student` / `lecturer`), plus sensitive fields `email`, `phone`, `nim`, `nip`. |
| Org unit (new) | Table `public.org_units`, a tree: root `PMK ITERA` -> `BPH PMK ITERA`, 7 departments, 1 bureau (`Biro Kewirausahaan`); 16 divisions sit under the 7 departments (the bureau has no divisions). Types: `organization`, `bph`, `department`, `bureau`, `division`. No stable key column; units are identified by name. |
| Position | Table `public.positions`. A title tied to an org unit TYPE (e.g. Ketua Umum for `bph`, Kepala Departemen for `department`, Staff for `division`), with a `rank`. No link to a single role. |
| Role | Table `public.roles`. A capability bundle with a stable `key`: `organization_admin`, `bph`, `bendahara`, `kepala_departemen`, `sekretaris`, `kepala_divisi`, `staff`. Linked many-to-many to positions through `public.position_roles`. There is **no** Committee (panitia), regular member (anggota), or "Operations" role. |
| Period | Table `public.periods`. Label like `2026/2027`. `is_active = true` for at most one row (enforced by the database). Switched only by admin RPC `public.set_active_period()`. |
| Assignment | Table `public.assignments` = member + org unit + position + period. Roles are derived through the position, not stored. A member may hold several assignments in one period. Lecturers cannot hold assignments. |
| Member status | Only `is_active` (active / inactive) + `deactivated_at`. Deactivated members are also blocked from logging in. Members are never deleted. |

Example: Grace holds "Ketua Umum" in unit "BPH PMK ITERA" for period 2026/2027. That position carries roles `bph` and `organization_admin`.

### Two separate kinds of rights (never mix them)
1. **System access:** who may manage the system (Admin or regular Member).
2. **Organizational position:** BPH, Treasurer, etc.

**Important difference:** inside PI-CORE, some positions automatically make someone a PI-CORE admin (role `organization_admin` on Ketua Umum, Sekretaris Jenderal, Sekretaris Umum 1/2, Kepala Departemen, Kepala Biro). **NEXUS does not follow this.** [DECIDED 2026-11-05, D-007] In NEXUS, being Chairperson (or any position) never makes someone a system admin. NEXUS System Admin = PI-CORE `members.access_level` set by hand to `admin` or `super_admin`, and the member is active.

### PI-CORE workflow
1. Admin creates a period, then roles.
2. Admin creates member accounts. No public sign-up. Members get an invitation or temporary password, then set their own password.
3. Admin creates assignments (member + role + position + period).
4. Members log in with email and password and see only their own profile and assignments.
5. Admin monitors via dashboard (member count, active period, role count).
6. On management change, admin creates a new period and activates it. Old data stays as history. Members who leave are deactivated, not deleted.

### PI-CORE security
- Login is handled by **Supabase Auth**. Accounts are created by PI-CORE admins (no public sign-up).
- Every action is checked on the server, not only hidden in the UI.
- The database has its own access rules (**Row Level Security, RLS**) on every table. Nothing is granted to anonymous users.
- A regular member can read only their own member row and assignments, plus the active period, org units, and positions. Admins can read everything.

### Important caveats about PI-CORE
- The PI-CORE **Integrations** module (an official way for other apps to query PI-CORE) is intentionally **not built yet** in the MVP.
- Because regular members cannot read the member list, NEXUS needs its own carefully restricted read functions to show Member Data (see section 4 and `docs/OPEN_QUESTIONS.md` B9, B11).
- PI-CORE's schema already changed once (roles, positions, and assignments were replaced). All NEXUS reads stay in `src/lib/picore/` so a change touches one place.

---

## 3. Architecture Decisions

| Topic | Decision |
|---|---|
| Data storage | **[DECIDED]** Supabase (Postgres), in the **same Supabase project as PI-CORE** (MVP option). Google Sheets is NOT used as primary storage. |
| Login | **[DECIDED]** Supabase Auth of PI-CORE. One account for all apps. NEXUS builds no login system of its own and has no public sign-up. |
| Member data | **[DECIDED]** NEXUS does not store its own member list. The Member Data page shows PI-CORE data, read-only. |
| Schema separation | **[DECIDED]** NEXUS tables live in a separate schema (e.g. `nexus`). NEXUS must never change PI-CORE tables or data. PI-CORE data is accessed read-only through views or functions. |
| File attachments | **[DECIDED]** Supabase Storage with private buckets. Paths are stored in tables. |
| Export | **[DECIDED]** Main tables can be exported to Excel/CSV/PDF, so non-technical officers can still read data like a spreadsheet. |
| Future path | **[PLANNED]** When PI-CORE builds Integrations (official API), migrate NEXUS reads from direct DB access to that API. To make this easy, all access to PI-CORE data must live in one single layer (one module/set of functions). |
| Frontend/backend stack | **[DECIDED]** Next.js (App Router) + TypeScript + Tailwind CSS + shadcn/ui, with `@supabase/supabase-js` and `@supabase/ssr`. Hosting: Vercel free tier (frontend) + Supabase. Reason: popular, well documented, free to start, works smoothly with Supabase. A mobile-first web app (installable as a PWA later) needs no app store and is easy to hand over. |
| Reading PI-CORE | **[DECIDED]** Only from `src/lib/picore/` in the app. In the database, only through views or functions in schema `nexus`. NEXUS does not call PI-CORE's internal `private.*` functions. **[DECIDED]** (D-010) NEXUS builds its own restricted SECURITY DEFINER read functions in schema `nexus`; they never return email, phone, NIM, or NIP. PI-CORE is not changed. |
| API exposure of `nexus` | **[UNKNOWN]** The shared Supabase project currently exposes only `public` and `graphql_public` (per PI-CORE local config). Schema `nexus` must be added to "Exposed schemas" before the app can query it. This setting is shared with PI-CORE. |

### Why not Google Sheets?
It was considered first (free, easy for non-technical officers). Rejected because PI-CORE already uses Supabase, and Postgres gives relations, validation, RLS, and no risk of manual edits overwriting data. Sensitive finance data benefits most. The "readable like a spreadsheet" need is covered by exports.

### Known risk
Sharing one Supabase project with PI-CORE means a NEXUS mistake (e.g. wrong RLS config) could affect PI-CORE data. Mitigations: separate schema, read-only access to PI-CORE, careful RLS, backups. If NEXUS grows, consider a separate project with an API.

---

## 4. Access Control

**[DECIDED 2026-11-05, D-011] The table below is the DEFAULT rule set, not a fixed rule.** NEXUS stores access rules in schema `nexus`; the System Admin can change which PI-CORE role, position, or org unit gets which permission (never individual members). Safety rules (no access for inactive members, no PII, no permanent delete, no self-approval, System Admin only from `access_level`) are locked. Full spec: `docs/modules/access-control.md`.

Access is computed from the user's **assignments in the active period** of PI-CORE (table `assignments` joined to the period with `is_active = true`), except System Admin, which comes from `members.access_level`. Only **active** members (`members.is_active = true`) get any access.

| NEXUS group | How it maps to the real PI-CORE schema | NEXUS access | Status |
|---|---|---|---|
| System Admin | `members.access_level` in (`admin`, `super_admin`), set by hand. Positions never grant it. | Manage the system | **[DECIDED]** D-007 |
| Treasurer (Bendahara) | Active-period assignment whose position carries role `bendahara` (Bendahara Umum 1 / 2) | Manage Finance (record, void, correct; never edit a saved entry) | [ASSUMPTION] B3; Finance rules **[DECIDED]** D-028 |
| BPH Secretary | Positions Sekretaris Jenderal, Sekretaris Umum 1 / 2 (they carry `bph` + `organization_admin`, not `sekretaris`) | Manage ALL Letters (incl. numbering, archive, letter requests) and ALL Meeting Minutes | **[DECIDED]** D-008; identified through the NEXUS mapping table (D-009) |
| Department / bureau secretary | Role `sekretaris` (Sekretaris Departemen, Sekretaris Biro) | Manage Meeting Minutes of their OWN org unit only; submit letter requests like other members | **[DECIDED]** D-008; reading rights [ASSUMPTION] B17 |
| Operations (any position) | Active-period assignment in org unit `Departemen Operasional` or its divisions `Logistik` / `Akomodasi` (Kepala Departemen, Sekretaris Departemen, Kepala Divisi, Staff). No "Operations" role exists. | Manage Inventory; record borrowing handover and return and outside-party requests (`borrowing.handle`); export | **[DECIDED]** D-009 (units), D-022 (positions, B4 answered 2026-11-07) |
| Operations heads (Kepala Departemen Operasional, Kepala Divisi of Logistik / Akomodasi) | Same unit, limited to those two position names | Approve, reject and extend borrowing (`borrowing.approve`); never on their own request (L6) | **[DECIDED]** D-022. Access-control rules D34, D35; in migration `20261107100000` (not yet on hosted) |
| BPH (board) | Role `bph` (Ketua Umum, Sekretaris Jenderal, Sekretaris Umum 1 / 2, Bendahara Umum 1 / 2) | View all modules (incl. Member Data view and export) | [ASSUMPTION] B6; Member Data part **[DECIDED]** D-019; Finance part (all six BPH read and export) **[DECIDED]** D-028 |
| Department / bureau heads | Role `kepala_departemen` (Kepala Departemen, Kepala Biro) | View the Member Data list (no export); read the Meeting Minutes of their own unit (read only, no export) | **[DECIDED]** D-019 (default rule D32); D-027 (default rule D37) |
| Staff, regular members | Any active member: with role `staff` / `kepala_divisi` / others not listed above, or with no assignment at all in the active period | Limited access; can request item borrowing and letters | [ASSUMPTION] B8 |
| Committee (panitia) | Not in PI-CORE | n/a | **[UNKNOWN]** B7 |
| Lecturers (pembina) | `member_type = 'lecturer'`; cannot hold assignments | n/a | **[UNKNOWN]** B15 |

Rules:
1. Enforce permissions on the server and in the database (RLS), not only in the UI.
2. Access follows the active period, so it changes automatically when management changes.
3. A person may have multiple assignments; combine their permissions.
4. Finance and member data are sensitive. NEXUS never shows a member's email, phone, NIM, or NIP unless the owner approves it (`docs/OPEN_QUESTIONS.md` B9).
5. Prefer deactivating or archiving over permanent deletion, to keep history across periods.
6. Match PI-CORE roles by their stable `key` (e.g. `bendahara`), never by display name. Positions and org units without a key (BPH secretaries, Operations unit) are matched by ID through a NEXUS settings table that the System Admin maintains (D-009).

---

## 5. Phase 1 Features

Based on the original Figma screens; visual design now follows Stitch (section 6, D-014).

### 5.1 Dashboard
- Finance card [DECIDED 2026-11-09, D-028]: Total Saldo, Pemasukan and Pengeluaran of the active period, no percentage or growth badge; shown only to `finance.view` holders (the Stitch placeholder Rp 999,999,999 is filler).
- Recent Meetings (Notulensi Rapat) [DECIDED 2026-11-09, D-027, N5 a]: counts and the date of the latest meeting, no titles and no statuses (the Stitch "Rapat Koordinasi 2026-07-17" and "Selesai/Terjadwal/Mendatang" are filler); limited to the minutes the user may read; shown only to `minutes.view` holders.
- Members: member count (from PI-CORE): all members with `is_active = true`, students and lecturers. Shown only to users with `member_data.view` (D-019).
- Inventory Status [DECIDED 2026-11-07, D-022]: NO percentage (the Stitch/Figma "80%" is dropped). The card shows counts, for example units in good condition, units on loan, units needing service (exact wording at design time). Shown to every active member (baseline `inventory.view`).
- Letters (Surat Menyurat) [DECIDED 2026-11-09, D-025, L11]: counts only (no letter subjects or counterparts), for `letters.view` holders; processors also see how many requests wait for them.

### 5.2 Member Data (Data Anggota) [DECIDED 2026-11-06, D-019] [IMPLEMENTED 2026-11-07, local stack only]
Full spec: `docs/modules/member-data.md` (section 12 lists where the code lives). Built and tested locally; the migration is not yet applied to the hosted project. Not built: the Dashboard "Members" card and a screen to read the export log.
- Read-only view of PI-CORE (no add, edit, or delete; no row detail screen).
- Table columns: No, Nama Lengkap (lecturers carry a small "Pembina" marker), Unit / Jabatan (the member's PRIMARY active-period assignment: line 1 unit, with a division written after its department; line 2 position; "-" when none), Status (Aktif / Nonaktif from `members.is_active`).
- Primary assignment = lowest `positions.rank`; tie-break by top-level unit order first (a division uses its parent department's `sort_order`), then division order, unit name, position name [DECIDED 2026-11-06, A-MD8].
- Search: name only (never NIM, email, phone). Filters: Unit (matches any active-period assignment [ASSUMPTION]) and Status (default Aktif; Nonaktif and Semua selectable). Pagination (Prev, 1, 2, 3, Next), server side.
- Always the active period. Shows every member, with or without an assignment.
- Access: view = role `bph` and role `kepala_departemen` (Kepala Departemen and Kepala Biro); export (Excel, CSV, PDF through one "Ekspor" button) = BPH only. Every export is logged in an append-only table (who, when, format, filters; no PII).
- Never shown: email, phone, NIM, NIP.

### 5.3 Finance [DECIDED 2026-11-09, D-028] [BUILT 2026-11-11, local only]
Status 2026-11-11: database, server layer and screens are built and tested on the local stack only (pgTAP 328, end to end 51; `docs/qa/finance.md`); nothing applied to hosted. Open: a human click-through at 390 px, then the owner's approval with a backup.
Full spec: `docs/modules/finance.md` (approved 2026-11-09, owner accepted all recommendations K1-K6). All amounts, bank accounts, badges and notes in Stitch are filler. Owner approval (after a backup) and a closed security review are required before anything touches the hosted project.
- **Totals per period:** Total Income (Total Pemasukan), Total Expenses (Total Pengeluaran), Total Balance (Total Saldo). Computed by the database from the entries, never stored or typed. Voided entries count in nothing.
- **Transactions:** Pemasukan, Pengeluaran and one "Saldo awal" per period; whole rupiah (integer, never floating point, never negative); Pemasukan and Pengeluaran are Rp 1 to 9.999.999.999, **Saldo awal may be Rp 0** [DECIDED 2026-11-10, owner, A-FN1; debt is not recorded as a negative opening]; fields Jenis, Tanggal, Jumlah, Keterangan, optional Catatan; automatic number `KAS-0001`; each entry tied to the active period. Table: Date (Tanggal), Description (Keterangan), Amount (Jumlah), plus type, number and a paperclip.
- **Corrections (K2 a):** a saved entry is never edited. A mistake in the active period is voided with a reason and re-recorded ("Catat ulang"); a mistake in an old period is corrected by a new linked entry in the active period ("Koreksi atas {nomor}"). Old periods are read-only (L7).
- **Carry-over (K3 a):** the Treasurer types "Saldo awal" once per period after counting the real cash and bank money; the screen shows the previous closing balance as a hint ("Pakai angka ini"), never as a silent prefill. This also covers go-live (history before NEXUS stays outside it).
- **One cash pool (K4 a):** no account field; bank or cash detail goes into Keterangan.
- **Proof (K5 a):** optional receipt or transfer slip (PDF, JPG or PNG, 5 MB, up to 3, private bucket); entries without proof carry a "Tanpa bukti" mark and a filter.
- **No second-person check (K6 a):** either Treasurer records and voids; the append-only history shows who.
- **Access:** read and export = all six BPH (K1 a); record, void and proof = the two Bendahara Umum (`finance.manage`). The System Admin without a BPH or Treasurer position sees nothing (B18). Export (Excel, CSV, PDF, logged, formula-safe).
- **Known risk (B37):** a PI-CORE position-derived admin can self-assign as Treasurer and NEXUS then grants Finance; to be raised with the PI-CORE maintainer before go-live.

### 5.4 Meeting Minutes (Notulensi Rapat) [DECIDED 2026-11-09, D-027] [BUILT 2026-11-11, local only]
Status 2026-11-11: database, server layer and screens are built and tested on the local stack only (pgTAP 255, end to end 51; `docs/qa/minutes.md`); nothing applied to hosted. Open: a human click-through at 390 px, then the owner's approval with a backup.
Full spec: `docs/modules/meeting-minutes.md` (approved 2026-11-09, owner accepted all recommendations N1-N7). Stitch sample values, "Simpan Draft" and the schedule statuses are filler.
- **Form fields:** Date, Meeting Title, Topic, Minutes Content, Decision (optional), attachments, **plus the owning Unit** (added because D-008 scopes minutes by unit; the Stitch form had none). Every minute belongs to exactly one unit, fixed after saving, and to the active period.
- **Unit list (N2 c):** BPH PMK ITERA, the departments, the bureau, and "Seluruh organisasi" for plenary meetings (readable by BPH only). Divisions are not offered; their meetings are recorded under the department.
- **No draft, no schedule (N3 a, N4 a):** a manager edits an Aktif minute of the active period (history row with before and after) or voids it with a reason; there is no meeting agenda or status.
- **Attachments (N6 a):** PDF, JPG or PNG, 5 MB each, up to 3 per minute, private bucket (same as Letters).
- **Access:** record, edit, void = BPH secretaries (all units) and department/bureau secretaries (own unit); read = BPH (all), secretaries (own unit) and, new default rule D37, Kepala Departemen and Kepala Biro (own unit, read only) (N1 b); export = BPH and secretaries (own unit), logged.
- **Storage (N7 a):** shares the free-tier 1 GB with letters, finance proofs and borrowing evidence; real usage is checked at every period handover and the owner is warned at 70%.

### 5.5 Letters (Surat Menyurat) [DECIDED 2026-11-09, D-025] [BUILT 2026-11-10, QA in progress, local stack only]
Status 2026-11-10: database, server layer and screens are built; QA record in `docs/qa/letters.md`; the security review found no CRITICAL or HIGH finding (`DECISIONS.md` D-025, `OPEN_QUESTIONS.md` F11); nothing applied to hosted.
Full spec: `docs/modules/letters.md` (approved); design: `docs/design/letters.md` (approved 2026-11-09, one revision pending for "Ambil nomor"). The sample values in Stitch (Direktorat Jenderal Pajak, statuses like Verifikasi or Disposisi) are filler.
- **Register:** tabs Incoming Letters (Surat Masuk) and Outgoing Letters (Surat Keluar). Each item shows the letter number, counterpart party, subject (Perihal), dates, files, and status Aktif or Dibatalkan (void). No other workflow status (L5). NEXUS only registers and archives finished letters: it does not generate documents and does not handle signing (L1); sample official formats (A4) are not needed in Phase 1.
- **Numbering [DECIDED, provisional, D-024]:** incoming `PMK/NEX/SM/{year}/{seq}`, outgoing `PMK/NEX/SK/{year}/{seq}`, seq three digits; the format is a setting, not code. [ASSUMPTION, A2/C6] assigned by the system, restarts every calendar year, one sequence per type, never reused. At go-live the System Admin sets the next sequence once; old letters are registered with their original number marked "Nomor lama" (L7).
- **Corrections:** details are editable in the active period with a history row; the number is never editable; a wrong letter is voided with a reason and its number is never reused (L6).
- **Letter request flow:** any active member requests (Perihal, Ditujukan kepada, Keperluan, plus optional "Atas nama", needed-by date and up to 3 attachments). Status path: Diajukan, Diproses, then Diterbitkan, Ditolak or Dibatalkan. **"Ambil nomor" (amendment 2026-11-09, G1):** while a request is Diproses a processor takes the next SK number at once, so it can be printed before signing; the requester sees it. Diterbitkan follows when the final signed file is uploaded. An abandoned letter is ended by rejecting the request: the register row is voided with that reason and the number stays used. The requester may cancel only while Diajukan and may download the issued file of their own request (B23 answered yes). BPH secretaries process requests, never their own, and may also register outgoing letters directly (L2, L3, L4, L9). Caps per member: 5 open requests and 10 new requests per Jakarta day (L10).
- **Files:** private bucket, PDF, JPG or PNG, 5 MB each, up to 3 per letter or request (L8). Shares the free-tier 1 GB with minutes and borrowing evidence.
- **Access:** register read = BPH (`letters.view`); register write and processing = BPH secretaries (`letters.manage`, `letter_requests.process`); export (Excel, CSV, PDF, logged) = BPH. The drawer item "Surat Menyurat" is shown to every active member because everyone may file requests (an explicit exception to D-021); the register tabs stay behind `letters.view`.
- **Dashboard card (L11):** counts only (incoming and outgoing letters in the active period, plus waiting requests for processors), for `letters.view` holders; no letter titles.

### 5.6 Inventory and Item Management (Manajemen & Inventaris Barang) [DECIDED 2026-11-07, D-022] [IMPLEMENTED 2026-11-08, local stack only]
Full spec: `docs/modules/inventory-borrowing.md`; test record: `docs/qa/inventory-borrowing.md`. Built, tested and security-reviewed locally (pages under `/inventaris`); the five inventory migrations are not yet applied to the hosted project. Not built: the Dashboard "Inventaris Status" card (Dashboard module), a screen to read the export log, and a cleanup of unused evidence uploads (`OPEN_QUESTIONS.md` F11). The sample values in the old Figma/Stitch design (Drum, "OK 1", H-3, "Koordinator Logistik") are filler.
- **Catalog (Inventaris Barang):** one catalog for everything PMK owns, managed by Operations. Each item is either individually tracked (one row per unit with its own code and condition) or quantity-based (a count per condition); chosen when the item is created. Every unit (or counted item) gets an automatic code `INV-0001`. Categories and locations are lists Ops maintains. Conditions are fixed: Baik, Perlu servis, Rusak; only Baik is lendable. No catalog photos. Archive instead of delete. Every member can read the catalog and check availability by date.
- **Borrowing (Peminjaman):** any active member requests (items, quantities, date range, purpose). Status path: Diajukan, Disetujui or Ditolak, Dipinjam, Dikembalikan (also Dibatalkan). Only the Operations heads approve, reject and extend (not their own, L6). Any Operations member records handover and return and may record a request for an outside party (organisation and contact person name only). Stock is held from approval. No lead time, no maximum duration. The requester may cancel until pick-up (reason after approval). A damaged or lost return needs a note and a photo (private storage, resized, never purged). "Terlambat" (overdue) is shown, not notified. In-app status only: no email or push.
- Export (Excel, CSV, PDF) of the catalog and of borrowing; every export is logged.

### Not in Phase 1
- Program of work (progja) management.
- Login page design (login is via PI-CORE; no NEXUS login screen exists in Stitch or Figma yet; it is designed in step 2, see `docs/modules/auth-login.md`).

---

## 6. UI/UX Design Spec

**[DECIDED 2026-11-06, D-014] Design source = the Stitch redesign** "PMK-NEXUS Dashboard Redesign" (design system "Executive Heritage Modern"). Snapshot: `docs/design/stitch/` (`design-system.md` for exact tokens, `screens.md` and `html/` per screen). It replaces the original Figma description (dark curved header, dark drawer, pill buttons, approximate palette), which is superseded.

Mobile-first, 390 px wide screens.

**Layout**
- Top app bar: 64 px, solid walnut brown, **flat bottom edge** (no curve, no gradient). Hamburger (left), PMK crest/logo with serif "PMK ITERA" (center), bell with gold dot (right).
- Page title in Playfair Display under the app bar.
- Side drawer: **light** background, dark text, active item filled dark brown with white text. Items: Dashboard, Data Anggota, Finance, Notulensi Rapat, Surat Menyurat, Manajemen & Inventaris Barang.

**Color palette (exact, from Stitch)**

| Name | Hex | Use |
|---|---|---|
| Primary (walnut brown) | `#62431F` | App bar, primary buttons, active nav |
| Secondary (ivory) | `#F0E9DC` | Table header rows, ghost buttons |
| Tertiary (burnished gold) | `#C59A27` | Badges, metric indicators, notification dot |
| Text (espresso) | `#2C1E11` | Main text and icons |
| Canvas | `#FBF8F3` | Page background [ASSUMPTION: Stitch HTML uses `#fff8f5`; design notes win] |
| Card | `#FFFFFF` | Cards, 1 px border `#EADFCF` |

Status, border, and input colors: see `docs/design/stitch/design-system.md`. Colors live in one theme file (`src/app/globals.css`). Note: PI-CORE uses `#5A3E1B` / `#C9A227`; NEXUS deliberately follows Stitch (accepted trade-off, D-014).

**Typography**
- Headings: **Playfair Display** (serif). Body, data, forms, navigation: **Plus Jakarta Sans**.
- Money and counts use tabular numbers.

**Style**
- Cards: white, 12 px radius, thin warm border, very soft shadow.
- Buttons and inputs: **8 px radius**. Primary button brown with white text; secondary outline; ghost ivory.
- Pills only for status chips and filter tags.
- Tables: ivory header row with uppercase labels, zebra rows, horizontal dividers only, "Halaman 1 dari 5" pagination.
- Inputs: min height 44 px, stacked bold labels, brown focus ring.

**Content caution:** Stitch screens contain filler that is not decided (member statuses Cuti/Alumni/Pembina, "+ Tambah Anggota", "H-3" borrowing rule (answered 2026-11-07: filler, no lead time), the inventory "80%" (dropped, D-022), meeting statuses). Do not build them without the owner's confirmation (`docs/OPEN_QUESTIONS.md` section C).

**Missing screens:** login (Stitch has none for NEXUS; PI-CORE's Stitch project has "Masuk PMK ITERA", see C13), letter request flow, borrowing request flow.

**Rule:** Follow the Stitch design. If a change is proposed, explain the reason first and wait for approval.

---

## 7. Working Preferences

- Language with the owner: **simple Indonesian**. Documentation, code, and prompts are written in **English**.
- Work module by module. Suggested order:
  1. Inspect the real PI-CORE schema. **Done 2026-11-05** (`docs/picore/schema-report.md`).
  2. Connection and login to PI-CORE.
  3. Access mapping + RLS.
  4. Modules one by one.
- For each module provide: user flow, table structure, access rules (RLS), logic/endpoints, and UI.
- Practical constraints: officers rotate each period, hosting should be free or cheap (watch Supabase free-tier limits), handover must be easy, documentation and backups needed.

---

## 8. Open Questions and Missing Inputs

The full, current list lives in `docs/OPEN_QUESTIONS.md`. Summary:

1. [x] PI-CORE actual database migration files. Read 2026-11-05.
2. [ ] Final name: PMK-NEXUS or PI-NEXUS.
3. [x] Frontend/backend tech stack and hosting choice. See section 3.
4. [~] Exact letter numbering rules (including outgoing letters and yearly reset). Provisional 2026-11-09 (D-024, D-025): design format, system-assigned, yearly reset, setting not code; confirm with the PMK secretaries.
5. [~] List of PMK departments and organizational structure. PI-CORE seeds them (section 2); owner to confirm they match reality.
6. [x] Sample official letter formats. Not needed in Phase 1: NEXUS only registers and archives finished letters (L1 a, D-025). Needed again only if a later phase generates documents.
7. [x] Exact color codes and fonts: from Stitch (D-014).
8. [x] Design for login page, letter request flow, and borrowing request flow. Login (D-017), borrowing (`docs/design/inventory-borrowing.md`) and the letters module including the request flow (`docs/design/letters.md`, approved 2026-11-09, D-025) are designed. The letters design still needs one revision for "Ambil nomor" (D-025 amendment G1).
9. [x] Definition of "Inventory Status 80%" on the dashboard. Answered 2026-11-07 (D-022): no percentage, counts instead (CLAUDE.md section 14 Q7).
10. [x] Definition of member "Status" in Member Data: Aktif / Nonaktif from `members.is_active`. Answered 2026-11-06 (D-019).
11. [x] Who is "the Secretary" for Letters and Minutes. Answered 2026-11-05 (D-008).
12. [x] Design source: Stitch redesign. Answered 2026-11-06 (D-014).

---

## 9. Glossary (Indonesian to English)

| Indonesian | English |
|---|---|
| Persekutuan Mahasiswa Kristen (PMK) | Christian Student Fellowship |
| Progja (program kerja) | Program of work |
| BPH (Badan Pengurus Harian) | Executive board |
| Kepala Departemen | Department head |
| Bendahara | Treasurer |
| Sekretaris | Secretary |
| Notulensi Rapat | Meeting minutes |
| Surat Masuk / Surat Keluar | Incoming / outgoing letter |
| Perihal | Subject of a letter |
| Permohonan Surat | Letter request |
| Inventaris Barang | Inventory |
| Manajemen Barang / Peminjaman | Item management / borrowing |
| Pemasukan / Pengeluaran / Saldo | Income / expenses / balance |
| Keterangan | Description |
| Periode / Kepengurusan | Period / management term |
| Ketua Umum | Chairperson |
