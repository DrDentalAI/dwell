/* =========================================================================
   EV DWELL PLANNER — SHARED CALCULATION CORE  (v1.0)
   Pure, dependency-free. Consumed identically by web and mobile front ends.
   Units: SOC = percent (0-100) | power = kW | energy = kWh | time = minutes
   ========================================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EVCore = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

/* ---------------------------------------------------------------- CONNECTORS */
const CONNECTORS = {
  J1772:   { id:'J1772',   level:'AC', label:'J1772',        short:'J1772' },
  NACS_AC: { id:'NACS_AC', level:'AC', label:'NACS (AC)',    short:'NACS' },
  CCS1:    { id:'CCS1',    level:'DC', label:'CCS1',         short:'CCS1' },
  NACS_DC: { id:'NACS_DC', level:'DC', label:'NACS (DC)',    short:'NACS' },
  CHADEMO: { id:'CHADEMO', level:'DC', label:'CHAdeMO',      short:'CHAdeMO' }
};

/* ------------------------------------------------------------------- MATH */
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

/** Piecewise-linear interpolation over [{soc,kW}] sorted ascending by soc. */
function interpCurve(curve, soc) {
  if (!curve || !curve.length) return 0;
  const s = clamp(soc, 0, 100);
  if (s <= curve[0].soc) return curve[0].kW;
  for (let i = 1; i < curve.length; i++) {
    if (s <= curve[i].soc) {
      const a = curve[i - 1], b = curve[i];
      const span = b.soc - a.soc;
      if (span <= 0) return b.kW;
      return a.kW + (b.kW - a.kW) * ((s - a.soc) / span);
    }
  }
  return curve[curve.length - 1].kW;
}

/** Interpolate a [ [x,y], ... ] table, flat outside the ends. */
function interpTable(tbl, x) {
  if (x <= tbl[0][0]) return tbl[0][1];
  for (let i = 1; i < tbl.length; i++) {
    if (x <= tbl[i][0]) {
      const [x0, y0] = tbl[i - 1], [x1, y1] = tbl[i];
      return y0 + (y1 - y0) * ((x - x0) / (x1 - x0));
    }
  }
  return tbl[tbl.length - 1][1];
}

/* ------------------------------------------------------------- THERMAL MODEL
   DC fast charging is strongly temperature dependent: a cold pack limits
   current to protect against lithium plating; a hot pack limits it to protect
   against thermal runaway. AC charging is slow enough that the pack itself is
   not the limit -- but the battery heater draws real power that never reaches
   the cells, so cold AC charging is modelled as a parasitic kW subtraction
   rather than a multiplier.                                                  */

const DC_TEMP_FACTOR = [           // ambient degC -> multiplier on DC power
  [-25, 0.28], [-20, 0.35], [-15, 0.42], [-10, 0.50], [-5, 0.59],
  [0, 0.68], [5, 0.78], [10, 0.88], [15, 0.95], [20, 1.00],
  [30, 1.00], [35, 0.96], [40, 0.88], [45, 0.78], [50, 0.68]
];

const AC_PARASITIC_KW = [          // ambient degC -> kW lost to pack heating
  [-25, 5.0], [-15, 4.2], [-10, 3.6], [-5, 3.0], [0, 2.4],
  [5, 1.7], [10, 1.0], [15, 0.3], [20, 0.0], [45, 0.0]
];

/** Enclosed parking (garage) blunts the cold penalty; it does not help in heat. */
function effectiveTempC(tempC, enclosed) {
  if (!enclosed) return tempC;
  if (tempC >= 15) return tempC;              // no benefit once already mild
  return Math.min(15, tempC + 10);            // garage buffer, capped at mild
}

/**
 * DC thermal result.
 * Preconditioning does not make the pack charge faster for free -- it spends
 * energy and time warming the cells first. So we raise the factor toward the
 * preconditioned ceiling AND report the overhead minutes it cost.
 *
 * env.precondEnRoute: the pack was warmed while still driving (navigate-to-
 * charger preconditioning). The benefit is kept, the plugged-in overhead is
 * not charged to the dwell, because it happened before arrival.
 */
function dcThermal(env) {
  const t = effectiveTempC(env.tempC, env.enclosed);
  let factor = interpTable(DC_TEMP_FACTOR, t);
  let overheadMin = 0;
  let precondApplied = false;
  if (env.precondition && t < 18) {
    const ceiling = 0.93;
    if (factor < ceiling) {
      overheadMin = env.precondEnRoute ? 0 : Math.round(clamp((18 - t) * 0.6, 3, 15));
      factor = ceiling;
      precondApplied = true;
    }
  }
  return { factor, overheadMin, effTempC: t, precondApplied };
}

