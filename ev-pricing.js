/* =========================================================================
   EV DWELL PLANNER — PRICING & COST ENGINE  (data version 2026-08-10)

   Answers "what will this cost?" alongside "what will I leave at?".

   PROVENANCE MODEL — mirrors the vehicle-curve rules exactly:
     'published'   read from the operator's OWN current pricing page
     'secondary'   reputable third-party reporting (news, aggregate trackers)
     'estimated'   representative figure from public/community knowledge
     'unavailable' operator does not publish it; user must supply it

   PRICE AUTHORITY — the single most important structural finding. Networks
   are not all the same kind of thing:
     'network'   sets one real, published rate (Petro-Canada, Ivy, EVCS…)
     'per-site'  sets the rate itself but publishes it only in-app or on the
                 charger screen (Tesla, Electrify America, EVgo, Rivian…)
     'host'      does NOT set prices at all; the site owner does, per location
                 (ChargePoint, FLO, AmpUp, SWTCH, EV Connect…)
   A single national $/kWh field would be fiction for most of the market, so
   the schema refuses to pretend otherwise.

   NEVER SCRAPED AT RUNTIME. This is a static, versioned file. Offline-first.
   ========================================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EVPricing = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const DATA_VERSION = '2026-08-10';
const STALE_DAYS = 90;

/* ------------------------------------------------------------- FX ------- */
/* User-editable, with an explicit as-of date. The app works offline without
   ever touching this; conversion is always LABELLED, never silent.          */
const FX_DEFAULT = { USD_CAD: 1.37, asOf: '2026-08-10', source: 'user-editable default' };

function convert(amount, from, to, fx) {
  if (amount == null) return null;
  if (from === to) return amount;
  const r = (fx && fx.USD_CAD) || FX_DEFAULT.USD_CAD;
  if (from === 'USD' && to === 'CAD') return amount * r;
  if (from === 'CAD' && to === 'USD') return amount / r;
  return amount;
}

/* --------------------------------------------------------- RATE HELPER -- */
/* r(opts) builds a rate. Every field optional — real networks combine them. */
function r(o) {
  return {
    perKWh:      o.kWh    != null ? o.kWh    : null,
    perMinute:   o.min    != null ? o.min    : null,
    perHour:     o.hour   != null ? o.hour   : null,
    sessionFee:  o.session != null ? o.session : null,
    idle:        o.idle || null,          // {perMinute|perHour, graceMinutes}
    powerBands:  o.bands || null,         // basis switches by delivered kW
    afterSOC:    o.afterSOC || null,      // punitive band past a given SOC
    tou:         o.tou || null,           // [{name,startHour,endHour,kWh|min}]
    taxIncluded: !!o.taxIncl,
    taxPct:      o.taxPct != null ? o.taxPct : null,   // sales tax added ON TOP, percent
    currency:    o.cur || 'USD',
    confidence:  o.conf || 'unavailable',
    source:      o.src || null,
    lastVerified: o.date || DATA_VERSION,
    note:        o.note || null
  };
}
const NO_RATE = extra => r(Object.assign({ conf: 'unavailable' }, extra || {}));

/* =========================================================================
   NETWORKS
   ========================================================================= */
