# Stitch Design vs Context Document

> Compares the Stitch snapshot (`design-system.md`, `screens.md`, `html/`) with `docs/PMK-NEXUS-context.md` section 5 (features) and section 6 (UI/UX spec).
> Written 2026-11-05. **The context document has NOT been edited.** Every row below needs an owner decision: keep the context doc, adopt Stitch, or mix.

## 1. Colors

| Element | Context doc (approx. from Figma screenshot) | Stitch (exact) |
|---|---|---|
| Dark brown | `#5A3E1B` | `#62431F` (app bar, primary buttons); darker `#482D0A` (token `primary`, hover, active nav) |
| Dark gold | `#C9A227` | `#C59A27` (design notes), `#D6AD36` and `#D4AF37` (used in screens) |
| Light gold | `#E8C766` | `#FFDF9A` / `#EFC04B` (tokens `tertiary-fixed` / `-dim`) |
| Cream background | `#F5F3EA` | `#FFF8F5` (most screens), `#FAF6F0` or `#FBF8F3` (others). Stitch is not consistent. |
| Text | not specified | `#26190C` / `#2C1E11` |
| Status colors | not specified | Green, amber, neutral, grey, red pill sets (see `design-system.md`) |

Note: PI-CORE's own Stitch project uses `#C9A227` and `#5A3E1B`, the same values as the context doc. If NEXUS adopts the NEXUS Stitch values, the two apps will use slightly different browns and golds.

## 2. Fonts

| Context doc | Stitch |
|---|---|
| "Bold, wide serif/display font" for page titles and the "PMK-NEXUS" pill; body font not named | **Playfair Display** (titles, headlines, "PMK ITERA" wordmark) + **Plus Jakarta Sans** (body, tables, forms, numbers). Icons: Material Symbols Outlined. |

## 3. Layout and style

| Element | Context doc | Stitch | Difference |
|---|---|---|---|
| Header shape | Dark brown, **curved bottom edge** | Dark brown, **flat**, 64 px, thin bottom border | Curve removed |
| Header content | Hamburger, PMK logo (center), bell | Hamburger, placeholder crest + "PMK ITERA" text (center), bell with gold dot | Real PMK logo missing (5 different placeholder crests across screens) |
| Under header | Rounded "PMK-NEXUS" pill, then a large page title | Dashboard 01: white banner card with period chip "Periode Kepengurusan 2026/2027", H1 "PMK-NEXUS", H2 "Dashboard". Dashboard 02: "PMK-NEXUS" chip + "Aktif • 2026/2027" + H1 | Similar idea; Stitch adds the active period |
| Side menu | **Dark brown background, white text** | **Light cream** drawer (`#FFF1E8`), dark text, active item solid brown with white text, blurred backdrop | Inverted colors |
| Menu items | Dashboard, Data Anggota, Finance, Notulensi Rapat, Surat Menyurat, Manajemen & Inventaris Barang | Same 6, same order | Match |
| Buttons | **Pill-shaped**, dark brown, light text | **8 px rounded rectangles**; pills only for status chips and filter chips | Changed |
| Cards | Rounded, thin **brown** outline, cream background | White, 12 px radius, hairline **beige** border (`#D3C4B7` / `#EADFCF`), soft brown shadow | Lighter look |
| Card headings | Thin **gold underline** | Hairline beige divider, icon tile next to the heading | Gold underline gone |
| Tables | Alternating row colors | Alternating rows, `#F0E9DC` header, 11 px uppercase labels, built as CSS grid | Match (more detail) |
| Inputs | Rounded outlined fields on cream | 8 px radius, `#FCFBF8` background, `#D8CCBA` border, brown focus ring | Match |
| Bottom navigation | none | none | Match |

## 4. Screens (context doc section 5 vs Stitch)