function acThermal(env) {
  const t = effectiveTempC(env.tempC, env.enclosed);
  return { parasiticKW: interpTable(AC_PARASITIC_KW, t), effTempC: t };
}

/* ----------------------------------------------------------------- LIMITS */

/** Power ceiling of a station or adapter from its kW / volt / amp ratings. */
function ratedKW(o) {
  if (!o) return Infinity;
  const byPower = (o.maxKW != null && o.maxKW > 0) ? o.maxKW : Infinity;
  const byVA = (o.maxVoltage > 0 && o.maxAmps > 0)
    ? (o.maxVoltage * o.maxAmps) / 1000 : Infinity;
  const v = Math.min(byPower, byVA);
  return isFinite(v) ? v : Infinity;
}

/**
 * Does this pairing need an adapter, and is a usable one configured?
 * Returns { required, satisfied, adapter, slot, reason }.
 */
function resolveAdapter(vehicle, station) {
  const level = station.level;                        // 'AC' | 'DC'
  const native = level === 'AC' ? vehicle.nativeAC : vehicle.nativeDC;
  const slot   = level === 'AC' ? 'acAdapter' : 'dcAdapter';
  if (station.connector === native) {
    return { required:false, satisfied:true, adapter:null, slot,
             reason:`Native ${CONNECTORS[native].label} — no adapter needed.` };
  }
  const ad = vehicle[slot];
  if (!ad) {
    return { required:true, satisfied:false, adapter:null, slot,
             reason:`A ${CONNECTORS[station.connector].label} → ${CONNECTORS[native].label} ${level} adapter is required, but none is configured.` };
  }
  const mismatch = (ad.fromConnector && ad.fromConnector !== station.connector) ||
                   (ad.toConnector   && ad.toConnector   !== native);
  if (mismatch) {
    return { required:true, satisfied:false, adapter:ad, slot,
             reason:`Configured ${level} adapter is ${CONNECTORS[ad.fromConnector].label} → ${CONNECTORS[ad.toConnector].label}; this station needs ${CONNECTORS[station.connector].label} → ${CONNECTORS[native].label}.` };
  }
  return { required:true, satisfied:true, adapter:ad, slot,
           reason:`Using ${ad.name || 'adapter'} (${ratedKW(ad).toFixed(0)} kW ceiling).` };
}

/**
 * Instantaneous power at a given SOC.
 * Returns everything the UI needs to explain itself, not just a number.
 */