const NETWORKS = [

/* ------------------------------------------------------------ UNITED STATES */
{
  id:'tesla-us', name:'Tesla Supercharger', country:'US', currency:'USD',
  authority:'per-site',
  authorityNote:'Tesla sets the price but publishes it only in the app and on the vehicle screen. Rates are dynamic and change by site and by hour.',
  default: r({ conf:'estimated', kWh:0.42, cur:'USD',
    src:'https://www.tesla.com/support/supercharging',
    note:'Tesla publishes NO rate table. $0.42/kWh is a representative US figure from community reporting, not an operator-published number — treat it as a starting point and replace it with what you actually paid.',
    idle:{ perMinute:0.50, graceMinutes:5 },
    date:'2026-08-10' }),
  fees:{ congestionNote:'Congestion fee typically $0.50/min, up to $1.00/min, varies by location. Starts when the site is busy AND the battery reaches 80% or the session ends. 5-minute grace.' },
  plans:[
    { id:'tesla-payg', name:'Pay as you go (non-Tesla)', monthlyFee:0, conf:'published',
      note:'Non-Tesla vehicles pay a premium over Tesla-owner pricing — Tesla cites ~40%, independent testing measured 30–35%.',
      src:'https://www.tesla.com/support/charging/supercharging-other-evs' },
    { id:'tesla-membership', name:'Supercharger Membership (non-Tesla)', monthlyFee:12.99, conf:'secondary',
      discountPct:30, discountIsCeiling:true, waivesSessionFee:false, waivesIdleFee:false,
      note:'Gives non-Tesla EVs the same price Tesla owners pay — up to about 30% off, and a best case rather than a flat discount. One membership covers multiple vehicles. Checked again 12 Aug 2026: the $12.99 fee is still NOT published anywhere on tesla.com; it appears only in the app and in third-party reporting (Electrek, 24 Apr 2026).',
      src:'https://electrek.co/2026/04/24/tesla-model-3-free-supercharging-non-tesla-pricing-premium/' }
  ],
  source:'https://www.tesla.com/support/charging/supercharger/fees', lastVerified:'2026-08-10'
},
{
  id:'electrify-america', name:'Electrify America', country:'US', currency:'USD',
  authority:'per-site',
  authorityNote:'EA sets prices but states plainly: "Real-time pricing is available in the app or at the charger." Rates vary by location.',
  default: r({ conf:'unavailable', cur:'USD',
    idle:{ perMinute:0.40, graceMinutes:10 },
    session:null,
    src:'https://www.electrifyamerica.com/pricing/',
    note:'Per-kWh rate is NOT published — enter what the charger shows. The idle fee, plan fees and discount below ARE published and are applied correctly regardless.',
    date:'2026-08-10' }),
  fees:{ note:'Some states are still billed per minute; EA confirms the practice but has never published which states.' },
  plans:[
    { id:'ea-pass', name:'Pass', monthlyFee:0, conf:'published',
      src:'https://www.electrifyamerica.com/pricing/' },
    { id:'ea-pass-plus', name:'Pass+', monthlyFee:7.00, discountPct:25, discountIsCeiling:true,
      waivesSessionFee:false, waivesIdleFee:false, conf:'published',
      note:'About 25% off charging — EA words it as an approximation, so treat it as a best case. Explicitly does NOT waive idle or session fees.',
      src:'https://www.electrifyamerica.com/pass-plus-for-mybmw-plan-disclosure/' }
  ],
  source:'https://www.electrifyamerica.com/mobile-faq/', lastVerified:'2026-08-10'
},
{
  id:'evgo', name:'EVgo', country:'US', currency:'USD',
  authority:'per-site',
  authorityNote:'EVgo prices by region and by station: "All pricing rates vary by region." Station-specific pricing is shown only in the app.',
  default: r({ conf:'unavailable', cur:'USD', session:0.99,
    src:'https://www.evgo.com/pricing/',
    note:'Per-kWh and per-minute rates are app-only. EVgo formerly ran published California sub-regional pricing; that table is no longer public. Session fee, plan fees and discounts below are published.',
    date:'2026-08-10' }),
  regions:[
    { id:'evgo-l2', name:'Level 2 (select locations)', level:'AC',
      rate: r({ kWh:0.28, cur:'USD', conf:'published', src:'https://www.evgo.com/pricing/',
        note:'The only concrete per-kWh figure EVgo publishes.', date:'2026-08-10' }) },

    /* MICHIGAN. Two separately-sourced things are stacked here and they have
       different confidence, so they are labelled separately:
         PEAK PRICE   — secondary. DCFC Tracker continuously syncs EVgo's
                        public station pricing and puts Michigan's average
                        peak at $0.588/kWh (Aug 2026); it logged Meijer
                        Rochester Hills going $0.52 -> $0.59 in June 2026.
         TOU WINDOWS  — estimated. EVgo confirms Michigan is a kWh + TOU
                        state, but has never published Michigan's clock
                        windows. The only windows EVgo has EVER published are
                        California's (2021 press release), and the generic
                        TOU explainer uses those same boundaries. They are
                        used here as a stand-in and are meant to be corrected.
       The off-peak and super-off-peak PRICES are inferred from the peak with
       a typical TOU spread. They are guesses. Check the app once, correct
       them once, and your figures win from then on.                        */
    { id:'evgo-mi', name:'Michigan', states:['MI'], level:'DC',
      rate: r({ kWh:0.588, cur:'USD', conf:'secondary', taxPct:6,
        src:'https://dcfctracker.com/reports/evgo/2026-08',
        date:'2026-08-12',
        note:'Michigan average PEAK rate across 10 EVgo sites. Michigan bills per kWh (EVgo converted the state in 2023).',
        tou:{
          confidence:'estimated',
          basis:'station-local clock',
          source:'https://www.evgo.com/press-release/evgo-announces-new-nationwide-plan-options-new-loyalty-program-innovative-pricing-pilot-california/',
          note:'RECEIPT-DERIVED: the 21:00-24:00 window is now $0.4429/kWh, back-calculated from a settled receipt (12 Aug 2026, Meijer Rochester Hills, 21:09-22:14, PlusMax billed $0.31/kWh) ASSUMING the full 30% PlusMax ceiling applied. If the discount was less than 30% the standard rate is lower than this. Michigan sales tax of 6% is applied on top and is itemised separately on the receipt. The other windows are unchanged and still estimated. Windows copied from EVgo\'s published CALIFORNIA schedule — Michigan\'s are not published. Off-peak and super-off-peak prices are inferred from the observed peak, not observed themselves. Edit these to what your app shows.',
          windows:[
            { id:'sop', name:'Super off-peak', startHour:0,  endHour:8,  perKWh:0.42 },
            { id:'op',  name:'Off-peak',       startHour:8,  endHour:16, perKWh:0.49 },
            { id:'pk',  name:'On-peak',        startHour:16, endHour:21, perKWh:0.588 },
            { id:'op2', name:'Off-peak',       startHour:21, endHour:24, perKWh:0.4429 }
          ]
        } }) }
  ],
  sessionLimitMinutes:120,
  sessionLimitNote:'EVgo displays and enforces a 120-minute cap on DC sessions. A dwell longer than this needs a restart.',
  fees:{ note:'Credit-card-initiated sessions carry a $2.99 transaction fee (published). Reservations $3 on Pay As You Go, free on paid plans. Idle fee not published.' },
  plans:[
    { id:'evgo-payg', name:'Pay As You Go', monthlyFee:0, sessionFee:0.99, conf:'published',
      src:'https://www.evgo.com/pricing/' },
    { id:'evgo-plus', name:'EVgo Plus', monthlyFee:6.99, discountPct:15, discountIsCeiling:true,
      waivesSessionFee:true, conf:'published',
      note:'Up to 15% off. EVgo says plainly that "actual savings vary by time of use, location, frequency, and length of charging session", so 15% is a best case, not a flat multiplier. Session fees waived, reservations free.',
      src:'https://helpcenter.evgo.com/hc/en-us/articles/8927166231063-EVgo-Plans' },
    { id:'evgo-plusmax', name:'EVgo PlusMax', monthlyFee:12.99, discountPct:30, discountIsCeiling:true,
      waivesSessionFee:true, conf:'published',
      note:'Up to 30% off. EVgo says plainly that "actual savings vary by time of use, location, frequency, and length of charging session", so 30% is a best case, not a flat multiplier. Session fees waived, reservations free.',
      src:'https://helpcenter.evgo.com/hc/en-us/articles/8927166231063-EVgo-Plans' }
  ],
  source:'https://www.evgo.com/pricing/', lastVerified:'2026-08-10'
},
{
  id:'evcs', name:'EVCS', country:'US', currency:'USD',
  authority:'network',
  authorityNote:'The only US network researched that publishes a complete rate table by state.',
  regions:[
    { id:'evcs-ca', name:'California', states:['CA'],
      rate: r({ kWh:0.59, session:0.99, cur:'USD', conf:'published',
        src:'https://www.evcs.com/plans', date:'2026-08-10' }),
      acRate: r({ kWh:0.49, session:0.99, cur:'USD', conf:'published', src:'https://www.evcs.com/plans' }) },
    { id:'evcs-orwa', name:'Oregon / Washington', states:['OR','WA'],
      rate: r({ kWh:0.59, session:0.99, cur:'USD', conf:'published',
        src:'https://www.evcs.com/plans', date:'2026-08-10' }),
      acRate: r({ kWh:0.39, session:0.99, cur:'USD', conf:'published', src:'https://www.evcs.com/plans' }) }
  ],
  plans:[
    { id:'evcs-basic', name:'Basic', monthlyFee:3.99, waivesSessionFee:true, conf:'published',
      note:'Pay-as-you-go rates, session fees waived.', src:'https://www.evcs.com/plans' },
    { id:'evcs-essential', name:'Essential', monthlyFee:9.99, allowanceKWh:30, perKWh:0.33,
      waivesSessionFee:true, conf:'published', note:'30 kWh included, then PAYG rates.',
      src:'https://www.evcs.com/plans' },
    { id:'evcs-standard', name:'Standard', monthlyFee:59.99, allowanceKWh:200, perKWh:0.30,
      waivesSessionFee:true, conf:'published', note:'200 kWh included, then PAYG rates.',
      src:'https://www.evcs.com/plans' },
    { id:'evcs-offpeak', name:'Off-Peak', monthlyFee:99.99, allowanceKWh:400, perKWh:0.25,
      waivesSessionFee:true, conf:'published',
      allowanceWindow:{ startHour:22, endHour:6 },
      note:'400 kWh redeemable 10PM–6AM ONLY. Outside that window, or after the allowance, PAYG rates apply.',
      src:'https://www.evcs.com/plans' },
    { id:'evcs-premium', name:'Premium (rideshare)', monthlyFee:199.99, allowanceKWh:650, perKWh:0.31,
      waivesSessionFee:true, conf:'published', note:'650 kWh, 24/7, all connectors.',
      src:'https://www.evcs.com/plans/premium' }
  ],
  source:'https://www.evcs.com/plans', lastVerified:'2026-08-10'
},
{
  id:'chargepoint-us', name:'ChargePoint', country:'US', currency:'USD',
  authority:'host',
  authorityNote:'ChargePoint does NOT set charging prices. Each site owner does. There is no ChargePoint network rate to look up — enter what your charger shows.',
  default: NO_RATE({ cur:'USD', src:'https://www.chargepoint.com/drivers/support/faqs/what-are-pricing-policies-and-fees-i-should-be-aware',
    note:'Hosts may bill per kWh, per hour/minute, a flat session fee, tiered rates, or overstay fees. ChargePoint only processes payment.' }),
  fees:{ published:true, date:'2026-06-16',
    serviceFee:{ acAccount:0.25, dcAccount:0.49, acGuest:0.49, dcGuest:0.99 },
    note:'ChargePoint adds its own service fee ON TOP of the host price: $0.25 AC / $0.49 DC for account holders, $0.49 AC / $0.99 DC for contactless guests.',
    src:'https://www.chargepoint.com/drivers/support/faqs/what-service-fee' },
  plans:[ { id:'cp-free', name:'Free account', monthlyFee:0, conf:'published',
    note:'No driver subscription exists. An account lowers the per-session service fee.' } ],
  source:'https://www.chargepoint.com/drivers/support/faqs/what-are-pricing-policies-and-fees-i-should-be-aware',
  lastVerified:'2026-08-10'
},
{
  id:'blink', name:'Blink', country:'US', currency:'USD',
  authority:'per-site',
  authorityNote:'Mixed: Blink sets the price on Blink-owned equipment, the host sets it on host-owned equipment. Rates are shown on the charger.',
  default: r({ kWh:0.39, session:0.49, cur:'USD', conf:'estimated',
    src:'https://blinkcharging.com/blog/why-pricing-varies-from-one-charger-to-another',
    note:'~$0.39/kWh is Blink\'s own illustrative figure, undated and not a rate table. The $0.49 per-session access fee IS published.',
    date:'2026-08-10' }),
  regions:[
    { id:'blink-ct', name:'Connecticut', states:['CT'],
      rate: r({ kWh:0.59, session:0.49, cur:'USD', conf:'estimated',
        src:'https://blinkcharging.com/blog/why-pricing-varies-from-one-charger-to-another',
        note:'Blink cites ~$0.59/kWh in Connecticut. Illustrative, undated.' }) }
  ],
  fees:{ note:'Blink bills per minute in states where electricity resale is restricted, and notes this "is more expensive for most EV drivers". Which states is not published. $15 pre-authorisation hold. Idle fees not published.' },
  plans:[ { id:'blink-member', name:'Blink Member (free)', monthlyFee:0, discountPct:25,
    conf:'secondary', note:'Membership costs nothing. Members save roughly 20–30% versus guests, per Blink\'s own blog (undated).',
    src:'https://blinkcharging.com/charge/driver-faq' } ],
  source:'https://blinkcharging.com/charge/driver-faq', lastVerified:'2026-08-10'
},
{
  id:'ionna', name:'Ionna', country:'US', currency:'USD',
  authority:'per-site',
  authorityNote:'Uniquely, Ionna publishes the current rate on each individual Rechargery page of its own website — the most honestly sourceable network in the US.',
  default: r({ kWh:0.39, cur:'USD', conf:'published',
    src:'https://www.ionna.com/rechargery/apex-nc-ev-charging-27502/',
    note:'Ionna is the ONLY US network that publishes a live per-kWh price on each site\'s own public page, timestamped to the minute. Verified 12 Aug 2026: $0.39/kWh Houston TX, $0.36/kWh Apex NC, $0.39/kWh Laguna Hills CA — all plus tax. Some sites band by time of day, some are flat. No session or idle fee published.',
    date:'2026-08-12' }),
  regions:[
    { id:'ionna-tou', name:'Site with time-of-day bands (e.g. Houston TX 77007)', level:'DC',
      rate: r({ kWh:0.39, cur:'USD', conf:'published', date:'2026-08-12',
        src:'https://www.ionna.com/rechargery/houston-tx-ev-charging-77007/',
        note:'Read verbatim off Ionna\'s own site page. Not every Ionna site bands by time — check yours.',
        tou:{ confidence:'published', basis:'station-local clock',
          source:'https://www.ionna.com/rechargery/houston-tx-ev-charging-77007/',
          note:'Published on the site\'s own page, not inferred.',
          windows:[
            { id:'i-night', name:'Overnight',  startHour:0,  endHour:8,  perKWh:0.34 },
            { id:'i-day',   name:'Daytime',    startHour:8,  endHour:20, perKWh:0.39 },
            { id:'i-late',  name:'Late evening', startHour:20, endHour:24, perKWh:0.34 }
          ] } }) },
    { id:'ionna-flat', name:'Site with one flat rate (e.g. Apex NC 27502)', level:'DC',
      rate: r({ kWh:0.36, cur:'USD', conf:'published', date:'2026-08-12',
        src:'https://www.ionna.com/rechargery/apex-nc-ev-charging-27502/',
        note:'No time-of-day banding at this site.' }) }
  ],
  plans:[
    { id:'ionna-none', name:'No membership required', monthlyFee:0, conf:'secondary' },
    { id:'ionna-bmw', name:'BMW / MINI discount', monthlyFee:0, discountPct:20, conf:'published',
      note:'20% off through 30 September 2026 via Plug & Charge or the My BMW app.', src:'https://ionna.com/faq' },
    { id:'ionna-gm', name:'GM vehicle discount', monthlyFee:0, discountPct:10, conf:'published',
      note:'10% off via myChevrolet / myGMC / myCadillac. Applies to energy cost only.', src:'https://ionna.com/faq' }
  ],
  source:'https://ionna.com/faq', lastVerified:'2026-08-10'
},
{
  id:'francis-energy', name:'Francis Energy', country:'US', currency:'USD',
  authority:'network',
  authorityNote:'One of the few remaining time-billed DC networks.',
  default: r({ min:0.39, session:1.00, cur:'USD', conf:'published',
    src:'https://francisevcharging.zendesk.com/hc/en-us/articles/4434557693467-What-does-it-cost-to-charge',
    note:'DC fast billed PER MINUTE — slow-charging vehicles pay dramatically more here. Francis says some regions use per-kWh pricing but does not publish those rates.',
    date:'2026-08-10' }),
  regions:[
    { id:'francis-l2', name:'Level 2', level:'AC',
      rate: r({ hour:1.25, session:1.00, cur:'USD', conf:'published',
        src:'https://francisevcharging.zendesk.com/hc/en-us/articles/4434557693467-What-does-it-cost-to-charge' }) }
  ],
  plans:[], source:'https://francisevcharging.zendesk.com/hc/en-us/articles/4434557693467-What-does-it-cost-to-charge',
  lastVerified:'2026-08-10'
},
{
  id:'mercedes-hpc', name:'Mercedes-Benz HPC', country:'US', currency:'USD',
  authority:'per-site',
  authorityNote:'"Pricing varies by location. Check the charger screen for exact rates." Also operates the charging at Buc-ee\'s locations.',
  default: r({ kWh:0.40, cur:'USD', conf:'estimated',
    src:'https://mercedesbenzhpc.com/support-and-faqs/',
    note:'$0.40/kWh is Mercedes\' published "Welcome Pricing" at newer sites — a limited-time introductory rate, NOT the standard rate. Standard rates are per-site and unpublished.',
    date:'2026-08-10' }),
  plans:[ { id:'mb-complimentary', name:'Mercedes owner complimentary charging', monthlyFee:0,
    discountPct:100, conf:'published',
    note:'Two years complimentary charging for 2024-and-newer Mercedes EVs (US). Other brands pay the posted rate.',
    src:'https://mercedesbenzhpc.com/how-to-charge/' } ],
  source:'https://mercedesbenzhpc.com/support-and-faqs/', lastVerified:'2026-08-10'
},
{
  id:'rivian-ran', name:'Rivian Adventure Network', country:'US', currency:'USD',
  authority:'per-site',
  authorityNote:'Rivian directs drivers to the app, vehicle screen or charger for pricing. Per-site, unpublished.',
  default: NO_RATE({ cur:'USD', src:'https://rivian.com/support/article/how-much-does-it-cost-to-charge-on-the-rivian-adventure-network',
    note:'No published rate. Rivian confirms Rivian drivers receive a discounted rate at sites open to all EVs, but does not publish the size of the discount.' }),
  plans:[ { id:'ran-rivian-owner', name:'Rivian vehicle discount', monthlyFee:0, conf:'published',
    note:'Confirmed to exist; amount not published.',
    src:'https://rivian.com/support/article/how-much-does-it-cost-to-charge-on-the-rivian-adventure-network' } ],
  source:'https://rivian.com/support/article/how-much-does-it-cost-to-charge-on-the-rivian-adventure-network',
  lastVerified:'2026-08-10'
},
{
  id:'bp-pulse-us', name:'bp pulse', country:'US', currency:'USD',
  authority:'per-site',
  authorityNote:'Explicitly app-only: "Download our app for the most up to date pricing rates per site." Uses time-of-use tiers that vary by location.',
  default: NO_RATE({ cur:'USD', src:'https://www.bppulse.com/en-us/public-ev-charging/pricing',
    note:'Per-site with peak / off-peak / super off-peak windows that differ by location. A single national figure would be misleading.' }),
  plans:[], source:'https://www.bppulse.com/en-us/public-ev-charging/pricing', lastVerified:'2026-08-10'
},
{
  id:'shell-recharge-us', name:'Shell Recharge', country:'US', currency:'USD',
  authority:'per-site',
  authorityNote:'The US Shell Recharge driver site redirects to shell.com; no Shell-owned US page publishes any rate. App-only.',
  default: NO_RATE({ cur:'USD', src:'https://www.shell.us/electric-vehicle-charging.html',
    note:'Five separate Shell-owned pages checked; none carries a US rate, session fee, idle fee or plan.' }),
  plans:[], source:'https://www.shell.us/electric-vehicle-charging.html', lastVerified:'2026-08-10'
},
{
  id:'walmart-charge-better', name:'Walmart (Charge Better)', country:'US', currency:'USD',
  authority:'per-site',
  authorityNote:'Walmart\'s own network, distinct from the Electrify America stations historically hosted at Walmart stores.',
  default: r({ kWh:0.47, session:0, cur:'USD', conf:'estimated',
    src:'https://www.walmart.com/cp/ev/9145505',
    note:'Walmart publishes the STRUCTURE — pay-per-kWh, zero session fees — but not the rate. ~$0.47/kWh on-peak is secondary reporting and varies by location and time of day.',
    date:'2026-08-10' }),
  plans:[ { id:'walmart-plus', name:'Walmart+ member', monthlyFee:0, discountPct:10, conf:'published',
    note:'10% off charging. The Walmart+ subscription fee itself is a separate Walmart product cost, not counted here.',
    src:'https://www.walmart.com/cp/ev/9145505' } ],
  source:'https://www.walmart.com/cp/ev/9145505', lastVerified:'2026-08-10'
},
{
  id:'universal-ev', name:'Universal EV Chargers', country:'US', currency:'USD',
  authority:'network',
  authorityNote:'Unusual model: a flat fee per DC session regardless of length.',
  regions:[
    { id:'universal-il', name:'Illinois', states:['IL'],
      rate: r({ session:15.00, cur:'USD', conf:'published',
        src:'https://universalevcharging.com/illinois-flat-fee-ev-fast-charging/',
        note:'$15 flat per DC fast session regardless of duration. Neither source specifies a kWh or time cap — verify before relying on a long session.',
        date:'2026-08-10' }) }
  ],
  plans:[], source:'https://universalevcharging.com/illinois-flat-fee-ev-fast-charging/', lastVerified:'2026-08-10'
},
{
  id:'wawa', name:'Wawa (own-branded)', country:'US', currency:'USD',
  authority:'per-site',
  authorityNote:'A "Wawa" site may be a Tesla-owned Supercharger, a Wawa-OWNED Supercharger (Tesla hardware, Wawa pricing) or an Ionna Rechargery. Check which before assuming a rate.',
  default: r({ kWh:0.37, cur:'USD', conf:'secondary',
    src:'https://electrek.co/2026/01/19/wawa-now-has-its-own-self-branded-tesla-superchargers/',
    note:'$0.37/kWh reported at the first Wawa-owned site (Alachua FL), applying to all EVs. Single-site report; Wawa publishes no rate card.',
    date:'2026-08-10' }),
  plans:[], source:'https://electrek.co/2026/01/19/wawa-now-has-its-own-self-branded-tesla-superchargers/',
  lastVerified:'2026-08-10'
},
{
  id:'red-e', name:'Red E', country:'US', currency:'USD',
  authority:'host',
  authorityNote:'Red E is a charging-management platform (CSMS), not a price-setting network. Its own product page sells operators "full control over pricing" and the ability to "set pricing by kWh, session, or time". So the rate you pay is whatever the site owner configured — there is no Red E rate to look up.',
  default: NO_RATE({ cur:'USD', src:'https://www.redecharge.com/ev-charging-management-software',
    note:'No driver-facing rate is published anywhere, because Red E does not set one. Read the price off the charger screen or the app and enter it — your figure will be used for every calculation.' }),
  plans:[ { id:'red-e-none', name:'No driver subscription', monthlyFee:0, conf:'published',
    note:'Red E sells to operators, not drivers. Billing terms come from the host.' } ],
  source:'https://www.redecharge.com/ev-charging-management-software', lastVerified:'2026-08-12'
},
{
  id:'us-host-priced', name:'Host-priced network (AmpUp, EV Connect, Chargie, PowerFlex, Loop, SWTCH)',
  country:'US', currency:'USD', authority:'host',
  authorityNote:'These are charging-software platforms. The property owner sets every rate. No network-level price exists — this entry is here so you can record what YOUR site charges.',
  default: NO_RATE({ cur:'USD', src:'https://support.ampup.io/hc/en-us/articles/46197852948507-How-much-does-charging-cost-and-who-sets-the-pricing',
    note:'Supports per-kWh, per-minute, per-hour and combined models — all chosen by the host.' }),
  plans:[], source:'https://support.ampup.io/hc/en-us/articles/46197852948507-How-much-does-charging-cost-and-who-sets-the-pricing',
  lastVerified:'2026-08-10'
},

/* ------------------------------------------------------------------ CANADA */
{
  id:'petro-canada', name:'Petro-Canada Electric Highway', country:'CA', currency:'CAD',
  authority:'network',
  authorityNote:'Single national per-minute rate, no regional variation and no speed tiering.',
  default: r({ min:0.50, session:0, cur:'CAD', conf:'published',
    src:'https://www.petro-canada.ca/en/personal/fuel/canadas-electric-highway',
    note:'$0.50/min nationally, explicitly "no connection or idling fees". Because it is time-billed with NO speed tiering, a slow-charging vehicle pays the same per minute at a 350 kW post as a fast one — a significant cost trap.',
    date:'2026-08-10' }),
  plans:[], source:'https://www.petro-canada.ca/en/personal/fuel/canadas-electric-highway', lastVerified:'2026-08-10'
},
{
  id:'circuit-electrique', name:'Circuit Électrique', country:'CA', currency:'CAD',
  authority:'network',
  authorityNote:'Quebec. Fast-charge rates are regulated and indexed annually. The billing basis SWITCHES MID-SESSION based on delivered power — the most complex model in North America.',
  default: r({ cur:'CAD', taxIncl:true, conf:'published',
    bands:[
      { maxKW:20, perHour:19.22 },
      { maxKW:50, perKWh:0.55 },
      { maxKW:90, perKWh:0.44 },
      { maxKW:180, perKWh:0.55 },
      { maxKW:Infinity, perKWh:0.62 }
    ],
    afterSOC:{ soc:90, perHour:38.46 },
    src:'https://lecircuitelectrique.com/en/rates',
    note:'Rates shown are for 120 kW+ stations and INCLUDE taxes. Below 20 kW delivered you are billed per HOUR, above it per kWh in power bands. Past 90% SOC a punitive hourly rate applies — roughly double the low-power hourly rate. A kWh-only model misprices this network badly.',
    date:'2026-08-10' }),
  regions:[
    { id:'ce-50kw', name:'50 kW station', maxStationKW:50,
      rate: r({ cur:'CAD', taxIncl:true, conf:'published',
        bands:[ { maxKW:20, perHour:13.80 }, { maxKW:Infinity, perKWh:0.38 } ],
        afterSOC:{ soc:90, perHour:27.59 },
        src:'https://lecircuitelectrique.com/en/rates' }) },
    { id:'ce-100kw', name:'100 kW station', maxStationKW:100,
      rate: r({ cur:'CAD', taxIncl:true, conf:'published',
        bands:[ { maxKW:20, perHour:17.00 }, { maxKW:50, perKWh:0.49 }, { maxKW:Infinity, perKWh:0.44 } ],
        afterSOC:{ soc:90, perHour:34.00 },
        src:'https://lecircuitelectrique.com/en/rates' }) },
    { id:'ce-24kw', name:'24 kW station', maxStationKW:24,
      rate: r({ cur:'CAD', taxIncl:true, conf:'published',
        bands:[ { maxKW:10, perHour:8.14 }, { maxKW:Infinity, perKWh:0.38 } ],
        src:'https://lecircuitelectrique.com/en/rates' }) },
    { id:'ce-l2', name:'Level 2 (owner-set from network grid)', level:'AC',
      rate: r({ hour:1.00, cur:'CAD', taxIncl:true, conf:'estimated',
        idle:{ perHour:1.50, graceMinutes:0 },
        src:'https://lecircuitelectrique.com/en/rates',
        note:'Station owners choose from a grid: flat $0–$20/session, or $0.25–$3.00/hour billed by the second, plus an optional $0–$3.00/hour inactivity fee. $1.00/hr shown as a mid-grid placeholder — set yours.' }) }
  ],
  plans:[ { id:'ce-free', name:'Free registration', monthlyFee:0, conf:'published',
    note:'No paid tier. Phone-assisted activation $5; roaming $0.75 (standard) / $1.25 (fast) per session.' } ],
  source:'https://lecircuitelectrique.com/en/rates', lastVerified:'2026-08-10'
},
{
  id:'ivy', name:'Ivy Charging Network', country:'CA', currency:'CAD',
  authority:'network', authorityNote:'Ontario. Single network rate.',
  default: r({ kWh:0.69, cur:'CAD', taxIncl:true, conf:'published',
    idle:{ perHour:1.50, graceMinutes:0 },
    src:'https://ivycharging.zendesk.com/hc/en-ca/articles/46265850894491-What-is-Ivy-s-pricing-structure',
    note:'$0.69/kWh tax-inclusive at Ivy-operated fast-charging sites. Idle fees up to $1.50/hour apply at some sites; grace period not stated. Level 2 pricing is not published.',
    date:'2026-08-10' }),
  plans:[], source:'https://ivycharging.zendesk.com/hc/en-ca/articles/46265850894491-What-is-Ivy-s-pricing-structure',
  lastVerified:'2026-08-10'
},
{
  id:'bc-hydro', name:'BC Hydro EV', country:'CA', currency:'CAD',
  authority:'network', authorityNote:'Province-wide, regulated by the BC Utilities Commission. Not per-site.',
  default: r({ kWh:0.3969, cur:'CAD', conf:'secondary',
    idle:{ perMinute:0.40, graceMinutes:null },
    src:'https://driveteslacanada.ca/news/bc-hydro-increasing-ev-charging-rates-on-april-1-2026/',
    note:'DC fast (25 kW+) $0.3969/kWh before tax, effective 1 April 2026. SECONDARY SOURCE ONLY — bchydro.com was unreachable during research and this should be re-verified against bchydro.com/evrates. Single DC rate, not tiered by speed.',
    date:'2026-08-10' }),
  regions:[
    { id:'bch-l2', name:'Level 2', level:'AC',
      rate: r({ kWh:0.3083, cur:'CAD', conf:'secondary',
        src:'https://driveteslacanada.ca/news/bc-hydro-increasing-ev-charging-rates-on-april-1-2026/',
        note:'$0.3083/kWh before tax, no idle fee on Level 2. Secondary source — re-verify.' }) }
  ],
  plans:[], source:'https://driveteslacanada.ca/news/bc-hydro-increasing-ev-charging-rates-on-april-1-2026/',
  lastVerified:'2026-08-10'
},
{
  id:'ns-power', name:'Nova Scotia Power', country:'CA', currency:'CAD',
  authority:'network', authorityNote:'Two networks with different operators and different billing bases.',
  default: r({ kWh:0.60, cur:'CAD', conf:'published',
    idle:{ perMinute:1.00, graceMinutes:15 },
    src:'https://www.nspower.ca/cleanandgreen/innovation/electric-vehicle-network',
    note:'180 kW network (ChargeLab-operated, CCS + NACS): $0.60/kWh plus HST. Idle fee $1.00/minute starting 15 minutes after charging completes.',
    date:'2026-08-10' }),
  regions:[
    { id:'nsp-50kw', name:'50 kW network (FLO-operated)', maxStationKW:50,
      rate: r({ hour:20.00, cur:'CAD', taxIncl:true, conf:'published',
        src:'https://www.nspower.ca/cleanandgreen/innovation/electric-vehicle-network',
        note:'$20.00/hour, HST included, effective 20 May 2026. Time-based, not energy-based.' }) }
  ],
  plans:[], source:'https://www.nspower.ca/cleanandgreen/innovation/electric-vehicle-network', lastVerified:'2026-08-10'
},
{
  id:'nb-power', name:'NB Power eCharge', country:'CA', currency:'CAD',
  authority:'network', authorityNote:'Entirely time-based, tiered by charger speed, billed on total time CONNECTED.',
  default: r({ hour:20.00, cur:'CAD', conf:'published',
    src:'https://www.nbpower.com/en/products-services/electric-vehicles/charge-your-ev/public-charging/how-to-use-a-charging-station-and-rates/',
    note:'50 kW DC fast at $20/hour, billed on total time connected — which functions as an implicit idle charge, so leaving the car plugged in after it finishes costs the same as charging.',
    date:'2026-08-10' }),
  regions:[
    { id:'nbp-100kw', name:'100 kW DC fast', maxStationKW:100,
      rate: r({ hour:30.00, cur:'CAD', conf:'published',
        src:'https://www.nbpower.com/en/products-services/electric-vehicles/charge-your-ev/public-charging/how-to-use-a-charging-station-and-rates/' }) },
    { id:'nbp-l2', name:'Level 2', level:'AC',
      rate: r({ hour:2.00, session:3.00, cur:'CAD', conf:'published',
        src:'https://www.nbpower.com/en/products-services/electric-vehicles/charge-your-ev/public-charging/how-to-use-a-charging-station-and-rates/',
        note:'$2.00/hour PLUS a $3.00 session fee, billed by the minute on total time connected.' }) }
  ],
  plans:[], source:'https://www.nbpower.com/en/products-services/electric-vehicles/charge-your-ev/public-charging/how-to-use-a-charging-station-and-rates/',
  lastVerified:'2026-08-10'
},
{
  id:'green-p', name:'Green P (Toronto)', country:'CA', currency:'CAD',
  authority:'network', authorityNote:'Toronto Parking Authority. Time-based. Parking is billed SEPARATELY from charging.',
  default: r({ hour:15.00, cur:'CAD', conf:'published',
    src:'https://greenp.com/ev-charging/',
    note:'50 kW DC at $15.00/hour. Parking fees are charged separately and are not included here.',
    date:'2026-08-10' }),
  regions:[
    { id:'gp-100kw', name:'100 kW DC fast', maxStationKW:100,
      rate: r({ hour:20.00, cur:'CAD', conf:'published', src:'https://greenp.com/ev-charging/' }) },
    { id:'gp-l2', name:'Level 2', level:'AC',
      rate: r({ hour:2.00, cur:'CAD', conf:'published', src:'https://greenp.com/ev-charging/',
        note:'$2.00/hour, with a $6.00 overnight maximum off-street and a $6.00 flat rate on-street 9pm–6am.' }) }
  ],
  plans:[], source:'https://greenp.com/ev-charging/', lastVerified:'2026-08-10'
},
{
  id:'electrify-canada', name:'Electrify Canada', country:'CA', currency:'CAD',
  authority:'per-site',
  authorityNote:'"Pricing is determined by charger location and your plan. Real-time pricing is available in the app or at the charger."',
  default: r({ kWh:0.65, cur:'CAD', conf:'estimated',
    idle:{ perMinute:0.40, graceMinutes:10 },
    src:'https://www.electrify-canada.ca/pricing/',
    note:'Base rate NOT published. $0.65/kWh is a midpoint of a Jan-2024 secondary report ($0.60–$0.70 by province) and is now over two years old — replace it with what the charger shows. The idle fee and plan fees below ARE published.',
    date:'2026-08-10' }),
  plans:[
    { id:'ec-pass', name:'Pass', monthlyFee:0, conf:'published', src:'https://www.electrify-canada.ca/mobile-app/' },
    { id:'ec-pass-plus', name:'Pass+', monthlyFee:7.00, discountPct:20, conf:'published',
      note:'Save up to 20% on charging. CAD.', src:'https://www.electrify-canada.ca/mobile-app/' }
  ],
  source:'https://www.electrify-canada.ca/faqs/', lastVerified:'2026-08-10'
},
{
  id:'tesla-ca', name:'Tesla Supercharger (Canada)', country:'CA', currency:'CAD',
  authority:'per-site',
  authorityNote:'Dynamic per-site, per-hour pricing shown only on the car touchscreen or in the app.',
  default: r({ kWh:0.55, cur:'CAD', conf:'estimated',
    idle:{ perMinute:0.50, graceMinutes:5 },
    src:'https://www.tesla.com/en_CA/support/supercharger-idle-fee',
    note:'No published rate table. $0.55/kWh is a rough community-level figure, not operator-published. The congestion fee (~$0.50 CAD/min, 5-minute grace, at ≥80% SOC on busy sites) IS published.',
    date:'2026-08-10' }),
  plans:[], source:'https://www.tesla.com/en_CA/support/supercharger', lastVerified:'2026-08-10'
},
{
  id:'flo', name:'FLO', country:'CA', currency:'CAD',
  authority:'host',
  authorityNote:'FLO does not set prices. Its own driver terms state charging fees "are set by Charging Station owners… at their sole discretion." Rates are visible only in the FLO app, per station.',
  default: NO_RATE({ cur:'CAD', src:'https://www.flo.com/en-ca/driver-terms-of-use/',
    note:'Hosts may use a flat session rate, time-based billing (to the second) or per-kWh. FLO supports only simple flat tariffs — no time-of-use, no kWh+time combinations, no kWh combined with idle fees.' }),
  plans:[], source:'https://www.flo.com/en-ca/driver-terms-of-use/', lastVerified:'2026-08-10'
},
{
  id:'chargepoint-ca', name:'ChargePoint (Canada)', country:'CA', currency:'CAD',
  authority:'host',
  authorityNote:'Site hosts set all rates. In Canada hosts may bill by time OR by kWh (unlike the US, which is kWh-only).',
  default: NO_RATE({ cur:'CAD', src:'https://www.chargepoint.com/drivers/support/faqs/what-are-pricing-policies-and-fees-i-should-be-aware',
    note:'ChargePoint\'s own Service, Guest and Convenience fee amounts are not published for Canada.' }),
  plans:[], source:'https://www.chargepoint.com/drivers/support/faqs/what-are-pricing-policies-and-fees-i-should-be-aware',
  lastVerified:'2026-08-10'
},
{
  id:'ca-provincial-estimate', name:'Canadian provincial average (rough estimate)',
  country:'CA', currency:'CAD', authority:'host',
  authorityNote:'Not a real network. A fallback so you can sanity-check a cost when you do not know the operator.',
  default: r({ kWh:0.56, cur:'CAD', conf:'estimated',
    src:'https://www.paren.com/',
    note:'Aggregate provincial averages reported for 2026: BC ~$0.42, Ontario ~$0.60, Alberta ~$0.67 per kWh. $0.56 is a rough national midpoint. Use only as a sanity check, never as a real price.',
    date:'2026-08-10' }),
  regions:[
    { id:'ca-bc', name:'British Columbia', provinces:['BC'],
      rate: r({ kWh:0.42, cur:'CAD', conf:'estimated', src:'https://www.paren.com/' }) },
    { id:'ca-on', name:'Ontario', provinces:['ON'],
      rate: r({ kWh:0.60, cur:'CAD', conf:'estimated', src:'https://www.paren.com/' }) },
    { id:'ca-ab', name:'Alberta', provinces:['AB'],
      rate: r({ kWh:0.67, cur:'CAD', conf:'estimated', src:'https://www.paren.com/' }) }
  ],
  plans:[], source:'https://www.paren.com/', lastVerified:'2026-08-10'
},

/* ------------------------------------------------------ HOME / WORKPLACE -- */
{
  id:'home-us', selfSupplied:true, name:'Home electricity (US)', country:'US', currency:'USD',
  authority:'network', authorityNote:'Your own utility rate. Set it to what you actually pay.',
  default: r({ kWh:0.17, cur:'USD', conf:'estimated',
    note:'US residential average is roughly $0.17/kWh but varies enormously by state and by time of use. Replace this with your own tariff — it is the single easiest number for you to know exactly.',
    date:'2026-08-10' }),
  plans:[], lastVerified:'2026-08-10'
},
{
  id:'home-ca', selfSupplied:true, name:'Home electricity (Canada)', country:'CA', currency:'CAD',
  authority:'network', authorityNote:'Your own utility rate. Set it to what you actually pay.',
  default: r({ kWh:0.13, cur:'CAD', conf:'estimated',
    note:'Canadian residential rates vary widely by province (Quebec low, Alberta and the Maritimes higher). Replace with your own tariff.',
    date:'2026-08-10' }),
  plans:[], lastVerified:'2026-08-10'
},
{
  id:'free-workplace', selfSupplied:true, name:'Free charging (workplace / destination)', country:'US', currency:'USD',
  authority:'network', authorityNote:'Genuinely free charging — still worth modelling so trip totals are right.',
  default: r({ kWh:0, min:0, session:0, cur:'USD', conf:'published',
    note:'No cost. Idle fees may still apply at some free sites — add one if yours does.', date:'2026-08-10' }),
  plans:[], lastVerified:'2026-08-10'
}
];

