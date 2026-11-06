# src/modules

One self-contained folder per NEXUS module (for example members, inventory, letters, minutes, finance, dashboard). Scope module data by period so program-of-work (progja) can be added later without a rewrite.

Layout per module:

- `types.ts`: the contract between server and UI (zod schemas, row types, error codes). Written first.
- `server/`: queries, export handlers, access checks. Every entry point checks access itself (F2).
- `ui/`: the module's screens and components.
- `README.md`: entry points and how to extend the module.

Reads of PI-CORE data never happen here directly; they go through `src/lib/picore/`.

Modules built:

| Module | Folder | Spec |
|---|---|---|
| Member Data (Data Anggota) | `member-data/` | `docs/modules/member-data.md` |