function powerAt(vehicle, station, adapter, env, soc) {
  const isDC = station.level === 'DC';
  const adapterKW = ratedKW(adapter);
  let vehicleKW, note = null, voltageCapped = false;

  /* SHARED CABINET. Most 350 kW DC posts are one power cabinet feeding two
     connectors. Alone you get the full rating; with a car on the other side
     the cabinet splits its output and your plate-rated 350 kW post behaves
     like a 175 kW one. This is invisible on every spec sheet and is a pure
     dwell-time problem, so it is modelled as a station property and blamed
     on the station -- with its own label, because "the cabinet is shared"
     is different advice from "this charger is small". */
  let stationKW = ratedKW(station), shareCapped = false;
  if (station.shared && station.sharedMaxKW != null && station.sharedMaxKW < stationKW) {
    stationKW = station.sharedMaxKW;
    shareCapped = true;
  }

  if (isDC) {
    vehicleKW = interpCurve(vehicle.dcCurve, soc);
    // 800V-architecture packs on a 400V-class station: the pack is split and
    // charged in halves (or via a booster), capping accepted power well below
    // the vehicle's native curve. This is why a Hummer sees ~180 kW on a
    // Tesla V3 but 340+ kW on a true 1000V CCS post. The cause is the
    // station's voltage class, not the car -- so it is reported that way.
    if (vehicle.packArchitectureV >= 700 && station.maxVoltage &&
        station.maxVoltage < 600 && vehicle.lowVoltStationMaxKW) {
      if (vehicle.lowVoltStationMaxKW < vehicleKW) {
        vehicleKW = vehicle.lowVoltStationMaxKW;
        voltageCapped = true;
        note = `This is a ${station.maxVoltage} V-class post. The ${vehicle.packArchitectureV} V pack has to charge in split halves here, capping it at ${vehicle.lowVoltStationMaxKW} kW instead of the ${interpCurve(vehicle.dcCurve, soc).toFixed(0)} kW it could take on a 1000 V post.`;
      }
    }
  } else {
    vehicleKW = vehicle.acMaxKW;
  }

  let raw = Math.min(vehicleKW, stationKW, adapterKW);

  // Which of the three is actually binding?
  let binding = voltageCapped ? 'stationVoltage' : 'vehicle', bindingKW = vehicleKW;
  if (stationKW < bindingKW - 0.05) {
    binding = shareCapped ? 'stationShared' : 'station'; bindingKW = stationKW;
    if (shareCapped) note = `This post shares one power cabinet between two connectors. With a car on the other side it splits down to ${station.sharedMaxKW} kW instead of its rated ${ratedKW(station).toFixed(0)} kW.`;
  }
  if (adapterKW < bindingKW - 0.05) { binding = 'adapter'; bindingKW = adapterKW; }

  // MEASURED RATE OVERRIDE.
  // Real sites deliver less than their plate rating: 208 V commercial service
  // instead of 240 V, shared circuits, dynamic load management, a derated
  // cabinet. None of that is discoverable from a spec sheet, but the driver can
  // simply read the number off the charger or the car. A measured value beats
  // every calculated one, so it is applied as a hard ceiling.
  //   at 'input'   -> what the charger/app reports (before onboard losses)
  //   at 'battery' -> what the car reports going into the pack (after losses)
  const obs = station.observed;
  const hasObs = obs && obs.kW > 0;
  if (hasObs && obs.at !== 'battery' && obs.kW < raw - 0.01) {
    raw = obs.kW; binding = 'measured';
  }

  let delivered, toBattery, thermal;
  if (isDC) {
    thermal = dcThermal(env);
    delivered = raw * thermal.factor;
    toBattery = delivered * (vehicle.dcEfficiency != null ? vehicle.dcEfficiency : 0.96);
  } else {
    thermal = acThermal(env);
    delivered = raw;
    toBattery = Math.max(0, delivered * (vehicle.acEfficiency != null ? vehicle.acEfficiency : 0.89)
                            - thermal.parasiticKW);
  }

  if (hasObs && obs.at === 'battery' && obs.kW < toBattery - 0.01) {
    toBattery = obs.kW;
    binding = 'measured';
    // Back out the corresponding input power so the displayed rate stays honest.
    delivered = isDC
      ? toBattery / (vehicle.dcEfficiency != null ? vehicle.dcEfficiency : 0.96)
      : (toBattery + thermal.parasiticKW) / (vehicle.acEfficiency != null ? vehicle.acEfficiency : 0.89);
  }

  // A measured reading already embodies whatever the site is doing right now, so
  // it is never relabelled as a thermal limit.
  if (binding !== 'measured') {
    if (isDC && thermal.factor < 0.985) binding += '+thermal';
    else if (!isDC && thermal.parasiticKW > 0.2) binding += '+thermal';
  }

  return { vehicleKW, stationKW, adapterKW, raw, delivered,
           toBattery: Math.max(0, toBattery), binding, thermal, note, voltageCapped };
}

/* -------------------------------------------------------------- SIMULATION */

const STEP_MIN = 0.25;   // integration step; 15 s keeps taper error negligible

/**
 * Integrate a charging session forward.
 * Exactly one of durationMin / targetSOC must be supplied.
 * Returns endSOC, minutes, timeline samples, energy, and limiter accounting.
 */
