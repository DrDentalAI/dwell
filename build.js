/* Bundles the shared core, library, pricing, styles and UI into one
   self-contained index.html — no build tooling, no CDN, works offline,
   installable.

   Run: node build.js            normal build, stamps the current time
        BUILT="..." node build.js   pin the stamp (used to verify a rebuild
                                    reproduces a known artifact byte for byte) */
const fs = require('fs');
/* Source files end with a newline, as they should. The template below already
   supplies the line break after each interpolation, so trim exactly one to
   avoid a blank line creeping in per chunk on every rebuild. */
const p = f => fs.readFileSync(__dirname + '/' + f, 'utf8').replace(/\n$/, '');

/* Bump VERSION whenever something user-visible changes. The build stamp is
   generated here so the phone can prove which copy it is actually running. */
const VERSION = '1.14.0';
const now = new Date();
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const pad = n => String(n).padStart(2, '0');
const BUILT = process.env.BUILT ||
  (`${now.getUTCDate()} ${MONTHS[now.getUTCMonth()]} ${now.getUTCFullYear()}, `
 + `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())} UTC`);

const core    = p('ev-core.js');
const lib     = p('ev-library.js');
const pricing = p('ev-pricing.js');
const discounts = p('ev-discounts.js');
const css     = p('src/app.css');
const js      = p('src/app.js')
  .replace(/__APP_VERSION__/g, VERSION)
  .replace(/__APP_BUILT__/g, BUILT);

/* Pre-render the first screen's option lists at build time, straight from the
   same library the engine uses. Two reasons: the page paints complete with no
   empty dropdowns before scripts run, and if scripts never run at all, the
   difference between "blocked" and "errored" is visible at a glance.

   These are generated, never stored in app.html — otherwise the markup would
   carry a frozen copy of library data and silently drift from ev-library.js. */
const EVLibrary = require('./ev-library.js');
const EVCore = require('./ev-core.js');
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

const acStations = EVLibrary.STATION_PRESETS.filter(s => s.level === 'AC')
  .map(s => `<option value="${s.id}"${s.id === 'l2-48' ? ' selected' : ''}>${esc(s.name)}</option>`).join('');
const acConnectors = Object.values(EVCore.CONNECTORS).filter(c => c.level === 'AC')
  .map(c => `<option value="${c.id}"${c.id === 'J1772' ? ' selected' : ''}>${esc(c.label)}</option>`).join('');
const seasonChips = EVLibrary.SEASON_PRESETS.map(s =>
  `<button class="chip sm" data-t="${s.tempC}" onclick="UI.setTemp(${s.tempC});document.getElementById('temp-slider').value=${s.tempC}">${esc(s.label)}</button>`).join('');

const body = p('src/app.html')
  .replace('<!--__AC_STATIONS__-->', acStations)
  .replace('<!--__AC_CONNECTORS__-->', acConnectors)
  .replace('<!--__SEASON_CHIPS__-->', seasonChips);

for (const [name, val] of [['AC_STATIONS', acStations], ['AC_CONNECTORS', acConnectors], ['SEASON_CHIPS', seasonChips]]) {
  if (!val) throw new Error(`build: ${name} rendered empty`);
  if (body.includes(`<!--__${name}__-->`)) throw new Error(`build: ${name} placeholder not substituted`);
}

/* ---- PROVENANCE GATES ---------------------------------------------------
   A label that is never checked is decoration. These fail the build rather
   than shipping a claim the data does not support. */
const observed = EVLibrary.LIBRARY.filter(v => v.curveConfidence === 'observed');
if (observed.length > 1)
  throw new Error('build: more than one vehicle claims an observed curve: ' +
    observed.map(v => v.id).join(', '));
const mislabelled = EVLibrary.LIBRARY.filter(v =>
  v.curveConfidence && !['observed','published','estimated','user'].includes(v.curveConfidence));
if (mislabelled.length)
  throw new Error('build: unknown curve confidence on ' + mislabelled.map(v => v.id).join(', '));

/* The UI must never MINT a provenance label -- it can only demote. Twice now a
   handler has quietly granted 'observed' to something the owner typed
   (curveEdit, and a half-written demotion in vehEdit that was a no-op for so
   long nobody noticed). An observed curve is earned from multiple logged
   sessions across multiple SOC ranges and is written into ev-library.js by a
   human who can point at the data -- never assigned at runtime. */
