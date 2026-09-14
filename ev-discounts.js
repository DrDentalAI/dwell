/**
 * ev-discounts.js
 *
 * Effective-rate resolution for public charging.
 * Pure JavaScript. Zero dependencies. No DOM.
 *
 * Companion to ev-core.js. Where ev-core resolves POWER by taking the lowest
 * ceiling among vehicle / station / adapter and naming the binding one, this
 * module resolves PRICE the same way: it finds every discount the driver is
 * eligible for, applies the single best one, and names it. Discounts do not
 * stack -- see STACKING below.
 *
 * PROVENANCE -- ONE VOCABULARY, SHARED WITH ev-pricing.js
 *   This module used to speak published/reported/unverified while pricing spoke
 *   published/secondary/estimated/unavailable/user. Two scales in one UI is two
 *   things the reader has to learn, and they would sit next to each other on the
 *   same screen. `reported` is what pricing calls `secondary` -- a credible
 *   source that is not the operator -- so it is now stored as `secondary`, and
 *   normalizeConfidence() keeps the old spelling working for any data not yet
 *   migrated.
 *
 *   confidence:
 *     'published'  - read from the operator's own terms or pricing page
 *     'secondary'  - credible source that is not the operator
 *     'estimated'  - derived or averaged, not published anywhere
 *     'unavailable'- the operator publishes nothing
 *     'user'       - supplied by the driver; always wins
 *   Anything not 'published' or 'secondary' is NEVER auto-applied: it is
 *   returned in `excluded[]` with a reason. Same rule as 'observed' charging
 *   curves -- the label has to mean something or it means nothing.
 *
 * STACKING
 *   Research across ~30 US and Canadian networks found no operator that
 *   permits combining a promo code with a membership or partner discount.
 *   `applyBest()` therefore selects exactly one. If that ever changes for a
 *   specific network, add `stacksWith: [id, ...]` to the entry rather than
 *   relaxing the default.
 *
 * USER OVERRIDE
 *   A caller-supplied rate always wins over stored data, and the result says
 *   so via `rateSource`. Same precedence rule as measured-rate override.
 *
 * Data compiled 2026-09-02.
 */

'use strict';

/* Same UMD wrapper as ev-pricing.js. Without it the bare top-level `var
   NETWORKS` and `var DISCOUNTS` in this file would land on `window` when the
   build inlines every module into one <script>, and NETWORKS is a name
   ev-pricing.js also uses. Two different NETWORKS objects fighting over one
   global is the kind of bug that shows up as a wrong price, not an error. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EVDiscounts = factory();
}(typeof self !== 'undefined' ? self : this, function () {


/* Shared with ev-pricing.js. Kept in this order: strongest first. */
var CONFIDENCE = ['published', 'secondary', 'estimated', 'unavailable', 'user'];

/* Legacy spellings, so old data and old callers keep working. */
var CONFIDENCE_ALIASES = { reported: 'secondary', unverified: 'estimated' };

function normalizeConfidence(c) {
  if (!c) return 'estimated';
  return CONFIDENCE_ALIASES[c] || c;
}

/* Only a label backed by a real source may be applied without the driver
   asking for it. Everything else is shown and explained, never used. */
/* ---- DATA FRESHNESS -------------------------------------------------
   Discount terms churn. The original research claimed "a few times a year";
   its own calendar listed six dated changes inside eight months. 90 days
   matches ev-pricing.js's STALE_DAYS so the app shows ONE staleness rule, not
   two. Duplicated rather than imported because this module is deliberately
   zero-dependency -- if you change one, change the other.               */
var STALE_DAYS = 90;

function ageDays(lastVerified, today) {
  if (!lastVerified) return null;
  var then = Date.parse(asDayString(lastVerified) + 'T00:00:00Z');
  var now = Date.parse(asDayString(today) + 'T00:00:00Z');
  if (isNaN(then) || isNaN(now)) return null;
  return Math.round((now - then) / 86400000);
}

function isStale(lastVerified, today) {
  var a = ageDays(lastVerified, today);
  return a === null ? true : a > STALE_DAYS;
}

function isAutoApplicable(c) {
  var n = normalizeConfidence(c);
  return n === 'published' || n === 'secondary' || n === 'user';
}

/* ------------------------------------------------------------------ *
 * Networks: IDENTITY AND ELIGIBILITY. NOT PRICES.
 *
 * `pricingId` binds each entry to ev-pricing.js, the sole rate authority.
 * Where a binding exists there is NO rackRate here. Pricing already carries a
 * sourced, dated, region-aware, time-of-use-aware rate for that network, and a
 * second number in this file could only ever disagree with it. IONNA was the
 * proof: $0.48 here against $0.39 published in pricing, a 23% error sitting in
 * a table nobody read.
 *
 * A rackRate survives ONLY where pricing models no such network. It is a crude
 * national average, it leaves this module tagged `rateSource:
 * 'estimated-national'`, and the UI must show that tag. The danger is never a
 * number that is obviously wrong -- it is a number that is wrong and looks
 * exactly like a number that is right.
 *
 * NO FEES LIVE HERE either. Session fees, idle fees, taxes and plan waivers
 * belong to ev-pricing.js, which scopes them per plan: EVgo's $0.99 is
 * pay-as-you-go only and is waived on Plus and PlusMax, which is what the
 * settled 12 Aug receipt shows. A flat per-network fee field cannot express
 * that, so it was removed rather than corrected. Do not re-add one.
 * ------------------------------------------------------------------ */
