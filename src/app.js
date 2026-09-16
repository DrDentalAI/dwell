/* =========================================================================
   EV DWELL PLANNER — FRONT END
   Consumes EVCore (shared calculation engine) and EVLibrary. No framework.
   ========================================================================= */
'use strict';
const E = EVCore, L = EVLibrary, P = EVPricing, D = EVDiscounts;
const $ = id => document.getElementById(id);
const h = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
  ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
const KEY = 'evdwell.v1';
const VERSION = '__APP_VERSION__';
const BUILT = '__APP_BUILT__';

/* ------------------------------------------------------------------ STATE */
const DEFAULT_SESSION = () => ({
  level: 'AC',
  stationPresetId: 'l2-48',
  station: JSON.parse(JSON.stringify(L.STATION_PRESETS.find(s => s.id === 'l2-48'))),
  env: { tempC: 22, enclosed: false, precondition: false, precondEnRoute: false, live: null },
  arrivalSOC: 40, departureSOC: 80, dwellMin: 480,
  plugInTime: '09:00',
  locked: { arrival: false, departure: false, dwell: false },
  // A requirement on the field being solved: "solve for departure, but I NEED
  // at least 90%" / "solve for dwell, but I only HAVE 2 hours". This is what
  // makes a plan infeasible and hands the constraint resolver something to do.
  req: { arrival: null, departure: null, dwell: null },
  solveFor: 'departure',
  granularity: 10,
  // Cost context: which network, which membership, and any price you entered.
  pricing: { networkId: null, planId: null, regionId: null, userRate: null },
  /* Who the driver is, for eligibility only. Never leaves the device. */
  eligibility: { memberships: [], gig: { platform: null, tier: null }, cards: [] }
});
const DEFAULT_TRIP = () => ({
  startSOC: 90, startTime: '07:00', reserveSOC: 10, arriveSOC: 30,
  legs: [
    { type:'drive', label:'Drive out', minutes:60, consumptionMode:'pct', consumption:20 },
    { type:'stop',  label:'Dwell & charge', dwellMin:240, stationPresetId:'l2-48',
      station: JSON.parse(JSON.stringify(L.STATION_PRESETS.find(s => s.id === 'l2-48'))), locked:false },
    { type:'drive', label:'Drive home', minutes:60, consumptionMode:'pct', consumption:20 }
  ]
});

let S = {
  vehicles: [], activeId: null, stations: [],
  fx: null,                       // {USD_CAD, asOf} — user-editable
  usage: { sessionsPerMonth: 4 }, // drives membership break-even
  finder: { open: false, q: '', live: [], busy: false, error: null },
  rates: [],                      // your own named rate cards
  place: null,                    // {country,state|province,postal} from a ZIP
  touOverrides: {},               // your corrected time-of-day windows
  nrelKey: null,                  // optional: your own federal API key (NLR, formerly NREL)
  displayCurrency: null,          // null = show each rate in its native currency
  session: DEFAULT_SESSION(), trip: DEFAULT_TRIP(), trips: [], tab: 'plan'
};

/* Some contexts (in-app preview panes, sandboxed iframes, Safari private mode)
   block persistent storage entirely. The app still works there — it just can't
   remember anything — so detect it once and say so plainly rather than losing
   the user's garage without explanation. */
let STORAGE_OK = (() => {
  try {
    const t = '__evtest__';
    localStorage.setItem(t, '1'); localStorage.removeItem(t);
    return true;
  } catch (e) { return false; }
})();

function save() { if (!STORAGE_OK) return; try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { STORAGE_OK = false; } }
function load() {
  try {
    const raw = STORAGE_OK ? localStorage.getItem(KEY) : null;
    if (raw) {
      const p = JSON.parse(raw);
      S = Object.assign(S, p);
      S.session = Object.assign(DEFAULT_SESSION(), p.session || {});
      S.session.env = Object.assign(DEFAULT_SESSION().env, (p.session || {}).env || {});
      S.session.locked = Object.assign({ arrival:false, departure:false, dwell:false },
                                       (p.session || {}).locked || {});
      S.session.req = Object.assign({ arrival:null, departure:null, dwell:null },
                                    (p.session || {}).req || {});
      S.trip = Object.assign(DEFAULT_TRIP(), p.trip || {});
      if (!Array.isArray(S.stations)) S.stations = [];
      S.session.pricing = Object.assign({ networkId:null, planId:null, regionId:null, userRate:null },
                                        (p.session || {}).pricing || {});
      /* FORWARD MIGRATION. Every release that adds a key to the session adds a
         trap for the release before it: the saved blob predates the key, the
         new code dereferences it, and the app dies on open for everyone
         upgrading -- which is every user. v1.12.0 added `eligibility` and
         v1.12.1 shipped a crash on that path.

         So do not trust ANY nested object to exist just because the code that
         writes it does. Rebuild each one from its default and overlay whatever
         was saved. Adding a key here is the cost of adding a key to the
         session, and it is much cheaper than a dead app. */
      const dflt = DEFAULT_SESSION();
      ['eligibility'].forEach(k => {
        S.session[k] = Object.assign({}, dflt[k] || {}, (p.session || {})[k] || {});
      });
      const eg = S.session.eligibility;
      if (!Array.isArray(eg.memberships)) eg.memberships = [];
      if (!Array.isArray(eg.cards)) eg.cards = [];
      if (!eg.gig || typeof eg.gig !== 'object') eg.gig = { platform: null, tier: null };
    }
  } catch (e) {}
  if (!Array.isArray(S.stations)) S.stations = [];
  if (!S.fx) S.fx = Object.assign({}, P.FX_DEFAULT);
  if (!S.usage) S.usage = { sessionsPerMonth: 4 };
  // Finder state is per-session UI, never restored from storage: a stale list
  // of "nearby" chargers from another city is worse than an empty one.
  S.finder = { open:false, q:'', live:[], busy:false, error:null };
  if (!S.touOverrides || typeof S.touOverrides !== 'object') S.touOverrides = {};
  if (!Array.isArray(S.rates)) S.rates = [];
  if (!S.vehicles.length) {
    S.vehicles = [vehicleFromLibrary('gmc-hummer-sut-24', true, 2025)];
    S.activeId = S.vehicles[0].id;
    // First run: the overwhelmingly likely plug-in time is right now.
    const d = new Date();
    S.session.plugInTime = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  // Saved trips with an expiration date auto-clear; recurring ones persist.
  const today = new Date().toISOString().slice(0, 10);
  const before = S.trips.length;
  S.trips = S.trips.filter(t => !t.expires || t.expires >= today);
  if (S.trips.length !== before) save();
}

function vehicleFromLibrary(libId, verified, modelYear) {
  const b = L.findById(libId);
  const v = JSON.parse(JSON.stringify(b));
  v.libraryId = libId;
  v.id = 'v' + Math.random().toString(36).slice(2, 9);
  /* Use the model year the OWNER picked, not the newest year the library entry
     happens to span. A 24-module Hummer SUT covers 2022-2026; naming a 2025
     truck "2026" is simply wrong, and the owner is the authority on their own
     vehicle. Fall back to the entry's newest year only when no year was given
     (e.g. the first-run default), and clamp to the span so a stray value can't
     produce a year this variant was never sold in. */
  let yr = modelYear != null ? Number(modelYear) : b.year;
  if (!isFinite(yr)) yr = b.year;
  if (b.yearFrom != null && yr < b.yearFrom) yr = b.yearFrom;
  if (b.yearTo   != null && yr > b.yearTo)   yr = b.yearTo;
  v.modelYear = yr;
  v.name = `${yr} ${b.make} ${b.model}`;
  v.vin = null;
  v.packVerified = !!verified;
  // Pre-fill the manufacturer's own adapter for this make, where one exists.
  // Flagged `assumed` so the app can say "I filled this in, confirm you own it"
  // rather than quietly implying you can pull up to a Supercharger.
  const oemDC = L.oemAdapterFor(b.make, 'DC');
  const oemAC = L.oemAdapterFor(b.make, 'AC');
  v.dcAdapter = oemDC ? Object.assign(JSON.parse(JSON.stringify(oemDC)), { assumed: true }) : null;
  v.acAdapter = oemAC ? Object.assign(JSON.parse(JSON.stringify(oemAC)), { assumed: true }) : null;
  return v;
}
const activeVehicle = () => S.vehicles.find(v => v.id === S.activeId) || S.vehicles[0] || null;

/* ------------------------------------------------------------------ ICONS */
const IC = {
  lock:'<svg viewBox="0 0 24 24"><rect x="4.5" y="10.5" width="15" height="10" rx="2"/><path d="M8 10.5V7a4 4 0 018 0v3.5"/></svg>',
  unlock:'<svg viewBox="0 0 24 24"><rect x="4.5" y="10.5" width="15" height="10" rx="2"/><path d="M8 10.5V7a4 4 0 017.5-2"/></svg>',
  chev:'<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>',
  warn:'<svg viewBox="0 0 24 24" style="width:100%;height:100%" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M12 3.5L2.5 20h19z"/><path d="M12 10v4.5M12 17.2v.1"/></svg>'
};

/* ==================================================================== UI == */
const UI = {

/* --------------------------------------------------------------- ROUTING */
go(tab) {
  S.tab = tab; save();
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('on'));
  $('s-' + tab).classList.add('on');
  document.querySelectorAll('.tabs button').forEach(b =>
    b.classList.toggle('on', b.dataset.tab === tab));
  const T = { plan:['Dwell Planner','What will I leave at?'],
              trip:['Multi-leg trip','SOC across the chain'],
              garage:['Garage','Packs and adapters'],
              saved:['Saved trips','One-offs auto-expire'] };
  $('scr-title').textContent = T[tab][0];
  $('scr-sub').textContent = T[tab][1];
  window.scrollTo(0, 0);
  document.querySelector('main').scrollTop = 0;
  if (tab === 'garage') this.renderGarage();
  if (tab === 'saved') this.renderSaved();
  if (tab === 'trip') this.renderTrip();
},

toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(this._tt); this._tt = setTimeout(() => t.classList.remove('on'), 2300);
},

openSheet(title, html) {
  $('sheet-title').textContent = title;
  $('sheet-body').innerHTML = html;
  $('sheet').classList.add('on'); $('scrim').classList.add('on');
},
closeSheet() {
  $('sheet').classList.remove('on'); $('scrim').classList.remove('on');
  this.renderAll();
},

/* ------------------------------------------------------------ STATION UI */
toggleAdvanced() {
  const b = $('adv-box');
  const open = b.style.display === 'none';
  b.style.display = open ? 'block' : 'none';
  $('adv-btn').textContent = open ? 'Hide' : 'Advanced';
},

setLevel(lvl) {
  S.session.level = lvl;
  const first = L.STATION_PRESETS.find(s => s.level === lvl);
  this.setStationPreset(first.id);
},

setStationPreset(id) {
  const p = L.STATION_PRESETS.find(s => s.id === id) || (S.stations || []).find(s => s.id === id);
  if (!p) return;
  S.session.stationPresetId = id;
  S.session.station = JSON.parse(JSON.stringify(p));
  S.session.level = p.level;
  // The preset knows who operates it, so pick the pricing to match — unless
  // the user has already chosen a network themselves, in which case theirs
  // stands. Auto-selection is a convenience, never an override.
  const pr = S.session.pricing;
  if (p.networkId && !pr.pinned && pr.networkId !== p.networkId) {
    pr.networkId = p.networkId; pr.planId = null; pr.regionId = null;
    pr.autoLinked = true;
  }
  save(); this.renderAll();
},

/* Shared cabinet: is someone plugged into the other side of this post? */
toggleShared() {
  const st = S.session.station;
  if (st.sharedMaxKW == null) return;
  st.shared = !st.shared;
  save(); this.renderAll();
},

/* ------------------------------------------------ TOU WINDOW EDITING ----
   Estimated windows are a starting point, not an answer. One glance at the
   network's app and the user can make them exact — permanently.            */
openTouEdit() {
  const rate = this.currentRate();
  const tou = rate && rate.tou;
  if (!tou) return;
  const src = (S.touOverrides && S.touOverrides[this.touKey()]) || tou;
  const rows = src.windows.map((w, i) => `
    <div class="row" style="margin-bottom:9px;align-items:end">
      <div style="flex:1.4"><label class="fl">${h(w.name)}</label>
        <div class="row">
          <input type="number" min="0" max="24" step="0.5" value="${w.startHour}"
                 oninput="UI.setTouField(${i},'startHour',this.value)">
          <input type="number" min="0" max="24" step="0.5" value="${w.endHour}"
                 oninput="UI.setTouField(${i},'endHour',this.value)">
        </div></div>
      <div style="flex:1"><label class="fl">$/kWh</label>
        <input type="number" min="0" step="0.01" value="${w.perKWh != null ? w.perKWh : ''}"
               oninput="UI.setTouField(${i},'perKWh',this.value)"></div>
    </div>`).join('');
  this.openSheet('Your time-of-day windows', `
    <p class="hint" style="margin-top:0">Start and end are 24-hour clock, station-local.
      A window may wrap past midnight (start 22, end 6).</p>
    ${rows}
    <p class="hint">${h(tou.note || '')}</p>
    <button class="btn sm ghost" onclick="UI.resetTou()">Back to the built-in estimate</button>`);
},
touKey() {
  const n = this.currentNetwork();
  return (n ? n.id : '?') + '|' + (S.session.pricing.regionId || 'default');
},
setTouField(i, field, v) {
  const rate = this.currentRate(); if (!rate || !rate.tou) return;
  S.touOverrides = S.touOverrides || {};
  const key = this.touKey();
  if (!S.touOverrides[key]) {
    S.touOverrides[key] = JSON.parse(JSON.stringify(rate.tou));
    S.touOverrides[key].confidence = 'user';
    S.touOverrides[key].note = 'Your own windows, entered from the operator\'s app.';
  }
  const n = parseFloat(v);
  S.touOverrides[key].windows[i][field] = isFinite(n) ? n : null;
  save(); this.renderOutput();
},
resetTou() {
  if (S.touOverrides) delete S.touOverrides[this.touKey()];
  save(); this.closeSheet(); this.renderAll();
},

/* ------------------------------------------------- MEASURED RATE OVERRIDE */
toggleMeasured() {
  const st = S.session.station;
  if (st.observed) st.observed = null;
  else {
    // Seed with the calculated rate so the user nudges rather than types blind.
    const v = activeVehicle();
    let seed = E.ratedKW(st);
    if (v && st.level === 'AC') seed = Math.min(seed, v.acMaxKW);
    st.observed = { kW: Math.round(seed * 10) / 10, at: 'input' };
  }
  S.session.stationPresetId = 'custom';
  save(); this.renderAll();
},
setMeasured(v) {
  const st = S.session.station;
  if (!st.observed) return;
  const n = parseFloat(v);
  st.observed.kW = isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
  save(); this.renderMeasured(); this.renderOutput();
},
bumpMeasured(d) {
  const st = S.session.station;
  if (!st.observed) return;
  this.setMeasured(Math.max(0.1, (st.observed.kW || 0) + d));
},
setMeasuredAt(at) {
  const st = S.session.station;
  if (!st.observed) return;
  st.observed.at = at; save(); this.renderAll();
},

/* ====================================================== COST & PRICING ====
   Same honesty rules as the curve data: every rate says where it came from,
   how old it is, and your own entry always wins.                          */

setNetwork(id) {
  const pr = S.session.pricing;
  pr.networkId = id || null; pr.planId = null; pr.regionId = null;
  // Choosing a network by hand is a deliberate act; from here on, picking a
  // different charger must not quietly undo it.
  pr.pinned = true;
  save(); this.renderAll();
},
setPlan(id) { S.session.pricing.planId = id || null; save(); this.renderAll(); },
setPriceRegion(id) { S.session.pricing.regionId = id || null; save(); this.renderAll(); },

/* =========================================================================
   YOUR OWN RATE CARD
   Every network worth using eventually shows you the real numbers — on the
   charger screen, in its app, on the receipt. This is where those go. It
   covers everything a real charger charges, not just a headline per-kWh, and
   once saved with a name it can be recalled anywhere.
   ========================================================================= */
blankRate() {
  const n = this.currentNetwork();
  const cur = this.currentRate();
  return {
    perKWh: cur && cur.perKWh != null ? cur.perKWh : 0.40,
    perMinute: cur && cur.perMinute != null ? cur.perMinute : null,
    perHour: cur && cur.perHour != null ? cur.perHour : null,
    sessionFee: cur && cur.sessionFee != null ? cur.sessionFee : 0,
    idle: cur && cur.idle ? Object.assign({}, cur.idle) : null,
    tou: cur && cur.tou ? JSON.parse(JSON.stringify(cur.tou)) : null,
    taxIncluded: !!(cur && cur.taxIncluded),
    currency: n ? n.currency : 'USD',
    confidence: 'user',
    lastVerified: new Date().toISOString().slice(0, 10),
    note: 'Read off the charger.'
  };
},

toggleUserPrice() {
  const pr = S.session.pricing;
  pr.userRate = pr.userRate ? null : this.blankRate();
  save(); this.renderAll();
  if (pr.userRate) this.openRateEditor();
},

setUserPrice(field, v) {
  const u = S.session.pricing.userRate; if (!u) return;
  const n = parseFloat(v);
  u[field] = isFinite(n) && n >= 0 ? n : null;
  u.lastVerified = new Date().toISOString().slice(0, 10);
  save(); this.renderPricing(); this.renderOutput();
},
setUserIdle(field, v) {
  const u = S.session.pricing.userRate; if (!u) return;
  const n = parseFloat(v);
  if (!u.idle) u.idle = { perMinute:null, perHour:null, graceMinutes:0 };
  u.idle[field] = isFinite(n) && n >= 0 ? n : null;
  if (u.idle.perMinute == null && u.idle.perHour == null) u.idle = null;
  save(); this.renderPricing(); this.renderOutput(); this.openRateEditor();
},
toggleUserTax() {
  const u = S.session.pricing.userRate; if (!u) return;
  u.taxIncluded = !u.taxIncluded; save(); this.renderOutput(); this.openRateEditor();
},
toggleUserTou() {
  const u = S.session.pricing.userRate; if (!u) return;
  u.tou = u.tou ? null : { confidence:'user', basis:'station-local clock',
    note:'Your own windows.', windows:[
      { id:'w1', name:'Off-peak', startHour:0,  endHour:16, perKWh:u.perKWh },
      { id:'w2', name:'On-peak', startHour:16, endHour:21, perKWh:u.perKWh },
      { id:'w3', name:'Evening', startHour:21, endHour:24, perKWh:u.perKWh } ] };
  save(); this.renderOutput(); this.openRateEditor();
},
setUserTou(i, field, v) {
  const u = S.session.pricing.userRate; if (!u || !u.tou) return;
  const n = parseFloat(v);
  u.tou.windows[i][field] = isFinite(n) ? n : null;
  save(); this.renderOutput();
},
setUserTouName(i, v) {
  const u = S.session.pricing.userRate; if (!u || !u.tou) return;
  u.tou.windows[i].name = String(v || '').slice(0, 24);
  save(); this.renderOutput();
},

