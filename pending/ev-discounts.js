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
 * PROVENANCE (mirrors the ev-library discipline)
 *   Every entry carries `source`, `lastVerified` and `confidence`.
 *   confidence:
 *     'published'  - read from the operator's own terms or pricing page
 *     'reported'   - credible secondary source, not the operator
 *     'unverified' - believed current, not confirmed; NEVER auto-applied
 *   `unverified` entries are returned in `excluded[]` with a reason and are
 *   never used to compute a rate. Same rule as 'observed' charging curves:
 *   the label has to mean something or it means nothing.
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

var CONFIDENCE = ['published', 'reported', 'unverified'];

/* ------------------------------------------------------------------ *
 * Networks: rack rates are REGIONAL AVERAGES, not quotes.
 * Real per-station pricing must come from the user or a station preset.
 *
 * NO FEES LIVE HERE. Session fees, idle fees, taxes and plan waivers are
 * owned by ev-pricing.js, which is the sole rate authority and scopes them
 * per plan -- EVgo's $0.99 is pay-as-you-go only and is waived on Plus and
 * PlusMax, and a settled receipt shows $0.00 for a PlusMax session. A flat
 * per-network fee field here cannot express that, so it was removed rather
 * than corrected. Do not re-add one. If a fee is missing, fix it in pricing.
 * ------------------------------------------------------------------ */