const APP_SRC = p('src/app.js');
const minted = [];
APP_SRC.split('\n').forEach((line, i) => {
  const m = line.match(/curveConfidence\s*=\s*['"](observed|published|estimated)['"]/);
  if (m) minted.push(`src/app.js:${i + 1} assigns curveConfidence = '${m[1]}'`);
});
if (minted.length)
  throw new Error('build: the UI may only demote a curve to \'user\', never mint a ' +
    'stronger label:\n  ' + minted.join('\n  '));

/* ---- UI METHOD GATE -----------------------------------------------------
   v1.12.1 shipped `this.currentVehicle()` on the first line of a render path.
   That function exists nowhere in the file. Every engine test passed -- they
   all ran in Node and none of them ever opened the page -- and the app was dead
   on open for every user with a charging network selected.

   JavaScript will not tell you about a method that does not exist until the
   line runs, so check it here: every `this.x(...)` written in src/app.js must
   resolve to a key the UI object actually defines. Crude and string-based, and
   it would have caught this exact bug in under a millisecond. */
{
  const rawSrc = p('src/app.js');
  const start = rawSrc.indexOf('const UI = {');
  if (start === -1) throw new Error('build: could not find the UI object in src/app.js');
  /* Strip comments first. The comment explaining this very bug names
     `this.currentVehicle()`, and a gate that trips over its own documentation
     is a gate people delete. */
  const uiSrc = rawSrc.slice(start)
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));

  /* Methods sit at column 0 inside the object literal. Accept shorthand
     (`name(a) {`), `name: function`, and `name: async`. */
  const defined = new Set(['_booted', '_editId']);
  uiSrc.split('\n').forEach(line => {
    let m = line.match(/^(?:async\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\s*\([^)]*\)\s*\{/);
    if (m) defined.add(m[1]);
    m = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(?:async\s+)?(?:function|\()/);
    if (m) defined.add(m[1]);
  });

  /* `this` inside an inline HTML on* attribute is the DOM element, not UI.
     Those live inside template literals as onclick="...this.something...". */
  const inAttr = new Set();
  (uiSrc.match(/on[a-z]+="[^"]*"/g) || []).forEach(a => {
    (a.match(/this\.([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g) || []).forEach(c => {
      inAttr.add(c.replace(/^this\./, '').replace(/\s*\($/, ''));
    });
  });

  const missing = new Set();
  const callRe = /this\.([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g;
  let c;
  while ((c = callRe.exec(uiSrc)) !== null) {
    if (!defined.has(c[1]) && !inAttr.has(c[1])) missing.add(c[1]);
  }
  if (missing.size)
    throw new Error('build: src/app.js calls this.<name>() for methods the UI ' +
      'object does not define: ' + [...missing].join(', ') +
      '. This is the v1.12.1 startup crash — it kills the app on open, not in a test.');
  console.log(`  ui gate: ${defined.size} UI methods, every this.x() call resolves`);
}

/* ---- RATE AUTHORITY GATE ------------------------------------------------
   ev-pricing.js is the sole rate authority. A rackRate in ev-discounts.js for
   a network pricing already covers is a second, unsourced price that can only
   disagree with the first -- IONNA carried $0.48 here against $0.39 published
   there. Fail the build rather than ship two prices for one network. */
const EVDiscounts = require('./ev-discounts.js');
const dupRates = Object.keys(EVDiscounts.NETWORKS).filter(k => {
  const n = EVDiscounts.NETWORKS[k];
  return n.rackRate && (n.pricingId != null);
});
if (dupRates.length)
  throw new Error('build: ev-discounts.js carries a rackRate for a network ' +
    'ev-pricing.js already prices: ' + dupRates.join(', ') +
    '. Pricing is the sole rate authority — delete the rackRate.');

/* Any surviving rackRate must be tagged, so the UI can never show an estimated
   national average that looks identical to a published per-station rate. */
const untagged = Object.keys(EVDiscounts.NETWORKS).filter(k => {
  const n = EVDiscounts.NETWORKS[k];
  return n.rackRate && !n.rackRateNote;
});
if (untagged.length)
  throw new Error('build: untagged estimated rate in ev-discounts.js: ' +
    untagged.join(', ') + '. Add rackRateNote so the UI can label it.');

/* One provenance vocabulary across the app -- discounts AND networks. The
   first version of this gate checked only DISCOUNTS and sailed straight past a
   legacy 'reported' sitting on a NETWORKS entry. A gate that covers half the
   file is worse than no gate: it reports success. */
const badConf = []
  .concat(EVDiscounts.DISCOUNTS.map(d => ({ where: 'discount ' + d.id, c: d.confidence })))
  .concat(Object.keys(EVDiscounts.NETWORKS)
    .map(k => ({ where: 'network ' + k, c: EVDiscounts.NETWORKS[k].confidence })))
  .filter(x => x.c && EVDiscounts.CONFIDENCE.indexOf(x.c) === -1)
  .map(x => x.where + " ('" + x.c + "')");
if (badConf.length)
  throw new Error('build: confidence outside the shared vocabulary [' +
    EVDiscounts.CONFIDENCE.join(', ') + ']: ' + badConf.join(', '));

const ICON = `data:image/svg+xml,${encodeURIComponent(
`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180"><rect width="180" height="180" rx="40" fill="#0A0D12"/><path d="M100 24L54 100h30l-8 56 46-76H92z" fill="#3DDC97"/></svg>`)}`;

const MANIFEST = JSON.stringify({
  name: 'EV Dwell Planner', short_name: 'Dwell', start_url: '.',
  display: 'standalone', background_color: '#0A0D12', theme_color: '#0A0D12',
  orientation: 'portrait',
  icons: [{ src: ICON, sizes: '180x180', type: 'image/svg+xml', purpose: 'any maskable' }]
});

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,maximum-scale=1">
<title>EV Dwell Planner</title>
<meta name="description" content="Charging math for the time you spend parked. Real taper curves, thermal derating and adapter ceilings.">
<meta name="theme-color" content="#0A0D12">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Dwell">
<link rel="apple-touch-icon" href="${ICON}">
<link rel="icon" href="${ICON}">
<link rel="manifest" href='data:application/manifest+json,${encodeURIComponent(MANIFEST)}'>
<style>
${css}
</style>
</head>
<body>
${body}
<script>
/* ---- shared calculation core ---- */
${core}
/* ---- vehicle & station library ---- */
${lib}
/* ---- charging network pricing ---- */
${pricing}
/* ---- discount eligibility (applies TO pricing, never instead of it) ---- */
${discounts}
/* ---- front end ---- */
${js}
</script>
</body>
</html>
`;

if (html.includes('__APP_VERSION__') || html.includes('__APP_BUILT__'))
  throw new Error('build: version placeholders not substituted');

fs.writeFileSync(__dirname + '/index.html', html);
const kb = (Buffer.byteLength(html) / 1024).toFixed(1);
console.log(`built index.html — v${VERSION}, ${BUILT} — ${kb} KB, fully self-contained`);
