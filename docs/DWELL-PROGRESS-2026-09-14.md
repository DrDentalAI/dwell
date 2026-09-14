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

## 2a. INCIDENT — v1.12.1 was dead on open, and every test passed

`discountProfile()` called **`this.currentVehicle()`**. That function exists
nowhere in the codebase; the accessor is the module-level `activeVehicle()`. It
was the first line of the function, on a render path reached from `init()`, so
the app died at startup for **every user with a charging network selected** —
which, after the discount work, is the normal state.

```
TypeError: this.currentVehicle is not a function
  discountProfile  index.html:4496
  currentDiscount  index.html:4514
  costHTML         index.html:4720
  renderOutput     index.html:5631
  setTemp          index.html:5090
  renderAll        index.html:5185
  init             index.html:6639
```

Reproduced headlessly, byte-identical stack and line numbers.

### The owner's diagnosis was reasonable and wrong, and that matters

The reported theory was an unguarded `S.session.pricing.planId` against a
pre-v1.12 saved session. Plausible — but `load()` already rebuilds
`S.session.pricing` from defaults on every restore, so that path could not fire.
**The crash was on line 4496; the `planId` reference is on 4505.** Execution never
reached it.

This is not an upgrade bug. A brand-new install crashes the moment a network is
picked. The saved session only made it fire at startup instead of on first tap.

### Why nothing caught it

Every check that session ran was in Node: engine maths, receipt reproduction,
discount resolution, provenance gates, build gates. All passed. All correct.

**None of them ever opened the page.** The `effectivePlan` logic was verified by
*reimplementing it in the test harness* rather than calling the app's copy —
which verified the algorithm and left the actual shipped function unexecuted.

> **A build that verifies the maths and never opens the app is not a verified
> build.** "All tests pass" is a claim about the tests. The receipt reproducing
> to the cent said nothing about whether the app started.

### Fixed in v1.12.2

| # | fix | verification |
|---|---|---|
| 1 | `this.currentVehicle()` → `activeVehicle()` | 9/9 smoke scenarios pass; same test shows **5/9 FAIL** against the shipped v1.12.1 artifact, naming the exact error |
| 2 | **`test/smoke.js`** — headless startup test, 9 scenarios: first run, v1.11.2 upgrade, missing keys, null session, wrong-typed fields, no vehicles, garbage in storage | Asserts zero uncaught errors **and** that the page actually painted — a silent blank screen fails |
| 3 | **UI method gate in `build.js`** — every `this.x()` in `src/app.js` must resolve to a UI key | Negative-tested: reinstating the bug fails the build naming `currentVehicle`. 137 methods checked |
| 4 | **Render failure can no longer take the app down.** `init()` retries in safe mode with a reset session, then paints, with a "Reset saved data" control | Vehicles and saved rates survive a session reset |
| 5 | **Discount layer isolated** in `costHTML` — if it throws, the cost card still renders at the undiscounted rate with an explicit notice | Failing safe means quoting the *higher* price, never a fabricated discount |
| 6 | **`load()` forward-migration** — nested session objects rebuilt from defaults and type-checked, not trusted to exist | `eligibility` as a string, `memberships` as a string, missing `pricing`: all pass |

### The fixture lesson, which nearly repeated the original mistake

The first smoke test **passed all six scenarios against the provably broken
build.** It used the wrong localStorage key (`dwell`, not `evdwell.v1`), so every
scenario silently ran as a first-run install and never reached the crash.

A hand-written fixture tests your *idea* of the app. The fixture was rebuilt by
driving a real install — pick a network, pick a plan, read `localStorage` back,
delete the keys v1.12 added. **A test that passes against known-broken code is
not evidence; it is a second bug wearing the costume of a result.**

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

## 3a. Deploy

| | |
|---|---|
| **URL** | `https://raw.githack.com/DrDentalAI/dwell/main/index.html` |
| Installed as | iOS PWA, added to home screen |
| Source of truth | `main` branch of `DrDentalAI/dwell` — githack serves the raw file with a usable content-type |

Recorded here because it had never been written down, and it changes what a
deploy *is*: pushing `index.html` to `main` **is** the release. There is no build
step, no CDN purge and no staging between a commit and every installed PWA. A
broken `index.html` on `main` is a broken app on the phone within a cache cycle.

Two consequences worth holding onto:

- **`main` is production.** The v1.12.1 crash was live the moment the file
  landed. `test/smoke.js` must pass before anything reaches `main`.
- **A PWA caches.** After a bad deploy the fix is not instant — iOS may serve the
  cached shell until it revalidates. If a fix looks like it did not take, close
  the PWA fully and reopen before concluding anything.

---

## 4. Blocked

**`DrDentalAI/dwell` is not in the Cowork session's authorized sources.** Read
works; push returns 403 from the git proxy. Files are handed over for manual
upload each session. Owner has deprioritized fixing it.

*Upload note, learned the hard way twice:* the GitHub web UI drops files into
**whatever folder you are currently viewing**, and dragging a folder produces a
nested copy. Drag **contents**, and be in the right folder first.

---

## 4a. RESOLVED — the station-finder host moved (NREL → NLR)