var NETWORKS = {
  evgo:        { name: 'EVgo',                  regions: ['US'],
                 rackRate: { US: 0.48 }, rateBasis: 'kWh',
                 source: 'evgo.com/pricing', lastVerified: '2026-09-02', confidence: 'published' },
  ea:          { name: 'Electrify America',     regions: ['US'],
                 rackRate: { US: 0.48 }, rateBasis: 'kWh',
                 source: 'electrifyamerica.com/pricing', lastVerified: '2026-09-02', confidence: 'published' },
  tesla:       { name: 'Tesla Supercharger',    regions: ['US', 'CA'],
                 rackRate: { US: 0.50, CA: 0.60 }, rateBasis: 'kWh',
                 note: 'Dynamic time-of-use. Ontario off-peak observed near C$0.29.',
                 source: 'tesla.com/support/charging', lastVerified: '2026-09-02', confidence: 'published' },
  ionna:       { name: 'IONNA',                 regions: ['US'],
                 rackRate: { US: 0.48 }, rateBasis: 'kWh',
                 source: 'ionna.com/faqs', lastVerified: '2026-09-02', confidence: 'published' },
  mbhpc:       { name: 'Mercedes-Benz HPC',     regions: ['US', 'CA'],
                 rackRate: { US: 0.48, CA: 0.62 }, rateBasis: 'kWh',
                 source: 'mercedesbenzhpc.com', lastVerified: '2026-09-02', confidence: 'reported' },
  chargepoint: { name: 'ChargePoint',           regions: ['US', 'CA'],
                 rackRate: null, rateBasis: 'host',
                 note: 'ChargePoint only processes payment. Each site host sets price. No network rate exists.',
                 source: 'chargepoint.com/drivers/support/faqs', lastVerified: '2026-09-02', confidence: 'published' },
  evconnect:   { name: 'EV Connect',            regions: ['US', 'CA'],
                 rackRate: null, rateBasis: 'host',
                 source: 'evconnect.com/drivers', lastVerified: '2026-09-02', confidence: 'published' },
  blink:       { name: 'Blink',                 regions: ['US'],
                 rackRate: { US: 0.49 }, rateBasis: 'kWh',
                 source: 'blinkcharging.com/charge/driver-faq', lastVerified: '2026-09-02', confidence: 'published' },
  rede:        { name: 'Red E',                 regions: ['US', 'CA'],
                 rackRate: null, rateBasis: 'host',
                 note: 'No membership, referral or promo program published. Strong metro-Detroit presence.',
                 source: 'redecharge.com', lastVerified: '2026-09-02', confidence: 'reported' },
  ivy:         { name: 'Ivy Charging',          regions: ['CA'],
                 rackRate: { CA: 0.69 }, rateBasis: 'kWh',
                 note: 'Flat, tax-inclusive. Operates ONroute and Canadian Tire sites.',
                 source: 'ivycharge.com/support', lastVerified: '2026-09-02', confidence: 'published' },
  ecanada:     { name: 'Electrify Canada',      regions: ['CA'],
                 rackRate: { CA: 0.65 }, rateBasis: 'kWh',
                 note: 'Separate corporation from Electrify America. Separate account.',
                 source: 'electrify-canada.ca/pricing', lastVerified: '2026-09-02', confidence: 'published' },
  petro:       { name: 'Petro-Canada',          regions: ['CA'],
                 rackRate: { CA: 0.50 }, rateBasis: 'minute',
                 note: 'Billed per MINUTE, not per kWh. Penalizes vehicles that taper early.',
                 source: 'petro-canada.ca/en/personal/fuel/canadas-electric-highway', lastVerified: '2026-09-02', confidence: 'published' },
  journie:     { name: 'On the Run / Journie',  regions: ['CA'],
                 rackRate: { CA: 0.60 }, rateBasis: 'kWh',
                 source: 'journie.ca/on-the-run-ca/on-en/ev-charging', lastVerified: '2026-09-02', confidence: 'reported' },
  greenp:      { name: 'Green P Toronto',       regions: ['CA'],
                 rackRate: null, rateBasis: 'hour',
                 note: 'Billed per HOUR: C$15/hr at 50 kW, C$20/hr at 100 kW, plus parking.',
                 source: 'parking.greenp.com/ev-charging', lastVerified: '2026-09-02', confidence: 'published' }
};

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
    requires: { make: ['Hyundai', 'Genesis'] },
    starts: '2026-08-19',
    note: 'In-App Charging or Plug & Charge only. Paying at the charger forfeits it.',
    caveat: 'Model-specific. Eligible: Hyundai IONIQ 5 / 5 N (2025+), IONIQ 9 ' +
            '(2026+) via app or Plug & Charge; IONIQ 5 (2022-24), IONIQ 6 ' +
            '(2023-25), KONA Electric (2025+) via app only; Genesis GV60 ' +
            '(2026+) and Electrified GV70 (2026+). Anything else -- including ' +
            'the Genesis G80 Electrified -- is NOT eligible.',
    source: 'prnewswire.com/news-releases/hyundai-us-ev-owners-to-receive-automatic-10-discount-at-all-ionna-fastcharging-stations-via-app-and-plug--charge-302856716.html',
    lastVerified: '2026-09-14', confidence: 'published' },

  { id: 'hyundai-genesis-ionna-bonus', network: 'ionna', region: 'US', kind: 'percent',
    label: 'IONNA - Hyundai & Genesis (launch bonus)',
    value: 0.20, monthlyFee: 0,
    requires: { make: ['Hyundai', 'Genesis'] },
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
    source: 'tesla.com/en_ca/support/charging/supercharging', lastVerified: '2026-09-02', confidence: 'reported' },

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
    source: 'journie.ca', lastVerified: '2026-09-02', confidence: 'reported' },

  { id: 'rbc-petro', network: 'petro', region: 'CA', kind: 'credit',
    label: 'RBC x Petro-Canada charging credit', value: 100, monthlyFee: 0,
    requires: { card: ['rbc'] },
    caveat: 'Recurring offer for eligible RBC Rewards cardholders. Current terms and expiry not confirmed.',
    source: 'rbcroyalbank.com/petro-canada', lastVerified: '2026-09-02', confidence: 'unverified' }
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
function isEligible(d, profile, today) {
  var now = today || new Date().toISOString().slice(0, 10);
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
  var kwh = typeof opts.kwh === 'number' ? opts.kwh : 0;
  var monthlyKwh = typeof opts.monthlyKwh === 'number' ? opts.monthlyKwh : kwh * 20;
  var notes = [];
  var eligible = [];
  var excluded = [];
  var i, d, verdict;

  if (!net) {
    return { rackRate: null, rateSource: 'unavailable', effectiveRate: null,
             applied: null, eligible: [], excluded: [],
             notes: ['Unknown network: ' + opts.network] };
  }

  /* Rate precedence: user override, then network average, then nothing.
     Never invent a rate for a host-priced network. */
  var rackRate, rateSource;
  if (typeof opts.rateOverride === 'number') {
    rackRate = opts.rateOverride;
    rateSource = 'user';
  } else if (net.rackRate && typeof net.rackRate[region] === 'number') {
    rackRate = net.rackRate[region];
    rateSource = 'network-average';
    notes.push(net.name + ' rate is a regional average, not a quote for this station.');
  } else {
    rackRate = null;
    rateSource = 'unavailable';
    notes.push(net.note || (net.name + ' pricing is set per site. Enter the rate from the charger.'));
  }
  if (net.rateBasis && net.rateBasis !== 'kWh' && rateSource !== 'user') {
    notes.push(net.name + ' bills per ' + net.rateBasis + ', not per kWh. Cost will not scale with energy.');
  }

  for (i = 0; i < DISCOUNTS.length; i++) {
    d = DISCOUNTS[i];
    if (d.network !== opts.network) continue;

    if (d.confidence === 'unverified') {
      excluded.push({ id: d.id, label: d.label,
                      reason: 'unverified - not applied automatically',
                      caveat: d.caveat || null });
      continue;
    }
    verdict = isEligible(d, profile, opts.today);
    if (!verdict.ok) {
      excluded.push({ id: d.id, label: d.label, reason: verdict.reason });
      continue;
    }

    var pct = effectivePercent(d, profile);
    var feePerKwh = monthlyKwh > 0 ? (d.monthlyFee || 0) / monthlyKwh : 0;
    var gross = rackRate === null ? null : rackRate * pct;
    var net_ = gross === null ? null : gross - feePerKwh;

    eligible.push({
      id: d.id,
      label: d.label,
      kind: d.kind,
      percent: pct,
      monthlyFee: d.monthlyFee || 0,
      feePerKwh: feePerKwh,
      valuePerKwh: net_,
      breakevenKwh: (d.monthlyFee && gross) ? (d.monthlyFee / gross) : 0,
      expires: d.expires || null,
      note: d.note || null,
      caveat: d.caveat || null,
      confidence: d.confidence,
      source: d.source,
      lastVerified: d.lastVerified
    });
  }

  eligible.sort(function (a, b) { return (b.valuePerKwh || 0) - (a.valuePerKwh || 0); });

  /* No network permits stacking: exactly one discount applies. */
  var applied = null;
  for (i = 0; i < eligible.length; i++) {
    if (eligible[i].valuePerKwh > 0) { applied = eligible[i]; break; }
  }

  var effectiveRate = rackRate;
  if (rackRate !== null && applied) {
    effectiveRate = rackRate - applied.valuePerKwh;
    if (effectiveRate < 0) effectiveRate = 0;
  }

  /* Surface the bad trade: a paid plan the driver holds that a free option
     already beats. Report it whichever one won -- if the free option won, the
     subscription is simply being paid for and not used. */
  if (applied) {
    for (i = 0; i < eligible.length; i++) {
      var paid = eligible[i];
      if (paid.monthlyFee <= 0) continue;
      if (paid.valuePerKwh > applied.valuePerKwh) continue;
      if (paid.id === applied.id) continue;
      notes.push('You are paying $' + paid.monthlyFee.toFixed(2) + '/mo for ' +
                 paid.label + ', but ' + applied.label +
                 ' is free and at least as good here. Cancelling ' + paid.label +
                 ' would save $' + (paid.monthlyFee * 12).toFixed(0) + '/yr.');
      break;
    }
  }
  if (applied && applied.caveat) notes.push(applied.caveat);
  if (applied && applied.note) notes.push(applied.note);
  /* This used to assert "No charging network permits stacking", which is not
     true: Hyundai and IONNA stack a standing 10% with a launch bonus 10%.
     Where offers do stack, they are carried here as one entry at the combined
     value, so the number below is already the real one. Say what this function
     does -- show the best single offer -- and do not make a claim about the
     industry that the data contradicts. */
  if (eligible.length > 1) {
    notes.push('Showing the best offer you qualify for' +
               (applied ? ': ' + applied.label : '') +
               '. Discounts are not additive unless an entry says so.');
  }

  return {
    network: net.name,
    rackRate: rackRate,
    rateSource: rateSource,
    rateBasis: net.rateBasis,
    effectiveRate: effectiveRate,
    applied: applied,
    eligible: eligible,
    excluded: excluded,
    savings: (rackRate !== null && applied && kwh) ? applied.valuePerKwh * kwh : 0,
    /* ENERGY ONLY. No session fee, no idle fee, no tax -- those belong to
       ev-pricing.js, which scopes them per plan and applies tax to the
       subtotal in the order a settled receipt proves:
           rate -> discount -> subtotal -> tax
       This figure is the discounted energy cost and nothing else. A caller
       that needs a billable total must get it from pricing's sessionCost(). */
    sessionCost: (effectiveRate !== null && kwh) ? effectiveRate * kwh : null,
    notes: notes
  };
}

