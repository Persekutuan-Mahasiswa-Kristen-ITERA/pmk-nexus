# PMK-NEXUS Decisions Log

Each entry: what was decided, why, and when. Newest at the bottom.
Status tags: **[DECIDED]** final, **[ASSUMPTION]** needs owner confirmation.

---

## D-001 Tech stack [DECIDED]
- **Date:** 2026-11-04 (recorded 2026-11-05)
- **What:** Next.js (App Router) + TypeScript + Tailwind CSS + shadcn/ui, with `@supabase/supabase-js` and `@supabase/ssr`. Hosting: Vercel free tier + Supabase.
- **Why:** Popular, well documented, free to start, works smoothly with Supabase (which PI-CORE already uses). A mobile-first responsive web app needs no app store and is easy to hand over.
- **Source:** `CLAUDE.md` section 4. Note: `docs/PMK-NEXUS-context.md` section 3 still lists the stack as [UNKNOWN]; it needs an update after owner approval.

## D-002 Data and login architecture [DECIDED]
- **Date:** 2026-11-04 (recorded 2026-11-05)
- **What:** Same Supabase project as PI-CORE. NEXUS tables in schema `nexus`. Login through PI-CORE's Supabase Auth (no own login, no public sign-up). No member list stored in NEXUS. PI-CORE is read only, through views or functions, and only from `src/lib/picore/`. Private Storage buckets with signed URLs.
- **Why:** One account for all apps; one source of truth for members; easy migration to a future PI-CORE Integrations API.
- **Source:** `CLAUDE.md` sections 4 and 5; context doc section 3.

## D-003 Installed skills [DECIDED]
- **Date:** 2026-11-05
- **What:** Skills found. `.claude/skills/` (project) does not exist. All skills are in `~/.claude/skills/`:
  - Design / taste: `design-taste-frontend`, `impeccable`
  - Anti-slop (UI and visual): `antislop` (core, always load), `antislop-ui`, `antislop-human`
  - Anti-slop (copy and writing): `antislop-copywriting`, `avoid-ai-writing`, `humanizer`, `no-ai-slop`, `stop-slop`
  - Not relevant to NEXUS: `ffmpeg`, `moviepy`, `remotion-*` (11), `logo-creator`, `logo-design`, `page-mascot`
  - `synced` is NOT a skill: it is a folder without `SKILL.md` (it holds synced plugin skills such as docs, pdf, xlsx).
- **Why:** `CLAUDE.md` section 17 requires recording the exact names. UI work must load the design/taste skill and the anti-slop skills.
- **Agent preload list (owner confirmed 2026-11-05):** `nexus-frontend-engineer` and `nexus-ux-designer` preload `antislop`, `antislop-ui`, `antislop-human`, `antislop-copywriting`, `design-taste-frontend`, `impeccable`, `stop-slop`. The owner requires `antislop`, `design-taste-frontend`, `impeccable`, and `stop-slop` to stay. Removed: `ffmpeg` (unrelated), `synced` (invalid), `avoid-ai-writing`, `humanizer`, `no-ai-slop` (overlap with `stop-slop` and `antislop-copywriting`).

## D-004 Sub-agents verified [DECIDED]
- **Date:** 2026-11-05
- **What:** All nine agent files exist in `.claude/agents/` with valid frontmatter (`name`, `description`, `tools`, `model`): `nexus-backend-engineer`, `nexus-database-engineer`, `nexus-devops-engineer`, `nexus-frontend-engineer`, `nexus-product-analyst`, `nexus-qa-tester`, `nexus-security-reviewer`, `nexus-ux-designer`, `picore-schema-inspector`. There is no `nexus-ui-builder.md`.
- **Why:** Session-start check.

## D-005 PI-CORE repository location [ASSUMPTION]
- **Date:** 2026-11-05
- **What:** The PI-CORE source of truth is `/home/fycode/Documents/pi-core-v2` (git HEAD `d8b6814`). `/home/fycode/Documents/pi-core-artifacts` holds only Android build files (.apk, .aab).
- **Why:** It is the only local folder with `supabase/migrations/`. Owner to confirm.
- **Result:** Schema report saved in `docs/picore/schema-report.md`.

