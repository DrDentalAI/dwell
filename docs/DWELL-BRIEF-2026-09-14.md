# Dwell Planner — Standing Brief

> **What this file is:** the durable knowledge for this project. What it is, who
> it's for, what's been decided, what the principles are. It does **not** contain
> code, version numbers, line counts, or current status — those go stale.
>
> **Where it goes:** the project folder (Claude, Cowork). Also committed to the
> repo under `docs/` so it travels with the code.
>
> **Companion file:** `DWELL-PROGRESS-<date>.md` — dated state, queue, blockers.
> Read that one for "where are we". Read this one for "what is this and why".
>
> **Supersedes:** `CLAUDE.md`, `PRODUCT-SPEC.md`, `DWELL-PLANNER-BRIEF.md`, and
> the durable parts of `EVMASTERBRIEF.md`. Delete those.

---

## 1. What it is

Dwell Planner answers the charging question every other EV app ignores.

Not *"where do I charge?"* — but ***"I'm already parked here for N hours on this
charger. What will my battery be at when I leave, and what will it cost?"***

Every existing EV charging app — ABRP, PlugShare, Chargeway, Google Maps, the
manufacturer apps — is built around a driver **in motion looking for a charger**.
They optimise routes and find stations.

Almost nobody models the opposite and far more common case: the car is parked and
will be for a known length of time. At work for nine hours. At a hotel overnight.
At a job site for four hours. At a partner's apartment for a weekend. The charger
is whatever happens to be there. The question is arithmetic, not navigation.

Where those apps *do* estimate charging, they use flat arithmetic — capacity ÷
power. That is wrong in ways that compound over a long dwell, because real
charging is governed by a taper curve, temperature, connector limits, adapter
ratings, station voltage class, and site-level power throttling.

### The concrete failure this prevents

A Hummer EV parked at a public ChargePoint for eight hours, starting at 30%:

| Assumption | Departure SOC |
|---|---|
| Trust the charger's badge (7.7 kW) | 55.7% |
| Use what it actually delivers (6.4 kW) | 51.4% |

Four points of SOC — about 9 kWh, roughly 25 miles — from one wrong number.
Flat-math apps make this error invisible.

---

## 2. Who it's for

- **Primary:** drivers whose charging happens while parked — commuters on
  workplace chargers, tradespeople at job sites, people without home charging,
  fleet and van operators, anyone on destination Level 2.
- **Secondary:** owners of high-capacity or 800 V vehicles, where the gap between
  naive and correct maths is largest.
- **Tertiary:** anyone using adapters through the CCS→NACS transition, where the
  adapter is frequently the real bottleneck and no app says so.

---

## 3. What makes it different

Five things, none of which exist together in any shipping app:

1. **Dwell-time framing.** Time parked is the primary input, not a by-product of
   a route.
2. **Any-field solver.** Five linked variables — arrival SOC, departure SOC,
   dwell time, charger rate, clock times. Fill any subset, lock what can't move,
   solve the rest, forwards or backwards.
3. **Honest constraint attribution.** Every result names *which* limit is
   binding: vehicle curve, station output, adapter rating, station voltage class,
   temperature, or a measured site limit.
4. **Measured-rate override.** Enter the kW you can actually see; it overrides
   every calculated value. It also asks *where the reading came from* — the
   charger screen (before onboard losses) or the car's screen (already in the
   pack). Over eight hours those differ by about a point of SOC.
5. **Calibrated confidence.** Every number is labelled. An estimate is never
   allowed to masquerade as a measurement.

---

## 4. The engine — how the maths works

`ev-core.js`. Pure JavaScript, zero dependencies, **no DOM access, no platform
assumptions**. Runs unchanged in a browser, in Node, and in React Native. That
portability is a deliberate commercial decision, not an accident — see §7.

**AC charging:**
```
drawn      = min(vehicle onboard AC max, station output, adapter rating, override)
to battery = drawn × onboard-charger efficiency − cold-weather parasitic draw
```

