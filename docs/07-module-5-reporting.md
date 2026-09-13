# Module 5 — Financial Reporting

Project statements, portfolio totals, a monthly trend, a cash-flow outlook, and
CSV export. Everything traces to an invoice, a disbursement or a contract —
nothing here is entered by hand, and nothing carries forward from a previous
version of itself.

---

## The Ethiopian fiscal year is the default boundary

Reports run on **1 Hamle to 30 Sene**, named for the year they end in, because
that is the boundary ERCA's annual filing uses. FY 2018 begins in Hamle 2017,
which in Gregorian terms is 8 July 2025 to 7 July 2026 — pinned by tests on both
the first and last day, and on the days either side of each.

## Contract margin and realised margin are different questions

Both are reported, side by side, because a project can look healthy on one and
be bleeding on the other:

| | Answers |
|---|---|
| **Contract margin** | What the job is worth *if it finishes as sold* |
| **Realised margin** | What has been earned on the work *billed so far* |

A project 30% billed but 60% spent has a fine contract margin and a badly
negative realised margin. The portfolio counts **loss-making projects by realised
margin**, because that is the one that is already true.

## Cash-flow outlook

Overdue receivables are listed **first and separately**. They are not a forecast —
they are money that should already be here, and folding them into a future
bucket makes a cash position look healthier than it is.

Payables count at their **net payable**, not the supplier's invoice, since the
withheld portion goes to ERCA rather than the subcontractor. An approved voucher
with no payment date is treated as due now: a payment we have approved and not
scheduled is still money we owe.

## Gaps in a trend read as gaps

`buildPeriodSeries` emits **every** Ethiopian month between the first and last
with activity, including empty ones. A series that silently omits a quiet month
draws a smooth line across a hole, and for a business with seasonal site access
that hole is exactly the shape worth seeing. A month with no revenue has margin
`null`, not 0% — so the line breaks rather than plunging to zero.

---

## CSV export: two hazards

### Formula injection

A cell whose text starts with `=` `+` `-` `@` (or a tab or carriage return) is
**executed as a formula** by Excel and Google Sheets. Client names, site names
and supplier names in this system are all free text typed by a user, so a name
like `=HYPERLINK("http://evil.example","Click")` becomes a live formula the
moment an accountant opens the export.

Every such cell is prefixed with an apostrophe, which Excel strips on display and
never evaluates. Order matters: **quoting alone does not stop Excel evaluating
`"=1+1"`** — the apostrophe goes on first, then RFC 4180 quoting.

### Encoding and units

Files carry a UTF-8 BOM, or Amharic client names arrive as mojibake — a defect
that gets blamed on the data rather than the encoding. Amounts leave as **decimal
birr**, not santim: money stays integer santim internally, and the conversion
happens once, at this boundary.

---

## The chart

One chart, built to a procedure rather than to taste.

**Form.** Revenue and cost are the same unit, so they share one axis as grouped
bars. Margin is a percentage — a different scale — so it gets its **own panel**
below, sharing the x-axis. It is never a second y-axis on the same plot: a
dual-axis chart lets the author choose where the lines cross, which is to say it
can be made to show anything.

**Colour.** Categorical slots 1 and 2 (blue, orange) plus slot 7 (violet) for the
margin line, chosen for *identity*, not magnitude. The palette was **run through
the validator, not eyeballed** — both light and dark steps pass the lightness
band, chroma floor, CVD separation (ΔE 24.7 light / 26.8 dark against an ≥8
target), normal-vision floor and 3:1 contrast.

**Identity never rests on colour alone.** A legend is always present, the final
group is directly labelled, every month has an accessible description, and a
table view of the same numbers sits behind a toggle.

**Dark mode is scoped to an explicit `[data-theme="dark"]`, not to
`prefers-color-scheme`** — the rest of the app is light-only, and flipping the
chart on OS preference alone would put a dark plot on a light page. The validated
dark values are in place for when a theme toggle lands.

### What rendering it actually caught

The validator checks colour, not layout. Screenshotting the chart found three
defects no test would have:

1. **The "ETB" axis unit overlapped the top tick** — fixed with top padding.
2. **Months were labelled every other one.** A full Ethiopian year is 13 months
   and they all fit; making a reader count bars to identify a month is worse than
   a slightly crowded axis.
3. **A negative margin month collided with the month labels** — the margin panel
   now carries 8px of headroom top and bottom.

A fourth change came from looking rather than measuring: the floating tooltip
covered the very bars it described, whichever side it flipped to. It is now a
**persistent readout below the plot** — never occludes, always visible, and on a
financial page the exact figures are the point.
