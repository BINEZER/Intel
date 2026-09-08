# KPIs — Projects and Technicians

Engine: [`src/lib/kpi.ts`](../src/lib/kpi.ts). Every metric is a pure function
with tests, so the same code runs in a Cloud Function writing snapshots and in
the browser previewing an open period.

---

## Two rules that shape every metric here

### 1. No data is `null`, never zero

A rate with no denominator returns `null` and renders as **—**, not `0.0%`.

A technician with no callouts this month has *no* SLA compliance figure. Showing
0% would brand a blameless person as a total failure, and once a number like that
reaches a performance review it is very hard to walk back. The same applies to a
project with no invoices yet: its collection rate is unknown, not zero.

Tiles grade `null` as **neutral grey**, never red.

### 2. Rates are basis points, durations are whole minutes

Same reasoning as money being integer santim. These numbers get averaged, ranked
and compared to targets. Float drift in a KPI is invisible right up until
someone's bonus depends on it.

---

## Project KPIs

### Schedule

| KPI | Definition | Why this way |
|---|---|---|
| **Progress vs plan** | Physical `progressBps` against the share of planned duration elapsed | Shown as a bar with a plan marker. "62% built, 70% elapsed" is a *relationship* — the gap is the message |
| **Schedule variance (bps)** | progress − expected progress | Negative = behind. Graded amber within 5 points, red beyond |
| **Schedule variance (days)** | actual handover − planned handover | **Only reported once the project is complete.** For a running project this would be a forecast, and we decline to invent one |
| **Days to planned end** | calendar days from today | Flips to "overdue by" once passed |
| **Phases complete** | count of completed phases | |

Expected progress is **straight-line**. Pretending to know an S-curve for a shaft
installation would be false precision.

### Commercial

| KPI | Definition | Why this way |
|---|---|---|
| **Gross margin** | (contract net − subcontract cost net) ÷ contract net | Both figures **VAT-exclusive**. VAT is pass-through and never counts as margin |
| **Billed** | invoiced net ÷ contract net | |
| **Unbilled work** | progress bps − invoiced bps | **The cash-flow early warning.** 62% built but 50% billed means 12% of the contract is work in progress earning nothing. Amber past 10 points |
| **Collected** | collected gross ÷ invoiced gross | |
| **Collection time** | mean days from issue to settlement, **weighted by invoice value** | An unweighted mean lets a tiny fast-paid invoice hide a large slow one |

### Quality

| KPI | Definition |
|---|---|
| **Authority inspection** | Passed on the first attempt, required rework, or not yet inspected |
| **Phase durations** | Actual days per completed phase — the input to estimating the next tower |

First-pass inspection is `null` until the inspection actually happens. A pending
inspection is not a failure.

---

## Technician KPIs

Ordered deliberately in the UI: **service quality first, speed second.**
First-time fix and repeat callouts say whether the lift *stayed* fixed; response
time only says how fast someone arrived. A team ranked on speed alone learns to
arrive fast and fix badly.

### Service quality

| KPI | Definition | Target |
|---|---|---|
| **First-time fix** | Callouts closed on the first visit, no follow-up | ≥ 80% |
| **Repeat callouts** | Callouts on a unit the technician recently attended, within 30 days of the earlier callout being **resolved** | ≤ 10% (lower is better) |

Repeat callouts are the strongest signal that a first fix did not hold — something
no response-time metric will ever show. The window keys on the earlier callout's
*resolution*, and an unresolved earlier callout never counts as a failed fix.

### Speed

| KPI | Definition | Why this way |
|---|---|---|
| **Response** | reported → on site | A technician cannot control Addis traffic |
| **Repair (MTTR)** | on site → back in service | They *can* control this. Merging the two hides which is failing |
| **Median response** | headline figure, with the mean in small print | One four-hour night should not define a record. Median is the honest typical |
| **Response SLA** | share attended inside the contract window | Judged only over callouts that *carried* an SLA |
| **Resolution SLA** | share resolved inside the window, **measured from the report** | That is what the client experiences and what the contract promises — not from arrival |

The SLA is **snapshotted onto the callout** when it is logged, so a later contract
renegotiation cannot retroactively rewrite whether we breached.

### Preventive maintenance

| KPI | Definition | Target |
|---|---|---|
| **PM compliance** | visits completed ÷ visits scheduled | ≥ 95% |
| **PM on time** | completed on or before the scheduled date ÷ completed | ≥ 90% |

Kept separate on purpose: doing every visit a month late is 100% compliance and
0% punctuality, and you need to see both. Security rules stop a technician
editing `scheduledDate` — the promised date is the yardstick.

### Capacity and compliance

| KPI | Definition |
|---|---|
| **Utilisation** | logged minutes ÷ contracted available minutes |
| **Certifications** | expired, or expiring within 60 days |

Elevator work is certified work. An expired card is a compliance problem, not a
reminder, so it grades red.

---

## Grading

`grade(value, target, direction)` returns `good` / `warn` / `bad` / `unknown`.
Amber is the 10% band on the wrong side of target, so a near miss reads
differently from a collapse. `direction: 'lower'` inverts it for repeat callouts
and response times.

Targets live in `config/kpiTargets` (defaults in `DEFAULT_KPI_TARGETS`), editable
without a deploy. **Agree them with the team before publishing a leaderboard** —
the seeded values are industry-typical starting points, not your commitments.

---

## Source collections

Technician KPIs need data the system did not previously capture:

| Collection | Feeds |
|---|---|
| `technicians` | Identity, certifications, contracted hours. Separate from `users` because subcontractor crews have no login but still need a KPI record |
| `callouts` | Every SLA, first-time-fix and repeat metric |
| `maintenanceVisits` | PM compliance and punctuality |

Integrity rules in `firestore.rules`:

- **Callout timestamps are immutable once set.** `reportedAt`, `arrivedAt` and
  `resolvedAt` cannot be rewritten — every SLA metric derives from them.
- An engineer may progress a callout **assigned to them**, and not one already
  resolved. Managers may edit any.
- A technician cannot move a visit's `scheduledDate`.
- **KPI snapshots are server-write-only.** Nobody edits their own numbers.
- `technicians` are deactivated, never deleted — KPI history must survive.

## Rollups

- Project: `computeProjectKpis()` → `projects/{id}.kpi`
- Technician: `computeTechnicianKpis()` → `technicians/{id}/kpiSnapshots/{periodEc}`,
  one document per Ethiopian month

`flagRepeatCallouts()` runs across a unit's whole callout history, not one
technician's, so it must run **before** the per-technician rollup.
