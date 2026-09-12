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
| ✅ | **Priority, scorecards & risk** — receivables ranking, weighted KPIs, in-danger alerts |
| ✅ | **Module 2** — Clients, contracts, milestones, renewal alerts, security-rules tests |
| ✅ | **Module 3** — Projects, elevator phases, certification, team assignments |
| ✅ | **Module 4** — Invoices, disbursements, VAT & WHT returns, financial roll-up |
| ⬜ | Module 5 — Financial reporting |
| ⬜ | Module 6 — Kanban boards |

## Start here

1. **[docs/00-one-time-setup.md](docs/00-one-time-setup.md)** — the one-time
   environment handshake. Do this first; it is the only manual step.
2. **[docs/01-firestore-schema.md](docs/01-firestore-schema.md)** — the data
   model and the reasoning behind it.
3. **[docs/02-kpis.md](docs/02-kpis.md)** — every KPI definition, and why each is
   measured the way it is.
4. **[docs/03-priority-and-risk.md](docs/03-priority-and-risk.md)** — how projects
   are ranked by reachable cash, how weighted scorecards work, and what triggers
   an in-danger alert.
5. **[docs/04-module-2-contracts.md](docs/04-module-2-contracts.md)** — contracts,
   milestone allocation, renewal alerts, and the security-rules test suite.
6. **[docs/05-module-3-projects.md](docs/05-module-3-projects.md)** — phases,
   weighted progress roll-up, certification, and team assignments.
7. **[docs/06-module-4-finance.md](docs/06-module-4-finance.md)** — invoicing,
   disbursements, the monthly VAT and WHT returns, and the financial roll-up.

```bash
npm ci
npm test          # 301 tests
npm run test:rules  # 48 security-rules tests against the emulator
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
  unmeasured, not failing. In a weighted scorecard its weight is redistributed,
  never scored as zero.
- **Every ranking and alert explains itself.** A number a manager cannot audit is
  a number they will override.
- **Milestone amounts sum to the contract exactly.** Largest-remainder
  allocation, never independent rounding.
- **Project progress is a weighted roll-up of phases**, never a number someone
  types.
- **VAT is summed per line**, never applied to an invoice total — zero-rated
  lines sit alongside standard-rated ones.
- **An invoice paid net of client withholding is settled, not part paid.**

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
  scorecard.ts          weighted composites, team inheritance by allocation
  risk.ts               in-danger rules and alert severity
  priority.ts           receivables ranking by reachable cash
  dual-date.ts          the only sanctioned way to build a DualDate
  milestones.ts         exact largest-remainder payment allocation
  renewal.ts            renewal windows, SLA snapshots
  phases.ts             elevator template, progress roll-up, certification
  invoicing.ts          line totals, settlement, ageing, numbering
  returns.ts            monthly VAT and WHT returns
  rollup.ts             project financial roll-up (pure)
  schema.ts             typed Firestore schema
src/auth/               AuthProvider, role model, route guards
src/data/               Firestore repositories, audit stamping, React bindings
src/rules-tests/        security rules behaviour tests (emulator)
src/components/
  DualDateInput.tsx     the dual-calendar picker
  AppShell.tsx          role-filtered navigation
src/pages/              SignIn, Dashboard, Priority, Clients, Contracts,
                        Projects, ProjectDetail, KPI panels
firestore.rules         role-based access + money-reconciliation enforcement
firestore.indexes.json  composite indexes
.github/workflows/      CI, Claude Code automation, Firestore deploy
```

### Known follow-ups

- The bundle is ~720 kB (mostly the Firebase SDK); code-split before launch.
- `src/pages/sample-kpi-data.ts` is scaffolding so the KPI engine can be seen
  working; delete it when the dashboard reads live data.