/* =========================================================================
   WHERE ARE YOU?
   Several networks price by state or province, so knowing the jurisdiction
   picks the right rate. A ZIP or postal code is the thing a driver actually
   knows, so it is accepted directly and mapped locally — no lookup service,
   no network call, works in a car park with no signal.

   ZIP prefixes are allocated in contiguous blocks by state, so a range table
   is exact for the first three digits and costs a few hundred bytes.
   ========================================================================= */
const ZIP3_RANGES = [
  ['MA',10,27],['RI',28,29],['NH',30,38],['ME',39,49],['VT',50,59],['CT',60,69],
  ['NJ',70,89],['NY',100,149],['PA',150,196],['DE',197,199],['DC',200,205],
  ['MD',206,219],['VA',220,246],['WV',247,268],['NC',270,289],['SC',290,299],
  ['GA',300,319],['FL',320,349],['AL',350,369],['TN',370,385],['MS',386,397],
  ['GA',398,399],['KY',400,427],['OH',430,459],['IN',460,479],['MI',480,499],
  ['IA',500,528],['WI',530,549],['MN',550,567],['SD',570,577],['ND',580,588],
  ['MT',590,599],['IL',600,629],['MO',630,658],['KS',660,679],['NE',680,693],
  ['LA',700,714],['AR',716,729],['OK',730,749],['TX',750,799],['CO',800,816],
  ['WY',820,831],['ID',832,838],['UT',840,847],['AZ',850,865],['NM',870,884],
  ['TX',885,885],['NV',889,898],['CA',900,961],['HI',967,968],['OR',970,979],
  ['WA',980,994],['AK',995,999]
];
/* Canadian postal codes encode the province in the first letter. */
const POSTAL_PROVINCE = {
  A:'NL', B:'NS', C:'PE', E:'NB', G:'QC', H:'QC', J:'QC',
  K:'ON', L:'ON', M:'ON', N:'ON', P:'ON', R:'MB', S:'SK', T:'AB', V:'BC',
  X:'NT', Y:'YT'
};

