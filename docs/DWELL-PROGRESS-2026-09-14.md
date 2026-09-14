# Dwell Planner — Progress as of 14 September 2026

> **What this file is:** where the project actually stands today. Overwrite it
> each session. The date in the filename is the snapshot.
>
> **Companion:** `DWELL-BRIEF-<date>.md` — what the project is, what's decided,
> the principles. That one changes rarely. This one changes every session.
>
> **Cold start:** this file plus the brief is enough to pick the project up with
> no other context. See §7.

---

## 1. State

| | |
|---|---|
| **Repo** | `github.com/DrDentalAI/dwell` |
| **Deployed / live on phone** | v1.11.2 |
| **Built this session, ready to test** | **v1.12.0** |
| Build size | 366,922 bytes (358.3 KB), self-contained |
| Vehicles | 188 |
| Curve provenance | 185 estimated · 3 published · **0 observed** |
| Pricing networks | 32 (19 US, 13 CA) |
| Discount entries | 16 · 13 published, 2 secondary, 1 estimated |
| Discount networks bound to pricing | **13 of 14** |
| Not integrated | `pending/landing-discounts.html` (rewritten, not deployed) |

---

## 2. The finding that matters most this session

`ev-discounts.js` had its own `sessionCost` field, computing a price from its own
$0.48 national rack rate. Measured against the settled 12 Aug receipt:

| | |
|---|---|
| `discounts.resolveRate().sessionCost` | **$30.05** |
| `pricing.sessionCost().total` | **$28.76** |
| settled receipt | **$28.76** |
| error | **+4.5%** |

It was wrong **three separate ways at once**, and they partially cancelled:

1. wrong base rate — $0.48 national average vs the receipt-derived $0.4429
   Michigan evening window
2. no time-of-use — billed the whole session at one flat number
3. no sales tax — 6% simply absent

Two errors pushed the number up, one pushed it down, and the result landed close
enough to look right.

> **The general rule, and the reason this is written down rather than left in a
> chat: a field that is 40% wrong gets caught. A field that is 4.5% wrong gets
> believed.**
>
> Plausibility is not accuracy. When several independent errors sit in one
> calculation, their *sum* is the only thing anyone checks, and the sum is the
> one number that can look fine while every input is wrong. Cancellation is not
> luck — it is what makes a defect survive review.

This is why the field was **deleted rather than corrected**. Fixing it would have
meant reimplementing regional resolution, TOU integration, plan fee waivers and
sales tax — a module that already exists and is called `ev-pricing.js`.

---

## 3. What changed this session — v1.12.0

### Discount integration (the whole of Task 2)

| # | change | verification |
|---|---|---|
| 1 | **`sessionCost` deleted** from `resolveRate`'s return. `effectiveRate` is now a **fraction**, never a price. | Field absent; `$30.05` phantom gone |
| 2 | **`rackRate` stripped** for every network pricing covers. Each carries a `pricingId` binding instead. | **13 of 14 bound**; exactly **1** rackRate survives (`journie`, which pricing does not model) |
| 3 | **Surviving rate tagged** `rateSource: 'estimated-national'` with a required `rackRateNote`, surfaced in the UI as a warning block | Build fails if a rackRate has no note |
| 4 | **One confidence vocabulary.** `reported` → `secondary`, `unverified` → `estimated`, matching `ev-pricing.js`. `normalizeConfidence()` keeps old spellings working. | 13 published / 2 secondary / 1 estimated, all inside the shared scale |
| 5 | **`isEligible` date coercion.** Passing a `Date` silently disabled *every* expiry check. | `Date('2026-10-01')` now returns `expired 2026-09-30`; previously returned `ok: true` |
| 6 | **Model-year matcher.** IONNA's Hyundai/Genesis discount is model- and year-specific. | 12/12 cases correct. **Genesis Electrified G80 → "not on the eligible list"**, where it previously claimed 20% |
| 7 | **Module moved** `pending/ev-discounts.js` → `ev-discounts.js`, wrapped in the same UMD pattern as pricing | Its bare `var NETWORKS` would otherwise have collided with pricing's on `window` |
| 8 | **Wired into the app.** `rate → discount → subtotal → tax` | Receipt reproduces **through the integrated path**: 27.13 + 1.63 = **28.76** |
| 9 | **Double-discount collision handled.** `evgo-plusmax` exists as a plan in pricing *and* an entry in discounts. | Takes the better of the two, never the sum: applied 30% **once**, via plan |
| 10 | **90-day freshness warning**, reusing pricing's `STALE_DAYS` value | Both modules read 90; stale entries render a visible warning and a note |
| 11 | **Landing page rewritten** — ChargeStack brand, promo-code feed, code-alert subscription tier all removed | 0 residual references |

