/* =========================================================================
   EV DWELL PLANNER — VEHICLE LIBRARY & STATION PRESETS
   Pack variant is a first-class, MANDATORY field. Make+model is never enough.
   Every curve carries a confidence flag so the UI can be honest about it.
   ========================================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EVLibrary = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

/* Curve confidence:
   'observed'  — built from real logged charging sessions (this vehicle)
   'published' — from manufacturer / reputable published curve data
   'estimated' — normalised shape scaled to a published peak; VERIFY

   Hand-authoring a measured curve for every car on sale is not possible, and
   inventing precise-looking numbers would be worse than useless. So entries
   below carry a published peak power and a platform shape, and the curve is
   generated from those two facts. The result is right in magnitude and right
   in character, honest about being an estimate, and editable point by point.  */

/* Normalised taper templates: fraction of peak power at each SOC.

   KNOWN WEAKNESS — the '800v' template is pessimistic in the upper SOC band.
   One logged session (GMC Hummer SUT 24-module, 62->99% in 51.78 min, see
   observations/2026-08-12-kathleen-evgo-rochester-hills.json) took ~40% less
   time than this template predicts. The '800v' template is shared by ~50
   vehicles, so if that bias is real it affects all of them in the same
   direction: dwell times too long, departure SOC too low.
   ONE session is not enough to recalibrate a template, so the numbers below
   are unchanged. It is disclosed here rather than silently corrected. Re-earn
   the calibration from several sessions across several SOC ranges. */
const SHAPE = {
  // 800 V packs hold high power much further up the SOC range.
  '800v': [[0,.86],[5,.96],[10,1],[15,1],[20,.96],[30,.92],[40,.87],[50,.77],
           [55,.66],[60,.54],[65,.42],[70,.34],[80,.25],[90,.17],[95,.11],[100,.04]],
  // 400 V packs start tapering earlier and more steadily.
  '400v': [[0,.90],[5,.98],[10,1],[15,.98],[20,.90],[30,.76],[40,.62],[50,.50],
           [60,.40],[70,.31],[80,.23],[90,.15],[95,.10],[100,.03]],
  // LFP chemistry: flatter early, sharper cliff late.
  'lfp':  [[0,.92],[5,.99],[10,1],[20,.95],[30,.88],[40,.80],[50,.70],[60,.58],
           [70,.45],[80,.30],[90,.16],[95,.09],[100,.03]]
};

function curveFrom(peakKW, shape) {
  return (SHAPE[shape] || SHAPE['400v']).map(([soc, f]) => ({
    soc, kW: Math.round(peakKW * f * 10) / 10
  }));
}

/* Compact declaration: curves are generated unless an explicit one is given. */
function veh(o) {
  if (!o.dcCurve) {
    o.dcCurve = curveFrom(o.peakDcKW, o.curveShape);
    o.curveConfidence = o.curveConfidence || 'estimated';
    o.curveNote = o.curveNote ||
      `Shape generated from a published ${o.peakDcKW} kW peak on a ${o.packArchitectureV} V pack. ` +
      `Right in magnitude and character, but not measured from this car — log a real session and correct it here.`;
  }
  o.yearTo = o.yearTo || o.yearFrom;
  o.year = o.yearTo;               // newest year, for display
  if (o.dcCapable == null) o.dcCapable = true;
  return o;
}

/* Terse constructor so a market-wide catalogue stays readable.
   v(id, yearFrom, yearTo, make, model, variant, usableKWh, acKW, peakDC, packV, opts)
   opts: nacs, chademo, shape, lv (400 V-station cap), acEff, dcEff, noDC, extra */
function v(id, y1, y2, make, model, variant, kWh, acKW, peak, arch, o) {
  o = o || {};
  return veh(Object.assign({
    id, yearFrom: y1, yearTo: y2, make, model, packVariant: variant,
    usableKWh: kWh, acMaxKW: acKW, peakDcKW: peak, packArchitectureV: arch,
    nativeAC: o.nacs ? 'NACS_AC' : 'J1772',
    nativeDC: o.nacs ? 'NACS_DC' : (o.chademo ? 'CHADEMO' : 'CCS1'),
    curveShape: o.shape || (arch >= 700 ? '800v' : '400v'),
    lowVoltStationMaxKW: o.lv || null,
    modules: o.modules || null,      // lets a VIN-reported module count pick the variant
    acEfficiency: o.acEff || 0.89,
    dcEfficiency: o.dcEff || (arch >= 700 ? 0.96 : 0.95),
    dcCapable: o.noDC ? false : true
  }, o.extra || {}));
}

/* ===========================================================================
   NORTH AMERICAN BEV CATALOGUE  (US / Canada / Mexico, non-Chinese brands)
   Model years ~2011-2026. Battery-electric only — no PHEVs, no hydrogen.

   Capacities are USABLE kWh where known. Peak DC figures are manufacturer or
   widely-reported published numbers. Curve SHAPES are generated from peak +
   pack architecture, never measured — so every entry except the 24-module
   Hummer is flagged 'estimated'. Correct any of it on the vehicle screen.
   =========================================================================== */
/* ===========================================================================
   NORTH AMERICAN BEV CATALOGUE  (US / Canada / Mexico, non-Chinese brands)
   Model years ~2011-2026. Battery-electric only — no PHEVs, no hydrogen.

   Capacities are USABLE kWh where known. Peak DC figures are manufacturer or
   widely-reported published numbers. Curve SHAPES are generated from peak +
   pack architecture, never measured — so every entry except the 24-module
   Hummer is flagged 'estimated'. Correct any of it on the vehicle screen.
   =========================================================================== */
