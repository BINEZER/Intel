# Module 2 — Clients, Contracts, Milestones, Renewals

The first module that reads and writes real data. It also adds the security
rules **test suite**, which is what turns the access-control claims in these docs
from assertions into verified behaviour.

---

## Payment milestones: the santim that goes missing

Split ETB 1,000,000 three ways and the honest shares are 33.33%, 33.33%, 33.34%.
Round each independently and the parts come to 999,999.99 — and the milestones no
longer add up to the contract. Nobody notices until a client queries the final
invoice, or a VAT return is off by a santim.

`allocateByShares()` uses the **largest remainder (Hamilton) method**: floor every
part, then hand the leftover santim one at a time to the parts with the largest
discarded fraction. Every part is a whole santim and the parts sum to the total
**exactly**, always. Ties go to the earlier milestone, so the result is
deterministic rather than dependent on sort stability.

Net and VAT are allocated **separately with the same shares**, so:

- each milestone's `net + vat = gross`
- the milestones' net sums to the contract net
- the milestones' VAT sums to the contract VAT

The VAT is allocated *from the contract's VAT total*, not recomputed per
milestone — recomputing would drift by a santim or two against the contract.

Shares must sum to exactly 100%. A schedule covering 95% leaves 5% nobody will
ever invoice, and `allocateMilestones()` throws before anything is written, so
such a contract never reaches Firestore.

## Contract value: inclusive or exclusive

"4,830,000 all in" and "4,200,000 plus VAT" are the same contract. Getting it
backwards is a 630,000 birr mistake, so the form carries an explicit
**VAT-inclusive** toggle and shows the live breakdown — net, VAT, what the client
pays — as the user types. `valueEnteredInclusive` is stored so the contract can
be reopened showing the figure that was actually negotiated.

## Renewal alerts

`renewalAlertAt = endDate − renewalWindowDays` is **precomputed on write**, so the
alert query is one indexed range filter rather than a scan over every contract
recomputing dates.

Status derives automatically — `not_due` → `due` → `lapsed` — with one exception
that matters:

> **A status a person set is never overwritten.** `in_negotiation` and `renewed`
> survive the automatic pass.

Sales knows something the calendar does not. A nightly job silently resetting
their work would make the field useless, and they would stop using it.

A contract someone has already picked up also drops to low urgency, so the board
stops nagging the people who are already dealing with it — while still reporting
the true expiry bucket.

## Writes are atomic

A contract and its milestones are written in **one batch**. A contract whose
milestones failed to save is a contract nobody can invoice against, and the
milestones must sum to the contract value exactly — so they are never allowed to
exist half-written.

Rewriting a payment schedule is **refused once any milestone has been invoiced or
paid**. Changing the value of a milestone a client has already been billed for
would break the audit trail; that needs a variation, not an edit.

---

## The user-provisioning bug this module fixed

The original rule read `allow create: if isAdmin()` on `users/{uid}`.

That made the first profile **uncreatable**. A new user holds no role claim, so
they cannot create their own profile — and an admin cannot pre-create a document
for a uid that does not exist until after signup. Chicken and egg.

The fix lets a signed-in user create **only a powerless profile for themselves**:

```
request.auth.uid == uid
&& request.resource.data.role == 'viewer'
&& request.resource.data.active == false
&& request.resource.data.email == request.auth.token.email
```

This is safe because **the claim is authoritative, not the document**. A
self-created profile grants nothing. What it does give you is a record an
administrator can act on, instead of a uid someone has to read out over the
phone.

Four tests pin it: a powerless self-profile succeeds; one claiming `admin`,
`active: true`, another user's uid, or an email the token does not carry all fail.

---

## Security rules tests

`npm run test:rules` starts the Firestore emulator around a vitest suite that
asserts what the rules **enforce**. A rules file that compiles can still be wide
open, so every access-control claim in these docs is pinned by a test.

31 tests, covering:

| Area | Pinned behaviour |
|---|---|
| Anonymous | Denied everywhere |
| No claim / inactive | A signed-in user with no role, or an unactivated one, reads nothing |
| Self-provisioning | Powerless profile only; no self-promotion, ever |
| Contracts | VAT must reconcile; float money refused; finance cannot create them |
| Disbursements | **WHT charged on the gross instead of the net is refused**; a paid voucher is frozen |
| Engineers | May update progress, **never** `project.financials` |
| Callouts | `reportedAt`/`arrivedAt`/`resolvedAt` immutable once set; an engineer cannot touch someone else's callout |
| KPI snapshots | No client write, by any role — nobody edits their own numbers |
| Audit logs | Append-only, and cannot be attributed to another user |
| Config | Readable by all, writable only by admins |
| Unknown collections | Closed by default |

Two of these are worth calling out because they are the ones a plausible bug
would slip past: **WHT computed on the VAT-inclusive gross is rejected by the
database itself**, and **a technician cannot rewrite an arrival time to improve
their own response figure**.

---

## Data layer

`src/data/` is deliberately not an ORM. Each repository states its own queries so
the composite indexes they need stay visible in code.

- **Audit stamps use `serverTimestamp()`.** The rules require `createdAt ==
  request.time`, so a client-generated `Timestamp.now()` is rejected — a clock
  the client controls is not an audit trail.
- **Optional fields are spread only when present.** Firestore rejects an explicit
  `undefined` outright, so this is a write-path requirement, not a typing nicety.
- **Every subscription is torn down on unmount.** A listener that outlives its
  component keeps billing reads.
- **Firestore errors are translated.** "Missing or insufficient permissions"
  tells a manager nothing; `describeFirestoreError()` says which action was
  refused and what to do about it.

## Config

`config/tax`, `config/kpiTargets`, `config/kpiWeights` and `config/priority` all
fall back to the shipped defaults when the document does not exist, so the app
works on a fresh Firebase project before anyone opens Settings. Weights are
validated **on write** — a composite built on weights that do not sum to 100%
silently means something other than what it claims.