function simulate(vehicle, station, adapter, env, startSOC, opts) {
  const usable = vehicle.usableKWh;
  const hasDuration = opts.durationMin != null;
  const target = opts.targetSOC != null ? clamp(opts.targetSOC, 0, 100) : 100;
  const capMin = opts.maxMinutes != null ? opts.maxMinutes : 60 * 48;

  const isDC = station.level === 'DC';
  const th = isDC ? dcThermal(env) : null;
  const precondMin = isDC ? th.overheadMin : 0;

  // Preconditioning overhead is dead time at the front of the session: the
  // pack is warming, meaningful energy is not going in.
  let budget = hasDuration ? Math.max(0, opts.durationMin - precondMin) : capMin;

  let soc = clamp(startSOC, 0, 100);
  // energy   = kWh into the PACK (what moves the SOC needle)
  // delivered = kWh out of the DISPENSER (what the meter bills you for).
  // They differ by charging losses -- ~3% on DC, ~11% on AC, more in the cold
  // where the pack heater is drawing too. Billing off the pack figure quietly
  // undercounts every AC session by a tenth.
  let t = 0, energy = 0, deliveredKWh = 0, powerSum = 0, samples = 0;
  let peakKW = 0;
  // Seed the first sample with the actual starting power, not zero -- otherwise
  // every plotted power curve begins with a phantom spike up from the axis.
  const timeline = [{ min: 0, soc, kW: powerAt(vehicle, station, adapter, env, soc).delivered }];
  const limiterMinutes = {};
  let stalled = false;

  while (t < budget) {
    if (!hasDuration && soc >= target - 1e-6) break;
    if (soc >= 100 - 1e-9) break;

    const p = powerAt(vehicle, station, adapter, env, soc);
    if (p.toBattery <= 0.02) { stalled = true; break; }

    limiterMinutes[p.binding] = (limiterMinutes[p.binding] || 0) + STEP_MIN;
    if (p.delivered > peakKW) peakKW = p.delivered;
    powerSum += p.delivered; samples++;

    let dE = p.toBattery * (STEP_MIN / 60);
    let dSOC = (dE / usable) * 100;
    const ceiling = hasDuration ? 100 : target;

    const dDel = p.delivered * (STEP_MIN / 60);

    if (soc + dSOC >= ceiling) {                 // partial final step
      const frac = (ceiling - soc) / dSOC;
      t += STEP_MIN * frac;
      energy += dE * frac;
      deliveredKWh += dDel * frac;
      soc = ceiling;
      timeline.push({ min: t + precondMin, soc, kW: p.delivered });
      break;
    }
    soc += dSOC; energy += dE; deliveredKWh += dDel; t += STEP_MIN;
    timeline.push({ min: t + precondMin, soc, kW: p.delivered });
  }

  const chargeMin = t;
  const totalMin = hasDuration ? opts.durationMin : chargeMin + precondMin;

  let dominant = null, dominantMin = 0;
  for (const k in limiterMinutes) if (limiterMinutes[k] > dominantMin) { dominantMin = limiterMinutes[k]; dominant = k; }

  return {
    startSOC: clamp(startSOC, 0, 100),
    endSOC: soc,
    minutes: totalMin,
    chargeMinutes: chargeMin,
    precondMinutes: precondMin,
    reachedTarget: !hasDuration ? soc >= target - 1e-6 : null,
    energyKWh: energy,
    deliveredKWh,
    avgKW: samples ? powerSum / samples : 0,
    peakKW,
    stalled,
    timeline,
    limiterMinutes,
    dominantLimiter: dominant,
    thermal: th || acThermal(env)
  };
}

/** Minutes needed to go startSOC -> targetSOC. null if unreachable. */
function timeToSOC(vehicle, station, adapter, env, startSOC, targetSOC) {
  if (targetSOC <= startSOC + 1e-9) return 0;
  const r = simulate(vehicle, station, adapter, env, startSOC, { targetSOC });
  return r.reachedTarget ? r.minutes : null;
}

/**
 * Minimum arrival SOC that still reaches targetSOC within durationMin.
 * endSOC is monotonically non-decreasing in startSOC, so bisect.
 */
function requiredStartSOC(vehicle, station, adapter, env, targetSOC, durationMin) {
  const full = simulate(vehicle, station, adapter, env, 100, { durationMin });
  if (full.endSOC < targetSOC - 1e-6) return null;   // impossible even from 100%
  let lo = 0, hi = clamp(targetSOC, 0, 100);
  const reaches = s => simulate(vehicle, station, adapter, env, s, { durationMin }).endSOC >= targetSOC - 1e-6;
  if (reaches(0)) return 0;
  for (let i = 0; i < 44; i++) {
    const mid = (lo + hi) / 2;
    if (reaches(mid)) hi = mid; else lo = mid;
  }
  return hi;
}

/* ------------------------------------------------------------- MILESTONES */
/** Clock time at which each SOC milestone is crossed. granularity 5 or 10. */
function milestones(sim, plugInMinutesOfDay, granularity) {
  const g = granularity || 10;
  const out = [];
  const tl = sim.timeline;
  if (tl.length < 2) return out;
  const first = Math.ceil(tl[0].soc / g) * g;
  const last = Math.floor(tl[tl.length - 1].soc / g) * g;
  let idx = 1;
  for (let m = first; m <= last + 1e-9; m += g) {
    while (idx < tl.length && tl[idx].soc < m) idx++;
    if (idx >= tl.length) break;
    const a = tl[idx - 1], b = tl[idx];
    const span = b.soc - a.soc;
    const frac = span > 1e-9 ? (m - a.soc) / span : 0;
    const min = a.min + (b.min - a.min) * frac;
    out.push({
      soc: m,
      elapsedMin: min,
      clockMinutes: plugInMinutesOfDay != null ? (plugInMinutesOfDay + min) : null,
      kW: b.kW
    });
  }
  return out;
}