const LIBRARY = [

  /* ============================== TESLA (NACS native) ==================== */
  v('tesla-s-60',2012,2015,'Tesla','Model S','60 / 60D (~58 kWh usable)',58,11.5,120,400,{nacs:1}),
  v('tesla-s-85',2012,2016,'Tesla','Model S','85 / P85D (~77 kWh usable)',77,11.5,120,400,{nacs:1}),
  v('tesla-s-75d',2016,2019,'Tesla','Model S','75D (~72.6 kWh usable)',72.6,11.5,120,400,{nacs:1}),
  v('tesla-s-100d',2016,2020,'Tesla','Model S','100D / P100D (~98.4 kWh usable)',98.4,11.5,145,400,{nacs:1}),
  v('tesla-s-lr',2021,2026,'Tesla','Model S','Long Range (~95 kWh usable)',95,11.5,250,400,{nacs:1}),
  v('tesla-s-plaid',2021,2026,'Tesla','Model S','Plaid (~95 kWh usable)',95,11.5,250,400,{nacs:1}),
  v('tesla-x-75d',2016,2019,'Tesla','Model X','75D (~72.6 kWh usable)',72.6,11.5,120,400,{nacs:1}),
  v('tesla-x-100d',2016,2020,'Tesla','Model X','100D / P100D (~98.4 kWh usable)',98.4,11.5,145,400,{nacs:1}),
  v('tesla-x-lr',2021,2026,'Tesla','Model X','Long Range (~95 kWh usable)',95,11.5,250,400,{nacs:1}),
  v('tesla-x-plaid',2021,2026,'Tesla','Model X','Plaid (~95 kWh usable)',95,11.5,250,400,{nacs:1}),
  v('tesla-3-sr',2019,2020,'Tesla','Model 3','Standard Range Plus (~50 kWh usable)',50,11.5,170,400,{nacs:1}),
  v('tesla-3-rwd-lfp',2021,2023,'Tesla','Model 3','RWD LFP (~57.5 kWh usable)',57.5,7.7,170,400,{nacs:1,shape:'lfp'}),
  v('tesla-3-lr',2018,2023,'Tesla','Model 3','Long Range AWD (~75 kWh usable)',75,11.5,250,400,{nacs:1}),
  v('tesla-3-perf',2018,2023,'Tesla','Model 3','Performance (~75 kWh usable)',75,11.5,250,400,{nacs:1}),
  v('tesla-3-highland-rwd',2024,2026,'Tesla','Model 3','Highland RWD LFP (~57.5 kWh usable)',57.5,7.7,170,400,{nacs:1,shape:'lfp'}),
  v('tesla-3-highland-lr',2024,2026,'Tesla','Model 3','Highland Long Range (~75 kWh usable)',75,11.5,250,400,{nacs:1}),
  v('tesla-3-highland-perf',2024,2026,'Tesla','Model 3','Highland Performance (~79 kWh usable)',79,11.5,250,400,{nacs:1}),
  v('tesla-y-rwd-lfp',2023,2026,'Tesla','Model Y','RWD LFP (~60 kWh usable)',60,11.5,170,400,{nacs:1,shape:'lfp'}),
  v('tesla-model-y-lr',2020,2026,'Tesla','Model Y','Long Range AWD (~75 kWh usable)',75,11.5,250,400,{nacs:1,extra:{curveConfidence:'published',curveNote:'NACS-native. No adapter at Superchargers; CCS1 posts need a NACS→CCS1 adapter.'}}),
  v('tesla-y-perf',2020,2026,'Tesla','Model Y','Performance (~75 kWh usable)',75,11.5,250,400,{nacs:1}),
  v('tesla-y-juniper',2025,2026,'Tesla','Model Y','Juniper Long Range (~78 kWh usable)',78,11.5,250,400,{nacs:1}),
  v('tesla-cybertruck-rwd',2025,2026,'Tesla','Cybertruck','RWD Long Range (~110 kWh usable)',110,11.5,325,800,{nacs:1,lv:150}),
  v('tesla-cybertruck-awd',2024,2026,'Tesla','Cybertruck','AWD (~123 kWh usable)',123,11.5,325,800,{nacs:1,lv:150}),
  v('tesla-cybertruck-beast',2024,2026,'Tesla','Cybertruck','Cyberbeast (~123 kWh usable)',123,11.5,325,800,{nacs:1,lv:150}),

  /* ============================== GMC (Ultium) ========================== */
  veh({ id:'gmc-hummer-sut-24', modules:24, yearFrom:2022, yearTo:2026, make:'GMC', model:'Hummer EV Pickup (SUT)',
    packVariant:'24-module Ultium (Edition 1 / 3X) — MY2022-2026', usableKWh:212.7, acMaxKW:19.2,
    nativeAC:'J1772', nativeDC:'CCS1', packArchitectureV:800, lowVoltStationMaxKW:185,
    acEfficiency:0.89, dcEfficiency:0.952, peakDcKW:350, curveShape:'800v',
    curveConfidence:'estimated',
    curveNote:'TEMPLATE, WITH THREE ANCHORS. Generated from the 800 V platform template at a 350 kW peak — the same way every other estimated curve in this library is built. It is NOT measured. Three real anchors exist and are consistent with it at the low end: 340+ kW at 13% SOC on a true 350 kW / 1000 V CCS post; ~183 kW at 40% through a NACS adapter on a Tesla V3, which is a 400 V-class station cap and does NOT constrain the native curve; and one full session, 62% to 99% in 51.78 min for 82.6275 kWh dispensed (Meijer 3175 S Rochester Rd, stall KATHLEEN, 12 Aug 2026, charger screen + settled receipt). A previous hand-authored curve sat roughly 30% BELOW this template across 55-95% SOC with no source, and was briefly labelled `observed` and refitted to that single session. Both were wrong; the hand edit has been removed rather than replaced with a new fit. KNOWN RESIDUAL BIAS: even the bare template predicts ~72 min for that 51.78 min session, so it remains ~40% pessimistic above 60% SOC. That is a property of the shared 800 V template, not of this vehicle — see the SHAPE note at the top of this file. It is recorded as data in observations/, not fitted away.',
    }),
  v('gmc-hummer-sut-20',2023,2026,'GMC','Hummer EV Pickup (SUT)','20-module Ultium (2X)',170,19.2,283,800,{modules:20,lv:155}),
  v('gmc-hummer-suv-20',2024,2026,'GMC','Hummer EV SUV','20-module Ultium (2X / 3X)',170,19.2,283,800,{modules:20,lv:155}),
  v('gmc-sierra-ev-denali',2024,2026,'GMC','Sierra EV','Denali Max Range (24-module)',205,19.2,350,800,{modules:24,lv:180}),
  v('gmc-sierra-ev-elevation',2025,2026,'GMC','Sierra EV','Elevation Extended Range',170,19.2,300,800,{modules:20,lv:160}),

  /* ============================== CHEVROLET ============================= */
  v('chevy-spark-ev',2014,2016,'Chevrolet','Spark EV','18.4 kWh',18.4,3.3,50,400,{acEff:.88,dcEff:.93}),
  v('chevy-bolt-2017',2017,2019,'Chevrolet','Bolt EV','60 kWh (~57 usable)',57,7.2,55,400,{acEff:.88,dcEff:.94}),
  v('chevy-bolt-2020',2020,2021,'Chevrolet','Bolt EV','65 kWh (7.2 kW onboard)',65,7.2,55,400,{acEff:.88,dcEff:.94}),
  v('chevy-bolt-2022',2022,2023,'Chevrolet','Bolt EV','65 kWh (11.5 kW onboard)',65,11.5,55,400,{acEff:.88,dcEff:.94}),
  v('chevy-bolt-euv',2022,2023,'Chevrolet','Bolt EUV','65 kWh',65,11.5,55,400,{acEff:.88,dcEff:.94}),
  v('chevy-blazer-ev',2024,2026,'Chevrolet','Blazer EV','LT / RS 85 kWh',85,11.5,150,400),
  v('chevy-blazer-ev-ss',2025,2026,'Chevrolet','Blazer EV','SS 102 kWh',102,11.5,190,400),
  v('chevy-equinox-ev',2024,2026,'Chevrolet','Equinox EV','LT / RS 85 kWh',85,11.5,150,400),
  v('chevy-silverado-wt',2024,2026,'Chevrolet','Silverado EV','Work Truck extended range',170,11.5,300,800,{modules:20,lv:160}),
  v('chevy-silverado-rst',2024,2026,'Chevrolet','Silverado EV','RST Max Range (24-module)',205,19.2,350,800,{modules:24,lv:180}),
  v('chevy-silverado-trail-boss',2026,2026,'Chevrolet','Silverado EV','Trail Boss',205,19.2,350,800,{modules:24,lv:180}),

  /* ============================== CADILLAC ============================== */
  v('cadillac-lyriq',2023,2026,'Cadillac','Lyriq','AWD / RWD 102 kWh (~100.4 usable)',100.4,19.2,190,400),
  v('cadillac-optiq',2025,2026,'Cadillac','Optiq','AWD 85 kWh',85,11.5,150,400),
  v('cadillac-vistiq',2026,2026,'Cadillac','Vistiq','AWD 102 kWh',102,19.2,190,400),
  v('cadillac-escalade-iq',2025,2026,'Cadillac','Escalade IQ','AWD (24-module, ~200 kWh)',200,19.2,350,800,{modules:24,lv:180}),
  v('cadillac-escalade-iql',2026,2026,'Cadillac','Escalade IQL','AWD (24-module, ~200 kWh)',200,19.2,350,800,{modules:24,lv:180}),
  v('cadillac-celestiq',2024,2026,'Cadillac','Celestiq','111 kWh',111,19.2,200,400),

  /* ============================== FORD ================================== */
  v('ford-focus-electric',2012,2016,'Ford','Focus Electric','23 kWh — J1772 only, NO DC port',23,6.6,0,400,{noDC:1,acEff:.88}),
  v('ford-focus-electric-2017',2017,2018,'Ford','Focus Electric','33.5 kWh (CCS1 optional)',33.5,6.6,50,400,{acEff:.88,dcEff:.93}),
  v('ford-mache-sr',2021,2026,'Ford','Mustang Mach-E','Standard Range LFP (~70 kWh usable)',70,10.5,115,400,{shape:'lfp'}),
  v('ford-mache-er-rwd',2021,2026,'Ford','Mustang Mach-E','Extended Range RWD (~91 kWh usable)',91,10.5,150,400),
  v('ford-mache-er-awd',2021,2026,'Ford','Mustang Mach-E','Extended Range AWD (~91 kWh usable)',91,10.5,150,400),
  v('ford-mache-gt',2021,2026,'Ford','Mustang Mach-E','GT / GT Performance (~91 kWh usable)',91,10.5,150,400),
  v('ford-mache-rally',2024,2026,'Ford','Mustang Mach-E','Rally (~91 kWh usable)',91,10.5,150,400),
  v('ford-lightning-sr',2022,2026,'Ford','F-150 Lightning','Standard Range 98 kWh',98,11.5,135,400),
  veh({ id:'ford-lightning-er', yearFrom:2022, yearTo:2026, make:'Ford', model:'F-150 Lightning',
    packVariant:'Extended Range 131 kWh', usableKWh:131, acMaxKW:19.2,
    nativeAC:'J1772', nativeDC:'CCS1', packArchitectureV:400,
    acEfficiency:0.89, dcEfficiency:0.95, peakDcKW:155, curveShape:'400v',
    curveConfidence:'published',
    curveNote:'Published curve shape. 400 V architecture, so no 400 V-station penalty.' }),
  v('ford-e-transit',2022,2023,'Ford','E-Transit','68 kWh',68,11.3,115,400),
  v('ford-e-transit-2024',2024,2026,'Ford','E-Transit','89 kWh (extended range)',89,19.2,180,400),

  /* ============================== RIVIAN ================================ */
  v('rivian-r1t-standard',2024,2026,'Rivian','R1T','Standard pack ~92.5 kWh',92.5,11.5,220,400),
  v('rivian-r1t-large',2022,2026,'Rivian','R1T','Large pack ~135 kWh',135,11.5,220,400),
  v('rivian-r1t-max',2023,2026,'Rivian','R1T','Max pack ~170 kWh',170,11.5,220,400),
  v('rivian-r1s-standard',2024,2026,'Rivian','R1S','Standard pack ~92.5 kWh',92.5,11.5,220,400),
  v('rivian-r1s-large',2022,2026,'Rivian','R1S','Large pack ~128.9 kWh',128.9,11.5,220,400),
  v('rivian-r1s-max',2023,2026,'Rivian','R1S','Max pack ~170 kWh',170,11.5,220,400),
  v('rivian-edv',2022,2026,'Rivian','Commercial Van (EDV)','~135 kWh',135,11.5,150,400),

  /* ============================== LUCID ================================= */
  v('lucid-air-pure',2023,2026,'Lucid','Air','Pure 84 kWh (900 V)',84,19.2,250,900,{lv:50,acEff:.90}),
  v('lucid-air-touring',2022,2026,'Lucid','Air','Touring 92 kWh (900 V)',92,19.2,300,900,{lv:50,acEff:.90}),
  v('lucid-air-gt',2022,2026,'Lucid','Air','Grand Touring 112 kWh (900 V)',112,19.2,300,900,{lv:50,acEff:.90}),
  v('lucid-air-sapphire',2024,2026,'Lucid','Air','Sapphire 118 kWh (900 V)',118,19.2,300,900,{lv:50,acEff:.90}),
  v('lucid-gravity-touring',2025,2026,'Lucid','Gravity','Touring 120 kWh (900 V)',120,19.2,300,900,{lv:50,acEff:.90}),
  v('lucid-gravity-gt',2025,2026,'Lucid','Gravity','Grand Touring 123 kWh (900 V)',123,19.2,400,900,{lv:50,acEff:.90}),

  /* ============================== HYUNDAI =============================== */
  v('hyundai-ioniq-ev-28',2017,2019,'Hyundai','Ioniq Electric','28 kWh',28,6.6,50,400,{acEff:.88,dcEff:.93}),
  v('hyundai-ioniq-ev-38',2020,2021,'Hyundai','Ioniq Electric','38.3 kWh',38.3,7.2,100,400,{acEff:.88,dcEff:.94}),
  v('hyundai-kona-2019',2019,2023,'Hyundai','Kona Electric','64 kWh',64,7.2,77,400,{acEff:.88,dcEff:.94}),
  v('hyundai-kona-2024',2024,2026,'Hyundai','Kona Electric','65 kWh',65,10.9,102,400),
  v('hyundai-ioniq5-58',2022,2024,'Hyundai','Ioniq 5','SE Standard Range 58 kWh (~54 usable)',54,10.9,175,800,{lv:90}),
  v('hyundai-ioniq5-774',2022,2024,'Hyundai','Ioniq 5','Long Range 77.4 kWh (~74 usable, CCS1)',74,10.9,233,800,{lv:100}),
  v('hyundai-ioniq5-84-nacs',2025,2026,'Hyundai','Ioniq 5','Long Range 84 kWh (NACS port)',84,10.9,233,800,{nacs:1,lv:100,extra:{curveConfidence:'published',curveNote:'800 V E-GMP. NACS-native from 2025 — no adapter at a Tesla post, but a NACS→CCS1 adapter is needed at CCS posts.'}}),
  v('hyundai-ioniq5-n',2025,2026,'Hyundai','Ioniq 5 N','84 kWh (NACS port)',84,10.9,233,800,{nacs:1,lv:100}),
  v('hyundai-ioniq6-53',2023,2026,'Hyundai','Ioniq 6','SE Standard Range 53 kWh',53,10.9,175,800,{lv:90}),
  v('hyundai-ioniq6-774',2023,2026,'Hyundai','Ioniq 6','Long Range 77.4 kWh (~74 usable)',74,10.9,233,800,{lv:100}),
  v('hyundai-ioniq9',2026,2026,'Hyundai','Ioniq 9','110.3 kWh (NACS port)',110.3,10.9,233,800,{nacs:1,lv:100}),

  /* ============================== KIA =================================== */
  v('kia-soul-ev-2015',2015,2019,'Kia','Soul EV','27 / 30 kWh (CHAdeMO)',30,6.6,50,400,{chademo:1,acEff:.88,dcEff:.93}),
  v('kia-niro-ev-2019',2019,2022,'Kia','Niro EV','64 kWh',64,7.2,77,400,{acEff:.88,dcEff:.94}),
  v('kia-niro-ev-2023',2023,2026,'Kia','Niro EV','64.8 kWh',64.8,11,85,400),
  v('kia-ev6-58',2022,2024,'Kia','EV6','Standard Range 58 kWh (~54 usable)',54,10.9,175,800,{lv:90}),
  v('kia-ev6-774',2022,2024,'Kia','EV6','Long Range 77.4 kWh (~74 usable, CCS1)',74,10.9,240,800,{lv:100}),
  v('kia-ev6-84',2025,2026,'Kia','EV6','Long Range 84 kWh (NACS port)',84,10.9,240,800,{nacs:1,lv:100}),
  v('kia-ev6-gt',2023,2026,'Kia','EV6','GT 77.4 kWh (~74 usable)',74,10.9,240,800,{lv:100}),
  v('kia-ev9-light',2024,2026,'Kia','EV9','Light 76.1 kWh',76.1,10.9,210,800,{lv:100}),
  v('kia-ev9',2024,2026,'Kia','EV9','Long Range 99.8 kWh',99.8,10.9,210,800,{lv:100}),
  v('kia-ev4',2026,2026,'Kia','EV4','Long Range 81.4 kWh',81.4,10.9,150,400),

  /* ============================== GENESIS =============================== */
  v('genesis-gv60',2023,2026,'Genesis','GV60','Advanced / Performance 77.4 kWh (~74 usable)',74,10.9,233,800,{lv:100}),
  v('genesis-g80-ev',2023,2026,'Genesis','Electrified G80','87.2 kWh (~82 usable)',82,10.9,233,800,{lv:100}),
  v('genesis-gv70-ev',2023,2026,'Genesis','Electrified GV70','77.4 kWh (~74 usable)',74,10.9,233,800,{lv:100}),

  /* ============================== NISSAN ================================ */
  v('nissan-leaf-24',2011,2015,'Nissan','Leaf','24 kWh (~21.3 usable, CHAdeMO)',21.3,6.6,50,400,{chademo:1,acEff:.87,dcEff:.92}),
  v('nissan-leaf-30',2016,2017,'Nissan','Leaf','30 kWh (~28 usable, CHAdeMO)',28,6.6,50,400,{chademo:1,acEff:.87,dcEff:.92}),
  v('nissan-leaf-40',2018,2025,'Nissan','Leaf','40 kWh (~36 usable, CHAdeMO)',36,6.6,50,400,{chademo:1,acEff:.88,dcEff:.93}),
  v('nissan-leaf-62',2019,2025,'Nissan','Leaf','Plus 62 kWh (~56 usable, CHAdeMO)',56,6.6,100,400,{chademo:1,acEff:.88,dcEff:.93}),
  v('nissan-leaf-2026',2026,2026,'Nissan','Leaf','75 kWh (NACS port)',75,7.2,150,400,{nacs:1}),
  v('nissan-ariya-63',2023,2026,'Nissan','Ariya','63 kWh',63,7.2,130,400,{acEff:.88,dcEff:.94}),
  v('nissan-ariya-87',2023,2026,'Nissan','Ariya','87 kWh',87,7.2,130,400,{acEff:.88,dcEff:.94}),

  /* ============================== TOYOTA / LEXUS / SUBARU =============== */
  v('toyota-bz4x-fwd',2023,2025,'Toyota','bZ4X','FWD 71.4 kWh (~64 usable)',64,11,150,400,{acEff:.88,dcEff:.94}),
  v('toyota-bz4x-awd',2023,2025,'Toyota','bZ4X','AWD 72.8 kWh (~65 usable)',65,11,100,400,{acEff:.88,dcEff:.94}),
  v('toyota-bz-2026',2026,2026,'Toyota','bZ','74.7 kWh (NACS port)',74.7,11,150,400,{nacs:1}),
  v('lexus-rz-450e',2023,2025,'Lexus','RZ','450e 71.4 kWh (~64 usable)',64,11,150,400,{acEff:.88,dcEff:.94}),
  v('lexus-rz-2026',2026,2026,'Lexus','RZ','350e / 550e 77 kWh',72,11,150,400),
  v('subaru-solterra',2023,2025,'Subaru','Solterra','72.8 kWh (~64 usable)',64,11,100,400,{acEff:.88,dcEff:.94}),
  v('subaru-solterra-2026',2026,2026,'Subaru','Solterra','74.7 kWh (NACS port)',74.7,11,150,400,{nacs:1}),
  v('subaru-trailseeker',2026,2026,'Subaru','Trailseeker','74.7 kWh (NACS port)',74.7,11,150,400,{nacs:1}),

  /* ============================== HONDA / ACURA ========================= */
  v('honda-prologue',2024,2026,'Honda','Prologue','85 kWh',85,11.5,155,400),
  v('acura-zdx',2024,2026,'Acura','ZDX','A-Spec 102 kWh',102,11.5,190,400),
  v('acura-zdx-type-s',2024,2026,'Acura','ZDX','Type S 102 kWh',102,11.5,190,400),

  /* ============================== MAZDA / MITSUBISHI / SMART ============ */
  v('mazda-mx30',2022,2023,'Mazda','MX-30','35.5 kWh (~30 usable)',30,6.6,36,400,{acEff:.88,dcEff:.92}),
  v('mitsubishi-imiev',2012,2017,'Mitsubishi','i-MiEV','16 kWh (~14.5 usable, CHAdeMO)',14.5,3.3,50,400,{chademo:1,acEff:.86,dcEff:.9}),
  v('smart-eq-fortwo',2017,2019,'smart','EQ fortwo','17.6 kWh (~16.7 usable, AC only)',16.7,7.2,22,400,{noDC:1,acEff:.87}),

  /* ============================== VOLKSWAGEN ============================ */
  v('vw-egolf',2015,2019,'Volkswagen','e-Golf','35.8 kWh (~32 usable)',32,7.2,40,400,{acEff:.88,dcEff:.93}),
  v('vw-id4-standard',2021,2026,'Volkswagen','ID.4','Standard 62 kWh (~58 usable)',58,11,110,400),
  v('vw-id4-pro',2021,2026,'Volkswagen','ID.4','Pro 82 kWh (~77 usable)',77,11,175,400),
  v('vw-id-buzz',2025,2026,'Volkswagen','ID. Buzz','91 kWh (~86 usable)',86,11,200,400),

  /* ============================== AUDI ================================== */
  v('audi-etron-55',2019,2022,'Audi','e-tron','55 quattro 95 kWh (~86.5 usable)',86.5,11,150,400),
  v('audi-etron-s',2021,2022,'Audi','e-tron S','95 kWh (~86.5 usable)',86.5,11,150,400),
  v('audi-q8-etron-55',2024,2026,'Audi','Q8 e-tron','55 quattro 114 kWh (~106 usable)',106,11,170,400),
  v('audi-sq8-etron',2024,2026,'Audi','SQ8 e-tron','114 kWh (~106 usable)',106,11,170,400),
  v('audi-q4-40',2022,2026,'Audi','Q4 e-tron','40 / 45 82 kWh (~77 usable)',77,11,150,400),
  v('audi-q4-50',2022,2026,'Audi','Q4 e-tron','50 / 55 quattro 82 kWh (~77 usable)',77,11,175,400),
  v('audi-q6-etron',2025,2026,'Audi','Q6 e-tron','100 kWh (~94.9 usable, 800 V)',94.9,11,270,800,{lv:135}),
  v('audi-etron-gt',2022,2026,'Audi','e-tron GT','93.4 kWh (~83.7 usable, 800 V)',83.7,11,270,800,{lv:50}),
  v('audi-rs-etron-gt',2022,2026,'Audi','RS e-tron GT','93.4 kWh (~83.7 usable, 800 V)',83.7,11,270,800,{lv:50}),

  /* ============================== PORSCHE =============================== */
  v('porsche-taycan-pb',2020,2023,'Porsche','Taycan','Performance Battery 79.2 kWh (~71 usable)',71,11,270,800,{lv:50}),
  v('porsche-taycan-pbp',2020,2023,'Porsche','Taycan','Performance Battery Plus 93.4 kWh (~83.7 usable)',83.7,11,270,800,{lv:50}),
  v('porsche-taycan-2024-pb',2024,2026,'Porsche','Taycan','Performance Battery 89 kWh (~82 usable)',82,11,320,800,{lv:150}),
  v('porsche-taycan-2024-pbp',2024,2026,'Porsche','Taycan','Performance Battery Plus 105 kWh (~97 usable)',97,19.2,320,800,{lv:150}),
  v('porsche-macan-ev',2025,2026,'Porsche','Macan EV','100 kWh (~95 usable, 800 V)',95,11,270,800,{lv:135}),

  /* ============================== BMW / MINI ============================ */
  v('bmw-i3-22',2014,2016,'BMW','i3','22 kWh (~18.8 usable)',18.8,7.4,50,400,{acEff:.88,dcEff:.92}),
  v('bmw-i3-33',2017,2018,'BMW','i3','33 kWh (~27.2 usable)',27.2,7.4,50,400,{acEff:.88,dcEff:.93}),
  v('bmw-i3-42',2019,2021,'BMW','i3','42.2 kWh (~37.9 usable)',37.9,7.4,50,400,{acEff:.88,dcEff:.93}),
  v('bmw-i4-edrive35',2023,2026,'BMW','i4','eDrive35 70.2 kWh (~67.1 usable)',67.1,11,180,400),
  v('bmw-i4-edrive40',2022,2026,'BMW','i4','eDrive40 83.9 kWh (~81.3 usable)',81.3,11,205,400),
  v('bmw-i4-m50',2022,2026,'BMW','i4','M50 83.9 kWh (~81.3 usable)',81.3,11,205,400),
  v('bmw-ix-xdrive40',2022,2023,'BMW','iX','xDrive40 76.6 kWh (~71 usable)',71,11,150,400),
  v('bmw-ix-xdrive50',2022,2026,'BMW','iX','xDrive50 111.5 kWh (~105.2 usable)',105.2,11,195,400),
  v('bmw-ix-m60',2023,2026,'BMW','iX','M60 111.5 kWh (~105.2 usable)',105.2,11,195,400),
  v('bmw-i5-edrive40',2024,2026,'BMW','i5','eDrive40 84.3 kWh (~81.2 usable)',81.2,11,205,400),
  v('bmw-i5-m60',2024,2026,'BMW','i5','M60 84.3 kWh (~81.2 usable)',81.2,11,205,400),
  v('bmw-i7-xdrive60',2023,2026,'BMW','i7','xDrive60 101.7 kWh',101.7,11,195,400),
  v('bmw-i7-m70',2024,2026,'BMW','i7','M70 101.7 kWh',101.7,11,195,400),
  v('bmw-ix3-2026',2026,2026,'BMW','iX3','Neue Klasse ~108 kWh (800 V)',108,11,400,800,{lv:150}),
  v('mini-cooper-se',2020,2024,'Mini','Cooper SE','32.6 kWh (~28.9 usable)',28.9,11,50,400,{acEff:.88,dcEff:.93}),
  v('mini-cooper-se-2025',2025,2026,'Mini','Cooper SE','54.2 kWh (~49.2 usable)',49.2,11,95,400),
  v('mini-countryman-se',2025,2026,'Mini','Countryman SE ALL4','66.45 kWh (~64.7 usable)',64.7,11,130,400),

  /* ============================== MERCEDES-BENZ ========================= */
  v('mb-eqb-250',2022,2026,'Mercedes-Benz','EQB','250 / 300 / 350 70.5 kWh (~66.5 usable)',66.5,9.6,100,400),
  v('mb-eqe-350',2023,2026,'Mercedes-Benz','EQE','350 90.6 kWh (~89 usable)',89,9.6,170,400),
  v('mb-eqe-500',2023,2026,'Mercedes-Benz','EQE','500 4MATIC 90.6 kWh (~89 usable)',89,9.6,170,400),
  v('mb-eqe-suv',2024,2026,'Mercedes-Benz','EQE SUV','350 / 500 90.6 kWh (~89 usable)',89,9.6,170,400),
  v('mb-eqs-450',2022,2026,'Mercedes-Benz','EQS','450+ / 450 4MATIC 107.8 kWh',107.8,9.6,200,400),
  v('mb-eqs-580',2022,2026,'Mercedes-Benz','EQS','580 4MATIC 107.8 kWh',107.8,9.6,200,400),
  v('mb-eqs-suv',2023,2026,'Mercedes-Benz','EQS SUV','450 / 580 107.8 kWh',107.8,9.6,200,400),
  v('mb-g580',2025,2026,'Mercedes-Benz','G 580 with EQ Technology','116 kWh',116,9.6,200,400),
  v('mb-esprinter',2024,2026,'Mercedes-Benz','eSprinter','113 kWh (~106 usable)',106,9.6,115,400),

  /* ============================== VOLVO / POLESTAR ====================== */
  v('volvo-xc40-recharge',2021,2023,'Volvo','XC40 Recharge','78 kWh (~75 usable)',75,11,150,400),
  v('volvo-c40-recharge',2022,2023,'Volvo','C40 Recharge','78 kWh (~75 usable)',75,11,150,400),
  v('volvo-ex40',2024,2026,'Volvo','EX40','82 kWh (~79 usable)',79,11,200,400),
  v('volvo-ec40',2024,2026,'Volvo','EC40','82 kWh (~79 usable)',79,11,200,400),
  v('volvo-ex30',2025,2026,'Volvo','EX30','Extended Range 69 kWh (~64 usable)',64,11,153,400),
  v('volvo-ex90',2025,2026,'Volvo','EX90','111 kWh (~107 usable)',107,11,250,400),
  v('volvo-es90',2026,2026,'Volvo','ES90','106 kWh (800 V)',102,11,350,800,{lv:150}),
  v('polestar-2-sr',2021,2024,'Polestar','Polestar 2','Standard Range 69 kWh (~67 usable)',67,11,135,400),
  v('polestar-2-lr',2021,2024,'Polestar','Polestar 2','Long Range 78 kWh (~75 usable)',75,11,155,400),
  v('polestar-2-lr-2024',2024,2026,'Polestar','Polestar 2','Long Range 82 kWh (~79 usable)',79,11,205,400),
  v('polestar-3',2025,2026,'Polestar','Polestar 3','Long Range 111 kWh (~107 usable)',107,11,250,400),
  v('polestar-4',2025,2026,'Polestar','Polestar 4','100 kWh (~94 usable)',94,11,200,400),

  /* ============================== JAGUAR / LAND ROVER =================== */
  v('jaguar-ipace',2019,2024,'Jaguar','I-Pace','90 kWh (~84.7 usable)',84.7,11,100,400),
  v('landrover-rr-electric',2026,2026,'Land Rover','Range Rover Electric','118 kWh (800 V)',112,11,200,800,{lv:120}),

  /* ============================== STELLANTIS ============================ */
  v('jeep-wagoneer-s',2025,2026,'Jeep','Wagoneer S','100 kWh (~93 usable)',93,11,200,400),
  v('jeep-recon',2026,2026,'Jeep','Recon','100 kWh (~93 usable)',93,11,200,400),
  v('dodge-charger-rt',2025,2026,'Dodge','Charger Daytona','R/T 100.5 kWh (~93.9 usable)',93.9,11,183,400),
  v('dodge-charger-scat',2025,2026,'Dodge','Charger Daytona','Scat Pack 100.5 kWh (~93.9 usable)',93.9,11,183,400),
  v('ram-promaster-ev',2024,2026,'Ram','ProMaster EV','110 kWh (~100 usable)',100,11,125,400),
  v('ram-1500-rev',2026,2026,'Ram','1500 REV','168 kWh (~160 usable)',160,11.5,350,800,{lv:150}),
  v('fiat-500e',2024,2026,'Fiat','500e','42 kWh (~37 usable)',37,11,85,400,{acEff:.88,dcEff:.94}),
  v('maserati-granturismo-folgore',2024,2026,'Maserati','GranTurismo Folgore','92.5 kWh (~83 usable, 800 V)',83,11,270,800,{lv:100}),
  v('maserati-grecale-folgore',2024,2026,'Maserati','Grecale Folgore','105 kWh (~96 usable)',96,11,150,400),

  /* ============================== LUXURY / OTHER ======================== */
  v('rolls-royce-spectre',2024,2026,'Rolls-Royce','Spectre','102 kWh (~95 usable)',95,11,195,400),
  v('lotus-eletre',2024,2026,'Lotus','Eletre','112 kWh (~109 usable, 800 V)',109,11,350,800,{lv:100}),
  v('lotus-emeya',2025,2026,'Lotus','Emeya','102 kWh (~98.9 usable, 800 V)',98.9,11,350,800,{lv:100}),
  v('fisker-ocean',2023,2024,'Fisker','Ocean','Extreme 113 kWh (~106 usable)',106,11,190,400),
  v('vinfast-vf8',2023,2026,'VinFast','VF 8','87.7 kWh (~82 usable)',82,11,150,400),
  v('vinfast-vf9',2024,2026,'VinFast','VF 9','123 kWh (~118 usable)',118,11,150,400)
];


