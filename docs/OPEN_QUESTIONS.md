# PMK-NEXUS Open Questions and Active Assumptions

Last updated: 2026-11-05.
Tags: **[UNKNOWN]** no answer yet, **[ASSUMPTION]** working guess that needs confirmation, **[ANSWERED]** resolved (move the decision to `DECISIONS.md`).
Priority: **P0** blocks the next step, **P1** blocks a specific module, **P2** can wait.

---

## A. From CLAUDE.md section 14

| # | Question | Status | Priority | Notes |
|---|---|---|---|---|
| A1 | Final name: PMK-NEXUS or PI-NEXUS? | [UNKNOWN] | P2 | Stitch screens use "PMK-NEXUS". |
| A2 | Exact letter numbering rules: outgoing code (e.g. `SK`), yearly reset, who assigns numbers? | [UNKNOWN] | P1 (Letters) | Only `PMK/NEX/SM/2026/001` is known. |
| A3 | List of PMK departments and organizational structure | **Partly answered** | P1 | PI-CORE seeds 7 departments, 1 bureau, 16 divisions (`docs/picore/schema-report.md` section 8). Owner to confirm this matches reality. |
| A4 | Sample official letter formats | [UNKNOWN] | P1 (Letters) | |
| A5 | Exact Figma colors and fonts | [UNKNOWN] | P1 (UI) | Stitch has exact values (see section C), but they differ from the context doc. Which design wins? |
| A6 | Designs for login, letter request flow, borrowing request flow | [UNKNOWN] | P1 | See section C for what Stitch contains. PI-CORE's Stitch project has login screens ("Masuk PMK ITERA") that could be reused. |
| A7 | Meaning of "Inventory Status 80%" | [UNKNOWN] | P2 (Dashboard) | Stitch labels it "Barang Siap Pakai" (items ready to use). |
| A8 | Meaning of member "Status" in Member Data | **Likely answered** | P1 (Member Data) | PI-CORE has only `members.is_active` (active/inactive) + `deactivated_at`. Owner to confirm. |

## B. PI-CORE schema (from `docs/picore/schema-report.md`)

| # | Question | Status | Priority | Why it matters |
|---|---|---|---|---|
| B1 | Who is "System Admin" in NEXUS? | **[ANSWERED]** 2026-11-05 | - | Only manually appointed `access_level` `admin` or `super_admin`. Positions never grant it. See `DECISIONS.md` D-007. |
| B2 | Who manages Letters and Meeting Minutes? | **[ANSWERED]** 2026-11-05 | - | BPH secretaries: everything. Department/bureau secretaries: only their own unit's minutes. See `DECISIONS.md` D-008. |
| B3 | Treasurer = only Bendahara Umum 1/2 (role `bendahara`)? | [ASSUMPTION] yes | P1 (Finance) | No department-level treasurers exist in PI-CORE. |
| B4 | "Operations Department Head and staff" = Kepala Departemen of `Departemen Operasional` + Kepala Divisi + Staff of its divisions `Logistik` and `Akomodasi` (+ Sekretaris Departemen?) | [ASSUMPTION] | P1 (Inventory) | There is no "Operations" role; NEXUS must match the org unit. |
| B5 | How to identify `Departemen Operasional` safely? | **[ANSWERED]** 2026-11-05 | - | NEXUS-side settings table storing PI-CORE org unit IDs. See `DECISIONS.md` D-009. |
| B6 | "BPH view all" = everyone holding role `bph` (Ketua Umum, Sekjen, Sekum 1/2, Bendahara Umum 1/2)? | [ASSUMPTION] yes | P1 | |
| B7 | Committee (panitia): needed in NEXUS? PI-CORE has no such role. | [UNKNOWN] | P2 | Context doc lists "Committee" as a role. |
| B8 | Regular member (G7) = EVERY active member (baseline rights; officers get more on top). What do they see? Spec recommends: own requests + read-only inventory catalog + dashboard cards they may open. | [ASSUMPTION] | P1 | PI-CORE has no "anggota" role. See `docs/modules/access-control.md`. |
| B9 | Member Data: which roles may see the member list, and which fields (name, department, status; never email/phone/NIM/NIP)? | [UNKNOWN] | P1 (Member Data) | PI-CORE deliberately hides the directory from regular members. NEXUS would expose it through a SECURITY DEFINER function. |
| B10 | "Department" column when a member has several assignments: show all, or one primary (lowest `rank`)? | [UNKNOWN] | P1 (Member Data) | |
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
| C4 | Member status values: Stitch shows Aktif / Cuti / Alumni / Pembina, PI-CORE has only active/inactive. Show only Aktif / Nonaktif? | [ASSUMPTION] only Aktif / Nonaktif | P1 | NEXUS cannot invent statuses it does not store. |
| C5 | Remove "+ Tambah Anggota" from Data Anggota (read-only rule)? | [ASSUMPTION] remove | P1 | Members are managed in PI-CORE. |
| C6 | Outgoing letter code `SK` (seen in Stitch `PMK/NEX/SK/2026/012`): correct? | [UNKNOWN] | P1 (Letters) | Same as A2. |
| C7 | Borrowing rule "H-3 kegiatan" (request at least 3 days before the event): real rule or Stitch filler? | [UNKNOWN] | P1 (Inventory) | |
| C8 | Meeting status (Selesai / Terjadwal / Mendatang) on the Dashboard: do meetings need a schedule/status field? | [UNKNOWN] | P2 | Not in context doc. |
| C9 | Minutes attachments: PDF/DOCX, max 10 MB? | [ASSUMPTION] yes | P2 | Watch Supabase free-tier storage (1 GB). |
| C10 | Dashboard "Surat Menyurat" card (not in context doc): keep? | [UNKNOWN] | P2 | |
| C11 | Export: Stitch shows mostly PDF; context requires Excel, CSV, PDF. Keep all three? | [ASSUMPTION] keep all three | P2 | |
| C12 | Real PMK logo file (SVG/PNG) for the header | [UNKNOWN] | P1 (UI) | Stitch uses placeholders. |
| C13 | Login screen: reuse PI-CORE's "Masuk PMK ITERA" design? | [UNKNOWN] | P1 | One account for all apps. |

