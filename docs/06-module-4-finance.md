# Module 4 — Invoices, Disbursements, VAT & WHT Returns

The module that closes the loop. The VAT and WHT arithmetic from module 0 now
writes real records, and `project.financials` is derived from documents that
exist rather than sample data — which is what turns the priority board from a
demo into a report.

---

## Two things that are easy to get wrong and expensive to find late

### 1. VAT is summed per line, not applied to the total

Zero-rated and exempt supplies sit on the same invoice as standard-rated ones.
Multiplying the invoice total by 15% overstates the VAT on **every invoice that
carries one** — and you would be remitting tax you never collected.

`totalInvoice()` rounds each line's VAT independently, because that is what is
printed against it. Summing exact fractions and rounding once would print lines
that do not add up to the total.

When lines disagree, the header rate is `null` and the invoice is flagged
`mixedRates` — a single header rate would be a lie.

### 2. An invoice paid net of client withholding is SETTLED, not part paid

A client withholds 2%, remits 98%, and the invoice is **cleared**. The withheld
2% is sitting with ERCA against our income tax — it is not a receivable.

Treating it as debt means:

- chasing money nobody owes, forever
- an ageing report that never empties
- a priority board permanently ranking a settled project

`settle()` adds cash received **and** client withholding to reach `settledSantim`,
and the balance is what remains after both. `clientWhtSantim` is a first-class
field on the receipt form, not an afterthought.

The roll-up keeps the two apart on purpose: withholding counts toward
*settlement* but never toward *collections*, because it never reaches the bank.

---

## Invoice numbering

Ethiopian VAT invoices must be **sequential and gapless**. Firestore has no
sequence type, and every obvious alternative is wrong:

| Approach | Why it fails |
|---|---|
| Timestamp | Not sequential |
| Counting existing documents | Races two users invoicing at once; silently reuses a number after a deletion |
| Client-side counter | Whatever the client says it is |

So the sequence lives in a counter document bumped inside a **transaction**. Two
users clicking *Issue* simultaneously get consecutive numbers, not the same one.

The number is claimed **at issue, not at creation**. A draft has no tax
significance, and burning sequence numbers on abandoned drafts would leave gaps
nobody can explain. Conversely, once a number is consumed it stays consumed —
a gap from an abandoned issue is a question an auditor can answer, while a reused
number is one they cannot.

The rules enforce monotonicity: `value == resource.data.value + 1`. Rewinding
and skipping are both refused, and nobody may delete a counter.

---

## Disbursements

Every figure comes from `computeDisbursement()`, never from a form field. The
UI previews the breakdown with the same engine the write path uses, so what the
approver sees is what gets stored:

```
Their net         100,000
Their VAT @15%     15,000   ← our input VAT, reclaimable
Their invoice     115,000
WHT @ 3%           −3,000   ← on the NET, never on the 115,000
We pay            112,000
```

The withholding certificate is issued **at payment**, not left to a month-end
scramble, and only when something was actually withheld. A supplier who cannot
produce their certificate cannot claim the credit, so the returns page counts
outstanding certificates as a compliance gap.

---

## The returns

Both are filed on the **Ethiopian calendar month**, which is why `vatPeriodEc`
and `whtPeriodEc` are denormalized onto every document — a return is one indexed
query rather than a date-range scan plus in-memory conversion.

### VAT

Declared on an **accrual basis**: an invoice issued in Tir is declared in Tir
whether or not the client has paid. Filtering on payment would understate the
liability, and is the single most common way a VAT return goes wrong.

Drafts and voids are excluded **and counted**, so a missing invoice shows up as a
number to investigate rather than an absence nobody notices.

Output VAT less input VAT gives the net. Negative means a **credit carried
forward**, not a payment — reported as such rather than as a negative liability.

### WHT

Grouped **by supplier**, because the certificate we owe each subcontractor covers
everything withheld from them in the period, not each voucher separately.

The summary surfaces three things worth acting on:

- **Effective rate per supplier** — a blended figure flags a supplier who billed
  both goods (2%) and services (3%)
- **No-TIN payments** — where the 30% penalty rate applied
- **Outstanding certificates** — the compliance gap

> These pages produce the figures a filing is built from. They are **not** the
> declaration, and the accountant signs the return. The page says so, because a
> screen that looks like a filing invites being treated as one.

---

## Project financial roll-up

`computeRollup()` is pure and lives in `src/lib/`; `refreshProjectFinancials()`
does the fetching and stamps the result onto `project.financials`, so the
dashboard reads one document instead of aggregating hundreds per render.

What it gets right:

- Drafts and voids never count as billed revenue
- Only **approved or paid** vouchers are committed cost — a draft voucher is not
  yet a liability
- Margin excludes VAT on **both** sides, because VAT is pass-through
- Client withholding settles without collecting

### A structural fix

`computeRollup` was originally written in `src/data/rollup.ts`, so importing it
pulled in Firebase initialisation and the test suite failed with a missing API
key. The fix was not to stub the environment — it was to move the pure
computation to `src/lib/` where the rest of the pure logic lives, leaving only
the fetching in `src/data/`.

That separation is what has kept 301 unit tests runnable in plain Node with no
emulator, and it was worth repairing rather than working around.

---

## Rules tests added

48 total, up from 39.

| Pinned behaviour |
|---|
| Finance may consume the next counter value |
| **Rewinding a counter is refused** — it would reuse an invoice number |
| **Skipping ahead is refused** — it would leave an unexplained gap |
| Viewers and engineers may not consume numbers; nobody may delete a counter |
| An invoice whose VAT does not reconcile is refused |
| An invoice cannot be **created** already issued — numbers come from the counter |
| Once issued, number/net/VAT are frozen; payment fields still move |
| An issued invoice cannot be deleted, so the sequence stays explicable |
| Managers cannot write invoices at all |