## D-006 Design source snapshot [ASSUMPTION]
- **Date:** 2026-11-05
- **What:** The Stitch project "PMK-NEXUS Dashboard Redesign" (`projects/15744631264658346759`) is the NEXUS design. Snapshot saved in `docs/design/stitch/`. It is the only NEXUS project in Stitch.
- **Why:** Sub-agents cannot use MCP, so they read the design from files.
- **Open:** Whether Stitch or the original Figma is the design to follow (see `OPEN_QUESTIONS.md`). The context document has NOT been changed.

## D-007 NEXUS System Admin = manually appointed only [DECIDED]
- **Date:** 2026-11-05
- **What:** A user is NEXUS System Admin only if their PI-CORE `members.access_level` is `admin` or `super_admin` (set by hand) and the member is active. Organizational positions never grant NEXUS System Admin, even when PI-CORE's `private.is_admin()` returns true through role `organization_admin` (Ketua Umum, Sekjen, Sekum 1/2, Kepala Departemen, Kepala Biro).
- **Why:** Keeps system rights and organizational position separate, as the context doc requires. Avoids giving system-management rights to about 12 position holders every period.
- **Impact (context doc):** `docs/PMK-NEXUS-context.md` sections 2, 3, 4, 7, 8 updated on 2026-11-05 with owner approval (real PI-CORE schema, stack marked decided, access table mapped to real PI-CORE tables).
- **Impact:** NEXUS must NOT reuse `private.is_admin()`.

## D-008 Letters and Minutes: BPH secretaries full, department secretaries limited [DECIDED]
- **Date:** 2026-11-05
- **What:**
  - BPH secretaries (positions Sekretaris Jenderal, Sekretaris Umum 1, Sekretaris Umum 2 in the active period) manage ALL Letters (incoming, outgoing, numbering, archive, processing letter requests) and ALL Meeting Minutes.
  - Department/bureau secretaries (role `sekretaris`: Sekretaris Departemen, Sekretaris Biro) manage ONLY the meeting minutes of their own org unit. They cannot assign letter numbers or edit the letter archive; like other members they can submit letter requests.
- **Why:** Official letter numbering stays in one place (no clashing numbers); departments still record their own meetings.
- **Impact:** Meeting minutes need an owning org unit (`org_unit_id`, PI-CORE `org_units.id`) so RLS can scope department secretaries. BPH secretaries share roles `bph` + `organization_admin` with Ketua Umum, so they can only be identified by POSITION (see D-009). Answers B2.

## D-009 NEXUS-side mapping of special positions and units [DECIDED]
- **Date:** 2026-11-05
- **What:** NEXUS keeps a small settings table in schema `nexus` that says which PI-CORE positions count as "BPH secretary" and which PI-CORE org units count as "Operations" (and later other mappings if needed). It stores PI-CORE IDs (`positions.id`, `org_units.id`), not names. Only the NEXUS System Admin can change it. It is pre-filled at setup with Sekretaris Jenderal, Sekretaris Umum 1, Sekretaris Umum 2, and `Departemen Operasional` (with its divisions Logistik and Akomodasi).
- **Why:** PI-CORE has no stable key for these. IDs survive renames, and NEXUS needs no change to PI-CORE.
- **Risk:** If PI-CORE deletes and recreates a position or unit, the ID changes and the mapping must be updated. The admin screen should warn when a mapped ID no longer exists.
- **Answers:** `OPEN_QUESTIONS.md` B5 and B16.

## D-010 NEXUS reads PI-CORE through its own restricted functions [DECIDED]
- **Date:** 2026-11-05
- **What:** NEXUS creates its own read functions in schema `nexus` (SECURITY DEFINER, fixed `search_path`, owned by `postgres`) that read PI-CORE `public` tables. PI-CORE itself is not changed and nothing is requested from its maintainer for now.
  - Functions return only what the caller is allowed to see, and check the caller's NEXUS permission inside the function.
  - Member data returned is limited to: name, org unit(s) and position(s) in the active period, and active/inactive status. Never email, phone, NIM, or NIP.
  - Per-user permission checks (own assignments, own roles) should run as the caller where possible, since PI-CORE RLS already allows a user to read their own rows.
  - App code calls these functions only from `src/lib/picore/`.
- **Why:** No change to PI-CORE needed; sensitive fields stay hidden; one place to fix when PI-CORE builds its Integrations API.
- **Risk:** SECURITY DEFINER functions bypass PI-CORE RLS. A mistake could leak member data. Mitigation: security review of every such function and RLS tests with each persona.
- **Answers:** `OPEN_QUESTIONS.md` B11 (and B14: NEXUS does not call `private.*`). It reads `members.access_level` directly (through `src/lib/picore/` and a `nexus` function). Answers `OPEN_QUESTIONS.md` B1.