/**
 * "48307" -> { country:'US', state:'MI' }
 * "L5B 3Y6" -> { country:'CA', province:'ON' }
 * Returns null when it cannot tell, rather than guessing a jurisdiction.
 */
function regionFromPostal(code) {
  const t = String(code || '').trim().toUpperCase();
  if (!t) return null;
  if (/^\d{5}/.test(t)) {
    const z3 = parseInt(t.slice(0, 3), 10);
    const hit = ZIP3_RANGES.find(([, lo, hi]) => z3 >= lo && z3 <= hi);
    return hit ? { country:'US', state:hit[0], postal:t.slice(0, 5) } : null;
  }
  if (/^[A-Z]\d[A-Z]/.test(t)) {
    const p = POSTAL_PROVINCE[t[0]];
    return p ? { country:'CA', province:p, postal:t.slice(0, 3) } : null;
  }
  return null;
}

/** Which networks actually price differently by jurisdiction? */
function networksWithRegionalPricing(country) {
  return NETWORKS.filter(n => (!country || n.country === country) &&
    (n.regions || []).some(g => (g.states || []).length || (g.provinces || []).length));
}

/* =========================================================================
   RESOLUTION — site → region → state/province → network default
   ========================================================================= */
function findNetwork(id) { return NETWORKS.find(n => n.id === id) || null; }

