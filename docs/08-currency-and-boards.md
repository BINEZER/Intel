# USD Support and Module 6 — Kanban Boards

---

## Part 1: Multi-currency

IntelMotion buys lifts abroad and sells them in Addis, so supplier invoices
arrive in USD while VAT, WHT and every return are declared in ETB.

### The rule

> A foreign-currency document stores **both** the original amount **and** its ETB
> equivalent, together with the exact rate used and the date it applied.

The ETB figure is the source of truth for tax. The original is the truth for the
supplier relationship. Existing `...Santim` fields keep their meaning — they were
always ETB — so the VAT and WHT engines were not touched.

### The rate is snapshotted, never looked up

This is the part that matters. **The birr floats.** If a report re-converted at
today's rate:

- last quarter's filed VAT return would silently change every time you opened it
- the figure you actually filed would no longer be reproducible
- nobody could reconcile the return against the system that produced it

So `rateMicros`, `rateDate` and `rateSource` are written onto the document at
transaction time and never consulted again. This is the same principle already
applied to VAT rates on contracts and SLA windows on callouts: a rate is a fact
about a specific day, not a current setting.

`config/fxRates` holds a **working default** the UI offers. Finance overrides it
per transaction, because the rate on the day a shipment cleared customs is not
necessarily today's.

### No floats anywhere

Amounts stay integer minor units — santim for ETB, cents for USD. Rates are
integer **micros**: 120.4567 is `120_456_700`. Conversion rounds to the santim
and the result is asserted to be an integer.

### Exchange differences

`exchangeDifference()` re-converts a booked amount at a settlement rate and
reports the gap. A payment that settles at a different rate produces a realised
exchange gain or loss that belongs in the accounts — not silently absorbed into
the cost of the job, where it would corrupt the project's margin.

### In the interface

`CurrencyAmountInput` shows the ETB equivalent **live**, labelled *"the figure
VAT and withholding are computed on"*, so nobody approves a USD number while
thinking in birr. Switching currency keeps the number typed and re-derives the
ETB figure — converting the amount itself would restate a price nobody agreed to.

Foreign amounts always render as `USD 45,000.00 (ETB 5,420,551.50 at 120.4567)`.
A bare USD figure invites comparison against the ETB figure on the next line.

---

## Part 2: Kanban boards

### A move writes one document

The naive board stores positions 0,1,2,3 and renumbers on every drag. On a
40-card column that is **40 writes for one drag**, it races two people reordering
at once, and it bills for all of it.

Orders are sparse integers spaced 1024 apart; an insertion takes the midpoint of
its neighbours. Only the moved card is written.

**Integers, not fractions.** A float midpoint exhausts double precision after
about fifty insertions at the same spot and then silently stops separating cards.
An integer midpoint either fits or it does not — and when it does not,
`orderBetween` returns `no_gap` and the caller rebalances the column in a single
batch. A test hammers the same gap sixty times and asserts every card keeps a
distinct position throughout.

Sorting breaks ties on document id, so two clients never disagree about order.

### Every drag has a keyboard equivalent

The ←↑↓→ buttons on each card are **not a fallback**. A drag-only board is
unusable with a keyboard or a screen reader, and for moving a card three columns
along the buttons are faster anyway. Dragging is layered on top.

### Completion is a side effect of position

Landing in a column named Done stamps `completedAt`; dragging back out clears it.
A task pulled out of Done is genuinely open again, rather than carrying a
completion date that contradicts its column.

---

## The security bug the tests caught

The boards rule read:

```
match /boards/{boardId} {
  allow write: if isManager();
  match /{document=**} {
    allow write: if has([... 'engineer']);   // meant for subcollections
  }
}
```

**A recursive wildcard matches ZERO or more segments.** The nested
`{document=**}`, intended to cover subcollections, therefore also matched the
board document itself — and because Firestore rules are a *permissive union*, any
matching `allow` grants access.

Net effect: **every engineer could rename, restructure or archive any board**,
directly contradicting what the rules were written to say.

The test `lets only a manager create a board` failed with *"Expected request to
fail, but it succeeded"* — which is exactly the failure mode a rules suite exists
to catch, because nothing in the UI would ever have revealed it.

Fixed by deleting the nested wildcard. Cards live in the top-level `tasks`
collection; any future board subcollection gets its own explicit match.

### Board rules now pinned

| Pinned behaviour |
|---|
| An engineer may create and reorder cards — boards are where non-managers write freely |
| A viewer may read cards but not write them |
| Only a manager may **delete** a card; an engineer archives instead |
| Only a manager may create a board |
| A card update stamped with someone else's uid is refused |

53 rules tests, up from 48. 389 unit tests, up from 342.
