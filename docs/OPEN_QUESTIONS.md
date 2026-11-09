# PMK-NEXUS Open Questions and Active Assumptions

Last updated: 2026-11-09 (A2/C6 provisional, D-024; C14-C15 added; section F-bis added: Inventory and Borrowing application-layer security review; A-IB43 upload cap narrowed to 24 hours). Earlier: 2026-11-07 (Inventory and Borrowing answers IB1-IB15, D-022; A7, B4, C7 answered; section H added). Earlier: 2026-11-06 (Member Data answers, D-019; section G added).
Tags: **[UNKNOWN]** no answer yet, **[ASSUMPTION]** working guess that needs confirmation, **[ANSWERED]** resolved (move the decision to `DECISIONS.md`).
Priority: **P0** blocks the next step, **P1** blocks a specific module, **P2** can wait.

---

## A. From CLAUDE.md section 14

| # | Question | Status | Priority | Notes |
|---|---|---|---|---|
| A1 | Final name: PMK-NEXUS or PI-NEXUS? | [UNKNOWN] | P2 | Stitch screens use "PMK-NEXUS". |
| A2 | Exact letter numbering rules: outgoing code (e.g. `SK`), yearly reset, who assigns numbers? | **Provisional** 2026-11-09 (D-024) | P2 | Owner: use the design format for now, changeable later. [ASSUMPTION] system assigns, yearly reset, one sequence per type, never reused. Confirm with the PMK secretaries. |
| A3 | List of PMK departments and organizational structure | **Partly answered** | P1 | PI-CORE seeds 7 departments, 1 bureau, 16 divisions (`docs/picore/schema-report.md` section 8). Owner to confirm this matches reality. |
| A4 | Sample official letter formats | [UNKNOWN] | P1 (Letters) | |
| A5 | Exact Figma colors and fonts | [UNKNOWN] | P1 (UI) | Stitch has exact values (see section C), but they differ from the context doc. Which design wins? |
| A6 | Designs for login, letter request flow, borrowing request flow | [UNKNOWN] | P1 | See section C for what Stitch contains. PI-CORE's Stitch project has login screens ("Masuk PMK ITERA") that could be reused. |
| A7 | Meaning of "Inventory Status 80%" (CLAUDE.md Q7) | **[ANSWERED]** 2026-11-07 (D-022, IB12 option d) | - | No percentage. The Dashboard card shows counts (units in good condition, on loan, needing service; exact wording at design time, A-IB32). The Stitch "80%" is dropped, a design deviation the owner approved. |
| A8 | Meaning of member "Status" in Member Data | **[ANSWERED]** 2026-11-06 (D-019, M1) | - | Aktif / Nonaktif from `members.is_active`. Filter defaults to Aktif. |

## B. PI-CORE schema (from `docs/picore/schema-report.md`)