## D-011 Configurable access rules managed by the System Admin [DECIDED]
- **Date:** 2026-11-05
- **What:** NEXUS permissions are NOT hard-coded. They live in an access-rules table in schema `nexus` that the System Admin edits on a settings screen.
  - A rule = one permission (e.g. "view Finance", "manage Letters", "approve Borrowing") granted to a PI-CORE **role** (by `roles.key`), **position** (`positions.id`), or **org unit** (`org_units.id`, optionally limited to a position inside it), plus the baseline "every active member". Rules can be scoped "all records" or "own unit only".
  - Rules always resolve against assignments in the ACTIVE period, so they follow management changes automatically.
  - **No grants to individual members** (they would not follow period changes).
  - The default rule set = the analyst's recommendations in `docs/modules/access-control.md` (owner accepted them as defaults).
  - D-009's mapping table (BPH secretary positions, Operations units) is merged into this rules table.
- **Locked rules (not configurable):** inactive or unlinked members get nothing; System Admin comes only from `members.access_level` (D-007); email, phone, NIM, NIP are never shown (D-010); no permanent delete; nobody approves their own request; records of a non-active period are read-only (except open items).
- **Why:** Owner wants the organization to adjust access without a developer.
- **Risks and mitigations:** a wrong rule can expose Finance; the admin can grant their own position business access, weakening D-007 separation. Mitigation: every rule change is logged (who, when, before/after), shown as a warning on sensitive permissions, and the change log is readable by BPH [ASSUMPTION].
- **Conflicts noted:** `CLAUDE.md` section 6 and context doc section 4 describe a fixed access table; they now describe the DEFAULT rules. `CLAUDE.md` section 6 updated on 2026-11-05 with owner approval to say the table is the default rule set.

## D-012 Access-control spec revision 2 approved [DECIDED]
- **Date:** 2026-11-05
- **What:** `docs/modules/access-control.md` revision 2 is the approved access spec: 20 permission keys, 31 default rules, locked rules L1-L11, rules admin screen behaviour, AC-01..AC-69. Owner accepted the recommendations for B26-B30:
  - B26: unit subjects have an include-child-units flag; scopes are "all", "own unit", "own unit and its child units".
  - B27: `manage` includes `view`; export needs view.
  - B28: a "restore missing defaults" action (re-adds only, never deletes custom rules); rule changes that benefit the admin's own positions are allowed but marked "self-benefit" in the log.
  - B29: self-approval stays locked even with a single holder; screen shows a hint.
  - B30: roles without a `key` cannot be targeted; use position or unit rules.
- **Next:** database engineer writes the migration and RLS for schema `nexus` (files only; the owner reviews and runs them).

## D-013 Sensitive permissions are locked away from the "every active member" baseline [DECIDED]
- **Date:** 2026-11-05
- **What:** Security review finding W3. Permission keys `finance.*`, `member_data.*`, and every `*.manage`, `*.approve`, `*.process` key can NOT be granted to the "every active member" subject; the database rejects it (catalog flag + check in `add_access_rule` + trigger). They can still be granted to a role, position, or org unit, but a written reason (non-empty note) is required for sensitive keys. Every change stays in the log.
- **Why:** The log alone only detects abuse after the fact; this prevents the most dangerous mistakes (e.g. "everyone manages Finance").
- **Impact:** New locked rule (L12) in `docs/modules/access-control.md`; migration and tests updated.
- **Verified:** pgTAP suite 225/225 passed on 2026-11-06 in a throwaway container (see `supabase/tests/README.md`).

