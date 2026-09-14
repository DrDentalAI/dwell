# Observations

Raw measured data. **This is the only part of the repository that cannot be
rewritten.** Code is cheap; a charging session that already happened is not.

Nothing here is derived, fitted, rounded to taste, or reconciled with the model.
Where two instruments disagreed, both readings are recorded along with which one
is the meter. Where a figure was assumed rather than read, it is marked
`assumed: true`.

## Rules

- **Append only.** Correct an entry by adding a note, never by editing a reading.
- **Record the instrument.** A charger screen, a phone app and a car dash are
  three different instruments with three different lag and rounding behaviours,
  and on 12 Aug 2026 they disagreed materially. `source` is not optional.
- **Never fit here.** Curve fitting, tariff solving and calibration belong in
  code that *reads* these files. If a model disagrees with an observation, that
  is a fact about the model.
- **Assumptions are flagged.** Ambient temperature was not instrumented on any
  session below; every temperature is `assumed`.

## Why this directory exists

Every charging curve in `ev-library.js` is `estimated`. Nothing claims
`observed`, and the build fails if more than one ever does. `observed` is
re-earned by accumulating sessions here across several SOC ranges, temperatures
and stations — not granted from a single good session.