openRateEditor() {
  const u = S.session.pricing.userRate;
  if (!u) { this.toggleUserPrice(); return; }
  const net = this.currentNetwork();
  const cur = u.currency;
  const num = (label, field, step, val, hint) => `
    <div style="flex:1"><label class="fl">${label}</label>
      <input type="number" min="0" step="${step}" value="${val != null ? val : ''}"
             placeholder="—" oninput="UI.setUserPrice('${field}',this.value)">
      ${hint ? `<p class="hint" style="margin-top:3px">${hint}</p>` : ''}</div>`;

  const touRows = u.tou ? u.tou.windows.map((w, i) => `
    <div class="row" style="margin-bottom:8px;align-items:end">
      <div style="flex:1.3"><input type="text" value="${h(w.name)}"
             oninput="UI.setUserTouName(${i},this.value)"></div>
      <div style="width:58px"><input type="number" min="0" max="24" step="0.5" value="${w.startHour}"
             oninput="UI.setUserTou(${i},'startHour',this.value)"></div>
      <div style="width:58px"><input type="number" min="0" max="24" step="0.5" value="${w.endHour}"
             oninput="UI.setUserTou(${i},'endHour',this.value)"></div>
      <div style="width:74px"><input type="number" min="0" step="0.01" value="${w.perKWh != null ? w.perKWh : ''}"
             oninput="UI.setUserTou(${i},'perKWh',this.value)"></div>
    </div>`).join('') : '';

  this.openSheet('What the charger says', `
    <p class="hint" style="margin-top:0">Fill in only what you can see. Anything left blank
      is treated as not charged${net ? `, and this replaces ${h(net.name)}'s figures entirely` : ''}.</p>

    <div class="row" style="margin-bottom:11px">
      ${num('Per kWh', 'perKWh', '0.01', u.perKWh)}
      ${num('Session fee', 'sessionFee', '0.01', u.sessionFee)}
    </div>
    <div class="row" style="margin-bottom:11px">
      ${num('Per minute', 'perMinute', '0.01', u.perMinute, 'Some sites bill time, not energy.')}
      ${num('Per hour', 'perHour', '0.25', u.perHour)}
    </div>

    <div class="divider"></div>
    <div class="card-h" style="margin-bottom:6px"><h3 style="font-size:14px;margin:0">Idle / overstay fee</h3></div>
    <div class="row" style="margin-bottom:6px">
      <div style="flex:1"><label class="fl">Per minute</label>
        <input type="number" min="0" step="0.05" value="${u.idle && u.idle.perMinute != null ? u.idle.perMinute : ''}"
               placeholder="—" oninput="UI.setUserIdle('perMinute',this.value)"></div>
      <div style="flex:1"><label class="fl">Per hour</label>
        <input type="number" min="0" step="0.5" value="${u.idle && u.idle.perHour != null ? u.idle.perHour : ''}"
               placeholder="—" oninput="UI.setUserIdle('perHour',this.value)"></div>
      <div style="flex:1"><label class="fl">Grace (min)</label>
        <input type="number" min="0" step="1" value="${u.idle && u.idle.graceMinutes != null ? u.idle.graceMinutes : ''}"
               placeholder="0" oninput="UI.setUserIdle('graceMinutes',this.value)"></div>
    </div>
    <p class="hint">This is the fee that quietly costs more than the electricity on a long dwell.</p>

    <div class="divider"></div>
    <div class="toggle" onclick="UI.toggleUserTou()">
      <div class="lb">Price changes by time of day<small>Peak / off-peak bands, as shown on the charger.</small></div>
      <div class="sw ${u.tou ? 'on' : ''}"></div>
    </div>
    ${u.tou ? `<div class="row" style="margin:8px 0 4px"><div style="flex:1.3" class="fl">Name</div>
        <div style="width:58px" class="fl">From</div><div style="width:58px" class="fl">To</div>
        <div style="width:74px" class="fl">${cur === 'CAD' ? 'C$' : '$'}/kWh</div></div>${touRows}
      <p class="hint">24-hour clock, station-local. A window may wrap past midnight (22 to 6).</p>` : ''}

    <div class="divider"></div>
    <div class="toggle" onclick="UI.toggleUserTax()">
      <div class="lb">Prices already include tax<small>Common in Canada, rare in the US.</small></div>
      <div class="sw ${u.taxIncluded ? 'on' : ''}"></div>
    </div>

    <div class="divider"></div>
    <label class="fl">Save this as</label>
    <div class="row">
      <input type="text" id="rate-name" placeholder="Meijer Rochester Hills"
             value="${h(S.session.siteLabel || (net ? net.name : ''))}">
      <button class="btn sm primary" style="flex:none" onclick="UI.saveRate()">Save</button>
    </div>
    <p class="hint">Saved rate cards appear at the top of the network list and can be
      reused at any charger.</p>
    <button class="btn sm ghost" style="margin-top:10px" onclick="UI.toggleUserPrice();UI.closeSheet()">
      Discard and go back to ${net ? h(net.name) + "'s figures" : 'the network rate'}</button>`);
},

saveRate() {
  const u = S.session.pricing.userRate; if (!u) return;
  const el = $('rate-name');
  const name = (el && el.value.trim()) || 'My rate';
  const existing = S.rates.find(r => r.name.toLowerCase() === name.toLowerCase());
  const entry = {
    id: existing ? existing.id : 'r' + Math.random().toString(36).slice(2, 9),
    name,
    networkId: S.session.pricing.networkId || null,
    place: S.place ? (S.place.state || S.place.province) : null,
    savedOn: new Date().toISOString().slice(0, 10),
    rate: JSON.parse(JSON.stringify(u))
  };
  if (existing) Object.assign(existing, entry); else S.rates.push(entry);
  S.session.pricing.savedRateId = entry.id;
  save(); this.closeSheet(); this.renderAll();
  this.toast(`Saved "${name}"${existing ? ' (updated)' : ''}`);
},

useSavedRate(id) {
  const e = S.rates.find(r => r.id === id); if (!e) return;
  S.session.pricing.userRate = JSON.parse(JSON.stringify(e.rate));
  S.session.pricing.savedRateId = id;
  if (e.networkId) { S.session.pricing.networkId = e.networkId; S.session.pricing.pinned = true; }
  save(); this.renderAll();
  this.toast(`Using "${e.name}"`);
},

deleteSavedRate(id) {
  S.rates = S.rates.filter(r => r.id !== id);
  if (S.session.pricing.savedRateId === id) {
    S.session.pricing.savedRateId = null; S.session.pricing.userRate = null;
  }
  save(); this.renderAll();
},

currentNetwork() {
  const id = S.session.pricing.networkId;
  return id ? P.findNetwork(id) : null;
},
currentPlan() {
  const n = this.currentNetwork(); const id = S.session.pricing.planId;
  return n && id ? (n.plans || []).find(p => p.id === id) || null : null;
},
currentRate() {
  const n = this.currentNetwork(); if (!n) return null;
  const base = this.baseRate(n);
  const ov = S.touOverrides && S.touOverrides[this.touKey()];
  if (base && ov) return Object.assign({}, base, { tou: ov });
  return base;
},
baseRate(n) {
  const pl = S.place || {};
  return P.resolveRate(n, {
    state: pl.state, province: pl.province,
    regionId: S.session.pricing.regionId,
    level: S.session.level,
    stationKW: E.ratedKW(S.session.station),
    userRate: S.session.pricing.userRate
  });
},

/* ---- DISCOUNT ELIGIBILITY -------------------------------------------
   ev-pricing.js resolves WHAT THE CHARGER COSTS. ev-discounts.js resolves
   WHAT FRACTION OF IT YOU DON'T PAY. It is handed pricing's rate; it never
   looks one up. The order is fixed and a settled receipt proves it, with the
   Mercedes HPC promotion terms saying the same thing independently:

       rate -> discount -> subtotal -> tax

   Tax lands on the discounted subtotal, never on the rack rate, and never
   folded into the per-kWh figure.                                        */
discountProfile() {
  /* `activeVehicle()`, not `this.currentVehicle()`. v1.12.1 shipped the latter,
     which exists nowhere in this file, so the first line of this function threw
     for every user who had a charging network selected. Every engine test
     passed; none of them ever opened the page. See test/smoke.js. */
  const v = activeVehicle();
  const pl = S.place || {};
  const sess = S.session || {};
  const el = sess.eligibility || {};
  const pricing = sess.pricing || {};
  return {
    region: pl.province ? 'CA' : 'US',
    make: v ? v.make : null,
    model: v ? v.model : null,
    modelYear: v ? v.modelYear : null,
    memberships: (Array.isArray(el.memberships) ? el.memberships : [])
      .concat(pricing.planId ? [pricing.planId] : []),
    gig: el.gig && el.gig.platform ? el.gig : null,
    cards: Array.isArray(el.cards) ? el.cards : []
  };
},

/* The best discount that applies, as a fraction. Null when none does. */
currentDiscount() {
  const net = this.currentNetwork(); if (!net) return null;
  const prof = this.discountProfile();
  const dId = D.networkIdForPricingId(net.id, prof.region);
  if (!dId) return null;
  const rate = this.currentRate();
  return D.resolveRate({
    network: dId,
    profile: prof,
    baseRate: rate && rate.perKWh != null ? rate.perKWh : undefined,
    monthlyKwh: S.monthlyKwh || 0,
    today: new Date()
  });
},

/* Fold the discount into the plan pricing already understands.

   A collision matters here: EVgo PlusMax exists BOTH as a plan in
   ev-pricing.js and as an entry in ev-discounts.js. Summing them would take
   30% off twice. Nothing stacks, so take the better of the two and say which
   one won -- never add them. */
effectivePlan(dres) {
  const plan = this.currentPlan();
  const planPct = plan && plan.discountPct ? plan.discountPct / 100 : 0;
  const discPct = dres ? dres.discountPercent : 0;
  if (discPct <= planPct) return { plan, source: plan ? 'plan' : null, pct: planPct };
  /* Borrow the plan's fee waivers -- an automaker discount does not waive a
     session fee, so only carry across what the selected plan actually grants. */
  const merged = Object.assign({}, plan || {}, {
    id: (plan && plan.id) || 'discount',
    name: dres.applied ? dres.applied.label : 'Discount',
    discountPct: discPct * 100
  });
  return { plan: merged, source: 'discount', pct: discPct };
},

discountHTML(dres) {
  if (!dres) return '';
  const el = dres.eligible || [], ex = dres.excluded || [];
  if (!el.length && !ex.length) return '';

  const tag = c => `<span class="tag ${h(c)}">${h(c)}</span>`;
  const rows = el.map(e => `<div class="drow${e.id === (dres.applied && dres.applied.id) ? ' on' : ''}">
      <div><b>${h(e.label)}</b> ${tag(e.confidence)}
        ${e.expires ? `<br><span class="s">Ends ${h(e.expires)}</span>` : ''}
        ${e.stale ? `<br><span class="s" style="color:var(--locked);font-weight:600">&#9888; Last verified ${e.ageDays} days ago — over ${D.STALE_DAYS}. Check before relying on it.</span>` : ''}
      </div>
      <div class="dval">${(e.percent * 100).toFixed(0)}%</div>
    </div>`).join('');

  const exRows = ex.length ? `<details style="margin-top:10px"><summary class="s">Why ${ex.length} other${ex.length === 1 ? '' : 's'} didn't apply</summary>
      ${ex.map(e => `<div class="s" style="margin-top:6px">${h(e.label)} — ${h(e.reason)}${e.caveat ? ` <i>${h(e.caveat)}</i>` : ''}</div>`).join('')}
    </details>` : '';

  const rateLine = dres.rateSource === 'estimated-national'
    ? `<div class="note warn" style="margin-top:10px"><b>&#9888; Estimated national rate.</b>
        ${h(dres.rateNote || '')} No published rate exists for this network, so the
        percentage above is applied to an average rather than a real price.</div>`
    : '';

  return `<div class="card"><div class="card-h"><h2>Discounts you qualify for</h2></div>
    ${rows || `<div class="s">Nothing applies here.</div>`}
    ${rateLine}
    ${(dres.notes || []).map(n => `<div class="s" style="margin-top:8px">${h(n)}</div>`).join('')}
    ${exRows}</div>`;
},

/* The ZIP hint is built here and NOWHERE else, because two callers need it:
   the full panel render, and the keystroke handler that patches this one
   element in place. A forked copy would drift the moment either changed. */
placeHintHTML() {
  const pl = S.place;
  const net = this.currentNetwork();
  const regionalIds = P.networksWithRegionalPricing().map(n => n.id);
  if (!S.placeRaw)
    return 'Sets which <b>price</b> is used where a network charges differently by ' +
           'state or province. It does not search for chargers \u2014 use ' +
           '<b>Find a charger</b> below for that.';
  if (!pl)
    return 'Not a ZIP or postal code I recognise \u2014 nothing has been applied.';
  return `Reading this as <b>${h(pl.state || pl.province)}</b>, ` +
    `${pl.country === 'US' ? 'USA' : 'Canada'}. ` +
    (net && regionalIds.includes(net.id)
      ? 'This network does price by jurisdiction, so it is being used.'
      : net ? h(net.name) + ' does not price by state, so this changes nothing for it.'
            : 'Pick a network below to use it.');
},

renderPricing() {
  const box = $('pricing-box'); if (!box) return;
  const pr = S.session.pricing;
  const net = this.currentNetwork();
  const byCountry = { US: P.networksFor('US'), CA: P.networksFor('CA') };
  const opt = n => `<option value="${n.id}"${n.id === pr.networkId ? ' selected' : ''}>${h(n.name)}</option>`;

  /* Your own saved rate cards come first: if you've been to this charger and
     written the price down, that beats anything shipped in the file. */
  let inner = '';
  if (S.rates.length) {
    inner += `<label class="fl">Your saved rates</label>
      <div class="rows" style="margin-bottom:11px">${S.rates.map(e => `
        <div class="row-btn" style="cursor:default">
          <button style="flex:1;min-width:0;text-align:left;background:none;border:none;color:inherit;font:inherit"
                  onclick="UI.useSavedRate('${e.id}')">
            <div class="nm">${h(e.name)}${pr.savedRateId === e.id ? ' &#10003;' : ''}</div>
            <div class="sub">${e.rate.perKWh != null ? P.money(e.rate.perKWh, e.rate.currency, 3) + '/kWh' : ''}
              ${e.rate.tou ? ' · by time of day' : ''}
              ${e.rate.idle ? ' · has idle fee' : ''} · saved ${h(e.savedOn)}</div>
          </button>
          <button class="lnk" onclick="UI.deleteSavedRate('${e.id}')">delete</button>
        </div>`).join('')}</div>`;
  }

  /* Jurisdiction. Only a handful of networks price by state or province, so
     this says plainly whether it changed anything for the one you picked. */
  const pl = S.place;
  const regionalIds = P.networksWithRegionalPricing().map(n => n.id);
  inner += `<label class="fl">ZIP / postal code &mdash; sets the price, not the chargers</label>
    <input type="text" inputmode="text" placeholder="48307" value="${h(S.placeRaw || '')}"
           oninput="UI.setPlace(this.value)">
    <p class="hint" id="place-hint">${this.placeHintHTML()}</p>`;

  inner += `<label class="fl" style="margin-top:11px">Charging network — for cost</label>
    <select onchange="UI.setNetwork(this.value)">
      <option value="">— not costing this session —</option>
      <optgroup label="United States">${byCountry.US.map(opt).join('')}</optgroup>
      <optgroup label="Canada">${byCountry.CA.map(opt).join('')}</optgroup>
    </select>`;

  if (net) {
    const rate = this.currentRate();
    const authClass = net.authority === 'network' ? 'info' : 'warn';
    inner += `<div class="note ${authClass}" style="margin-top:11px">
      <b>${h(P.AUTHORITY_LABEL[net.authority])}.</b> ${h(net.authorityNote)}</div>`;

    if (net.regions && net.regions.length) {
      inner += `<label class="fl" style="margin-top:11px">Region / station type</label>
        <select onchange="UI.setPriceRegion(this.value)">
          <option value="">Network default</option>
          ${net.regions.map(g => `<option value="${g.id}"${g.id === pr.regionId ? ' selected' : ''}>${h(g.name)}</option>`).join('')}
        </select>`;
    }
    if (net.plans && net.plans.length) {
      inner += `<label class="fl" style="margin-top:11px">Membership</label>
        <select onchange="UI.setPlan(this.value)">
          <option value="">No plan / pay as you go</option>
          ${net.plans.map(p => `<option value="${p.id}"${p.id === pr.planId ? ' selected' : ''}>${h(p.name)}${p.monthlyFee ? ` — $${p.monthlyFee}/mo` : ''}${p.sessionFee ? ` + $${p.sessionFee}/session` : ''}</option>`).join('')}
        </select>`;
      const pn = this.currentPlan();
      if (pn) {
        const bits = [];
        if (pn.monthlyFee) bits.push(`${P.money(pn.monthlyFee, net.currency)}/month`);
        bits.push(pn.sessionFee ? `${P.money(pn.sessionFee, net.currency)} per session`
                : pn.waivesSessionFee ? 'no session fee' : 'no session fee listed');
        if (pn.discountPct) bits.push(`${pn.discountIsCeiling ? 'up to ' : ''}${pn.discountPct}% off energy`);
        inner += `<div class="note info" style="margin-top:9px"><b>${h(bits.join(' · '))}</b>
          ${pn.discountIsCeiling ? `<br><span style="font-size:11.5px;color:var(--tx3)">The operator words this as
            a maximum, not a flat rate — real savings vary by time, site and session length, so treat
            the figure below as a best case.</span>` : ''}
          ${pn.note ? `<br><span style="font-size:11.5px;color:var(--tx3)">${h(pn.note)}</span>` : ''}</div>`;
      }
    }

    inner += this.rateProvenanceHTML(rate);

    if (pr.userRate) {
      const u = pr.userRate;
      const bits = [];
      if (u.perKWh != null) bits.push(`${P.money(u.perKWh, u.currency, 3)}/kWh`);
      if (u.perMinute != null) bits.push(`${P.money(u.perMinute, u.currency)}/min`);
      if (u.perHour != null) bits.push(`${P.money(u.perHour, u.currency)}/hr`);
      if (u.sessionFee) bits.push(`${P.money(u.sessionFee, u.currency)} session`);
      if (u.idle) bits.push('idle fee set');
      if (u.tou) bits.push(`${u.tou.windows.length} time bands`);
      inner += `<div class="note info" style="margin-top:11px">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
          <b>Your price &mdash; ${h(bits.join(' · ')) || 'nothing entered yet'}</b>
          <button class="lnk" onclick="UI.toggleUserPrice()">remove</button></div>
        <p class="hint" style="margin-top:6px">Entered ${h(u.lastVerified)}. This overrides everything above.</p>
        <button class="btn sm" style="margin-top:8px" onclick="UI.openRateEditor()">Edit / save with a name</button></div>`;
    } else {
      inner += `<button class="btn sm ghost" style="margin-top:11px" onclick="UI.toggleUserPrice()">
        &#128176; Enter what the charger says</button>`;
    }
    inner += `<button class="btn sm ghost" style="margin-top:9px" onclick="UI.openPlanCompare()">
      Compare memberships &amp; break-even</button>`;
  }
  box.innerHTML = inner;
},