/* ----------------------------------------------------------------- SOLVER
   Five linked variables:
     arrivalSOC, departureSOC, dwellMin, station config, clock times.
   Clock times are algebraically tied: unplug = plugIn + dwell, so the solver
   works in {arrivalSOC, departureSOC, dwellMin} and derives the clock.
   The caller marks each of the three as locked/known or unknown.            */

function solve(input) {
  const { vehicle, station, env } = input;
  const ad = resolveAdapter(vehicle, station);
  if (ad.required && !ad.satisfied) {
    return { ok:false, kind:'adapter', adapter:ad, message: ad.reason };
  }
  const adapter = ad.adapter;

  const known = {
    arrival:   input.arrivalSOC   != null,
    departure: input.departureSOC != null,
    dwell:     input.dwellMin     != null
  };
  const knownCount = (known.arrival ? 1 : 0) + (known.departure ? 1 : 0) + (known.dwell ? 1 : 0);

  if (knownCount < 2) {
    const missing = ['arrival','departure','dwell'].filter(k => !known[k]);
    return { ok:false, kind:'underdetermined', missing,
      message:`Two of the three are needed to solve the third. Still open: ${missing.join(', ')}.` };
  }

  const base = { vehicle, station, adapter, env, adapterInfo: ad };

  /* --- Solve for departure SOC (forward: arrive at X, sit for Y) --- */
  if (known.arrival && known.dwell && !known.departure) {
    const sim = simulate(vehicle, station, adapter, env, input.arrivalSOC, { durationMin: input.dwellMin });
    return finish(base, { solvedFor:'departure', arrivalSOC: input.arrivalSOC,
      departureSOC: sim.endSOC, dwellMin: input.dwellMin, sim }, input);
  }

  /* --- Solve for dwell (how long must I stay?) --- */
  if (known.arrival && known.departure && !known.dwell) {
    if (input.departureSOC <= input.arrivalSOC + 1e-9) {
      const sim = simulate(vehicle, station, adapter, env, input.arrivalSOC, { durationMin: 0 });
      return finish(base, { solvedFor:'dwell', arrivalSOC: input.arrivalSOC,
        departureSOC: input.arrivalSOC, dwellMin: 0, sim }, input);
    }
    const sim = simulate(vehicle, station, adapter, env, input.arrivalSOC, { targetSOC: input.departureSOC });
    if (!sim.reachedTarget) {
      return infeasible(base, input, sim, 'cannot-reach');
    }
    return finish(base, { solvedFor:'dwell', arrivalSOC: input.arrivalSOC,
      departureSOC: input.departureSOC, dwellMin: sim.minutes, sim }, input);
  }

  /* --- Solve for arrival SOC (reverse: leave at X by time T) --- */
  if (known.departure && known.dwell && !known.arrival) {
    const need = requiredStartSOC(vehicle, station, adapter, env, input.departureSOC, input.dwellMin);
    if (need == null) {
      const fromFull = simulate(vehicle, station, adapter, env, 100, { durationMin: input.dwellMin });
      return infeasible(base, input, fromFull, 'need-over-100');
    }
    const sim = simulate(vehicle, station, adapter, env, need, { durationMin: input.dwellMin });
    return finish(base, { solvedFor:'arrival', arrivalSOC: need,
      departureSOC: sim.endSOC, dwellMin: input.dwellMin, sim }, input);
  }

  /* --- All three given: verify consistency --- */
  const sim = simulate(vehicle, station, adapter, env, input.arrivalSOC, { durationMin: input.dwellMin });
  if (sim.endSOC < input.departureSOC - 0.25) {
    return infeasible(base, input, sim, 'overconstrained');
  }
  return finish(base, { solvedFor:'check', arrivalSOC: input.arrivalSOC,
    departureSOC: input.departureSOC, dwellMin: input.dwellMin, sim,
    surplus: sim.endSOC - input.departureSOC }, input);
}

function finish(base, res, input) {
  const plug = input.plugInMinutes != null ? input.plugInMinutes : null;
  return Object.assign({ ok:true, adapterInfo: base.adapterInfo,
    plugInMinutes: plug,
    unplugMinutes: plug != null ? plug + res.dwellMin : null
  }, res);
}

