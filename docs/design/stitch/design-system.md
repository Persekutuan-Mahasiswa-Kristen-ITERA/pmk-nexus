# Stitch Snapshot: PMK-NEXUS Design System

> Snapshot taken 2026-11-05 from Stitch via the `stitch` MCP server (read-only).
> Sub-agents without MCP access must read the design from this folder.
> This is a SNAPSHOT. The context document (`docs/PMK-NEXUS-context.md`) has NOT been updated from it yet; differences are listed in `comparison.md` and await the owner's decision.

## Source

| Field | Value |
|---|---|
| Stitch project | `projects/15744631264658346759` |
| Title | PMK-NEXUS Dashboard Redesign |
| Created / updated | 2026-11-04 18:59 UTC / 2026-11-04 19:09 UTC |
| Device type | MOBILE (screens 390 px wide; exported at 2x = 780 px) |
| Design system name | **Executive Heritage Modern** |
| Color mode | LIGHT, variant FIDELITY, roundness setting `ROUND_EIGHT` |
| Visibility | PRIVATE |

Other Stitch projects found (not NEXUS): `PI-CORE Organization Mobile UI` (`projects/2802363262728422052`, design system "Warm Sacred Modernism", includes PI-CORE login screens "Masuk PMK ITERA") and a shared read-only `Fleet Admin Dashboard` (unrelated).

## Brand colors (the 4 "override" colors set in Stitch)

| Role | Hex | Used for (per Stitch design notes) |
|---|---|---|
| Primary (walnut brown) | `#62431F` | App bar, primary buttons, active nav, emphasis |
| Secondary (ivory) | `#F0E9DC` | Table header rows, ghost buttons, archive chips |
| Tertiary (burnished gold) | `#C59A27` | Badges, metric indicators, notification dot |
| Neutral (espresso near-black) | `#2C1E11` | Main text and icons |

Other named hex values from the design notes:

| Name | Hex |
|---|---|
| Page canvas (soft ivory) | `#FBF8F3` |
| Card surface | `#FFFFFF` |
| Second gold | `#D6AD36` |
| Hairline borders | `#E2D7C5`, `#EADFCF` |
| Table row divider | `#F3ECE2` |
| Zebra row alt | `#FDFBF7` |
| App bar bottom divider | `#4D3418` |
| Primary button hover | `#513719` |
| Input background / border | `#FCFBF8` / `#D8CCBA` |
| Input label text | `#4A3520` |
| Metric label text | `#7A6652` |

Status colors (text / background / border):

| Status | Text | Background | Border |
|---|---|---|---|
| Success, "Aktif", "Selesai" | `#205E3F` (notes also say `#2E6B4D`) | `#EDF7F1` (notes also say `#EAF3ED`) | `#BCDDC8` |
| Warning, "Sedang Dipinjam" | `#875A00` (notes also say `#9A6700`) | `#FEF7DA` (notes also say `#FDF6E2`) | `#E8D58C` |
| Destructive, "Ditolak" | `#932924` | `#FBEBEA` | not given |
| Archive, "Arsip / Keluar" | `#62431F` | `#F0E9DC` | `#DECDB5` |

Note: the design notes give two slightly different values for success and warning. The HTML screens use the first column.

### Generated Material 3 tokens (Tailwind config inside every screen's HTML)

| Token | Hex | Token | Hex |
|---|---|---|---|
| primary | `#482d0a` | primary-container | `#62431f` |
| on-primary | `#ffffff` | on-primary-container | `#dcb184` |
| secondary | `#625e54` | secondary-container | `#e9e2d5` |
| tertiary | `#423000` | tertiary-container | `#5e4600` |
| tertiary-fixed | `#ffdf9a` | tertiary-fixed-dim | `#efc04b` |
| background / surface | `#fff8f5` | on-surface | `#26190c` |
| on-surface-variant | `#4f453b` | outline | `#81756a` |
| outline-variant | `#d3c4b7` | surface-container-lowest | `#ffffff` |
| surface-container-low | `#fff1e8` | surface-container | `#ffeadb` |
| surface-container-high | `#fee3ce` | surface-container-highest | `#f8dec9` |
| inverse-surface | `#3d2d1f` | error | `#ba1a1a` |

Watch out: the generated page background is `#fff8f5` (pinkish cream), while the design notes say the canvas should be `#FBF8F3`. The screens use `#fff8f5`.

## Typography

