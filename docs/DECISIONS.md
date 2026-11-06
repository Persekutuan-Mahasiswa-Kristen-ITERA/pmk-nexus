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

## D-016 Login details follow PI-CORE [DECIDED]
- **Date:** 2026-11-06
- **What:** Owner accepted the spec recommendations for E2-E5 (`docs/modules/auth-login.md` section 11):
  - E2: password reset and change happen only in PI-CORE. NEXUS shows a short note ("ask the PMK ITERA admin for a temporary password") and a link to PI-CORE. PI-CORE has no email delivery, so no self-service reset exists.
  - E3: session length = Supabase defaults, same as PI-CORE (access token about 1 hour, automatic refresh, session lasts until logout or ban). Revisit an idle limit once Finance holds real data.
  - E4: deactivated and unlinked accounts get one combined message: "Akunmu belum bisa dipakai di NEXUS. Hubungi admin PMK ITERA." Access-control E11 and AC-33 reworded.
  - E5: login screen in Indonesian only.
- **Why:** Same behaviour as PI-CORE; least to maintain at handover; the combined message reveals nothing about account status.