rateProvenanceHTML(rate) {
  if (!rate) return '';
  const cls = { published:'info', user:'info', secondary:'warn', estimated:'warn', unavailable:'bad' }[rate.confidence] || 'warn';
  const bits = [];
  if (rate.perKWh != null) bits.push(`${P.money(rate.perKWh, rate.currency, 3)}/kWh`);
  if (rate.perMinute != null) bits.push(`${P.money(rate.perMinute, rate.currency, 2)}/min`);
  if (rate.perHour != null) bits.push(`${P.money(rate.perHour, rate.currency, 2)}/hr`);
  if (rate.sessionFee != null && rate.sessionFee > 0) bits.push(`${P.money(rate.sessionFee, rate.currency)} session fee`);
  if (rate.powerBands) bits.push(`${rate.powerBands.length} power bands`);
  if (rate.idle) bits.push(`idle ${rate.idle.perMinute != null ? P.money(rate.idle.perMinute, rate.currency) + '/min' : P.money(rate.idle.perHour, rate.currency) + '/hr'}` +
    (rate.idle.graceMinutes != null ? ` after ${rate.idle.graceMinutes} min` : ''));
  const stale = P.isStale(rate);
  const age = P.ageDays(rate);
  return `<div class="note ${cls}" style="margin-top:11px">
    <b>${bits.length ? h(bits.join(' · ')) : 'No rate published'}</b>
    <br><span style="font-size:11.5px">${h(P.confidenceLabel(rate.confidence))}${rate.taxIncluded ? ' · taxes included' : ''}
    ${age != null ? ` · verified ${age} day${age === 1 ? '' : 's'} ago` : ''}</span>
    ${stale ? `<br><span style="color:var(--locked);font-weight:600">&#9888; Over ${P.STALE_DAYS} days old — may be outdated. Charging prices change far more often than charging curves.</span>` : ''}
    ${rate.note ? `<br><span style="font-size:11.5px;color:var(--tx3)">${h(rate.note)}</span>` : ''}</div>`;
},

/* Cost block appended to the result card. */
costHTML(res) {
  const net = this.currentNetwork(); if (!net) return '';
  const rate = this.currentRate();
  const plan = this.currentPlan();
  const sim = res.sim;
  const dwell = res.dwellMin;
  /* rate -> discount -> subtotal -> tax. `effectivePlan` picks the better of
     the selected membership plan and any eligibility discount; pricing then
     applies that single percentage to every TOU window, sums the subtotal,
     and taxes the subtotal. Tax is never folded into the per-kWh rate. */
  /* Discounts are an enhancement on top of a price. If anything in that layer
     throws, the driver should still be told what the session costs at the rack
     rate -- a missing discount is a smaller failure than a missing answer. */
  let dres = null, eff = { plan: this.currentPlan(), source: null, pct: 0 }, discErr = null;
  try {
    dres = this.currentDiscount();
    eff = this.effectivePlan(dres);
  } catch (err) {
    discErr = err;
    if (typeof console !== 'undefined') console.error('discount layer failed', err);
  }
  const c = P.sessionCost(sim, rate, { plan: eff.plan, dwellMinutes: dwell, network: net,
    startClockMinutes: E.parseClock(S.session.plugInTime) });

  if (!c.available) {
    return `<div class="card"><div class="card-h"><h2>What this costs</h2></div>
      <div class="note bad"><b>${h(net.name)} doesn't publish a rate.</b> ${h(c.reason || '')}
      <button class="btn sm" style="margin-top:10px" onclick="UI.toggleUserPrice()">Enter the price you see</button></div></div>`;
  }

  const cur = c.currency;
  const other = cur === 'USD' ? 'CAD' : 'USD';
  const conv = P.convert(c.total, cur, other, S.fx);

  const idle = c.idle;
  const idleWarn = idle.warn ? `<div class="note ${idle.cost > 0 ? 'bad' : 'warn'}" style="margin-top:12px">
      <b>&#9888; ${idle.cost > 0 ? 'Idle fees will accrue.' : 'You finish long before you leave.'}</b><br>
      Charging completes after <b>${E.fmtDur(idle.chargeCompleteMinutes)}</b>, but you're plugged in for
      <b>${E.fmtDur(dwell)}</b> — that's <b>${E.fmtDur(idle.idleMinutes)}</b> sitting there done.
      ${idle.graceMinutes ? ` After a ${idle.graceMinutes}-minute grace period, ` : ' '}
      ${idle.cost > 0
        ? `<b>${E.fmtDur(idle.billableMinutes)}</b> is billable at ${h(idle.rateLabel)} — <b>${P.money(idle.cost, cur)}</b> for a car doing nothing.`
        : (idle.connectedTimeBilling
          ? `this network bills on <b>total time connected</b>, so the meter never stops — the whole dwell is charged whether or not energy is flowing.`
          : `no idle fee is published for this network, but check the charger.`)}
      </div>` : '';

  const discLine = eff.pct > 0 ? `<div class="note ok" style="margin-top:0;margin-bottom:12px">
      <b>${(eff.pct * 100).toFixed(0)}% off applied</b> — ${h(eff.source === 'discount'
        ? (dres.applied ? dres.applied.label : 'eligibility discount')
        : (eff.plan && eff.plan.name) || 'membership plan')}.
      ${dres && dres.discountPercent > 0 && eff.source === 'plan'
        ? `Your plan beats the ${(dres.discountPercent * 100).toFixed(0)}% you also qualify for; they don't stack.`
        : ''}
      <br><span style="font-size:11.5px">Taken off the rate before tax, which is how the settled receipt reads.</span></div>` : '';

  const stats = `<div class="stats" style="margin-top:0">
    <div class="stat"><div class="l">Total</div><div class="v">${P.money(c.total, cur)}</div></div>
    <div class="stat"><div class="l">Per kWh</div><div class="v">${c.costPerKWh != null ? P.money(c.costPerKWh, cur, 3) : '—'}</div></div>
    <div class="stat"><div class="l">Energy</div><div class="v">${P.money(c.energyCost + c.timeCost, cur)}</div></div>
    <div class="stat"><div class="l">Fees</div><div class="v">${P.money(c.feesTotal, cur)}</div></div>
  </div>`;

  const breakdown = `<table class="ms-table" style="margin-top:12px">
    ${c.energyCost > 0 ? `<tr><td>Energy</td><td style="font-weight:600">${P.money(c.energyCost, cur)}</td></tr>` : ''}
    ${c.timeCost > 0 ? `<tr><td>Time</td><td style="font-weight:600">${P.money(c.timeCost, cur)}</td></tr>` : ''}
    ${c.sessionFee > 0 ? `<tr><td>Session fee</td><td style="font-weight:600">${P.money(c.sessionFee, cur)}</td></tr>` : ''}
    ${c.idleCost > 0 ? `<tr><td style="color:var(--bad)">Idle fee</td><td style="font-weight:700;color:var(--bad)">${P.money(c.idleCost, cur)}</td></tr>` : ''}
    ${c.tax > 0 ? `<tr><td>Subtotal</td><td style="font-weight:600">${P.money(c.subTotal, cur)}</td></tr>
    <tr><td>Sales tax <span class="s">${c.taxPct}%</span></td><td style="font-weight:600">${P.money(c.tax, cur)}</td></tr>` : ''}
    <tr><td style="font-weight:700">Total</td><td style="font-weight:750">${P.money(c.total, cur)}</td></tr>
  </table>`;

  /* TIME OF USE. The whole point of a dwell planner knowing your clock: bill
     the band you are actually in, show where the session straddles a
     boundary, and say plainly when waiting is worth money. */
  let touHTML = '';
  if (c.tou) {
    const a = c.touAdvice || {};
    const rows = c.tou.breakdown.map(b =>
      `<tr><td>${h(b.name)}${b.perKWh != null ? ` <span style="color:var(--tx3)">${P.money(b.perKWh, cur, 3)}/kWh</span>` : ''}</td>
           <td style="color:var(--tx3)">${E.fmtDur(b.minutes)}</td>
           <td style="font-weight:600">${P.money(b.cost, cur)}</td></tr>`).join('');
    const tip = a.best
      ? `<div class="note good" style="margin-top:11px"><b>Waiting ${E.fmtDur(a.best.waitMinutes)} saves ${P.money(a.best.saving, cur)}.</b><br>
           Plugging in at ${E.fmtClock(a.best.window.startHour * 60)} puts the whole session in ${h(a.best.window.name)} — ${P.money(a.best.altTotal, cur)} instead of ${P.money(c.total - c.feesTotal, cur)}.</div>`
      : (a.cheapest
        ? `<div class="hint" style="margin-top:9px">${h(a.cheapest.window.name)} would be ${P.money(a.cheapest.saving, cur)} cheaper, but it doesn't start for ${E.fmtDur(a.cheapest.waitMinutes)}.</div>`
        : `<div class="hint" style="margin-top:9px">You're already in the cheapest window.</div>`);
    const est = c.touConfidence === 'estimated'
      ? `<div class="note warn" style="margin-top:11px"><b>&#9888; These windows are an estimate.</b>
           ${h(net.name)} confirms it charges by time of day but doesn't publish the clock windows for your state.
           Check the app once, then <button class="lnk" onclick="UI.openTouEdit()">correct them here</button> — your version wins from then on.</div>`
      : '';
    touHTML = `<div class="divider"></div>
      <div class="card-h" style="margin-bottom:6px"><h3 style="font-size:14px;margin:0">Time of day</h3>
        <span class="badge">plugged in ${h(E.fmtClock(E.parseClock(S.session.plugInTime)))}</span></div>
      <table class="ms-table">${rows}</table>${tip}${est}`;
  }

  return `<div class="card">
    <div class="card-h"><h2>What this costs</h2>
      <span class="badge ${c.confidence === 'published' || c.confidence === 'user' ? 'solved' : 'locked'}">${h(c.confidence)}</span></div>
    ${discLine}${stats}${breakdown}${touHTML}
    <div class="hint" style="margin-top:9px">${h(net.name)}${plan ? ` · ${h(plan.name)}` : ''}
      · billed ${h(c.basis)}${c.taxIncluded ? ' · taxes included' : ''}
      <br>Roughly ${P.money(conv, other)} in ${other} at ${S.fx.USD_CAD} (as of ${h(S.fx.asOf)}) — converted, not a native price.</div>
    ${idleWarn}
    ${c.stale ? `<div class="note warn" style="margin-top:11px">&#9888; This rate was last verified ${c.ageDays} days ago and may be outdated.</div>` : ''}
  </div>${discErr
    ? `<div class="card"><div class="note bad"><b>Discounts unavailable.</b>
        The price above is the full rate with no discount applied, so it is the
        safe direction to be wrong in. ${h(discErr.message || '')}</div></div>`
    : this.discountHTML(dres)}`;
},

/* ------------------------------------------- MEMBERSHIP COMPARISON SHEET */
setUsage(v) { S.usage.sessionsPerMonth = Math.max(0, parseFloat(v) || 0); save(); this.openPlanCompare(); },

openPlanCompare() {
  const net = this.currentNetwork();
  if (!net) { this.toast('Pick a charging network first.'); return; }
  const rate = this.currentRate();
  const res = this._last;
  let baseCost = 20;
  if (res && res.ok && rate) {
    const c = P.sessionCost(res.sim, rate, { dwellMinutes: res.dwellMin });
    if (c.available) baseCost = c.total;
  }
  const n = S.usage.sessionsPerMonth;
  const rows = P.breakEven(net, baseCost, n);
  const cur = net.currency;

  this.openSheet(`${net.name} — memberships`, `
    <p class="hint" style="margin:0 0 13px">Based on a typical session of
      <b>${P.money(baseCost, cur)}</b> — taken from the session you currently have open.</p>
    <label class="fl">Sessions per month</label>
    <div class="stepper">
      <button onclick="UI.setUsage(${Math.max(0, n - 1)})">&minus;</button>
      <input type="number" value="${n}" inputmode="numeric" onchange="UI.setUsage(this.value)"
        style="text-align:center;font-size:22px;font-weight:750;background:transparent;border-color:transparent">
      <button onclick="UI.setUsage(${n + 1})">+</button>
    </div>
    ${rows.length ? rows.map(rw => `
      <div class="note ${rw.cheapest ? 'info' : ''}" style="margin-top:11px">
        <div style="display:flex;align-items:baseline;justify-content:space-between;gap:9px">
          <b>${h(rw.name)}${rw.cheapest ? ' — cheapest for you' : ''}</b>
          <span style="font-size:17px;font-weight:750">${rw.monthlyTotalAtUsage != null ? P.money(rw.monthlyTotalAtUsage, cur) : '—'}<span style="font-size:11px;color:var(--tx3)">/mo</span></span>
        </div>
        <div style="font-size:12px;color:var(--tx2);margin-top:5px">
          ${rw.monthlyFee ? `${P.money(rw.monthlyFee, cur)}/month` : 'Free'}${rw.discountPct ? ` · ${rw.discountPct}% off charging` : ''}${rw.waivesSessionFee ? ' · session fees waived' : ''}
          ${rw.breakEvenSessions != null ? `<br><b>Pays for itself after ${rw.breakEvenSessions} session${rw.breakEvenSessions === 1 ? '' : 's'} a month.</b>` : ''}
        </div>
        ${rw.note ? `<div style="font-size:11.5px;color:var(--tx3);margin-top:6px">${h(rw.note)}</div>` : ''}
      </div>`).join('')
      : `<div class="note">This network has no membership plans on file.</div>`}
    <div class="divider"></div>
    <div class="card-h"><h2>Currency</h2></div>
    <label class="fl">1 USD = ? CAD</label>
    <input type="number" step="0.01" value="${S.fx.USD_CAD}" onchange="UI.setFx(this.value)">
    <p class="hint">Last set ${h(S.fx.asOf)}. Rates are always stored and shown in their native
      currency first; conversions are labelled as conversions and never substituted silently.</p>`);
},
setFx(v) {
  const n = parseFloat(v);
  if (isFinite(n) && n > 0) { S.fx = { USD_CAD: n, asOf: new Date().toISOString().slice(0, 10), source: 'you' }; save(); }
  this.openPlanCompare();
},

renderMeasured() {
  const box = $('measured-box'); if (!box) return;
  const st = S.session.station, v = activeVehicle();
  const obs = st.observed;
  if (!obs) {
    box.innerHTML = `<button class="btn sm ghost" onclick="UI.toggleMeasured()">
      &#9889; It's actually charging slower &mdash; enter the real rate</button>
      <p class="hint">Sites often deliver less than the plate rating: 208 V service instead
      of 240 V, a shared circuit, or load management. If you can see the real number, use it.</p>`;
    return;
  }
  const calc = (() => {
    const clone = JSON.parse(JSON.stringify(st)); clone.observed = null;
    if (!v) return null;
    const ad = E.resolveAdapter(v, clone);
    if (ad.required && !ad.satisfied) return null;
    return E.powerAt(v, clone, ad.adapter, S.session.env, 50);
  })();
  const expected = calc ? calc.delivered : null;
  const gap = expected != null ? expected - obs.kW : null;

  box.innerHTML = `<div class="note warn">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:9px">
      <b>Measured rate</b>
      <button onclick="UI.toggleMeasured()" style="font-size:12px;color:var(--tx3);font-weight:600">Remove</button>
    </div>
    <div class="stepper" style="margin-top:0">
      <button onclick="UI.bumpMeasured(-0.1)">&minus;</button>
      <div style="flex:1;text-align:center">
        <input type="number" step="0.1" min="0" value="${obs.kW}" inputmode="decimal"
          onchange="UI.setMeasured(this.value)"
          style="text-align:center;font-size:23px;font-weight:750;padding:7px;background:transparent;border-color:transparent">
        <div style="font-size:10px;color:var(--tx3);font-weight:700;letter-spacing:.8px;margin-top:-4px">KILOWATTS</div>
      </div>
      <button onclick="UI.bumpMeasured(0.1)">+</button>
    </div>
    <div style="font-size:11.5px;font-weight:600;color:var(--tx2);margin:11px 0 6px">Where are you reading that?</div>
    <div class="seg" style="margin-bottom:4px">
      <button class="${obs.at === 'input' ? 'on' : ''}" style="font-size:12.5px;padding:8px 4px"
        onclick="UI.setMeasuredAt('input')">Charger or app</button>
      <button class="${obs.at === 'battery' ? 'on' : ''}" style="font-size:12.5px;padding:8px 4px"
        onclick="UI.setMeasuredAt('battery')">The car's screen</button>
    </div>
    <p class="hint" style="margin-top:8px">${obs.at === 'input'
      ? `Treated as power drawn from the charger. Onboard-charger losses come off this, so about
         <b>${(obs.kW * (v ? (v.acEfficiency || 0.89) : 0.89)).toFixed(1)} kW</b> reaches the battery.`
      : `Treated as power already going into the pack, so no further losses are subtracted.`}</p>
    ${gap != null && gap > 0.25
      ? `<div style="font-size:12px;color:var(--tx2);margin-top:8px;padding-top:8px;border-top:1px solid var(--line)">
         The hardware alone suggests ${expected.toFixed(1)} kW &mdash; you're seeing
         <b style="color:var(--locked)">${gap.toFixed(1)} kW less</b>. That gap is the site,
         and your number is what gets used.</div>`
      : (gap != null && gap < -0.25
        ? `<div style="font-size:12px;color:var(--tx2);margin-top:8px;padding-top:8px;border-top:1px solid var(--line)">
           That's higher than the ${expected.toFixed(1)} kW this hardware should manage, so the
           station or vehicle settings are probably understated. Your number still wins.</div>`
        : '')}
  </div>`;
},

/* ------------------------------------------------------- SAVED CHARGERS */
saveStationPrompt() {
  const st = S.session.station;
  const dflt = st.observed ? `${st.name.split(' —')[0]} — ${st.observed.kW} kW actual` : st.name;
  this.openSheet('Save this charger', `
    <p class="hint" style="margin:0 0 13px">Saves the connector, ratings and your measured
      rate together, so returning to this charger is one tap.</p>
    <label class="fl">Name it something you'll recognise</label>
    <input type="text" id="sv-st-name" value="${h(dflt)}" placeholder="e.g. Office garage ChargePoint">
    <div class="note info" style="margin-top:13px">
      ${h(E.CONNECTORS[st.connector].label)} &middot; ${st.level}
      &middot; ${E.ratedKW(st).toFixed(1)} kW rated${st.observed
        ? ` &middot; <b>${st.observed.kW} kW measured</b> (${st.observed.at === 'input' ? 'at the charger' : 'at the car'})` : ''}
      &middot; ${st.maxVoltage} V / ${st.maxAmps} A</div>
    <button class="btn primary" style="margin-top:15px" onclick="UI.doSaveStation()">Save charger</button>
    ${(S.stations || []).length ? `<div class="divider"></div>
      <div class="card-h"><h2>Saved chargers</h2></div>
      ${S.stations.map(s => `<div class="item"><div class="body">
        <div class="t">${h(s.name)}</div>
        <div class="s">${E.ratedKW(s).toFixed(1)} kW rated${s.observed ? ` · ${s.observed.kW} kW measured` : ''}</div></div>
        <button onclick="UI.delStation('${s.id}')" style="color:var(--bad);font-size:21px;padding:6px 9px">&times;</button>
      </div>`).join('')}` : ''}`);
},
doSaveStation() {
  const name = ($('sv-st-name').value || '').trim() || 'Saved charger';
  const st = JSON.parse(JSON.stringify(S.session.station));
  st.id = 'st' + Math.random().toString(36).slice(2, 9);
  st.name = name; st.custom = true;
  S.stations = S.stations || []; S.stations.unshift(st);
  S.session.stationPresetId = st.id;
  save(); this.closeSheet(); this.toast('Charger saved.');
},
delStation(id) {
  S.stations = (S.stations || []).filter(s => s.id !== id);
  if (S.session.stationPresetId === id) S.session.stationPresetId = 'custom';
  save(); this.saveStationPrompt();
},
setStationConn(c) {
  S.session.station.connector = c;
  S.session.stationPresetId = 'custom';
  S.session.station.name = S.session.station.name.replace(/ \(custom\)$/, '') + ' (custom)';
  save(); this.renderAll();
},
setStationNum(k, v) {
  const n = parseFloat(v);
  S.session.station[k] = isFinite(n) ? n : 0;
  S.session.stationPresetId = 'custom';
  save(); this.renderOutput();
},

/* ------------------------------------------------- LIVE TIME & WEATHER
   Everything here is a convenience layer on top of manual entry, never a
   replacement for it. Any auto-filled value stays fully editable, and the
   moment you touch a control by hand the "live" label drops away so you are
   never misled about where a number came from.                            */

plugInNow() {
  const d = new Date();
  S.session.plugInTime = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  save(); this.renderFields(); this.renderOutput();
  this.toast('Plug-in time set to now.');
},

async useLocation() {
  const btn = $('geo-btn'), out = $('geo-out');
  if (!navigator.geolocation) {
    out.innerHTML = `<div class="note bad">This browser has no location support. Set the temperature by hand below.</div>`;
    return;
  }
  if (!window.isSecureContext) {
    out.innerHTML = `<div class="note warn"><b>Location needs a secure connection.</b>
      Phones only hand out GPS to pages served over https, so this works once the app
      is installed from its web address — not when opened as a local file or in a preview.
      The manual slider below works everywhere.</div>`;
    return;
  }
  btn.textContent = 'Getting your location…';
  let pos;
  try {
    pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej,
      { enableHighAccuracy:false, timeout:12000, maximumAge:600000 }));
  } catch (e) {
    btn.textContent = '📍 Use my location & current weather';
    const denied = e && e.code === 1;
    out.innerHTML = `<div class="note ${denied ? 'warn' : 'bad'}">
      ${denied ? `<b>Location permission was declined.</b> You can turn it back on in
        Settings → Privacy → Location Services, or just set the temperature by hand — the
        maths is identical either way.`
      : `<b>Could not get a location fix.</b> ${h(e && e.message || '')} Set the temperature by hand below.`}</div>`;
    return;
  }
  btn.textContent = 'Fetching current weather…';
  const lat = pos.coords.latitude.toFixed(3), lon = pos.coords.longitude.toFixed(3);
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
      + `&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code`
      + `&timezone=auto`;
    const r = await fetch(url);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    const c = j.current;
    if (!c || c.temperature_2m == null) throw new Error('no reading returned');

    S.session.env.tempC = Math.round(c.temperature_2m);
    S.session.env.live = {
      tempC: c.temperature_2m, feels: c.apparent_temperature,
      humidity: c.relative_humidity_2m, code: c.weather_code,
      tz: j.timezone, lat, lon, at: new Date().toISOString()
    };
    // Arriving now is the common case, so line the clock up with reality too.
    this.plugInNow();
    save(); this.renderAll();
    this.toast('Live weather applied.');
  } catch (e) {
    btn.textContent = '📍 Use my location & current weather';
    out.innerHTML = `<div class="note bad"><b>Weather lookup failed.</b>
      ${h(String(e.message || e))}. Your location was found, but the forecast service
      could not be reached. Set the temperature by hand below.</div>`;
  }
},

clearLive() { S.session.env.live = null; save(); this.renderAll(); },

/* WMO weather codes → plain language. */
wmo(code) {
  const m = { 0:'Clear', 1:'Mostly clear', 2:'Partly cloudy', 3:'Overcast',
    45:'Fog', 48:'Freezing fog', 51:'Light drizzle', 53:'Drizzle', 55:'Heavy drizzle',
    56:'Freezing drizzle', 57:'Freezing drizzle', 61:'Light rain', 63:'Rain',
    65:'Heavy rain', 66:'Freezing rain', 67:'Freezing rain', 71:'Light snow',
    73:'Snow', 75:'Heavy snow', 77:'Snow grains', 80:'Light showers', 81:'Showers',
    82:'Violent showers', 85:'Snow showers', 86:'Heavy snow showers',
    95:'Thunderstorm', 96:'Thunderstorm with hail', 99:'Thunderstorm with hail' };
  return m[code] || null;
},

renderLive() {
  const out = $('geo-out'), btn = $('geo-btn');
  const lv = S.session.env.live;
  if (!lv) { if (btn) btn.textContent = '📍 Use my location & current weather'; if (out) out.innerHTML = ''; return; }
  if (btn) btn.textContent = '📍 Refresh location & weather';
  const drift = Math.round((Date.now() - new Date(lv.at)) / 60000);
  const stale = drift > 60;
  const manual = Math.round(lv.tempC) !== S.session.env.tempC;
  const F = c => Math.round(c * 9 / 5 + 32);
  const cond = this.wmo(lv.code);
  // Show the reading to one decimal so it reads as the raw measurement rather
  // than disagreeing with the rounded whole number applied to the slider.
  out.innerHTML = `<div class="note ${stale ? 'warn' : 'info'}">
    <b>Live: ${lv.tempC.toFixed(1)}°C / ${F(lv.tempC)}°F</b>${cond ? ` &middot; ${h(cond)}` : ''}${lv.feels != null
      ? ` &middot; feels like ${lv.feels.toFixed(0)}°C` : ''}${lv.humidity != null
      ? ` &middot; ${lv.humidity}% humidity` : ''}<br>
    <span style="color:var(--tx3)">${h(lv.tz || '')} &middot; ${lv.lat}, ${lv.lon}
      &middot; read ${drift < 1 ? 'just now' : drift + ' min ago'}${stale ? ' — may be out of date' : ''}</span>
    ${manual ? `<br><span style="color:var(--locked)">You have since set it to
      ${S.session.env.tempC}°C by hand — your value is what's being used.</span>` : ''}
    <button class="act" style="color:var(--given);font-weight:600;margin-top:8px"
      onclick="UI.clearLive()">Use manual entry only</button></div>`;
},

setTemp(v) {
  S.session.env.tempC = parseFloat(v);
  $('temp-badge').textContent = `${S.session.env.tempC}°C / ${Math.round(S.session.env.tempC * 9 / 5 + 32)}°F`;
  document.querySelectorAll('#season-chips .chip').forEach(c =>
    c.classList.toggle('on', +c.dataset.t === S.session.env.tempC));
  save(); this.renderLive(); this.renderOutput();
},
toggleEnv(k) {
  S.session.env[k] = !S.session.env[k];
  if (k === 'precondition' && !S.session.env[k]) S.session.env.precondEnRoute = false;
  save(); this.renderAll();
},

/* --------------------------------------------------------------- FIELDS */
setSolveFor(f) { S.session.solveFor = f; save(); this.renderAll(); },
toggleLock(f) { S.session.locked[f] = !S.session.locked[f]; save(); this.renderAll(); },

/* A requirement turns a solved field into a constraint that can FAIL. */
toggleReq(f) {
  const s = S.session;
  if (s.req[f] != null) { s.req[f] = null; }
  else {
    const r = this._last;
    if (f === 'dwell') s.req[f] = Math.max(15, Math.round(((r && r.ok ? r.dwellMin : s.dwellMin) * 0.6) / 15) * 15);
    else if (f === 'departure') s.req[f] = Math.min(100, Math.ceil((r && r.ok ? r.departureSOC : s.departureSOC) + 10));
    else s.req[f] = Math.max(0, Math.floor((r && r.ok ? r.arrivalSOC : s.arrivalSOC) - 10));
  }
  save(); this.renderAll();
},
setReq(f, v) {
  const n = parseFloat(v);
  S.session.req[f] = isFinite(n) ? (f === 'dwell' ? E.clamp(n, 0, 60 * 72) : E.clamp(Math.round(n), 0, 100)) : null;
  save(); this.renderFields(); this.renderOutput();
},
bumpReqDwell(unit, d) {
  const cur = S.session.req.dwell || 0;
  this.setReq('dwell', E.clamp(cur + (unit === 'h' ? d * 60 : d * 5), 0, 60 * 72));
},
setSOC(which, v) {
  S.session[which + 'SOC'] = E.clamp(Math.round(parseFloat(v)), 0, 100);
  save(); this.renderFields(); this.renderOutput();
},
bumpSOC(which, d) { this.setSOC(which, (S.session[which + 'SOC'] || 0) + d); },
bumpDwell(unit, d) {
  const cur = S.session.dwellMin || 0;
  S.session.dwellMin = E.clamp(cur + (unit === 'h' ? d * 60 : d * 5), 0, 60 * 72);
  save(); this.renderFields(); this.renderOutput();
},
setPlugIn(v) { S.session.plugInTime = v; save(); this.renderFields(); this.renderOutput(); },
setUnplug(v) {
  const p = E.parseClock(S.session.plugInTime), u = E.parseClock(v);
  if (p == null || u == null) return;
  let d = u - p; if (d < 0) d += 1440;
  S.session.dwellMin = d;
  if (S.session.solveFor === 'dwell') S.session.solveFor = 'departure';
  save(); this.renderAll();
},
resetFields() { S.session = Object.assign(DEFAULT_SESSION(), { level: S.session.level,
  stationPresetId: S.session.stationPresetId, station: S.session.station, env: S.session.env });
  save(); this.renderAll(); },

/* ------------------------------------------------------------- RENDERING */
renderAll() {
  const v = activeVehicle();
  $('veh-name').textContent = v ? v.name : 'No vehicle';
  $('veh-pack').textContent = v ? (v.packVerified ? v.packVariant : '⚠ verify pack') : 'Tap to add';
  $('veh-chip').querySelector('.dot').style.background =
    v ? (v.packVerified ? 'var(--solved)' : 'var(--locked)') : 'var(--tx3)';

  document.querySelectorAll('#lvl-seg button').forEach(b =>
    b.classList.toggle('on', b.dataset.lvl === S.session.level));
  $('lvl-seg').className = 'seg ' + S.session.level.toLowerCase();

  const mine = (S.stations || []).filter(p => p.level === S.session.level);
  const opt = p => `<option value="${p.id}"${p.id === S.session.stationPresetId ? ' selected' : ''}>${h(p.name)}</option>`;
  $('station-preset').innerHTML =
    (mine.length ? `<optgroup label="Your saved chargers">${mine.map(opt).join('')}</optgroup>` : '') +
    `<optgroup label="Standard">${L.STATION_PRESETS.filter(p => p.level === S.session.level).map(opt).join('')}</optgroup>` +
    (S.session.stationPresetId === 'custom' ? `<option value="custom" selected>Custom (edited)</option>` : '');

  $('station-conn').innerHTML = Object.values(E.CONNECTORS)
    .filter(c => c.level === S.session.level)
    .map(c => `<option value="${c.id}"${c.id === S.session.station.connector ? ' selected' : ''}>${h(c.label)}</option>`).join('');
  $('st-kw').value = S.session.station.maxKW;
  $('st-v').value = S.session.station.maxVoltage;
  $('st-a').value = S.session.station.maxAmps;
  $('st-note').textContent = S.session.station.note || '';
  const sl = $('site-label');
  if (sl) {
    sl.innerHTML = S.session.siteLabel
      ? `<div class="badge solved" style="margin-top:9px">&#128205; ${h(S.session.siteLabel)}
           <button class="lnk" style="margin-left:6px" onclick="UI.clearSite()">clear</button></div>`
      : '';
  }

  if (!$('season-chips').children.length) {
    $('season-chips').innerHTML = L.SEASON_PRESETS.map(s =>
      `<button class="chip sm" data-t="${s.tempC}" onclick="UI.setTemp(${s.tempC});document.getElementById('temp-slider').value=${s.tempC}">${h(s.label)}</button>`).join('');
  }
  $('temp-slider').value = S.session.env.tempC;
  this.setTemp(S.session.env.tempC);
  ['enclosed','precondition','precondEnRoute'].forEach(k =>
    $('sw-' + k).classList.toggle('on', !!S.session.env[k]));
  $('precond-wrap').style.display = S.session.level === 'DC' ? 'block' : 'none';
  $('enroute-row').style.display = S.session.env.precondition ? 'flex' : 'none';

  document.querySelectorAll('#solvefor-seg button').forEach(b =>
    b.classList.toggle('on', b.dataset.sf === S.session.solveFor));

  this.renderLive();
  this.renderShared();
  this.renderFinder();
  this.renderPricing();
  this.renderMeasured();
  this.renderAdapterBox();
  this.renderFields();
  this.renderOutput();
},

/* ------------------------------------------------- SHARED CABINET ------- */
renderShared() {
  const box = $('shared-box'); if (!box) return;
  const st = S.session.station;
  if (st.sharedMaxKW == null) { box.innerHTML = ''; return; }
  const full = E.ratedKW(st);
  box.innerHTML = `<div class="divider"></div>
    <div class="toggle" onclick="UI.toggleShared()">
      <div class="lb">Another car on the other side
        <small>This post feeds two connectors from one cabinet — sharing drops it
          from ${full.toFixed(0)} kW to ${st.sharedMaxKW} kW.</small></div>
      <div class="sw ${st.shared ? 'on' : ''}" id="sw-shared"></div>
    </div>`;
},

/* =========================================================================
   CHARGER FINDER
   Two layers, and the interface says which one you are looking at. The
   built-in list is short, hand-verified and works with no signal. The live
   lookup covers everywhere else and needs a connection.
   ========================================================================= */
renderFinder() {
  const box = $('finder-box'); if (!box) return;
  const open = !!S.finder.open;
  if (!open) {
    box.innerHTML = `<button class="btn sm ghost" style="width:100%" onclick="UI.toggleFinder()">
      &#128269; Find a charger</button>`;
    return;
  }
  const pf = S.finder.place || (S.finder.place = { q:'', results:[], busy:false, error:null, label:null });

  box.innerHTML = `
    <div class="divider"></div>
    <div class="card-h" style="margin-bottom:8px"><h3 style="font-size:14px;margin:0">Find a charger</h3>
      <button class="act" onclick="UI.toggleFinder()">Close</button></div>

    <!-- SECTION 1: the short hand-checked list. Filter only. -->
    <label class="fl">Built-in list &mdash; ${L.KNOWN_SITES.length} sites, metro Detroit, works with no signal</label>
    <input type="search" id="finder-q" placeholder="Meijer, Rochester, EVgo\u2026"
           value="${h(S.finder.q || '')}" oninput="UI.finderSearch(this.value)">
    <div id="finder-results">${this.builtInResultsHTML()}</div>

    <div class="divider"></div>

    <!-- SECTION 2: live lookup. Two ways in, one result list. -->
    <label class="fl">Search live &mdash; anywhere in the US</label>
    <input type="search" id="finder-place" placeholder="Rochester Hills MI, or 48307\u2026"
           value="${h(pf.q || '')}" oninput="UI.placeQuery(this.value)"
           onkeydown="if(event.key==='Enter'){event.preventDefault();UI.findNearPlace();}">
    <div class="row2" style="margin-top:8px;display:flex;gap:8px">
      <button class="btn sm" style="flex:1" onclick="UI.findNearPlace()"
        ${pf.busy || S.finder.busy ? 'disabled' : ''}>${pf.busy ? 'Looking up\u2026' : 'Search this place'}</button>
      <button class="btn sm ghost" style="flex:1" onclick="UI.findNearby()"
        ${S.finder.busy || pf.busy ? 'disabled' : ''}>${S.finder.busy ? 'Searching\u2026' : '\u{1F4CD} Near me'}</button>
    </div>
    <p class="hint">Where you are, or where you are going. Needs a connection either way.</p>

    ${pf.error ? `<div class="note bad" style="margin-top:10px">${h(pf.error)}</div>` : ''}
    ${pf.results && pf.results.length > 1 ? `<div class="rows" style="margin-top:10px">
        <p class="hint" style="margin:0 0 6px">More than one place matches. Which one?</p>
        ${pf.results.map((r, i) => `<button class="row-btn" onclick="UI.pickPlace(${i})">
          <div style="flex:1;min-width:0"><div class="nm">${h(r.name)}</div>
          <div class="sub">${h([r.admin1, r.country_code].filter(Boolean).join(', '))}</div></div></button>`).join('')}
      </div>` : ''}

    ${S.finder.error ? `<div class="note bad" style="margin-top:10px">${h(S.finder.error)}</div>
      ${S.nrelKeyState && S.nrelKeyState.entering ? this.keyNudgeHTML() : ''}` : ''}
    ${this.liveResultsHTML()}`;
},