**DC fast charging:**
```
vehicle capability = taper curve interpolated at current SOC
if 800 V pack on sub-600 V station → capped at vehicle's low-voltage limit
station capability = min(kW plate rating, volts × amps)
ceiling            = min(vehicle, station, adapter, override)
delivered          = ceiling × temperature factor
to battery         = delivered × DC efficiency
```

Integrated forward in 15-second steps. Every step records which constraint was
binding; the session reports the one that dominated by time.

### Modelling decisions worth preserving

- **Cold weather is a parasitic kW subtraction on AC, not a multiplier.** The
  wall still delivers its rated power; the battery heater takes a share the cells
  never see. On DC it is a multiplier. These are different physics and the code
  must keep treating them differently.
- **800 V pack on a 400 V station** is modelled per-vehicle and **blames the
  station, not the car**. About a quarter of the catalogue is 800 V-class.
- **Preconditioning** raises the temperature factor toward a ceiling *and charges
  the real time cost*. A "while still driving" option keeps the benefit without
  the dwell cost.
- **Shared cabinet.** "Someone's on the other side" halves a 350 kW post. Users
  can say so.
- **Reverse solve** uses bisection, valid because end SOC is provably monotonic
  in start SOC — which is itself an asserted test.
- **A solve is allowed to fail.** A failed requirement triggers a constraint
  resolver that offers specific levers, rather than throwing an error.

### Pricing

`ev-pricing.js` is the **sole rate authority**. Every other module consumes it.

- **Price-authority model:** network / per-site / host. Most "networks" don't
  actually set prices, and pretending otherwise produces confident wrong numbers.
- **Billing is on energy out of the dispenser, not into the pack.** The meter
  sits on the charger side, so charging losses are on the bill. On AC that gap is
  ~11% and larger in the cold.
- **Order of operations, proven by a settled receipt:**
  `rate → discount → subtotal → tax`. Sales tax is applied to the subtotal, never
  folded into the per-kWh rate, because a membership discount applies pre-tax.
- **Idle fees with grace periods.** This is the feature the app exists for. Only
  a dwell planner knows the car finishes before the user comes back.
- Time-of-use with proper integration across window boundaries. Without a known
  start clock the code falls back to the flat rate rather than guessing a band.
- Power-banded billing, membership plans, break-even comparison, manual rate
  editor, named saved rate cards.

---

## 5. Data and the provenance model

### Vehicles

Every non-Chinese BEV sold in North America, roughly MY2011 onward, generations
and trims rather than just current models.

**Pack variant is mandatory, never optional.** A 20-module and a 24-module Hummer
share a badge and behave nothing alike — 170 kWh vs 212.7 kWh, about ten points
of SOC difference over an identical eight-hour dwell. A VIN-reported module count
settles the variant outright.

**VIN decode** via free NHTSA vPIC — no key, no account. Returns modules per pack,
pack voltage, onboard charger kW.

### Adapters and stations

Adapter ratings researched from manufacturer listings. Two findings that matter:
the GM adapter is 500 A / 1000 V and is never the bottleneck; the LENZ adapter is
500 A but only **500 V**, which cripples an 800 V pack even at a 1000 V post.

Station presets include **208 V commercial** at multiple amperages, because that
is what commercial buildings actually run and it is the single most common cause
of "why is this slower than the sticker says".

### Provenance — the honesty model

Every curve carries a confidence flag:

| Flag | Meaning |
|---|---|
| `observed` | Built from **multiple real logged sessions across multiple SOC ranges** of that exact vehicle |
| `published` | From manufacturer or reputable published curve data |
| `estimated` | Normalised platform template scaled to a published peak |
| `user` | Hand-edited in the app. **Typing numbers into a form is not a measurement.** |

A build-time gate enforces the `observed` count. **Nothing currently claims
`observed`, and that is correct.** It gets re-earned, not assumed.

The same discipline applies to pricing (`published` / `secondary` / `estimated` /
`unavailable` / `user`) and to discount data (`unverified` entries are never
auto-applied).

---

## 6. Deliberately not built