/**
 * Every discount the driver qualifies for anywhere, ranked by annual value.
 * Drives a "what are you leaving on the table" view.
 */
function auditProfile(profile, monthlyKwh, today) {
  var out = [], i, d, verdict, pct, annual;
  var mk = monthlyKwh || 0;

  for (i = 0; i < DISCOUNTS.length; i++) {
    d = DISCOUNTS[i];
    verdict = isEligible(d, profile, today);
    if (!verdict.ok || d.confidence === 'unverified') continue;

    var net = NETWORKS[d.network];
    var rate = net && net.rackRate && net.rackRate[profile.region || 'US'];
    if (!rate) continue;

    pct = effectivePercent(d, profile);
    annual = d.kind === 'percent'
      ? (mk * rate * pct * 12) - ((d.monthlyFee || 0) * 12)
      : (d.kind === 'credit' ? d.value : 0);

    out.push({
      id: d.id, label: d.label, network: net.name,
      annualValue: annual, monthlyFee: d.monthlyFee || 0,
      free: (d.monthlyFee || 0) === 0,
      expires: d.expires || null,
      enroll: d.enroll || null,
      confidence: d.confidence, source: d.source, lastVerified: d.lastVerified
    });
  }
  out.sort(function (a, b) { return b.annualValue - a.annualValue; });
  return out;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { NETWORKS: NETWORKS, DISCOUNTS: DISCOUNTS, CONFIDENCE: CONFIDENCE,
                     isEligible: isEligible, resolveRate: resolveRate, auditProfile: auditProfile };
}