/* Built separately so a keystroke can patch the list without touching the
   input that produced it. Same rule as the ZIP field. */
builtInResultsHTML() {
  const q = S.finder.q || '';
  const sites = L.searchSites(q);
  const siteRow = st => {
    const best = L.bestStall(st);
    const net = P.findNetwork(st.network);
    return `<button class="row-btn" onclick="UI.pickSite('${st.id}')">
      <div style="flex:1;min-width:0">
        <div class="nm">${h(st.name)}</div>
        <div class="sub">${h(st.city)}, ${h(st.state)} \u00b7 ${net ? h(net.name) : ''} \u00b7
          ${st.stalls.map(t => `${t.count}\u00d7${t.kW} kW`).join(' + ')}</div>
      </div><div class="badge solved">${best.kW} kW</div></button>`;
  };
  if (sites.length)
    return `<div class="rows" style="margin-top:10px">${sites.map(siteRow).join('')}</div>`;

  /* EMPTY STATE. Showing nothing implied the search was broken. It is not --
     the list is five sites in one metro area, and a query it cannot match is
     the normal case, not a failure. Say the size of the list at the moment it
     comes up empty, and point at the control that CAN answer. */
  return `<div class="note warn" style="margin-top:10px">
    <b>No match in the built-in list.</b> That list is only
    <b>${L.KNOWN_SITES.length} sites in metro Detroit</b>, each checked stall-by-stall
    against the operator's own pages${q ? ` \u2014 so &ldquo;${h(q)}&rdquo; almost certainly is not in it` : ''}.
    <br><br>To find chargers anywhere else, use <b>Search live</b> below.</div>`;
},

liveResultsHTML() {
  const live = S.finder.live || [];
  if (!live.length) return '';
  const row = (r, i) => `<button class="row-btn" onclick="UI.pickLive(${i})">
      <div style="flex:1;min-width:0">
        <div class="nm">${h(r.name)}</div>
        <div class="sub">${h(r.city || '')} \u00b7 ${h(r.network || 'Unknown operator')}
          ${r.kW ? ` \u00b7 ${r.kW} kW` : ''} \u00b7 ${r.distance != null ? r.distance.toFixed(1) + ' mi' : ''}</div>
      </div>${r.kW ? `<div class="badge">${r.kW} kW</div>` : ''}</button>`;
  return `<div class="rows" style="margin-top:10px">${live.map(row).join('')}</div>
    <p class="hint">${S.finder.liveLabel ? `Near <b>${h(S.finder.liveLabel)}</b>. ` : ''}Live results from the
      US Department of Energy's station database. It publishes hardware, not prices \u2014 no free
      source publishes live per-station rates, so set the price yourself once and it sticks.</p>
    ${this.keyNudgeHTML()}`;
},

toggleFinder() { S.finder.open = !S.finder.open; this.renderFinder(); },

/* A ZIP or postal code is the thing a driver knows. Networks that price by
   jurisdiction get the right rate from it; the rest are unaffected and the
   interface says so rather than implying the code did something. */
setPlace(v) {
  const hit = P.regionFromPostal(v);
  S.place = hit;
  S.placeRaw = String(v || '');
  save();
  /* DO NOT call renderPricing() here. It rewrites innerHTML on the container
     that holds this very input, so the browser destroys the focused node on
     every keystroke: you type "48307" and the field keeps "4".

     Debouncing only delays the destruction; restoring focus afterwards fights
     the browser and throws the caret to the end, which breaks editing in the
     middle of a value. The fix is to not re-render the thing you are typing
     into. Patch the one element that actually depends on the value.

     renderOutput() is safe -- different container, does not contain the input. */
  const hint = $('place-hint');
  if (hint) hint.innerHTML = this.placeHintHTML();
  this.renderOutput();
},
/* One builder for the key field, used by the Settings disclosure and by the
   in-context prompts. A second copy would drift. */
keyFieldHTML() {
  const st = S.nrelKeyState || {};
  const badge = st.status === 'ok' ? `<span class="tag published">key accepted</span>`
    : st.status === 'bad' ? `<span class="tag" style="background:rgba(255,90,90,.15);color:var(--bad)">rejected</span>`
    : st.status === 'checking' ? `<span class="s">checking\u2026</span>` : '';
  return `<label class="fl">Your own key ${badge}</label>
    <input type="text" id="nrel-key" placeholder="paste the whole line \u2014 I'll find the key"
           value="${h(S.nrelKey || '')}" autocapitalize="off" autocorrect="off" spellcheck="false"
           onchange="UI.setNrelKey(this.value)">
    <div style="display:flex;gap:8px;margin-top:8px">
      <a class="btn sm ghost" style="flex:1;text-align:center;text-decoration:none"
         href="https://developer.nlr.gov/signup/" target="_blank" rel="noopener">Get a free key</a>
      <button class="btn sm" style="flex:1" onclick="UI.setNrelKey(document.getElementById('nrel-key').value)">Save &amp; check</button>
    </div>
    ${st.message ? `<p class="hint" style="margin-top:8px">${h(st.message)}</p>` : ''}
    <p class="hint">The key is a 40-character string. Paste the whole email line or a
      URL containing it &mdash; it gets picked out for you. Stored on this device only.</p>`;
},

/* The prompt shown UNDER A SUCCESSFUL RESULT, not only after a failure.
   The docs say DEMO_KEY is "for initially exploring APIs prior to signing up ...
   you're encouraged to signup for your own API key if you plan to use the API".
   A user who has just searched successfully has finished exploring and is now
   using it. That is the honest moment to ask -- and asking only on a 429 would
   mean asking only when the app has just failed them. */
keyNudgeHTML() {
  if (S.nrelKey) return '';
  if (S.nrelKeyState && S.nrelKeyState.dismissed) return '';
  return `<div class="note" style="margin-top:10px">
    Running on the <b>shared demo allowance</b> \u2014 about 30 lookups an hour for
    your network, which is plenty for occasional use. A free key removes the limit.
    <div style="display:flex;gap:8px;margin-top:9px">
      <a class="btn sm ghost" style="flex:1;text-align:center;text-decoration:none"
         href="https://developer.nlr.gov/signup/" target="_blank" rel="noopener">Get one</a>
      <button class="btn sm ghost" style="flex:1" onclick="UI.openKeyEntry()">Paste key</button>
      <button class="act" onclick="UI.dismissKeyNudge()">Not now</button>
    </div>
    ${S.nrelKeyState && S.nrelKeyState.entering ? `<div style="margin-top:11px">${this.keyFieldHTML()}</div>` : ''}
  </div>`;
},

openKeyEntry() {
  S.nrelKeyState = Object.assign({}, S.nrelKeyState, { entering: true });
  this.renderFinder();
  const el = $('nrel-key'); if (el) el.focus();
},

dismissKeyNudge() {
  S.nrelKeyState = Object.assign({}, S.nrelKeyState, { dismissed: true });
  save(); this.renderFinder();
},

/* A key is a 40-character string that arrives in an email or on a page. Making
   someone select exactly 40 characters on a phone is real friction, so take
   whatever they paste -- a whole line, a URL with api_key= in it -- and pull the
   key out. Extract, never fabricate: if there is no 40-character run, say so. */
extractKey(raw) {
  const t = String(raw || '').trim();
  if (!t) return null;
  const m = t.match(/[A-Za-z0-9]{40}/);
  return m ? m[0] : null;
},

async setNrelKey(v) {
  const raw = String(v || '').trim();
  if (!raw) {
    S.nrelKey = null; S.nrelKeyState = { entering: true };
    save(); this.renderFinder(); this.renderGarage(); return;
  }
  const key = this.extractKey(raw);
  if (!key) {
    S.nrelKeyState = { entering: true, status: 'bad',
      message: 'No 40-character key found in that. Paste the line containing it, or the whole email.' };
    this.renderFinder(); this.renderGarage(); return;
  }

  /* Verify with ONE real call before storing it as good. An unverified key that
     silently does not work makes the next failure indistinguishable from the
     last one -- the user thinks it is fixed and it is not. */
  S.nrelKeyState = { entering: true, status: 'checking' };
  this.renderFinder(); this.renderGarage();
  let ok = false, why = '';
  try {
    const r = await fetch('https://developer.nlr.gov/api/alt-fuel-stations/v1/nearest.json' +
      `?api_key=${encodeURIComponent(key)}&fuel_type=ELEC&latitude=42.33&longitude=-83.05&radius=1&limit=1`);
    if (r.ok) ok = true;
    else if (r.status === 403) why = 'That key was rejected by the station database.';
    else if (r.status === 429) why = 'That key is over its limit right now. It may still be valid \u2014 try again in an hour.';
    else why = `The check came back with HTTP ${r.status}.`;
  } catch (e) {
    why = 'Could not reach the station database to check the key. It has been saved unverified.';
    S.nrelKey = key; save();
    S.nrelKeyState = { entering: true, status: null, message: why };
    this.renderFinder(); this.renderGarage(); return;
  }

  if (ok) {
    S.nrelKey = key; save();
    S.nrelKeyState = { status: 'ok', entering: false,
      message: 'Key accepted. Live search no longer shares the demo allowance.' };
  } else {
    S.nrelKeyState = { entering: true, status: 'bad', message: why };
  }
  this.renderFinder(); this.renderGarage();
},

/* kept for callers that only need the raw setter */
setNrelKeyRaw(v) { S.nrelKey = String(v || '').trim() || null; save(); },
/* Was: re-render the whole finder, then grab focus back and force the caret to
   the end. That hid the focus loss and introduced a worse one -- the caret
   jumped to the end on every keystroke, so editing the middle of a query was
   impossible. Patch the results, never the input. */
finderSearch(v) {
  S.finder.q = v;
  const el = $('finder-results');
  if (el) el.innerHTML = this.builtInResultsHTML(); else this.renderFinder();
},

placeQuery(v) {
  const pf = S.finder.place || (S.finder.place = { q:'', results:[], busy:false, error:null, label:null });
  pf.q = v;
  /* No render at all. Nothing on screen depends on this until Search is
     pressed, and re-rendering would destroy the input being typed into. */
},

/* Applying a known site: take its fastest stall's hardware and its operator. */
clearSite() { S.session.siteLabel = null; save(); this.renderAll(); },

pickSite(id) {
  const site = L.KNOWN_SITES.find(s => s.id === id); if (!site) return;
  const stall = L.bestStall(site);
  this.setStationPreset(stall.presetId);
  const pr = S.session.pricing;
  if (!pr.pinned) { pr.networkId = site.network; pr.planId = null; pr.regionId = null; }
  S.session.siteLabel = site.name + ' \u2014 ' + site.city;
  S.finder.open = false;
  save(); this.renderAll();
  this.toast(`${site.name}: ${stall.count}\u00d7${stall.kW} kW`);
},

pickLive(i) {
  const r = (S.finder.live || [])[i]; if (!r) return;
  // Match the reported power to the closest preset rather than inventing a
  // cabinet — the federal database gives kW and connector, not a voltage class.
  const wantDC = !r.level || r.level === 'DC';
  const pool = L.STATION_PRESETS.filter(p => p.level === (wantDC ? 'DC' : 'AC'));
  const target = r.kW || 150;
  const best = pool.reduce((a, b) =>
    Math.abs(E.ratedKW(b) - target) < Math.abs(E.ratedKW(a) - target) ? b : a);
  this.setStationPreset(best.id);
  if (r.networkId && !S.session.pricing.pinned) {
    S.session.pricing.networkId = r.networkId;
    S.session.pricing.planId = null; S.session.pricing.regionId = null;
  }
  S.session.siteLabel = r.name;
  S.finder.open = false;
  save(); this.renderAll();
  this.toast(`${r.name}${r.kW ? ' \u2014 ' + r.kW + ' kW' : ''}. Check the plate and adjust under Advanced.`);
},

/* Map the federal database's network names onto our pricing entries. */
nrelNetwork(name) {
  const m = { 'EVgo Network':'evgo', 'Electrify America':'electrify-america',
    'Tesla':'tesla-us', 'Tesla Destination':'tesla-us', 'ChargePoint Network':'chargepoint-us',
    'Blink Network':'blink', 'eVgo Network':'evgo', 'Ionna':'ionna',
    'Francis Energy':'francis-energy', 'RIVIAN_ADVENTURE':'rivian-ran',
    'Mercedes-Benz HPC':'mercedes-hpc', 'BP_PULSE':'bp-pulse-us', 'Red E':'red-e',
    'Electrify Canada':'electrify-canada', 'FLO':'flo', 'Circuit électrique':'circuit-electrique',
    'Petro-Canada':'petro-canada', 'IVY':'ivy', 'BC Hydro EV':'bc-hydro' };
  return m[name] || null;
},

