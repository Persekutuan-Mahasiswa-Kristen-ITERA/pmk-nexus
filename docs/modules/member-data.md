# Member Data / Data Anggota (module spec)

> Status: **Ready for owner approval.** Revision 2 (2026-11-06): the owner answered M1-M8 (section 10); recorded as D-019 in `docs/DECISIONS.md`. Step 1 of `CLAUDE.md` section 9.
> Sources: `CLAUDE.md` (4, 5, 6, 8, 11), `docs/PMK-NEXUS-context.md` (2-5, 5.2), `docs/DECISIONS.md` (D-007, D-010, D-011, D-013, D-014, D-019), `docs/OPEN_QUESTIONS.md` (A8, B9, B10, B18, C4, C5), `docs/modules/access-control.md` (rev. 2: keys `member_data.view` / `member_data.export`, L1, L4, L12, R11, R15, A-n1), `docs/modules/auth-login.md`, `docs/picore/schema-report.md`, Stitch screens 03 and 04.
> No code, no SQL, no visual design. Tags: **[ASSUMPTION]** = my guess, still needs the owner (A-MD1 to A-MD14, section 8). **[UNKNOWN]** = no source. **M1-M8** = the questions of section 10 (all answered).

---

## 1. Purpose and scope

**Purpose.** Give authorized officers a read-only, searchable, filterable, exportable directory of PMK ITERA members, taken live from PI-CORE: who they are, their main unit and position in the ACTIVE period, and whether they are active.

**Analogy.** A notice board that is a window onto PI-CORE's register. NEXUS can look through the window and photocopy what it sees (export), and writes down who made a photocopy, but cannot write on the register.

**In scope**
- The Data Anggota list (search, filters, pagination), export (Excel, CSV, PDF), empty/error/loading states.
- The append-only export log (section 4.2).
- The member count for the Dashboard "Members" card (the number only; the card belongs to the Dashboard module).
- The data contract of the restricted PI-CORE read functions behind them (D-010, widened by D-019 to include member type).

**Out of scope**
- Create, edit, deactivate, delete or invite members: all in PI-CORE (D-002). No "+ Tambah Anggota", no edit button, no form.
- Showing or searching email, phone, NIM, NIP (locked rule L4). Showing `access_level` (who is System Admin) or `deactivated_at`.
- A member detail/profile screen (M4: none), member lists of earlier periods (M7: none), attendance, any NEXUS-owned member list.
- Program of work (progja): not Phase 1. Nothing here blocks it.

NEXUS stores **no member list** for this module: no copy of names, no cache. The only thing it stores is the export log, which holds ids and settings, never member data. Every request reads PI-CORE through `src/lib/picore/` only.

---

## 2. Who uses it and who may do what

Rights come from permission keys (access-control rev. 2), never from a person.

| Key | Unlocks | Default holders |
|---|---|---|
| `member_data.view` | Open Data Anggota; see the list; Dashboard "Members" count | Role `bph` (rule D12: Ketua Umum, Sekretaris Jenderal, Sekretaris Umum 1/2, Bendahara Umum 1/2) **and** role `kepala_departemen` (new rule D32: Kepala Departemen and Kepala Biro), both active period, scope "all" |
| `member_data.export` | "Ekspor" button and the export endpoint (needs `view`, R15) | Role `bph` only (rule D13, unchanged). Department/bureau heads cannot export |

Rule D32 is **not yet in the migrations**. The database engineer writes it later. It is a sensitive key, so it needs a written reason (L12, D-013).

| Actor | Open list | Dashboard count | Export | Read export log | Notes |
|---|---|---|---|---|---|
| BPH member (Ketua Umum, Sekjen, Sekum, Bendahara Umum) | Yes | Yes | Yes | Yes | Read-only list |
| Kepala Departemen, Kepala Biro (role `kepala_departemen`) | Yes (full list) | Yes | **No** | No | Not limited to their own unit: scope is "all" |
| System Admin without a BPH position (P-ADMIN) | **No** | No | No | Yes [A-MD10] | B18 default (a): admin is not a business-data user (AC-03). The admin may add a rule for themselves; it is logged and flagged "self-benefit" (D-012) |
| System Admin who is also BPH (P-ADMIN-BEND) | Yes | Yes | Yes | Yes | Through the position, not admin status (AC-68) |
| Sekretaris Departemen/Biro, Kepala Divisi, Staff, plain member, lecturer | No | No | No | No | Unless the admin adds a rule |
| Deactivated or unlinked account | No | No | No | No | L1 |
| Anonymous | No | No | No | No | Redirected to login |