## D-014 Design source = Stitch redesign [DECIDED]
- **Date:** 2026-11-06
- **What:** The Stitch project "PMK-NEXUS Dashboard Redesign" (design system "Executive Heritage Modern", snapshot in `docs/design/stitch/`) is the design source of truth for NEXUS, replacing the original Figma description in context doc section 6. This adopts: flat app bar `#62431F` (no curved edge), light side drawer, 8 px buttons and inputs, 12 px cards, pills only for status chips and filter tags, Stitch hex values (primary `#62431F`, ivory `#F0E9DC`, gold `#C59A27`, text `#2C1E11`), fonts Playfair Display (headings) + Plus Jakarta Sans (body, data, forms).
- **Why:** Owner's choice. Stitch is more complete (14 screens, exact colors, fonts, spacing, component rules) than the Figma description.
- **Trade-off accepted:** colors differ slightly from PI-CORE (`#5A3E1B` / `#C9A227`), so the two apps that share one login will look related but not identical.
- **Answers:** `OPEN_QUESTIONS.md` C1; also C2 (use Stitch hex) and C3 (fonts), since they follow from it; A5 (exact colors and fonts) for NEXUS.
- **Still open:** canvas color mismatch inside Stitch (design notes `#FBF8F3` vs generated HTML `#fff8f5`); [ASSUMPTION] use `#FBF8F3` from the design notes. Stitch has no NEXUS login screen (C13). Content questions C4-C11 are not answered by this decision; Stitch filler content (e.g. statuses Cuti/Alumni, "+ Tambah Anggota", "H-3") is not adopted automatically.
- **Pending doc updates (need owner OK):** `docs/PMK-NEXUS-context.md` section 6 and `CLAUDE.md` section 8 still describe the Figma style (curved header, pill buttons, approximate palette).

## D-015 Temporary passwords: block in NEXUS and send to PI-CORE [DECIDED]
- **Date:** 2026-11-06
- **What:** When a logged-in member still has a temporary password (PI-CORE `members.must_change_password = true`), NEXUS shows only a "change your password in PI-CORE" state with a link, and no module data. NEXUS reads the flag through ONE dedicated `nexus` function that answers only about the caller and returns one boolean. NEXUS never changes passwords or the flag itself.
- **Why:** The temporary password was seen by an admin. Ignoring the flag would leave it as a working key into NEXUS (including Finance) until the member opens PI-CORE. NEXUS cannot run its own change-password screen: PI-CORE does it with the service role (`pi-core-v2/src/app/actions/password.ts`), which NEXUS must never hold.
- **Rule change:** locked rule L4 (`docs/modules/access-control.md`) and `supabase/README.md` checklist item 6 now allow this single caller-only exception. The structural pgTAP test must whitelist exactly that function.
- **Known limit:** app-level gate only (same as PI-CORE); a direct API call with the temporary password is not blocked by RLS. Option (c), a database-level block, was rejected for Phase 1 as heavier than PI-CORE itself.
- **Answers:** `OPEN_QUESTIONS.md` E1 (option b).
- **Implemented:** `nexus.my_password_change_pending()` (SECURITY INVOKER, no parameters) in `supabase/migrations/20261106100000_nexus_password_change_pending.sql`. Relies on PI-CORE's own grant and RLS (caller reads only their own active row). Inactive/unlinked return false so the combined no-access message (D-016) wins. App gate order: anonymous > error > no-access > password-pending > member; on error the app shows "Terjadi gangguan" (fail closed). pgTAP 244/244 passed on 2026-11-06 (re-run by the tech lead). Not yet applied to the hosted project.

## D-016 Login details follow PI-CORE [DECIDED]
- **Date:** 2026-11-06
- **What:** Owner accepted the spec recommendations for E2-E5 (`docs/modules/auth-login.md` section 11):
  - E2: password reset and change happen only in PI-CORE. NEXUS shows a short note ("ask the PMK ITERA admin for a temporary password") and a link to PI-CORE. PI-CORE has no email delivery, so no self-service reset exists.
  - E3: session length = Supabase defaults, same as PI-CORE (access token about 1 hour, automatic refresh, session lasts until logout or ban). Revisit an idle limit once Finance holds real data.
  - E4: deactivated and unlinked accounts get one combined message: "Akunmu belum bisa dipakai di NEXUS. Hubungi admin PMK ITERA." Access-control E11 and AC-33 reworded.
  - E5: login screen in Indonesian only.
- **Why:** Same behaviour as PI-CORE; least to maintain at handover; the combined message reveals nothing about account status.