/*
 * A regional rate says what the ENERGY costs there. It is not a statement
 * that the network's session and idle fees stopped existing — EVgo's $0.99
 * Pay As You Go session fee applies in Michigan exactly as it does anywhere
 * else. So a region inherits any fee it does not itself override. Getting
 * this wrong silently deleted a real charge from every regional quote.
 */
function inheritFees(rate, fallback) {
  if (!rate || !fallback) return rate;
  const out = Object.assign({}, rate);
  if (out.sessionFee == null && fallback.sessionFee != null) out.sessionFee = fallback.sessionFee;
  if (out.idle == null && fallback.idle != null) out.idle = fallback.idle;
  return out;
}

function resolveRate(network, ctx) {
  ctx = ctx || {};
  if (!network) return null;
  // A user-saved price always wins, exactly like the measured-rate override.
  if (ctx.userRate) return Object.assign({}, ctx.userRate, { confidence: 'user' });

  const regions = network.regions || [];
  let hit = null;

  if (ctx.regionId) hit = regions.find(g => g.id === ctx.regionId);
  if (!hit && ctx.level === 'AC') hit = regions.find(g => g.level === 'AC');
  if (!hit && ctx.stationKW) {
    // Pick the tightest station-power band that still covers this charger.
    const banded = regions.filter(g => g.maxStationKW && g.maxStationKW >= ctx.stationKW)
      .sort((a, b) => a.maxStationKW - b.maxStationKW);
    if (banded.length) hit = banded[0];
  }
  if (!hit && ctx.state)    hit = regions.find(g => (g.states || []).includes(ctx.state));
  if (!hit && ctx.province) hit = regions.find(g => (g.provinces || []).includes(ctx.province));

  if (hit) return inheritFees(hit.level === 'AC' && hit.rate ? hit.rate : (hit.rate || hit.acRate),
                             network.default);
  if (ctx.level === 'AC' && network.acRate) return network.acRate;
  if (network.default) return network.default;
  // Networks defined purely by region (EVCS) have no national default — fall
  // back to the first non-AC-specific region rather than reporting no rate.
  const first = regions.find(g => g.level !== 'AC') || regions[0];
  return first ? (first.rate || first.acRate || null) : null;
}