/* --------------------------------------------------------- ADAPTER PRESETS
   category: 'oem'        — sold by the vehicle manufacturer
             'thirdparty' — retail / Amazon units
             'unknown'    — placeholder for "I don't know what I have"
   oemFor:   makes this is the factory adapter for (GM brands share one unit)
   confidence: 'verified' — rating taken from the manufacturer's own listing
               'typical'  — representative of the class; CHECK YOUR LABEL
   Ratings are the adapter's plate limits. Actual delivered power is still the
   lowest of vehicle, station and adapter, so a generously rated adapter simply
   stops being the constraint -- which is the point of recording them honestly. */
const ADAPTER_PRESETS = [
  /* ---------------- OEM: NACS → CCS1 (CCS1 car at a Supercharger) --------- */
  { id:'oem-gm-nacs-dc', name:'GM NACS DC Adapter (85836744)', type:'DC',
    fromConnector:'NACS_DC', toConnector:'CCS1',
    maxKW:500, maxVoltage:1000, maxAmps:500,
    brand:'GM', category:'oem', confidence:'verified',
    oemFor:['GMC','Chevrolet','Cadillac','Buick'],
    note:'The factory GM unit, rated 500 A at 1000 V (−30 °C to 40 °C). At that rating the adapter is never your limit — on a Tesla V3 the 400 V cabinet is what holds you back, not this.' },
  { id:'oem-ford-nacs-dc', name:'Ford Fast Charging Adapter (VRK9Z-10E826-A)', type:'DC',
    fromConnector:'NACS_DC', toConnector:'CCS1',
    maxKW:500, maxVoltage:1000, maxAmps:500,
    brand:'Ford', category:'oem', confidence:'verified',
    oemFor:['Ford','Lincoln'],
    note:'Ford\'s OEM-certified NACS adapter, rated 500 A / 1000 V.' },
  { id:'oem-rivian-nacs-dc', name:'Rivian NACS DC Adapter', type:'DC',
    fromConnector:'NACS_DC', toConnector:'CCS1',
    maxKW:500, maxVoltage:1000, maxAmps:500,
    brand:'Rivian', category:'oem', confidence:'typical',
    oemFor:['Rivian'],
    note:'Representative of the OEM class. Check the label on your unit and correct it here.' },
  { id:'oem-hyundai-nacs-dc', name:'Hyundai / Kia / Genesis NACS DC Adapter', type:'DC',
    fromConnector:'NACS_DC', toConnector:'CCS1',
    maxKW:500, maxVoltage:1000, maxAmps:500,
    brand:'Hyundai', category:'oem', confidence:'typical',
    oemFor:['Hyundai','Kia','Genesis'],
    note:'Representative of the OEM class. Check the label on your unit and correct it here.' },

  /* ---------------- OEM: CCS1 → NACS (NACS car at a CCS post) ------------- */
  { id:'oem-tesla-ccs1-dc', name:'Tesla CCS Combo 1 Adapter', type:'DC',
    fromConnector:'CCS1', toConnector:'NACS_DC',
    maxKW:250, maxVoltage:500, maxAmps:500,
    brand:'Tesla', category:'oem', confidence:'typical',
    oemFor:['Tesla'],
    note:'Tesla\'s own CCS adapter. 400 V-class, so it does not unlock 800 V charging speeds.' },

  /* ---------------- Third-party: NACS → CCS1 ------------------------------ */
  { id:'tp-a2z-typhoon-pro', name:'A2Z Typhoon PRO (NACS → CCS1)', type:'DC',
    fromConnector:'NACS_DC', toConnector:'CCS1',
    maxKW:500, maxVoltage:1000, maxAmps:500,
    brand:'A2Z', category:'thirdparty', confidence:'verified',
    note:'500 A / 1000 V. One of the most widely used retail adapters.' },
  { id:'tp-lectron-nacs-ccs1', name:'Lectron NACS → CCS1', type:'DC',
    fromConnector:'NACS_DC', toConnector:'CCS1',
    maxKW:500, maxVoltage:1000, maxAmps:500,
    brand:'Lectron', category:'thirdparty', confidence:'verified',
    note:'500 A / 1000 V, UL 2252 certified.' },
  { id:'tp-lenz-nacs-ccs1', name:'LENZ NACS → CCS1  ⚠ 500 V', type:'DC',
    fromConnector:'NACS_DC', toConnector:'CCS1',
    maxKW:250, maxVoltage:500, maxAmps:500,
    brand:'LENZ', category:'thirdparty', confidence:'verified',
    note:'500 A but only 500 V. On an 800 V pack this is a real ceiling — it cannot pass high-voltage charging even at a 1000 V post. Fine for 400 V vehicles.' },
  { id:'tp-fondwell-nacs-ccs1', name:'Fondwell NACS → CCS1', type:'DC',
    fromConnector:'NACS_DC', toConnector:'CCS1',
    maxKW:500, maxVoltage:1000, maxAmps:500,
    brand:'Fondwell', category:'thirdparty', confidence:'verified',
    note:'500 A / 1000 V.' },
  { id:'tp-generic-250-nacs-ccs1', name:'Generic Amazon NACS → CCS1 (250 kW class)', type:'DC',
    fromConnector:'NACS_DC', toConnector:'CCS1',
    maxKW:250, maxVoltage:1000, maxAmps:500,
    brand:'Generic', category:'thirdparty', confidence:'typical',
    note:'Many unbranded listings advertise "500 A / 250 kW max". Treat 250 kW as the working ceiling unless your label says otherwise.' },

  /* ---------------- AC: NACS → J1772 (J1772 car at a Tesla destination) --- */
  { id:'tp-teslatap-80a', name:'TeslaTap 80 A (NACS → J1772)', type:'AC',
    fromConnector:'NACS_AC', toConnector:'J1772',
    maxKW:19.2, maxVoltage:250, maxAmps:80,
    brand:'TeslaTap', category:'thirdparty', confidence:'verified',
    note:'80 A — the highest-rated common AC adapter. Will not limit a 19.2 kW onboard charger.' },
  { id:'tp-lectron-48a-ac', name:'Lectron 48 A (NACS → J1772)', type:'AC',
    fromConnector:'NACS_AC', toConnector:'J1772',
    maxKW:11.5, maxVoltage:240, maxAmps:48,
    brand:'Lectron', category:'thirdparty', confidence:'verified',
    note:'48 A / 240 V. Caps a 19.2 kW vehicle at about 11.5 kW.' },
  { id:'tp-gearit-40a-ac', name:'GEARit 40 A (NACS → J1772)', type:'AC',
    fromConnector:'NACS_AC', toConnector:'J1772',
    maxKW:10.0, maxVoltage:250, maxAmps:40,
    brand:'GEARit', category:'thirdparty', confidence:'verified',
    note:'40 A / 250 V, ETL certified. A genuine bottleneck on a big onboard charger.' },

  /* ---------------- AC: J1772 → NACS (NACS car at a J1772 station) -------- */
  { id:'oem-tesla-j1772-ac', name:'Tesla J1772 Adapter (included with the car)', type:'AC',
    fromConnector:'J1772', toConnector:'NACS_AC',
    maxKW:11.5, maxVoltage:240, maxAmps:48,
    brand:'Tesla', category:'oem', confidence:'typical',
    oemFor:['Tesla'],
    note:'The adapter in the boot of most Teslas. Older 80 A units exist — check yours.' },
  { id:'tp-jplus-80a-ac', name:'J+ / TSportline 80 A (J1772 → NACS)', type:'AC',
    fromConnector:'J1772', toConnector:'NACS_AC',
    maxKW:19.2, maxVoltage:240, maxAmps:80,
    brand:'J+', category:'thirdparty', confidence:'verified',
    note:'80 A / 240 V Level 2.' },

  /* ---------------- Unknown ---------------------------------------------- */
  { id:'unknown-dc', name:"Other / I'm not sure — DC", type:'DC',
    fromConnector:'NACS_DC', toConnector:'CCS1',
    maxKW:250, maxVoltage:500, maxAmps:500,
    brand:'Unknown', category:'unknown', confidence:'typical',
    note:'Deliberately conservative placeholder: 500 V / 250 kW. Real numbers are printed on the adapter body or its box — enter them below and this stops being a guess.' },
  { id:'unknown-ac', name:"Other / I'm not sure — AC", type:'AC',
    fromConnector:'NACS_AC', toConnector:'J1772',
    maxKW:7.7, maxVoltage:240, maxAmps:32,
    brand:'Unknown', category:'unknown', confidence:'typical',
    note:'Deliberately conservative placeholder: 32 A. Check the amperage printed on your adapter and enter it below.' }
];