| # | Question | Status | Priority | Why it matters |
|---|---|---|---|---|
| B1 | Who is "System Admin" in NEXUS? | **[ANSWERED]** 2026-11-05 | - | Only manually appointed `access_level` `admin` or `super_admin`. Positions never grant it. See `DECISIONS.md` D-007. |
| B2 | Who manages Letters and Meeting Minutes? | **[ANSWERED]** 2026-11-05 | - | BPH secretaries: everything. Department/bureau secretaries: only their own unit's minutes. See `DECISIONS.md` D-008. |
| B3 | Treasurer = only Bendahara Umum 1/2 (role `bendahara`)? | [ASSUMPTION] yes | P1 (Finance) | No department-level treasurers exist in PI-CORE. |
| B4 | "Operations Department Head and staff" = Kepala Departemen of `Departemen Operasional` + Kepala Divisi + Staff of its divisions `Logistik` and `Akomodasi` (+ Sekretaris Departemen?) | **[ANSWERED]** 2026-11-07 (D-022, IB2 option b) | - | Every position in the Operations units (including Sekretaris Departemen Operasional) manages inventory and records handover/return (`borrowing.handle`). Only Kepala Departemen and Kepala Divisi approve, reject, extend (`borrowing.approve`). Still to verify before applying: that the Kepala Divisi positions of Logistik and Akomodasi are filled in the real data. Migration written 2026-11-07 (`20261107100000`, commit 7a8399a), not yet applied to hosted. |
| B5 | How to identify `Departemen Operasional` safely? | **[ANSWERED]** 2026-11-05 | - | NEXUS-side settings table storing PI-CORE org unit IDs. See `DECISIONS.md` D-009. |
| B6 | "BPH view all" = everyone holding role `bph` (Ketua Umum, Sekjen, Sekum 1/2, Bendahara Umum 1/2)? | [ASSUMPTION] yes | P1 | |
| B7 | Committee (panitia): needed in NEXUS? PI-CORE has no such role. | [UNKNOWN] | P2 | Context doc lists "Committee" as a role. |
| B8 | Regular member (G7) = EVERY active member (baseline rights; officers get more on top). What do they see? Spec recommends: own requests + read-only inventory catalog + dashboard cards they may open. | [ASSUMPTION] | P1 | PI-CORE has no "anggota" role. See `docs/modules/access-control.md`. |
| B9 | Member Data: which roles may see the member list, and which fields (name, department, status; never email/phone/NIM/NIP)? | **[ANSWERED]** 2026-11-06 (D-019, M2) | - | View: role `bph` + role `kepala_departemen` (new default rule D32, needs a written reason, L12); export: BPH only. "All active members" is blocked by L12. Fields: name, main unit/position, active/inactive, "Pembina" marker. Migration for D32 still to be written. |
| B10 | "Department" column when a member has several assignments: show all, or one primary (lowest `rank`)? | **[ANSWERED]** 2026-11-06 (D-019, M3) | - | One primary (lowest `positions.rank`); column "Unit / Jabatan". Tie-break answered (A-MD8); filter behavior: assumption A-MD9 (section G). |
| B11 | How does NEXUS read PI-CORE data it cannot see through RLS? | **[ANSWERED]** 2026-11-05 | - | Own restricted SECURITY DEFINER functions in schema `nexus`; no sensitive fields. See `DECISIONS.md` D-010. |
| B12 | Hosted Supabase: is schema `nexus` added to "Exposed schemas"? (2026-11-05: currently exposed = `public`, `graphql_public`; nexus not yet, add only after migrations.) Is sign-up disabled on the hosted project (not only in local `config.toml`)? | [UNKNOWN] | P0 (before first migration) | Changing exposed schemas touches the shared project. Sign-up: `enable_signup = false` pushed and verified on 2026-11-01 per PI-CORE `docs/OPERATIONS.md` (re-check live before go-live). |
| B13 | Does production already have the 2026/2027 period and assignments filled in? | [UNKNOWN] | P1 | Seed data is local only. |
| B14 | Should NEXUS call PI-CORE's `private.*` functions? | **[ANSWERED]** 2026-11-05 | - | No. Re-implement inside `nexus`, reading only `public` tables. See D-007, D-010. |
| B16 | How does NEXUS recognize a BPH secretary? | **[ANSWERED]** 2026-11-05 | - | NEXUS-side settings table storing PI-CORE position IDs. See `DECISIONS.md` D-009. |
| B17 | Can department/bureau secretaries READ letters (archive) or only submit requests? Can they read minutes of other units? | [ASSUMPTION] submit requests only; read only their own unit's minutes | P1 | BPH can view all (role `bph`). |
| B18 | Should System Admin see business data (Finance, minutes, letters, Member Data)? | [ASSUMPTION] no, settings only | P1 | From access-control spec. |
| B19 | May members of a unit read their own unit's minutes? | [ASSUMPTION] no, only dept secretary and BPH | P2 | From access-control spec. |
| B20 | Who may read previous-period records? | [ASSUMPTION] whoever currently has view rights, all periods | P1 | From access-control spec. |
| B21 | May a processor approve their own request? | [ASSUMPTION] blocked | P1 | From access-control spec. |
| B22 | Does a department secretary's scope include child divisions? | [ASSUMPTION] own unit only | P2 | From access-control spec. |
| B23 | May a requester download the issued letter file? | [ASSUMPTION] yes | P2 | From access-control spec. |
| B15 | Lecturers (`member_type = lecturer`, pembina) cannot hold assignments. What NEXUS access do they get? | [UNKNOWN] | P2 | |

## C. Design (Stitch vs context document)

Details in `docs/design/stitch/comparison.md`.

| # | Question | Status | Priority | Notes |
|---|---|---|---|---|
| C1 | Which design is the source of truth: the original Figma (context doc section 6) or the Stitch redesign? | **[ANSWERED]** 2026-11-06: Stitch (D-014) | - | Stitch changes: flat header (no curve), light drawer (not dark), 8 px buttons (not pills), different hex values. |
| C2 | If Stitch: adopt its exact hex values (`#62431F`, `#C59A27`, `#FFF8F5`...) even though PI-CORE uses `#5A3E1B` / `#C9A227`? | **[ANSWERED]** 2026-11-06: yes, Stitch hex (D-014) | - | Canvas: [ASSUMPTION] `#FBF8F3` (design notes) instead of `#fff8f5` (generated HTML). |
| C3 | Fonts: Playfair Display + Plus Jakarta Sans OK? | **[ANSWERED]** 2026-11-06: yes (D-014) | - | |
| C4 | Member status values: Stitch shows Aktif / Cuti / Alumni / Pembina, PI-CORE has only active/inactive. Show only Aktif / Nonaktif? | **[ANSWERED]** 2026-11-06: only Aktif / Nonaktif (D-019, M1) | - | "Pembina" is shown as a marker for lecturers (M6), not as a status. |
| C5 | Remove "+ Tambah Anggota" from Data Anggota (read-only rule)? | [ASSUMPTION] remove (the Member Data spec already removes it) | P1 | Members are managed in PI-CORE. Not asked separately; follows the read-only decision. |
| C6 | Outgoing letter code `SK` (seen in Stitch `PMK/NEX/SK/2026/012`): correct? | **Provisional** 2026-11-09 (D-024) | P2 | Used for now; the code is a setting. |
| C7 | Borrowing rule "H-3 kegiatan" (request at least 3 days before the event): real rule or Stitch filler? | **[ANSWERED]** 2026-11-07 (D-022, IB4 option a) | - | Filler. No lead time. The Stitch notice (and "Koordinator Logistik") is not adopted. |
| C8 | Meeting status (Selesai / Terjadwal / Mendatang) on the Dashboard: do meetings need a schedule/status field? | [UNKNOWN] | P2 | Not in context doc. |
| C9 | Minutes attachments: PDF/DOCX, max 10 MB? | [ASSUMPTION] yes | P2 | Watch Supabase free-tier storage (1 GB). |
| C10 | Dashboard "Surat Menyurat" card (not in context doc): keep? | [UNKNOWN] | P2 | |
| C11 | Export: Stitch shows mostly PDF; context requires Excel, CSV, PDF. Keep all three? | **[ANSWERED]** 2026-11-06: all three (D-019 M5, D-020) | - | |
| C12 | Real PMK logo file (SVG/PNG) for the header | [ASSUMPTION] 2026-11-09: use PI-CORE's `public/brand/pmk-logo.png` (round PMK ITERA emblem), copied to NEXUS `public/brand/` (D-023) | P1 (UI) | Owner to confirm it is the official logo. Only PNG; an SVG would be sharper. |
| C13 | Login screen: reuse PI-CORE's "Masuk PMK ITERA" design? | **[ANSWERED]** 2026-11-06: reuse structure and wording, Stitch look (D-017) | - | One account for all apps. |
| C14 | Visual polish (D-023): the pilot (Dashboard, catalog) is better but the owner rates it below PI-CORE. When to do the next polish pass and the rollout to the other built screens? | [UNKNOWN] | P1 (UI) | Owner moved on to Letters first (2026-11-09). Reference: `../pi-core-v2/.taste-skill/stitch/final/`. |
| C15 | New copy from the pilot: "Shalom, {nama depan}!", "Kamu masuk sebagai {nama}.", "Ringkasan ini hanya memuat modul yang bisa kamu buka.", catalog "Daftar barang", tiles "Barang", "Unit baik", "{n} dipinjam", "Perlu servis", Data Anggota card texts. | [ASSUMPTION] accepted while in use | P2 | Listed in D-023. |

