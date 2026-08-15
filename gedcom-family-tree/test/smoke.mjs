// End-to-end test of the built file: loads gedcom-family-tree.html into jsdom,
// feeds it a GEDCOM, and checks that the page actually drew the tree and the
// report. Catches the things the unit tests cannot — inlining mistakes, broken
// wiring, DOM calls that only fail in a browser.
//
// Run: npm run smoke        (needs jsdom; `npm install` first)
// Optional: SMOKE_GED=path\to\file.ged npm run smoke   to drive a real export.
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dirname, join, basename } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const builtPath = join(here, '..', 'gedcom-family-tree.html');
if (!existsSync(builtPath)) {
  console.error('gedcom-family-tree.html is not built — run `npm run build` first.');
  process.exit(1);
}

let JSDOM;
try {
  ({ JSDOM } = await import('jsdom'));
} catch (e) {
  console.log('jsdom is not installed — run `npm install`. Skipping smoke test.');
  process.exit(0);
}

const gedPath = process.env.SMOKE_GED || join(here, 'fixtures', 'quirks.ged');
const ged = readFileSync(gedPath, 'utf8');

// jsdom does not execute `<script type="module">`, so the page's script is
// lifted out and evaluated against the jsdom window instead — the same trick
// the Postgres tool's smoke test uses.
const html = readFileSync(builtPath, 'utf8');
const script = /<script type="module">([\s\S]*?)<\/script>/.exec(html);
if (!script) { console.error('could not find the page script'); process.exit(1); }

const dom = new JSDOM(html.replace(script[1], ''), {
  url: 'http://localhost/',
  runScripts: 'outside-only',
  pretendToBeVisual: true,
});
const { window } = dom;
const doc = window.document;

const errors = [];
try {
  new Function(
    'window', 'document', 'getComputedStyle', 'localStorage', 'matchMedia',
    'setTimeout', 'clearTimeout', 'Blob', 'URL', 'FileReader', 'performance',
    script[1]
  )(
    window, doc, window.getComputedStyle.bind(window), window.localStorage,
    window.matchMedia ? window.matchMedia.bind(window) : () => ({ matches: false }),
    setTimeout, clearTimeout, window.Blob, window.URL, window.FileReader, window.performance
  );
} catch (e) {
  console.error('the page script threw on load: ' + e.stack);
  process.exit(1);
}
let failures = 0;
const check = (name, cond, extra) => {
  if (cond) { console.log('  ok   ' + name); return; }
  failures++;
  console.log('  FAIL ' + name + (extra === undefined ? '' : '  → ' + JSON.stringify(extra)));
};

console.log('smoke: ' + basename(builtPath) + ' ← ' + basename(gedPath));

check('page exposes the loader', typeof window.__loadGedcom === 'function');
check('landing screen is showing', !!doc.getElementById('drop'));
check('app is hidden before a file is loaded', !doc.getElementById('app').classList.contains('on'));

const t0 = Date.now();
window.__loadGedcom(ged, basename(gedPath));
const ms = Date.now() - t0;

const svg = doc.getElementById('canvas');
const cards = svg.querySelectorAll('g.card');
check('app screen is showing', doc.getElementById('app').classList.contains('on'));
check('landing screen is hidden', doc.getElementById('landing').style.display === 'none');
check('cards were drawn', cards.length > 0, cards.length);
check('links were drawn', svg.querySelectorAll('path').length > 0);
check('every card carries a label', [...cards].every((c) => c.querySelectorAll('text').length > 0));
check('every card is clickable', [...cards].every((c) => c.getAttribute('data-id')));
check('counts are shown', /people/.test(doc.getElementById('counts').textContent),
  doc.getElementById('counts').textContent);
check('legend is shown', doc.getElementById('legend').textContent.trim().length > 0);
check('report was rendered', doc.querySelectorAll('#findings .finding').length > 0);
check('report states a verdict', /error|conforms/.test(doc.querySelector('.verdict').textContent));
check('every finding has samples', [...doc.querySelectorAll('#findings .finding')]
  .every((f) => f.querySelectorAll('.samples li').length > 0));

// Hovering a card (without clicking) must show the lightweight peek.
const first = cards[0];
first.dispatchEvent(new window.MouseEvent('pointerover', { bubbles: true, clientX: 100, clientY: 100 }));
check('peek opens on hover', doc.getElementById('peek').classList.contains('on'));
check('peek names the person', doc.querySelector('#peek .pname').textContent.trim().length > 0,
  doc.querySelector('#peek .pname').textContent);
