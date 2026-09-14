# Dwell Planner — Progress as of 14 September 2026

> **What this file is:** where the project actually stands today. Overwrite it
> each session. The date in the filename is the snapshot.
>
> **Where it goes:** project folder (Claude, Cowork) + `docs/` in the repo.
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
| **Deployed / live on phone** | v1.10.0 |
| **Built this session, ready to test** | **v1.11.1** |
| **Source in git** | ✅ recovered, verified lossless |
| Vehicles | 188 (3 year-splits added this session) |
| Curve provenance | 185 estimated · 3 published · **0 observed** |
| Pricing networks | 32 (19 US, 13 CA) |
| Not integrated | `pending/ev-discounts.js`, `pending/landing-discounts.html` |

---

## 2. What changed this session

### Recovered and verified

Source had been lost — the repo held only the built `index.html`. The tree was
reconstructed from that artifact and **verified lossless**: rebuilding with a
pinned timestamp reproduces the deployed file byte for byte. Independently
confirmed by a second reviewer who ran the build.

### Provenance repaired

- The one curve claiming `observed` was demoted to `estimated`. It had three
  anchors, one of which (a voltage-capped reading through an adapter) doesn't
  constrain the native curve at all, and a 49-point SOC gap in the middle. It had
  also been refitted to a single session while keeping the label.
- `curveEdit()` was granting `observed` to *any* hand-edited curve. Hand edits now
  carry a distinct `user` label.
- Build gate relaxed from "exactly one observed" to "at most one".
- `observations/` created — append-only raw data, the only irreplaceable part of
  the repo.

### The finding that changed the plan

The recorded note said the Hummer curve was "~2x too pessimistic above 55%". That
is **two defects stacked**, and only one is about that vehicle.

Against the authoritative charger-screen anchor — 62→99% in 51.78 minutes:

| | predicted | vs observed |
|---|---|---|
| Old hand-authored curve | 102.2 min | 1.97× |
| Bare `800v` template | 72.2 min | 1.39× |
| Observed | 51.78 min | — |

The hand-authored curve sat about **30% below the very template it claimed to be
generated from** — 97 kW at 65% SOC where the template says 147. That half was an
unsourced hand edit.

The other half is **the `800v` template itself**, which is shared by roughly fifty
vehicles — every Ioniq, EV6, Taycan, Silverado EV, Cybertruck, Air. If the bias is
real, all of them read long in the same direction. Nothing in the repo said so.

This is larger than the sales-tax gap by an order of magnitude. A 6% cost error is
a rounding annoyance; a 2× dwell error is the app failing at its core job.

### Fixes applied and verified — v1.11.0

| # | fix | verification |
|---|---|---|
| 1 | **Hummer curve regenerated from the `800v` template.** The unsourced hand edit was **removed, not replaced with a new fit.** | KATHLEEN session error **1.97× → 1.40×** |
| 2 | **Template bias disclosed** in the `SHAPE` header of `ev-library.js` — names the session, the ~40% figure, and the ~50 affected vehicles | — |
| 3 | `dcEfficiency` 0.96 → **0.952** on the Hummer | 37 SOC pts × 2.127 kWh ÷ 82.6275 kWh dispensed |
| 4 | **Sales tax.** `taxPct` on rates; `sessionCost` now returns `subTotal`, `taxPct`, `tax`; UI shows subtotal + tax lines | Discount applies pre-tax, matching receipt order |
| 5 | **EVgo Michigan 21:00–24:00 window → $0.4429/kWh**, receipt-derived, with the assumption stated in the note | $0.4429 × 0.70 = $0.3100 → $27.13 + 6% = **$28.76**, the settled receipt exactly |
| 6 | **EVgo `sessionLimitMinutes: 120`** | published and enforced |
| 7 | Blazer EV 85 kWh DC peak 190 → **150 kW** | 190 is the 102 kWh pack |
| 8 | Focus Electric 2012–16 → **23 kWh, J1772 only, no DC port**; 2017–18 split out with CCS1 | — |
| 9 | E-Transit split: 2022–23 at 68/115/11.3; **2024+ at 89 kWh / 180 kW / 19.2 kW** | — |
| 10 | Bolt split: **2020–21 at 7.2 kW** onboard AC; 2022–23 at 11.5 | — |
| 11 | Model 3 RWD LFP (both generations) onboard AC 11.5 → **7.7 kW** (32 A) | inflated every L2 dwell by ~a third |
| 12 | `pending/ev-discounts.js` and `pending/landing-discounts.html` **extracted from the master brief into real files** | both load clean; discounts exports 6 symbols |
| 13 | **Model-year defect fixed (v1.11.1).** `vehicleFromLibrary()` was naming every vehicle from the library entry's *newest* year and silently discarding the year the owner picked — so a 2025 truck came out labelled 2026. It now uses the picked year, clamped to the entry's span, and stores it as `modelYear`. First-run default set to 2025. | owner-reported |
| 14 | **Owner's vehicle recorded as MY2025, trim 3X** in `observations/vehicle-hummer-sut-24.json`. The library entry still spans MY2022-2026, which is correct for the catalogue. | owner-confirmed |

