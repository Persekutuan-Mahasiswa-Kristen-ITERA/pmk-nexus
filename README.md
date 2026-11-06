# PMK-NEXUS

Administration and operations system of PMK ITERA (Persekutuan Mahasiswa Kristen, Institut Teknologi Sumatera).

NEXUS is meant to handle inventory and borrowing, letters, meeting minutes, finance records, and a member directory for the organization. It is one app in an ecosystem built around **PI-CORE**, the organization's master record of members, positions, periods, and assignments.

How NEXUS relates to PI-CORE:

- Same Supabase project, but NEXUS keeps its own tables in a separate schema called `nexus`.
- NEXUS only reads PI-CORE. It never changes PI-CORE tables or data.
- Login uses the PI-CORE account. NEXUS has no sign-up and no member list of its own.
- What a person may do in NEXUS follows their assignments in the active PI-CORE period.

Project language: code, database names, and documentation are in English. The app screens are in Indonesian.

## 1. Status (2026-11-06)

Built:

- Login with the PI-CORE account, session handling, and the screens for "no access", "change your password in PI-CORE first", and errors.
- The access engine in the database: permission catalog, 31 default access rules, change log, and functions that answer "may this person do X". Spec: `docs/modules/access-control.md`.
- Automated tests: unit, end-to-end, and database tests (see section 5).
- A local development stack with fake test accounts.

Not built yet (Phase 1 modules): Dashboard (only a placeholder page exists), Member Data, Inventory and Borrowing, Letters, Meeting Minutes, Finance, the access-rules settings screen, the side drawer navigation. Program-of-work (progja) is planned for after Phase 1.

Not deployed: there is no Vercel project yet (section 6).

## 2. Tech stack

| Part | Choice | Why |
|---|---|---|
| App | Next.js (App Router), TypeScript, React | Popular, well documented, one codebase for pages and server code. |
| Styling | Tailwind CSS, shadcn/ui | Fast to build; colors live in one file (`src/app/globals.css`). |
| Database and login | Supabase (Postgres, Auth), through `@supabase/supabase-js` and `@supabase/ssr` | PI-CORE already uses it, so one account works in all apps. |
| Hosting | Vercel free tier (app) and Supabase (database) | Free to start. Watch the free-tier limits (database size, storage, project pausing after inactivity). |
| Tests | Vitest, Playwright, pgTAP | Same versions as PI-CORE where possible. |
| Package manager | pnpm 10 | Pinned in `package.json`. |

Dependencies are kept few on purpose, so the next officers can maintain the project.

## 3. Folder map

| Folder | What is in it |
|---|---|
| `src/app/` | Pages: `login/` and the signed-in area `(app)/`. |
| `src/components/` | Shared screens and UI pieces (`auth/`, `shell/`, `ui/`). |
| `src/lib/picore/` | The ONLY place that reads PI-CORE data. See `src/lib/picore/README.md`. |
| `src/lib/auth/` | Session check and access state. See `src/lib/auth/README.md`. |
| `src/lib/supabase/` | Supabase clients and cookie handling. |
| `src/modules/` | One folder per future module. Empty for now. See `src/modules/README.md`. |
| `supabase/migrations/` | SQL for schema `nexus` (3 files). |
| `supabase/local/` | Fake test accounts, local stack only. |
| `supabase/tests/` | Database tests (pgTAP). |
| `scripts/dev-db.sh` | Starts and manages the local database stack. |
| `tests/unit/`, `tests/e2e/` | Vitest and Playwright tests. |
| `docs/` | All documentation (section 9). |

## 4. Run it on your computer

Full guide with prerequisites, test accounts, and common errors: [`docs/ops/local-setup.md`](docs/ops/local-setup.md). Short version, after installing Node 24, pnpm 10, Docker, and cloning `PMK-NEXUS` and `pi-core-v2` next to each other:

1. `pnpm install`
2. `pnpm db:start` (starts the local database with fake data; first run takes several minutes)
3. `pnpm db:status` (prints the local API URL and publishable key)
4. `cp .env.example .env.local`, then paste the key into `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
5. `pnpm dev`, then open http://localhost:3100
6. Sign in with a fake account, for example `member.regular@nexus.test` (the password is in the local setup guide)
7. When done: `pnpm db:stop`

Other scripts: `pnpm build`, `pnpm start`, `pnpm lint`, `pnpm typecheck`, `pnpm db:migrate` (apply new migration files locally), `pnpm db:reset` (deletes the LOCAL database and rebuilds it; local only).

The local stack listens on all network interfaces with default passwords. Do not run it on public Wi-Fi.

## 5. Tests

| Kind | Command | Needs | Last recorded result |
|---|---|---|---|
| Unit (Vitest) | `pnpm test` | nothing | 242 passed, 2026-11-06 |
| End to end (Playwright) | `pnpm test:e2e` | local stack running, `.env.local` set, `pnpm build` done | 83 passed, 1 skipped (opt-in outage test), about 6 minutes, 2026-11-06 |
| Both | `pnpm test:all` | same as e2e | |
| Database (pgTAP) | see `supabase/tests/README.md` | a THROWAWAY database container | 244 of 244 passed, 2026-11-06 |

Notes:

1. The e2e tests refuse to run unless the API is the local NEXUS stack (`127.0.0.1:55431`).
2. The pgTAP file inserts test people into PI-CORE tables and must never run on the hosted project or on the NEXUS dev stack. Use the throwaway container described in `supabase/tests/README.md`.
3. Test plan, persona matrix, manual checklist, and known issues: `docs/qa/auth-login.md`.
4. Before you commit: `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test`.

## 6. Deploying (honest state)

Nothing is deployed yet.

1. **Vercel**: no project, no environment variables, no deploy guide. To be written (`docs/ops/`). When it is set up, the app needs only `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and `NEXT_PUBLIC_PICORE_URL` (see `.env.example`).
2. **Database**: the three migrations in `supabase/migrations/` must be applied to the shared hosted project by hand, by the owner, following `supabase/README.md` section 2. In short: confirm the target project, take a backup, apply each file with `psql -1` (one transaction), run the checks, only then add `nexus` to "Exposed schemas". There is no record in `docs/ops/` that any file has been applied yet.
3. **Never** run `supabase db push`, `supabase migration repair`, `supabase db reset`, or `supabase link` from this repo. NEXUS and PI-CORE share one migration history table, and these commands can break PI-CORE. The reasons are in `supabase/README.md`.

Open go-live items (details in `docs/OPEN_QUESTIONS.md`):

| Item | What | Where recorded |
|---|---|---|
| E6 / B12 | Check the live Supabase Auth settings: sign-up disabled, token lifetime, rate limits, SMTP, CAPTCHA, exposed schemas. Write the values into `docs/ops/`. Not done. | `OPEN_QUESTIONS.md` E6, B12 |
| Exposed schemas | Add `nexus` to "Exposed schemas" after the migrations, copying the existing list first (the setting is shared with PI-CORE), then smoke-test PI-CORE. | `supabase/README.md` section 1 |
| B31 / B36 | Run the read-only name check before the second migration; apply migrations by the procedure above. | `OPEN_QUESTIONS.md` B31, B36 |
| F1 | Add a Content-Security-Policy (start in report-only mode) and HSTS on the production domain. Planned, not done. | `OPEN_QUESTIONS.md` F1 |
| F2 | Every protected page and Server Action must check access itself; add a test that fails when one does not. A static test exists for the current files; keep it green as modules are added. | `OPEN_QUESTIONS.md` F2 |
| B37 | Known risk: PI-CORE position holders who are PI-CORE admins can create assignments for themselves in PI-CORE, and NEXUS then grants the matching access. Not fixable inside NEXUS. The PI-CORE maintainer should be told. | `OPEN_QUESTIONS.md` B37 |
| B39 | "Automatically expose new tables" is on in the hosted project. Decide with the PI-CORE maintainer whether to turn it off. | `OPEN_QUESTIONS.md` B39 |
| Manual checks | Real-phone, password-manager, screen-reader, and PI-CORE round-trip checks on a hosted preview. Not done. | `docs/qa/auth-login.md` section 6 |
| Logo | The real PMK logo file is still missing. | `OPEN_QUESTIONS.md` C12 |