## B-bis. Effect of D-011 (configurable access)

Since 2026-11-05, B3, B4, B6, B7, B8, B9, B17, B18, B19, B22, B23 are answered as **defaults** (the recommendation in `docs/modules/access-control.md`), changeable by the System Admin. B20 and B21 are **locked rules** (not configurable), with the recommended answer. B15 (lecturers): default = regular member; can be widened by a rule only if a rule can target them (they hold no assignments, so not possible) [ASSUMPTION].

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
| B32 | Local development for NEXUS (PI-CORE's local config does not expose `nexus`): (a) ask PI-CORE maintainer to add it; (b) NEXUS gets its own local config + read-only copy of PI-CORE migrations; (c) test with psql only for now. | [ASSUMPTION] (c) now, (b) when frontend starts | P1 | |
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
| E1 | What does NEXUS do when a member still has a temporary password (`must_change_password = true`)? Needs an amendment of locked rule L4. | [UNKNOWN] | P0 (before the login build) | (a) ignore it; (b) read ONLY the caller's own flag through one narrow function, block the app, send the person to PI-CORE to change the password; (c) as (b) plus database-level denial. Recommendation: **(b)**. NEXUS cannot change the password itself (needs the service role). |
| E2 | Where do password reset and password change happen? | [ASSUMPTION] (a) | P1 | (a) only in PI-CORE; NEXUS shows a note and a link (PI-CORE has no email delivery); (b) later, if the maintainer adds SMTP; (c) own NEXUS screen (not possible without the service role). Recommendation: **(a)** now. |
| E3 | How long may a NEXUS session last? | [ASSUMPTION] (a) | P2 | (a) Supabase defaults, same as PI-CORE; (b) app-side idle limit (e.g. 7 days); (c) Supabase session time-box (shared setting, may need a paid plan). Recommendation: **(a)** for Phase 1, revisit when Finance holds real data. |
| E4 | Should a deactivated member and an unlinked account see different messages after login? | [ASSUMPTION] (a) | P1 | (a) one combined "no access" message; (b) two messages (needs a function that reads inactive rows and reveals status). Recommendation: **(a)**. Changes wording of access-control E11 / AC-33. |
| E5 | Is the NEXUS login screen Indonesian only? | [ASSUMPTION] (a) | P2 | (a) Indonesian only; (b) Indonesian with an English switch like PI-CORE. Recommendation: **(a)**. |
| E6 | Who checks the live Supabase Auth settings before go-live (sign-up disabled, token lifetime, rate limits, SMTP, CAPTCHA, exposed schemas)? Same check as B12. | [UNKNOWN] | P0 (before go-live) | (a) owner reads dashboard values into `docs/ops/`; (b) PI-CORE maintainer confirms; (c) skip and trust the repo. Recommendation: **(a)**. |