**When the user lacks `member_data.view`**
- The drawer item "Data Anggota" is **absent** (not greyed out). The Dashboard "Members" card is absent (A-n1).
- A direct link shows the shared "no permission" page of the access-control spec (auth-login F11), never the data and never the No-access screen. A direct API/function call returns no rows or an error; hiding in the UI is only convenience (R10).
- With `view` but not `export` (department/bureau heads): the "Ekspor" button is absent and the export endpoint refuses.

**Fixed limits that no rule can change**
- L4: only name, unit, position, active/inactive and the "Pembina" marker (member type). No catalog key widens this.
- L12 (D-013): `member_data.*` can never go to the "every active member" subject; only to a role, position or org unit, with a written reason. So "all active members may see the list" (old B9 option c) is blocked.
- Rules cannot target one member (L10). Scope is "all" only for these keys, so "department heads see only their own department" is not possible and not wanted (M2 chose the full list).

---

## 3. User flows

Common: every step runs on the server; the page and each action first call the shared session check and the permission check (auth-login AR8). Mobile-first, 390 px.

### F1. Open the list
1. The user taps "Data Anggota" in the drawer.
2. The server checks session, active member, `member_data.view`.
3. While the first page loads, the table area shows skeleton rows (no member data before the check ends).
4. The list appears: title, search, filters, table, pagination, and the "Ekspor" button if the user has `member_data.export`.
5. Defaults: search empty, unit filter = all, **Status = Aktif**, page 1, sorted by name A-Z.

