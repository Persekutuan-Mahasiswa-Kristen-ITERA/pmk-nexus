# Local setup (run NEXUS on your own computer)

Goal: open PMK-NEXUS at http://localhost:3100 on your laptop. Nothing here touches production.

NEXUS has no database of its own for login. It uses the **PI-CORE local stack** (a copy of Supabase running on your laptop), so PI-CORE must be running first.

## 1. Prerequisites

Install these once:

1. **Node.js 24** (check: `node -v`). Download from https://nodejs.org.
2. **pnpm 10** (check: `pnpm -v`). Install: `npm install -g pnpm@10`.
3. **Docker Desktop** (or Docker Engine). The Supabase local stack runs inside Docker. Open it and wait until it says "running".
4. **Supabase CLI** (check: `supabase --version`). See https://supabase.com/docs/guides/local-development/cli/getting-started.
5. **Git**, and a clone of both repositories: `PMK-NEXUS` and `pi-core-v2` (PI-CORE).

## 2. Start the PI-CORE local stack

1. Open a terminal in the PI-CORE folder (`pi-core-v2`).
2. Run `supabase start`. The first run downloads images and can take several minutes.
3. Run `supabase status`. Note the **API URL** (normally `http://127.0.0.1:54321`) and the **publishable (anon) key**.
4. Do NOT run `supabase db reset` or any migration in the PI-CORE folder for NEXUS work. PI-CORE is read-only for us.

## 3. Create your `.env.local`

1. Open a terminal in the PMK-NEXUS folder.
2. Run `cp .env.example .env.local`.
3. Open `.env.local` and fill in:
   - `NEXT_PUBLIC_SUPABASE_URL` (the API URL from step 2.3)
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (the publishable/anon key from step 2.3)
4. Never add a service role / secret key. `.env.local` is ignored by git, but keep it private anyway.

## 4. Install and run

1. `pnpm install` (downloads dependencies; only needed the first time or after `package.json` changes).
2. `pnpm dev` (starts the app on port **3100**).
3. Open http://localhost:3100. For now you should see the text "PMK-NEXUS".
4. Stop with `Ctrl+C`.

Port 3100 is used because PI-CORE itself uses 3000, and PI-CORE's local login settings already allow redirects to `http://localhost:3100`.

## 5. Checks before you commit

```bash
pnpm lint                 # code style problems
pnpm exec tsc --noEmit    # TypeScript errors
pnpm build                # make sure a production build works
```

## 6. Common errors

| Problem | Likely cause | Fix |
|---|---|---|
| `Cannot connect to the Docker daemon` on `supabase start` | Docker is not running | Open Docker Desktop, wait until it is running, retry. |
| `port is already allocated` on `supabase start` | Another Supabase stack is running | Run `supabase stop` in the other project, or stop the old container. |
| `Port 3100 is in use` | Another NEXUS dev server is still running | Close that terminal (Ctrl+C), then retry. |
| Login or data calls fail later with "Invalid API key" | Wrong or empty key in `.env.local` | Re-copy the key from `supabase status`. Restart `pnpm dev` after editing `.env.local`. |
| Change in `.env.local` has no effect | Next.js reads env files only at startup | Stop and start `pnpm dev` again. |
| `pnpm: command not found` | pnpm not installed | `npm install -g pnpm@10`. |
| Wrong Node version errors | Node older than 20 | Install Node 24 and reopen the terminal. |
| `ERR_PNPM_...` after pulling new code | Dependencies changed | Run `pnpm install` again. |

If you are stuck, write down the exact error text and ask the tech lead; do not delete folders or reset databases to "try something".