var NETWORKS = {
  evgo:        { name: 'EVgo',                  regions: ['US'],
                 pricingId: 'evgo', rateBasis: 'kWh',
                 source: 'evgo.com/pricing', lastVerified: '2026-09-02', confidence: 'published' },
  ea:          { name: 'Electrify America',     regions: ['US'],
                 pricingId: 'electrify-america', rateBasis: 'kWh',
                 source: 'electrifyamerica.com/pricing', lastVerified: '2026-09-02', confidence: 'published' },
  tesla:       { name: 'Tesla Supercharger',    regions: ['US', 'CA'],
                 pricingId: { US: 'tesla-us', CA: 'tesla-ca' }, rateBasis: 'kWh',
                 note: 'Dynamic time-of-use. Ontario off-peak observed near C$0.29.',
                 source: 'tesla.com/support/charging', lastVerified: '2026-09-02', confidence: 'published' },
  ionna:       { name: 'IONNA',                 regions: ['US'],
                 pricingId: 'ionna', rateBasis: 'kWh',
                 source: 'ionna.com/faqs', lastVerified: '2026-09-02', confidence: 'published' },
  mbhpc:       { name: 'Mercedes-Benz HPC',     regions: ['US', 'CA'],
                 pricingId: 'mercedes-hpc', rateBasis: 'kWh',
                 source: 'mercedesbenzhpc.com', lastVerified: '2026-09-02', confidence: 'secondary' },
  chargepoint: { name: 'ChargePoint',           regions: ['US', 'CA'],
                 pricingId: { US: 'chargepoint-us', CA: 'chargepoint-ca' }, rateBasis: 'host',
                 note: 'ChargePoint only processes payment. Each site host sets price. No network rate exists.',
                 source: 'chargepoint.com/drivers/support/faqs', lastVerified: '2026-09-02', confidence: 'published' },
  evconnect:   { name: 'EV Connect',            regions: ['US', 'CA'],
                 /* pricing models the whole host-priced class as one entry, and
                    names EV Connect inside it. */
                 pricingId: 'us-host-priced', rateBasis: 'host',
                 source: 'evconnect.com/drivers', lastVerified: '2026-09-02', confidence: 'published' },
  blink:       { name: 'Blink',                 regions: ['US'],
                 pricingId: 'blink', rateBasis: 'kWh',
                 source: 'blinkcharging.com/charge/driver-faq', lastVerified: '2026-09-02', confidence: 'published' },
  rede:        { name: 'Red E',                 regions: ['US', 'CA'],
                 pricingId: 'red-e', rateBasis: 'host',
                 note: 'No membership, referral or promo program published. Strong metro-Detroit presence.',
                 source: 'redecharge.com', lastVerified: '2026-09-02', confidence: 'secondary' },
  ivy:         { name: 'Ivy Charging',          regions: ['CA'],
                 pricingId: 'ivy', rateBasis: 'kWh',
                 note: 'Flat, tax-inclusive. Operates ONroute and Canadian Tire sites.',
                 source: 'ivycharge.com/support', lastVerified: '2026-09-02', confidence: 'published' },
  ecanada:     { name: 'Electrify Canada',      regions: ['CA'],
                 pricingId: 'electrify-canada', rateBasis: 'kWh',
                 note: 'Separate corporation from Electrify America. Separate account.',
                 source: 'electrify-canada.ca/pricing', lastVerified: '2026-09-02', confidence: 'published' },
  petro:       { name: 'Petro-Canada',          regions: ['CA'],
                 pricingId: 'petro-canada', rateBasis: 'minute',
                 note: 'Billed per MINUTE, not per kWh. Penalizes vehicles that taper early.',
                 source: 'petro-canada.ca/en/personal/fuel/canadas-electric-highway', lastVerified: '2026-09-02', confidence: 'published' },

  /* The ONLY surviving rackRate. Journie is a Parkland loyalty program run over
     On the Run sites; ev-pricing.js models no such network, so there is nothing
     to bind to and no authoritative rate to defer to. C$0.60 is a national
     average and is tagged as one every time it leaves this module. */
  journie:     { name: 'On the Run / Journie',  regions: ['CA'],
                 rackRate: { CA: 0.60 }, rateBasis: 'kWh',
                 rackRateNote: 'Estimated national average. Not a quote for any station.',
                 source: 'journie.ca/on-the-run-ca/on-en/ev-charging', lastVerified: '2026-09-02', confidence: 'secondary' },

  greenp:      { name: 'Green P Toronto',       regions: ['CA'],
                 pricingId: 'green-p', rateBasis: 'hour',
                 note: 'Billed per HOUR: C$15/hr at 50 kW, C$20/hr at 100 kW, plus parking.',
                 source: 'parking.greenp.com/ev-charging', lastVerified: '2026-09-02', confidence: 'published' }
};

