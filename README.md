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
| ✅ | **Module 1** — Auth, roles, app shell, dual-calendar date picker |
| ✅ | **KPI engine** — project and technician metrics, graded against targets |
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
3. **[docs/02-kpis.md](docs/02-kpis.md)** — every KPI definition, and why each is
   measured the way it is.

```bash
npm ci
npm test          # 105 tests
npm run typecheck
```

### Running the app locally

```bash
cp .env.example .env.local        # fill from the Firebase console
npm run emulators                 # Firestore :8080, Auth :9099, UI :4000
npm run dev                       # http://localhost:5173
```

Create your first user in the Auth emulator UI, then grant them a role — a new
user has **no role and no access** until you do:

```bash
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
GCLOUD_PROJECT=intelmotion-pcm-dev \
node scripts/set-user-role.mjs you@example.com admin
```

## The rules this codebase runs on

- **Money is integer santim.** Never a float. Field suffix `...Santim`.
- **Rates are integer basis points.** 15% = `1500`. Field suffix `...Bps`.
- **Firestore stores Gregorian UTC.** The Ethiopian calendar is a display and
  reporting projection, never the source of truth.
- **WHT is charged on the VAT-exclusive base**, and deducted from the gross.
- **Roles come from custom auth claims**, not a Firestore document — so the
  security rules can check them without a billed read on every evaluation.
- **Route guards are UX, not security.** The Firestore rules are the boundary.
- **A KPI with no data is `null`, never 0%.** A technician with no callouts is
  unmeasured, not failing.

Each is explained in [docs/01-firestore-schema.md](docs/01-firestore-schema.md).

## Layout

```
docs/                   setup checklist, schema reference
scripts/                bootstrap-github.sh, bootstrap-firebase.sh, set-user-role.mjs
src/lib/
  ethiopic.ts           GC ↔ EC conversion, fiscal year, dual formatting
  money.ts              santim, VAT, WHT, project rollup
  date-input.ts         picker parsing and validation, free of React
  kpi.ts                project and technician KPIs, grading, formatting
  dual-date.ts          the only sanctioned way to build a DualDate
  schema.ts             typed Firestore schema
src/auth/               AuthProvider, role model, route guards
src/components/
  DualDateInput.tsx     the dual-calendar picker
  AppShell.tsx          role-filtered navigation
src/pages/              SignIn, Dashboard, ProjectKpis, TechnicianKpis
firestore.rules         role-based access + money-reconciliation enforcement
firestore.indexes.json  composite indexes
.github/workflows/      CI, Claude Code automation, Firestore deploy
```

### Known follow-ups

- The bundle is ~720 kB (mostly the Firebase SDK); code-split before launch.
- `users/{uid}` documents are not yet written on sign-up — module 2.
- `src/pages/sample-kpi-data.ts` is scaffolding so the KPI engine can be seen
  working; delete it when the dashboard reads live data.