### F2. Search
1. The user types in the search box (proposal: "Cari nama anggota..."; Stitch's "nama atau NIM" is NOT used).
2. The list reloads after a short pause or on Enter; the page returns to 1.
3. Matching is on **name only**, case-insensitive, part of the name, ignoring extra spaces. An email, phone, NIM or NIP typed in simply matches nobody; those fields are never looked up.
4. The search runs on the server over all members, not only the loaded page.

### F3. Filter
1. Filter "Unit": options are read live from PI-CORE org units (never hard-coded), see R5. Filter "Status": **Aktif (default), Nonaktif, Semua**.
2. Choosing a value reloads the list and returns to page 1. Search and filters combine with AND.
3. "Reset" returns to the defaults of F1 (including Status = Aktif).
4. Search, filters and page live in the page address, so refresh and Back keep the view. The address holds nothing else.

### F4. Paginate
1. Control: Prev, page numbers, Next (Stitch), plus the counter "Menampilkan 1-20 dari N anggota". Prev is disabled on page 1, Next on the last page.
2. The server paginates; a request for a page beyond the last shows the last page. Page size 20 [A-MD1].
3. Column "No" is the running number across pages ((page-1) x size + position), not stored.

### F5. Export
1. A user with `member_data.export` taps the single "Ekspor" button and picks Excel, CSV or PDF from its menu (M5). Users without `export` do not see the button.
2. The server rebuilds the list with the **current search and filters, all matching rows (not only the visible page)**, in the same order, with the same information as the screen. Export never contains more than the screen shows (R15, A-n2).
3. Before returning the file, the server writes one row to the export log (section 4.2). **If the log row cannot be written, no file is returned** and the user sees the "gangguan" message [A-MD12].
4. The file is generated on the server and downloaded. Nothing is stored in NEXUS storage. The file name carries the date; the PDF/Excel header shows the active period label and the export date [A-MD5].
5. If the user lost the right meanwhile, the export is refused ("Aksesmu sudah berubah...") and nothing is logged.

### F6. States
| State | Behavior |
|---|---|
| Loading | Skeleton rows; controls stay usable |
| No match | "Tidak ada anggota yang cocok. Ubah pencarian atau filter." with a "Reset" button (proposal) |
| No members at all | Same plain empty text; cannot occur in a working PI-CORE |
| Error / PI-CORE unreachable / `nexus` not exposed | "Terjadi gangguan. Coba lagi sebentar lagi." with "Coba lagi"; fail closed, never "no access", never a sign-out (AR10) |
| Session ended | Redirect to login with "Sesi kamu berakhir. Masuk lagi." (auth-login F9) |
| Right removed while the page is open | Next action fails with "Aksesmu sudah berubah. Masuk lagi atau hubungi admin PMK ITERA."; list not shown again |

Copy lines are proposals; the UX designer and the owner finalize them.

### F7. Period switch
1. The list always shows the ACTIVE period (`periods.is_active = true`). There is no period selector (M7).
2. When PI-CORE switches the active period, the next request shows the new period's units and positions. No logout, no deploy, no cache to clear (access control R3).
3. Access changes at once too: a BPH member or department head of the old period who holds no such role in the new one loses the page on the next request (AC-38, AC-40).

---

## 4. Data contract (plain words)

### 4.1 The list
One row = one **member** (never one assignment, so counts and pages count people). All data comes from PI-CORE `public` tables through restricted `nexus` functions (D-010). Names below are real columns from `docs/picore/schema-report.md`.

| Row field | Shown as | Source in PI-CORE | Rule |
|---|---|---|---|
| (row key) | not displayed | `members.id` | Stable key for the page; not sensitive |
| No | "No" | computed | See F4 |
| Name | "Nama Lengkap" | `members.full_name` | As stored; search target |
| Lecturer marker | small tag "Pembina" under the name | `members.member_type = 'lecturer'` | Shown for every lecturer (M6). Never shows NIP |
| Unit, line 1 | "Unit / Jabatan", first line | `org_units.name` of the PRIMARY assignment's unit; for a division, its parent's name first: "Departemen Operasional · Logistik" | Section 5, R3 |
| Position, line 2 | "Unit / Jabatan", second line | `positions.name` of the primary assignment | |
| Status | "Status" | `members.is_active` | true = "Aktif", false = "Nonaktif" (M1) |

**Primary assignment (M3, B10).** Among the member's assignments in the active period (`assignments` joined to the `periods` row with `is_active`), the primary is the one whose position has the lowest `positions.rank` (lower = more senior). Tie-break [A-MD8]: lower `org_units.sort_order`, then unit name A-Z, then position name A-Z. A member with no assignment shows "-" for unit and position.

Filter options: `org_units` (`id`, `name`, `type`, `parent_id`, `sort_order`, `is_active`).

**Never read, returned, searched, logged or exported (L4, D-010, AC-47):** `email`, `phone`, `nim`, `nip`, `user_id`, `access_level`, `must_change_password`, `deactivated_at`, audit columns, `audit_log`, `org_settings`. The functions whitelist their output columns; a new PI-CORE column never appears by accident. Allowed fields: row key, `full_name`, `member_type`, `is_active`, and the unit/position names above. D-010 listed no `member_type`; D-019 widens it (access-control 7.1 already allowed reading it).

**Functions (design level, for the database engineer):**
1. List function: inputs = search text, unit filter (org unit id), status filter, page, page size (hard server maximum); sort fixed to name. Output = the rows above plus the total for the current filters. It checks `member_data.view` inside and returns nothing or an error otherwise.
2. Option function: filterable units (id, name), same permission.
3. Count function: one number, all members with `is_active = true` (M5b), same permission. Equals the list total under the default filter.
4. Export function: the list logic without paging; requires `member_data.export`; writes the export log row in the same call.
All are called only from `src/lib/picore/`. They run with elevated rights (they read PI-CORE tables a normal member cannot), so each needs a security review and a test per persona (D-010 risk).

### 4.2 The export log (M8, the only data NEXUS stores for this module)
Append-only table in schema `nexus`. One row per **successful** export (any format).

| Field | Content |
|---|---|
| Who | `members.id` of the exporter, taken from the session on the server, never from client input |
| When | server time |
| Format | `xlsx`, `csv` or `pdf` |
| Filters used | unit filter (org unit id or none), status filter (Aktif / Nonaktif / Semua), and whether a search term was used (yes/no) [A-MD11] |
| Period | id of the active period at that moment [A-MD11] |

Rules: no update and no delete for anyone, including the System Admin (L5, L11 spirit). Rows are written only by the export function, never by a direct insert. It stores **no PII**: no email, phone, NIM, NIP; no exported rows; no search text; no names (the reader's screen looks the exporter's name up at read time). Readers: the System Admin (fixed) and holders of `member_data.view_export_log` (default: BPH, rule D33). A deactivated exporter's rows stay. RLS enabled, default deny (CLAUDE.md 11).

---

## 5. Business rules and edge cases

(R1-R22 are local to this spec. Rules of the access-control spec are always written "access control R3", or by AC/L numbers.)

| # | Rule or case | Expected behavior |
|---|---|---|
| R1 | Who appears | Every `members` row, with or without an assignment, filtered by Status (default Aktif). PI-CORE has no "regular member" role, so most members hold no assignment (schema report 8); a list built from assignments would hide them |
| R2 | No assignment in the active period | Row shown with "-" for unit and position. Includes plain members, members whose period ended, and lecturers |
| R3 | Several assignments (e.g. Staff in two divisions; Sekretaris Departemen plus Staff) | One row, showing only the primary assignment (section 4.1). A member is never duplicated into several rows. The other assignments are not shown anywhere in this module (M3, M4) |
| R4 | What "Unit" means | PI-CORE has no department text on a member. Assignments sit on a unit of type `bph`, `department`, `bureau` or `division`; a division's parent is always a department (PI-CORE trigger). The row shows the unit's name; a division is written after its department: "Departemen Operasional · Logistik". BPH and the bureau show their own names |
| R5 | Unit filter options | Units of type `bph`, `department`, `bureau`, read live in `sort_order`. The root `PMK ITERA` is not offered (it cannot hold assignments). A division is not a separate option; selecting a department includes its divisions. Stitch's names (Musik & Pujian, Acara & Liturgi...) are sample data, NOT used. An extra value "Tanpa jabatan" (members with no active-period assignment) is useful but is a design addition: [A-MD2] |
| R6 | Filter vs primary assignment | The unit filter matches ANY active-period assignment of the member, not only the primary [A-MD9]. A member with Staff in Logistik and Sekretaris Departemen in Departemen Internal appears under "Departemen Operasional" and under "Departemen Internal", but their row shows the primary (Internal). This is accepted so that nobody disappears from a unit they belong to |
| R7 | Unit or position renamed in PI-CORE | New name shows at once; nothing is stored by name; filters use unit ids |
| R8 | Unit deactivated (`org_units.is_active = false`) | Assignments inside still show as PI-CORE reports them (A-n11); the unit is not offered in the filter; its members still appear under "all" [A-MD4] |
| R9 | Deactivated member | Listed with "Nonaktif" only when the Status filter is Nonaktif or Semua. PI-CORE keeps their active-period assignments, so their unit/position shows what PI-CORE records [A-MD3]. The row is never removed (CLAUDE.md 6.5) |
| R10 | Lecturer (`member_type = 'lecturer'`) | Cannot hold assignments (PI-CORE), so unit/position is "-". Always shows the "Pembina" marker. Counted in the Dashboard total when active. Status filter applies as to everyone |
| R11 | Member without a login (`user_id` null) | Still listed; the list says nothing about login |
| R12 | Same name twice | Two rows. Nothing else identifies them (NIM is forbidden). Accepted |
| R13 | No active period | By default nobody holds `member_data.view` (BPH and department-head rules need an active-period assignment, access control R11), so the page shows the "no permission" page plus the global banner "Belum ada periode aktif". Not a special state here |
| R14 | Period switched while the page is open | See F7: the next request uses the new period |
| R15 | Sorting and search | Name A-Z, case-insensitive; ties by `members.id` so pages are stable. No sort controls [A-MD1]. Search is name only; Stitch's NIM/department search is not adopted |
| R16 | Page size | 20 [A-MD1]; the server rejects values above a fixed maximum. About 200 members (Stitch figure, unverified) |
| R17 | Several roles, one person | Rights are the union (access control R2). Someone who is Kepala Departemen and also Bendahara Umum gets export through `bph` |
| R18 | Rule disabled or position vacant | The holder loses the page on the next request; nothing cached (access control R3) |
| R19 | Export while filters hide inactive members | Export respects the filters; to export everyone, the user sets Status to Semua first |
| R20 | Read-only guarantee | No write, no delete, no deep link to edit a member in PI-CORE [A-MD6] |
| R21 | Export log write fails | No file is returned (F5 step 3) [A-MD12] |
| R22 | Export by someone who is later deactivated or loses the right | The log row stays; the log has no delete |

---

## 6. Stitch conflicts (filler; flagged, not adopted)

| Stitch content (03 / 04) | Problem | Decision |
|---|---|---|
| NIM under each name; search "nama atau NIM"; 04 "nama, NIM, atau departemen" | NIM is forbidden (L4, D-010) | Removed. Search = name only |
| "+ Tambah Anggota" (04) | Member Data is read-only (C5) | Removed |
| Status values Aktif / Cuti / Alumni / Pembina | PI-CORE stores only active/inactive | Only Aktif / Nonaktif (M1). "Pembina" is not a status; it is the lecturer marker (M6) |
| "Ketuk baris untuk detail profil" (03) | No detail screen | Removed (M4) |
| Sample departments (Musik & Pujian, Kerohanian, Humas, Logistik, Acara...) | Not PI-CORE units | Real units from `org_units` |
| Role sublabels (Koordinator, Staff Ahli, Demisioner, "BPH - Sekum") | Not PI-CORE positions | Real `positions.name` as line 2 |
| Column title "Departemen" | BPH and the bureau are not departments | "Unit / Jabatan" (M3) |
| "TOTAL 200 Jiwa" box; Dashboard "100% Anggota Aktif" | Invented figures and wording | Total = the counter of F4; Dashboard count per M5b. "Jiwa" wording needs the owner's OK |
| "Ekspor PDF" only (03); "Unduh Rekap (Excel/PDF)" (04) | Context requires Excel, CSV, PDF | One "Ekspor" button with a three-format menu (M5) |
| Pulsing dots, animation (04) | Not decided | Base on the static variant 03 (separate "Filter Direktori" card, "Reset") unless the UX designer proposes otherwise |

The visual design (flat bar, ivory table header, zebra rows, 8 px inputs, 44 px fields, 16 px field text per D-017, "Halaman x dari y" style) follows `docs/design/stitch/design-system.md`; screens 03/04 are the base. No new screen is needed for the list. **Open design point:** a screen to read the export log (A-MD14, section 11).

---

## 7. Roles at a glance (test matrix)

| Persona (access-control section 9; P-KABIRO is local to this spec: Kepala Biro in Biro Kewirausahaan) | List | Dashboard count | Export | Read export log |
|---|---|---|---|---|
| P-KETUM, P-SEKJEN, P-BEND (role `bph`) | Yes | Yes | Yes | Yes |
| P-ADMIN-BEND (admin + Bendahara Umum 1) | Yes | Yes | Yes | Yes |
| P-KADEP-OPS, P-KABIRO (role `kepala_departemen`) | Yes | Yes | **No** | No |
| P-ADMIN, P-SUPER (no assignment) | No | No | No | Yes |
| P-SEKDEP, P-STAFF-LOG, P-STAFF-PUB, P-PLAIN, P-LECT | No | No | No | No |
| P-OLD (BPH in the previous period only) | No | No | No | No |
| P-INACTIVE, P-UNLINKED, anonymous | No | No | No | No |

(Default rules D12, D13, D32, D33; changes if the admin edits rules.)

---

## 8. Assumptions made in this spec

All are [ASSUMPTION] until the owner confirms; they are also in `docs/OPEN_QUESTIONS.md` section G.

| Id | Assumption |
|---|---|
| A-MD1 | Page size 20; name A-Z sort; no sort controls; search, filters and page in the page address. |
| A-MD2 | Unit filter = top-level unit (bph/department/bureau), divisions fold into their department; extra filter value "Tanpa jabatan" proposed. |
| A-MD3 | Unit/position of a deactivated member shows what PI-CORE records. |
| A-MD4 | Inactive units are not offered in the filter, but their members still show. |
| A-MD5 | Export = all rows matching current filters, same information as the screen, with period label and date in the header; file generated on the server, not stored. In exports the marker is its own column "Pembina" (Ya/empty) and unit and position are separate columns. |
| A-MD6 | No link from a row to PI-CORE. |
| A-MD7 | Interface strings in section 3 are proposals. |
| A-MD8 | Primary-assignment tie-break: lower `org_units.sort_order`, then unit name A-Z (owner-given), then position name A-Z (added by me, last resort). |
| A-MD9 | The unit filter matches ANY active-period assignment, not only the primary. |
| A-MD10 | ANSWERED 2026-11-06: new sensitive key `member_data.view_export_log`, default rule D33 for role `bph`; System Admin reads it as a fixed right. |
| A-MD11 | Export log filters = unit id, status, and whether a search term was used (yes/no); the search text itself is NOT stored (a typed email or NIM would become PII in the log). The log also stores the active period id. |
| A-MD12 | If the export log row cannot be written, the export is refused (fail closed). |
| A-MD13 | Department/bureau heads see the full list (scope "all"), not only their own unit (owner chose M2 b; follows the catalog). |
| A-MD14 | A screen to read the export log is not designed yet; until the owner approves one, the log is readable only through the function/database. |

---

## 9. Acceptance criteria

Personas as in `docs/modules/access-control.md` section 9, plus P-KABIRO (Kepala Biro). All assume the default rules (D12, D13, D32) unless stated.

**Permissions**
- MD-01 P-KETUM, P-SEKJEN and P-BEND can open Data Anggota, see the list, see the Dashboard "Members" count and use "Ekspor".
- MD-02 P-KADEP-OPS and P-KABIRO can open the list and see the Dashboard count, and do **not** see the "Ekspor" button; a direct call to the export endpoint with their token is refused and writes no log row.
- MD-03 P-ADMIN and P-SUPER (no assignments) cannot open the page and a direct function call with their token returns no rows or an error.
- MD-04 P-ADMIN-BEND can open the page and export, because of the Bendahara Umum 1 position.
- MD-05 P-SEKDEP, P-STAFF-LOG, P-STAFF-PUB, P-PLAIN and P-LECT do not see the drawer item or the Dashboard "Members" card; a direct link shows the "no permission" page; a direct function call returns no rows or an error.
- MD-06 P-INACTIVE, P-UNLINKED and an anonymous visitor get nothing from any member-data function, even with a still-valid token (L1).
- MD-07 P-OLD loses the page on the first request after the active period switches; a user who is BPH or Kepala Departemen/Biro in the new period gets it on their first request, with no logout.
- MD-08 If the admin disables rule D12 (or D32), the matching holders lose the page on the next request; nothing is cached across requests.
- MD-09 Granting `member_data.view` to "every active member" is rejected by the database (L12). Granting it to a role, position or unit without a written reason is rejected.

**Data and privacy**
- MD-10 Every response and every export contains only: member key, full name, member type marker, the primary assignment's unit and position (active period), and active/inactive. It contains no `email`, `phone`, `nim`, `nip`, `user_id`, `access_level`, `must_change_password` or `deactivated_at`.
- MD-11 With `member_data.view` and `member_data.export` temporarily granted to a unit rule in a test, responses and exports still contain none of those fields (AC-56 analog).
- MD-12 Searching for the exact email, phone, NIM or NIP of a seeded member returns zero rows.
- MD-13 NEXUS code reads members only through `src/lib/picore/` and never calls `private.*`. No table in schema `nexus` holds member names or a copy of any list; the only table for this module is the export log.
- MD-14 No screen, function or route can create, edit, deactivate or delete a member; "+ Tambah Anggota" and the "Ketuk baris" hint do not exist; rows are not tappable.

**List behavior**
- MD-15 The list has exactly one row per member. A seeded member with two active-period assignments appears once.
- MD-16 Primary assignment: a member with Sekretaris Departemen (rank 50) in Departemen Internal and Staff (rank 70) in Logistik shows "Departemen Internal" on line 1 and "Sekretaris Departemen" on line 2.
- MD-17 Tie-break: two assignments of equal rank resolve by lower `org_units.sort_order`, then unit name A-Z, then position name A-Z, and the same one is shown on every request and every page.
- MD-18 Unit display: a Staff in Logistik shows "Departemen Operasional · Logistik" / "Staff"; a Ketua Umum shows "BPH PMK ITERA" / "Ketua Umum"; a Kepala Biro shows "Biro Kewirausahaan" / "Kepala Biro" (seed names, subject to A3).
- MD-19 A member with no assignment in the active period appears with "-" for unit and position, not hidden.
- MD-20 Assignments of earlier periods never appear (seed a member whose only assignment is in a non-active period).
- MD-21 The unit filter options equal the PI-CORE units of type bph/department/bureau at that moment; renaming a unit changes the option and the row text on the next request.
- MD-22 Choosing a department lists members with ANY active-period assignment in that department or its divisions, including a member whose primary assignment is elsewhere (R6); a member with assignments in two departments appears under both filters and once in the list.
- MD-23 The Status filter offers exactly Aktif, Nonaktif and Semua, defaults to Aktif, and matches `members.is_active`. A seeded deactivated member is absent by default, shows "Nonaktif" under Nonaktif or Semua, and "Reset" returns to Aktif.
- MD-24 Pembina marker: an active lecturer appears with the "Pembina" marker and "-" unit/position, and is counted in the Dashboard total; a student has no marker; the marker also appears in every export; no NIP is shown anywhere.
- MD-25 Search matches part of a name case-insensitively across all pages; search plus filters combine with AND; changing any of them resets to page 1.
- MD-26 Pagination: the counter reads "Menampilkan a-b dari N anggota" with N = matches of the current filters; Prev is disabled on page 1, Next on the last; a page beyond the last shows the last page; the page size cannot be raised above the server maximum by editing the address.
- MD-27 Sorting is name A-Z and stable between pages (no member repeats or goes missing).
- MD-28 An empty result shows the "no match" text with a Reset action; PI-CORE unreachable shows the "gangguan" state, not "no access", and does not sign the user out.

**Export and export log**
- MD-29 Excel, CSV and PDF exports each contain all rows matching the current search and filters (not just page 1), in the screen's order, with unit and position, and the same count as the on-screen total.
- MD-30 The "Ekspor" control is one button with a menu of exactly three formats, visible only with `member_data.export`.
- MD-31 Each successful export writes exactly one log row with the exporter's `members.id` (from the session), the time, the format, the filters used, and the active period id. A refused export writes none.
- MD-32 The log row contains no email, phone, NIM, NIP, no exported rows or names, and no search text.
- MD-33 No one can update or delete a log row, including P-ADMIN, through the UI, the API, or a function; a direct update or delete with any persona's token is rejected. A direct insert is rejected; only the export function writes.
- MD-34 The log can be read by P-ADMIN, P-SUPER and BPH members, and not by P-KADEP-OPS, P-KABIRO, P-PLAIN or any other persona (direct API returns nothing) [A-MD10].
- MD-35 If the log row cannot be written (test by failing the write), no file is returned and the user sees the "gangguan" message [A-MD12].
- MD-36 A log row of an exporter who is later deactivated remains.
- MD-37 Exports are generated on the server and no file is kept in NEXUS storage.

**Dashboard**
- MD-38 The Dashboard "Members" number is shown only to users with `member_data.view` and equals the total of the list under its default filter (all members with `is_active = true`, students and lecturers, with or without an assignment).
- MD-39 With no active period the page shows the "no permission" page and the banner "Belum ada periode aktif" (R13).

**Quality**
- MD-40 At 390 px width the list is usable without horizontal page scroll; fields are at least 44 px high with 16 px text (D-017).
- MD-41 A pgTAP test per persona proves the functions return zero rows for denied users and that the output columns are exactly the whitelist; a second test proves the export log has RLS enabled and no update or delete path.

---

## 10. Questions and owner answers (record)

All answered by the owner on 2026-11-06. Recorded as D-019. Chosen option marked **CHOSEN**.

**M1. Status values and inactive members (A8, C4).** **[ANSWERED: (a)]**
- (a) **CHOSEN.** Aktif / Nonaktif; list shows everyone; filter defaults to Aktif; Semua and Nonaktif selectable.
- (b) Same but default "Semua". (c) Only active members shown. (d) Cuti / Alumni / Pembina: needs a PI-CORE change.

**M2. Who may see Member Data (B9).** **[ANSWERED: (b)]**
- (a) BPH only.
- (b) **CHOSEN.** BPH plus role `kepala_departemen` (Kepala Departemen and Kepala Biro, schema report section 8), full list, view only. New default rule D32 with a written reason (L12). `member_data.export` stays BPH only (D13).
- (c) Department heads limited to their own unit: not possible with the current catalog.
- (d) All active members: **blocked by L12**.

**M3. Unit column with several assignments (B10).** **[ANSWERED: (b)]**
- (a) Show all. (b) **CHOSEN.** One primary assignment (lowest `positions.rank`). (c) Primary plus "+N".
- Sub-answers: title "Unit / Jabatan"; line 1 unit with the division after its department; line 2 position; no assignment = "-". [A-MD8] tie-break; [A-MD9] filter matches any assignment.

**M4. Row-tap detail view.** **[ANSWERED: (a)]** No detail view; the Stitch hint is removed. (b) inline expand and (c) separate screen were not chosen.

**M5. Export on mobile.** **[ANSWERED: (a)]** One "Ekspor" button with a menu of Excel, CSV, PDF. (b) PDF only on phones and (c) Excel/CSV only were not chosen. Dependency note: PDF and Excel generation may need one mainstream library; the backend engineer justifies it.

**M5b. Dashboard "Members" count.** **[ANSWERED: (a)]** All members with `is_active = true` (students and lecturers), with or without an assignment. (b) students only and (c) only members with an assignment were not chosen.

**M6. Lecturers.** **[ANSWERED: (b)]** Listed with a small marker reading "Pembina". Widens the D-010 field list to include `member_type` (allowed by access-control 7.1). (a) no marker and (c) hidden were not chosen. B15 (what a lecturer may do in NEXUS) stays separate.

**M7. Earlier periods.** **[ANSWERED: (a)]** Active period only; no selector.

**M8. Export logging.** **[ANSWERED: (b)]** Append-only NEXUS table: who (`members.id`), when, format, filters used. No update, no delete, no PII. Readable by the System Admin and BPH via `member_data.view_export_log` (rule D33; owner 2026-11-06). (a) no log was not chosen.

---

## 11. Notes for other documents and unresolved points

**Resolved on 2026-11-06 (documents updated):**
1. Access-control B9 option (c) "all active members" is marked blocked by L12; B9 answered as option (b); rule D32 added to the default table (row count 31 to 32); L4 and the catalog text mention the "Pembina" marker. Done in `docs/modules/access-control.md`.
2. D-010 field list widened to include `member_type`: recorded in D-019.
3. Context 5.2 now says "Unit / Jabatan"; context section 2 wording "1 bureau -> 16 divisions" fixed; Context 5.1 and section 8 item 10 updated.
4. A8, B9, B10 and C4 answered in `docs/OPEN_QUESTIONS.md`; A-MD assumptions added there.
5. Context 5.1 puts "Members" on the Dashboard for everyone; this spec follows access-control A-n1 (only `member_data.view` holders).

**Unresolved (need a decision from the coordinator or owner):**
1. **[RESOLVED 2026-11-06: owner chose the proposal below; key + D33 added to access-control.md]** **How the export-log reading right is expressed in the access rules.** The catalog has 20 keys and none covers it. Proposal: a new sensitive key (for example `member_data.view_export_log`, scope "all") with a default rule for role `bph`, and the System Admin reading it as a fixed identity like the rules log (L3). That would make 33 default rules and a catalog change. Not applied: access-control section 7.2 only lists the log as stored data; the catalog, rule table and rule count (32) do not include a log key (A-MD10).
2. **A screen to read the export log** (A-MD14) is not designed. Without it BPH cannot actually read the log. Needs the UX designer and an owner decision.
3. **`deactivated_at`** is part of A8's idea of status, but access-control 7.1 says it is never read; the module cannot show "inactive since".
4. Existing text in access-control that conflicts with L12 and was NOT changed (outside this module's scope): AC-55, AC-56 and E20 still describe granting sensitive keys to "every active member" as allowed, while L12 (D-013) rejects it in the database.