async findNearby() {
  S.finder.busy = true; S.finder.error = null; this.renderFinder();
  const fail = msg => { S.finder.busy = false; S.finder.error = msg; this.renderFinder(); };
  if (!navigator.geolocation) return fail('This browser will not share a location.');
  let pos;
  try {
    pos = await new Promise((res, rej) =>
      navigator.geolocation.getCurrentPosition(res, rej, { timeout: 12000, maximumAge: 300000 }));
  } catch (e) {
    return fail('Location was refused or timed out. The built-in list above still works.');
  }
  /* A GPS fix is a pair of coordinates and nothing else -- it does not say which
     country you are standing in, and guessing 'US' is how Windsor drivers got an
     empty list. 'all' is also simply correct along the Detroit-Windsor border,
     where the nearest useful charger may be on the other side of the river. */
  return this.stationsAt(pos.coords.latitude, pos.coords.longitude, null, 'all');
},

/* ---- DESTINATION SEARCH -----------------------------------------------
   The app is about a dwell you have PLANNED, so "where I am standing" is the
   wrong question most of the time: you are at work, and the charger you care
   about is at the hotel. GPS answered the wrong question and was the only way in.

   The station database takes coordinates and nothing else -- checked, it has no
   free-text location parameter -- so the missing piece is place -> coordinates.
   That is Open-Meteo's geocoder: the SAME vendor already used for temperature,
   no key, no account. Deliberately not a new dependency; the governing test
   counts vendors, and this adds none.                                      */
async findNearPlace() {
  const pf = S.finder.place || (S.finder.place = { q:'', results:[], busy:false, error:null, label:null });
  const raw = $('finder-place') ? $('finder-place').value : pf.q;
  const q = String(raw || '').trim();
  pf.q = q;
  pf.error = null; pf.results = [];
  if (!q) { pf.error = 'Type a city, address or ZIP first.'; return this.renderFinder(); }

  pf.busy = true; S.finder.error = null; this.renderFinder();
  const fail = msg => { pf.busy = false; pf.error = msg; this.renderFinder(); };

  let data;
  try {
    const url = 'https://geocoding-api.open-meteo.com/v1/search' +
      `?name=${encodeURIComponent(q)}&count=5&language=en&format=json`;
    const r = await fetch(url);
    if (!r.ok) return fail(`Place lookup failed (${r.status}). The built-in list above still works.`);
    data = await r.json();
  } catch (e) {
    return fail('Could not reach the place lookup from this browser. The built-in list above still works.');
  }

  const hits = (data && data.results) || [];
  /* Never guess. An empty result is reported as empty. */
  if (!hits.length)
    return fail(`Nothing found for \u201c${q}\u201d. Try adding a state \u2014 ` +
                '&ldquo;Rochester, Michigan&rdquo; rather than &ldquo;Rochester&rdquo;.');

  pf.busy = false;
  if (hits.length > 1) {
    /* Rochester, Michigan and Rochester, New York are 600 miles apart. Picking
       the first and calling it the answer would quietly return the wrong city's
       chargers, which looks exactly like a correct answer. Ask. */
    pf.results = hits;
    return this.renderFinder();
  }
  return this.pickPlaceObj(hits[0]);
},

pickPlace(i) {
  const pf = S.finder.place || {};
  const hit = (pf.results || [])[i];
  if (!hit) return;
  pf.results = [];
  return this.pickPlaceObj(hit);
},

pickPlaceObj(hit) {
  const pf = S.finder.place;
  pf.label = [hit.name, hit.admin1, hit.country_code].filter(Boolean).join(', ');
  pf.results = [];
  /* The geocoder already told us the country, so pass it through rather than
     asking the station API to assume. Anything other than US or CA is not in
     the dataset at all -- fall back to 'all' and let the empty result be true. */
  const cc = String(hit.country_code || '').toUpperCase();
  return this.stationsAt(hit.latitude, hit.longitude, pf.label,
                         (cc === 'US' || cc === 'CA') ? cc : 'all');
},

/* One station lookup, two ways in. Both the GPS button and the destination
   search land here, so the result list, the error handling and the graceful
   degradation are identical and there is only one of each to maintain. */
async stationsAt(lat, lon, label, country) {
  S.finder.busy = true; S.finder.error = null;
  if (S.finder.place) S.finder.place.busy = false;
  this.renderFinder();
  const fail = msg => { S.finder.busy = false; S.finder.error = msg; this.renderFinder(); };

  const key = S.nrelKey || 'DEMO_KEY';
  /* HOST CHANGED 2026. DOE renamed NREL to the National Laboratory of the
     Rockies; DNS for nrel.gov and every subdomain ceased to resolve and does
     not redirect. Only the host changed -- path, parameters, response shape and
     existing keys are unaffected. */
  /* `country` DEFAULTS TO 'US' IF OMITTED. Leaving it off is why live search in
     Ontario returned nothing and reported it as a fact about Ontario rather than
     a parameter we never sent -- a confident empty result, the worst kind of
     wrong. Documented values: all | US | CA. Canadian stations are in the same
     dataset; there is no second source. */
  const cc = country || 'all';
  const url = `https://developer.nlr.gov/api/alt-fuel-stations/v1/nearest.json` +
    `?api_key=${encodeURIComponent(key)}&fuel_type=ELEC&ev_charging_level=dc_fast` +
    `&country=${encodeURIComponent(cc)}` +
    `&latitude=${lat}&longitude=${lon}` +
    `&radius=25&limit=25&status=E&access=public`;
  try {
    const resp = await fetch(url);
    if (resp.status === 429) {
      /* Carry the remedy, not a pointer to a tab. On cellular this can be caused
         entirely by strangers -- carrier-grade NAT and iOS Private Relay pool
         many subscribers behind one address, so "per IP" is not per user. */
      S.nrelKeyState = Object.assign({}, S.nrelKeyState, { entering: true, dismissed: false });
      return fail('The shared allowance for your network is used up for the next hour. ' +
                  'A free key removes the limit \u2014 see below \u2014 or use the built-in list above.');
    }
    if (resp.status === 404 || resp.status === 410)
      return fail('The station database has moved and this build is pointing at the old address. ' +
                  'The built-in list above still works. (Federal host change \u2014 see the note in Settings.)');
    if (!resp.ok) return fail(`Station lookup failed (${resp.status}). The built-in list above still works.`);
    const data = await resp.json();
    S.finder.live = (data.fuel_stations || []).map(f => {
      let kW = null;
      (f.ev_charging_units || []).forEach(u => {
        const conns = u.connectors || {};
        Object.keys(conns).forEach(k => {
          const pk = conns[k] && conns[k].power_kw;
          if (pk && (!kW || pk > kW)) kW = pk;
        });
      });
      return { name: f.station_name, city: f.city, network: this.nrelNetwork(f.ev_network),
               kW, distance: f.distance, lat: f.latitude, lon: f.longitude };
    }).filter(r => r.name);
    S.finder.busy = false;
    S.finder.liveLabel = label;
    if (!S.finder.live.length)
      S.finder.error = label
        ? `No DC fast chargers found within 25 miles of ${label}.`
        : 'No DC fast chargers found within 25 miles.';
    this.renderFinder();
  } catch (e) {
    // A CORS rejection surfaces here as a bare TypeError with no status.
    fail('Could not reach the station database from this browser. The built-in list above still works, and you can always set the charger by hand.');
  }
},

renderAdapterBox() {
  const v = activeVehicle(); const box = $('adapter-box');
  if (!v) { box.innerHTML = `<div class="note warn">Add a vehicle to check connector compatibility.</div>`; return; }
  if (S.session.level === 'DC' && v.dcCapable === false) {
    box.innerHTML = `<div class="note bad"><b>${h(v.name)} has no DC fast charging.</b>
      This vehicle takes AC only — switch to AC &mdash; Level 1/2 above. If yours does
      have a DC port, correct it in the Garage.</div>`;
    return;
  }
  const r = E.resolveAdapter(v, S.session.station);
  const slotLabel = S.session.level === 'AC' ? 'AC / Level 2' : 'DC fast-charge';
  if (!r.required) {
    box.innerHTML = `<div class="note info">Native connector match &mdash; <b>no adapter needed</b>.
      ${h(E.CONNECTORS[S.session.station.connector].label)} straight into the vehicle.</div>`;
  } else if (r.satisfied) {
    const a = r.adapter;
    box.innerHTML = `<div class="note ${a.assumed ? 'warn' : ''}">
      ${a.assumed ? `<b>Assumed:</b> ` : ''}<b>${h(a.name)}</b> &mdash; ${E.ratedKW(a).toFixed(0)} kW ceiling
      (${a.maxVoltage} V / ${a.maxAmps} A).
      ${a.assumed ? `<br><span style="color:var(--locked)">Added automatically for your
        ${h(v.make)}. Confirm you own it before relying on this.</span>` : ''}
      <button class="act" style="color:var(--given);font-weight:600;display:block;margin-top:8px"
        onclick="UI.openAdapter('${S.session.level}')">${a.assumed ? 'Confirm or change' : 'Change or edit limits'}</button></div>`;
  } else {
    box.innerHTML = `<div class="note bad"><b>Adapter required.</b> ${h(r.reason)}
      <button class="btn sm" style="margin-top:10px" onclick="UI.openAdapter('${S.session.level}')">Add ${h(slotLabel)} adapter</button></div>`;
  }
},

renderFields() {
  const s = S.session;
  const res = this._last;

  // Requirement row — only on the field being solved. This is the thing that
  // can make a plan fail, and therefore the thing worth asking about.
  const reqRowSOC = (key) => {
    const cta = key === 'departure' ? '+ I need a minimum' : '+ Cap what I can arrive with';
    const lbl = key === 'departure' ? 'Must be at least' : 'Realistically no more than';
    const val = s.req[key];
    if (val == null) return `<button class="chip sm" style="margin-top:11px"
      onclick="UI.toggleReq('${key}')">${cta}</button>`;
    const missed = res && !res.ok && res.requirementMiss && res.requirementMiss.field === key;
    return `<div style="margin-top:12px;padding-top:11px;border-top:1px dashed var(--line2)">
      <div style="display:flex;align-items:center;gap:9px;margin-bottom:5px">
        <span style="font-size:11.5px;font-weight:700;letter-spacing:.3px;
          color:${missed ? 'var(--bad)' : 'var(--locked)'}">${lbl}</span>
        <span style="font-size:17px;font-weight:750;font-variant-numeric:tabular-nums">${val}%</span>
        <span style="flex:1"></span>
        <button onclick="UI.toggleReq('${key}')" style="font-size:12px;color:var(--tx3);font-weight:600">Remove</button>
      </div>
      <div class="stepper" style="margin-top:2px">
        <button onclick="UI.setReq('${key}',${val - 1})">&minus;</button>
        <input type="range" min="0" max="100" value="${val}" style="--slider-c:var(--locked);--pct:${val}%"
          oninput="UI.setReq('${key}',this.value)">
        <button onclick="UI.setReq('${key}',${val + 1})">+</button></div></div>`;
  };
  const reqRowDwell = () => {
    const val = s.req.dwell;
    if (val == null) return `<button class="chip sm" style="margin-top:11px"
      onclick="UI.toggleReq('dwell')">+ I only have so long</button>`;
    const missed = res && !res.ok && res.requirementMiss && res.requirementMiss.field === 'dwell';
    return `<div style="margin-top:12px;padding-top:11px;border-top:1px dashed var(--line2)">
      <div style="display:flex;align-items:center;gap:9px;margin-bottom:7px">
        <span style="font-size:11.5px;font-weight:700;color:${missed ? 'var(--bad)' : 'var(--locked)'}">I have at most</span>
        <span style="font-size:17px;font-weight:750">${E.fmtDur(val)}</span>
        <span style="flex:1"></span>
        <button onclick="UI.toggleReq('dwell')" style="font-size:12px;color:var(--tx3);font-weight:600">Remove</button>
      </div>
      <div class="dur-row">
        <div class="dur-unit"><button onclick="UI.bumpReqDwell('h',-1)">&minus;</button>
          <div class="v">${Math.floor(val / 60)}<small>HOURS</small></div>
          <button onclick="UI.bumpReqDwell('h',1)">+</button></div>
        <div class="dur-unit"><button onclick="UI.bumpReqDwell('m',-1)">&minus;</button>
          <div class="v">${String(Math.round(val % 60)).padStart(2,'0')}<small>MINUTES</small></div>
          <button onclick="UI.bumpReqDwell('m',1)">+</button></div></div></div>`;
  };

  const socField = (key, name, note) => {
    const isSolve = s.solveFor === key;
    const isLock = s.locked[key];
    // When a requirement makes the plan infeasible, show what is ACTUALLY
    // achievable rather than the stale stored value — the gap is the point.
    const miss = res && !res.ok && res.requirementMiss && res.requirementMiss.field === key
                 ? res.requirementMiss.actual : null;
    const solved = isSolve ? (res && res.ok ? res[key + 'SOC'] : miss) : null;
    const val = isSolve && solved != null ? solved : s[key + 'SOC'];
    const cls = isSolve ? (res && !res.ok ? 'is-bad' : 'is-solved') : (isLock ? 'is-locked' : '');
    const badge = isSolve ? (res && !res.ok ? '<span class="badge" style="background:var(--bad-dim);color:var(--bad)">falls short</span>' : '<span class="badge solved">solved</span>')
                          : (isLock ? '<span class="badge locked">locked</span>' : '<span class="badge given">given</span>');
    return `<div class="field ${cls}" style="--pct:${val}%">
      <div class="field-h"><span class="nm">${h(name)}</span>${badge}
        <button class="lockbtn ${isLock ? 'on' : ''}" onclick="UI.toggleLock('${key}')"
          aria-label="lock">${isLock ? IC.lock : IC.unlock}</button></div>
      <div class="val"><span class="n" ${miss != null ? 'style="color:var(--bad)"' : ''}>${isSolve && solved != null ? solved.toFixed(1) : Math.round(val)}</span><span class="u">%</span></div>
      <div style="font-size:11.5px;color:var(--tx3)">${h(note)}</div>
      ${isSolve ? reqRowSOC(key) : `<div class="stepper">
        <button onclick="UI.bumpSOC('${key}',-1)">&minus;</button>
        <input type="range" min="0" max="100" step="1" value="${Math.round(val)}"
               style="--pct:${Math.round(val)}%" oninput="UI.setSOC('${key}',this.value)">
        <button onclick="UI.bumpSOC('${key}',1)">+</button></div>`}
    </div>`;
  };

  const isSolveD = s.solveFor === 'dwell';
  const dMiss = res && !res.ok && res.requirementMiss && res.requirementMiss.field === 'dwell'
                ? res.requirementMiss.actual : null;
  const dwellVal = isSolveD ? (res && res.ok ? res.dwellMin : (dMiss != null ? dMiss : s.dwellMin)) : s.dwellMin;
  const dh = Math.floor(dwellVal / 60), dm = Math.round(dwellVal % 60);
  const dCls = isSolveD ? (res && !res.ok ? 'is-bad' : 'is-solved') : (s.locked.dwell ? 'is-locked' : '');
  const dBadge = isSolveD ? (res && !res.ok ? '<span class="badge" style="background:var(--bad-dim);color:var(--bad)">too long</span>' : '<span class="badge solved">solved</span>')
                          : (s.locked.dwell ? '<span class="badge locked">locked</span>' : '<span class="badge given">given</span>');

  const dwellField = `<div class="field ${dCls}">
    <div class="field-h"><span class="nm">Dwell time</span>${dBadge}
      <button class="lockbtn ${s.locked.dwell ? 'on' : ''}" onclick="UI.toggleLock('dwell')">${s.locked.dwell ? IC.lock : IC.unlock}</button></div>
    <div class="val"><span class="n" ${dMiss != null ? 'style="color:var(--bad)"' : ''}>${E.fmtDur(dwellVal)}</span></div>
    <div style="font-size:11.5px;color:var(--tx3)">How long the car sits plugged in</div>
    ${isSolveD ? reqRowDwell() : `<div class="dur-row">
      <div class="dur-unit"><button onclick="UI.bumpDwell('h',-1)">&minus;</button>
        <div class="v">${dh}<small>HOURS</small></div>
        <button onclick="UI.bumpDwell('h',1)">+</button></div>
      <div class="dur-unit"><button onclick="UI.bumpDwell('m',-1)">&minus;</button>
        <div class="v">${String(dm).padStart(2,'0')}<small>MINUTES</small></div>
        <button onclick="UI.bumpDwell('m',1)">+</button></div></div>`}
  </div>`;

  const plug = E.parseClock(s.plugInTime);
  const unplugMin = plug != null ? plug + dwellVal : null;
  const unplugStr = unplugMin != null
    ? String(Math.floor((unplugMin % 1440) / 60)).padStart(2,'0') + ':' + String(Math.round(unplugMin % 60)).padStart(2,'0') : '';
  const rollover = unplugMin != null && unplugMin >= 1440;

  const clockField = `<div class="field">
    <div class="field-h"><span class="nm">Clock times</span>
      <span class="badge ${isSolveD ? 'solved' : 'given'}">${isSolveD ? 'unplug solved' : 'linked'}</span></div>
    <div class="row">
      <div><label class="fl">Plug in
          <button onclick="UI.plugInNow()" style="color:var(--given);font-weight:700;
            font-size:10.5px;letter-spacing:.5px;margin-left:5px">NOW</button></label>
        <input type="time" value="${h(s.plugInTime)}" oninput="UI.setPlugIn(this.value)"></div>
      <div><label class="fl">Unplug${rollover ? ' <span style="color:var(--locked)">+1d</span>' : ''}</label>
        ${isSolveD
          ? `<input type="time" value="${unplugStr}" disabled style="opacity:.75">`
          : `<input type="time" value="${unplugStr}" oninput="UI.setUnplug(this.value)">`}</div>
    </div>
    <div style="font-size:11.5px;color:var(--tx3);margin-top:8px">
      ${isSolveD ? 'Unplug time follows from the solved dwell.' : 'Editing either time adjusts the dwell to match.'}</div>
  </div>`;

  $('fields').innerHTML =
    socField('arrival', 'Arrival SOC', 'What you roll in with') +
    dwellField +
    socField('departure', 'Departure SOC', 'What you need when you leave') +
    clockField;
},

/* ---------------------------------------------------------------- SOLVE */
renderOutput() {
  const v = activeVehicle(); const out = $('out');
  if (!v) { out.innerHTML = `<div class="empty"><div class="ic">&#9889;</div>
    <div class="t">No vehicle yet</div><div class="s">Add your car in the Garage so the
    engine knows its pack, curve and connectors.</div></div>`; return; }

  const warn = (!STORAGE_OK && !S._warnDismissed)
    ? `<div class="note warn" id="store-warn"><b>Preview mode — nothing here will be saved.</b>
       This view can't write to storage, so your vehicle edits, adapters and trips
       disappear when you close it. The maths is all live and correct; only saving is off.
       Add the app to your home screen and it keeps everything.
       <button class="btn sm" style="margin-top:10px" onclick="UI.dismissWarn()">Got it</button></div>`
    : '';

  if (S.session.level === 'DC' && v.dcCapable === false) {
    out.innerHTML = warn + `<div class="result bad"><div class="k">Not possible</div>
      <div class="big" style="font-size:21px;line-height:1.3">This vehicle cannot DC fast charge.</div>
      <div class="sub" style="margin-top:8px">${h(v.name)} is AC-only, so there is no DC rate to
      compute. Switch the station to AC &mdash; Level 1/2.</div></div>`;
    return;
  }

  const s = S.session;
  const input = {
    vehicle: v, station: s.station, env: s.env,
    plugInMinutes: E.parseClock(s.plugInTime),
    locked: s.locked
  };
  if (s.solveFor !== 'arrival')   input.arrivalSOC   = s.arrivalSOC;
  if (s.solveFor !== 'departure') input.departureSOC = s.departureSOC;
  if (s.solveFor !== 'dwell')     input.dwellMin     = s.dwellMin;

  let res;
  try { res = E.solve(input); } catch (e) { res = { ok:false, kind:'error', message:String(e) }; }

  // Enforce the requirement on the solved field. If it is missed, re-solve with
  // ALL THREE pinned so the engine's constraint resolver produces real levers.
  const rq = s.req[s.solveFor];
  if (res.ok && rq != null) {
    const miss =
      (s.solveFor === 'departure' && res.departureSOC < rq - 0.05) ||
      (s.solveFor === 'dwell'     && res.dwellMin     > rq + 0.05) ||
      (s.solveFor === 'arrival'   && res.arrivalSOC   > rq + 0.05);
    if (miss) {
      const hard = Object.assign({}, input, {
        arrivalSOC:   s.solveFor === 'arrival'   ? rq : s.arrivalSOC,
        departureSOC: s.solveFor === 'departure' ? rq : s.departureSOC,
        dwellMin:     s.solveFor === 'dwell'     ? rq : s.dwellMin
      });
      let hardRes;
      try { hardRes = E.solve(hard); } catch (e) { hardRes = null; }
      if (hardRes && !hardRes.ok) {
        hardRes.requirementMiss = { field: s.solveFor, value: rq, actual: res[
          s.solveFor === 'dwell' ? 'dwellMin' : s.solveFor + 'SOC'] };
        res = hardRes;
      }
    } else {
      res.requirementMet = { field: s.solveFor, value: rq };
    }
  }

  this._last = res;
  this.renderFields();

  if (!res.ok && res.kind === 'adapter') {
    out.innerHTML = `<div class="result bad"><div class="k">Blocked</div>
      <div class="big">Adapter needed first</div>
      <div class="sub">${h(res.message)} The app will not guess a rate for hardware you may not own.</div>
      <button class="btn sm" style="margin-top:13px" onclick="UI.openAdapter('${s.level}')">Configure the adapter</button></div>`;
    return;
  }
  if (!res.ok && res.kind === 'underdetermined') {
    out.innerHTML = `<div class="note warn">${h(res.message)}</div>`; return;
  }
  if (!res.ok && res.kind === 'infeasible') { out.innerHTML = this.infeasibleHTML(res, v); return; }
  if (!res.ok) { out.innerHTML = `<div class="note bad">${h(res.message || 'Could not solve.')}</div>`; return; }

  out.innerHTML = warn + this.resultHTML(res, v) + this.costHTML(res) + this.milestoneHTML(res);
},
dismissWarn() { S._warnDismissed = true; const n = $('store-warn'); if (n) n.remove(); },