/* Adapters for a given direction, grouped so the vehicle's own OEM unit leads. */
function adaptersFor(type, make, fromConnector, toConnector) {
  const list = ADAPTER_PRESETS.filter(a => a.type === type &&
    (!fromConnector || a.fromConnector === fromConnector) &&
    (!toConnector || a.toConnector === toConnector));
  const isOwn = a => a.oemFor && make && a.oemFor.some(m => m.toLowerCase() === String(make).toLowerCase());
  return {
    yours:      list.filter(a => isOwn(a)),
    otherOem:   list.filter(a => a.category === 'oem' && !isOwn(a)),
    thirdParty: list.filter(a => a.category === 'thirdparty'),
    unknown:    list.filter(a => a.category === 'unknown')
  };
}

/* The factory adapter for a make, if one exists — used to pre-fill new vehicles. */
function oemAdapterFor(make, type) {
  return ADAPTER_PRESETS.find(a => a.type === type && a.category === 'oem' &&
    a.oemFor && make && a.oemFor.some(m => m.toLowerCase() === String(make).toLowerCase())) || null;
}

/* =========================================================================
   KNOWN SITES — the offline half of the charger finder.

   Every entry here was read off the OPERATOR'S OWN station page, stall by
   stall, and carries the date it was checked. That is why the list is short
   and regional rather than national: a made-up station is worse than no
   station, and no free dataset publishes per-stall power reliably enough to
   bulk-import without checking.

   Deliberately NO coordinates. A city-level guess dressed up as a distance
   ("0.4 mi") is a lie the interface tells confidently, so the built-in list
   is searched by text and only the live lookup sorts by distance.

   The live lookup (NREL's federal Alternative Fuel Station database) fills
   in everywhere else, when there is signal. This list is what works in a
   parking structure with no bars.
   ========================================================================= */