/* Reverse of pricingIdFor: given an ev-pricing.js network id, which entry in
   THIS file describes it? The two id spaces were written years apart and do not
   match -- pricing says 'electrify-america', this file says 'ea'. Binding them
   by hand once is the whole integration. */
function networkIdForPricingId(pid, region) {
  if (!pid) return null;
  var keys = Object.keys(NETWORKS), i;
  for (i = 0; i < keys.length; i++) {
    if (pricingIdFor(NETWORKS[keys[i]], region) === pid) return keys[i];
  }
  return null;
}

/* Resolve a network's ev-pricing.js id for a region. Returns null for a network
   pricing does not model, which is the ONLY case where a rackRate applies. */
function pricingIdFor(net, region) {
  if (!net || !net.pricingId) return null;
  if (typeof net.pricingId === 'string') return net.pricingId;
  return net.pricingId[region || 'US'] || null;
}

/* ------------------------------------------------------------------ *
 * Discounts.
 *   kind: 'percent'      - proportional reduction, `value` in [0,1]
 *         'rateOverride' - replaces the rate outright, `value` in currency/kWh
 *         'credit'       - flat currency credit, does not change the rate
 *   requires: all listed conditions must hold.
 *   monthlyFee: amortized against usage to produce a breakeven.
 * ------------------------------------------------------------------ */