- No maps, routing or navigation. Drive times are manual input.
- No charger-network database as a product. PlugShare already does that.
- No accounts, no cloud sync. Data is local.
- No payments or charging-network integration.
- **No live telemetry from the car.** SOC is entered by hand.

**Three optional network calls, not two.** Everything the app *calculates* works
offline; three features will reach the network if the user asks them to, and each
falls back to manual entry or a built-in list when it can't:

| call | feature | note |
|---|---|---|
| NHTSA vPIC | VIN decode | free, no key |
| Open-Meteo | current temperature | free, no key |
| `developer.nlr.gov` | nearby DC station finder | ships a **shared `DEMO_KEY`** that rate-limits under load; a personal key is free from `developer.nlr.gov/signup` and lifts the limit |

**NLR, formerly NREL.** The Department of Energy renamed the National Renewable
Energy Laboratory to the **National Laboratory of the Rockies** and moved its
developer network to `developer.nlr.gov`. DNS for `nrel.gov` and all subdomains
ceased to resolve and does **not** redirect — the old host is gone, not slow.
Only the host changed: paths, parameters, response shape and existing API keys
are unaffected.

The station-finder call is the one to watch, and it has now proved it twice over.
A shared demo key is a shared quota, so it returns 429 exactly when usage grows.
And the host itself moved out from under a shipped build inside a month. It
degrades to the built-in station list rather than failing, which is correct, but
it is the only dependency in the app whose reliability gets *worse* as the app
gets more popular — and the only one that can be broken by someone else's
decision.

The first two are scope discipline. The last two are the real gaps for a
commercial product — see §7.

---

## 7. Commercial position — stated bluntly

### Distribution

A PWA cannot be submitted to the Apple App Store, and a thin WKWebView wrapper is
the most common rejection under **Guideline 4.2 (Minimum Functionality)**.

Order, by return on effort:

1. **License-key unlock on the existing PWA.** A weekend. No store, no fee.
   Merchant of record (Lemon Squeezy / Polar / Gumroad) handles VAT and sales tax.
2. **Google Play via Trusted Web Activity.** $25 one-time. The PWA qualifies
   today. Nearly all of it can be driven from a phone.
3. **iOS via React Native / Expo.** $99/yr, 6–10 weeks. Chosen specifically
   because the engine is pure JS and imports **unchanged**; only the UI gets
   rebuilt. SwiftUI was rejected — it would mean porting the physics and
   re-earning the calibration. Capacitor-plus-native-features was rejected as a
   false economy. **Apple genuinely requires a Mac** at build and signing time.

Start both developer enrolments early. Verification runs in the background and
Apple's is the slow one.

### Monetisation

Free tier: one vehicle, solver, milestones, temperature.
Paid unlock, **$14.99 one-time, not a subscription**: unlimited garage, saved
chargers, measured-rate override, multi-leg trips, saved trips.

No server costs, no content treadmill, episodic usage. Subscriptions on a
calculator invite refunds and one-star reviews. Apple's Small Business Program
drops commission to 15%.

### Market reality

As a standalone consumer app this will likely generate **hundreds to low
thousands of dollars**, not a business. The constraint is discovery, not quality:
an indie utility with no brand and no content engine does not get found.

Value ranking:

1. **Engine + curve library as a licensable component** — fleet/telematics
   platforms, depot charging software, EVSE makers, charging networks.
   Realistic: $5k–40k/yr for a small vendor, $50k–150k/yr for a large one.
   6–18 month sales cycles.
2. **B2B / fleet depot planning** — genuine budgeted pain, different product and
   sales motion.
3. **Consumer app** — portfolio piece and credibility artifact.

### Valuation reality

The ceiling on code value is **replacement cost**. A competent engineer rebuilds
this engine in 4–8 weeks, and that is the number a buyer's CTO puts in the room.
Outright sale today: **$25k–150k to a motivated strategic buyer, with "no buyer at
all" the likely outcome** absent traction. A $5–10M outcome is not available.

For context: ABRP's parent Iternio was acquired by Rivian in 2023 with five years
of history, a team, a B2B planning API shipping in Polestar since 2021, and 109M+
trips planned. Google Maps does not acquire from indie developers.