/* Days since a rate was verified, and whether to warn about it. */
function ageDays(rate, today) {
  if (!rate || !rate.lastVerified) return null;
  const t = today ? new Date(today) : new Date();
  const d = new Date(rate.lastVerified);
  if (isNaN(d)) return null;
  return Math.floor((t - d) / 86400000);
}
function isStale(rate, today) {
  const a = ageDays(rate, today);
  return a != null && a > STALE_DAYS;
}

/* =========================================================================
   COST OF A SESSION
   Takes a simulation from EVCore plus a rate and (optionally) a plan.
   ========================================================================= */

/* Effective per-kWh under a plan: explicit plan rate beats a percentage off. */
/* ---- THE ARITHMETIC GATE ------------------------------------------------
   A rate READ OFF A CHARGER by a member already has that member's discount in
   it. Applying the plan discount again takes 30% off twice. Measured against
   the settled KATHLEEN receipt: $0.3100/kWh observed as a PlusMax member became
   $0.2170, and the session read $20.13 against a true $28.76. Always low, and
   low by a believable margin, so nothing catches it by eye.

   A discount may therefore only be applied when we POSITIVELY KNOW the rate is
   a rack rate. `observedUnderPlan === null` is that positive knowledge -- a
   deliberate "no plan was active, this is the public price". Anything else,
   including the field being ABSENT (every rate saved before this build), is
   unknown, and unknown means do not discount.

   Failing this way costs the user a discount they may be owed. Failing the
   other way tells them a session is 30% cheaper than it is. Only one of those
   is recoverable at the charger.                                            */
function discountEligibility(rate, plan) {
  if (!plan) return { apply: false, reason: null };
  if (!rate || rate.confidence !== 'user') return { apply: true, reason: null };

  if (!('observedUnderPlan' in rate))
    return { apply: false, code: 'untagged', reason:
      'This saved rate was recorded before the app tracked which plan you were on, ' +
      'so it is not known whether a member discount is already in it. Shown as entered, ' +
      'with no further discount applied. Re-save it to clear this.' };

  if (rate.observedUnderPlan === null) return { apply: true, reason: null };

  if (rate.observedUnderPlan === plan.id)
    return { apply: false, code: 'already-applied', reason:
      'You entered this price while on ' + plan.name + ', so the member discount is ' +
      'already in it. Applying it again would take it off twice.' };

  return { apply: false, code: 'other-plan', reason:
    'This price was recorded on a different plan (' + rate.observedUnderPlan + ') than the ' +
    'one selected. There is no way to convert one to the other without knowing what that ' +
    'station charged, so it is shown as entered.' };
}

