# pending/ — written, not yet integrated

| file | what it is | status |
|---|---|---|
| `landing-discounts.html` | Landing page for the free `/discounts` checker | rewritten 14 Sep 2026; **not deployed** |

## What left this folder

`ev-discounts.js` **moved to the repo root on 14 Sep 2026** and is now inlined by
`build.js`. It is integrated, not pending. Everything below records the rules it
was integrated under, because they are enforced by build gates and breaking them
fails the build rather than shipping a wrong price.

## The rules it lives under

`ev-pricing.js` is the **sole rate authority**. `ev-discounts.js` is handed a
rate and returns a **percentage**. It does not look a rate up, and it no longer
computes a cost of its own.

Order of operations, confirmed twice independently — by a settled EVgo receipt
and by Mercedes-Benz HPC's own promotion terms ("the Discount applies only to
energy costs, and does not apply to idle fees, parking fees, or any taxes"):

    rate -> discount -> subtotal -> tax

### Build gates that enforce it

1. **No rackRate for a network pricing covers.** Every network carries a
   `pricingId` binding it to `ev-pricing.js`. 13 of 14 are bound and carry no
   rate at all. IONNA was the proof this matters: `$0.48` here against `$0.39`
   published in pricing.
2. **Any surviving rackRate must be tagged.** `rackRateNote` is required, so the
   UI can never show an estimated national average that looks identical to a
   published per-station rate. Exactly one survives — `journie`, a Parkland
   loyalty program pricing does not model.
3. **One confidence vocabulary**, shared with pricing:
   `published / secondary / estimated / unavailable / user`. Checked across both
   `DISCOUNTS` and `NETWORKS` — the first version of this gate checked only
   discounts and walked straight past a legacy label on a network.

### Why `sessionCost` was deleted rather than fixed

It returned `$30.05` for the session whose settled receipt says `$28.76`. It was
wrong three separate ways — wrong base rate, no time-of-use, no tax — two of
which pushed up and one down, landing **+4.5%**.

> A field that is 40% wrong gets caught. A field that is 4.5% wrong gets
> believed.

Getting it right would have meant reimplementing regional resolution, TOU
integration, plan fee waivers and sales tax. That module already exists. It is
`ev-pricing.js`.