const KNOWN_SITES = [
  /* --- Metro Detroit EVgo. Verified stall-by-stall 12 Aug 2026. ---------- */
  { id:'evgo-roch-3175', network:'evgo', name:'Meijer — 3175 S Rochester Rd',
    city:'Rochester Hills', state:'MI', address:'3175 S Rochester Rd, Rochester Hills, MI 48307',
    stalls:[ { count:6, kW:350, connectors:['CCS1'], presetId:'evgo-350', dualPort:true } ],
    verified:'2026-08-12', source:'https://evgo.com/find-a-charger/mi/rochester-hills/3175-s-rochester-rd-1470275/',
    note:'The newer of the two Rochester Hills Meijer sites and much the faster: six 350 kW dual-CCS cabinets, no 100 kW stalls.' },
  { id:'evgo-roch-3608', network:'evgo', name:'Meijer — 3608 Marketplace Cir',
    city:'Rochester Hills', state:'MI', address:'3608 Marketplace Cir, Rochester Hills, MI 48309',
    stalls:[ { count:2, kW:100, connectors:['CCS1','CHADEMO'], presetId:'evgo-100' },
             { count:1, kW:350, connectors:['CCS1'], presetId:'evgo-350', dualPort:true } ],
    verified:'2026-08-12', source:'https://evgo.com/find-a-charger/mi/rochester-hills/3608-marketplace-cir-370237/',
    note:'Older 4-stall build. Two of the three cabinets are 100 kW and 400 V-class — an 800 V pack charges in split halves on those.' },
  { id:'evgo-warren-flagship', network:'evgo', name:'Meijer Flagship — 29555 Mound Rd',
    city:'Warren', state:'MI', address:'29555 Mound Rd, Warren, MI 48092',
    stalls:[ { count:12, kW:350, connectors:['CCS1','NACS_DC'], presetId:'evgo-350', dualPort:true } ],
    verified:'2026-08-12', source:'https://newsroom.meijer.com/2026-08-12-Meijer,-EVgo-and-GM-Enhance-the-EV-Charging-Experience-with-New-Flagship-Site',
    note:'Opened Aug 2026 across from GM\'s Global Technical Center. Canopied, pull-through for trailers, and the first Michigan Meijer site with NACS cables.' },
  { id:'evgo-royaloak', network:'evgo', name:'Meijer — 5111 Meijer Dr',
    city:'Royal Oak', state:'MI', address:'5111 Meijer Dr, Royal Oak, MI 48073',
    stalls:[ { count:2, kW:100, connectors:['CCS1','CHADEMO'], presetId:'evgo-100' },
             { count:1, kW:350, connectors:['CCS1'], presetId:'evgo-350', dualPort:true } ],
    verified:'2026-08-12', source:'https://evgo.com/find-a-charger/mi/royal-oak/5111-meijer-dr-392953/' },
  { id:'evgo-detroit-8mile', network:'evgo', name:'Meijer — 1205 Eight Mile Rd',
    city:'Detroit', state:'MI', address:'1205 Eight Mile Rd, Detroit, MI 48203',
    stalls:[ { count:2, kW:100, connectors:['CCS1','CHADEMO'], presetId:'evgo-100' },
             { count:1, kW:350, connectors:['CCS1'], presetId:'evgo-350', dualPort:true } ],
    verified:'2026-08-12', source:'https://evgo.com/find-a-charger/mi/detroit/1205-eight-mile-rd-461297/' }
];

