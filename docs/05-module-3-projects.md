# Module 3 — Projects, Phases, Certification

Projects are where the KPI and priority engines finally get real inputs: phase
progress feeds milestone attainability, and assignments feed the team score.

---

## Progress is derived, never typed

> **Project progress is a weighted roll-up of its phases. Nobody sets
> `project.progressBps` directly.**

A project manager reporting "60% done" with nothing behind it is an opinion. A
roll-up is a claim you can interrogate phase by phase — and when it disagrees
with the plan, you can see *which phase* is the problem.

`updatePhaseProgress()` recomputes the roll-up and writes the phase and the
project **in one batch**, so the two can never disagree. Reading the sibling
phases first costs one query and buys that guarantee.

The roll-up divides by the **actual** weight total rather than assuming 10000, so
weights that have drifted still produce a sane 0–100% instead of a number over
100 or a silent underestimate. `validatePhaseWeights()` is what stops the drift;
the roll-up just refuses to compound it.

### The standard elevator template

Weights reflect **effort, not calendar time**. Shaft preparation is slow but
mostly other trades' work; cab assembly is where our crew actually lives.

| Phase | Weight | Depends on |
|---|---|---|
| Shaft preparation | 20% | — |
| Rail installation | 25% | Shaft preparation |
| Cab assembly | **30%** | Rail installation |
| Testing & commissioning | 15% | Cab assembly |
| Authority inspection & certification | 10% | Testing |

Seeded automatically on project creation, in the same batch as the project. A
project with no phases cannot report progress at all, so it is never created
without them. Weights are adjustable per project — this is a starting point, not
a rule.

## Sequencing is a warning, not a block

Phases started before their predecessor finished are **flagged, never
prevented**.

Real sites overlap. A crew will start hanging rails while the last of the shaft
sign-off is still being chased, and that is usually the right call. Software that
refuses to record what is actually happening just gets worked around — someone
marks the predecessor complete when it isn't, and now the data is worse than if
you'd allowed the overlap. So the tracker names what is outstanding and lets the
manager decide.

`blocked` is the same principle in reverse: it is a human judgement that
something off-site is holding a phase up, and the automatic status derivation
**never overwrites it** — exactly like a renewal status someone set by hand.

## Certification gates handover

The certification block lives only on the `authority_inspection` phase.

| State | Means |
|---|---|
| `pending` | Not yet inspected. **Not a failure** — first-pass is `null`, not `false` |
| `passed`, 1 attempt | Passed first time |
| `passed`, 2+ attempts | Passed, but needed rework |
| `failed_rework` | Blocks handover |
| `not_applicable` | Does not gate handover |

### The attempts bug this module fixed

The schema had no `attempts` field at all — the whole first-pass metric had
nothing to count. Adding it exposed the subtler trap:

> **Attempts increment only on a real verdict.**

Re-saving a pending record happens every time someone edits the inspection date.
If that incremented the counter, the first-pass rate would quietly decay every
time the form was touched, and by the time anyone noticed, months of history
would be wrong. `recordInspection()` increments on `passed` and `failed_rework`
only — marking an inspection *not applicable* leaves the count alone.

Once passed, the certificate's own expiry is tracked (`valid` /`expiring_soon`
/`expired`), because a lift certificate expires like any other.

## Team assignments

`projectAssignments` ties technicians to projects with an `allocationBps` — the
share of that technician committed to this project, and the weight they carry in
the project's team score.

Allocation is **validated in the repository**, not trusted from a form field, and
only managers may set it (enforced in the rules and pinned by a test). A lead at
60% moves the project's team score six times as much as a helper at 10%, so the
allocation is shown next to every name rather than buried in an edit form —
anyone reading the score should be able to see why it is what it is.

---

## A bug worth recording

`updatePhaseProgress` originally hand-built a `DualDate` literal with `ec: null`
to stamp phase start and end dates.

It typechecked, because `batch.update()` takes a loosely-typed `UpdateData` and
does not validate against the document type. It would have written phases whose
**Ethiopian reporting cache was empty** — breaking `ecPeriod` and `ecFiscalYear`
queries silently, for exactly the dates that feed the phase-duration KPI.

This is precisely what `dual-date.ts` exists to prevent: nothing outside those
two builders may construct a `DualDate`. The rule was right; I broke it, and the
type system could not catch me. Fixed to go through `dualDateFromGregorian()`.

---

## Rules tests added

39 total, up from 31. New coverage:

| Pinned behaviour |
|---|
| An engineer may move phase progress |
| A viewer may not |
| An engineer may **not** create or delete phases |
| A phase update stamped with someone else's uid is refused |
| Only managers may create assignments — an engineer cannot assign themselves |
| Technicians can be created but **never deleted** — KPI history must survive |

The assignment rule matters more than it looks: allocation is what weights a
technician in the project's team score, so self-assignment would be
self-weighting.