function planRate(rate, plan) {
  if (!plan) return rate;
  const gate = discountEligibility(rate, plan);
  if (!gate.apply) {
    const out = Object.assign({}, rate, { discountBlocked: gate.code || null,
                                          discountNote: gate.reason || null });
    /* Fee waivers are a property of HOLDING the plan, not of the rate's
       provenance, so they still apply. */
    if (plan.waivesSessionFee) out.sessionFee = 0;
    if (plan.waivesIdleFee && out.idle) out.idle = null;
    return out;
  }
  const out = Object.assign({}, rate);
  if (plan.perKWh != null && rate.perKWh != null) out.perKWh = plan.perKWh;
  else if (plan.discountPct && rate.perKWh != null) out.perKWh = rate.perKWh * (1 - plan.discountPct / 100);
  if (plan.perMinute != null && rate.perMinute != null) out.perMinute = plan.perMinute;
  else if (plan.discountPct && rate.perMinute != null) out.perMinute = rate.perMinute * (1 - plan.discountPct / 100);
  if (plan.discountPct && rate.perHour != null) out.perHour = rate.perHour * (1 - plan.discountPct / 100);
  if (plan.waivesSessionFee) out.sessionFee = 0;
  if (plan.waivesIdleFee && out.idle) out.idle = null;
  /* A membership discount applies to every TOU window, not just the headline
     rate -- otherwise a plan looks worthless to anyone charging off-peak. */
  if (rate.tou && rate.tou.windows && (plan.discountPct || plan.perKWh != null)) {
    out.tou = Object.assign({}, rate.tou, {
      windows: rate.tou.windows.map(w => {
        const nw = Object.assign({}, w);
        if (plan.perKWh != null && w.perKWh != null) nw.perKWh = plan.perKWh;
        else if (plan.discountPct && w.perKWh != null) nw.perKWh = w.perKWh * (1 - plan.discountPct / 100);
        if (plan.discountPct && w.perMinute != null) nw.perMinute = w.perMinute * (1 - plan.discountPct / 100);
        if (plan.discountPct && w.perHour != null) nw.perHour = w.perHour * (1 - plan.discountPct / 100);
        return nw;
      })
    });
  }
  return out;
}

/*
 * Power-banded rates (Circuit Électrique): the billing basis changes with the
 * power actually being delivered, so cost must be integrated over the session
 * timeline rather than multiplied out at the end.
 */
function bandedCost(sim, rate) {
  let energyCost = 0, timeCost = 0;
  const tl = sim.timeline;
  for (let i = 1; i < tl.length; i++) {
    const dtMin = tl[i].min - tl[i - 1].min;
    if (dtMin <= 0) continue;
    const kW = tl[i].kW;
    const soc = tl[i].soc;
    // Past the punitive SOC threshold, the punitive hourly rate takes over.
    if (rate.afterSOC && soc >= rate.afterSOC.soc && rate.afterSOC.perHour != null) {
      timeCost += rate.afterSOC.perHour * (dtMin / 60);
      continue;
    }
    const band = rate.powerBands.find(b => kW <= b.maxKW) ||
                 rate.powerBands[rate.powerBands.length - 1];
    if (band.perHour != null) timeCost += band.perHour * (dtMin / 60);
    else if (band.perKWh != null) energyCost += band.perKWh * (kW * dtMin / 60);
  }
  return { energyCost, timeCost };
}

/* =========================================================================
   TIME-OF-USE
   Several networks (EVgo network-wide, EVCS on its Off-Peak plan, most
   utility-run networks) charge a different rate depending on the clock. A
   dwell planner already knows when you arrive and how long you are staying,
   so it can bill the correct band instead of an all-day average -- and, more
   usefully, tell you that waiting forty minutes moves the whole session into
   a cheaper one.

   Windows are half-open [startHour, endHour) in STATION-LOCAL time and may
   wrap past midnight (startHour > endHour). Hours may be fractional.
   ========================================================================= */

/** Which TOU window covers this clock hour? null if none matches. */
function touWindowAt(tou, hour) {
  if (!tou || !tou.windows) return null;
  const h = ((hour % 24) + 24) % 24;
  for (const w of tou.windows) {
    const wraps = w.startHour > w.endHour;
    if (wraps ? (h >= w.startHour || h < w.endHour)
              : (h >= w.startHour && h < w.endHour)) return w;
  }
  return null;
}

/** Minutes from `hour` until `target` o'clock comes round again. */
function minutesUntilHour(hour, target) {
  const d = (((target - hour) % 24) + 24) % 24;
  return Math.round(d * 60);
}

/**
 * Integrate a session across TOU windows.
 * startClockMin: minutes past local midnight at which the session begins.
 * Returns total cost plus a per-window breakdown for the UI.
 */
function touCost(sim, tou, startClockMin) {
  const tl = sim.timeline || [];
  const byWindow = {};
  let energyCost = 0, timeCost = 0, billedKWh = 0;

  for (let i = 1; i < tl.length; i++) {
    const dtMin = tl[i].min - tl[i - 1].min;
    if (dtMin <= 0) continue;
    const kW = tl[i].kW;
    // Bill each slice at the window covering its MIDPOINT. At a 15 s step the
    // error at a window boundary is at most half a step.
    const midMin = startClockMin + tl[i - 1].min + dtMin / 2;
    const w = touWindowAt(tou, midMin / 60);
    const kWh = kW * dtMin / 60;
    billedKWh += kWh;

    let cost = 0;
    if (w) {
      if (w.perKWh   != null) cost += w.perKWh * kWh;
      if (w.perMinute != null) cost += w.perMinute * dtMin;
      if (w.perHour  != null) cost += w.perHour * (dtMin / 60);
      if (w.perKWh != null) energyCost += w.perKWh * kWh;
      else timeCost += cost;
    }
    const key = w ? w.id : 'unbanded';
    const b = byWindow[key] || (byWindow[key] = {
      id:key, name: w ? w.name : 'Outside published windows',
      minutes:0, kWh:0, cost:0, perKWh: w ? w.perKWh : null });
    b.minutes += dtMin; b.kWh += kWh; b.cost += cost;
  }

  const breakdown = Object.keys(byWindow).map(k => byWindow[k])
    .sort((a, b) => b.minutes - a.minutes);
  return { energyCost, timeCost, total: energyCost + timeCost, billedKWh, breakdown };
}

/**
 * Would starting later be cheaper? Compares the session as planned against
 * the same session run entirely inside each other window, and returns the
 * best saving. Deliberately conservative: it only claims a saving it can
 * compute from the same simulation, and it reports the wait honestly.
 */
function touAdvice(sim, tou, startClockMin, opts) {
  if (!tou || !tou.windows || tou.windows.length < 2) return null;
  opts = opts || {};
  // "Save $22 by waiting seven hours" is technically true and useless. Only
  // offer a wait somebody might actually take; report the cheapest window
  // separately as background, without dressing it up as a suggestion.
  const maxWait = opts.maxWaitMinutes != null ? opts.maxWaitMinutes : 180;
  const asPlanned = touCost(sim, tou, startClockMin);
  const nowHour = (startClockMin / 60) % 24;
  const current = touWindowAt(tou, nowHour);

  let best = null, cheapest = null;
  for (const w of tou.windows) {
    if (current && w.id === current.id) continue;
    const alt = touCost(sim, tou, w.startHour * 60);
    const saving = asPlanned.total - alt.total;
    const waitMin = minutesUntilHour(nowHour, w.startHour);
    const cand = { window:w, saving, waitMinutes:waitMin, altTotal:alt.total };
    if (saving > 0.01) {
      if (!cheapest || saving > cheapest.saving) cheapest = cand;
      if (waitMin <= maxWait && (!best || saving > best.saving)) best = cand;
    }
  }
  return { current, asPlannedTotal: asPlanned.total, best, cheapest,
           breakdown: asPlanned.breakdown };
}

/*
 * sessionCost — the core output.
 * sim:        result from EVCore.simulate
 * rate:       resolved rate
 * opts.plan:  membership plan
 * opts.dwellMinutes: total time plugged in (may exceed charging time → idle)
 */
/*
 * How long was the car ACTUALLY charging?
 * When a session is simulated for a fixed dwell, sim.minutes is the dwell —
 * the car may have finished hours earlier. sim.chargeMinutes is the real
 * charging time. Getting this wrong silently disables every idle-fee warning,
 * which is the single feature this app exists to provide.
 */
function chargeMinutesOf(sim) {
  if (sim.chargeMinutes != null) return sim.chargeMinutes + (sim.precondMinutes || 0);
  return sim.minutes || 0;
}