**Deliberately NOT applied:**

- **Hummer 20-module DC peak 283 → 300 kW.** "283 was invented" justifies
  *removing* it, not trusting 300. Needs a source. Still 283.
- **`dcEffAt()` near-full efficiency collapse.** The effect is well evidenced —
  the final 13 minutes bought 4.90 kWh to store about 2.13 — but
  `balancingSOC: 98` and `balancingEfficiency: 0.35` are two free parameters
  fitted to one tail. Record the mechanism; ship on a second session.
- **GM native NACS MY2026 → MY2027.** Nothing in the library encodes a GM NACS
  model year, so there was nothing to correct. Verify before adding.
- **Any refit of the `800v` template.** One session is not a calibration.

---

## 3. Blocked

**`DrDentalAI/dwell` is not in the Cowork session's authorized sources.** Commits
cannot be pushed. Three sessions in a row have lost time to manual file transfer.

**This is the only blocker that can't be cleared from inside a session.** Two
minutes in the repo authorization settings.

Until then, restore from the bundle:
```
git clone dwell-source.bundle dwell
# or into an existing clone:
git pull /path/to/dwell-source.bundle main
```

---

## 4. Rebuild list — decisions made

The seven versions v1.11–v1.17 built after v1.10.0 exist nowhere on disk.
`REBUILD-CANDIDATES.md` enumerated them. Decisions:

| item | call |
|---|---|
| Hummer curve refit | **DROP** — superseded; session lives in `observations/` |
| `observedFeeAnomaly` (phantom $0.99 fee) | **DROP** — receipt shows $0.00 |
| Sales tax | **DONE** in v1.11.0 |
| EVgo rate from receipt | **DONE** in v1.11.0 |
| Session caps | **DONE** in v1.11.0 |
| Seven base-spec corrections | **DONE** except the unsourced 283→300 |
| `dcEfficiency` 0.952 | **DONE** — survives the overfitting objection |
| `dcEffAt()` balancing collapse | **HOLD** — two free parameters, one session |
| Range as a temperature band | **KEEP** — not started |
| Per-model-year specs (`byYear`, `specsFor()`) | **KEEP** — not started. Partially pre-empted by the year splits in v1.11.0 |
| EPA vs manufacturer range flag + build gate | **KEEP** — not started |
| `ev-yeardata.js` merge layer | **KEEP** — not started |
| fueleconomy.gov EPA lookup | **KEEP** — not started, passes the governing test |

**Sequencing that matters:** sales tax and the receipt-derived EVgo rate were
prerequisites for the discount work, not peers of it. Both are now done, so the
discount integration is unblocked.

---

## 5. Queue, in order

| # | item | state |
|---|---|---|
| 1 | Authorize the repo | **blocked on owner** |
| 2 | Test v1.11.0 on the phone | ready |
| 3 | Delete superseded docs (see §6) | ready |
| 4 | IONNA Sept 30 expiries + Mercedes LABORDAY state | pending — 16 days out |
| 5 | Discount integration + data-freshness indicator | unblocked by v1.11.0 |
| 6 | `/discounts` free eligibility checker | pending |
| 7 | Google Play via TWA | pending |
| 8 | Remaining KEEP items from §4 | pending |