resultHTML(res, v) {
  const s = S.session, sim = res.sim;
  const plug = E.parseClock(s.plugInTime);
  let k, big, sub;
  if (res.solvedFor === 'departure') {
    k = 'You will leave at';
    big = `${res.departureSOC.toFixed(1)}%`;
    sub = `Arriving at ${res.arrivalSOC.toFixed(0)}% and sitting ${E.fmtDur(res.dwellMin)} on ${h(s.station.name)}.`;
  } else if (res.solvedFor === 'dwell') {
    k = 'You need to stay';
    big = E.fmtDur(res.dwellMin);
    sub = `${res.arrivalSOC.toFixed(0)}% &rarr; ${res.departureSOC.toFixed(0)}%. Unplug at <b>${E.fmtClock(res.unplugMinutes)}</b> if you plug in at ${E.fmtClock(plug)}.`;
  } else if (res.solvedFor === 'arrival') {
    k = 'You must arrive with at least';
    big = `${res.arrivalSOC.toFixed(1)}%`;
    sub = `Anything less and ${E.fmtDur(res.dwellMin)} on ${h(s.station.name)} will not get you to ${res.departureSOC.toFixed(0)}%.`;
  } else {
    k = 'Constraints check out';
    big = `${res.sim.endSOC.toFixed(1)}% at the plug`;
    sub = `That is ${res.surplus.toFixed(1)} points of headroom over the ${res.departureSOC.toFixed(0)}% you asked for.`;
  }

  const added = sim.energyKWh;
  const cover = res.solvedFor === 'departure' || res.solvedFor === 'check';
  const stats = `<div class="stats">
    <div class="stat"><div class="l">Energy in</div><div class="v">${added.toFixed(1)}<small> kWh</small></div></div>
    <div class="stat"><div class="l">Avg rate</div><div class="v">${sim.avgKW.toFixed(1)}<small> kW</small></div></div>
    <div class="stat"><div class="l">Peak rate</div><div class="v">${sim.peakKW.toFixed(0)}<small> kW</small></div></div>
    <div class="stat"><div class="l">Unplug</div><div class="v" style="font-size:14px">${E.fmtClock(res.unplugMinutes)}</div></div>
  </div>`;

  // Binding-constraint explanation — say it plainly when the adapter is the wall.
  let lim = '';
  const dom = sim.dominantLimiter || '';
  const label = E.limiterLabel(dom);
  const ad = res.adapterInfo;
  const probe = E.powerAt(v, s.station, ad ? ad.adapter : null, s.env,
                          (res.arrivalSOC + res.sim.endSOC) / 2);
  if (/measured/.test(dom)) {
    const o = s.station.observed || {};
    lim = `<div class="limiter adapter"><span class="ic">${IC.warn}</span>
      <span><b>Using the ${o.kW} kW you measured</b>, not the hardware rating.
      ${o.at === 'input'
        ? `Read at the charger, so onboard-charger losses are taken off that figure.`
        : `Read at the car, so that is treated as energy already entering the pack.`}
      Whatever the site is doing to throttle it is baked into your number.</span></div>`;
  } else if (/stationVoltage/.test(dom)) {
    lim = `<div class="limiter adapter"><span class="ic">${IC.warn}</span>
      <span><b>The station's voltage class is the wall here, not your truck.</b>
      ${h(probe.note || '')}</span></div>`;
  } else if (/adapter/.test(dom)) {
    lim = `<div class="limiter adapter"><span class="ic">${IC.warn}</span>
      <span><b>Your adapter is the binding constraint.</b> ${h(ad.adapter ? ad.adapter.name : 'The adapter')}
      caps this session at ${E.ratedKW(ad.adapter).toFixed(0)} kW — the ${h(S.session.station.name)} and the
      ${h(v.model)} could both go faster without it.</span></div>`;
  } else if (label) {
    const extra = /thermal/.test(dom)
      ? ` Temperature is also holding it back (${sim.thermal.factor != null ? Math.round(sim.thermal.factor * 100) + '% of full DC power' : sim.thermal.parasiticKW.toFixed(1) + ' kW going to pack heating'}).`
      : '';
    lim = `<div class="limiter"><span class="ic">${IC.warn}</span>
      <span>Limited most of the session by: <b>${h(label)}</b>.${extra}</span></div>`;
  }
  let pre = '';
  if (sim.precondMinutes > 0) {
    pre = `<div class="limiter"><span class="ic">${IC.warn}</span><span>
      <b>${sim.precondMinutes} min</b> of this dwell goes to warming the pack before meaningful power flows.
      Turn on &ldquo;while still driving&rdquo; if you precondition en route.</span></div>`;
  }

  let met = '';
  if (res.requirementMet) {
    const rm = res.requirementMet;
    met = rm.field === 'dwell'
      ? `<div class="limiter" style="border-color:var(--solved-line);background:var(--solved-dim)">
         <span class="ic" style="color:var(--solved)">${IC.warn}</span><span>Fits inside the
         <b>${E.fmtDur(rm.value)}</b> you said you had, with ${E.fmtDur(rm.value - res.dwellMin)} to spare.</span></div>`
      : `<div class="limiter" style="border-color:var(--solved-line);background:var(--solved-dim)">
         <span class="ic" style="color:var(--solved)">${IC.warn}</span><span>Clears your
         <b>${rm.value}%</b> requirement${rm.field === 'departure'
           ? ` by ${(res.departureSOC - rm.value).toFixed(1)} points`
           : ` with ${(rm.value - res.arrivalSOC).toFixed(1)} points of slack`}.</span></div>`;
  }

  return `<div class="result"><div class="k">${k}</div>
    <div class="big">${big}</div><div class="sub">${sub}</div>${stats}${met}${lim}${pre}</div>`;
},

infeasibleHTML(res, v) {
  const levers = res.levers.map(l => `<button class="lever ${l.type === 'dc-stop' ? 'dc' : ''}"
      onclick='UI.applyLever(${h(JSON.stringify(l))})'>
      <div class="t"><span>${h(l.label)}</span><span>${l.type === 'dc-stop' ? 'Add stop' : 'Apply'}</span></div>
      <div class="d">${h(l.detail)}</div></button>`).join('');
  const locked = Object.keys(S.session.locked).filter(k => S.session.locked[k]);
  const rm = res.requirementMiss;
  const why = rm ? `<div class="sub" style="margin-top:9px">You asked for
    ${rm.field === 'dwell' ? `no more than <b>${E.fmtDur(rm.value)}</b>, but it needs <b>${E.fmtDur(rm.actual)}</b>`
     : rm.field === 'departure' ? `at least <b>${rm.value}%</b> on departure, but this stop reaches <b>${rm.actual.toFixed(1)}%</b>`
     : `to arrive with no more than <b>${rm.value}%</b>, but you would need <b>${rm.actual.toFixed(1)}%</b>`}.</div>` : '';
  return `<div class="result bad"><div class="k">Will not work as planned</div>
    <div class="big" style="font-size:20px;line-height:1.3">${h(res.message)}</div>${why}
    ${locked.length ? `<div class="sub" style="margin-top:9px">Holding your locked field${locked.length > 1 ? 's' : ''}
      (${locked.join(', ')}) fixed — only the rest can move.</div>` : ''}
  </div>
  <div class="card"><div class="card-h"><h2>What you can actually do</h2></div>
    ${levers || '<div class="note">No lever fits without unlocking something. Try unlocking a field above.</div>'}</div>`;
},

applyLever(l) {
  const s = S.session;
  // If the field has a requirement attached, the lever relaxes the REQUIREMENT
  // rather than the plain value — that is the constraint the user actually set.
  if (l.type === 'extend-dwell') {
    if (s.solveFor === 'dwell' && s.req.dwell != null) s.req.dwell = Math.ceil(l.minutes);
    else { s.dwellMin = Math.round(l.minutes); if (s.solveFor === 'dwell') s.solveFor = 'departure'; }
  } else if (l.type === 'lower-target') {
    if (s.solveFor === 'departure' && s.req.departure != null) s.req.departure = Math.floor(l.soc);
    else { s.departureSOC = Math.floor(l.soc); if (s.solveFor === 'departure') s.solveFor = 'dwell'; }
  } else if (l.type === 'arrive-higher') {
    if (s.solveFor === 'arrival' && s.req.arrival != null) s.req.arrival = Math.ceil(l.soc);
    else { s.arrivalSOC = Math.ceil(l.soc); if (s.solveFor === 'arrival') s.solveFor = 'departure'; }
  } else if (l.type === 'dc-stop') { this.buildDCStopTrip(l); return; }
  save(); this.renderAll(); this.toast('Applied — re-solved.');
},

buildDCStopTrip(l) {
  const dcPreset = L.STATION_PRESETS.find(p => p.id === (activeVehicle().nativeDC === 'NACS_DC' ? 'tesla-v4' : 'ccs-350'));
  S.trip = {
    startSOC: Math.round(l.fromSOC), startTime: S.session.plugInTime,
    reserveSOC: 10, arriveSOC: Math.round(S.session.departureSOC),
    legs: [
      { type:'stop', label:`DC stop — ${l.station}`, dwellMin: Math.round(l.minutes),
        stationPresetId: dcPreset.id, station: JSON.parse(JSON.stringify(dcPreset)), locked:false },
      { type:'drive', label:'Drive to your dwell location', minutes:30, consumptionMode:'pct', consumption:5 },
      { type:'stop', label:`Dwell — ${S.session.station.name}`, dwellMin: S.session.dwellMin,
        stationPresetId: S.session.stationPresetId,
        station: JSON.parse(JSON.stringify(S.session.station)), locked:true }
    ]
  };
  save(); this.go('trip');
  this.toast('Built as a trip — adjust the drive leg to match reality.');
},

/* ----------------------------------------------------------- MILESTONES */
setGranularity(g) { S.session.granularity = g; save(); this.renderOutput(); },

milestoneHTML(res) {
  const sim = res.sim; if (!sim || sim.timeline.length < 3) return '';
  const plug = E.parseClock(S.session.plugInTime);
  const g = S.session.granularity;
  const ms = E.milestones(sim, plug, g);
  if (!ms.length) return '';

  const rows = ms.map(m => `<tr><td>${m.soc}%</td>
    <td class="clock">${E.fmtClock(m.clockMinutes)}</td>
    <td>${E.fmtDur(m.elapsedMin)}</td>
    <td class="kw">${m.kW.toFixed(0)} kW</td></tr>`).join('');

  return `<div class="card">
    <div class="card-h"><h2>Milestones</h2>
      <div class="seg" style="width:132px;padding:2px">
        <button class="${g === 5 ? 'on' : ''}" style="font-size:12px;padding:6px" onclick="UI.setGranularity(5)">Every 5%</button>
        <button class="${g === 10 ? 'on' : ''}" style="font-size:12px;padding:6px" onclick="UI.setGranularity(10)">10%</button>
      </div></div>
    ${this.chartSVG(sim, ms, plug)}
    <table class="ms-table"><thead><tr><th>SOC</th><th>Clock</th><th>Elapsed</th>
      <th style="text-align:right">Rate</th></tr></thead><tbody>${rows}</tbody></table>
  </div>`;
},

chartSVG(sim, ms, plug) {
  const W = 320, H = 132, PL = 4, PR = 4, PT = 8, PB = 18;
  const tl = sim.timeline;
  const tMax = Math.max(1, tl[tl.length - 1].min);
  const kwMax = Math.max(1, sim.peakKW);
  const x = t => PL + (t / tMax) * (W - PL - PR);
  const ySoc = s => PT + (1 - s / 100) * (H - PT - PB);
  const yKw = k => PT + (1 - k / kwMax) * (H - PT - PB);

  const step = Math.max(1, Math.floor(tl.length / 90));
  const pts = [];
  for (let i = 0; i < tl.length; i += step) pts.push(tl[i]);
  if (pts[pts.length - 1] !== tl[tl.length - 1]) pts.push(tl[tl.length - 1]);

  const socPath = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.min).toFixed(1)},${ySoc(p.soc).toFixed(1)}`).join('');
  const kwPath = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.min).toFixed(1)},${yKw(p.kW).toFixed(1)}`).join('');
  const kwArea = kwPath + `L${x(pts[pts.length-1].min).toFixed(1)},${(H - PB).toFixed(1)}L${x(pts[0].min).toFixed(1)},${(H - PB).toFixed(1)}Z`;

  const grid = [0, 25, 50, 75, 100].map(s =>
    `<line x1="${PL}" y1="${ySoc(s)}" x2="${W - PR}" y2="${ySoc(s)}" stroke="#25303E" stroke-width=".7"/>` +
    (s === 100 || s === 50 ? `<text x="${W - PR - 1}" y="${ySoc(s) + (s === 100 ? 9 : -3)}" fill="#65758A"
      font-size="8" text-anchor="end" font-family="ui-monospace,monospace">${s}%</text>` : '')).join('');
  const dots = ms.map(m => `<circle cx="${x(m.elapsedMin).toFixed(1)}" cy="${ySoc(m.soc).toFixed(1)}"
    r="2.6" fill="#0A0D12" stroke="#3DDC97" stroke-width="1.7"/>`).join('');

  const ticks = [0, .25, .5, .75, 1].map(f => {
    const t = tMax * f;
    return `<text x="${x(t).toFixed(1)}" y="${H - 5}" fill="#65758A" font-size="8.5"
      text-anchor="${f === 0 ? 'start' : f === 1 ? 'end' : 'middle'}"
      font-family="ui-monospace,monospace">${plug != null ? E.fmtClock(plug + t) : E.fmtDur(t)}</text>`;
  }).join('');

  return `<div class="chartwrap"><svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"
    style="height:${H}px">
    <defs><linearGradient id="kwg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#B98CFF" stop-opacity=".30"/>
      <stop offset="1" stop-color="#B98CFF" stop-opacity="0"/></linearGradient></defs>
    ${grid}
    <path d="${kwArea}" fill="url(#kwg)"/>
    <path d="${kwPath}" fill="none" stroke="#B98CFF" stroke-width="1.2" stroke-opacity=".8"/>
    <path d="${socPath}" fill="none" stroke="#3DDC97" stroke-width="2.2"
      stroke-linejoin="round" stroke-linecap="round"/>
    ${dots}${ticks}
  </svg>
  <div style="display:flex;gap:15px;font-size:11px;color:var(--tx3);margin:2px 2px 10px">
    <span><i style="display:inline-block;width:11px;height:2.5px;background:#3DDC97;
      vertical-align:3px;border-radius:2px"></i> State of charge</span>
    <span><i style="display:inline-block;width:11px;height:2.5px;background:#B98CFF;
      vertical-align:3px;border-radius:2px"></i> Power (peak ${sim.peakKW.toFixed(0)} kW)</span>
  </div></div>`;
},

/* =================================================================== TRIP */
tripSet(k, v) {
  if (k === 'startTime') S.trip.startTime = v;
  else S.trip[k] = E.clamp(parseFloat(v) || 0, 0, 100);
  save(); this.renderTripOutput();
},
addLeg(type) {
  const p = L.STATION_PRESETS.find(x => x.id === 'l2-48');
  S.trip.legs.push(type === 'drive'
    ? { type:'drive', label:'New drive', minutes:45, consumptionMode:'pct', consumption:15 }
    : { type:'stop', label:'New stop', dwellMin:120, stationPresetId:p.id,
        station: JSON.parse(JSON.stringify(p)), locked:false });
  save(); this.renderTrip();
},
legSet(i, k, v) {
  const leg = S.trip.legs[i];
  if (k === 'label') leg.label = v;
  else if (k === 'stationPresetId') {
    const p = L.STATION_PRESETS.find(x => x.id === v) || (S.stations || []).find(x => x.id === v);
    if (p) { leg.stationPresetId = v; leg.station = JSON.parse(JSON.stringify(p)); }
  } else if (k === 'consumptionMode') leg.consumptionMode = v;
  else if (k === 'locked') leg.locked = !leg.locked;
  else leg[k] = parseFloat(v) || 0;
  save(); this.renderTrip();
},
moveLeg(i, d) {
  const j = i + d; if (j < 0 || j >= S.trip.legs.length) return;
  const a = S.trip.legs; [a[i], a[j]] = [a[j], a[i]]; save(); this.renderTrip();
},
delLeg(i) { S.trip.legs.splice(i, 1); save(); this.renderTrip(); },

renderTrip() {
  $('tp-start').value = S.trip.startSOC;
  $('tp-time').value = S.trip.startTime;
  $('tp-reserve').value = S.trip.reserveSOC;
  $('tp-arrive').value = S.trip.arriveSOC;

  $('legs').innerHTML = S.trip.legs.map((leg, i) => {
    const ctrl = leg.type === 'drive'
      ? `<div class="row" style="margin-top:9px">
          <div><label class="fl">Drive time (min)</label>
            <input type="number" value="${leg.minutes}" oninput="UI.legSet(${i},'minutes',this.value)"></div>
          <div><label class="fl">Uses</label>
            <input type="number" value="${leg.consumption}" oninput="UI.legSet(${i},'consumption',this.value)"></div>
          <div style="max-width:92px"><label class="fl">Unit</label>
            <select onchange="UI.legSet(${i},'consumptionMode',this.value)">
              <option value="pct"${leg.consumptionMode === 'pct' ? ' selected' : ''}>% SOC</option>
              <option value="kwh"${leg.consumptionMode === 'kwh' ? ' selected' : ''}>kWh</option>
            </select></div></div>`
      : `<div style="margin-top:9px"><label class="fl">Station</label>
          <select onchange="UI.legSet(${i},'stationPresetId',this.value)">
            ${(S.stations || []).length ? `<optgroup label="Your saved chargers">${(S.stations || []).map(p =>
              `<option value="${p.id}"${p.id === leg.stationPresetId ? ' selected' : ''}>${h(p.name)}</option>`).join('')}</optgroup>` : ''}
            <optgroup label="Standard">${L.STATION_PRESETS.map(p => `<option value="${p.id}"${p.id === leg.stationPresetId ? ' selected' : ''}>${h(p.name)}</option>`).join('')}</optgroup>
          </select>
          <div class="row" style="margin-top:9px">
            <div><label class="fl">Dwell (min)</label>
              <input type="number" value="${leg.dwellMin}" oninput="UI.legSet(${i},'dwellMin',this.value)"></div>
            <div><label class="fl">&nbsp;</label>
              <button class="btn sm ${leg.locked ? '' : 'ghost'}" style="${leg.locked ? 'background:var(--locked-dim);border-color:var(--locked-line);color:var(--locked)' : ''}"
                onclick="UI.legSet(${i},'locked')">${leg.locked ? '&#128274; Dwell locked' : 'Dwell flexible'}</button></div>
          </div></div>`;
    return `<div class="card tight" style="background:var(--bg2);margin-bottom:10px">
      <div style="display:flex;align-items:center;gap:8px">
        <span class="badge ${leg.type === 'stop' ? 'solved' : ''}">${leg.type === 'drive' ? 'Drive' : 'Stop'}</span>
        <input type="text" value="${h(leg.label)}" oninput="UI.legSet(${i},'label',this.value)"
          style="flex:1;padding:7px 9px;font-size:13.5px;background:transparent;border-color:transparent">
        <button onclick="UI.moveLeg(${i},-1)" style="color:var(--tx3);padding:5px 6px">&#9650;</button>
        <button onclick="UI.moveLeg(${i},1)" style="color:var(--tx3);padding:5px 6px">&#9660;</button>
        <button onclick="UI.delLeg(${i})" style="color:var(--bad);padding:5px 7px;font-size:19px">&times;</button>
      </div>${ctrl}</div>`;
  }).join('') || `<div class="note">No legs yet. Add a drive leg or a charging stop.</div>`;

  this.renderTripOutput();
},