**Do not hire.** $18–30k US / $8–14k offshore is a loss at this market size.

### The one lever that changes the ceiling

**Vehicle telemetry integration** (Smartcar, Tessie, OEM fleet APIs) does three
things at once:

- Removes manual SOC entry — the biggest UX friction
- Auto-logs real charging sessions from every user
- Converts zero measured curves into hundreds, as a function of usage

That flips "build or buy?" from *build* to *buy, because we cannot build the
data*. It is the only lever fully under the owner's control.

---

## 8. Locked decisions — do not relitigate without new evidence

- **`ev-pricing.js` is the sole rate authority.** `ev-discounts.js` keeps
  eligibility, percentages, plans and waivers, and applies them *to* whatever
  pricing resolves. Its `rackRate` table is a fallback only for networks pricing
  doesn't cover, and must be visibly tagged as an estimated national rate so
  there is no invisible accuracy cliff.
- **ChargeStack does not ship as a standalone app.** The eligibility layer merges
  into Dwell. The promo-code feed is dropped entirely.
- **One app, one domain, one brand.** `dwellplanner.com` for the app,
  `/discounts` for the free eligibility checker, `/promo-codes` for an honest
  static SEO page.
- **Monetisation: free tier + $14.99 one-time unlock. Not a subscription.**
- **Channel order:** PWA licence key → Google Play TWA → iOS via RN/Expo.
- **No auto-fill into charging network apps.** No API exists, both stores forbid
  it, Android hardened against the workaround in March 2026.

### The governing test for any proposed feature

> **Does this create a recurring cost or a recurring verification burden?**

If no, it can live in a one-time-purchase offline app. If yes, it can't.
Static tables pass. Scrapers fail. Apply this to anything proposed.

---

## 9. Non-negotiable principles

- **Offline-first.** Breaking offline behaviour is a build failure, not a
  tradeoff.
- **Never invent data.** If a rate can't be verified, return `unavailable` with
  an explanation rather than a guess. Removing an unsourced number is always
  allowed; replacing it with a different unsourced number is not.
- **Provenance honesty on every data type.** Every entry carries source, date
  verified, and confidence. State it visibly in the UI, not in a footer.
- **Physical observation beats published specs.** Where the owner's direct
  observation contradicts documentation, the observation wins.
- **One session is data, not a calibration.** Record a disagreement between model
  and measurement in `observations/`. Do not refit the model to a single session
  — that trades one wrong curve for a differently wrong curve still carrying a
  confident label.
- **User override always wins**, and the UI must say which source is in use.
- **No analytics, ad SDKs, crash reporting or tracking.** The privacy story is a
  real asset — keep it clean.
- **Don't change the engine's calculation behaviour** without saying explicitly
  what changed and why.
- **Don't fork or duplicate data.** `ev-library.js` is the single source of truth
  for vehicles; read it, don't copy it.

---

## 10. Known weaknesses — state honestly, never paper over

**Zero measured curves.** Every vehicle in the catalogue is `estimated` or
`published`. The labels are honest and the build gate enforces it, but the app
should never imply otherwise.

**The shared 800 V template is pessimistic in the upper SOC band.** One logged
session came in about 40% faster than the template predicted, above 60% SOC. That
template is shared by roughly fifty vehicles, so if the bias is real it affects
all of them in the same direction — dwell times too long, departure SOC too low.
One session is not enough to recalibrate. It is disclosed in the library header
rather than silently corrected.

**Discount data churns faster than the research admits.** The original brief said
"a few times a year"; its own calendar listed six dated changes inside eight
months. The merge is still correct, but it commits to indefinite quarterly
refreshes on a one-time purchase, delivered via free updates. Budget a few hours
per quarter. Don't pretend it's zero.

**The funnel assumption may be backwards.** The plan assumes the free eligibility
checker is the funnel and Dwell is the destination — but the same research shows
"EVgo promo code" has real search volume while "dwell time charging calculator"
has almost none. Don't restructure on this now. Do instrument it: track checker
completions against click-throughs to Dwell from day one and let the ratio answer
the question.