## B-bis. Effect of D-011 (configurable access)

Since 2026-11-05, B3, B4, B6, B7, B8, B9, B17, B18, B19, B22, B23 are answered as **defaults** (the recommendation in `docs/modules/access-control.md`), changeable by the System Admin. B20 and B21 are **locked rules** (not configurable), with the recommended answer. (Exception: B9 was answered by the owner on 2026-11-06 as option (b), see D-019.) B15 (lecturers): default = regular member; can be widened by a rule only if a rule can target them (they hold no assignments, so not possible) [ASSUMPTION].

| # | Question | Status | Priority | Notes |
|---|---|---|---|---|
| B24 | Who may read the access-rule change log? | [ASSUMPTION] System Admin + BPH | P1 | Transparency check on admin changes. |
| B25 | Should changing a sensitive rule (Finance, Member Data) need a second person's approval? | [ASSUMPTION] no for Phase 1; warning + log only | P2 | Two-person rule is safer but more work. |
| B26 | Child units in rules: (a) include-child-units flag on unit subjects only, "own unit" = exactly one unit; (b) flag + third scope "own unit and its child units"; (c) one shared flag. | **[ANSWERED]** (b)(D-012) | P1 | Spec rev. 2 uses (b); adds a third scope beyond D-011. |
| B27 | Does `manage` include `view`, export separate? | **[ANSWERED]** manage includes view; export needs view(D-012) | P1 | |
| B28 | (1) "Restore missing defaults" action? (2) Rule changes that benefit the admin's own positions? | **[ANSWERED]** (1) yes, re-adds only, never deletes; (2) allowed but marked "self-benefit" in the log(D-012) | P1 | Softens the D-007 weakening. |
| B29 | Only one holder of an approval key and it is their own request? | **[ANSWERED]** locked; wait for a second holder, hint on screen(D-012) | P2 | |
| B30 | PI-CORE roles without a `key` cannot be targeted by role rules. Allow by role id? | **[ANSWERED]** no; use position/unit rules(D-012) | P2 | |
| B31 | Before running the seed on production: check real position/unit names first with a read-only query? | [ASSUMPTION] yes, read-only check first | P0 (before applying) | Seed stops with an error if a name is missing. Query in `supabase/README.md`. |
| B32 | Local development for NEXUS (PI-CORE's local config does not expose `nexus`): (a) ask PI-CORE maintainer to add it; (b) NEXUS gets its own local config + read-only copy of PI-CORE migrations; (c) test with psql only for now. | **[ANSWERED]** 2026-11-06: (b), D-018 | - | |
| B33 | Mark "every active member" rule changes as self-benefit (the admin is also a member)? | [ASSUMPTION] yes | P2 | |
| B34 | Allow enable/disable of a rule directly in the SQL editor (emergency), logged with no actor? | [ASSUMPTION] yes | P2 | Still logged; the log cannot be edited. |
| B35 | Inactive org units: a rule pointing to an inactive unit matches nobody, but an assignment inside an inactive unit still counts. | [ASSUMPTION] confirm | P2 | Spec section 5 and E21 read differently; both implemented this way. |
| B36 | How to apply NEXUS migrations to the shared project without breaking PI-CORE's migration history? | [ASSUMPTION] backup first, then run each file once in the SQL editor (or psql single transaction); never `supabase db push`, `migration repair`, or `db reset` from NEXUS | P0 (before applying) | See `supabase/README.md`. |
| B37 | Known risk (security review W2): PI-CORE position-derived admins (Ketua Umum, Sekjen, Sekum, Kepala Departemen/Biro) can create assignments for themselves in PI-CORE, e.g. fill a vacant Bendahara Umum 2, and NEXUS then grants Finance. Not fixable in NEXUS. Plan: record as accepted risk, tell the PI-CORE maintainer (suggest assignment writes for super_admin only), later add a NEXUS report of self-made assignments from PI-CORE's audit log. | [ASSUMPTION] accept + inform PI-CORE maintainer | P1 | |
| B38 | Hosted project has extra schemas `drizzle` and `pmk_core_v1`. Is hosted `public` really PI-CORE v2? | **[ANSWERED]** 2026-11-05 from `pi-core-v2/docs/OPERATIONS.md` (not verified live) | P0 → re-check before applying | `pmk_core_v1` = PI-CORE v1 tables archived on 2026-11-01 (moved, not deleted; no anon/authenticated access, not exposed). `drizzle` = v1 migration-tool schema (its table was moved too). Hosted `public` = v2 with all 5 migrations ("local = remote" on 2026-11-02). NEXUS must not touch `pmk_core_v1`/`drizzle`. The M2 seed name check before applying acts as the live verification. |
| B39 | "Automatically expose new tables" is ON in the hosted project (shared with PI-CORE). Turn it OFF? | [ASSUMPTION] turn OFF after agreeing with the PI-CORE maintainer | P1 | Supabase recommends OFF. NEXUS and PI-CORE migrations already revoke grants explicitly, so not urgent. |

## D. Working assumptions

| # | Assumption | Status |
|---|---|---|
| D1 | PI-CORE repo = `/home/fycode/Documents/pi-core-v2` | [ASSUMPTION] |
| D2 | Stitch project `projects/15744631264658346759` is the NEXUS design | [ASSUMPTION] |
| D3 | Deactivated PI-CORE members get no NEXUS access at all | [ASSUMPTION] (PI-CORE already bans their Auth login) |

## E. Login and connection

Spec: `docs/modules/auth-login.md` (draft, step 2). Each question has options and a recommendation in the spec, section 11.

| # | Question | Status | Priority | Options and recommendation |
|---|---|---|---|---|
| E1 | What does NEXUS do when a member still has a temporary password (`must_change_password = true`)? Needs an amendment of locked rule L4. | **[ANSWERED]** 2026-11-06: (b), see D-015; L4 amended | - | (a) ignore it; (b) read ONLY the caller's own flag through one narrow function, block the app, send the person to PI-CORE to change the password; (c) as (b) plus database-level denial. Recommendation: **(b)**. NEXUS cannot change the password itself (needs the service role). |
| E2 | Where do password reset and password change happen? | **[ANSWERED]** 2026-11-06: (a), D-016 | - | (a) only in PI-CORE; NEXUS shows a note and a link (PI-CORE has no email delivery); (b) later, if the maintainer adds SMTP; (c) own NEXUS screen (not possible without the service role). Recommendation: **(a)** now. |
| E3 | How long may a NEXUS session last? | **[ANSWERED]** 2026-11-06: (a), D-016 | - | (a) Supabase defaults, same as PI-CORE; (b) app-side idle limit (e.g. 7 days); (c) Supabase session time-box (shared setting, may need a paid plan). Recommendation: **(a)** for Phase 1, revisit when Finance holds real data. |
| E4 | Should a deactivated member and an unlinked account see different messages after login? | **[ANSWERED]** 2026-11-06: (a), D-016 | - | (a) one combined "no access" message; (b) two messages (needs a function that reads inactive rows and reveals status). Recommendation: **(a)**. Changes wording of access-control E11 / AC-33. |
| E5 | Is the NEXUS login screen Indonesian only? | **[ANSWERED]** 2026-11-06: (a), D-016 | - | (a) Indonesian only; (b) Indonesian with an English switch like PI-CORE. Recommendation: **(a)**. |
| E6 | Who checks the live Supabase Auth settings before go-live (sign-up disabled, token lifetime, rate limits, SMTP, CAPTCHA, exposed schemas)? Same check as B12. | [UNKNOWN] | P0 (before go-live) | (a) owner reads dashboard values into `docs/ops/`; (b) PI-CORE maintainer confirms; (c) skip and trust the repo. Recommendation: **(a)**. |
| E7 | Login: cancel a hanging sign-in after 15 seconds and show the network message (design 4.3)? | **[ANSWERED]** 2026-11-06: built | - | The earlier assumption ("not needed") was wrong: QA BUG-A2 showed a hanging request locks the form forever. Timeout added in `src/app/login/login-form.tsx`. |

## F. Security follow-ups from the login review (2026-11-06)

No CRITICAL or HIGH findings. M1 (data-based guard on the local seed and pgTAP file) and L1 (temp-log trap in `scripts/dev-db.sh`) are fixed and verified. Open items:

| # | Item | Status | Priority | Notes |
|---|---|---|---|---|
| F1 | M2: add a Content-Security-Policy (start Report-Only, nonce from `src/proxy.ts`), plus HSTS on the production domain. Reason: auth cookies are readable by scripts (same as PI-CORE, required by the browser client), so any future XSS could steal a long-lived session. | [PLANNED] before go-live | P1 | Owner: devops + frontend. Most important before modules that render user text (letters, minutes). |
| F2 | L2: every protected page and Server Action must call `getAccessState()` itself (layouts do not re-run on client navigation). Add a test or lint that fails when a route skips it. | [PLANNED] with the first module | P1 | Owner: backend + QA. |
| F3 | L3: if PI-CORE ever breaks its `members` read policy, every user sees "Belum ada akses" and is signed out (fail closed, but noisy). | [ASSUMPTION] accepted risk | P2 | Re-check after every PI-CORE migration (schema inspector). |
| F4 | I1: the local stacks (NEXUS and PI-CORE) publish ports on all network interfaces. They hold only fake data and default dev credentials. | [ASSUMPTION] accepted for local dev | P2 | Avoid running them on public Wi-Fi; noted in `docs/ops/local-setup.md`. |
| F5 | Member Data export has no rate limit; each export adds one append-only log row (~80 bytes). | **[ANSWERED]** 2026-11-07: accepted risk for Phase 1 (owner) | P2 | Export is BPH-only and every row names the exporter. Review before go-live; a per-member limit (e.g. 30/hour in the RPC) is the planned fix if needed. |
| F6 | The export route's same-origin check trusts `x-forwarded-host` first. Safe on Vercel (the platform overwrites it); a self-hosted proxy that appends the header would make the first value client-controlled. | [ASSUMPTION] Vercel hosting | P2 | Re-check if NEXUS ever leaves Vercel. App-layer review LOW 4, 2026-11-07. |
| F7 | Local e2e tests briefly change the LOCAL stack (switch period, temporary members, revoke/grant on Member Data functions, a temporary CHECK on the log table) and revert it in global setup/teardown. The local export log keeps growing (append-only). | [ASSUMPTION] accepted for local only | P2 | e2e refuses to run unless the API is the local NEXUS stack. Never point tests at hosted. |

## F-bis. Security follow-ups from the Inventory and Borrowing application review (2026-11-08)

No CRITICAL finding. The HIGH (multipart boundary) and both MEDIUMs (export cut detection, upload cap) are fixed; see `DECISIONS.md` D-022 "Security review of the application layer". Open items:

| # | Item | Status | Priority | Notes |
|---|---|---|---|---|
| F8 | Review LOW 4: the photo check reads only the first bytes (magic bytes), so a file that starts like a JPEG but also holds other content passes. EXIF data (including GPS position) is removed only by the browser resize, not on the server. | [ASSUMPTION] accepted for Phase 1 | P2 | Photos sit in a private bucket and are shown only as `<img>` through short signed links, never served from the app's own address. Fix if needed: re-encode the image on the server. |
| F9 | Review LOW 5: every catalog or borrowing export writes a log row, also one refused as too large, and there is no per-member limit. | [ASSUMPTION] accepted for Phase 1, same as F5 | P2 | Only export-right holders can do it and every row names them. Planned fix if needed: a per-member limit inside the export functions. |
| F10 | Review LOW 6: a refused extension makes up to 12 extra availability calls to find the conflicting date (A-IB53). | [ASSUMPTION] accepted | P2 | Bounded, and only heads (`borrowing.approve`) can extend. |
| F11 | Unused evidence uploads (picked, then the return was never saved) are never deleted. Since migration 20261109100000 they no longer block a request after 24 hours, but they stay in Storage. | [PLANNED] before go-live | P2 | Each at most 1.5 MiB; free tier has 1 GB. Options: a monthly cleanup query in the ops guide, or a scheduled job. Must never touch files attached to a return (those are evidence, L5). |

## G. Member Data assumptions (2026-11-06)

Spec: `docs/modules/member-data.md` section 8 (M1-M8 are answered, D-019). These are the details the owner did not decide; they stay [ASSUMPTION] until confirmed.

| # | Assumption | Status | Priority |
|---|---|---|---|
| A-MD1 | Page size 20; name A-Z sort; no sort controls; search, filters and page kept in the page address. | [ASSUMPTION] | P2 |
| A-MD2 | Unit filter = top-level unit (BPH, department, bureau); divisions fold into their department. Extra filter value "Tanpa jabatan" (no assignment) proposed; needs UX and owner OK. | [ASSUMPTION] | P2 |
| A-MD3 | A deactivated member's unit/position shows what PI-CORE still records for the active period. | [ASSUMPTION] | P2 |
| A-MD4 | Deactivated org units are not offered in the filter, but their members still appear. | [ASSUMPTION] | P2 |
| A-MD5 | Export = all rows matching the current filters, same information as the screen; period label and date in the header; file made on the server, not stored; in exports the "Pembina" marker is its own column and unit and position are separate columns. | [ASSUMPTION] | P2 |
| A-MD6 | No link from a row to the member in PI-CORE. | [ASSUMPTION] | P2 |
| A-MD7 | Interface strings in the spec (empty, error, search placeholder) are proposals. | [ASSUMPTION] | P2 |
| A-MD8 | Primary-assignment tie-break. | **[ANSWERED]** 2026-11-06 | - | Top-level unit order first (division uses its parent department's `sort_order`), then division order, unit name, position name (D-019). |
| A-MD9 | The unit filter matches ANY active-period assignment, not only the primary one. A row may show a different unit than the filter chosen. | [ASSUMPTION] | P1 |
| A-MD10 | Export log readers. | **[ANSWERED]** 2026-11-06 | - | System Admin (fixed) + key `member_data.view_export_log`, default rule D33 for `bph` (D-019). |
| A-MD11 | Export log stores unit id, status, and "search used yes/no", plus the active period id. It does NOT store the search text (a typed email or NIM would become PII in the log). | [ASSUMPTION] | P1 |
| A-MD12 | If the export log row cannot be written, the export is refused. | [ASSUMPTION] | P2 |
| A-MD13 | Department/bureau heads see the full member list (scope "all"), not only their own unit. Follows from M2 (b) and the catalog. | [ASSUMPTION] | P2 |
| A-MD14 | No screen to read the export log is designed yet; without one, BPH cannot read it. Needs a UX design and owner decision. | [UNKNOWN] | P1 |
| A-MD15 | UI copy proposals (in `src/modules/member-data/ui/copy.ts`): forbidden screen "Tidak punya akses" / "Kamu tidak punya akses ke halaman ini. Kalau kamu memerlukannya, hubungi admin PMK ITERA." / "Kembali ke Dashboard"; empty list "Belum ada anggota aktif."; search too long, invalid filter, and export-400 messages; export menu "Unduh semua hasil filter sebagai:", busy "Menyiapkan file...", success "Unduhan dimulai: {file}". Uses "kamu" like the rest of the app. | [ASSUMPTION] | P2 |
| A-MD16 | Pagination buttons keep Stitch's English "Prev" / "Next" (screen readers get "Halaman sebelumnya/berikutnya"). | [ASSUMPTION] | P2 |
| A-MD17 | "Keluar" appears both on the Dashboard placeholder and in the drawer footer; remove the Dashboard one when the Dashboard module is built. Drawer header subtitle "Institut Teknologi Sumatera" (Stitch), Stitch tagline dropped. | [ASSUMPTION] | P2 |
| A-MD18 | Export meta line wording "Diekspor YYYY-MM-DD HH:mm WIB" and "Periode {label}" in XLSX/PDF. | [ASSUMPTION] | P2 |
| A-MD19 | Result box above the table is labelled "Hasil" (follows the filters), not Stitch's "Total". | **[ANSWERED]** 2026-11-07 (owner) | - | |

## H. Inventory and Borrowing assumptions (2026-11-07)

Spec: `docs/modules/inventory-borrowing.md` section 10 (IB1-IB15 are answered, D-022). These are the details the owner did not decide; they stay [ASSUMPTION] until confirmed. Answered and no longer assumptions: A-IB1 (own handover and return allowed, IB2), A-IB4 (one catalog, IB3), A-IB9 (cancel after approval, IB7), A-IB10 (extension, IB5 and A-IB26), A-IB13 and A-IB23 (conditions, IB10), A-IB17 (outside parties, IB15 and A-IB28), A-IB19 (stock held from approval, IB6). Answered or decided in the 2026-11-07 follow-up (D-022): A-IB18, A-IB36, A-IB43, A-IB45 (amended), A-IB47, A-IB48.

| # | Assumption | Status | Priority |
|---|---|---|---|
| A-IB2 | `inventory.manage` also covers the category and location lists. | [ASSUMPTION] | P2 |
| A-IB3 | Lecturers may browse and request like every active member (L9, B15 stays open). | [ASSUMPTION] | P2 |
| A-IB5 | Archived items and units are hidden from members and request forms; visible to managers by filter. | [ASSUMPTION] | P2 |
| A-IB6 | Every stock or condition change writes a history row; a write-off or lost unit needs a note. | [ASSUMPTION] | P1 |
| A-IB7 | A submitted request cannot be edited; cancel and resubmit. | [ASSUMPTION] | P2 |
| A-IB8 | Handover cannot be recorded before the request's start date. | [ASSUMPTION] | P2 |
| A-IB11 | The queue has a "Belum selesai (semua periode)" filter and an open-loans export for period handover (belongs in the new-period guide). | [ASSUMPTION] | P1 |
| A-IB12 | Export header shows period label and export date in WIB, like Member Data. | [ASSUMPTION] | P2 |
| A-IB14 | A head may approve a lower quantity per line, with a note. | [ASSUMPTION] | P2 |
| A-IB15 | One reasoned correction exists: Dikembalikan back to Dipinjam, by a `borrowing.handle` holder. | **[ANSWERED]** 2026-11-07: owner approved with the spec. **Narrowed 2026-11-07:** returns only, once per request, refused if the stock changed since the return; no handover correction | - |
| A-IB16 | Progja can later link to a request by id without a rewrite. | [ASSUMPTION] | P2 |
| A-IB18 | Date ranges are inclusive. A returned item is free again immediately (was: free from D+1). | **[ANSWERED]** 2026-11-07: owner, free immediately | - |
| A-IB20 | Page size 20. | [ASSUMPTION] | P2 |
| A-IB21 | Drawer badge and Dashboard line for waiting approvals are proposals for the Dashboard module. | [ASSUMPTION] | P2 |
| A-IB22 | Members cannot export their own requests. | [ASSUMPTION] | P2 |
| A-IB24 | Request reference format. | **[ANSWERED]** 2026-11-07: `PJM-0001`, one sequence, never reused (owner) | - |
| A-IB25 | The tracking mode of an item (individual or counted) cannot change once it has borrowing history; create a new item instead. | [ASSUMPTION] | P1 |
| A-IB26 | Extending is an approve-type action: needs `borrowing.approve` (heads), is blocked on your own loan (L6), is checked against availability like a new approval, and is logged in an extension history. | [ASSUMPTION] | P1 |
| A-IB27 | Code `INV-0001`: one sequence, never reused, assigned by the database; per unit for tracked items, per item for counted items; archived and lost items keep their code; numbers beyond 9999 just grow. | [ASSUMPTION] | P1 |
| A-IB28 | Outside-party request stores organisation name and contact person name only (no phone or email); the Ops member who records it is the requester of record (so L6 blocks them from approving it); it then follows the normal approval by a head. | **[ANSWERED]** 2026-11-07: owner approved as written (D-022) | - |
| A-IB29 | For individually tracked items the requester picks the item and a quantity; stock is reserved by quantity at approval; the Operations member chooses the specific units (by INV code) at handover. | **[ANSWERED]** 2026-11-07: owner approved with the spec | - |
| A-IB30 | A damaged return states the resulting condition (Perlu servis or Rusak). A lost unit is a write-off: the unit stays in history with status Hilang and its code; for counted items the total drops. | **[ANSWERED]** 2026-11-07: owner approved with the spec | - |
| A-IB31 | Evidence photos: 1 to 3 per damaged or lost line, resized in the browser to a long side of about 1280 px (the database and the bucket accept at most 1.5 MiB each, JPG, PNG or WebP, A-IB43); private bucket; viewable by `borrowing.view_all` holders and the requester; never purged. | [ASSUMPTION] | P1 |
| A-IB32 | Dashboard card counts: units in Baik (including those on loan), units on loan now, units in Perlu servis; archived and lost excluded; Rusak not on the card; exact wording at design time. | [ASSUMPTION] | P2 |
| A-IB33 | Export log: one append-only row per successful export of the catalog or of borrowing (module, who, when, format, filters, period; no PII). Whether it shares the Member Data table is the database engineer's call. Until the log screen exists it is readable only through the database. | [ASSUMPTION] | P2 |
| A-IB34 | A `borrowing.handle` holder may cancel an approved request that was not picked up (reason required), for example when the requester is deactivated. A Diajukan request of a deactivated member is rejected by a head with a note. | [ASSUMPTION] | P2 |
| A-IB35 | Any head of the Operations unit may approve any request (not only for their own division). | **[ANSWERED]** 2026-11-07: owner approved with the spec | - |
| A-IB36 | The new key `borrowing.handle` is treated like `borrowing.approve` in the catalog: not grantable to "every active member", written reason required (L12). `is_sensitive` = false and never baseline. | **[DECIDED]** 2026-11-07: by the database engineer; the reason is in the header of migration `20261107100000_nexus_borrowing_access_rules.sql` | - |
| A-IB37 | Inventory module navigation: four route-based segments (Katalog, Peminjaman Saya, Antrean, Kelola Barang), role-aware; filter card folded on phones (design P1, P3). | [ASSUMPTION] | P2 |
| A-IB38 | Item category and location are optional while the lists are new; one location per item, not per stock row (design P4, G1). | [ASSUMPTION] | P2 |
| A-IB39 | Evidence photos upload when picked; uploaded files never attached to a saved return are not evidence and may be cleaned up (design P8, G5). | [ASSUMPTION] | P2 |
| A-IB40 | Chip colours: Dikembalikan green (same tone as Disetujui); grey chip from Stitch 04 added to the theme (design P9). | [ASSUMPTION] | P2 |
| A-IB41 | A damaged return line records ONE resulting condition (Perlu servis or Rusak); split the line if pieces differ (design P10, G11). | [ASSUMPTION] | P2 |
| A-IB42 | Rejected or cancelled requests offer a prefilled "Ajukan lagi"; detail screen titled "Detail Pengajuan"; a confirm step before saving a return (design P11, P14, P15). | [ASSUMPTION] | P2 |
| A-IB43 | Field length limits and maximum stock numbers. Limits: item name 120 characters, description 1000, purpose and notes 500, category 60, location 80, outside-party names 120; stock 0-9999 per condition; at most 50 lines per request, 200 units per line; 1-3 photos per damaged or lost outcome, 1.5 MiB each (JPG, PNG, WebP); at most 10 unattached uploads per request folder **created in the last 24 hours** (narrowed 2026-11-09, migration 20261109100000, so abandoned uploads stop blocking a request; see F11). Copy may use these numbers instead of {max} (G4). | **[DECIDED]** 2026-11-07: owner (D-022 follow-up); 24-hour window approved 2026-11-08 | - |
| A-IB44 | Category and location lists sort A-Z; no reorder screen (G6). | [ASSUMPTION] | P2 |
| A-IB45 | A written-off (Hilang) unit can be restored ("Ditemukan kembali") through a reasoned correction (G7). **Amended 2026-11-07:** by a holder of `inventory.manage`, and only when the item is active (was: `borrowing.handle`). | **[AMENDED]** 2026-11-07: tech lead decision after the security review (listed in the D-022 follow-up) | - |
| A-IB46 | The requester's timeline shows the names of the approver and the Ops members who recorded handover and return (G8). | [ASSUMPTION] | P2 |
| A-IB47 | Request caps per member: at most 5 open (Diajukan) requests and at most 20 new requests per Jakarta day; an outside-party request counts toward the recorder's caps. | **[ANSWERED]** 2026-11-07: owner (D-022 follow-up) | - |
| A-IB48 | Date cap: `end_date` is at most `start_date` + 365 days, also for extensions (counted from the original start); a longer loan needs a new request. | **[ANSWERED]** 2026-11-07: owner (D-022 follow-up) | - |
| A-IB49 | Detail of A-IB47: the cap of 5 counts Diajukan requests only (not Disetujui or Dipinjam); the cap of 20 counts every request created that Jakarta day, even if it is cancelled later. | [ASSUMPTION] | P2 |
| A-IB50 | Evidence photos are uploaded through a NEXUS server route (not straight from the browser to Storage), so the server can check the real file type before storing it. The browser resizes first, so a file stays under the 1.5 MiB bucket limit and the Vercel request limit. | [ASSUMPTION] tech lead 2026-11-08 | P2 |
| A-IB51 | Signed links to evidence photos expire after 300 seconds (5 minutes). | [ASSUMPTION] tech lead 2026-11-08 | P2 |
| A-IB52 | The original photo may be up to 15 MB before the browser resizes it (design proposal P8b). | [ASSUMPTION] tech lead 2026-11-08 | P2 |
| A-IB53 | When an extension is refused because the item is booked, the server finds the conflicting date with the availability function so the message can say "pada {tanggal}"; if it cannot, the message leaves the date out. | [ASSUMPTION] tech lead 2026-11-08 | P2 |
| A-IB54 | On the item edit screen, location changes of several units are saved one by one (one `inventory_unit_update` per unit), not in one transaction. If one fails, the others stay saved; each change has its own history row and the screen reports the failure. | [ASSUMPTION] tech lead 2026-11-08 | P2 |
| A-IB55 | The Antrean list stays as cards on wide screens (768 px and up); the table layout of design 11.1 for desktop comes later. | [ASSUMPTION] tech lead 2026-11-08 | P2 |

## I. Letters assumptions (2026-11-09)

Spec: `docs/modules/letters.md` (draft for owner approval). Its section 10 holds the owner questions L1-L11 (document generation, request status path, request fields, direct outgoing letters, register status, corrections, go-live numbering, file types and size, requester download (B23), request caps, Dashboard card (C10)). The details below are what the spec assumes without asking; they stay [ASSUMPTION] until confirmed. Related open items: A2 and C6 (numbering, provisional, D-024), A4 (sample formats, needed only if L1 chooses document generation), A6 (request flow design), B17, B23, C10.

| # | Assumption | Status | Priority |
|---|---|---|---|
| A-LT1 | Numbering year = Jakarta calendar year at the moment the number is assigned (not the letter date, not the period); one sequence per type; never reused. Inherited from the D-024 working assumptions. | [ASSUMPTION] | P1 |
| A-LT2 | A request has an optional free-text "Atas nama" (unit or committee) instead of a unit list, because committees are not PI-CORE entities (B7). | [ASSUMPTION] | P2 |
| A-LT3 | The register is the archive; no separate "archive" action or screen (the word in the `letters.manage` key text means files are kept). | [ASSUMPTION] | P2 |
| A-LT4 | Issuing from a request needs only `letter_requests.process`; the issue function creates the register row. Direct registration needs `letters.manage`. | [ASSUMPTION] | P1 |
| A-LT5 | A secretary may issue directly from Diajukan (the Diproses step is optional). | [ASSUMPTION] | P2 |
| A-LT6 | "Processed" in access control L9 means "leaves Diajukan": the requester cancels only while Diajukan. | [ASSUMPTION] | P1 |
| A-LT7 | A request needs an active period; lecturers may request (B15 stays open). | [ASSUMPTION] | P2 |
| A-LT8 | A voided letter cannot be restored; the correction is a new letter with a new number. | [ASSUMPTION] | P1 |
| A-LT9 | A wrong file is withdrawn (kept, visible only to managers), never deleted. | [ASSUMPTION] | P2 |
| A-LT10 | A submitted request cannot be edited; cancel and resubmit. | [ASSUMPTION] | P2 |
| A-LT11 | Voiding the letter behind an issued request leaves the request Diterbitkan with a visible "Nomor dibatalkan" flag. | [ASSUMPTION] | P2 |
| A-LT12 | The numbering settings are edited by the System Admin (logged) and readable by the BPH secretaries; no new permission key. | [ASSUMPTION] | P1 |
| A-LT13 | Signed file links last 300 seconds; at most 10 unattached uploads per member per 24 hours; at most 3 files per letter or request. Storage estimate (about 150 letters a year, about 200 MB a year) is a guess; verify against the 1 GB free tier (C9, F11). | [ASSUMPTION] | P1 |
| A-LT14 | Department and bureau secretaries cannot read the register (B17 default); no confidential flag in Phase 1. | [ASSUMPTION] | P1 |
| A-LT15 | Page size 20; search on number, counterpart and Perihal; the period filter defaults to the active period. | [ASSUMPTION] | P2 |
| A-LT16 | Export header shows the period filter and the export date in WIB, like Member Data. | [ASSUMPTION] | P2 |
| A-LT17 | Members cannot export their own requests; the request list itself is not exportable in Phase 1. | [ASSUMPTION] | P2 |
| A-LT18 | Field limits: Perihal 200 characters, counterpart 150, purpose text 1000, notes and processor notes 500, on-behalf-of 120, counterpart's own letter number 60. | [ASSUMPTION] | P2 |
| A-LT19 | A received date and a letter date cannot be in the future. | [ASSUMPTION] | P2 |
| A-LT20 | A request issued after a period change creates its letter in the ACTIVE period, linked to the old request. | [ASSUMPTION] | P2 |
| A-LT21 | The queue has a filter "Belum selesai (semua periode)" for the period handover. | [ASSUMPTION] | P2 |
| A-LT22 | Progja can later link to a letter by id without a rewrite (letters carry `period_id`). | [ASSUMPTION] | P2 |