/* -------------------------------------------- FEASIBILITY / LEVER RESOLVER
   Never a bare error. State the gap precisely, then offer concrete levers,
   respecting whatever the user locked.                                      */

function infeasible(base, input, sim, cause) {
  const { vehicle, station, adapter, env } = base;
  const locked = input.locked || {};
  const target = input.departureSOC;
  const levers = [];

  // Lever 1: extend the dwell.
  if (!locked.dwell && input.arrivalSOC != null) {
    const s = simulate(vehicle, station, adapter, env, input.arrivalSOC, { targetSOC: target });
    if (s.reachedTarget) {
      levers.push({ type:'extend-dwell', minutes: s.minutes,
        extraMinutes: s.minutes - (input.dwellMin || 0),
        label:`Stay ${fmtDur(s.minutes - (input.dwellMin || 0))} longer`,
        detail:`${fmtDur(s.minutes)} total plugged in reaches ${target.toFixed(0)}%.` });
    }
  }

  // Lever 2: lower the departure target.
  if (!locked.departure && sim && sim.endSOC != null) {
    const reach = sim.endSOC;
    if (reach < target) {
      levers.push({ type:'lower-target', soc: reach,
        label:`Leave at ${reach.toFixed(0)}% instead of ${target.toFixed(0)}%`,
        detail:`That is what this stop actually delivers — ${(target - reach).toFixed(0)} points short.` });
    }
  }

  // Lever 3: arrive with more charge.
  if (!locked.arrival && input.dwellMin != null) {
    const need = requiredStartSOC(vehicle, station, adapter, env, target, input.dwellMin);
    if (need != null) {
      levers.push({ type:'arrive-higher', soc: need,
        label:`Arrive at ${need.toFixed(0)}% or better`,
        detail: input.arrivalSOC != null
          ? `${(need - input.arrivalSOC).toFixed(0)} points more than planned.`
          : `Minimum arrival SOC for this dwell.` });
    }
  }

  // Lever 4: a DC fast-charge stop before arriving. Never assumed silently.
  if (input.dcStopOption !== false) {
    const dcStation = input.dcStopStation || defaultDCStation(vehicle);
    const dcAd = resolveAdapter(vehicle, dcStation);
    if (!dcAd.required || dcAd.satisfied) {
      const from = input.arrivalSOC != null ? input.arrivalSOC : 20;
      let needAtArrival = null;
      if (input.dwellMin != null) needAtArrival = requiredStartSOC(vehicle, station, adapter, env, target, input.dwellMin);
      if (needAtArrival != null && needAtArrival > from) {
        const stop = simulate(vehicle, dcStation, dcAd.adapter, env, from, { targetSOC: needAtArrival });
        if (stop.reachedTarget) {
          levers.push({ type:'dc-stop', minutes: stop.minutes, toSOC: needAtArrival,
            fromSOC: from, station: dcStation.name,
            energyKWh: stop.energyKWh, avgKW: stop.avgKW,
            label:`Add a ${fmtDur(stop.minutes)} DC stop en route`,
            detail:`${from.toFixed(0)}% → ${needAtArrival.toFixed(0)}% at ${dcStation.name} (avg ${stop.avgKW.toFixed(0)} kW) closes the gap.` });
        }
      }
    }
  }

  let gap = '';
  if (cause === 'need-over-100') {
    gap = `Even arriving at 100%, this stop leaves you at ${sim.endSOC.toFixed(0)}% — ${(target - sim.endSOC).toFixed(0)} points short of ${target.toFixed(0)}%.`;
  } else if (cause === 'cannot-reach') {
    gap = `Charging stalls at ${sim.endSOC.toFixed(0)}%; ${target.toFixed(0)}% is not reachable on this station${sim.stalled ? ' (no usable power at that SOC)' : ''}.`;
  } else {
    gap = `This stop reaches ${sim.endSOC.toFixed(0)}%, which is ${(target - sim.endSOC).toFixed(1)} points short of the ${target.toFixed(0)}% you need.`;
    const short = ((target - sim.endSOC) / 100) * vehicle.usableKWh;
    gap += ` That is ${short.toFixed(1)} kWh of missing energy.`;
  }

  return { ok:false, kind:'infeasible', cause, message: gap, sim,
           levers, adapterInfo: base.adapterInfo };
}

