# QA: Finance / Keuangan

Spec: `docs/modules/finance.md` (criteria FN-01..FN-40, flows F1-F8, rules R1-R18, owner decisions K1-K6, amendments A-FN1..A-FN21). Decisions: D-026, D-027, D-028. Contract: `src/modules/finance/types.ts`.
Last updated 2026-11-11. Format follows `docs/qa/letters.md`. Code under test: commits `c499dc0` (server layer and screens) and `d0c7ff7` (drawer, Dashboard card, route allow-list), on top of the contract commit `5259772` and the database migrations `20261111200000` and `20261111200100`.

**Status: NOT cleared for the hosted project.** The database and server layers are tested and the code review found nothing CRITICAL or HIGH (section 5). Three things the spec asks for are still open: a browser click-through at 390 px (FN-36), end-to-end tests for Finance, and the owner's approval with a backup (R13). Section 6 lists what was not run.

## 1. How to run

| What | Command | Notes |
|---|---|---|
| Unit tests | `pnpm test` | No stack needed. 788 tests in 25 files on 2026-11-11 (Finance: `finance-types.test.ts` 48, `finance-server.test.ts` 36). |
| Typecheck, lint, build | `pnpm run typecheck`, `pnpm run lint`, `pnpm run build` | All clean on 2026-11-11. Lint has 0 warnings. The build lists `/finance`, `/finance/[id]`, `/finance/catat`, `/finance/saldo-awal`, `/api/finance/export` and `/api/finance/proofs`. |
| pgTAP (database) | Throwaway container, see below | Never on the dev stack (port 55431): the files refuse to run next to `@nexus.test` accounts. |

pgTAP recipe (also in `supabase/tests/README.md`), as it was run on 2026-11-11:

```bash
docker run -d --rm --name nexus-test -e POSTGRES_PASSWORD=postgres -p 54399:5432 public.ecr.aws/supabase/postgres:17.11.0.003
# wait for pg_isready, then PI-CORE migrations, then the Storage stand-in, then all NEXUS migrations in file order
docker exec -i nexus-test psql -U supabase_admin -d postgres -X -q -1 -v ON_ERROR_STOP=1 < supabase/tests/support/storage_stub.sql
PGOPTIONS='-c nexus.allow_destructive_tests=yes' psql "postgresql://postgres:postgres@127.0.0.1:54399/postgres" -X -At -f supabase/tests/nexus_finance.test.sql
```

Load the Storage stand-in before the NEXUS migrations, otherwise the Storage policy tests are skipped. The container was stopped afterwards and is no longer listed.

## 2. Test layout

| File | Covers |
|---|---|
| `supabase/tests/nexus_finance.test.sql` | 328 pgTAP tests, one persona per criterion: structure and privileges, RLS, the guards (immutability, no delete), every function, the export and its log, the Storage policies, period switch. **328/328 passed, 0 skipped.** |
| `supabase/tests/nexus_access_control.test.sql` | 247/247 passed on the same database (the engine the Finance keys depend on). |
| `tests/unit/finance-types.test.ts` | The contract: money parsing and range, Rp 0 for Saldo awal only, the Jakarta date, error mapping, prefill helpers, capabilities. |
| `tests/unit/finance-server.test.ts` | The server layer with a fake database client: error mapping fails closed; the gate runs before the RPC on every read and write; the amount travels as digit text; replayed save is a success; signed link only for a proof the database listed, 300 s; upload route (own folder, random name, magic bytes, mixed-case boundary, cross-site, size cap, extra fields, 405); export route (POST only, CSRF, export AND view, cut answer, form fallback); writers (WIB time, integer cells, formula neutralised). |
| `tests/unit/static-rules.test.ts` | Route allow-list (now lists the Finance pages and routes); every page, route and Server Action checks the session itself; no service-role key; RPC and table access only inside `src/lib/picore/`. |
| `tests/unit/nav-and-cn.test.ts` | Drawer: Finance appears for `finance.view` only, before Surat Menyurat; not for a units grant, the export key alone, or System Admin alone. |

There is no `tests/e2e/finance-*.spec.ts` yet.

## 3. Criteria map (spec section 11)