function sessionCost(sim, rate, opts) {
  opts = opts || {};
  if (!rate) return { available:false, reason:'No rate for this network.' };
  const R = planRate(rate, opts.plan);

  const hasAny = R.perKWh != null || R.perMinute != null || R.perHour != null ||
                 R.sessionFee != null || R.powerBands || (R.tou && R.tou.windows);
  if (!hasAny) {
    return { available:false, confidence:'unavailable',
      reason:'This operator does not publish a rate. Enter what the charger shows and it will be used instead.',
      network:opts.network || null };
  }

  /* Bill on energy OUT OF THE DISPENSER, not into the pack. The meter sits on
     the charger side, so charging losses are on your bill. On AC that gap is
     ~11% and larger in the cold. */
  const kWh = (sim.deliveredKWh != null ? sim.deliveredKWh : sim.energyKWh) || 0;
  const chargeMin = chargeMinutesOf(sim);
  const dwellMin = opts.dwellMinutes != null ? opts.dwellMinutes : chargeMin;

  /* Time of use, when the network has windows AND we know the clock. Without
     a start time we cannot say which band applies, so we fall back to the
     flat rate rather than silently guessing one. */
  const useTOU = !!(R.tou && R.tou.windows && opts.startClockMinutes != null);
  let tou = null, touTips = null;

  let energyCost = 0, timeCost = 0;
  if (useTOU) {
    tou = touCost(sim, R.tou, opts.startClockMinutes);
    energyCost = tou.energyCost; timeCost = tou.timeCost;
    touTips = touAdvice(sim, R.tou, opts.startClockMinutes);
  } else if (R.powerBands) {
    const b = bandedCost(sim, R);
    energyCost = b.energyCost; timeCost = b.timeCost;
  } else {
    if (R.perKWh != null)    energyCost += R.perKWh * kWh;
    if (R.perMinute != null) timeCost   += R.perMinute * chargeMin;
    if (R.perHour != null)   timeCost   += R.perHour * (chargeMin / 60);
  }
  const sessionFee = R.sessionFee != null ? R.sessionFee : 0;

  /* ---- IDLE FEES — the thing this app exists to warn about --------------
     A dwell planner's users routinely leave a car plugged in long after it
     finishes. If you park 8 hours and hit 100% at hour 5, three hours of
     idle fees may be accruing while you are nowhere near the car.          */
  const idle = idleAnalysis(sim, dwellMin, R);

  /* ---- SALES TAX -----------------------------------------------------
     The settled EVgo receipt shows the order plainly: energy and fees are
     summed into a subtotal, THEN tax is applied to that subtotal. Tax is not
     part of the per-kWh rate and must never be folded into it, because a
     discount applies to the pre-tax subtotal. A rate that already includes
     tax (taxIncluded) is left alone.                                       */
  const subTotal = energyCost + timeCost + sessionFee + idle.cost;
  const taxPct = opts.taxPct != null ? opts.taxPct
               : (R.taxIncluded ? 0 : (R.taxPct != null ? R.taxPct : 0));
  const tax = subTotal * (taxPct / 100);
  const total = subTotal + tax;

  return {
    available:true,
    currency: R.currency,
    confidence: R.confidence,
    source: R.source,
    lastVerified: R.lastVerified,
    stale: isStale(R, opts.today),
    ageDays: ageDays(R, opts.today),
    note: R.note,
    taxIncluded: R.taxIncluded,
    energyCost, timeCost, sessionFee,
    subTotal, taxPct, tax,
    idleCost: idle.cost,
    idle,
    tou, touAdvice: touTips,
    touConfidence: R.tou ? (R.tou.confidence || R.confidence) : null,
    total,
    kWh,
    costPerKWh: kWh > 0 ? total / kWh : null,
    /* Fees as distinct from energy — fleet buyers care about this split. */
    feesTotal: sessionFee + idle.cost,
    basis: useTOU ? 'time-of-use'
         : R.powerBands ? 'power-banded'
         : (R.perKWh != null && (R.perMinute != null || R.perHour != null)) ? 'energy+time'
         : R.perKWh != null ? 'energy'
         : (R.perMinute != null || R.perHour != null) ? 'time'
         : 'session-only'
  };
}

/*
 * idleAnalysis — when does charging finish, and what does sitting there cost?
 * Returns a warning payload even when the fee is zero, because "you will be
 * done 3 hours before you leave" is useful on its own.
 */
function idleAnalysis(sim, dwellMinutes, rate) {
  const chargeMin = chargeMinutesOf(sim);
  const finished = sim.endSOC >= 99.99 || sim.stalled;
  const idleMinutesRaw = Math.max(0, (dwellMinutes || 0) - chargeMin);
  const grace = rate && rate.idle && rate.idle.graceMinutes != null ? rate.idle.graceMinutes : 0;
  const billable = Math.max(0, idleMinutesRaw - grace);

  let cost = 0, rateLabel = null;
  if (rate && rate.idle && billable > 0) {
    const cur = rate.currency || 'USD';
    if (rate.idle.perMinute != null) { cost = rate.idle.perMinute * billable; rateLabel = money(rate.idle.perMinute, cur) + '/min'; }
    else if (rate.idle.perHour != null) { cost = rate.idle.perHour * (billable / 60); rateLabel = money(rate.idle.perHour, cur) + '/hr'; }
  }

  /* Time-billed networks that charge on total CONNECTED time (NB Power) have
     no separate idle fee — the meter simply never stops. Flag that too. */
  const connectedTimeBilling = !!(rate && (rate.perMinute != null || rate.perHour != null) && !rate.idle);

  return {
    chargeCompleteMinutes: chargeMin,
    finishesEarly: finished && idleMinutesRaw > 0,
    idleMinutes: idleMinutesRaw,
    graceMinutes: grace,
    billableMinutes: billable,
    cost,
    rateLabel,
    connectedTimeBilling,
    warn: (cost > 0) || (connectedTimeBilling && idleMinutesRaw > 15) || (finished && idleMinutesRaw > 30)
  };
}

/* =========================================================================
   MEMBERSHIP BREAK-EVEN
   "This plan pays for itself after N sessions a month."
   ========================================================================= */
function breakEven(network, baseCostPerSession, sessionsPerMonth) {
  if (!network || !network.plans || !network.plans.length) return [];
  const out = [];
  const free = network.plans.find(p => !p.monthlyFee) || null;
  const freeCost = baseCostPerSession;

  network.plans.forEach(plan => {
    const fee = plan.monthlyFee || 0;
    // What one session costs under this plan.
    let per = baseCostPerSession;
    if (plan.perKWh != null && baseCostPerSession.kWhOnly != null) per = null;
    const saving = plan.discountPct
      ? baseCostPerSession * (plan.discountPct / 100)
      : 0;
    const sessions = saving > 0 ? fee / saving : null;
    const monthlyAtUsage = sessionsPerMonth != null
      ? fee + (baseCostPerSession - saving) * sessionsPerMonth
      : null;
    out.push({
      planId: plan.id, name: plan.name, monthlyFee: fee,
      discountPct: plan.discountPct || 0,
      savingPerSession: saving,
      breakEvenSessions: sessions != null ? Math.ceil(sessions * 100) / 100 : null,
      monthlyTotalAtUsage: monthlyAtUsage,
      waivesSessionFee: !!plan.waivesSessionFee,
      confidence: plan.confidence || plan.conf || 'published',
      note: plan.note || null
    });
  });

  out.sort((a, b) => (a.monthlyTotalAtUsage == null ? 1e12 : a.monthlyTotalAtUsage) -
                     (b.monthlyTotalAtUsage == null ? 1e12 : b.monthlyTotalAtUsage));
  if (out.length) out[0].cheapest = true;
  return out;
}

/* =========================================================================
   FORMATTING
   ========================================================================= */
function money(v, cur, dp) {
  if (v == null || !isFinite(v)) return '—';
  const sym = cur === 'CAD' ? 'CA$' : '$';
  return sym + v.toFixed(dp != null ? dp : 2);
}
function confidenceLabel(c) {
  return { published:'Published by the operator',
           secondary:'From third-party reporting',
           estimated:'Estimate — not operator-published',
           user:'Your own entry',
           unavailable:'Not published' }[c] || c;
}

const AUTHORITY_LABEL = {
  network:'Network sets one published rate',
  'per-site':'Network sets the price, but publishes it only in-app or on the charger',
  host:'The site owner sets the price — no network rate exists'
};

function networksFor(country) {
  return NETWORKS.filter(n => !country || n.country === country);
}

return {
  DATA_VERSION, STALE_DAYS, FX_DEFAULT, NETWORKS,
  findNetwork, networksFor, resolveRate, planRate,
  sessionCost, idleAnalysis, breakEven, bandedCost, chargeMinutesOf,
  discountEligibility,
  touWindowAt, touCost, touAdvice, minutesUntilHour,
  regionFromPostal, networksWithRegionalPricing,
  convert, money, confidenceLabel, ageDays, isStale,
  AUTHORITY_LABEL, r
};
}));

