# Firestore Schema

Typed source of truth: [`src/lib/schema.ts`](../src/lib/schema.ts).
This document explains *why* each convention exists.

---

## The four conventions

### 1. Money is an integer count of santim — never a float

Field suffix `...Santim`. 1 ETB = 100 santim, so `ETB 1,150,000.00` is stored as
`115000000`.

Floating point cannot represent `0.1 + 0.2` exactly. On a contract value with a
15% VAT line and a 3% WHT deduction, that error compounds through the report and
your VAT return stops reconciling by a santim or two — exactly the discrepancy an
ERCA audit picks up. Integers make the arithmetic exact by construction.

Conversion helpers: `birrToSantim()` / `santimToBirr()` / `formatETB()` in
[`src/lib/money.ts`](../src/lib/money.ts). The security rules reject any money
field that is not an integer.

### 2. Rates are integer basis points

Field suffix `...Bps`. 15% VAT = `1500`, 2% WHT = `200`, 3% WHT = `300`.
Same reasoning: `0.15` is not exactly representable, `1500` is.

### 3. Every stored instant is Gregorian UTC

Firestore holds `Timestamp` values only. The Ethiopian calendar is a **display
and reporting projection**, never the source of truth. This keeps range queries,
sorting, index behaviour and the Firebase SDKs all working normally.

### 4. User-picked dates use the `DualDate` field type

```ts
interface DualDate {
  at: Timestamp;                                  // ← source of truth, 00:00 UTC
  ec: { year: number; month: number; day: number }; // ← denormalized cache
  ecPeriod: string;                               // "EC-2018-04"
  ecFiscalYear: number;                           // 1 Hamle – 30 Sene
  enteredIn: 'GC' | 'EC';                         // which picker the user typed in
}
```

Why cache the EC parts rather than convert on read?

- **Query.** "Every invoice in Tir 2018" becomes `where('vatPeriodEc','==','EC-2018-05')`
  — one equality filter. Converting on read would mean fetching a Gregorian range
  and filtering in memory, which breaks pagination and inflates reads.
- **Reporting.** The Ethiopian fiscal year (1 Hamle – 30 Sene) does not align to
  any Gregorian boundary, so `ecFiscalYear` has to be indexable.
- **`enteredIn`** reopens the edit form in the calendar the user originally used.
  It has no effect on the stored value.

The cache is **derived, never authored**. Only `dualDateFromGregorian()` and
`dualDateFromEthiopian()` in [`src/lib/dual-date.ts`](../src/lib/dual-date.ts)
may construct a `DualDate`; `assertDualDateConsistent()` catches drift in tests
and in a nightly integrity job.

**EC input flow:** the picker collects `{year, month, day}` in EC → 
`dualDateFromEthiopian()` converts via Julian Day Number → the GC timestamp is
what reaches Firestore. Conversion happens before the write, exactly as specified.

---

## Collection map

```
config/{tax}                          singleton — rates, thresholds, company TIN
users/{uid}                           role + active flag (mirrored to auth claims)
auditLogs/{logId}                     append-only

clients/{clientId}
subcontractors/{subcontractorId}      carries hasTin → drives the 30% penalty rate

contracts/{contractId}
  └── milestones/{milestoneId}        payment milestones, shareBps sums to 10000

projects/{projectId}
  └── phases/{phaseId}                5 standard elevator phases; certification block
                                      lives on the authority_inspection phase

invoices/{invoiceId}                  REVENUE side — output VAT
  └── receipts/{receiptId}            includes WHT the client withheld from us

disbursements/{disbursementId}        PAYMENT side — input VAT + WHT withheld

boards/{boardId}                      Kanban columns
tasks/{taskId}                        Kanban cards
```

**Why `disbursements` is top-level, not a subcollection of `projects`:**
the monthly WHT return needs *every* disbursement in an Ethiopian month across
all projects. As a subcollection that is a collection-group query with weaker
index options; top-level with a `projectId` field serves both the per-project
view and the tax return from ordinary composite indexes.

---

## VAT — the revenue side

Every contract and invoice stores all three figures, denormalized:

| Field | Meaning |
|---|---|
| `valueNetSantim` / `netSantim` | taxable base, VAT-exclusive |
| `vatRateBps` | `1500`, copied from `config/tax` **at creation time** |
| `vatSantim` | the VAT line |
| `valueGrossSantim` / `grossSantim` | what the client owes |

`gross == net + vat` is enforced in the security rules, so a client-side bug
cannot persist a contract whose VAT does not add up.

`vatRateBps` is copied onto each document rather than read from config at report
time. If the statutory rate ever changes, historical documents keep the rate they
were actually issued under — which is what the filing must reflect.

**Inclusive pricing.** When a client negotiates "1,150,000 all in", set
`valueEnteredInclusive: true` and use `extractVat()`, which derives the net first
and takes VAT as the remainder — so `net + vat === gross` holds to the santim
with nothing lost to rounding.