| Screen | Context doc | Stitch | Differences and new requirements |
|---|---|---|---|
| Dashboard | Finance balance, Recent Meetings, Members count, Inventory Status % | All four, plus a **Surat Menyurat card** (latest letter, counts of incoming/outgoing) | Extra card. Meetings show a **status** (Selesai / Terjadwal / Mendatang): meetings would need a status or schedule field. Filler: "+12.4% vs bln lalu", "Versi Eksekutif 2.4", "Terkoneksi". "100% Anggota Aktif" contradicts the member list. |
| Data Anggota | Read-only; columns No, Name, Department, Status; filters Department, Status; pagination | Same columns and filters, plus a **search box**, export ("Ekspor PDF" / "Unduh Rekap (Excel/PDF)"), and on screen 04 a **"+ Tambah Anggota" button** | **Conflict:** "Tambah Anggota" breaks the read-only rule (members are managed in PI-CORE). Status values **Aktif, Cuti, Alumni, Pembina** do not exist in PI-CORE (only active/inactive). |
| Finance | Income, expenses, balance; transaction table (date, description, amount); tied to a period | Present in 3 variants, with "Unduh Transkrip / Cetak Laporan" | Filler bank account "BNI 182-004-9811". No form to add a transaction. |
| Notulensi Rapat | Form: date, title, topic, minutes, decision, upload attachment | Form present, with drag-and-drop upload (**PDF/DOCX, max 10 MB**) | File types and size limit are new rules (need confirmation). No list or detail screen for past minutes. |
| Surat Menyurat | Incoming/outgoing tabs; number, counterpart, subject; archive; request flow | Tabs "Surat Masuk (8)" / "Surat Keluar (14)"; per-letter "Unduh PDF"; floating "+ Buat Surat Baru" | Shows outgoing code **`SK`** (`PMK/NEX/SK/2026/012`), but inconsistently: an SK letter appears under the "Surat Masuk" tab, and the Dashboard shows an SM number under "Surat Keluar". No letter form, no detail screen. |
| Manajemen & Inventaris Barang | Borrowing (item, date, status, borrower); inventory (item, qty, condition, location) | Present in 3 variants; "+ Ajukan Peminjaman" button; notice "H-3 kegiatan"; "Detail Tiket"; "Unduh Rekap Aset (PDF)" | **"H-3 kegiatan"** suggests a new rule (request at least 3 days before the event). Inventory % shown 3 different ways ("80% Siap Pakai", "Siap Pakai 10 Unit" of 12, "Kondisi Baik 91%"). |

## 5. Missing screens

| Screen | In context doc? | In Stitch? |
|---|---|---|
| Login | Flagged as missing | **Missing.** No login, logout, profile, or role display. PI-CORE's Stitch project has login screens ("Masuk PMK ITERA") that could be reused. |
| Letter request flow (member requests, secretary processes) | Flagged as missing | **Missing.** Only a "+ Buat Surat Baru" button with nothing behind it. |
| Borrowing request flow (request, approval, return) | Flagged as missing | **Missing.** Only a "+ Ajukan Peminjaman" button and "Detail Tiket" link with nothing behind them. |
| Forms: add transaction, add inventory item, letter detail, meeting list/detail, member detail | Not listed | Missing |
| Empty, loading, and error states | Not listed | Missing |
| Role-based variants (what a regular member sees) | Implied by access table | Missing |

## 6. Extra or questionable content in Stitch

- "Animated" variants of 5 screens (staggered fade-in, card hover lift; `prefers-reduced-motion` respected).
- Screen `efa5f1ca` is labeled "Finance" but contains the Dashboard (duplicate of screen 01).
- Export is mostly PDF; CSV appears nowhere and Excel only as text on screen 04. The context doc requires Excel, CSV, and PDF.
- Placeholder crest and AI-generated seal images instead of the real PMK logo.
- Demo filler to drop when building: `Rp 999.999.999`, growth percentages, fake bank account, version number, "Terkoneksi".
- Design-token mismatch inside Stitch: the design notes say canvas `#FBF8F3` and radius DEFAULT 8 px, but the generated Tailwind config uses `#FFF8F5` and DEFAULT 4 px.