## D-017 Login screen design approved [DECIDED]
- **Date:** 2026-11-06
- **What:** `docs/design/login.md` approved: login, no-access, password-pending, loading-after-login, and generic-error screens in the Stitch style. Owner accepted:
  - Q1 / C13: reuse PI-CORE's login STRUCTURE and WORDING (same account, same words), with the NEXUS Stitch look. Not copied: PI-CORE's palette, curved panel, glow, breathing logo, disabled Google row, English tagline, language switch.
  - Q2: field borders use Stitch outline `#81756A` (Stitch `#D8CCBA` is 1.53:1, fails the 3:1 non-text rule) and field text is 16 px (prevents iOS zoom), on ALL NEXUS forms.
  - Q3: "Buka PI-CORE" opens in a new tab, so "Sudah ganti? Muat ulang" stays open. Spec F6 updated.
  - New strings in design section 2.8 ("Memeriksa akunmu...", "Kata sandimu belum berubah. Ganti di PI-CORE dulu, lalu coba lagi.", error body second sentence, "Masih terjadi gangguan." for screen readers).
- **Not approved (not asked):** showing the signed-in email on the No-access screen. Not built.
- **Added 2026-11-06 (owner OK):** temporary Dashboard placeholder strings "Masuk sebagai {nama}.", the period line, "Belum ada periode aktif.", and a temporary "Keluar" button, until the Dashboard module and side drawer replace them.
- **Still open:** real logo file (C12); the design uses an empty 28 px crest slot. PI-CORE has `public/brand/pmk-logo-192.png`; not reused until the owner decides.

## D-018 NEXUS gets its own local Supabase stack [DECIDED]
- **Date:** 2026-11-06
- **What:** For local development and end-to-end tests, NEXUS runs its own local Supabase stack (own `project_id` and ports, separate from PI-CORE's 54321-54329). PI-CORE's migrations are applied to it READ-ONLY from `/home/fycode/Documents/pi-core-v2/supabase/migrations/` (not copied into NEXUS), then the NEXUS migrations, then local-only test accounts. `nexus` is exposed in NEXUS's own local `config.toml`. PI-CORE's repo and stack stay untouched.
- **Why:** PI-CORE's local config does not expose `nexus`, and NEXUS must never edit the PI-CORE repo. Testing directly on the hosted shared project was rejected (a mistake would hit PI-CORE's real data).
- **Trade-off:** more RAM when both stacks run (laptop has 14 GB); stop PI-CORE's stack while testing NEXUS if needed. Supabase CLI pinned to PI-CORE's version (2.122.0).
- **Rule kept:** never `supabase db push`, `migration repair`, or `db reset --linked` from NEXUS (B36). The local stack is never linked to the hosted project.
- **Answers:** `OPEN_QUESTIONS.md` B32 (option b, now).