var DISCOUNTS = [

  /* --- rideshare: the largest discounts in the market, and free --- */
  { id: 'evgo-uber', network: 'evgo', region: 'US', kind: 'percent',
    label: 'EVgo x Uber Pro',
    value: 0.25, tierValues: { gold: 0.45, platinum: 0.45, diamond: 0.45 },
    monthlyFee: 0, waivesSessionFee: true,
    requires: { gig: ['uber'] },
    note: 'Ceiling, not a rate. EVgo benchmarks on a 30 kWh session; savings vary by time and site.',
    enroll: 'uber.enroll.evgo.com',
    source: 'evgo.com/uber', lastVerified: '2026-09-02', confidence: 'published' },

  { id: 'evgo-lyft', network: 'evgo', region: 'US', kind: 'percent',
    label: 'EVgo x Lyft Rewards',
    value: 0.25, tierValues: { gold: 0.45, platinum: 0.45, elite: 0.45 },
    monthlyFee: 0, waivesSessionFee: true,
    requires: { gig: ['lyft'] },
    enroll: 'lyft.com/electrify/evgo-enroll',
    source: 'evgo.com/lyft', lastVerified: '2026-09-02', confidence: 'published' },

  { id: 'ea-lyft', network: 'ea', region: 'US', kind: 'percent',
    label: 'Electrify America x Lyft',
    value: 0.23, tierValues: { gold: 0.29, platinum: 0.29, elite: 0.29 },
    monthlyFee: 0,
    requires: { gig: ['lyft'] },
    expires: '2028-03-31',
    note: 'VIN must be on file. Enrollment code issued in the Lyft Driver app, entered in the EA app.',
    source: 'electrifyamerica.com/lyft-gold-and-platinum-discount-plan-disclosure',
    lastVerified: '2026-09-02', confidence: 'published' },

  /* --- OEM: vehicle-keyed, so they join the existing vehicle library --- */
  { id: 'gm-energypass-ionna', network: 'ionna', region: 'US', kind: 'percent',
    label: 'GM Energy Pass',
    value: 0.10, monthlyFee: 0,
    requires: { make: ['GMC', 'Chevrolet', 'Cadillac', 'Buick'] },
    note: 'Free enrollment in myGMC/myChevrolet/myCadillac. Session must be started in the app or by Plug & Charge; paying with a card at the charger forfeits the discount.',
    caveat: 'Model-year eligibility is not published. Unconfirmed for MY2025.',
    source: 'gmenergy.gm.com/energypass', lastVerified: '2026-09-02', confidence: 'published' },

  { id: 'bmw-ionna', network: 'ionna', region: 'US', kind: 'percent',
    label: 'IONNA - BMW & MINI',
    value: 0.20, monthlyFee: 0,
    requires: { make: ['BMW', 'MINI'] },
    expires: '2026-09-30',
    note: 'My BMW app or Plug & Charge only. Paying with a card at the charger ' +
          'forfeits the discount.',
    /* Re-checked 14 Sep 2026: IONNA's FAQ still reads "through September 30,
       2026" and BMW has announced no extension. 16 days left. If it lapses the
       entry expires itself and BMW drivers correctly drop to the rack rate --
       there is no standing BMW discount underneath this one, unlike Hyundai. */
    source: 'ionna.com/faqs', lastVerified: '2026-09-14', confidence: 'published' },

  /* HYUNDAI / GENESIS -- SPLIT INTO TWO ENTRIES, DELIBERATELY.
     This was one 20% entry expiring 2026-09-30. That is two different offers
     welded together: a 10% base discount that began 19 Aug 2026 and has NO end
     date, and a 10% bonus that does expire. Welded, the whole thing vanished on
     1 Oct and eligible drivers would have been told they get nothing when they
     still get 10% -- silent under-reporting, in the direction that costs the
     driver money.

     Kia was also listed and is NOT eligible. Hyundai's own release names
     "Hyundai and Genesis EV owners"; Kia appears on IONNA's site only under
     Plug & Charge capability, which is not this discount. Removed.

     Both entries are live right now, so resolveRate() sorts by value and picks
     the 20% -- correct today. After 30 Sept the bonus expires itself and the
     base 10% is all that remains -- correct then. No stacking logic needed. */
  { id: 'hyundai-genesis-ionna', network: 'ionna', region: 'US', kind: 'percent',
    label: 'IONNA - Hyundai & Genesis',
    value: 0.10, monthlyFee: 0,
    requires: { make: ['Hyundai', 'Genesis'], models: [
      /* Model strings match ev-library.js exactly; the matcher strips
         punctuation and case, so 'Ioniq 5' and 'IONIQ 5' both hit. */
      { model: 'Ioniq 5',          from: 2022 },
      { model: 'Ioniq 5 N',        from: 2025 },
      { model: 'Ioniq 9',          from: 2026 },
      { model: 'Ioniq 6',          from: 2023, to: 2025, appOnly: true },
      { model: 'Kona Electric',    from: 2025, appOnly: true },
      { model: 'GV60',             from: 2026 },
      { model: 'Electrified GV70', from: 2026 }
      /* Electrified G80 is deliberately absent -- it is in our library and is
         NOT on Hyundai's eligible list. That omission is the whole point of
         this matcher. */
    ] },
    starts: '2026-08-19',
    note: 'In-App Charging or Plug & Charge only. Paying at the charger forfeits it.',
    caveat: 'Eligibility is model- and year-specific; see requires.models.',
    source: 'prnewswire.com/news-releases/hyundai-us-ev-owners-to-receive-automatic-10-discount-at-all-ionna-fastcharging-stations-via-app-and-plug--charge-302856716.html',
    lastVerified: '2026-09-14', confidence: 'published' },

  { id: 'hyundai-genesis-ionna-bonus', network: 'ionna', region: 'US', kind: 'percent',
    label: 'IONNA - Hyundai & Genesis (launch bonus)',
    value: 0.20, monthlyFee: 0,
    requires: { make: ['Hyundai', 'Genesis'], models: [
      /* Model strings match ev-library.js exactly; the matcher strips
         punctuation and case, so 'Ioniq 5' and 'IONIQ 5' both hit. */
      { model: 'Ioniq 5',          from: 2022 },
      { model: 'Ioniq 5 N',        from: 2025 },
      { model: 'Ioniq 9',          from: 2026 },
      { model: 'Ioniq 6',          from: 2023, to: 2025, appOnly: true },
      { model: 'Kona Electric',    from: 2025, appOnly: true },
      { model: 'GV60',             from: 2026 },
      { model: 'Electrified GV70', from: 2026 }
      /* Electrified G80 is deliberately absent -- it is in our library and is
         NOT on Hyundai's eligible list. That omission is the whole point of
         this matcher. */
    ] },
    starts: '2026-08-19', expires: '2026-09-30',
    note: 'Launch bonus: the standing 10% plus a further 10%, through 30 Sept 2026. ' +
          'Hyundai and IONNA both stack these two, so 20% is the real number today.',
    caveat: 'Same model eligibility as the standing 10%.',
    source: 'prnewswire.com/news-releases/hyundai-us-ev-owners-to-receive-automatic-10-discount-at-all-ionna-fastcharging-stations-via-app-and-plug--charge-302856716.html',
    lastVerified: '2026-09-14', confidence: 'published' },

  { id: 'mercedes-ionna', network: 'ionna', region: 'US', kind: 'percent',
    label: 'IONNA - Mercedes-Benz',
    value: 0.10, monthlyFee: 0,
    requires: { make: ['Mercedes-Benz'] },
    note: 'In-App Charging, Plug & Charge, or the MBUX centre display. Automatic, ' +
          'no enrollment, no end date published.',
    /* Re-checked 14 Sep 2026: still a standing 10%, no expiry. The Labor Day
       promotion (4-7 Sept 2026) that stacked Mercedes drivers down to
       $0.16/kWh has CONCLUDED and is deliberately not recorded here -- it was a
       flat PRICE, not a percentage, so it belonged to ev-pricing.js as a dated
       tariff window, not to this file. Expired promos are not carried. */
    source: 'ionna.com/faqs', lastVerified: '2026-09-14', confidence: 'published' },

  /* --- paid subscriptions: net of fee, so they can lose to free options --- */
  { id: 'evgo-plusmax', network: 'evgo', region: 'US', kind: 'percent',
    label: 'EVgo PlusMax', value: 0.30, monthlyFee: 12.99, waivesSessionFee: true,
    requires: { membership: ['evgo-plusmax'] },
    source: 'helpcenter.evgo.com', lastVerified: '2026-09-02', confidence: 'published' },

  { id: 'evgo-plus', network: 'evgo', region: 'US', kind: 'percent',
    label: 'EVgo Plus', value: 0.15, monthlyFee: 6.99, waivesSessionFee: true,
    requires: { membership: ['evgo-plus'] },
    source: 'helpcenter.evgo.com', lastVerified: '2026-09-02', confidence: 'published' },

  { id: 'ea-passplus', network: 'ea', region: 'US', kind: 'percent',
    label: 'Electrify America Pass+', value: 0.25, monthlyFee: 7.00,
    requires: { membership: ['ea-passplus'] },
    source: 'electrifyamerica.com/pricing', lastVerified: '2026-09-02', confidence: 'published' },

  { id: 'tesla-membership-us', network: 'tesla', region: 'US', kind: 'percent',
    label: 'Non-Tesla Supercharging Membership', value: 0.28, monthlyFee: 12.99,
    requires: { membership: ['tesla-membership'] },
    note: 'Removes the guest surcharge. Tesla describes it as ~40%; independent measurement puts it at 30-35%, so 28% is used here as the conservative figure.',
    caveat: 'Tesla applies the discount "when using the Tesla app." Whether it survives a session started from myGMC or GM Energy Pass is unconfirmed and is worth roughly 0.16-0.19/kWh.',
    source: 'tesla.com/support/non-tesla-supercharging', lastVerified: '2026-09-02', confidence: 'published' },

  { id: 'tesla-membership-ca', network: 'tesla', region: 'CA', kind: 'percent',
    label: 'Supercharging Membership (Canada)', value: 0.28, monthlyFee: 16.99,
    requires: { membership: ['tesla-membership'] },
    caveat: 'C$16.99 is the launch price. The 2026 figure has not been reconfirmed.',
    source: 'tesla.com/en_ca/support/charging/supercharging', lastVerified: '2026-09-02', confidence: 'secondary' },

  { id: 'ecanada-passplus', network: 'ecanada', region: 'CA', kind: 'percent',
    label: 'Electrify Canada Pass+', value: 0.20, monthlyFee: 7.00,
    requires: { membership: ['ecanada-passplus'] },
    source: 'electrify-canada.ca/pricing', lastVerified: '2026-09-02', confidence: 'published' },

  /* --- Canadian loyalty and card-linked --- */
  { id: 'journie-redeem', network: 'journie', region: 'CA', kind: 'rateOverride',
    label: 'Journie Rewards redemption', value: 0.40, maxKwh: 50,
    monthlyFee: 0,
    requires: { membership: ['journie'] },
    note: '300 points redeems for C$0.20/kWh off up to 50 kWh. Earns 3 points/kWh, so roughly one redemption per 100 kWh charged.',
    source: 'journie.ca', lastVerified: '2026-09-02', confidence: 'secondary' },

  { id: 'rbc-petro', network: 'petro', region: 'CA', kind: 'credit',
    label: 'RBC x Petro-Canada charging credit', value: 100, monthlyFee: 0,
    requires: { card: ['rbc'] },
    caveat: 'Recurring offer for eligible RBC Rewards cardholders. Current terms and expiry not confirmed.',
    source: 'rbcroyalbank.com/petro-canada', lastVerified: '2026-09-02', confidence: 'estimated' }
];