function defaultDCStation(vehicle) {
  const nacs = vehicle.nativeDC === 'NACS_DC';
  return nacs
    ? { name:'250 kW NACS post', level:'DC', connector:'NACS_DC', maxKW:250, maxVoltage:1000, maxAmps:500 }
    : { name:'350 kW CCS post',  level:'DC', connector:'CCS1',    maxKW:350, maxVoltage:1000, maxAmps:500 };
}

/* ------------------------------------------------------------- MULTI-LEG
   legs: [{type:'drive', minutes, consumptionMode:'kwh'|'pct', consumption},
          {type:'stop',  dwellMin, station, env, label}]
   SOC is carried forward across the whole chain; every node is reported.    */

function runTrip(trip) {
  const v = trip.vehicle;
  let soc = clamp(trip.startSOC, 0, 100);
  let clock = trip.startMinutes != null ? trip.startMinutes : null;
  const nodes = [{ kind:'start', label: trip.startLabel || 'Depart', soc, clockMinutes: clock }];
  const issues = [];

  trip.legs.forEach((leg, i) => {
    if (leg.type === 'drive') {
      const usedPct = leg.consumptionMode === 'pct'
        ? leg.consumption
        : (leg.consumption / v.usableKWh) * 100;
      const before = soc;
      soc = soc - usedPct;
      if (clock != null) clock += (leg.minutes || 0);
      const reserve = trip.reserveSOC != null ? trip.reserveSOC : 0;
      if (soc < reserve) {
        issues.push({ legIndex:i, kind: soc < 0 ? 'depleted' : 'below-reserve',
          soc, message: soc < 0
            ? `Leg ${i + 1} (${leg.label || 'drive'}) runs the pack empty — ${Math.abs(soc).toFixed(0)} points short (${((Math.abs(soc)/100)*v.usableKWh).toFixed(1)} kWh).`
            : `Leg ${i + 1} (${leg.label || 'drive'}) ends at ${soc.toFixed(0)}%, below your ${reserve}% reserve.` });
      }
      soc = Math.max(soc, -100);
      nodes.push({ kind:'drive', index:i, label: leg.label || `Drive ${i + 1}`,
        minutes: leg.minutes, usedPct, socBefore: before, soc, clockMinutes: clock });
    } else {
      const before = clamp(soc, 0, 100);
      const ad = resolveAdapter(v, leg.station);
      const env = leg.env || trip.env;
      if (ad.required && !ad.satisfied) {
        issues.push({ legIndex:i, kind:'adapter', message: ad.reason });
        nodes.push({ kind:'stop', index:i, label: leg.label || `Stop ${i + 1}`,
          minutes: leg.dwellMin, socBefore: before, soc: before,
          clockMinutes: clock, adapterInfo: ad, blocked:true });
        if (clock != null) clock += (leg.dwellMin || 0);
        return;
      }
      const sim = simulate(v, leg.station, ad.adapter, env, before, { durationMin: leg.dwellMin });
      soc = sim.endSOC;
      const node = { kind:'stop', index:i, label: leg.label || `Stop ${i + 1}`,
        minutes: leg.dwellMin, socBefore: before, soc, sim,
        clockMinutes: clock, adapterInfo: ad,
        addedKWh: sim.energyKWh, avgKW: sim.avgKW };
      if (clock != null) clock += (leg.dwellMin || 0);
      node.endClockMinutes = clock;
      nodes.push(node);
    }
  });

  nodes.push({ kind:'end', label: trip.endLabel || 'Arrive', soc, clockMinutes: clock });

  if (trip.arriveSOC != null && soc < trip.arriveSOC - 1e-6) {
    issues.push({ kind:'arrival-target',
      message:`Trip ends at ${soc.toFixed(0)}%, below your ${trip.arriveSOC}% arrival target — ${(trip.arriveSOC - soc).toFixed(0)} points (${(((trip.arriveSOC - soc)/100)*v.usableKWh).toFixed(1)} kWh) short.` });
  }

  return { nodes, issues, endSOC: soc, endClockMinutes: clock, ok: issues.length === 0 };
}

/**
 * Trip-wide resolver: for each chargeable stop, how much extra dwell would
 * close the trip's shortfall? Runs across the whole chain, not one leg.
 */
