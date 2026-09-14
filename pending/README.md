# pending/ — written, tested, NOT integrated

These were authored in a research document and never wired into the app.
Extracted into real files 14 Sep 2026 so they stop living inside a markdown file.

| file | what it is | status |
|---|---|---|
| `ev-discounts.js` | Eligibility, membership percentages, plans and waivers | loads clean; NOT imported by build.js |
| `landing-discounts.html` | Landing page for the free `/discounts` checker | not deployed |

## The rule that governs integration

`ev-pricing.js` is the **sole rate authority**. `ev-discounts.js` applies
eligibility and percentages *to* whatever pricing resolves. Its `rackRate` table
is a fallback only, for networks pricing doesn't cover, and must be visibly
tagged as an estimated national rate so there is no invisible accuracy cliff.

Order of operations, proven by a settled receipt:

    rate -> discount -> subtotal -> tax

Sales tax landed in v1.11.0, so this order can now be built correctly the first
time.