first.dispatchEvent(new window.MouseEvent('pointermove', { bubbles: true, clientX: 140, clientY: 130 }));
check('peek follows the pointer', doc.getElementById('peek').style.left.length > 0);
first.dispatchEvent(new window.MouseEvent('pointerout', { bubbles: true, relatedTarget: doc.body }));
check('peek closes when the pointer leaves', !doc.getElementById('peek').classList.contains('on'));

// Clicking a card must open the detail drawer with content, and hide any peek.
first.dispatchEvent(new window.MouseEvent('pointerover', { bubbles: true, clientX: 100, clientY: 100 }));
first.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
check('detail drawer opens on click', doc.getElementById('detail').classList.contains('open'));
check('click closes any open peek', !doc.getElementById('peek').classList.contains('on'));
check('detail drawer has a name', doc.getElementById('dName').textContent.trim().length > 0,
  doc.getElementById('dName').textContent);
check('detail drawer has sections', doc.querySelectorAll('#dBody .dsec').length > 0);
check('detail meta reports sex and id at minimum', doc.getElementById('dMeta').textContent.trim().length > 0,
  doc.getElementById('dMeta').textContent);

// Focus mode should explain how far the selected person is from the focus root.
doc.querySelector('#dBody [data-act="focus"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const otherCard = [...svg.querySelectorAll('g.card')].find((c) => c !== first) || svg.querySelectorAll('g.card')[0];
otherCard.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
check('detail drawer still opens for a second person in focus mode',
  doc.getElementById('dName').textContent.trim().length > 0);
doc.getElementById('viewMode').value = 'all';
doc.getElementById('viewMode').dispatchEvent(new window.Event('change'));

// Search.
const si = doc.getElementById('search');
const someone = doc.getElementById('dName').textContent.trim().split(/\s+/)[0];
si.value = someone;
si.dispatchEvent(new window.Event('input'));
check('search finds someone', doc.querySelectorAll('#hits .hit').length > 0, someone);

// Switching views must not throw and must draw fewer or equal cards.
doc.querySelector('#dBody [data-act="focus"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const focused = svg.querySelectorAll('g.card').length;
check('focused view draws a subset', focused > 0 && focused <= cards.length, focused);
const vm = doc.getElementById('viewMode');
vm.value = 'all';
vm.dispatchEvent(new window.Event('change'));
check('back to everyone', svg.querySelectorAll('g.card').length === cards.length);

// Colour modes and the report sheet.
for (const mode of ['gen', 'none', 'sex']) {
  const cb = doc.getElementById('colourBy');
  cb.value = mode;
  cb.dispatchEvent(new window.Event('change'));
  check('colour mode "' + mode + '" redraws', svg.querySelectorAll('g.card').length === cards.length);
}
doc.getElementById('btnReport').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
check('report sheet opens', doc.getElementById('sheet').classList.contains('on'));
doc.getElementById('sheetClose').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
check('report sheet closes', !doc.getElementById('sheet').classList.contains('on'));

check('no uncaught errors', errors.length === 0, errors);

// Write the drawn tree out as a standalone SVG — useful to eyeball after a
// layout change, and proof that the export path produces something valid.
const out = join(here, 'preview.svg');
const clone = svg.cloneNode(true);
const scene = clone.querySelector('#scene');
scene.classList.remove('far');
scene.querySelectorAll('.far-fill').forEach((n) => n.remove());
const bb = window.__viewBounds || null;
if (bb) {
  const pad = 30;
  scene.setAttribute('transform', `translate(${pad - bb.x},${pad - bb.y})`);
  clone.setAttribute('width', Math.round(bb.width + pad * 2));
  clone.setAttribute('height', Math.round(bb.height + pad * 2));
  clone.setAttribute('viewBox', `0 0 ${Math.round(bb.width + pad * 2)} ${Math.round(bb.height + pad * 2)}`);
}
clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
writeFileSync(out, '<?xml version="1.0" encoding="UTF-8"?>\n' + clone.outerHTML);
console.log('  wrote ' + basename(out) + ' (' + cards.length + ' cards, parsed and drawn in ' + ms + 'ms)');

console.log(failures ? '\n' + failures + ' FAILURES' : '\nALL PASS');
process.exit(failures ? 1 : 0);
