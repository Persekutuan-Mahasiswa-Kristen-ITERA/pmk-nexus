# src/lib/picore

THE ONLY place in NEXUS that reads PI-CORE data (members, roles, positions, periods, assignments). No other file may query PI-CORE tables, views, or functions directly. Why: when PI-CORE publishes its official Integrations API, only this folder needs to change. Rules: read through PI-CORE views or functions only, never write to PI-CORE, and never assume its schema (check the PI-CORE migrations first).

This includes the `nexus` RPCs that read PI-CORE tables on the caller's behalf (`supabase/README.md` section 3): they are PI-CORE-backed, so they are called from here too.

## What lives here

| File | Exports | Reads | Used by |
|---|---|---|---|
| `context.ts` | `readMyContext`, `readPasswordChangePending`, `readMyPermissions`, type `PicoreRead<T>` | `nexus.my_context()`, `nexus.my_password_change_pending()`, `nexus.my_permissions()` | `src/lib/auth/session.ts` only (AUTH-41) |

## Rules for code in this folder

1. Server only (`import "server-only"`). Always call with the USER's session client (`src/lib/supabase/server.ts`), never a service role client (NEXUS has none).
2. Validate every answer with zod. An unexpected shape, a database error, or an exception returns `{ ok: false }`; the caller turns that into the "error" state (fail closed). An error is never read as "no access", `false`, or "member".
3. Map snake_case rows to the camelCase types in `src/lib/auth/types.ts` (or the module's `types.ts`).
4. Log only the function name and the error code. Never tokens, user ids, emails, or row data.
5. Never read email, phone, NIM, NIP, or any other column the `nexus` functions do not return (D-010, L4).
