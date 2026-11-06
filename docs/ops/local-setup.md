# Local setup (run NEXUS on your own computer)

Goal: open PMK-NEXUS at http://localhost:3100 on your laptop. Nothing here touches production.

NEXUS runs its **own local Supabase stack** (decision D-018): a private copy of Supabase on your laptop, separate from PI-CORE's local stack. It has real login (Auth), the PI-CORE tables, the NEXUS tables, and fake test accounts. Nothing here touches production or PI-CORE.

Analogy: PI-CORE's local stack is the main kitchen. NEXUS gets its own small practice kitchen next door, with the same recipes (PI-CORE's migrations) read from the main kitchen's shelf, so you can cook and burn things without touching the real one.

## 1. Prerequisites

Install these once:

1. **Node.js 24** (check: `node -v`). Download from https://nodejs.org.
2. **pnpm 10** (check: `pnpm -v`). Install: `npm install -g pnpm@10`.
3. **Docker Desktop** (or Docker Engine). The local stack runs inside Docker. Open it and wait until it says "running".
4. **Git**, and a clone of both repositories **next to each other**: `PMK-NEXUS` and `pi-core-v2` (PI-CORE), for example both inside `Documents/`. NEXUS only *reads* PI-CORE's migration files from there. If your PI-CORE clone is elsewhere, run commands with `PICORE_REPO=/path/to/pi-core-v2 scripts/dev-db.sh start`.
5. You do **not** need to install the Supabase CLI. The script downloads the exact version (2.122.0, same as PI-CORE) through `pnpm dlx`. `psql` is not needed either (the script uses the database container).

## 2. Start the NEXUS local stack

1. Open a terminal in the PMK-NEXUS folder.
2. Run `scripts/dev-db.sh start`. The first run downloads images (several minutes). Later runs take about 30 seconds.
3. The script does four things in order:
   1. starts the containers with an **empty** database;
   2. applies PI-CORE's 5 migrations, read from `../pi-core-v2/supabase/migrations/` (nothing is copied into this repo);
   3. applies NEXUS's migrations from `supabase/migrations/`;
   4. adds the fake test accounts (`supabase/local/seed_test_accounts.sql`).
4. At the end it prints the **API URL** (`http://127.0.0.1:55431`) and the **publishable key**. Show them again any time with `scripts/dev-db.sh status`.
5. Running `start` again is safe: only files that are new are applied (the script remembers them in a small table `local_dev.applied_files`).

Other commands:

| Command | What it does |
|---|---|
| `scripts/dev-db.sh status` | Shows API URL and publishable key. |
| `scripts/dev-db.sh migrate` | Applies only new migration files (use after you or a teammate add a NEXUS migration). |
| `scripts/dev-db.sh psql` | Opens a SQL prompt on the local NEXUS database. |
| `scripts/dev-db.sh stop` | Stops the containers. Data is kept; `start` brings it back. |
| `scripts/dev-db.sh reset` | **Deletes the local NEXUS database** and rebuilds it from scratch (asks you to type `yes`). Local only; use it when the data is messy. |

Why the script and not plain `supabase start`: NEXUS migrations need PI-CORE's tables to exist first. So `supabase/config.toml` turns the CLI's automatic migrations and seed **off** (`[db.migrations] enabled = false`, `[db.seed] enabled = false`) and the script applies everything in the right order. Because the `nexus` schema does not exist yet when the containers boot, the API container briefly reports "unhealthy"; the script starts with `--ignore-health-check`, then restarts the API container after the migrations and waits until it answers.

## 3. Test accounts (fake, LOCAL ONLY)

All accounts use the same dev password: **`NexusLocal2026`**. Emails end in `@nexus.test` so they can never be real people. Active period: **2026/2027** (2025/2026 also exists, inactive).

| Email | Persona | What to expect |
|---|---|---|
| `member.regular@nexus.test` | Active regular member (Staff, division IT) | Normal login, limited access. |
| `member.temppw@nexus.test` | Active member, `must_change_password = true` (Staff, Desain) | Should see the "change password first" gate. |
| `member.inactive@nexus.test` | Deactivated member (was Staff, Pubdok) | Login works, but NEXUS sees "no access". |
| `unlinked@nexus.test` | Auth account with no member row | Login works, but NEXUS sees "no access". |
| `ketum@nexus.test` | BPH Ketua Umum | BPH access (view all modules). Not a System Admin. |
| `bendahara@nexus.test` | Bendahara Umum 1 | Finance rights. |
| `admin@nexus.test` | System Admin (`access_level = 'admin'`, no position) | Manages the system. |

Never use these emails or the password anywhere except this local stack. The seed file refuses to run unless `nexus.allow_local_seed=yes` is set, which only the local script does.

## 4. Create your `.env.local`