## D-019 Member Data module rules [DECIDED]
- **Date:** 2026-11-06
- **What:** Owner answers M1-M8 for `docs/modules/member-data.md`:
  - M1: status = Aktif / Nonaktif from `members.is_active`. The list shows everyone; the Status filter defaults to Aktif, with Nonaktif and Semua selectable. (Answers A8 and C4.)
  - M2 (answers B9): `member_data.view` goes to role `bph` AND role `kepala_departemen` (Kepala Departemen and Kepala Biro), scope "all". This is a new default rule D32 (default rules 31 -> 33 together with D33 below); it is sensitive, so the seed needs a written reason (L12). `member_data.export` stays BPH only (D13). "All active members" stays blocked by L12. D32/D33 are in migration `20261106200000_nexus_member_data.sql` (not yet applied to the hosted project).
  - M3 (answers B10): one PRIMARY assignment per member = lowest `positions.rank`. Column title "Unit / Jabatan": line 1 = unit (a division is written after its department, "Departemen Operasional · Logistik"), line 2 = position; no assignment = "-". Unit filter matches ANY active-period assignment [ASSUMPTION A-MD9]. Tie-break (owner, 2026-11-06, A-MD8): top-level unit order first (a division uses its parent department's `sort_order`), then the division's own order, unit name, position name; same order as the unit filter.
  - M4: no row detail view; the Stitch hint is removed.
  - M5: one "Ekspor" button with a menu of Excel, CSV, PDF; visible only with `member_data.export`.
  - M5b: the Dashboard "Members" count = all members with `is_active = true` (students and lecturers); visible only with `member_data.view`; equals the list total under the default filter.
  - M6: lecturers (`member_type = 'lecturer'`) are listed with a small marker "Pembina". This widens the D-010 field list (name, units, positions, active/inactive) to also include `member_type`, which access-control 7.1 already allowed. Email, phone, NIM, NIP stay forbidden (L4).
  - M7: active period only; no period selector.
  - M8: every export is logged in an append-only NEXUS table: who (`members.id`), when, format, filters used. No update, no delete, no PII. Readers: System Admin (fixed) + BPH through a new sensitive catalog key `member_data.view_export_log` and default rule D33 (owner, 2026-11-06; keys 20 -> 21).
- **Why:** Department and bureau heads need the directory to coordinate their units, while the list stays read-only and free of sensitive fields. One primary assignment keeps rows short on a 390 px screen and counts people, not assignments. Export is the riskiest action (every name in one file), so it stays BPH-only and leaves a trace.
- **Impact:** `docs/modules/access-control.md` amended (D32, row count 32, B9 answered, L4 and catalog text mention the marker, AC-70/71, export log listed in 7.2). The export log is the only NEXUS data stored for this module; NEXUS still keeps no member list. Not yet designed: the screen to read the export log (`docs/modules/member-data.md` section 11).
- **Answers:** `OPEN_QUESTIONS.md` A8, B9, B10, C4.
- **Implemented:** 3303fd3 (database), e108973 (backend), 9f4808a (page and drawer), 2026-11-07, local stack only; not yet applied to the hosted project.

## D-020 Export libraries: write-excel-file + pdfkit [DECIDED]
- **Date:** 2026-11-06
- **What:** Excel (.xlsx) files are generated with `write-excel-file` and PDF files with `pdfkit`, both on the server. CSV is written by our own code (no library). This applies to every module's export, not only Member Data.
- **Why:** Both are small, MIT-licensed, and actively maintained (npm releases in 2026). They give a real downloaded file on every phone, including iPhones, where "print to PDF" is awkward. `exceljs` was rejected: last release 2023 and many transitive dependencies. Browser print-to-PDF was rejected: awkward on iOS and output differs per browser.
- **Trade-off:** two new dependencies; `pdfkit` reads its font data files at run time, so Next.js needs it listed in `serverExternalPackages`.
- **Owner:** chosen 2026-11-06.
- **Implemented:** e108973 (export route and file writers), 2026-11-07. `pdfkit` is in `serverExternalPackages`; PDF fonts are in `src/lib/export/fonts/`.

## D-021 Drawer shows only built modules the user may open [DECIDED]
- **Date:** 2026-11-06
- **What:** The side drawer (Stitch, D-014) lists a module only when (1) the module is built and (2) the user holds that module's view permission (e.g. Data Anggota needs `member_data.view`). Order and icons follow Stitch. Unbuilt modules are not shown at all (no "Segera hadir" items). Dashboard is always shown to an active member.
- **Why:** No menu item leads to an empty or forbidden page; new modules appear by themselves when they ship. Hiding is UI only; every page still checks access on the server (F2) and RLS applies.
- **Owner:** chosen 2026-11-06 (alternatives rejected: all 6 items with disabled ones; no drawer yet).
- **Implemented:** 9f4808a, 2026-11-07 (`src/components/shell/`).

## D-022 Inventory and Borrowing module rules [DECIDED]
- **Date:** 2026-11-07
- **What:** Owner answers IB1-IB15 for `docs/modules/inventory-borrowing.md`:
  - IB1 (d): hybrid items. Each item is individually tracked (one row per unit, own condition) or quantity-based (a count per condition); Ops picks the mode when creating it. The mode cannot change once the item has borrowing history [ASSUMPTION A-IB25].
  - IB2 (b): only the Operations heads (Kepala Departemen Operasional and the Kepala Divisi of its divisions) approve, reject and extend. Any Operations holder hands items over and takes them back. L6 blocks only approve, reject and extend of your own request; recording your own handover and return is allowed (the history shows who recorded it).
  - IB3 (a): one catalog for everything PMK owns, managed by Operations.
  - IB4 (a): no lead time (Stitch's "H-3" is filler, answers C7).
  - IB5 (c): no maximum duration; the heads may extend the end date with a note [A-IB26].
  - IB6 (a): stock is held from approval onward; pending requests hold nothing.
  - IB7 (a): the requester may cancel after approval and before pick-up, with a reason.
  - IB8 (b): a good return is a tick with an optional note; a damaged or lost return needs a note AND a photo. No deposit tracking.
  - IB9 (a): no catalog photos. Photos exist only as evidence for damaged or lost returns: resized in the browser, private bucket, never purged.
  - IB10 (b): categories and locations are lists Ops maintains (add, rename, deactivate), starting empty. Conditions are fixed: Baik, Perlu servis, Rusak; only Baik is lendable; a lost unit is a write-off, not a condition.
  - IB11 (c): automatic code `INV-0001`, one sequence, never reused, assigned by the database: one code per unit for tracked items, one per item for quantity items [A-IB27].
  - IB12 (d): no percentage on the Dashboard card; it shows counts (for example units in good condition, on loan, needing service). Answers CLAUDE.md Q7 / A7: the Stitch "80%" is dropped (design deviation approved by the owner).
  - IB13 (c): exports are logged now (append-only, no PII, like Member Data); the screen to read the log comes later with the Member Data log screen (A-MD14).
  - IB14 (a): in-app status only; contact happens outside NEXUS.
  - IB15 (b): Ops may record a request for an outside party (organisation name and contact person name only); the recording Ops member is the requester of record [A-IB28].
- **Access-control changes (amendment 2026-11-07, `docs/modules/access-control.md`):** `borrowing.approve` now means approve, reject, extend. New key `borrowing.handle` (handover, return, cancel before pick-up on behalf, correction, outside-party requests; includes view_all; power key under L12; not subject to L6). Keys 21 -> 22. Default rule D30 is retired; new rules D34 (Kepala Departemen Operasional approves), D35 (Kepala Divisi approves, child units included), D36 (every Operations holder gets `borrowing.handle`). Active default rules 33 -> 35. L6 narrowed, L9 widened (cancel until pick-up), L12 lists `*.handle`, A-n7 superseded, B4 answered.
- **Why:** The owner wants decisions by the heads but daily work (lending and taking back) by everyone in Operations, one catalog for all items, no invented limits, and no dashboard figure whose meaning nobody can define. Hybrid tracking lets expensive items have a history per unit while cables and stands stay a simple count.
- **Risks and trade-offs:** (1) A holder can falsely record their own return; mitigated only by the append-only history. (2) With heads only as approvers (at most three by default), a head's own request needs another head (B29): if one head is in office, it waits. (3) The DB layer is written and committed (7a8399a, 2026-11-07: `20261107100000_nexus_borrowing_access_rules.sql`, `20261107100100_nexus_inventory_borrowing.sql`, `20261107100200_nexus_inventory_storage.sql`) but NOT applied to the hosted project; until the owner applies it (pre-apply checks: `supabase/README.md` step 10), hosted still follows the old D30 and has no inventory or borrowing tables. Applying the storage migration was approved by the owner on 2026-11-07. Security review of the DB layer: no CRITICAL or HIGH findings; M1-M3 and L1-L6 fixed; review L7 (no export rate limit) accepted, same as F5. (4) Evidence photos are never purged, so they count against the free-tier storage; they are resized and only for damaged or lost items.
- **Owner:** answered 2026-11-07. Spec status: approved; DB layer built 2026-11-07 (not on hosted).
- **Migration status (2026-11-07):** the access-control migration retires D30 (disabled, listed in the new table `nexus.retired_default_rules`; `restore_default_access_rules()` never re-enables it), adds D34-D36 and the key `borrowing.handle` (22 keys; 35 enabled rules plus 1 retired). `borrowing.handle` is NOT sensitive and never baseline (A-IB36, decided by the database engineer; reason in the migration header). The inventory migration has 16 tables and 44 functions. The storage migration creates the private bucket `nexus-borrowing-evidence` (1.5 MiB, JPG/PNG/WebP, 2 policies).
- **Follow-up 2026-11-07 (owner, after the DB layer):**
  - Per member: at most 5 open (Diajukan) requests and at most 20 new requests per Jakarta day. Outside-party requests count toward the recorder's caps.
  - Date cap: `end_date` is at most `start_date` + 365 days; extensions are counted from the original start, and a longer loan needs a new request.
  - A returned item is free again immediately (replaces "free from D+1" in A-IB18).
  - Correction applies only to returns, only once per request, and is refused if the stock changed since the return.
  - Restoring a written-off unit needs `inventory.manage` and an active item (tech lead decision after the security review; replaces `borrowing.handle` in A-IB45).
  - Field limits (A-IB43): item name 120 characters, description 1000, purpose and notes 500, category 60, location 80, outside-party names 120; stock 0-9999 per condition; at most 50 lines per request and 200 units per line; 1-3 photos per damaged or lost outcome, 1.5 MiB each; at most 10 unattached uploads per request folder.
  - `borrowing.handle`: `is_sensitive` = false, never baseline (A-IB36).
- **Design follow-up (2026-11-07, owner):** stock changes only through reasoned dialogs; request reference `PJM-0001`; optional date-availability filter in the catalog; Dashboard card "{n} unit baik, {m} di antaranya sedang dipinjam" + "{k} perlu servis". Design: `docs/design/inventory-borrowing.md` section 23.
- **Answers:** `OPEN_QUESTIONS.md` A7, B4, C7 (and adds section H).
- **Contract follow-up (2026-11-08, owner):** the backend contract (`src/modules/inventory-borrowing/types.ts`) found four gaps between the DB layer and the spec/design. The owner approved one corrective migration that (1) looks a request up by its reference `PJM-0001`, so the design's detail URL `/inventaris/pengajuan/{ref}` stays; (2) hides "Koreksi pengembalian" once the one correction is used and splits the error into "already corrected" and "stock changed"; (3) makes the inventory export hold exactly the rows a manager sees in the catalog (archived and lost units included, with a status column); (4) adds a period filter to the borrowing list and export (spec section 8), for end-of-period reports and handover. Minor technical choices made by the tech lead: `OPEN_QUESTIONS.md` A-IB50..A-IB53.
- **UI copy approved (2026-11-08, owner):** the Indonesian messages the spec and design left open (request caps, 365-day cap, once-only correction, stock changed, previous period, item not lendable, unit on loan, item archived, 50 lines, 200 units, duplicate item, upload refused, not found, no active period), the request timeline labels ("Disetujui oleh {nama}", "Diserahkan, dicatat {nama}", ...) and the item history labels ("Ditambahkan ke katalog", "Dicatat hilang atau dibuang", ...). Errors the UI can never trigger show the generic "Terjadi gangguan. Coba lagi sebentar lagi." The exact strings live in `src/modules/inventory-borrowing/types.ts` (`INVENTORY_ERROR_COPY` and the label maps).
- **UI part B approved (2026-11-08, owner):** the 25 new screen strings of the Operations/BPH screens (queue filter labels, unit archive/restore texts, list confirmations, approve/handover/return validation texts, back links; they live in `src/modules/inventory-borrowing/ui/copy.ts`) and one design deviation: on the head's review, "Setujui" and "Tolak" sit directly under the "Barang dan ketersediaan" card (before "Riwayat", design 11.2 put them after), because they use the approved quantities from that card. Every stock dialog requires a reason (P6); the design's "boleh kosong" on "Tambah jumlah" is superseded. Tech-lead choices: A-IB54, A-IB55.
- **Build status (2026-11-09):** server layer, member screens and Operations/BPH screens built (9916dee, bab9c10, d562e84); QA record in `docs/qa/inventory-borrowing.md` (979c914). Local stack only; none of the inventory migrations (20261107100000, 20261107100100, 20261107100200, 20261108100000, 20261109100000) is applied to the hosted project yet.
- **Security review of the application layer (2026-11-08) and follow-up (2026-11-09):** no CRITICAL finding, no authorization bypass.
  - HIGH: uploads and multipart exports failed in Chrome and Safari (the multipart boundary was lower-cased before parsing). Fixed 88e5408, with a browser-style regression test.
  - MEDIUM (owner approved the fix 2026-11-08): the 1000-row export guard trusted a hard-coded PostgREST `max_rows`, so a lower project setting would serve a cut file. Fixed: the three export functions return `total_count` (migration 20261109100000, 780dc9c) and the server refuses only when fewer rows arrive than counted (0a645ef). An export of exactly 1000 complete rows now works.
  - MEDIUM (owner approved the fix 2026-11-08): abandoned evidence uploads were never cleaned up, so 10 of them locked photo upload for a request for good. Fixed in the same migration: the cap counts only unattached files of the last 24 hours. **Trade-off:** a request folder can now collect more than 10 unused files over several days. Each is at most 1.5 MiB and only `borrowing.handle` holders can upload, so the storage risk is small, but nothing deletes them yet (`OPEN_QUESTIONS.md` F11).
  - LOW, accepted for Phase 1 (tech lead, 2026-11-09): `OPEN_QUESTIONS.md` F8-F10 (no server-side re-encoding of photos, export log growth without a rate limit, up to 12 extra availability calls after a failed extension). The missing Content-Security-Policy predates the module and stays F1.