"pgTAP" = `nexus_finance.test.sql` (named in a test's description). "unit" = the Vitest files above. "none" = no test refers to it; the note says what covers it instead, if anything.

| Criterion | Covered by | Note |
|---|---|---|
| FN-01 Treasurer can record, void, add proof, export | pgTAP, unit (types, server) | |
| FN-02 BPH reads and exports, cannot write | pgTAP, unit (server: writes refused without `finance.manage`) | |
| FN-03 Personas without a key get nothing, no drawer item | pgTAP, unit (nav) | |
| FN-04 Previous-period, inactive, unlinked, anonymous get nothing | pgTAP, unit (types) | |
| FN-05 Finance keys never to everyone, never without a reason (L12) | pgTAP | Rule lives in the access engine. |
| FN-06 Disabled default rules remove the power at once | pgTAP | |
| FN-07 Treasurer deactivated mid-session | pgTAP | |
| FN-08 Amount rules (whole number, range, Rp 0) in form, server, database | pgTAP, unit (types, server) | |
| FN-08a Saldo awal Rp 0 | pgTAP, unit (types) | |
| FN-09 Integer type, exact total of 10,000 x Rp 1 | pgTAP | The server and export code have no `Number(` on money (section 5). |
| FN-10 Total formula, void excluded | pgTAP | |
| FN-11 Negative balance shown, not blocked | pgTAP, unit (server: negative is text) | The hint wording is untested in a browser. |
| FN-12 No future date, Jakarta date at 23:30 UTC | pgTAP, unit (types, server) | |
| FN-13 Saved entry cannot change | pgTAP | |
| FN-14 Nothing deletes entry, proof, history or log | pgTAP | |
| FN-15 Void: reason, Aktif only, no restore, no second void | pgTAP, unit (server: needs a reason) | |
| FN-16 Old period cannot be voided or given proof; correction links | pgTAP | The detail screen hides the void button and offers "Buat koreksi" for an old period; not clicked in a browser. |
| FN-17 Double submit saves one entry | pgTAP, unit (server: replayed = success) | The submit key is made in `record-form.tsx`; not clicked in a browser. |
| FN-18 Number assigned by the database, never reused, no clash | pgTAP | |
| FN-19 One history row per action, immutable | pgTAP | |
| FN-20 One Aktif Saldo awal per period | pgTAP, unit (server: opening is never a correction) | |
| FN-21 Previous closing balance is a hint, never a prefill | pgTAP | The screen shows it with "Pakai angka ini" only when the digits exist; a negative balance cannot be used. Not clicked. |
| FN-22 Period is the active one, never input; banner without one | pgTAP, unit (server) | |
| FN-23 Period switch | pgTAP | Dashboard card and period select after a switch are not clicked. |
| FN-24 Date outside the period warns, does not block | none | Logic in `isOutsideFinancePeriod` (contract) and the check sheet in `record-form.tsx:417`. No automated test names it. |
| FN-25 File type, size and count, real type from the first bytes | pgTAP, unit (server: upload route) | |
| FN-26 Private bucket, signed link 300 s, view holders only | pgTAP, unit (server: link) | |
| FN-27 Withdrawn proof: record and file stay, managers only, "Tanpa bukti" filter | pgTAP | |
| FN-28 Export button and call need `finance.export` and view | pgTAP, unit (server: export route) | |
| FN-29 Export matches the screen; summary, WIB, voided marked, integers | pgTAP, unit (server: writers) | Row count against the screen is not compared end to end. |
| FN-30 Formula neutralised in CSV and Excel | pgTAP, unit (server: writers) | |
| FN-31 One log row per successful export, none otherwise, no PII | pgTAP | |
| FN-32 Row limit | pgTAP, unit (server: cut answer, too_many_rows) | |
| FN-33 Dashboard card for view holders, error inside the card | pgTAP | Card render is built and compiled; not seen in a browser. |
| FN-34 No email, phone, NIM, NIP; names only through PI-CORE | pgTAP | |
| FN-35 RLS per persona, no direct write grant | pgTAP | |
| FN-36 390 px, 44 px fields, 16 px text, numeric keypad, tabular numbers | none | **Not tested.** Classes are in the code; nobody has looked at the screens. |
| FN-37 `<script>` shows as text | pgTAP (data) | The UI has no `dangerouslySetInnerHTML` or `innerHTML` (section 5). |
| FN-38 Entries of a deactivated recorder keep the name | pgTAP | |
| FN-39 Self-contained, `period_id` on every entry | none | Holds by schema (`finance_entries.period_id`); no test names it. |
| FN-40 Security review closed, no CRITICAL or HIGH | this file, section 5 | Review done on code and database; see section 5 for what stays open. |

## 4. Run record (2026-11-11)

| What | Result |
|---|---|
| `pnpm run typecheck` | Clean. |
| `pnpm run lint` | Clean, 0 warnings. |
| `pnpm run test` | 788 passed, 25 files. |
| `pnpm run build` | Succeeds; the six Finance routes are listed. |
| pgTAP `nexus_finance.test.sql` | 328 ok, 0 not ok, 0 skipped (plan 1..328). |
| pgTAP `nexus_access_control.test.sql` | 247 ok, 0 not ok, 0 skipped. |
| Hosted project | Nothing applied. |

## 5. Security review (spec FN-40, R13)

Method: read the code and the migrations as they are, and ran searches over the repo (checklist in the module-build skill). Not a penetration test.

**Result: no CRITICAL, no HIGH, no MEDIUM.** Findings:

| # | Severity | Finding | Where | Action |
|---|---|---|---|---|
| S1 | LOW | `pnpm audit --prod` reports 2 issues (1 low `deepmerge`, 1 moderate `minimatch`), both through the `shadcn` package. `shadcn` sits under `dependencies` in `package.json` but no file under `src` or `tests` imports it, so the issue does not reach the running app. | `package.json:32` | Move `shadcn` to `devDependencies`. Not a Finance bug; affects the whole app. |
| S2 | INFO | `src/modules/finance/server/actions.ts` starts with `"use server"` (like Minutes and Letters). Safe: every action goes through `gate()` and the page wrapper in `src/app/(app)/finance/actions.ts` calls `getAccessState()` first, so the static rule passes. | `server/actions.ts:1` | None. An earlier working note said the line was removed; it was not. |
| S3 | INFO | Texts that the contract does not hold are in `ui/copy.ts` and are not yet recorded as assumptions. | `ui/copy.ts` | Record them in `docs/OPEN_QUESTIONS.md` (list below). |

What was checked and found sound:

- **Tables:** RLS on all five tables; no client write grant; `finance_export_logs` has neither policy nor grant; sequences revoked.
- **Functions:** all 11 API functions are `security definer` with `search_path = ''`; `_fn_*` helpers are revoked from `authenticated`; grants come from a final block over an explicit name list.
- **Writes:** permission check first, active-period check, lock on the counter, idempotency lookup under that lock, one history row per action. A reused key with other values is refused (`idempotency_conflict`).
- **Export:** the log row is written in the same transaction as the rows; `finance.view` is checked as well as `finance.export` (pgTAP R15); more than the cap is refused before any log row.
- **Storage:** private bucket, 5 MiB, three types, no UPDATE or DELETE policy, folder must be the caller's own member id, upload cap of 10 unattached per 24 h, read policy delegates to `finance_proof_can_read`. The migration stops if a conflicting bucket or an unscoped policy already exists.
- **App code:** no service-role key or admin client in Finance code; storage paths stay inside `lib/picore` and the server layer; upload and export check same-origin first, cap the body, check magic bytes (upload) and use the user's own client; export is POST only; no amount passes through `Number(`, `parseInt` or `parseFloat` (the only `Number(` hits are for dates and page numbers); `console.*` logs codes only; no `dangerouslySetInnerHTML`, `innerHTML` or `eval`.

## 6. What was NOT run

- **No browser run of any Finance screen.** FN-36 (390 px, keyboard, numeric keypad), the "Cek dulu" sheet, the upload with progress and image resizing, "Lihat" opening a new tab, the Dashboard card, and the void and withdraw sheets have only been compiled.
- **No Finance e2e tests** (no `tests/e2e/finance-*.spec.ts`), so the app is not exercised against a real local stack with the persona accounts. Storage is off on the local dev stack, so uploads can only be tested up to the Storage call there.
- **No test against the hosted project.** R13 still applies: backup first, the owner's approval.
- The signed link was tested with a fake Storage client and the pgTAP Storage stand-in, not against real Supabase Storage.
- FN-24 and FN-39 have no test; FN-36 has none.

## 7. Open before the hosted project (R13, FN-40)

1. Click through every screen at 390 px as P-BEND, P-KETUM and a persona without a key, and write the results in this file.
2. Add `tests/e2e/finance-*.spec.ts` on the pattern of `tests/e2e/surat-*.spec.ts` (persona matrix, record, void, correction, export against the screen).
3. Add a test for FN-24 and FN-39, or record that the contract covers them.
4. Move `shadcn` to `devDependencies` (S1).
5. Record the GAP texts as assumptions in `docs/OPEN_QUESTIONS.md` (list below).
6. Backup, the owner's approval, then apply the two migrations to the hosted project.

## 8. Texts the screens needed that the contract does not hold (to record as [ASSUMPTION])

All are in `src/modules/finance/ui/copy.ts`: network failure "Tidak bisa terhubung. Periksa internetmu lalu coba lagi."; "Menyimpan..."; "Muat ulang"; search label "Cari transaksi"; loading captions "Memuat transaksi..." and "Memuat finance..."; picker states "Memperkecil...", "Mengunggah {n}%", "Terunggah", "Tunggu sampai semua berkas selesai diunggah.", "Berkas ini tidak bisa dibaca. Pilih berkas lain."; accessible names "Ringkasan keuangan periode" and "Jenis transaksi"; "Rp" prefix; "(aktif)" in the period select; table column headers; "Bukti: {n} berkas"; "Saldo akhir periode sebelumnya minus, jadi tidak bisa dipakai sebagai angka awal."; "Saldo awal"; the form subtitles "Catatan keuangan tidak bisa diubah setelah disimpan." and "Dicatat sekali per periode, dari hitungan kas dan saldo bank yang sebenarnya."; and the not-found text "Transaksi ini tidak ditemukan." on the detail page.