**Filing.** `vatPeriodEc` (`EC-2018-04`) and `vatPeriodGc` (`2025-12`) are copied
from `issueDate` onto every invoice, so the monthly return is a single indexed
query in either calendar.

---

## WHT — the disbursement side

The rule that matters most: **WHT is computed on the VAT-exclusive base**, and
deducted from the gross invoice.

Worked example — ETB 100,000 of installation services from a VAT-registered
subcontractor holding a TIN:

| | ETB | Field |
|---|---:|---|
| Subcontractor's taxable base | 100,000.00 | `netSantim: 10000000` |
| + their VAT @ 15% (our input VAT, reclaimable) | 15,000.00 | `supplierVatSantim: 1500000` |
| = face value of their invoice | **115,000.00** | `grossSantim: 11500000` |
| − WHT @ 3% **of 100,000, not of 115,000** | (3,000.00) | `whtSantim: 300000` |
| = cash out of the bank | **112,000.00** | `netPayableSantim: 11200000` |

We then issue the subcontractor a withholding certificate for the 3,000 and remit
it to ERCA. `whtCertificateNo` and `whtRemittedDate` track that leg.

Rate selection, implemented in `computeDisbursement()`:

| Condition | Rate |
|---|---|
| Supply of goods, at or above threshold | 2% |
| Services / works, at or above threshold | 3% |
| **Supplier cannot produce a TIN** | **30%** |
| Below the per-transaction threshold | 0%, `whtExemptReason: 'below_threshold'` |
| Category marked exempt | 0%, `whtExemptReason: 'category_exempt'` |
| `overrideWhtRateBps` set on the subcontract | that rate |

> **Confirm before go-live.** Rates and thresholds live in `config/tax`, editable
> by finance without a deploy. The seeded defaults (2% / 3% / 30%; ETB 10,000 for
> goods and ETB 3,000 for services) reflect the Income Tax Proclamation 979/2016
> regime — have your tax advisor confirm the current thresholds and sign off on
> the seeded values.

`whtPeriodEc` on every disbursement drives the monthly WHT return the same way
`vatPeriodEc` drives the VAT return.

---

## Financial reporting

`rollUpProject()` produces the per-project report, and the same figures are
denormalized onto `project.financials` by a Cloud Function so the dashboard reads
one document instead of aggregating on the client:

- Gross contract value, VAT, and total
- Invoiced and collected to date
- Subcontractor cost **VAT-exclusive** — VAT is pass-through and must not appear
  in margin
- Total WHT withheld and cash actually disbursed
- Gross margin in santim and in bps
- **Net VAT payable** = output VAT − input VAT: what we remit for the period

---

## Composite indexes

Defined in [`firestore.indexes.json`](../firestore.indexes.json):

| Collection | Purpose | Fields |
|---|---|---|
| `contracts` | Renewal alert board | `status, renewalAlertAt` |
| `contracts` | Contracts by client, newest first | `clientId, endDate.at desc` |
| `projects` | Delivery dashboard | `status, plannedEnd.at` |
| `invoices` | Monthly VAT output return | `vatPeriodEc, status, issueDate.at` |
| `invoices` | Aged receivables | `status, dueDate.at` |
| `invoices` | Per-project revenue | `projectId, issueDate.at` |
| `disbursements` | Monthly WHT return | `whtPeriodEc, status` |
| `disbursements` | Phase-by-phase disbursement | `projectId, phaseId, paymentDate.at` |
| `disbursements` | Subcontractor annual ledger | `subcontractorId, paymentDate.ecFiscalYear` |
| `tasks` | Kanban column order | `boardId, columnId, order` |
| `tasks` | My open tasks | `assigneeUid, archived, dueDate.at` |
| `phases` (group) | Certification tracker | `certification.result, certification.inspectionDate.at` |

`renewalAlertAt` is precomputed as `endDate − renewalWindowDays` on write, so the
renewal alert is one range filter instead of a scan-and-compute over every contract.

---

## Access model

Roles live in a **custom auth claim**, not in the `users` document — reading a
document on every rule evaluation costs a billed read and can be raced.

| Role | Can |
|---|---|
| `admin` | Everything, including config and deletions |
| `manager` | Clients, contracts, projects, phases, boards |
| `finance` | Invoices, receipts, disbursements, WHT |
| `engineer` | Phase progress only — **blocked from `project.financials`** |
| `viewer` | Read-only |

Immutability rules that protect the audit trail:

- An **issued** invoice cannot have its number, net or VAT changed — only its
  payment fields, or a void.
- A **paid** disbursement cannot be updated at all.
- `auditLogs` are append-only: no update, no delete, by anyone.
- Users are deactivated, never deleted.