renderTripOutput() {
  const v = activeVehicle(); const out = $('trip-out');
  if (!v) { out.innerHTML = `<div class="note warn">Add a vehicle first.</div>`; return; }
  const t = {
    vehicle: v, startSOC: S.trip.startSOC, startMinutes: E.parseClock(S.trip.startTime),
    env: S.session.env, reserveSOC: S.trip.reserveSOC, arriveSOC: S.trip.arriveSOC,
    legs: S.trip.legs.map(l => l.type === 'drive' ? l
      : { type:'stop', label:l.label, dwellMin:l.dwellMin, station:l.station, locked:l.locked }),
    startLabel:'Depart', endLabel:'Arrive'
  };
  let r;
  try { r = E.resolveTrip(t); } catch (e) { out.innerHTML = `<div class="note bad">${h(String(e))}</div>`; return; }
  const run = r.run;

  const nodes = run.nodes.map(n => {
    if (n.kind === 'start' || n.kind === 'end') {
      return `<div class="tl-node term"><div class="tl-card">
        <div class="tl-h"><span class="nm">${h(n.label)}</span>
          <span class="tm">${E.fmtClock(n.clockMinutes)}</span></div>
        <div class="tl-soc"><b>${n.soc.toFixed(0)}%</b>
          <span>${((n.soc / 100) * v.usableKWh).toFixed(0)} kWh in the pack</span></div>
        ${bar(n.soc)}</div></div>`;
    }
    if (n.kind === 'drive') {
      const low = n.soc < (S.trip.reserveSOC || 0);
      return `<div class="tl-node ${low ? 'bad' : ''}"><div class="tl-card ${low ? 'bad' : ''}">
        <div class="tl-h"><span class="nm">${h(n.label)}</span>
          <span class="tm">${E.fmtDur(n.minutes)}</span></div>
        <div class="tl-soc"><b>${n.socBefore.toFixed(0)}%</b><span class="arr">&rarr;</span>
          <b class="dn">${n.soc.toFixed(0)}%</b>
          <span>&minus;${n.usedPct.toFixed(0)} pts &middot; ${((n.usedPct / 100) * v.usableKWh).toFixed(0)} kWh</span></div>
        ${bar(n.soc)}</div></div>`;
    }
    if (n.blocked) {
      return `<div class="tl-node bad"><div class="tl-card bad">
        <div class="tl-h"><span class="nm">${h(n.label)}</span><span class="tm">blocked</span></div>
        <div class="tl-soc"><span>${h(n.adapterInfo.reason)}</span></div></div></div>`;
    }
    return `<div class="tl-node stop"><div class="tl-card">
      <div class="tl-h"><span class="nm">${h(n.label)}</span>
        <span class="tm">${E.fmtClock(n.clockMinutes)} &ndash; ${E.fmtClock(n.endClockMinutes)}</span></div>
      <div class="tl-soc"><b>${n.socBefore.toFixed(0)}%</b><span class="arr">&rarr;</span>
        <b class="up">${n.soc.toFixed(0)}%</b>
        <span>+${n.addedKWh.toFixed(0)} kWh &middot; avg ${n.avgKW.toFixed(0)} kW</span></div>
      ${bar(n.soc)}</div></div>`;
  }).join('');

  function bar(soc) {
    const p = E.clamp(soc, 0, 100);
    return `<div class="tl-bar"><i class="${p < (S.trip.reserveSOC || 0) ? 'low' : ''}" style="width:${p}%"></i></div>`;
  }

  const issues = run.issues.length
    ? `<div class="card"><div class="card-h"><h2>Problems across this trip</h2></div>
       ${run.issues.map(i => `<div class="note bad">${h(i.message)}</div>`).join('')}
       ${r.levers.length ? `<div style="margin-top:4px">${r.levers.map(l =>
         `<button class="lever ${l.type === 'dc-stop' ? 'dc' : ''}" onclick='UI.applyTripLever(${h(JSON.stringify(l))})'>
            <div class="t"><span>${h(l.label)}</span><span>Apply</span></div>
            <div class="d">${h(l.detail)}</div></button>`).join('')}</div>` : ''}</div>`
    : `<div class="note info"><b>Trip works.</b> You arrive at ${run.endSOC.toFixed(0)}%
       ${S.trip.arriveSOC ? `— ${(run.endSOC - S.trip.arriveSOC).toFixed(0)} points above your ${S.trip.arriveSOC}% target` : ''}.</div>`;

  out.innerHTML = `<div class="card"><div class="card-h"><h2>Timeline</h2>
      <span class="badge ${run.ok ? 'solved' : ''}">${run.ok ? 'feasible' : 'needs a fix'}</span></div>
      <div class="tl">${nodes}</div></div>${issues}`;
},

applyTripLever(l) {
  if (l.type === 'extend-stop') S.trip.legs[l.legIndex].dwellMin += Math.ceil(l.extraMinutes);
  else if (l.type === 'depart-higher') S.trip.startSOC = Math.ceil(l.soc);
  else if (l.type === 'dc-stop') {
    const v = activeVehicle();
    const p = L.STATION_PRESETS.find(x => x.id === (v.nativeDC === 'NACS_DC' ? 'tesla-v4' : 'ccs-350'));
    S.trip.legs.unshift({ type:'stop', label:'Inserted DC stop', dwellMin: Math.ceil(l.minutes),
      stationPresetId:p.id, station: JSON.parse(JSON.stringify(p)), locked:false });
  }
  save(); this.renderTrip(); this.toast('Applied to the trip.');
},

/* ================================================================= SAVED */
saveTripPrompt() {
  const dflt = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
  this.openSheet('Save this trip', `
    <label class="fl">Trip name</label>
    <input type="text" id="sv-name" placeholder="e.g. Thursday job site run" value="">
    <div class="divider"></div>
    <div class="toggle" onclick="document.getElementById('sv-exp-row').style.display=
      document.getElementById('sv-exp-row').style.display==='none'?'block':'none';
      this.querySelector('.sw').classList.toggle('on')">
      <div class="lb">This is a one-off<small>Give it an expiry date and it clears itself.
        Leave off for a recurring trip that stays forever.</small></div>
      <div class="sw"></div></div>
    <div id="sv-exp-row" style="display:none">
      <label class="fl">Clears after</label>
      <input type="date" id="sv-exp" value="${dflt}"></div>
    <button class="btn primary" style="margin-top:16px" onclick="UI.doSaveTrip()">Save trip</button>`);
},
doSaveTrip() {
  const name = ($('sv-name').value || '').trim() || 'Untitled trip';
  const expRow = $('sv-exp-row');
  const expires = expRow && expRow.style.display !== 'none' ? $('sv-exp').value : null;
  S.trips.unshift({ id:'t' + Math.random().toString(36).slice(2, 9), name, expires,
    savedOn: new Date().toISOString().slice(0, 10),
    vehicleId: S.activeId, data: JSON.parse(JSON.stringify(S.trip)) });
  save(); this.closeSheet(); this.go('saved'); this.toast('Trip saved.');
},
loadTrip(id) {
  const t = S.trips.find(x => x.id === id); if (!t) return;
  S.trip = JSON.parse(JSON.stringify(t.data));
  if (t.vehicleId && S.vehicles.some(v => v.id === t.vehicleId)) S.activeId = t.vehicleId;
  save(); this.go('trip'); this.toast(`Loaded "${t.name}".`);
},
delTrip(id) { S.trips = S.trips.filter(t => t.id !== id); save(); this.renderSaved(); },

renderSaved() {
  if (!S.trips.length) {
    $('saved-list').innerHTML = `<div class="empty"><div class="ic">&#128205;</div>
      <div class="t">Nothing saved yet</div>
      <div class="s">Build a trip on the Trip tab and tap Save. Give one-offs an
      expiry date and they clear themselves; recurring trips stay put.</div></div>`;
    return;
  }
  const today = new Date().toISOString().slice(0, 10);
  $('saved-list').innerHTML = S.trips.map(t => {
    const stops = t.data.legs.filter(l => l.type === 'stop').length;
    const drives = t.data.legs.filter(l => l.type === 'drive').length;
    const days = t.expires ? Math.ceil((new Date(t.expires) - new Date(today)) / 864e5) : null;
    return `<div class="item">
      <div class="body" onclick="UI.loadTrip('${t.id}')">
        <div class="t">${h(t.name)}</div>
        <div class="s">${drives} drive leg${drives === 1 ? '' : 's'} &middot; ${stops} stop${stops === 1 ? '' : 's'}
          &middot; departs ${h(t.data.startTime)} at ${t.data.startSOC}%<br>
          ${t.expires ? `<span style="color:var(--locked)">Clears in ${days} day${days === 1 ? '' : 's'} (${t.expires})</span>`
                      : '<span style="color:var(--solved)">Recurring — kept indefinitely</span>'}</div>
      </div>
      <button onclick="UI.delTrip('${t.id}')" style="color:var(--bad);font-size:21px;padding:6px 9px">&times;</button>
    </div>`;
  }).join('');
},

/* ================================================================ GARAGE */
/* Build stamp — so you can tell at a glance whether an upload actually landed
   on the phone, rather than guessing at a stale cached copy. */
renderBuildInfo() {
  const el = $('build-info'); if (!el) return;
  const store = STORAGE_OK ? 'saving to this device' : '⚠ not saving — preview mode';
  el.innerHTML = `<div style="text-align:center;margin-top:26px;padding-top:18px;
      border-top:1px solid var(--line);font-size:11.5px;color:var(--tx3);line-height:1.7">
    <div style="font-weight:750;color:var(--tx2);font-size:13px;letter-spacing:-.2px">
      Dwell Planner v${h(VERSION)}</div>
    <div>Built ${h(BUILT)}</div>
    <div>${h(store)}</div>
    <div style="margin-top:9px">${S.vehicles.length} vehicle${S.vehicles.length === 1 ? '' : 's'}
      &middot; ${(S.stations || []).length} saved charger${(S.stations || []).length === 1 ? '' : 's'}
      &middot; ${S.trips.length} saved trip${S.trips.length === 1 ? '' : 's'}</div>
    <div style="margin-top:11px;font-size:11px">Updated the file but still seeing this build?
      Swipe the app closed from the app switcher and reopen it.</div>
    <div style="margin-top:16px;text-align:left">
      <!-- Behind a disclosure, deliberately. Almost nobody needs this: the shared
           allowance is 30 lookups per hour PER IP ADDRESS, not a pool shared
           across all users, and live search is one lookup per deliberate button
           press. A field on the main view implied setup was expected and created
           friction the API never asked for. Present, not advertised. -->
      <details>
        <summary class="s" style="cursor:pointer">Station-lookup key ${S.nrelKey ? '&mdash; set' : '(not needed for most people)'}</summary>
        <div style="margin-top:10px">
          ${this.keyFieldHTML()}
        </div>
      </details>
    </div>
  </div>`;
},

renderGarage() {
  this.renderBuildInfo();
  $('garage-list').innerHTML = S.vehicles.map(v => {
    const adDC = v.dcAdapter ? `${v.dcAdapter.name} (${E.ratedKW(v.dcAdapter).toFixed(0)} kW)` : 'none';
    const adAC = v.acAdapter ? `${v.acAdapter.name} (${E.ratedKW(v.acAdapter).toFixed(0)} kW)` : 'none';
    return `<div class="item ${v.id === S.activeId ? 'on' : ''}">
      <div class="body" onclick="UI.setActive('${v.id}')">
        <div class="t">${h(v.name)}<span class="tag ${v.curveConfidence}">${v.curveConfidence}</span></div>
        <div class="s">${h(v.packVariant)}${v.packVerified ? '' : ' <span style="color:var(--locked)">&#9888; unverified</span>'}<br>
          ${v.usableKWh} kWh usable &middot; ${v.acMaxKW} kW AC &middot; ${h(E.CONNECTORS[v.nativeDC].label)} native<br>
          <span style="color:var(--tx3)">DC adapter: ${h(adDC)} &middot; AC adapter: ${h(adAC)}</span></div>
      </div>
      <button class="go" onclick="UI.openVehicle('${v.id}')">${IC.chev}</button>
    </div>`;
  }).join('');
},
setActive(id) { S.activeId = id; save(); this.renderGarage(); this.renderAll(); this.toast('Active vehicle switched.'); },

openVehicle(id) {
  const v = S.vehicles.find(x => x.id === id); if (!v) return;
  this._editId = id;
  const curve = v.dcCurve.map((p, i) => `<div class="curve-row">
    <input type="number" value="${p.soc}" onchange="UI.curveEdit(${i},'soc',this.value)">
    <input type="number" value="${p.kW}" onchange="UI.curveEdit(${i},'kW',this.value)">
    <button onclick="UI.curveDel(${i})">&times;</button></div>`).join('');

  this.openSheet(v.name, `
    ${v.packVerified ? '' : `<div class="note warn"><b>Verify the pack variant.</b>
      Make and model alone do not determine charging behaviour — module count does.
      Confirm this is right before trusting any number the app gives you.
      <button class="btn sm" style="margin-top:10px" onclick="UI.verifyPack()">This pack variant is correct</button></div>`}

    <label class="fl">Name</label>
    <input type="text" value="${h(v.name)}" onchange="UI.vehEdit('name',this.value)">
    <label class="fl" style="margin-top:12px">Pack variant <span style="color:var(--bad)">*required</span></label>
    <input type="text" value="${h(v.packVariant)}" onchange="UI.vehEdit('packVariant',this.value)">
    ${v.vin ? `<p class="hint">Decoded from VIN ${h(v.vin)}</p>` : ''}
    ${v.vinFields ? `<div class="note info" style="margin-top:11px">
      <b>Confirmed from your VIN</b> — manufacturer-filed values, not estimates:
      <table class="ms-table" style="margin-top:6px">${Object.entries(v.vinFields).map(([k, val]) =>
        `<tr><td style="color:var(--tx3);font-size:12px">${h({
          acMaxKW:'Onboard charger', packArchitectureV:'Pack voltage', modules:'Battery modules',
          batteryKWh:'Battery energy', cells:'Cells per module', packs:'Packs per vehicle',
          batteryType:'Battery type', driveUnit:'EV drive unit', chargerLevel:'Charger level'
        }[k] || k)}</td><td style="font-weight:600">${h(val)}</td></tr>`).join('')}</table>
      ${v.vinBatteryKWh ? `<div style="margin-top:9px;font-size:12px;color:var(--tx2)">
        The VIN reports <b>${v.vinBatteryKWh} kWh</b>, which is usually the nominal pack size.
        Usable capacity is typically a few percent lower — currently set to ${v.usableKWh} kWh.
        <button class="btn sm" style="margin-top:8px" onclick="UI.useVinKWh()">Use ${v.vinBatteryKWh} kWh as usable</button>
      </div>` : ''}</div>` : ''}

    <div class="row" style="margin-top:12px">
      <div><label class="fl">Usable kWh</label>
        <input type="number" step="0.1" value="${v.usableKWh}" onchange="UI.vehEdit('usableKWh',this.value)"></div>
      <div><label class="fl">Max onboard AC kW</label>
        <input type="number" step="0.1" value="${v.acMaxKW}" onchange="UI.vehEdit('acMaxKW',this.value)"></div>
    </div>
    <div class="row" style="margin-top:11px">
      <div><label class="fl">Native AC connector</label>
        <select onchange="UI.vehEdit('nativeAC',this.value)">
          ${['J1772','NACS_AC'].map(c => `<option value="${c}"${v.nativeAC === c ? ' selected' : ''}>${h(E.CONNECTORS[c].label)}</option>`).join('')}
        </select></div>
      <div><label class="fl">Native DC connector</label>
        <select onchange="UI.vehEdit('nativeDC',this.value)">
          ${['CCS1','NACS_DC','CHADEMO'].map(c => `<option value="${c}"${v.nativeDC === c ? ' selected' : ''}>${h(E.CONNECTORS[c].label)}</option>`).join('')}
        </select></div>
    </div>
    <div class="row" style="margin-top:11px">
      <div><label class="fl">Pack architecture (V)</label>
        <input type="number" value="${v.packArchitectureV}" onchange="UI.vehEdit('packArchitectureV',this.value)"></div>
      <div><label class="fl">Cap on 400 V stations (kW)</label>
        <input type="number" value="${v.lowVoltStationMaxKW || ''}" placeholder="n/a"
          onchange="UI.vehEdit('lowVoltStationMaxKW',this.value)"></div>
    </div>
    <p class="hint">An 800 V pack on a 400 V-class post (most Tesla V3 cabinets) charges
      well below its native curve. That cap is what turns a 340 kW car into a 183 kW one.</p>

    <div class="divider"></div>
    <div class="card-h"><h2>Adapters</h2></div>
    ${[['DC','dcAdapter','DC fast-charge adapter'],['AC','acAdapter','AC / Level 2 adapter']].map(([t, slot, label]) => {
      const a = v[slot];
      return `<button class="item" style="margin-bottom:9px" onclick="UI.openAdapter('${t}')">
        <div class="body"><div class="t">${label}${a && a.assumed ? '<span class="tag estimated">assumed</span>' : ''}</div>
          <div class="s">${a ? h(a.name) + ` — ${E.ratedKW(a).toFixed(0)} kW / ${a.maxVoltage} V / ${a.maxAmps} A`
            + (a.assumed ? '<br><span style="color:var(--locked)">Confirm you own this</span>' : '')
            : 'Not configured'}</div></div>
        <span class="go">${IC.chev}</span></button>`;
    }).join('')}

    <div class="divider"></div>
    <div class="card-h"><h2>DC charging curve</h2>
      <span class="tag ${v.curveConfidence}">${v.curveConfidence}</span></div>
    <p class="hint" style="margin:0 0 12px">${h(v.curveNote || '')}</p>
    <div class="curve-row" style="font-size:11px;color:var(--tx3);font-weight:700">
      <div style="text-align:center">SOC %</div><div style="text-align:center">kW</div><div></div></div>
    ${curve}
    <button class="btn sm ghost" style="margin-top:8px" onclick="UI.curveAdd()">+ Add curve point</button>

    <div class="divider"></div>
    ${S.vehicles.length > 1 ? `<button class="btn danger" onclick="UI.delVehicle()">Remove this vehicle</button>` : ''}
  `);
},
vehEdit(k, val) {
  const v = S.vehicles.find(x => x.id === this._editId); if (!v) return;
  const numeric = ['usableKWh','acMaxKW','packArchitectureV','lowVoltStationMaxKW'];
  const before = v[k];
  if (numeric.includes(k)) { const n = parseFloat(val); v[k] = isFinite(n) && n > 0 ? n : (k === 'lowVoltStationMaxKW' ? null : v[k]); }
  else v[k] = val;

  /* Capacity and pack variant are not cosmetic fields. The shipped curve was
     generated for a SPECIFIC physical pack -- a 20-module Hummer and a
     24-module Hummer share a badge and behave nothing alike. Change either
     one and the curve now describes a battery this vehicle does not have, so
     it can no longer carry the label the library gave it.

     This is the same rule curveEdit() applies, for the same reason: a number
     the owner typed is not a measurement, and an estimate must never keep a
     stronger label than it has earned. Demote only on a real change, and only
     from a shipped label -- re-demoting an already-'user' curve would
     overwrite a note the owner may have set deliberately. */
  if ((k === 'usableKWh' || k === 'packVariant') && v[k] !== before &&
      v.curveConfidence !== 'user') {
    v.curveConfidence = 'user';
    v.curveNote = 'Pack changed after this curve was generated' +
      (before != null && before !== '' ? ' (was ' + before + ').' : '.') +
      ' The shipped curve was built for a different pack, so it is no longer ' +
      'the library\u2019s estimate. Treat it as a starting point and edit it, ' +
      'or re-pick the vehicle to get the curve for this pack.';
  }
  save();
},
useVinKWh() {
  const v = S.vehicles.find(x => x.id === this._editId);
  if (!v || !v.vinBatteryKWh) return;
  v.usableKWh = v.vinBatteryKWh;
  v.vinFields = Object.assign({}, v.vinFields, { usableKWh: v.vinBatteryKWh + ' kWh' });
  save(); this.openVehicle(v.id); this.toast('Capacity set from the VIN.');
},
verifyPack() {
  const v = S.vehicles.find(x => x.id === this._editId); if (!v) return;
  v.packVerified = true; save(); this.openVehicle(v.id); this.toast('Pack variant confirmed.');
},
curveEdit(i, k, val) {
  const v = S.vehicles.find(x => x.id === this._editId); if (!v) return;
  const n = parseFloat(val); if (!isFinite(n)) return;
  v.dcCurve[i][k] = k === 'soc' ? E.clamp(n, 0, 100) : Math.max(0, n);
  v.dcCurve.sort((a, b) => a.soc - b.soc);
  // Typing numbers into a form is not a measurement. A hand-edited curve gets
  // its own label -- not the strongest one in the system.
  v.curveConfidence = 'user';
  v.curveNote = 'Edited by you. Not a measured curve unless you measured it.';
  save();
},
curveAdd() {
  const v = S.vehicles.find(x => x.id === this._editId); if (!v) return;
  v.dcCurve.push({ soc:50, kW:100 }); v.dcCurve.sort((a, b) => a.soc - b.soc);
  save(); this.openVehicle(v.id);
},
curveDel(i) {
  const v = S.vehicles.find(x => x.id === this._editId); if (!v) return;
  if (v.dcCurve.length <= 3) { this.toast('A curve needs at least three points.'); return; }
  v.dcCurve.splice(i, 1); save(); this.openVehicle(v.id);
},
delVehicle() {
  S.vehicles = S.vehicles.filter(v => v.id !== this._editId);
  if (S.activeId === this._editId) S.activeId = S.vehicles[0] ? S.vehicles[0].id : null;
  save(); this.closeSheet(); this.go('garage');
},

