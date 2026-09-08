# IntelMotion PCM

Project, Contract & Task Management for a VAT-registered Ethiopian elevator
company. Built on Firebase, in ETB, with 15% VAT and subcontractor withholding
tax, and a dual Gregorian/Ethiopian calendar throughout.

## Status — Module 0: Foundation

| | |
|---|---|
| ✅ | GC ↔ EC calendar engine (exact, JDN-based, 33 tests) |
| ✅ | ETB santim money + 15% VAT + WHT arithmetic |
| ✅ | Firestore schema, security rules, composite indexes |
| ✅ | One-time setup checklist and bootstrap scripts |
| ✅ | CI + automated-PR workflows |
| ⬜ | Module 1 — Auth, roles, app shell, dual-calendar date picker |
| ⬜ | Module 2 — Clients, contracts, milestones, renewal alerts |
| ⬜ | Module 3 — Projects, elevator phases, certification tracking |
| ⬜ | Module 4 — Invoices, disbursements, VAT/WHT returns |
| ⬜ | Module 5 — Financial reporting |
| ⬜ | Module 6 — Kanban boards |

## Start here

1. **[docs/00-one-time-setup.md](docs/00-one-time-setup.md)** — the one-time
   environment handshake. Do this first; it is the only manual step.
2. **[docs/01-firestore-schema.md](docs/01-firestore-schema.md)** — the data
   model and the reasoning behind it.

```bash
npm ci
npm test        # 33 tests: calendar anchors, round-trips, VAT, WHT, margins
npm run typecheck
```

## The rules this codebase runs on

- **Money is integer santim.** Never a float. Field suffix `...Santim`.
- **Rates are integer basis points.** 15% = `1500`. Field suffix `...Bps`.
- **Firestore stores Gregorian UTC.** The Ethiopian calendar is a display and
  reporting projection, never the source of truth.
- **WHT is charged on the VAT-exclusive base**, and deducted from the gross.

Each is explained in [docs/01-firestore-schema.md](docs/01-firestore-schema.md).

## Layout

```
docs/                   setup checklist, schema reference
scripts/                bootstrap-github.sh, bootstrap-firebase.sh
src/lib/
  ethiopic.ts           GC ↔ EC conversion, fiscal year, dual formatting
  money.ts              santim, VAT, WHT, project rollup
  dual-date.ts          the only sanctioned way to build a DualDate
  schema.ts             typed Firestore schema
firestore.rules         role-based access + money-reconciliation enforcement
firestore.indexes.json  composite indexes
.github/workflows/      CI, Claude Code automation, Firestore deploy
```