**Fixed in v1.12.0. The endpoint was updated.** An earlier draft of this section
said the opposite; that draft was wrong and has been replaced.

The Department of Energy renamed the National Renewable Energy Laboratory to the
**National Laboratory of the Rockies**, and the developer network moved hosts.
Confirmed against DOE's own announcement and NLR's published domain-transition
notice, not against a browser error:

> *"DNS for the `nrel.gov` domain and all subdomains ceased to resolve and will
> not redirect."*

There is no fallback to try. The old host is **gone, not slow**. Phased
transition: new domain available 2 Mar 2026, `410 Gone` brownouts 1–28 May, old
domain expired **29 May 2026**.

### What changed, and what explicitly did not

| | |
|---|---|
| Host | `developer.nrel.gov` → **`developer.nlr.gov`** |
| Path | `/api/alt-fuel-stations/v1/nearest.json` — **unchanged** |
| Parameters | `api_key, fuel_type, ev_charging_level, latitude, longitude, radius, limit, status, access` — **unchanged** |
| Response | `fuel_stations[]` → `ev_network`, `ev_charging_units[].connectors{}.power_kw` — **unchanged** |
| API keys | **still valid**: *"only the domain in the URL needs to be updated"* |
| Signup | `https://developer.nlr.gov/signup/` |

Checked against the new docs rather than assumed, because "only the host changed"
is exactly the sort of claim that turns out to be 90% true.

`nrelKey` is **deliberately left as the localStorage field name.** Renaming it
would orphan every personal API key users have already saved, to cosmetically
match a lab's new branding. The user-visible copy says NLR; the storage key does
not move.

### Graceful degradation — confirmed, not assumed

Offline-first means a dead endpoint must not break the tab. Three failure paths,
all pre-existing, all verified:

- **DNS failure / CORS** — `fetch` throws, caught, renders *"Could not reach the
  station database from this browser. The built-in list above still works."*
- **429** — names the shared-quota problem and points at the free personal key.
- **404 / 410** — **added this build.** The brownout period returned `410 Gone`,
  which previously fell into the generic branch and reported a bare status code.
  It now says the database moved and this build points at the old address, which
  is the one message that would actually have led someone to the fix.

The finder is an enhancement over a built-in station list that always renders.
The tab does not depend on the network at any point.

### The governing test, proving itself

Brief §8 asks of any feature: *does this create a recurring cost or a recurring
verification burden?* Static tables pass. Third-party endpoints fail.

This one **broke inside a month of being documented**, through no fault of the
code, by a decision made by someone else entirely. That is the burden, arriving
on schedule. It is still worth keeping — it degrades cleanly and the built-in
list carries the feature — but it should be the last dependency of its kind, and
anything proposed that looks like it should be held to this example.

### The epistemics, honestly

The sequence is worth recording, because the project keeps relitigating how much
a single observation is worth:

1. `ERR_NAME_NOT_RESOLVED` observed → reported as a dead domain. **Correct.**
2. Retracted as a local DNS fault, with an instruction not to rewrite anything.
   **Incorrect** — and it came with a confident causal story.
3. Re-reported on two networks, then **settled by checking DOE's announcement and
   NLR's transition notice.**

The first instinct was right and the correction was wrong, so the lesson is *not*
"distrust single observations." Both the report and the retraction were single
data points, and counting them would have picked the wrong one twice.

> **What resolved it was a primary source, not a tally of observations.** A DNS
> failure and a decommissioned domain are indistinguishable from the client — no
> amount of re-observing from the same vantage point separates them. The
> adjudicating evidence was never going to come from the browser.

The existing rule already covers this if read properly: *one session is data, not
a calibration.* Data tells you something is worth investigating. It does not tell
you what is true. **Go to the authority; don't re-measure with the instrument
that is itself in question.**

The cost of getting this wrong was asymmetric and worth noting: acting on the
false retraction would have left a shipped build pointing at a dead host with no
diagnostic message. Verification cost two web searches.

---

## 5. Queue, in order

| # | item | state |
|---|---|---|
| 1 | Test **v1.12.2** on the phone | **ready** — v1.12.0/v1.12.1 are dead on open, skip them |
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
- Verifying the engine and never opening the app. See §2a — v1.12.1 passed every
  test and was dead on open.
- Trusting a test that has never been seen to fail. See §2a — the first smoke
  test passed against the broken build.
- Settling a factual question by re-observing instead of checking a primary
  source. See §4a — the first report was right, the confident retraction was
  wrong, and only DOE's own announcement separated them.

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

**UPLOAD THE PROGRESS FILE — v1.12.0 and v1.12.1 are dead on open and must not be
deployed; v1.12.2 fixes the crash and adds a headless startup test plus a build
gate that would have caught it; the deploy URL is recorded for the first time
(`raw.githack.com`); `ev-discounts.js` moved out of `pending/` and is now
integrated and gated; the station-finder host changed from `developer.nrel.gov`
to `developer.nlr.gov` and the old host no longer resolves, which invalidates any
older build; the queue reordered around a newly-surfaced blocker (the eligibility
profile has no UI); and §2 and §4a each record a general rule — about plausible
wrong numbers, and about settling questions with a primary source rather than a
repeated observation — that belongs in the project's memory rather than a chat
log.**