/* ------------------------------------------------------------- ADAPTERS */
openAdapter(type) {
  const v = activeVehicle(); if (!v) return;
  this._editId = this._editId || v.id;
  const veh = S.vehicles.find(x => x.id === this._editId) || v;
  const slot = type === 'AC' ? 'acAdapter' : 'dcAdapter';
  const cur = veh[slot];
  const g = L.adaptersFor(type, veh.make);
  const opt = p => `<option value="${p.id}"${cur && cur.id === p.id ? ' selected' : ''}>${h(p.name)}</option>`;
  const grp = (label, arr) => arr.length ? `<optgroup label="${h(label)}">${arr.map(opt).join('')}</optgroup>` : '';

  this.openSheet(`${type === 'AC' ? 'AC / Level 2' : 'DC fast-charge'} adapter`, `
    <p class="hint" style="margin:0 0 13px">Every adapter is a real ceiling in the chain.
      The app takes the lowest of vehicle, station and adapter — and tells you which one is binding.</p>
    ${cur && cur.assumed ? `<div class="note warn"><b>Filled in for you.</b> This is the factory
      ${h(veh.make)} adapter, added automatically because of your vehicle. Confirm you actually
      own it — the app will otherwise assume you can plug in at a Supercharger.
      <button class="btn sm" style="margin-top:10px" onclick="UI.confirmAdapter('${slot}')">Yes, I own this adapter</button>
      </div>` : ''}
    <label class="fl">Which adapter do you have?</label>
    <select id="ad-preset" onchange="UI.adapterPreset('${slot}',this.value)">
      <option value="">— choose —</option>
      ${grp(`Made by ${veh.make} — recommended`, g.yours)}
      ${grp('Other manufacturer adapters', g.otherOem)}
      ${grp('Third-party (Amazon / retail)', g.thirdParty)}
      ${grp("Don't know / not listed", g.unknown)}
    </select>
    ${cur && cur.confidence === 'typical' && !cur.assumed ? `<p class="hint">
      These figures are typical for this class, not read off your exact unit. Check the label
      and correct them below if they differ.</p>` : ''}
    ${cur ? `
      <label class="fl" style="margin-top:14px">Name</label>
      <input type="text" value="${h(cur.name)}" onchange="UI.adEdit('${slot}','name',this.value)">
      <div class="row" style="margin-top:11px">
        <div><label class="fl">Station side</label>
          <select onchange="UI.adEdit('${slot}','fromConnector',this.value)">
            ${Object.values(E.CONNECTORS).filter(c => c.level === type).map(c =>
              `<option value="${c.id}"${cur.fromConnector === c.id ? ' selected' : ''}>${h(c.label)}</option>`).join('')}
          </select></div>
        <div><label class="fl">Car side</label>
          <select onchange="UI.adEdit('${slot}','toConnector',this.value)">
            ${Object.values(E.CONNECTORS).filter(c => c.level === type).map(c =>
              `<option value="${c.id}"${cur.toConnector === c.id ? ' selected' : ''}>${h(c.label)}</option>`).join('')}
          </select></div>
      </div>
      <div class="grid3" style="margin-top:11px">
        <div><label class="fl">Max kW</label><input type="number" step="0.1" value="${cur.maxKW}"
          onchange="UI.adEdit('${slot}','maxKW',this.value)"></div>
        <div><label class="fl">Max volts</label><input type="number" value="${cur.maxVoltage}"
          onchange="UI.adEdit('${slot}','maxVoltage',this.value)"></div>
        <div><label class="fl">Max amps</label><input type="number" value="${cur.maxAmps}"
          onchange="UI.adEdit('${slot}','maxAmps',this.value)"></div>
      </div>
      <div class="note info" style="margin-top:12px">Effective ceiling:
        <b>${E.ratedKW(cur).toFixed(1)} kW</b> — the lower of the kW plate rating and ${cur.maxVoltage} V &times; ${cur.maxAmps} A.</div>
      ${cur.note ? `<p class="hint">${h(cur.note)}</p>` : ''}
      <button class="btn danger" style="margin-top:14px" onclick="UI.adRemove('${slot}')">Remove this adapter</button>
    ` : `<div class="note" style="margin-top:14px">No adapter in this slot. Pick a preset above,
      then edit its voltage, amperage and kW limits to match the unit you actually own.</div>`}`);
},
adapterPreset(slot, id) {
  const veh = S.vehicles.find(x => x.id === this._editId); if (!veh) return;
  if (!id) { veh[slot] = null; } else {
    // Choosing one deliberately means it is no longer an assumption.
    veh[slot] = JSON.parse(JSON.stringify(L.ADAPTER_PRESETS.find(p => p.id === id)));
    veh[slot].assumed = false;
  }
  save(); this.openAdapter(slot === 'acAdapter' ? 'AC' : 'DC');
},
confirmAdapter(slot) {
  const veh = S.vehicles.find(x => x.id === this._editId); if (!veh || !veh[slot]) return;
  veh[slot].assumed = false; save();
  this.openAdapter(slot === 'acAdapter' ? 'AC' : 'DC');
  this.toast('Adapter confirmed.');
},
adEdit(slot, k, val) {
  const veh = S.vehicles.find(x => x.id === this._editId); if (!veh || !veh[slot]) return;
  if (['maxKW','maxVoltage','maxAmps'].includes(k)) {
    const n = parseFloat(val); veh[slot][k] = isFinite(n) && n > 0 ? n : 0;
  } else veh[slot][k] = val;
  save(); this.openAdapter(slot === 'acAdapter' ? 'AC' : 'DC');
},
adRemove(slot) {
  const veh = S.vehicles.find(x => x.id === this._editId); if (!veh) return;
  veh[slot] = null; save(); this.openAdapter(slot === 'acAdapter' ? 'AC' : 'DC');
},

/* -------------------------------------------------------- ADD A VEHICLE */
openAddVehicle() {
  this._pick = { year: null, make: null, model: null };
  this._libMode = 'guided'; this._libSearch = '';
  this.openSheet('Add a vehicle', `
    <div class="seg" id="add-seg" style="margin-bottom:15px">
      <button class="on" onclick="UI.addTab('vin')">Decode a VIN</button>
      <button onclick="UI.addTab('lib')">Pick from library</button>
    </div>
    <div id="add-vin">
      <label class="fl">VIN (17 characters)</label>
      <input type="text" id="vin-in" maxlength="17" placeholder="1GT40FDA5RU100000"
        style="text-transform:uppercase;font-family:var(--fm);letter-spacing:1px">
      <button class="btn primary" style="margin-top:12px" onclick="UI.decodeVIN()">Decode</button>
      <p class="hint">Uses the free NHTSA vPIC database. Alongside year, make, model and trim it
        can also return <b>battery modules per pack, pack voltage, energy and onboard charger kW</b>
        — filed by the manufacturer, not estimated. Whatever comes back is applied to your profile
        and labelled as coming from the VIN. Manufacturers vary in what they file, so blank fields
        just mean NHTSA holds no data. Needs a connection; if it is unreachable, use the library.</p>
      <div id="vin-out" style="margin-top:14px"></div>
    </div>
    <div id="add-lib" style="display:none">${this.libraryPickerHTML()}</div>`);
},
addTab(which) {
  document.querySelectorAll('#add-seg button').forEach((b, i) =>
    b.classList.toggle('on', (i === 0) === (which === 'vin')));
  $('add-vin').style.display = which === 'vin' ? 'block' : 'none';
  $('add-lib').style.display = which === 'lib' ? 'block' : 'none';
},
/* --------------------------------------------------------- LIBRARY PICKER
   Two ways in, because neither suits everyone: a guided year → make → model
   narrowing for people who know their car, and a searchable flat list for
   browsing or when the guided path does not have what you want.            */
_pick: { year: null, make: null, model: null },
_libMode: 'guided',
_libSearch: '',

libMode(m) { this._libMode = m; this.renderLibrary(); },
pickSet(field, val) {
  const p = this._pick;
  p[field] = val || null;
  if (field === 'year') { p.make = null; p.model = null; }
  if (field === 'make') { p.model = null; }
  this.renderLibrary();
},
libSearch(q) { this._libSearch = q; this.renderLibrary(); },

renderLibrary() {
  const box = $('add-lib'); if (!box) return;
  box.innerHTML = this.libraryPickerHTML();
  const s = $('lib-search');
  if (s) { s.value = this._libSearch; if (this._libMode === 'list') { s.focus(); s.setSelectionRange(s.value.length, s.value.length); } }
},

vehRow(v, onclick) {
  return `<button class="item" onclick="${onclick}">
    <div class="body">
      <div class="t">${v.yearFrom === v.yearTo ? v.yearFrom : v.yearFrom + '–' + v.yearTo} ${h(v.make)} ${h(v.model)}</div>
      <div class="s"><b style="color:var(--tx2)">${h(v.packVariant)}</b><br>
        ${v.usableKWh} kWh &middot; ${v.acMaxKW} kW AC &middot; ${h(E.CONNECTORS[v.nativeDC].short)} DC
        &middot; ${v.packArchitectureV} V
        <span class="tag ${v.curveConfidence}">${v.curveConfidence}</span></div></div>
    <span class="go">${IC.chev}</span></button>`;
},

libraryPickerHTML(filterIds) {
  // VIN-narrowed result: just the candidates, no mode switcher.
  if (filterIds) {
    return L.LIBRARY.filter(v => filterIds.includes(v.id))
      .map(v => this.vehRow(v, `UI.addFromLibrary('${v.id}')`)).join('');
  }

  const modeSeg = `<div class="seg" style="margin-bottom:13px">
    <button class="${this._libMode === 'guided' ? 'on' : ''}" onclick="UI.libMode('guided')">Year / make / model</button>
    <button class="${this._libMode === 'list' ? 'on' : ''}" onclick="UI.libMode('list')">Browse all ${L.LIBRARY.length}</button>
  </div>`;

  if (this._libMode === 'list') {
    const res = L.search(this._libSearch);
    return modeSeg + `
      <input type="text" id="lib-search" placeholder="Search — try &quot;hummer&quot;, &quot;2025 kia&quot;, &quot;800&quot;"
        value="${h(this._libSearch)}" oninput="UI.libSearch(this.value)" autocomplete="off">
      <p class="hint">${res.length} of ${L.LIBRARY.length} vehicles</p>
      ${res.length ? res.map(v => this.vehRow(v, `UI.addFromLibrary('${v.id}')`)).join('')
        : `<div class="note warn">Nothing matches that. Pick the closest vehicle instead — every
           field is editable afterwards, so you can correct capacity, connectors and the curve.</div>`}`;
  }

  const p = this._pick;
  const years = L.yearsList();
  const makes = p.year ? L.makesIn(p.year) : [];
  const models = (p.year && p.make) ? L.modelsIn(p.year, p.make) : [];
  const variants = (p.year && p.make && p.model) ? L.query(p) : [];

  const sel = (id, label, val, opts, enabled) => `
    <label class="fl" style="margin-top:11px">${label}</label>
    <select ${enabled ? '' : 'disabled style="opacity:.45"'} onchange="UI.pickSet('${id}',this.value)">
      <option value="">${enabled ? '— select —' : '— choose ' + (id === 'make' ? 'a year' : 'a make') + ' first —'}</option>
      ${opts.map(o => `<option value="${h(o)}"${String(val) === String(o) ? ' selected' : ''}>${h(o)}</option>`).join('')}
    </select>`;

  return modeSeg +
    sel('year', 'Model year', p.year, years, true) +
    sel('make', 'Make', p.make, makes, !!p.year) +
    sel('model', 'Model', p.model, models, !!p.make) +
    (variants.length ? `
      <div class="card-h" style="margin-top:18px"><h2>Pack variant — required</h2></div>
      <p class="hint" style="margin:0 0 11px">This is the field that actually decides how your car
        charges. Two trucks with the same badge and different module counts behave nothing alike.</p>
      ${variants.map(v => this.vehRow(v, `UI.addFromLibrary('${v.id}')`)).join('')}`
    : (p.model ? `<div class="note warn">No variants listed for that combination.</div>` : ''))
    + (p.year && !makes.length ? `<div class="note warn">No vehicles in the library for ${p.year} yet.</div>` : '');
},
addFromLibrary(libId, vin, verified) {
  const b = L.findById(libId);
  if (!b) { this.toast('That vehicle is no longer in the library.'); return; }
  const v = vehicleFromLibrary(libId, verified === true, p.year);
  if (vin) {
    v.vin = vin;
    // Apply anything the VIN actually reported, recording provenance so the
    // vehicle screen can show which numbers are measured facts from the VIN
    // and which are still library estimates.
    const ev = this._vinEV;
    if (ev && this._vinFor === vin) v.vinFields = this.applyVinFacts(v, ev);
  }
  S.vehicles.push(v); S.activeId = v.id; save();
  this.closeSheet(); this.go('garage');
  this._editId = v.id;
  setTimeout(() => this.openVehicle(v.id), 260);
  const n = v.vinFields ? Object.keys(v.vinFields).length : 0;
  this.toast(n ? `Added — ${n} value${n === 1 ? '' : 's'} confirmed from the VIN.`
                : (verified ? 'Vehicle added.' : 'Added — confirm the pack variant.'));
},

/* Overlay VIN-reported facts onto a profile. Returns a provenance map. */
applyVinFacts(v, ev) {
  const got = {};
  if (ev.acKW > 0)      { v.acMaxKW = ev.acKW;                got.acMaxKW = ev.acKW + ' kW'; }
  if (ev.volts > 0)     { v.packArchitectureV = ev.volts;     got.packArchitectureV = ev.volts + ' V'; }
  if (ev.modules > 0)   { got.modules = ev.modules + ' modules'; v.modules = ev.modules; }
  if (ev.kWh > 0)       { got.batteryKWh = ev.kWh + ' kWh (nominal)'; v.vinBatteryKWh = ev.kWh; }
  if (ev.cells > 0)     { got.cells = ev.cells + ' cells/module'; }
  if (ev.packs > 0)     { got.packs = ev.packs + ' pack(s)'; }
  if (ev.type)          { got.batteryType = ev.type; }
  if (ev.driveUnit)     { got.driveUnit = ev.driveUnit; }
  if (ev.chargerLevel)  { got.chargerLevel = ev.chargerLevel; }
  // A VIN-confirmed module count IS the pack variant, so stop calling it unverified.
  if (ev.modules > 0 && v.modules === ev.modules) v.packVerified = true;
  return Object.keys(got).length ? got : null;
},

/* Pull every EV field vPIC exposes. Empty means NHTSA has no data for it. */
readVinEV(d) {
  const num = x => { const n = parseFloat(x); return isFinite(n) && n > 0 ? n : 0; };
  // Ranges come back as From/To pairs; the upper bound is the built configuration.
  const pick = (a, b) => num(b) || num(a);
  return {
    kWh:      pick(d.BatteryKWh, d.BatteryKWh_to),
    volts:    pick(d.BatteryV, d.BatteryV_to),
    amps:     pick(d.BatteryA, d.BatteryA_to),
    modules:  num(d.BatteryModules),
    cells:    num(d.BatteryCells),
    packs:    num(d.BatteryPacks),
    acKW:     num(d.ChargerPowerKW),
    type:     (d.BatteryType || '').trim(),
    info:     (d.BatteryInfo || '').trim(),
    driveUnit:(d.EVDriveUnit || '').trim(),
    chargerLevel: (d.ChargerLevel || '').trim(),
    level:    (d.ElectrificationLevel || '').trim()
  };
},

async decodeVIN() {
  const vin = ($('vin-in').value || '').trim().toUpperCase();
  const out = $('vin-out');
  if (vin.length !== 17) { out.innerHTML = `<div class="note bad">A VIN is exactly 17 characters. That one is ${vin.length}.</div>`; return; }
  out.innerHTML = `<div class="note">Decoding…</div>`;
  let d;
  try {
    const r = await fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${encodeURIComponent(vin)}?format=json`);
    const j = await r.json();
    d = j.Results && j.Results[0];
    if (!d) throw new Error('empty');
  } catch (e) {
    out.innerHTML = `<div class="note bad"><b>Could not reach the VIN database.</b>
      That service needs a live connection and is not always available offline.
      Use the library tab instead — you will pick the same pack variant either way.</div>`;
    return;
  }
  if (d.ErrorCode && d.ErrorCode !== '0' && !d.Make) {
    out.innerHTML = `<div class="note bad"><b>VIN not recognised.</b> ${h(d.ErrorText || '')}
      Try the library tab.</div>`;
    return;
  }
  const year = d.ModelYear, make = d.Make, model = d.Model;
  const ev = this.readVinEV(d);
  this._vinEV = ev; this._vinFor = vin;

  // Match library entries loosely — same make, and model name overlapping.
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  let cands = L.LIBRARY.filter(v =>
    norm(v.make) === norm(make) &&
    (norm(v.model).includes(norm(model)) || norm(model).includes(norm(v.model).slice(0, 6))));
  // Model year from the VIN is a hard fact — use it to drop non-matching years.
  const yr = parseInt(year, 10);
  if (yr) {
    const byYear = cands.filter(v => v.yearFrom <= yr && v.yearTo >= yr);
    if (byYear.length) cands = byYear;
  }
  // A VIN-reported module count settles the pack variant outright.
  let settled = null;
  if (ev.modules > 0) {
    const m = cands.filter(v => v.modules === ev.modules);
    if (m.length) { cands = m; settled = ev.modules; }
  }

  if (ev.level && !/BEV|Battery Electric/i.test(ev.level)) {
    out.innerHTML = `<div class="note bad"><b>That VIN is not a battery-electric vehicle.</b>
      vPIC reports it as “${h(ev.level)}”. This app models BEV charging only.</div>`;
    return;
  }

  const row = (k, val, from) => `<tr><td style="color:var(--tx3);font-size:12px">${h(k)}</td>
    <td style="font-weight:600">${h(val)}${from ? ` <span class="tag observed">from VIN</span>` : ''}</td></tr>`;

  const identity = [['Year', year], ['Make', make], ['Model', model],
    ['Trim', d.Trim || d.Series || '—'], ['Drive', d.DriveType || '—'],
    ['Plant', d.PlantCity ? `${d.PlantCity}, ${d.PlantCountry}` : '—']]
    .map(([k, val]) => row(k, val || '—', false)).join('');

  // Only show what NHTSA actually returned. Blank means they hold no data.
  const evRows = [
    ev.modules && ['Battery modules per pack', ev.modules],
    ev.cells && ['Cells per module', ev.cells],
    ev.packs && ['Packs per vehicle', ev.packs],
    ev.kWh && ['Battery energy (nominal)', ev.kWh + ' kWh'],
    ev.volts && ['Battery voltage', ev.volts + ' V'],
    ev.amps && ['Battery current', ev.amps + ' A'],
    ev.acKW && ['Onboard charger', ev.acKW + ' kW'],
    ev.chargerLevel && ['Charger level', ev.chargerLevel],
    ev.type && ['Battery type', ev.type],
    ev.driveUnit && ['EV drive unit', ev.driveUnit],
    ev.info && ['Other battery info', ev.info]
  ].filter(Boolean).map(([k, val]) => row(k, val, true)).join('');

  const gotCount = evRows ? evRows.split('<tr>').length - 1 : 0;

  out.innerHTML = `
    <div class="note info"><b>Decoded.</b> vPIC resolved this VIN.</div>
    <table class="ms-table">${identity}</table>
    ${evRows ? `
      <div class="card-h" style="margin-top:18px"><h2>Live battery data from your VIN</h2></div>
      <p class="hint" style="margin:0 0 8px">${gotCount} field${gotCount === 1 ? '' : 's'} came back
        populated. These are manufacturer-filed facts, not estimates, and they override the
        library values when you pick a variant below.</p>
      <table class="ms-table">${evRows}</table>` : ''}
    ${settled ? `<div class="note info" style="margin-top:13px">
        <b>Pack variant settled by the VIN.</b> It reports <b>${settled} modules per pack</b>,
        which identifies the variant outright — no guessing needed.</div>`
      : `<div class="note warn" style="margin-top:13px">
        <b>Confirm the pack variant yourself.</b> NHTSA did not return a module count for this
        VIN — they only publish what each manufacturer files, and many file nothing. Module
        count is the single number that most changes your results, so pick the one you have.</div>`}
    ${cands.length
      ? this.libraryPickerHTML(cands.map(c => c.id)).replace(/UI\.addFromLibrary\('([^']+)'\)/g,
          `UI.addFromLibrary('$1','${h(vin)}',${settled ? 'true' : 'false'})`)
      : `<div class="note bad">No profile in the library matches ${h(make)} ${h(model)} yet.
         Pick the closest vehicle from the library tab and edit its capacity and curve —
         everything on the vehicle screen is editable, and anything your VIN reported is
         listed above so you can enter it.</div>`}`;
},

/* ------------------------------------------------------------------ BOOT */
init() {
  if (this._booted) return;
  this._booted = true;
  // Proof of life: if scripts never ran, this banner stays on screen and tells
  // the user exactly what is wrong instead of leaving them poking a dead page.
  const bf = $('boot-fail'); if (bf) bf.remove();
  /* A RENDER FAILURE MUST NOT COST THE USER THE APP.

     v1.12.1 threw inside a render path reached from init(). The banner below
     fired correctly and said exactly what was wrong -- and the app was still
     dead, because the throw abandoned the render half-finished and nothing
     usable was ever painted. A good error message on a blank screen is still a
     blank screen.

     So: try once normally. If that throws, say so, then try AGAIN in safe mode
     with the saved session reset to defaults. Almost every startup crash of
     this shape is saved state meeting newer code, and a fresh session clears it
     without touching the garage or the observations. Only if the second attempt
     also fails is the app genuinely unusable -- and even then the reset control
     stays on screen. */
  const report = (e, mode) => {
    const m = document.querySelector('main');
    if (!m) return;
    m.insertAdjacentHTML('afterbegin',
      `<div class="note bad"><b>The app hit an error while starting${mode ? ' (' + mode + ')' : ''}.</b><br>
       <code style="font-size:11.5px;word-break:break-word">${h(e && e.stack || e)}</code><br><br>
       <button class="btn sm" onclick="UI.hardReset()">Reset saved data and reload</button>
       <br><span class="s">Your garage and saved rates are stored separately and survive a session reset.</span></div>`);
  };

  try {
    load();
    this.go(S.tab || 'plan');
    this.renderAll();
    return;
  } catch (e) {
    if (typeof console !== 'undefined') console.error('startup failed, retrying in safe mode', e);
    report(e, null);
  }

  try {
    S.session = DEFAULT_SESSION();
    S.finder = { open:false, q:'', live:[], busy:false, error:null };
    this.go('plan');
    this.renderAll();
    const m = document.querySelector('main');
    if (m) m.insertAdjacentHTML('afterbegin',
      `<div class="note warn"><b>Started in safe mode.</b> Your saved session could not
       be restored, so it was reset to defaults. Your vehicles and saved rates are
       untouched. Set your charger and dwell time again and it will work normally.</div>`);
  } catch (e2) {
    if (typeof console !== 'undefined') console.error('safe mode also failed', e2);
    report(e2, 'safe mode');
  }
},

/* Last resort, offered by the startup banner. Clears the stored blob only --
   nothing here reaches observations/, which lives in the repo, not the phone. */
hardReset() {
  try { localStorage.removeItem(KEY); } catch (e) {}
  location.reload();
}
};

window.UI = UI;
document.addEventListener('DOMContentLoaded', () => UI.init());
if (document.readyState !== 'loading') UI.init();

