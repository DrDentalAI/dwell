# Dwell Planner

EV charging calculator for the stationary case: *"I'm parked here for N hours on
this charger — what will my battery be at when I leave, and what will it cost?"*

See `docs/DWELL-BRIEF-2026-09-14.md` for the standing brief and the
non-negotiable principles, and `docs/DWELL-PROGRESS-2026-09-14.md` for where
the project stands. (`CLAUDE.md` is superseded and deleted -- it mixed durable
decisions with version state, so it went stale on contact.)

## Layout

| path | what |
|---|---|
| `ev-core.js` | Calculation engine. Pure JS, zero dependencies, no DOM. |
| `ev-library.js` | Vehicles, adapters, station presets. |
| `ev-pricing.js` | **Sole rate authority.** Networks, tariffs, taxes, idle fees. |
| `src/` | Front end — `app.js`, `app.css`, `app.html`. |
| `build.js` | Inlines everything into a single self-contained `index.html`. |
| `observations/` | **Raw measured data. Append-only. The only irreplaceable part.** |
| `index.html` | Built artifact. Committed because it is what gets deployed. |

## Build

```sh
node build.js
```

`BUILT="<stamp>" node build.js` pins the build timestamp, which makes a rebuild
byte-comparable against a previously shipped artifact.

## Deploy

`index.html` is the whole app. Upload it; nothing else is read at runtime.