/* Free-text search over the built-in list. Matches name, city, address and
   network, so "meijer", "rochester" and "evgo" all find the same sites.     */
function searchSites(q) {
  const t = String(q || '').trim().toLowerCase();
  if (!t) return KNOWN_SITES.slice();
  const terms = t.split(/\s+/);
  return KNOWN_SITES.filter(s => {
    const hay = `${s.name} ${s.city} ${s.state} ${s.address} ${s.network}`.toLowerCase();
    return terms.every(term => hay.indexOf(term) >= 0);
  });
}

/** Fastest stall at a site — what you would plan around if one is free. */
function bestStall(site) {
  return (site.stalls || []).reduce((a, b) => (!a || b.kW > a.kW ? b : a), null);
}

/* --------------------------------------------------------- STATION PRESETS */
const STATION_PRESETS = [
  /* ---------------------------------------------------------------- DC ----
     Named after the networks you actually stand in front of, because "350 kW
     CCS" is not what the sign says. Each carries `networkId`, which selects
     the matching pricing entry automatically.

     `shared`/`sharedMaxKW`: most high-power posts are ONE cabinet feeding TWO
     connectors. Alone you get the plate rating; with a car on the other side
     the cabinet splits. That halving is invisible on every spec sheet and is
     the single biggest unexplained slowdown at a busy 350 kW site.          */

  { id:'evgo-350', name:'EVgo — 350 kW (dual CCS)', level:'DC', connector:'CCS1',
    networkId:'evgo', maxKW:350, maxVoltage:1000, maxAmps:500,
    shared:false, sharedMaxKW:175,
    note:'EVgo\'s Delta 350 kW dual-port cabinet. Both connectors draw from one cabinet, so a car on the other side splits the output.' },
  { id:'evgo-100', name:'EVgo — 100 kW (CCS + CHAdeMO)', level:'DC', connector:'CCS1',
    networkId:'evgo', maxKW:100, maxVoltage:500, maxAmps:200,
    note:'The older EVgo stall. 400 V-class, so an 800 V pack charges in split halves here.' },
  { id:'evgo-50', name:'EVgo — 50 kW', level:'DC', connector:'CCS1',
    networkId:'evgo', maxKW:50, maxVoltage:500, maxAmps:125,
    note:'Legacy EVgo cabinet: 125 A to 400 V, tapering to 100 A at 500 V.' },

  { id:'ea-350', name:'Electrify America — 350 kW (Hyper-Fast)', level:'DC', connector:'CCS1',
    networkId:'electrify-america', maxKW:350, maxVoltage:1000, maxAmps:500,
    note:'The green-labelled Hyper-Fast post. True 1000 V class.' },
  { id:'ea-150', name:'Electrify America — 150 kW (Ultra-Fast)', level:'DC', connector:'CCS1',
    networkId:'electrify-america', maxKW:150, maxVoltage:920, maxAmps:200,
    note:'The far more common EA stall.' },

  { id:'tesla-v3', name:'Tesla Supercharger V3 (250 kW)', level:'DC', connector:'NACS_DC',
    networkId:'tesla-us', maxKW:250, maxVoltage:500, maxAmps:631,
    note:'400 V-class. An 800 V pack is capped well below its native curve here — this is why a Hummer sees ~180 kW.' },
  { id:'tesla-v4', name:'Tesla Supercharger V4 (325 kW, 1000 V)', level:'DC', connector:'NACS_DC',
    networkId:'tesla-us', maxKW:325, maxVoltage:1000, maxAmps:400,
    note:'High-voltage V4 cabinet — no 800 V penalty.' },
  { id:'tesla-urban', name:'Tesla Urban Supercharger (72 kW, paired)', level:'DC', connector:'NACS_DC',
    networkId:'tesla-us', maxKW:72, maxVoltage:410, maxAmps:200,
    shared:false, sharedMaxKW:36,
    note:'City-centre cabinet, permanently paired. Slow but usually empty.' },

  { id:'ionna-400', name:'Ionna — 400 kW bay', level:'DC', connector:'CCS1',
    networkId:'ionna', maxKW:400, maxVoltage:1000, maxAmps:500,
    note:'Rec Charge bays at Sheetz, Buc-ee\'s and similar. NACS and CCS on the same post.' },
  { id:'ionna-nacs', name:'Ionna — 400 kW bay (NACS)', level:'DC', connector:'NACS_DC',
    networkId:'ionna', maxKW:400, maxVoltage:1000, maxAmps:500,
    note:'Same Ionna hardware, NACS cable.' },

  { id:'cp-express-plus', name:'ChargePoint Express Plus (62.5–500 kW)', level:'DC', connector:'CCS1',
    networkId:'chargepoint-us', maxKW:62.5, maxVoltage:500, maxAmps:125,
    note:'Modular cabinet — a site may configure anything from 62.5 kW up. Check the plate and edit under Advanced.' },
  { id:'cp-express-250', name:'ChargePoint Express 250 (62.5 kW dual)', level:'DC', connector:'CCS1',
    networkId:'chargepoint-us', maxKW:62.5, maxVoltage:500, maxAmps:125,
    shared:false, sharedMaxKW:31.25,
    note:'Two connectors, one 62.5 kW cabinet. Splits hard when both stalls are in use.' },

  { id:'rivian-ran', name:'Rivian Adventure Network (200–300 kW)', level:'DC', connector:'CCS1',
    networkId:'rivian-ran', maxKW:300, maxVoltage:920, maxAmps:500,
    note:'Open to non-Rivians at most sites.' },
  { id:'mercedes-hpc', name:'Mercedes-Benz HPC (400 kW)', level:'DC', connector:'CCS1',
    networkId:'mercedes-hpc', maxKW:400, maxVoltage:1000, maxAmps:500,
    note:'The canopied Buc-ee\'s builds. Open to all brands.' },
  { id:'bp-pulse-dc', name:'bp pulse — 150/300 kW', level:'DC', connector:'CCS1',
    networkId:'bp-pulse-us', maxKW:300, maxVoltage:920, maxAmps:500,
    note:'TravelCenters of America and bp forecourt sites.' },
  { id:'francis-dc', name:'Francis Energy — 150 kW', level:'DC', connector:'CCS1',
    networkId:'francis-energy', maxKW:150, maxVoltage:920, maxAmps:200,
    note:'Dense in Oklahoma and the central states.' },
  { id:'red-e-dc', name:'Red E — DC fast (host-configured)', level:'DC', connector:'CCS1',
    networkId:'red-e', maxKW:150, maxVoltage:920, maxAmps:200,
    note:'Red E is a management platform, not a network — the site owner picks both the hardware and the price. Check the plate and the screen.' },
  { id:'walmart-dc', name:'Walmart (Charge Better) — 350 kW', level:'DC', connector:'CCS1',
    networkId:'walmart-charge-better', maxKW:350, maxVoltage:1000, maxAmps:500,
    note:'Walmart\'s own-brand build-out.' },
  { id:'ec-350', name:'Electrify Canada — 350 kW', level:'DC', connector:'CCS1',
    networkId:'electrify-canada', maxKW:350, maxVoltage:1000, maxAmps:500 },
  { id:'petrocan-350', name:'Petro-Canada Electric Highway — 350 kW', level:'DC', connector:'CCS1',
    networkId:'petro-canada', maxKW:350, maxVoltage:1000, maxAmps:500 },
  { id:'circuit-dc', name:'Circuit Électrique — 100/180 kW', level:'DC', connector:'CCS1',
    networkId:'circuit-electrique', maxKW:180, maxVoltage:920, maxAmps:200 },
  { id:'ivy-dc', name:'Ivy Charging Network — 150 kW', level:'DC', connector:'CCS1',
    networkId:'ivy', maxKW:150, maxVoltage:920, maxAmps:200 },
  { id:'bchydro-dc', name:'BC Hydro — 100/180 kW', level:'DC', connector:'CCS1',
    networkId:'bc-hydro', maxKW:180, maxVoltage:920, maxAmps:200 },

  /* Generic fallbacks, for a post whose operator you don't recognise. */
  { id:'ccs-350', name:'Any 350 kW CCS (1000 V class)', level:'DC', connector:'CCS1',
    maxKW:350, maxVoltage:1000, maxAmps:500, note:'True 800 V-capable hyperfast post.' },
  { id:'ccs-150', name:'Any 150 kW CCS', level:'DC', connector:'CCS1',
    maxKW:150, maxVoltage:920, maxAmps:200, note:'Common mid-tier CCS post.' },
  { id:'ccs-62', name:'Any 62.5 kW CCS', level:'DC', connector:'CCS1',
    maxKW:62.5, maxVoltage:500, maxAmps:125, note:'Older 400 V-class CCS cabinet.' },
  { id:'ccs-50', name:'Any 50 kW CCS', level:'DC', connector:'CCS1',
    maxKW:50, maxVoltage:500, maxAmps:125, note:'The old workhorse. 400 V class.' },
  { id:'chademo-50', name:'Any 50 kW CHAdeMO', level:'DC', connector:'CHADEMO',
    maxKW:50, maxVoltage:500, maxAmps:125, note:'Legacy. Leaf and older Outlander only.' },

  { id:'l2-80', name:'Level 2 — 80 A / 240 V (19.2 kW)', level:'AC', connector:'J1772',
    maxKW:19.2, maxVoltage:240, maxAmps:80, note:'Rare. Needs a 100 A circuit.' },
  { id:'l2-48', name:'Level 2 — 48 A / 240 V (11.5 kW)', level:'AC', connector:'J1772',
    maxKW:11.5, maxVoltage:240, maxAmps:48, note:'Most common home / workplace L2.' },
  { id:'l2-40', name:'Level 2 — 40 A / 240 V (9.6 kW)', level:'AC', connector:'J1772',
    maxKW:9.6, maxVoltage:240, maxAmps:40, note:'50 A circuit.' },
  { id:'l2-32', name:'Level 2 — 32 A / 240 V (7.7 kW)', level:'AC', connector:'J1772',
    maxKW:7.7, maxVoltage:240, maxAmps:32, note:'Typical residential 40 A circuit.' },
  /* Commercial sites are usually 208 V three-phase, not 240 V single-phase.
     Same amperage, ~13% less power — this is why a "7.7 kW" ChargePoint in a
     car park actually delivers around 6.6 kW. */
  { id:'l2-48-208', name:'Level 2 — 48 A / 208 V (10.0 kW) · commercial', level:'AC', connector:'J1772',
    maxKW:9.98, maxVoltage:208, maxAmps:48, note:'208 V commercial service.' },
  { id:'l2-40-208', name:'Level 2 — 40 A / 208 V (8.3 kW) · commercial', level:'AC', connector:'J1772',
    maxKW:8.32, maxVoltage:208, maxAmps:40, note:'208 V commercial service.' },
  { id:'l2-32-208', name:'Level 2 — 32 A / 208 V (6.7 kW) · commercial', level:'AC', connector:'J1772',
    maxKW:6.66, maxVoltage:208, maxAmps:32,
    note:'Very common public ChargePoint / SemaConnect setup. Badged 7.7 kW, delivers about 6.6 kW because the site is 208 V, not 240 V.' },
  { id:'l2-30-208', name:'Level 2 — 30 A / 208 V (6.2 kW) · commercial', level:'AC', connector:'J1772',
    maxKW:6.24, maxVoltage:208, maxAmps:30, note:'208 V site on a 40 A circuit.' },
  { id:'l2-24-208', name:'Level 2 — 24 A / 208 V (5.0 kW) · commercial', level:'AC', connector:'J1772',
    maxKW:4.99, maxVoltage:208, maxAmps:24, note:'Load-shared or low-amp commercial unit.' },
  { id:'l2-tesla-dest', name:'Tesla Destination (NACS AC, 48 A)', level:'AC', connector:'NACS_AC',
    maxKW:11.5, maxVoltage:240, maxAmps:48, note:'Hotel / restaurant Tesla wall connector.' },
  { id:'l1-12', name:'Level 1 — 12 A / 120 V (1.44 kW)', level:'AC', connector:'J1772',
    maxKW:1.44, maxVoltage:120, maxAmps:12, note:'Standard wall outlet.' },
  { id:'l1-16', name:'Level 1 — 16 A / 120 V (1.92 kW)', level:'AC', connector:'J1772',
    maxKW:1.92, maxVoltage:120, maxAmps:16, note:'20 A circuit.' }
];