Backup and restore: the only documented step is the `pg_dump` command in `supabase/README.md` (section 2 step 2, and section 6 for the access-rule audit copy). A full backup and restore guide, including Storage files, is to be written. Backups contain PI-CORE personal data (names, emails, phone numbers). Store them encrypted, outside the repo and outside shared folders.

## 7. Handover and new period

What happens by itself:

1. When the PI-CORE admin switches the active period in PI-CORE, NEXUS access changes on the next request. NEXUS reads the active period from PI-CORE and keeps no copy.
2. Members who leave are deactivated in PI-CORE. They lose NEXUS access.

What the next officers must do or check:

1. **System Admin**: the only way to become NEXUS System Admin is a PI-CORE admin setting `members.access_level` to `admin` or `super_admin` by hand. Holding a position such as Ketua Umum never grants it. Check at every handover who holds it, and remove it from people who left.
2. **Dashboard access to Supabase**: whoever can open the Supabase dashboard or SQL editor has full control over access rules and their change log (`supabase/README.md` section 6). Give it to as few people as possible and remove it from outgoing officers. Rotate any database password that outgoing officers knew.
3. **Access rules**: the 31 default rules are set up by the migration. The screen where the System Admin edits them is not built yet, so for now changes need the database engineer and the SQL editor. Rules point to PI-CORE roles, positions, or org units, never to individual people.
4. **Names in PI-CORE**: the default rules were created by looking up PI-CORE position and unit names once. If PI-CORE renames or recreates a position or unit, check that the rule still matches. The rules screen is meant to warn about this.
5. **Re-check PI-CORE after each of its migrations**: run the schema inspector and compare with `docs/picore/schema-report.md`.
6. Keep PI-CORE and NEXUS owners talking: NEXUS shares one Supabase project with PI-CORE.

Guides still to be written: "how to start a new period" for NEXUS, Vercel deploy guide, full backup and restore guide, settings-screen user guide.

## 8. Safety rules

1. Never put the Supabase service role (secret) key in NEXUS code, Vercel, or any file. NEXUS runs only with the public key and the signed-in user's session, so Row Level Security always applies.
2. Never edit PI-CORE tables, data, or its repository from NEXUS work. NEXUS reads PI-CORE only through `src/lib/picore/`.
3. Never run destructive commands (drop, truncate, reset, force push) on the shared hosted project. Back up first, and ask the owner.
4. Test databases and test accounts (`@nexus.test`) are throwaway and local. Never create them on the hosted project.
5. Backups and dumps contain personal data. Keep them encrypted and out of git (`*.dump` is already ignored).
6. Never commit `.env.local` or any real key.
7. Every table in schema `nexus` has Row Level Security on. New tables follow the checklist in `supabase/README.md` section 7.

## 9. Where to find things

| Need | File |
|---|---|
| Goals, access rules, features, UI summary | `docs/PMK-NEXUS-context.md` |
| Decisions (what, why, when) | `docs/DECISIONS.md` |
| Unanswered questions and active assumptions | `docs/OPEN_QUESTIONS.md` |
| Module specs | `docs/modules/` (`access-control.md`, `auth-login.md`) |
| PI-CORE tables as they really are | `docs/picore/schema-report.md` |
| Design (Stitch snapshot, login design) | `docs/design/` |
| Local setup | `docs/ops/local-setup.md` |
| Database, migrations, hosted apply procedure | `supabase/README.md`, `supabase/tests/README.md` |
| Test plan and results | `docs/qa/auth-login.md` |
| Agent working rules | `CLAUDE.md` |

Rule of thumb: if a decision changes, update `docs/DECISIONS.md` first, then the document that describes it.