### Three new build gates

The rate-authority rule is now enforced, not just documented:

1. A `rackRate` on a network pricing covers → **build fails**, naming the network.
2. A surviving `rackRate` with no `rackRateNote` → **build fails**.
3. A confidence label outside the shared vocabulary → **build fails**.

All three negative-tested. **Gate 3 was initially wrong**: it checked only
`DISCOUNTS` and walked straight past a legacy `reported` on a `NETWORKS` entry,
reporting success. Widened to cover both. *A gate that covers half the file is
worse than no gate, because it reports success.*

### Deliberately NOT done

- **Journie's C$0.60 rackRate is kept**, not deleted. Pricing models no such
  network, so there is nothing to defer to. Removing it would leave the entry
  unrankable; replacing it with a different unsourced number is forbidden.
  Tagged instead.
- **No stacking engine.** Hyundai + IONNA genuinely stack; that is carried as one
  combined entry, not as new machinery.
- **`auditProfile` does not invent rates.** Where the caller supplies none, the
  entry ranks by percentage and returns `annualValue: null` rather than 0 — an
  unpriced offer is worth an *unknown* amount, and sorting it as zero would bury
  real offers.

---

## 4. Blocked

**`DrDentalAI/dwell` is not in the Cowork session's authorized sources.** Read
works; push returns 403 from the git proxy. Files are handed over for manual
upload each session. Owner has deprioritized fixing it.

*Upload note, learned the hard way twice:* the GitHub web UI drops files into
**whatever folder you are currently viewing**, and dragging a folder produces a
nested copy. Drag **contents**, and be in the right folder first.

---

## 4a. Watch item — the NREL domain

**No action. Do not rewrite the endpoint.** `developer.nrel.gov` resolves and
serves, and its live documentation still lists
`developer.nrel.gov/api/alt-fuel-stations/v1.json`. The station finder is
correct as shipped and was not touched.

What is worth knowing: **`developer.nlr.gov` also exists, with a working signup
and NLR branding**, so a migration may be underway. Nothing has been announced
and nothing is broken.

| | |
|---|---|
| Current endpoint (unchanged) | `developer.nrel.gov/api/alt-fuel-stations/v1/nearest.json` |
| Signup, current | `https://developer.nrel.gov/signup/` |
| Signup, possible successor | `https://developer.nlr.gov/signup/` |

**If the station finder ever fails, check the domain first.** The call already
degrades to the built-in station list rather than erroring, so a domain change
would show up as "live lookup stopped working" rather than a crash — which is
exactly the kind of failure that gets misdiagnosed.

### The lesson, which is bigger than the domain

This watch item began as a bug report: an `ERR_NAME_NOT_RESOLVED` observed
directly, read as a dead domain. It was **a local DNS failure**. Working code
was nearly rewritten on the strength of it.

> **"Physical observation beats published specs" is a good rule, and it just
> produced a false positive.** A DNS failure and a dead domain are
> indistinguishable from the client. The observation was real; the inference
> was not.

This is the same failure the project has hit repeatedly, wearing different
clothes: acting on a single data point. It produced the `observed` curve label
three times, and the phantom $0.99 session fee once. The rule that catches it is
already written down — *one session is data, not a calibration* — and it applies
to infrastructure exactly as it applies to charging curves. **Before acting on a
single observation, check whether the instrument is the thing that broke.**

Corollary, and the sharper form of the governing test in brief §8: **a
third-party endpoint is a recurring verification burden.** Static tables pass
that test. This one does not — it merely fails gracefully, which is not the same
thing.