function resolveTrip(trip) {
  const run = runTrip(trip);
  if (run.ok) return { run, levers: [] };
  const levers = [];
  const v = trip.vehicle;

  const target = trip.arriveSOC != null ? trip.arriveSOC : (trip.reserveSOC || 0);
  const shortPct = target - run.endSOC;

  if (shortPct > 0) {
    trip.legs.forEach((leg, i) => {
      if (leg.type !== 'stop' || (leg.locked)) return;
      const probe = JSON.parse(JSON.stringify({ legs: trip.legs }));
      // find how much extra dwell at this stop fixes the end state
      let lo = 0, hi = 24 * 60, best = null;
      for (let k = 0; k < 24; k++) {
        const mid = (lo + hi) / 2;
        const t2 = Object.assign({}, trip, {
          vehicle: v,
          legs: trip.legs.map((L, j) => j === i ? Object.assign({}, L, { dwellMin: (L.dwellMin || 0) + mid }) : L)
        });
        const r2 = runTrip(t2);
        if (r2.endSOC >= target - 1e-6) { best = mid; hi = mid; } else lo = mid;
      }
      if (best != null && best > 0.5) {
        levers.push({ type:'extend-stop', legIndex:i, extraMinutes: best,
          label:`Add ${fmtDur(best)} at ${leg.label || `Stop ${i + 1}`}`,
          detail:`Brings the trip to ${target}% on arrival.` });
      }
    });

    if (trip.startSOC < 100) {
      const t3 = Object.assign({}, trip, { startSOC: 100 });
      const r3 = runTrip(t3);
      const needed = trip.startSOC + shortPct;
      if (r3.endSOC >= target - 1e-6 && needed <= 100) {
        levers.push({ type:'depart-higher', soc: Math.min(100, needed),
          label:`Depart at ${Math.min(100, needed).toFixed(0)}%`,
          detail:`${(needed - trip.startSOC).toFixed(0)} points more than planned.` });
      }
    }

    const dcStation = defaultDCStation(v);
    const dcAd = resolveAdapter(v, dcStation);
    if (!dcAd.required || dcAd.satisfied) {
      const env = trip.env;
      const from = 20;
      const to = clamp(from + shortPct, 0, 100);
      const s = simulate(v, dcStation, dcAd.adapter, env, from, { targetSOC: to });
      if (s.reachedTarget) {
        levers.push({ type:'dc-stop', minutes: s.minutes, fromSOC: from, toSOC: to,
          station: dcStation.name, energyKWh: s.energyKWh,
          label:`Insert a ${fmtDur(s.minutes)} DC stop`,
          detail:`${from}% → ${to.toFixed(0)}% at a ${dcStation.name} adds the ${(((shortPct)/100)*v.usableKWh).toFixed(0)} kWh you are missing.` });
      }
    }
  }

  return { run, levers, shortPct };
}

/* ------------------------------------------------------------- FORMATTING */
function fmtDur(min) {
  if (min == null || !isFinite(min)) return '—';
  const m = Math.round(min);
  const h = Math.floor(m / 60), r = m % 60;
  if (h === 0) return `${r}m`;
  if (r === 0) return `${h}h`;
  return `${h}h ${r}m`;
}
function fmtClock(minutesOfDay, use24) {
  if (minutesOfDay == null || !isFinite(minutesOfDay)) return '—';
  let m = Math.round(minutesOfDay);
  const dayOffset = Math.floor(m / 1440);
  m = ((m % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60), mi = m % 60;
  const pad = n => String(n).padStart(2, '0');
  let s;
  if (use24) s = `${pad(h)}:${pad(mi)}`;
  else {
    const ap = h < 12 ? 'AM' : 'PM';
    const hh = h % 12 === 0 ? 12 : h % 12;
    s = `${hh}:${pad(mi)} ${ap}`;
  }
  return dayOffset > 0 ? `${s} +${dayOffset}d` : s;
}
function parseClock(str) {
  if (!str) return null;
  const m = String(str).match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

const LIMITER_LABEL = {
  vehicle:'Vehicle charging curve',
  station:'Station output',
  adapter:'Adapter rating',
  stationVoltage:'Station voltage class (400 V post, 800 V pack)',
  stationShared:'Cabinet shared with the next stall',
  measured:'Measured site limit'
};
function limiterLabel(binding) {
  return LIMITER_LABEL[String(binding).replace(/\+thermal$/, '')] || binding;
}

return {
  CONNECTORS, clamp, interpCurve, interpTable,
  effectiveTempC, dcThermal, acThermal, ratedKW,
  resolveAdapter, powerAt, simulate, timeToSOC, requiredStartSOC,
  milestones, solve, runTrip, resolveTrip, defaultDCStation,
  fmtDur, fmtClock, parseClock, LIMITER_LABEL, limiterLabel, STEP_MIN
};
}));

