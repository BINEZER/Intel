# Prioritisation, Weighted Scorecards, and Risk Alerts

Three engines, each pure and tested:

| Engine | File | Answers |
|---|---|---|
| Priority | [`src/lib/priority.ts`](../src/lib/priority.ts) | Which project, given attention this week, unlocks the most cash soonest? |
| Scorecard | [`src/lib/scorecard.ts`](../src/lib/scorecard.ts) | How is this project or technician performing, weighted? |
| Risk | [`src/lib/risk.ts`](../src/lib/risk.ts) | Which projects are in danger, and why? |

---

## 1. Prioritisation

### Three pools of money, treated differently

The ranking does not just add up "what we are owed". It separates receivables by
**how cheaply each converts to cash**:

| Pool | What it is | Weight | Why |
|---|---|---|---|
| **Overdue** | Invoiced, past due | 100% | Already earned and billed. Needs a phone call, not a crew — the cheapest cash in the business to recover |
| **Current** | Invoiced, not yet due | 60% | Needs nothing but patience |
| **Upcoming** | Milestones not yet billable | 40% | Needs work done first |

### Upcoming milestones are discounted twice

A milestone is only worth chasing if it is both *reachable* and *soon*:

```
expected value = amount × attainability × imminence
```

- **Attainability** — the gating phase's progress. A milestone behind a phase at
  90% is nearly cash; one behind a phase at 10% is a hope. A milestone already
  `ready_to_invoice` is **not discounted at all** — nothing stands between it and
  a bill.
- **Imminence** — decays linearly to the horizon (default 90 days). Money due
  next week deserves attention over money due in three months. Past due counts
  at full weight; beyond the horizon counts as zero.

### The ranking key

The impact score is the weighted cash **as a share of the project's own contract
value**, then lifted by risk.

Normalising by contract size is a deliberate choice: without it a 40M project
would outrank a 4M one on size alone, forever. Ranking by *share of the project
at stake* surfaces the small project that is 90% overdue above the large one with
a routine invoice outstanding. **Ties break on absolute ETB**, so between two
equally-pressured projects the larger cheque wins.

### Every row explains itself

Each ranked project carries `drivers` — the ETB behind its position, with a note.
This is not decoration. A ranking a manager cannot audit is a ranking they will
override, and an overridden ranking is worthless.

Tunables live in `config/priority` (`horizonDays`, the three pool weights,
`riskBoostBps`).

---

## 2. Weighted scorecards

### The rule that matters most

> **A component with no data is dropped and its weight redistributed across the
> components that do have data — never scored as zero.**

Scoring a missing metric as zero would mark down a new project for having no
invoices yet, or a technician for a quiet month. Redistribution asks the only
fair question: *of what we can actually measure, how are they doing?*

`coverageBps` reports how much of the intended weight had data behind it, so a
score built on one metric out of six is **visibly thin** rather than silently
authoritative. Read the score and the coverage together.

### Achievement is capped at 100%

A scorecard where 300% on one metric cancels 0% on another is not a scorecard —
it is an average with extra steps. Overperformance does not buy forgiveness.

### Default weights

**Technician** — service quality carries half the weight, because whether the
lift stayed fixed matters more than how fast someone arrived:

| Component | Weight |
|---|---|
| First-time fix | 25% |
| Repeat callouts *(lower is better)* | 20% |
| Response SLA | 15% |
| Resolution SLA | 15% |
| PM compliance | 15% |
| PM on time | 5% |
| Utilisation | 5% |

**Project:**

| Component | Weight |
|---|---|
| Schedule | 25% |
| Gross margin | 20% |
| Billing keeping pace | 15% |
| Collection | 15% |
| Inspection | 15% |
| **Team performance** | **10%** |

Weights live in `config/kpiWeights` and **must sum to 10000 bps**.
`assertWeightsValid()` throws otherwise — a composite built on weights that do
not sum to 100% silently means something other than what it claims.

### Projects inherit their crew's performance

`projectAssignments` ties technicians to projects with an `allocationBps` — the
share of that technician committed to this project.

The project's **team** component is the allocation-weighted mean of its
technicians' scorecards. A lead at 60% moves the project's service score six
times as much as a helper at 10%, which is the right incentive: the lead is who
the project actually depends on.

A technician who cannot be scored at all is **excluded, not counted as zero** —
same rule as above. Only managers may set `allocationBps`, enforced in the rules.

---

## 3. Risk alerts

Rules, not a model. **Every flag names the number that triggered it** and the ETB
at stake where there is any. There is deliberately no learned scoring: an alert
that cannot be explained cannot be acted on.

| Code | Severity | Triggers when |
|---|---|---|
| `margin_negative` | critical | Subcontract cost exceeds contract value |
| `overdue_receivable` | critical | AR older than 90 days |
| `overdue_delivery` | critical | Past planned handover and still open |
| `expired_certification` | critical | Any expired card on the assigned crew |
| `overdue_receivable` | high | AR older than 30 days |
| `severe_under_billing` | high | More than 15% built but not invoiced |
| `margin_erosion` | high | Gross margin below 15% |
| `stalled_progress` | high | No progress recorded for 21 days |
| `no_team_assigned` | high | Live project with no technician |
| `inspection_failed` | high | Authority inspection needed rework |
| `schedule_slip` | medium/high | Progress behind plan past tolerance |
| `repeat_callouts` | medium | Crew repeat rate above 20% |
| `poor_collection` | medium | Under half of invoiced value collected |

### The level is the worst flag, not an average

Three medium warnings do not add up to a crisis, and one critical is not softened
by good news elsewhere. **In danger** = worst flag is `critical` or `high`.

The separate `riskScoreBps` is a *saturating* sum used only to break ties in the
priority ranking — it never determines the displayed level.

### Completed projects

Schedule and team flags stop once a project completes — you cannot rescue a
delivered project. **Money owed is still chased regardless**, so
`overdue_receivable` still fires on a completed project.

---

## How the three compose

The nightly rollup, and the `/priority` route, run the same sequence:

```
1. computeProjectKpis()   → schedule, margin, billing, collection, quality
2. computeTechnicianKpis() per assigned technician
   → technicianScorecard() → teamScore() weighted by allocation
3. projectScorecard()     → weighted composite including team
4. assessProjectRisk()    → flags, level, inDanger
5. rankProjects()         → impact score, drivers, rank
```

Written to `projects/{id}.priority` and `projects/{id}.scorecard`; the in-danger
query is `status == 'in_progress' && priority.risk.inDanger == true`, ordered by
`priority.impactScoreBps` (indexed).

---

## Before you use any of this to manage people

The weights and thresholds shipped here are **defensible starting points, not
your commitments**. All of them are config, editable without a deploy.

Two cautions worth stating plainly:

1. **Agree the weights with the team before publishing a scorecard.** A weighting
   nobody agreed to is a weighting people will argue with instead of act on.
2. **A technician's score reflects the work they were given.** Someone sent to
   the worst-maintained sites will show worse first-time-fix through no fault of
   their own. `coverageBps` and the raw component values are shown alongside
   every score precisely so the number can be challenged.