**On IONNA:** the module auto-expires correctly, so nothing breaks. But if either
discount was renewed, eligible BMW/MINI and Hyundai/Genesis drivers are silently
under-reported. Check, don't assume.

### Open proposal, not decided

**Show estimated curves as a range rather than a point.** If the template has a
known directional bias that can't yet be quantified, "52–100 min" is more truthful
than a confident 102. It converts a weakness into a visible feature and is the
structurally honest response to §2's finding. Needs a decision.

### Agreed but not started

- **Curve viewer** — plot capacity, curve and rate per vehicle; advertised vs
  measured overlaid; shade which SOC ranges are actually measured.
- **Session logging** — log real sessions, attribute the residual to the vehicle
  only after backing out known constraints. Local-only, opt-in export. This is
  the path back to an honest `observed` label.
- **Charger-match table** — smallest charger class that gets your max rate for
  *this* session, so people stop queueing for 350 kW posts they can't use.
  Headline in minutes, not kW, because peak only happens at low SOC.

---

## 6. Document hygiene

**Delete these — superseded by the brief and this file:**

- `CLAUDE.md`
- `PRODUCT-SPEC.md` and `PRODUCT-SPEC2.md` (byte-identical duplicates)
- `DWELL-PLANNER-BRIEF.md`
- `EV-Battery-Chemistry-Guide.md` and `EV-Battery-Chemistry-Guide2.md`
  (duplicates; condensed into brief §12)
- `EVMASTERBRIEF.md` — knowledge folded into the brief, code extracted to
  `pending/`. **Keep one archived copy outside the working folder** until the
  discount integration lands, in case a research detail is needed.
- `STATUS.md`, `REBUILD-CANDIDATES.md` — superseded by this file

**The rule going forward:**

> **The repo holds code and measurements. The project folder holds decisions and
> direction. Nothing lives in both except these two docs, which are copied into
> `docs/` so they travel with the code.**

---

## 7. Cold start — reading this with no other context

If the chat or session that produced this is gone, this is enough to resume:

1. **Read `DWELL-BRIEF-<date>.md` first.** What the project is, what's decided,
   the principles. Do not relitigate §8 or §9 of it without new evidence.
2. **Read this file second.** State, blockers, queue.
3. **Get the code:** `git clone https://github.com/DrDentalAI/dwell` — or from the
   bundle if the repo is still unauthorized.
4. **Verify the tree builds before changing anything:** `node build.js` should
   produce a self-contained `index.html` with no errors.
5. **Read `observations/` before touching any curve or rate.** It is the only
   irreplaceable data in the repo. Everything else can be rebuilt.
6. Start at the top of §5 that isn't done.

**The two traps this project has already fallen into, twice each:**

- Labelling something `observed` that was hand-authored or fitted to one session.
- Losing source because only the built artifact was committed.

---

## 8. End-of-session recap — standing instruction

**At the end of every working session, regenerate this file** with the date
updated, and **also output it as a single copyable block** so it can be pasted
into a chat that has no access to the repo.

Always include, explicitly:

1. **What changed** — with verification, not just claims. "Fixed X" is worth
   little; "fixed X, error went from 1.97× to 1.40× against the KATHLEEN anchor"
   is worth a lot.
2. **What is now blocked or needs an owner decision** — the two things that
   actually get lost between sessions.
3. **An upload verdict, stated plainly**, in one of two forms:
   - `NO UPLOAD NEEDED — routine code changes only.`
   - `UPLOAD THE PROGRESS FILE — <reason>.`

   Trigger an upload when a **decision changed, something got unblocked, or the
   queue reordered.** Not for routine code edits.

Pasting the recap into chat is enough for continuity of conversation. It is
**not** enough for continuity of the project — pasted text dies with the chat.
The file survives. Paste every session; upload when the verdict says so.