**Trademark exposure.** Vehicle names and network names appear throughout.
Review before charging money.

---

## 11. Measurement practice — hard-won

- **The charger screen is the meter. The phone app is a lagging summary of it.**
  Observed: the app reported 78.29 kWh; 52 seconds later the dispenser reported
  81.98 — a 3.69 kWh gap where 52 s at 30 kW is worth 0.43. The app's
  instantaneous kW tile is worse: it read 45 kW at a moment its own energy
  counter proves the vehicle was averaging 106.
- **Fit to the charger screen and the settled receipt.** Use app readings only
  for cost-versus-energy relationships, where both tiles lag together.
- **A settled receipt beats a mid-session reading.** An apparent "$0.99 session
  fee" turned out to be an artifact of fitting a line through laggy app readings
  while omitting sales tax. There was never a fee.
- **Flag assumed values as assumed.** Ambient temperature inferred from the date
  is not instrumented and any fit leaning on it is soft.

---

## 12. Battery chemistry — reference

Relevant because chemistry drives taper behaviour, which is what the curve
templates encode.

| | **NCMA / NCA** | **NMC** | **LFP** |
|---|---|---|---|
| Cell energy density | 250–280 Wh/kg | 200–260 Wh/kg | 160–200 Wh/kg |
| Nominal cell voltage | 3.6–3.7 V | 3.6–3.7 V | 3.2 V |
| Cobalt | ~5% | ~10–20% | **0%** |
| Cycle life (80% retention) | ~1,500–2,000 | ~1,000–2,000 | **~3,000–5,000** |
| Daily charge ceiling | **80%** | 80–90% | **100%** |
| Deep discharge tolerance | Poor | Poor | Good |
| Cold-weather performance | Good | Good | **Poor** |
| Thermal runaway onset | ~210 °C | ~210 °C | **~270 °C** |
| SOC estimation | Good (sloped curve) | Good | Poor (flat curve) — needs periodic 100% for BMS recalibration |
| Cost per kWh | Highest | High | **Lowest** |

**Taper consequence:** LFP is flatter early then cliffs late; 800 V high-nickel
packs hold high power much further up the SOC range; 400 V packs taper earlier
and more steadily. These are the three curve templates.

**Emerging:** LMR (GM pre-production late 2027, commercial 2028, ~33% higher
density than best LFP at comparable cost, aimed at trucks and full-size SUVs);
LMFP (ramping in China); sodium-ion (cheap, excellent cold, poor density, grid
storage first); semi-solid and solid state (premium 2027–28 at the earliest,
mainstream volume more likely post-2030 — watch pack-level Wh/kg, not cell-level,
and binding supply agreements, not research memoranda).

### The owner's vehicle

2025 GMC Hummer EV Pickup (SUT), 3X, 24-module. NCMA (~89% Ni / 5% Co / 5% Mn /
1% Al), large-format pouch, Ultium Cells LLC. Dual-stack **800 V**, 24 modules ×
24 cells = 576 cells, **~212.7 kWh usable**, 350 kW peak DC, 19.2 kW max onboard
AC, CCS1 native. Warranty 8 yr / 100,000 mi to 70% retention.

Care practice follows from high-nickel chemistry: 80% daily ceiling set
automatically, don't let it sit at 100%, avoid below 20%, stay plugged in at
temperature extremes, 80% max when towing or before a mountain descent (regen
headroom, not aging), 30% for long-term storage plus a 12 V tender.

**Does not apply:** 100% daily charging and full-cycle BMS "calibration" are LFP
practices and cost cycle life on this pack. GM's LFP and LMR roadmaps never apply
retroactively.

---

## 13. Working style

- Short, direct answers. No filler, no hedging preambles.
- Comparison tables when evaluating options.
- Be blunt. If a plan is weak, say so and say why rather than softening it.
- Ask before decisions that are permanent or expensive to reverse — package
  names, app titles, signing configuration, anything that ships to a store.
- Lead with the answer.
