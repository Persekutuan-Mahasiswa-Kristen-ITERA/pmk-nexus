# src/modules/finance (Finance / Keuangan)

Cash book per period: Pemasukan, Pengeluaran and one Saldo awal per period, totals computed by the database, void with a reason (never edit), linked corrections for old periods, optional proof files, export with a whole-period summary, and the numbers for the Dashboard card. SENSITIVE (money).
Spec: `docs/modules/finance.md` (approved 2026-11-09, K1-K6 a; amended 2026-11-10: Saldo awal may be Rp 0). Decision: D-028.
Database: `supabase/migrations/20261111200000_nexus_finance.sql` (9 public `nexus.finance_*` functions + 2 storage checks) and `20261111200100_nexus_finance_storage.sql` (bucket `nexus-finance-proofs`). Reference: `supabase/README.md` section 3.4.

Status (2026-11-10): **contract round 1** (`types.ts`). Server layer and screens not built yet.

## Money rules in code

- Amounts travel as **text of ASCII digits** end to end (`"1250000"`), exactly what `_fn_parse_amount` accepts. No `Number()` on the way in, no float anywhere.
- `checkRupiahAmount` / the record schema: `1..9999999999` for income and expense, `0..9999999999` for Saldo awal (owner 2026-11-10). Refused: `00`, `007`, `-0`, `+0`, `0.0`, decimals, separators, spaces, letters, non-ASCII digits. More than 10 digits = `amount_too_large`.
- Display: `groupRupiahDigits("1234567")` = `1.234.567`; `formatRupiah` = `Rp 1.234.567` / `-Rp 250.000` / `Rp 0`; `formatEntryAmount` adds `+` (income) or `-` (expense), none for Saldo awal.
- Input: the field shows `rupiahInputDisplay(raw)` while typing; the form sends `normaliseRupiahInput(fieldValue)`. A comma, minus or letter is never silently dropped (`1.234,50` stays as typed and is refused).
- Database answers (bigint as JSON numbers) are checked to be safe integers and turned into text by the section 8 schemas. `rupiahToSafeInteger` exists only for CSV numbers and Excel integer cells. Never pass money TEXT to the CSV writer: `-250000` would be read as a formula start and prefixed with an apostrophe.
- Submit key: one new uuid each time the check sheet opens ("Lanjut"); retries and double taps resend the same key and values (the database replays the first entry, `replayed = true`).

## Layout (planned)

| Path | Runs on | What |
|---|---|---|
| `types.ts` | both | **The contract**: limits, routes, enums, money helpers, zod inputs, database answer schemas, error union + hint map + mappers + Indonesian copy, labels, export columns, helpers, `financeCapabilities()`. Change only via the tech lead |
| `server/reads.ts` | server | `listFinancePeriods`, `getFinanceSummary`, `listFinanceEntries`, `getFinanceEntryDetail` |
| `server/actions.ts` | server | Server Actions: `recordFinanceEntry`, `voidFinanceEntry`, `addFinanceProof`, `withdrawFinanceProof`, `getFinanceProofLink` |
| `server/proofs.ts` | server | Upload handler for `POST /api/finance/proofs` (magic bytes, own folder, cap) |
| `server/export.ts` | server | `POST /api/finance/export` (xlsx / csv / pdf, `total_count` cut check, summary block) |
| `ui/` | both | Screens (frontend engineer) |

RPC wrappers and every Storage call go in `src/lib/picore/finance.ts` (the functions read PI-CORE names and periods; CLAUDE.md 4).

## Entry points and the right each needs

| Entry point | Needs | RPC |
|---|---|---|
| `listFinancePeriods`, `getFinanceSummary`, `listFinanceEntries`, `getFinanceEntryDetail` | `finance.view` | `finance_period_list`, `finance_summary`, `finance_entry_list`, `finance_entry_detail` |
| `recordFinanceEntry` | `finance.manage` + active period | `finance_entry_record` |
| `voidFinanceEntry`, `addFinanceProof`, `withdrawFinanceProof` | `finance.manage`, Aktif entry of the active period | `finance_entry_void`, `finance_entry_add_proof`, `finance_entry_withdraw_proof` |
| `getFinanceProofLink` | `finance.view` (withdrawn proofs: `finance.manage`) | detail RPC + signed URL (policy `finance_proof_can_read`) |
| `POST /api/finance/proofs` | `finance.manage` + active period | Storage upload with the user's client (policy `finance_proof_can_upload`) |
| `POST /api/finance/export` | `finance.export` + view | `finance_export` (writes the export log) |

Every entry point: session + capability first, zod validation (`financeErrorFromZod`), ONE RPC with the user's client, answer parsed with the section 8 schema, refusals mapped only through `financeErrorFromDb` (fail closed), never throws, returns `FinanceResult<T>`. The System Admin role gives nothing here (B18); only the finance keys count, scope "all".

## Contract choices (tech lead may overrule; none changes money, access or retention)

- Routes: `/finance`, `/finance/[id]`, `/finance/catat` (`?correct=` / `?again=`), `/finance/saldo-awal` (`?again=`), as spec screen 1 writes `/finance`.
- "Catat ulang" of a voided Saldo awal opens the opening form, not the income/expense form.
- "Pakai angka ini" is offered only when the previous closing balance is 0 or more (no amount is ever negative); the hint line still shows a negative number.
- "Tanpa bukti" with "Tampilkan yang dibatalkan" on also lists voided entries without proof (database `_fn_rows`; supabase/README.md 3.4 says "Aktif entries", the summary count is Aktif only).
- `entry_voided` and `idempotency_conflict` show "Data sudah berubah. Muat ulang." (spec states table); `opening_exists` shows the screen 4 sentence.
- The check sheet's `{jumlah}` is `groupRupiahDigits` (the sentence carries "Rp"); the opening hint uses `formatRupiah` so a negative closing balance reads "-Rp ...".

## Copy not in the spec (gap texts, listed for the owner)

Reused from approved modules: "Berkas ini sudah terpasang. Pilih berkas lain.", "Berkas tidak ditemukan. Muat ulang halaman.", "Berkas tidak bisa dibuka. Coba lagi.", "Tanggal akhir tidak boleh sebelum tanggal mulai.", "Terlalu banyak unggahan dalam 24 jam. Coba lagi nanti.", "Kata pencarian terlalu panjang. Pakai paling banyak 120 karakter.", "Ekspor ditolak karena filter tidak cocok. Muat ulang halaman, lalu coba lagi.", "Tulis kenapa berkas ini ditarik.", "Pilih minimal satu berkas.", "Boleh menambah {n} berkas lagi.", "Berkas ditarik.", chip "Ditarik".

New: "Pilih tanggal transaksi.", "Tanggal transaksi tidak valid.", "Transaksi ini tidak ditemukan.", "Transaksi yang dikoreksi sudah dibatalkan. Muat ulang halaman.", "Transaksi periode lama hanya bisa dibaca." (proof actions on an old period), "Dikoreksi lewat {nomor}", "Bukti ditarik oleh {nama}", "Alasan: {alasan}" (history second line), "Ada bukti" (paperclip name), "Bukti ditambahkan." (notice), export headers ("No", "Nomor", "Tanggal", "Jenis", "Keterangan", "Catatan", "Jumlah (Rp)", "Status", "Alasan pembatalan", "Koreksi atas", "Dicatat oleh", "Waktu dicatat", "Bukti", "Periode"), proof values "Ada" / "Tidak ada", summary labels "Diekspor", "Filter", "Pencarian", "Ya", "Tidak", file name `finance-{periode}-{YYYY-MM-DD}.{ext}`.