| Style | Font | Size / line height | Weight | Letter spacing |
|---|---|---|---|---|
| display-lg | Playfair Display | 32 / 40 px | 700 | -0.01em |
| display-sm | Playfair Display | 24 / 32 px | 600 | -0.005em |
| headline-lg | Playfair Display | 22 / 28 px | 600 | 0 |
| headline-sm | Plus Jakarta Sans | 16 / 24 px | 600 | 0.01em |
| body-lg | Plus Jakarta Sans | 15 / 22 px | 400 | 0 |
| body-md | Plus Jakarta Sans | 14 / 20 px | 400 | 0 |
| body-sm | Plus Jakarta Sans | 12 / 18 px | 400 | 0 |
| label-lg | Plus Jakarta Sans | 13 / 18 px | 600 | 0.02em |
| label-sm | Plus Jakarta Sans | 11 / 14 px | 600 | 0.04em |
| numeric-metric | Plus Jakarta Sans | 20 / 26 px | 700 | -0.02em |

- Headings: **Playfair Display** (serif). Data, forms, navigation: **Plus Jakarta Sans**.
- Money and counts use tabular numbers (`font-variant-numeric: tabular-nums`).
- Icons in the HTML: **Material Symbols Outlined** (Google Fonts).

## Spacing

| Token | Value |
|---|---|
| space-xs | 0.25rem (4 px) |
| space-sm | 0.5rem (8 px) |
| space-md | 1rem (16 px) |
| space-lg | 1.25rem (20 px) |
| space-xl | 1.75rem (28 px) |
| gutter / gutter-md | 0.75rem / 1rem |
| margin / margin-md / margin-lg | 1rem / 1.5rem / 2rem |

## Corner radius

| Source | sm | DEFAULT | md | lg | xl | full |
|---|---|---|---|---|---|---|
| Design notes (`rounded`) | 4 px | 8 px | 12 px | 16 px | 24 px | 9999 px |
| Tailwind config in the HTML | n/a | 4 px | n/a | 8 px | 12 px | 9999 px |

The two scales do not match. The rule in the notes: cards 12 px, buttons and inputs 8 px, **pills only for status chips and filter tags**.

## Elevation

| Level | Use | Style |
|---|---|---|
| 0 | Page canvas | `#FBF8F3` (HTML uses `#fff8f5`) |
| 1 | Cards | `#FFFFFF`, 1 px `#EADFCF`, `0 1px 3px rgba(98,67,31,.05), 0 4px 12px rgba(98,67,31,.03)` |
| 2 | Dropdowns, modals, filter sheets | `#FFFFFF`, 1 px `#E2D7C5`, `0 8px 24px rgba(44,30,17,.08), 0 2px 6px rgba(44,30,17,.04)` |
| 3 | Top app bar | Solid `#62431F`, no gradient, bottom divider `#4D3418` |

## Main components (from the design notes)

- **App bar:** 64 px high, `#62431F`, white content. Hamburger left (24 px icon, 40 px hit area), crest/logo with serif "PMK ITERA" text in the center, bell right with a gold dot. **Flat bottom edge, edge to edge.**
- **Side drawer (seen in Dashboard HTML):** light background (`surface-container-low` `#fff1e8`), dark text, active item filled with `primary` `#482d0a` and white text. Items: Dashboard, Data Anggota, Finance, Notulensi Rapat, Surat Menyurat, Manajemen & Inventaris Barang.
- **Metric cards:** white, 1 px `#EADFCF`, radius 12 px, padding 16 px; label 12 px `#7A6652`; value 20 to 24 px bold `#2C1E11`.
- **Tables:** header row `#F0E9DC`, uppercase 11 px bold `#62431F`; zebra `#FFFFFF` / `#FDFBF7`; row height 48 px; horizontal dividers only; cell padding 12 x 16 px; pagination text "Halaman 1 dari 5" with outline chevron buttons.
- **Inputs:** min height 44 px, radius 8 px, bg `#FCFBF8`, border `#D8CCBA`; focus border `#62431F` plus 2 px ring `#62431F1F`; labels 13 px bold `#4A3520`, stacked, 6 px gap.
- **Status chips:** pill, 24 px high, padding 2 x 10 px, 11 px bold.
- **Buttons:** primary `#62431F` / white, radius 8 px, padding 12 x 20 px; secondary outline 1.5 px `#62431F`; ghost `#F0E9DC` with `#62431F` text.

## Screens

See `screens.md` (per-screen structure) and `html/` (raw HTML of each screen). Screenshots were not saved: the MCP returns them as large base64 blobs. The HTML files open in a browser and render the same screens (they load Tailwind and Google Fonts from CDNs).

| # | Screen | Variants |
|---|---|---|
| 1 | Dashboard | normal + Animated |
| 2 | Data Anggota | normal + Animated |
| 3 | Finance | 3 variants |
| 4 | Notulensi Rapat | normal + Animated |
| 5 | Surat Menyurat | normal + Animated |
| 6 | Manajemen & Inventaris Barang | 2 normal + Animated |
| - | `image.png` | uploaded reference image (no HTML, not saved) |