/* ------------------------------------------------------------------ *
 * Eligibility
 * ------------------------------------------------------------------ */

function normList(v) {
  if (v === null || v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

function lower(a) {
  var out = [], i;
  for (i = 0; i < a.length; i++) out.push(String(a[i]).toLowerCase());
  return out;
}

/**
 * @param {object} d       a discount entry
 * @param {object} profile { make, region, memberships[], gig:{platform,tier}, cards[] }
 * @param {string} today   ISO date, defaults to now
 * @returns {{ok:boolean, reason?:string}}
 */
/* Dates in this file are ISO day strings and are compared as strings. A Date
   object compared against '2026-09-30' stringifies to "Wed Sep 30 2026 ..." and
   every comparison silently goes the wrong way -- an expired discount comes back
   eligible. That is a wrong ANSWER, not an error, so nothing would have caught
   it. Coerce here so no caller can get it wrong. */
function asDayString(v) {
  if (!v) return new Date().toISOString().slice(0, 10);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

/* Model-year eligibility. IONNA's Hyundai/Genesis discount is not brand-wide:
   it names models and, for several, a first eligible year. Matching on make
   alone tells a Genesis G80 Electrified owner they get 20% off when they get
   nothing. An entry with no `models` list stays brand-wide, as before. */
function modelEligible(req, profile) {
  if (!req.models) return { ok: true };
  if (!profile.model) return { ok: false, reason: 'vehicle model not set' };
  var want = String(profile.model).toLowerCase().replace(/[^a-z0-9]/g, '');
  var year = profile.modelYear != null ? Number(profile.modelYear) : null;
  for (var i = 0; i < req.models.length; i++) {
    var m = req.models[i];
    var key = String(m.model).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (key !== want) continue;
    if (m.from != null && (year == null || year < m.from)) {
      return { ok: false, reason: m.model + ' qualifies from ' + m.from +
               (year == null ? ' -- set your model year' : ', yours is ' + year) };
    }
    if (m.to != null && year != null && year > m.to) {
      return { ok: false, reason: m.model + ' qualifies through ' + m.to + ' only' };
    }
    return { ok: true, via: m.appOnly ? 'in-app charging only' : null };
  }
  return { ok: false, reason: 'this model is not on the eligible list' };
}

function isEligible(d, profile, today) {
  var now = asDayString(today);
  var req = d.requires || {};
  var i;

  if (d.region && profile.region && d.region !== profile.region) {
    return { ok: false, reason: 'not available in ' + profile.region };
  }
  if (d.expires && d.expires < now) {
    return { ok: false, reason: 'expired ' + d.expires };
  }
  if (d.starts && d.starts > now) {
    return { ok: false, reason: 'starts ' + d.starts };
  }
  if (req.make) {
    if (!profile.make) return { ok: false, reason: 'vehicle make not set' };
    if (lower(req.make).indexOf(String(profile.make).toLowerCase()) === -1) {
      return { ok: false, reason: 'requires ' + req.make.join(' / ') };
    }
  }
  var mv = modelEligible(req, profile);
  if (!mv.ok) return { ok: false, reason: mv.reason };
  if (req.gig) {
    var plat = profile.gig && profile.gig.platform;
    if (!plat) return { ok: false, reason: 'requires a rideshare enrollment' };
    var plats = lower(normList(plat));
    var match = false;
    for (i = 0; i < req.gig.length; i++) {
      if (plats.indexOf(req.gig[i]) !== -1) match = true;
    }
    if (!match) return { ok: false, reason: 'requires ' + req.gig.join(' or ') };
  }
  if (req.membership) {
    var held = lower(normList(profile.memberships));
    var hasIt = false;
    for (i = 0; i < req.membership.length; i++) {
      if (held.indexOf(req.membership[i]) !== -1) hasIt = true;
    }
    if (!hasIt) return { ok: false, reason: 'requires the ' + d.label + ' plan' };
  }
  if (req.card) {
    var cards = lower(normList(profile.cards));
    var hasCard = false;
    for (i = 0; i < req.card.length; i++) {
      if (cards.indexOf(req.card[i]) !== -1) hasCard = true;
    }
    if (!hasCard) return { ok: false, reason: 'requires a ' + req.card.join('/') + ' card' };
  }
  return { ok: true };
}

/** Percentage actually earned, accounting for rideshare tier. */
function effectivePercent(d, profile) {
  if (d.kind !== 'percent') return 0;
  var tier = profile.gig && profile.gig.tier;
  if (tier && d.tierValues && d.tierValues[String(tier).toLowerCase()] !== undefined) {
    return d.tierValues[String(tier).toLowerCase()];
  }
  return d.value;
}

/* ------------------------------------------------------------------ *
 * Rate resolution
 * ------------------------------------------------------------------ */

/**
 * Resolve the price the driver actually pays.
 *
 * @param {object} opts
 *   network       {string}  network id
 *   profile       {object}  { make, region, memberships[], gig, cards[] }
 *   kwh           {number}  energy for this session, used to amortize fees
 *   monthlyKwh    {number}  optional, for a fairer subscription comparison
 *   rateOverride  {number}  user-entered rate, always wins
 *   today         {string}  ISO date
 *
 * @returns {object}
 *   rackRate       base rate before discounts, or null when host-set
 *   rateSource     'user' | 'network-average' | 'unavailable'
 *   effectiveRate  what they pay per kWh after the applied discount and fees
 *   applied        the winning discount, or null
 *   eligible[]     every discount that qualified, best first
 *   excluded[]     what did not qualify and why
 *   savings        currency saved on this session
 *   notes[]        caveats worth showing in the UI
 */
function resolveRate(opts) {
  var profile = opts.profile || {};
  var region = profile.region || 'US';
  var net = NETWORKS[opts.network];
  var monthlyKwh = typeof opts.monthlyKwh === 'number' ? opts.monthlyKwh : 0;
  var notes = [];
  var eligible = [];
  var excluded = [];
  var i, d, verdict;

  if (!net) {
    return { network: null, discountPercent: 0, effectiveRate: 0,
             baseRate: null, rateSource: 'unavailable', discountedRate: null,
             applied: null, eligible: [], excluded: [],
             notes: ['Unknown network: ' + opts.network] };
  }

  /* ---- WHERE THE RATE COMES FROM -------------------------------------
     Precedence: the driver's own override, then whatever ev-pricing.js
     resolved and handed in as `baseRate`, then -- only for a network pricing
     does not model at all -- this file's crude national average.

     This module does NOT look a rate up. It is handed one. That is the sole-
     rate-authority rule in one sentence: pricing knows about regions, time-of-
     use windows, power bands, plans, fees and tax; this file knows who
     qualifies for what percentage. Mixing the two is how a number ends up
     4.5% wrong and believed.                                              */
  var baseRate = null, rateSource, rateNote = null;
  if (typeof opts.rateOverride === 'number') {
    baseRate = opts.rateOverride;
    rateSource = 'user';
  } else if (typeof opts.baseRate === 'number') {
    baseRate = opts.baseRate;
    rateSource = 'pricing';
  } else if (net.rackRate && typeof net.rackRate[region] === 'number') {
    baseRate = net.rackRate[region];
    rateSource = 'estimated-national';
    rateNote = net.rackRateNote ||
      'Estimated national average. Not a quote for this station.';
    notes.push(net.name + ': ' + rateNote);
  } else {
    rateSource = 'unavailable';
    notes.push(net.note || (net.name + ' pricing is set per site. ' +
      'Enter the rate from the charger and the discount applies to that.'));
  }
  if (net.rateBasis && net.rateBasis !== 'kWh' && rateSource !== 'user') {
    notes.push(net.name + ' bills per ' + net.rateBasis +
               ', not per kWh. Cost will not scale with energy.');
  }

  for (i = 0; i < DISCOUNTS.length; i++) {
    d = DISCOUNTS[i];
    if (d.network !== opts.network) continue;

    if (!isAutoApplicable(d.confidence)) {
      excluded.push({ id: d.id, label: d.label,
                      reason: normalizeConfidence(d.confidence) +
                              ' - shown, never applied automatically',
                      confidence: normalizeConfidence(d.confidence),
                      caveat: d.caveat || null });
      continue;
    }
    verdict = isEligible(d, profile, opts.today);
    if (!verdict.ok) {
      excluded.push({ id: d.id, label: d.label, reason: verdict.reason,
                      confidence: normalizeConfidence(d.confidence) });
      continue;
    }

    var pct = effectivePercent(d, profile);
    /* A monthly fee can only be turned into a per-kWh figure if a rate and a
       monthly volume are both known. Where they are not, rank on the headline
       percentage and SAY that the fee was not counted, rather than quietly
       ranking a paid plan as though it were free. */
    var feePerKwh = (monthlyKwh > 0 && baseRate !== null)
      ? (d.monthlyFee || 0) / monthlyKwh : null;
    var grossPerKwh = baseRate === null ? null : baseRate * pct;
    var netPerKwh = (grossPerKwh === null || feePerKwh === null)
      ? null : grossPerKwh - feePerKwh;

    eligible.push({
      id: d.id,
      label: d.label,
      kind: d.kind,
      percent: pct,
      monthlyFee: d.monthlyFee || 0,
      feePerKwh: feePerKwh,
      valuePerKwh: netPerKwh,
      feeCounted: feePerKwh !== null,
      breakevenKwh: (d.monthlyFee && grossPerKwh) ? (d.monthlyFee / grossPerKwh) : 0,
      expires: d.expires || null,
      note: d.note || null,
      caveat: d.caveat || null,
      confidence: normalizeConfidence(d.confidence),
      source: d.source,
      lastVerified: d.lastVerified,
      ageDays: ageDays(d.lastVerified, opts.today),
      stale: isStale(d.lastVerified, opts.today)
    });
  }

  /* Rank by real per-kWh value where the fee could be amortized, otherwise by
     headline percentage. Sorting on a mix of the two would be meaningless. */
  var canRankByValue = eligible.length > 0 &&
                       eligible.every(function (e) { return e.valuePerKwh !== null; });
  eligible.sort(canRankByValue
    ? function (a, b) { return b.valuePerKwh - a.valuePerKwh; }
    : function (a, b) { return b.percent - a.percent; });
  if (!canRankByValue && eligible.some(function (e) { return e.monthlyFee > 0; })) {
    notes.push('Ranked by headline discount. A paid plan cannot be compared ' +
               'against a free one without a rate and your monthly kWh.');
  }

  var applied = null;
  for (i = 0; i < eligible.length; i++) {
    if (eligible[i].percent > 0 &&
        (eligible[i].valuePerKwh === null || eligible[i].valuePerKwh > 0)) {
      applied = eligible[i]; break;
    }
  }

  /* ---- THE DELIVERABLE ------------------------------------------------
     A PERCENTAGE, not a price. `effectiveRate` used to hold a dollars-per-kWh
     figure computed from this file's own $0.48 national average. Measured
     against the settled 12 Aug receipt it came out at $30.05 where theanswer
     was $28.76 -- and it was wrong three separate ways that partly cancelled:
     wrong base rate, no time-of-use, no tax. +4.5%. Close enough to be
     believed, which is what made it dangerous. It is gone. This module now
     returns the discount and lets pricing do the arithmetic.             */
  var discountPercent = applied ? applied.percent : 0;

  if (applied) {
    for (i = 0; i < eligible.length; i++) {
      var paid = eligible[i];
      if (paid.monthlyFee <= 0) continue;
      if (paid.valuePerKwh !== null && applied.valuePerKwh !== null &&
          paid.valuePerKwh > applied.valuePerKwh) continue;
      if (paid.id === applied.id) continue;
      notes.push('You are paying $' + paid.monthlyFee.toFixed(2) + '/mo for ' +
                 paid.label + ', but ' + applied.label +
                 ' is free and at least as good here. Cancelling ' + paid.label +
                 ' would save $' + (paid.monthlyFee * 12).toFixed(0) + '/yr.');
      break;
    }
    if (applied.caveat) notes.push(applied.caveat);
    if (applied.note) notes.push(applied.note);
    if (applied.stale) {
      notes.push(applied.label + ' was last verified ' + applied.ageDays +
                 ' days ago. Discount terms change faster than that -- ' +
                 'check before you rely on it.');
    }
  }
  if (eligible.length > 1) {
    notes.push('Showing the best offer you qualify for' +
               (applied ? ': ' + applied.label : '') +
               '. Discounts are not additive unless an entry says so.');
  }

  return {
    network: net.name,
    pricingId: pricingIdFor(net, region),

    /* THE deliverable. 0.30 means 30% off whatever pricing resolved. */
    discountPercent: discountPercent,
    /* Same number. Named `effectiveRate` for callers that predate the change;
       it is a FRACTION, never a price. */
    effectiveRate: discountPercent,

    /* Context only. `discountedRate` is arithmetic on a rate someone else
       resolved -- it is never a billable total: no fees, no idle, no tax. Use
       ev-pricing.js sessionCost() for anything a driver will actually pay. */
    baseRate: baseRate,
    rateSource: rateSource,
    rateNote: rateNote,
    rateBasis: net.rateBasis || null,
    discountedRate: baseRate === null ? null : baseRate * (1 - discountPercent),

    applied: applied,
    eligible: eligible,
    excluded: excluded,
    notes: notes
  };
}

/**
 * Every discount the driver qualifies for anywhere, ranked by annual value.
 * Drives a "what are you leaving on the table" view.
 */
function auditProfile(profile, monthlyKwh, today, rates) {
  var out = [], i, d, verdict, pct, annual;
  var mk = monthlyKwh || 0;
  var region = profile.region || 'US';
  rates = rates || {};

  for (i = 0; i < DISCOUNTS.length; i++) {
    d = DISCOUNTS[i];
    verdict = isEligible(d, profile, today);
    if (!verdict.ok || !isAutoApplicable(d.confidence)) continue;

    var net = NETWORKS[d.network];
    if (!net) continue;

    /* Rates come from ev-pricing.js, handed in keyed by THIS file's network id.
       Falling back to a rackRate is only possible for a network pricing does
       not model; everywhere else a missing rate means the caller did not supply
       one, and inventing a number to rank by would be exactly the invisible
       cliff this module was cleaned up to remove. */
    var rate = null, rateSource = null;
    if (typeof rates[d.network] === 'number') {
      rate = rates[d.network]; rateSource = 'pricing';
    } else if (net.rackRate && typeof net.rackRate[region] === 'number') {
      rate = net.rackRate[region]; rateSource = 'estimated-national';
    }

    pct = effectivePercent(d, profile);
    if (d.kind === 'credit') {
      annual = d.value;
    } else if (rate !== null) {
      annual = (mk * rate * pct * 12) - ((d.monthlyFee || 0) * 12);
    } else {
      annual = null;   /* rankable by percentage, not by dollars */
    }

    out.push({
      id: d.id, label: d.label, network: net.name,
      percent: pct,
      annualValue: annual,
      rateSource: rateSource,
      monthlyFee: d.monthlyFee || 0,
      free: (d.monthlyFee || 0) === 0,
      expires: d.expires || null,
      enroll: d.enroll || null,
      confidence: normalizeConfidence(d.confidence),
      source: d.source,
      lastVerified: d.lastVerified,
      ageDays: ageDays(d.lastVerified, today),
      stale: isStale(d.lastVerified, today)
    });
  }
  /* Entries with a dollar figure rank first and by dollars; the rest follow,
     ranked by percentage. An unpriced entry is not worth zero -- it is worth
     an unknown amount, and sorting it as zero would bury real offers. */
  out.sort(function (a, b) {
    if (a.annualValue !== null && b.annualValue !== null) return b.annualValue - a.annualValue;
    if (a.annualValue !== null) return -1;
    if (b.annualValue !== null) return 1;
    return b.percent - a.percent;
  });
  return out;
}

return {
  NETWORKS: NETWORKS, DISCOUNTS: DISCOUNTS, CONFIDENCE: CONFIDENCE,
  STALE_DAYS: STALE_DAYS, ageDays: ageDays, isStale: isStale,
  normalizeConfidence: normalizeConfidence, isAutoApplicable: isAutoApplicable,
  pricingIdFor: pricingIdFor, networkIdForPricingId: networkIdForPricingId,
  isEligible: isEligible, effectivePercent: effectivePercent,
  resolveRate: resolveRate, auditProfile: auditProfile
};
}));
