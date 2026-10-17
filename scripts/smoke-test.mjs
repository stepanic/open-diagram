// End-to-end check of index.html from file:// in headless Chromium.
// Usage: npm test [-- path/to/file.dbml]   (default: examples/open-ledger.dbml)
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const dbmlPath = path.resolve(process.argv[2] || path.join(root, 'examples/open-ledger.dbml'));
const outDir = path.join(root, 'test-output');
mkdirSync(outDir, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

// Prefer the installed Chrome so no browser download is needed; fall back to Playwright's own.
const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
const page = await context.newPage();
const consoleErrors = [];
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
page.on('pageerror', (e) => consoleErrors.push(String(e)));

const url = pathToFileURL(path.join(root, 'index.html')).href;
await page.goto(url);
await page.waitForFunction(() => window.OD && OD.app && OD.app.state.model);
check('sample diagram renders on first load', (await page.locator('.od-table').count()) > 0);

const source = readFileSync(dbmlPath, 'utf8');
await page.evaluate((src) => OD.app.openText('test.dbml', src), source);
await page.waitForTimeout(300);

const info = await page.evaluate(() => {
  const { state, renderer } = OD.app;
  const m = state.model;
  return {
    tables: m.tables.length,
    refs: m.refs.length,
    groups: m.groups.length,
    domTables: document.querySelectorAll('.od-table:not(.od-note)').length,
    domRefs: document.querySelectorAll('.od-ref').length,
    domGroups: document.querySelectorAll('.od-group').length,
    badPaths: [...document.querySelectorAll('.od-ref-line')].filter((p) => /NaN|undefined/.test(p.getAttribute('d'))).length,
    boxes: m.tables.map((t) => ({ key: t.key, group: t.group, ...renderer.box(t.key) })),
    groupBoxes: [...renderer.groupBoxes.entries()].map(([key, b]) => ({ key, ...b })),
    status: document.querySelector('#status').textContent,
  };
});
console.log(`      ${info.status}`);
check('every table drawn', info.domTables === info.tables, `${info.domTables}/${info.tables}`);
check('every ref drawn', info.domRefs === info.refs, `${info.domRefs}/${info.refs}`);
check('every group drawn', info.domGroups === info.groups, `${info.domGroups}/${info.groups}`);
check('no broken ref paths', info.badPaths === 0, `${info.badPaths} bad`);

const overlap = (a, b, gap = 0) => a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;
const tableOverlaps = [];
for (let i = 0; i < info.boxes.length; i++)
  for (let j = i + 1; j < info.boxes.length; j++) if (overlap(info.boxes[i], info.boxes[j])) tableOverlaps.push(`${info.boxes[i].key}×${info.boxes[j].key}`);
check('auto layout: no overlapping tables', tableOverlaps.length === 0, tableOverlaps.join(', '));

const groupOverlaps = [];
for (let i = 0; i < info.groupBoxes.length; i++)
  for (let j = i + 1; j < info.groupBoxes.length; j++) if (overlap(info.groupBoxes[i], info.groupBoxes[j])) groupOverlaps.push(`${info.groupBoxes[i].key}×${info.groupBoxes[j].key}`);
check('auto layout: no overlapping groups', groupOverlaps.length === 0, groupOverlaps.join(', '));

const intruders = [];
for (const g of info.groupBoxes) for (const t of info.boxes) if (t.group !== g.key && overlap(t, g)) intruders.push(`${t.key} in ${g.key}`);
check('auto layout: foreign tables stay out of groups', intruders.length === 0, intruders.join(', '));

await page.screenshot({ path: path.join(outDir, '1-auto-layout.png') });

// Drag a table by its header and check the refs follow and the position persists.
const target = info.boxes.find((b) => b.key === 'wallets') || info.boxes[0];
const header = page.locator(`.od-table[data-key="${target.key}"] .od-table-header`);
const hb = await header.boundingBox();
const refsBefore = await page.evaluate(() => [...document.querySelectorAll('.od-ref-line')].map((p) => p.getAttribute('d')).join('|'));
await page.mouse.move(hb.x + 20, hb.y + hb.height / 2);
await page.mouse.down();
await page.mouse.move(hb.x + 140, hb.y + 90, { steps: 8 });
await page.mouse.up();
const after = await page.evaluate((k) => OD.app.state.positions.get(k), target.key);
check('drag moves the table', after.x !== target.x || after.y !== target.y, `${target.x},${target.y} → ${after.x},${after.y}`);
const refsAfter = await page.evaluate(() => [...document.querySelectorAll('.od-ref-line')].map((p) => p.getAttribute('d')).join('|'));
check('refs re-route while dragging', refsBefore !== refsAfter);

await page.reload();
await page.waitForFunction(() => window.OD && OD.app && OD.app.state.model && OD.app.state.model.tables.length > 5);
const persisted = await page.evaluate((k) => OD.app.state.positions.get(k), target.key);
check('positions survive reload', persisted && persisted.x === after.x && persisted.y === after.y, JSON.stringify(persisted));

// Hover tooltip on a field with a note.
const noted = await page.evaluate(() => {
  for (const t of OD.app.state.model.tables) for (const f of t.fields) if (f.note) return { t: t.key, f: f.name };
});
if (noted) {
  await page.hover(`.od-row[data-key="${noted.t}"][data-field="${noted.f}"]`);
  const tip = await page.locator('#tooltip').textContent();
  check('field tooltip shows the note', (await page.locator('#tooltip').isVisible()) && tip.includes(noted.f), tip.trim().slice(0, 80));
}

// Detail levels change table heights.
const hAll = await page.evaluate(() => [...OD.app.renderer.sizes.values()].reduce((s, b) => s + b.h, 0));
await page.selectOption('#detail', 'keys');
await page.waitForTimeout(200);
const hKeys = await page.evaluate(() => [...OD.app.renderer.sizes.values()].reduce((s, b) => s + b.h, 0));
check('"keys only" shrinks tables', hKeys < hAll, `${hAll} → ${hKeys}`);
await page.screenshot({ path: path.join(outDir, '2-keys-only.png') });
await page.selectOption('#detail', 'all');

// A syntax error is reported with its line, and the last good diagram stays.
await page.evaluate(() => {
  const ed = document.querySelector('#editor');
  ed.value = ed.value.replace(/Table ledgers[^{]*\{/, 'Table ledgers {{');
  ed.dispatchEvent(new Event('input'));
});
await page.waitForTimeout(600);
const err = await page.evaluate(() => ({
  status: document.querySelector('#status').textContent,
  cls: document.querySelector('#status').className,
  gutterErr: document.querySelectorAll('.gutter .err').length,
  tables: document.querySelectorAll('.od-table').length,
}));
check('syntax error reported', err.cls === 'error' && err.gutterErr > 0, err.status);
check('diagram kept during syntax error', err.tables > 0);
await page.evaluate((src) => {
  const ed = document.querySelector('#editor');
  ed.value = src;
  ed.dispatchEvent(new Event('input'));
}, source);
await page.waitForTimeout(600);

// Exports.
const [svgDl] = await Promise.all([page.waitForEvent('download'), page.click('[data-action="export-svg"]')]);
const svgFile = path.join(outDir, 'export.svg');
await svgDl.saveAs(svgFile);
const svgText = readFileSync(svgFile, 'utf8');
check('SVG export contains every table', (svgText.match(/class="od-table"/g) || []).length === info.tables);

const [pngDl] = await Promise.all([page.waitForEvent('download'), page.click('[data-action="export-png"]')]);
const pngFile = path.join(outDir, 'export.png');
await pngDl.saveAs(pngFile);
check('PNG export is a PNG', readFileSync(pngFile).subarray(1, 4).toString() === 'PNG');

// Auto layout puts the dragged table back.
await page.click('[data-action="auto-layout"]');
await page.waitForTimeout(400);
const relaid = await page.evaluate((k) => OD.app.state.positions.get(k), target.key);
check('auto layout resets positions', relaid.x === target.x && relaid.y === target.y, JSON.stringify(relaid));
await page.screenshot({ path: path.join(outDir, '3-final.png') });

const realErrors = consoleErrors.filter((e) => !/Unable to resolve platform/.test(e));
check('no console errors', realErrors.length === 0, realErrors.join(' | '));

await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed · screenshots in ${path.relative(process.cwd(), outDir)}/`);
process.exit(failed ? 1 : 0);