const SEASON_PRESETS = [
  { id:'summer-hot', label:'Hot summer', tempC:38 },
  { id:'warm',       label:'Warm',       tempC:25 },
  { id:'mild',       label:'Mild',       tempC:15 },
  { id:'cool',       label:'Cool',       tempC:7  },
  { id:'cold',       label:'Cold',       tempC:-2 },
  { id:'deep-cold',  label:'Deep cold',  tempC:-15 }
];

function findById(id) { return LIBRARY.find(v => v.id === id) || null; }
function makes() { return [...new Set(LIBRARY.map(v => v.make))].sort(); }
function modelsFor(make) {
  return [...new Set(LIBRARY.filter(v => v.make === make).map(v => v.model))].sort();
}
function variantsFor(make, model) {
  return LIBRARY.filter(v => v.make === make && v.model === model);
}

/* ------------------------------------------------- YEAR / MAKE / MODEL PICK
   Entries cover a model-year range, so a 2023 search matches a car built
   2022-2026. Each step narrows the next.                                     */
function query(f) {
  f = f || {};
  return LIBRARY.filter(v =>
    (f.year == null || (v.yearFrom <= f.year && v.yearTo >= f.year)) &&
    (!f.make  || v.make  === f.make) &&
    (!f.model || v.model === f.model));
}
function yearsList() {
  let lo = Infinity, hi = -Infinity;
  LIBRARY.forEach(v => { lo = Math.min(lo, v.yearFrom); hi = Math.max(hi, v.yearTo); });
  const out = [];
  for (let y = hi; y >= lo; y--) out.push(y);
  return out;
}
function makesIn(year)        { return [...new Set(query({ year }).map(v => v.make))].sort(); }
function modelsIn(year, make) { return [...new Set(query({ year, make }).map(v => v.model))].sort(); }

/* Free-text search across year, make, model, pack variant. */
function search(q) {
  const t = String(q || '').toLowerCase().trim();
  if (!t) return LIBRARY.slice();
  const terms = t.split(/\s+/);
  return LIBRARY.filter(v => {
    const hay = `${v.yearFrom} ${v.yearTo} ${v.make} ${v.model} ${v.packVariant}`.toLowerCase();
    return terms.every(term => hay.includes(term));
  });
}

return { LIBRARY, ADAPTER_PRESETS, STATION_PRESETS, SEASON_PRESETS,
  KNOWN_SITES, searchSites, bestStall,
         findById, makes, modelsFor, variantsFor, adaptersFor, oemAdapterFor,
         query, yearsList, makesIn, modelsIn, search, curveFrom, SHAPE };
}));