---

## 5. Queue, in order

| # | item | state |
|---|---|---|
| 1 | Test v1.12.0 on the phone | **ready** |
| 2 | Deploy the rewritten `/discounts` landing page | ready, not deployed |
| 3 | Eligibility profile UI — memberships, gig platform+tier, cards | **needed**; the engine reads these, nothing sets them yet |
| 4 | Google Play via TWA | pending |
| 5 | Range as a temperature band | pending |
| 6 | Per-model-year specs (`byYear`, `specsFor()`) | pending |
| 7 | EPA vs manufacturer range flag + build gate | pending |
| 8 | fueleconomy.gov EPA lookup | pending |
| 9 | Curve viewer · session logging · charger-match table | agreed, not started |

### Needs an owner decision

**The eligibility profile has no UI.** `discountProfile()` reads make, model and
model year from the selected vehicle — those work today. But `memberships`,
`gig.platform`/`tier` and `cards` are read from `S.session.eligibility`, and
nothing writes to it. So automaker discounts (IONNA, GM Energy Pass) apply
automatically from the garage, while rideshare and card-linked offers — the two
largest entries in the table, worth $1,037 and $668 a year — cannot currently be
claimed by anyone. **This is the single highest-value unfinished piece.**

**Show estimated curves as a range rather than a point.** Still undecided. The
800 V template has a known directional bias that cannot yet be quantified;
"52–100 min" is more truthful than a confident 102.

---

## 6. Standing rules — unchanged

- **Never invent data.** Removing an unsourced number is always allowed.
  Replacing it with a different unsourced number is not.
- **One session is data, not a calibration.** Record disagreements in
  `observations/`. Never refit to a single session.
- **Nothing earns `observed`** without multiple sessions across multiple SOC
  ranges.
- **Offline-first is a build gate, not a tradeoff.**
- **Ask before anything permanent or expensive to reverse.**
- **`ev-pricing.js` is the sole rate authority.** Now enforced by build gates.

---

## 7. Cold start — reading this with no other context

1. **Read `DWELL-BRIEF-2026-09-14.md` first.** Do not relitigate §8 or §9 without
   new evidence.
2. **Read this file second.**
3. `git clone https://github.com/DrDentalAI/dwell`
4. **Verify before changing anything:** `node build.js` → self-contained
   `index.html`, no errors, v1.12.0.
5. **Read `observations/` before touching any curve or rate.** It is the only
   irreplaceable data in the repo.
6. Start at the top of §5 that isn't done.

**The traps this project has already fallen into:**

- Labelling something `observed` that was hand-authored or fitted to one session
  — **three times**. Now gated: the UI may demote a curve, never mint a stronger
  label.
- Losing source because only the built artifact was committed.
- Trusting a number because it looked plausible. See §2.
- Acting on a single observation without checking whether the instrument broke.
  See §4a.

---

## 8. Verification, this build

```
node build.js  →  v1.12.0, 358.3 KB, fully self-contained, exit 0

observed curves          0          (188 vehicles, 185 estimated / 3 published)
settled receipt          27.13 + 1.63 = 28.76      exact, via the integrated path
double-discount check    30% applied once, via plan (not 60%)
IONNA Ioniq 5 2025       20% applied  → $27.31
IONNA G80 2026           0% applied   → $34.13   ("not on the eligible list")
expiry with Date object  expired 2026-09-30       (was: ok:true)
rackRate survivors       1 of 14, tagged
external network loads   none
```

---

## 9. End-of-session recap — standing instruction

Regenerate this file every session, date updated, and output it as a single
copyable block. Always include: what changed **with the number that proves it**;
what is blocked or needs a decision; and an upload verdict in one of two forms.

**UPLOAD THE PROGRESS FILE — `ev-discounts.js` moved out of `pending/` and is now
integrated and gated, the queue reordered around a newly-surfaced blocker (the
eligibility profile has no UI), and §2 and §4a each record a general rule — about
plausible wrong numbers, and about acting on a single observation — that belongs
in the project's memory rather than a chat log.**