1. Run `cp .env.example .env.local` in the PMK-NEXUS folder.
2. Run `scripts/dev-db.sh status` and copy the values:
   - `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:55431`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=` the publishable key printed by `status`
3. Never add a service role / secret key. `.env.local` is ignored by git, but keep it private anyway.
4. The key changes only if you delete the stack's Docker data; if login suddenly says "Invalid API key", run `status` again and re-copy.

## 5. How this differs from PI-CORE's own local stack

| | PI-CORE stack (`pi-core-v2`) | NEXUS stack (`PMK-NEXUS`) |
|---|---|---|
| Project name | `pi-core-v2` | `pmk-nexus` |
| Ports | 54320-54329 | 55430-55439 (API 55431, DB 55432, mail 55434) |
| Containers | `supabase_*_pi-core-v2` | `supabase_*_pmk-nexus` |
| Exposed API schemas | `public` | `public` and `nexus` |
| Migrations | applied by `supabase start` | applied by `scripts/dev-db.sh` (PI-CORE's files first, then NEXUS's) |
| Test accounts | `pnpm seed:dev-users` in PI-CORE (`@example.com`) | `@nexus.test`, from `supabase/local/seed_test_accounts.sql` |
| Studio dashboard | on | off (saves RAM; use `scripts/dev-db.sh psql`, or set `enabled = true` in `[studio]` of `supabase/config.toml`) |

The two stacks can run at the same time. Their data is completely separate: a person created in one does not exist in the other.

RAM tip (measured 2026-11-06): the NEXUS stack uses about 250 MB (5 containers: database, login, API gateway, REST, mail catcher). PI-CORE's stack with Studio uses about 620 MB. Both together is under 1 GB, so there is no need to stop PI-CORE. If the laptop is slow, run `scripts/dev-db.sh stop` when you are not working on NEXUS. Realtime, Storage, analytics, and edge functions are switched off in `supabase/config.toml` (with comments); turn Storage on when a feature needs files.

## 6. Safety rules (read once)

1. Never edit, start, stop, or reset anything in the PI-CORE repo or its stack from NEXUS work. The script only *reads* PI-CORE's migration files.
2. Never link this local stack to a hosted project. Never run `supabase link`, `db push`, `migration repair`, or `db reset --linked` from this repo.
3. Never write a real key or a real URL into a committed file. The service role (secret) key of the local stack stays inside the Docker containers; the script never prints it or saves it. NEXUS code must never use it (see `.env.example`).
4. `reset` and `stop --no-backup` delete only the local `pmk-nexus` data. They are fine here and nowhere else.
5. The test accounts are fake and local. Never create them on the hosted project.

## 7. Install and run

1. `pnpm install` (downloads dependencies; only needed the first time or after `package.json` changes).
2. `pnpm dev` (starts the app on port **3100**).
3. Open http://localhost:3100. For now you should see the text "PMK-NEXUS".
4. Stop with `Ctrl+C`.

Port 3100 is used because PI-CORE itself uses 3000. The NEXUS stack's login settings (`supabase/config.toml`) allow redirects to `http://localhost:3100`.

## 8. Checks before you commit

```bash
pnpm lint                 # code style problems
pnpm exec tsc --noEmit    # TypeScript errors
pnpm build                # make sure a production build works
```

## 9. Common errors

| Problem | Likely cause | Fix |
|---|---|---|
| `Docker is not running` / `Cannot connect to the Docker daemon` | Docker is not running | Open Docker Desktop, wait until it is running, retry. |
| `port is already allocated` on `scripts/dev-db.sh start` | Something else uses ports 55430-55439 | Find it with `docker ps`, stop it, retry. Do not change PI-CORE's stack. |
| `PI-CORE migrations: Folder not found` | PI-CORE clone is not next to PMK-NEXUS | Run with `PICORE_REPO=/path/to/pi-core-v2 scripts/dev-db.sh start`. |
| `API did not become ready` | A migration failed or the API container crashed | Read the error printed above it; run `docker logs supabase_rest_pmk-nexus`. If the data is only test data, `scripts/dev-db.sh reset`. |
| Login works but the app shows "no access" | The account is the unlinked/inactive persona, or the stack was reset | Use `member.regular@nexus.test`; run `scripts/dev-db.sh status` and recopy the key. |
| `Port 3100 is in use` | Another NEXUS dev server is still running | Close that terminal (Ctrl+C), then retry. |
| Login or data calls fail later with "Invalid API key" | Wrong or empty key in `.env.local` | Re-copy the key from `supabase status`. Restart `pnpm dev` after editing `.env.local`. |
| Change in `.env.local` has no effect | Next.js reads env files only at startup | Stop and start `pnpm dev` again. |
| `pnpm: command not found` | pnpm not installed | `npm install -g pnpm@10`. |
| Wrong Node version errors | Node older than 20 | Install Node 24 and reopen the terminal. |
| `ERR_PNPM_...` after pulling new code | Dependencies changed | Run `pnpm install` again. |

If you are stuck, write down the exact error text and ask the tech lead; do not delete folders or reset databases to "try something".

## Network note (security review I1)
The local Supabase containers (NEXUS and PI-CORE) listen on all network interfaces, with default development passwords. They hold only fake test data, but do not run them on public Wi-Fi (campus hotspot, café). Stop them with `pnpm db:stop` when you are done.
