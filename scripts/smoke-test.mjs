// End-to-end check of index.html from file:// in headless Chromium.
// Usage: npm test [-- path/to/file.dbml]   (default: examples/open-ledger.dbml)
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { sourcesHash } from './embed-sources.mjs';

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

const hl = await page.evaluate(() => ({
  same: document.querySelector('#highlight').textContent === `${document.querySelector('#editor').value}\n `,
  kinds: [...new Set([...document.querySelectorAll('#highlight span')].map((s) => s.className))].sort().join(' '),
}));
check('highlight matches the editor text', hl.same && hl.kinds.includes('hl-keyword'), hl.kinds);

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

// Auto layout puts the dragged table back (same algorithm as the first layout).
await page.click('[data-action="auto-layout"]');
await page.click('#layout-menu [data-algorithm="left-right"]');
await page.waitForTimeout(400);
const relaid = await page.evaluate((k) => OD.app.state.positions.get(k), target.key);
check('auto layout resets positions', relaid.x === target.x && relaid.y === target.y, JSON.stringify(relaid));
await page.screenshot({ path: path.join(outDir, '3-final.png') });

// Every algorithm from the menu: no overlaps, every table placed.
for (const algo of await page.evaluate(() => OD.layoutAlgorithms.map((a) => a.id))) {
  await page.click('[data-action="auto-layout"]');
  await page.click(`#layout-menu [data-algorithm="${algo}"]`);
  await page.waitForTimeout(400);
  const res = await page.evaluate(() => {
    const { state, renderer } = OD.app;
    const boxes = state.model.tables.map((t) => ({ key: t.key, group: t.group, ...renderer.box(t.key) }));
    const groups = [...renderer.groupBoxes.entries()].map(([key, b]) => ({ key, ...b }));
    const bb = renderer.contentBox();
    return { boxes, groups, size: `${Math.round(bb.w)} × ${Math.round(bb.h)}`, menuHidden: document.querySelector('#layout-menu').hidden };
  });
  const bad = [];
  res.boxes.forEach((a, i) => res.boxes.slice(i + 1).forEach((b) => overlap(a, b) && bad.push(`${a.key}×${b.key}`)));
  res.groups.forEach((a, i) => res.groups.slice(i + 1).forEach((b) => overlap(a, b) && bad.push(`${a.key}×${b.key}`)));
  for (const g of res.groups) for (const t of res.boxes) if (t.group !== g.key && overlap(t, g)) bad.push(`${t.key} in ${g.key}`);
  check(`layout ${algo}: no overlaps`, bad.length === 0 && res.menuHidden, bad.length ? bad.join(', ') : res.size);
  await page.screenshot({ path: path.join(outDir, `layout-${algo}.png`) });
}

// DBML beyond tables and refs: lineage, optional / inactive refs, views, project note, tooltips.
await page.evaluate((src) => OD.app.openText('test.dbml', src), source);
await page.waitForTimeout(400);
const extra = await page.evaluate(() => {
  const m = OD.app.state.model;
  return {
    deps: m.deps.length,
    domDeps: document.querySelectorAll('.od-dep').length,
    badDeps: [...document.querySelectorAll('.od-dep-line')].filter((p) => /NaN|undefined/.test(p.getAttribute('d'))).length,
    optionalRefs: m.refs.filter((r) => r.from.optional || r.to.optional).length,
    domOptional: document.querySelectorAll('.od-ref-optional').length,
    inactiveRefs: m.refs.filter((r) => r.inactive).length,
    domInactive: document.querySelectorAll('.od-ref.inactive').length,
    views: m.views.map((v) => v.name),
    projectNote: !!m.project.note,
  };
});
check('every dep drawn', extra.domDeps === extra.deps, `${extra.domDeps}/${extra.deps}`);
check('no broken dep paths', extra.badDeps === 0, `${extra.badDeps} bad`);
check('optional refs get a 0..1 circle', extra.domOptional === extra.optionalRefs, `${extra.domOptional}/${extra.optionalRefs}`);
check('inactive refs are dashed', extra.domInactive === extra.inactiveRefs, `${extra.domInactive}/${extra.inactiveRefs}`);

if (extra.deps) {
  await page.click('[data-action="toggle-deps"]');
  const hidden = await page.evaluate(() => getComputedStyle(document.querySelector('.od-deps')).display === 'none');
  await page.click('[data-action="toggle-deps"]');
  const shown = await page.evaluate(() => getComputedStyle(document.querySelector('.od-deps')).display !== 'none');
  check('lineage toggle hides and shows deps', hidden && shown);
}

if (extra.projectNote) {
  await page.click('.toolbar [data-action="toggle-project"]');
  const pp = await page.evaluate(() => ({ visible: !document.querySelector('#project-panel').hidden, html: document.querySelector('#project-body').innerHTML }));
  check('project note panel renders Markdown', pp.visible && /<h1|<h2|<ul|<code/.test(pp.html), pp.html.slice(0, 60));
  await page.screenshot({ path: path.join(outDir, 'project-note.png') });
  await page.click('.toolbar [data-action="toggle-project"]');
}

for (const view of extra.views) {
  await page.selectOption('#view', view);
  await page.waitForTimeout(400);
  const v = await page.evaluate(() => ({
    tables: OD.app.state.model.tables.length,
    dom: document.querySelectorAll('.od-table:not(.od-note)').length,
    status: document.querySelector('#status').textContent,
  }));
  check(`view ${view} shows a subset`, v.tables > 0 && v.tables < info.tables && v.dom === v.tables, v.status);
  await page.screenshot({ path: path.join(outDir, `view-${view}.png`) });
}
if (extra.views.length) {
  await page.selectOption('#view', '');
  await page.waitForTimeout(400);
  check('whole model back after views', (await page.evaluate(() => OD.app.state.model.tables.length)) === info.tables);
}

// Tooltips for the extra information.
const tipFor = async (selector) => {
  await page.mouse.move(0, 0);
  const box = await page.locator(selector).first().boundingBox();
  if (!box) return '';
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(50);
  return (await page.locator('#tooltip').isVisible()) ? page.locator('#tooltip').innerHTML() : '';
};
const special = await page.evaluate(() => {
  const m = OD.app.state.model;
  return {
    checks: (m.tables.find((t) => t.checks.length) || {}).key,
    props: (m.tables.find((t) => t.props) || {}).key,
    records: (m.tables.find((t) => t.records.length) || {}).key,
  };
});
await page.evaluate(() => OD.app.fit());
if (special.checks) check('table tooltip lists checks', (await tipFor(`.od-table-header[data-key="${special.checks}"]`)).includes('checks:'));
if (special.props) check('table tooltip lists custom properties', (await tipFor(`.od-table-header[data-key="${special.props}"]`)).includes('tt-props'));
if (special.records) check('table tooltip shows records', (await tipFor(`.od-table-header[data-key="${special.records}"]`)).includes('tt-records'));
if (extra.deps) {
  // A point on the line itself; the middle of its bounding box is usually empty canvas.
  const pt = await page.evaluate(() => {
    const p = document.querySelector('.od-dep-hit');
    const q = p.getPointAtLength(p.getTotalLength() / 2);
    const s = new DOMPoint(q.x, q.y).matrixTransform(p.getScreenCTM());
    return { x: s.x, y: s.y };
  });
  await page.mouse.move(0, 0);
  await page.mouse.move(pt.x, pt.y);
  await page.waitForTimeout(50);
  const tip = (await page.locator('#tooltip').isVisible()) ? await page.locator('#tooltip').innerHTML() : '';
  check('dep tooltip names both ends', tip.includes('→'), tip.replace(/<[^>]+>/g, '').slice(0, 80));
}
await page.screenshot({ path: path.join(outDir, 'deps.png') });

// Editor cursor → diagram: the element under the caret lights up.
const caretAt = async (needle) => {
  await page.evaluate((n) => {
    const ed = document.querySelector('#editor');
    const i = ed.value.indexOf(n);
    ed.focus();
    ed.setSelectionRange(i + 2, i + 2);
  }, needle);
  await page.waitForTimeout(350);
  return page.evaluate(() => ({
    tables: [...document.querySelectorAll('.od-table.focused')].map((n) => n.dataset.key),
    rows: [...document.querySelectorAll('.od-row.focused')].map((n) => `${n.dataset.key}.${n.dataset.field}`),
    refs: document.querySelectorAll('.od-ref.active').length,
    deps: document.querySelectorAll('.od-dep.active').length,
    dimmed: document.querySelector('#diagram').classList.contains('od-focus'),
  }));
};
const focusInfo = await page.evaluate(() => {
  const m = OD.app.state.model;
  const ref = m.refs.find((r) => r.from.fields.length && r.to.fields.length);
  const dep = m.deps.find((d) => d.name);
  const en = [...m.enums.keys()].find((k) => m.tables.some((t) => t.fields.some((f) => f.enumKey === k)));
  return { ref: ref && { table: ref.from.table, field: ref.from.fields[0], to: ref.to.table }, depName: dep && dep.name, en };
});
if (focusInfo.ref) {
  const tableLine = await page.evaluate((t) => document.querySelector('#editor').value.split('\n').find((l) => new RegExp(`^Table ${t}\\b`).test(l)), focusInfo.ref.table);
  const f = await caretAt(tableLine);
  check('cursor on a Table lights that table', f.dimmed && f.tables.includes(focusInfo.ref.table), f.tables.join(', '));
}
if (focusInfo.depName) {
  const f = await caretAt(`Dep ${focusInfo.depName}`);
  check('cursor on a Dep block lights its lineage', f.deps > 0 && f.tables.length > 1, `${f.deps} deps, ${f.tables.length} tables`);
}
if (focusInfo.en) {
  const f = await caretAt(`Enum ${focusInfo.en} {`);
  check('cursor on an Enum lights the fields using it', f.rows.length > 0, f.rows.slice(0, 4).join(', '));
}
const fieldLine = await caretAt('bridge varchar [ref: >?');
if (fieldLine.tables.length) check('cursor on a field lights the row and its ref', fieldLine.rows.length >= 1 && fieldLine.refs >= 1, `${fieldLine.rows.join(', ')} · ${fieldLine.refs} refs`);
await page.screenshot({ path: path.join(outDir, 'cursor-focus.png') });

// Follow: the view zooms to the element under the caret, within readable bounds.
if (focusInfo.ref) {
  await page.click('[data-action="toggle-follow"]');
  const viewOn = async (needle, key) => {
    await caretAt(needle);
    await page.waitForTimeout(250);
    return page.evaluate((k) => {
      const { view } = OD.app.viewer;
      const b = OD.app.renderer.box(k);
      const r = document.querySelector('#diagram').getBoundingClientRect();
      const cx = (b.x + b.w / 2) * view.k + view.x;
      const cy = (b.y + b.h / 2) * view.k + view.y;
      return { k: view.k, inside: cx > 0 && cx < r.width && cy > 0 && cy < r.height, pressed: document.querySelector('[data-action="toggle-follow"]').getAttribute('aria-pressed') };
    }, key);
  };
  const tableLine = await page.evaluate((t) => document.querySelector('#editor').value.split('\n').find((l) => new RegExp(`^Table ${t}\\b`).test(l)), focusInfo.ref.to);
  const v1 = await viewOn(tableLine, focusInfo.ref.to);
  check('Follow zooms to the table under the caret', v1.pressed === 'true' && v1.inside && v1.k >= 0.5 && v1.k <= 1.25, `k=${v1.k.toFixed(2)}`);
  const fieldNeedle = await page.evaluate(({ t, f }) => {
    const lines = document.querySelector('#editor').value.split('\n');
    const start = lines.findIndex((l) => new RegExp(`^Table ${t}\\b`).test(l));
    return lines.slice(start).find((l) => l.trim().startsWith(`${f} `));
  }, { t: focusInfo.ref.table, f: focusInfo.ref.field });
  const v2 = await viewOn(fieldNeedle, focusInfo.ref.table);
  check('Follow moves to a field\'s table, not every table it refs', v2.inside && v2.k >= 0.5 && v2.k <= 1.25, `k=${v2.k.toFixed(2)}`);
  await page.click('[data-action="toggle-follow"]');
}
await page.keyboard.press('Escape');
await page.mouse.click(5, 300); // outside the canvas
await page.evaluate(() => document.querySelector('#editor').blur());
await page.keyboard.press('Escape');
check('Escape clears the focus', !(await page.evaluate(() => document.querySelector('#diagram').classList.contains('od-focus'))));

// Editor search.
await page.evaluate(() => {
  const ed = document.querySelector('#editor');
  ed.focus();
  ed.setSelectionRange(0, 0);
});
await page.keyboard.press(process.platform === 'darwin' ? 'Meta+f' : 'Control+f');
await page.keyboard.type('wallets');
await page.waitForTimeout(100);
const s1 = await page.evaluate(() => ({
  open: !document.querySelector('#search').hidden,
  count: document.querySelector('#search-count').textContent,
  marks: document.querySelectorAll('#search-marks mark').length,
  sel: (() => { const ed = document.querySelector('#editor'); return ed.value.slice(ed.selectionStart, ed.selectionEnd); })(),
}));
const total = Number(s1.count.split('/')[1]);
check('⌘F opens search and counts matches', s1.open && total > 1 && s1.marks === total && s1.sel.toLowerCase() === 'wallets', `${s1.count}, ${s1.marks} marks`);
await page.keyboard.press('Enter');
const s2 = await page.evaluate(() => document.querySelector('#search-count').textContent);
await page.keyboard.press('Shift+Enter');
const s3 = await page.evaluate(() => document.querySelector('#search-count').textContent);
check('Enter / Shift+Enter step through matches', s2.startsWith('2/') && s3.startsWith('1/'), `${s1.count} → ${s2} → ${s3}`);
await page.screenshot({ path: path.join(outDir, 'search.png') });
await page.keyboard.press('Escape');
const s4 = await page.evaluate(() => ({ hidden: document.querySelector('#search').hidden, marks: document.querySelectorAll('#search-marks mark').length, active: document.activeElement.id }));
check('Escape closes search back to the editor', s4.hidden && !s4.marks && s4.active === 'editor', JSON.stringify(s4));

// Diagram → source: a click marks the element's line in the editor without taking focus.
const markedText = () =>
  page.evaluate(() => {
    const mark = document.querySelector('#line-mark');
    if (mark.hidden) return null;
    const ed = document.querySelector('#editor');
    const lh = parseFloat(getComputedStyle(ed).lineHeight);
    const line = Math.round((parseFloat(mark.style.top) - parseFloat(getComputedStyle(ed).paddingTop) + ed.scrollTop) / lh) + 1;
    return { text: ed.value.split('\n')[line - 1], active: document.activeElement.id };
  });
await page.evaluate(() => OD.app.fit());
await page.waitForTimeout(100);
const own = await page.evaluate(() => {
  for (const t of OD.app.state.model.tables) for (const f of t.fields) if (!f.partial && f.line) return { t: t.key, f: f.name };
});
await page.locator(`.od-row[data-key="${own.t}"][data-field="${own.f}"]`).click({ force: true });
const m1 = await markedText();
check('click on a field marks its source line', !!m1 && m1.text.includes(own.f) && m1.active !== 'editor', m1 && m1.text.trim().slice(0, 60));
if (extra.deps) {
  const pt = await page.evaluate(() => {
    const p = document.querySelector('.od-dep-hit');
    const q = p.getPointAtLength(p.getTotalLength() / 2);
    const s = new DOMPoint(q.x, q.y).matrixTransform(p.getScreenCTM());
    return { x: s.x, y: s.y };
  });
  await page.mouse.click(pt.x, pt.y);
  const m2 = await markedText();
  check('click on a dep marks its source line', !!m2 && /->|<-|dep/.test(m2.text), m2 && m2.text.trim().slice(0, 60));
}
await page.keyboard.press('Escape');
check('Escape clears the source mark', (await markedText()) === null);

// ---- problems panel, text exports, suggested refs ------------------------------------
const pr = await page.evaluate(() => ({
  hidden: document.querySelector('#problems').hidden,
  head: document.querySelector('.pr-toggle').textContent,
  items: [...document.querySelectorAll('#problem-list li')].map((li) => li.textContent),
  lint: OD.lint(OD.app.state.fullModel).length,
}));
check('problems panel lists the lint results', !pr.hidden ? pr.items.length >= pr.lint : pr.lint === 0, pr.head);
if (pr.items.length) {
  await page.click('#problem-list li');
  const sel = await page.evaluate(() => {
    const e = document.querySelector('#editor');
    return { active: document.activeElement.id, line: e.value.slice(0, e.selectionStart).split('\n').length };
  });
  check('click on a problem selects its line', sel.active === 'editor' && sel.line > 1, `line ${sel.line}`);
}

const textOf = async (kind) => {
  await page.click('[data-action="export-menu"]');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click(`[data-export="${kind}"]`)]);
  return { name: dl.suggestedFilename(), text: readFileSync(await dl.path(), 'utf8') };
};
const mmd = await textOf('mermaid');
const relCount = (mmd.text.match(/ [}|][o|]--[o|][|{] /g) || []).length;
check('Mermaid export has every table and ref', mmd.text.startsWith('erDiagram') && relCount === info.refs && (mmd.text.match(/ \{$/gm) || []).length === info.tables, `${mmd.name}: ${relCount} relationships`);
const doc = await textOf('markdown');
check('Markdown export documents every table', doc.text.includes('```mermaid') && (doc.text.match(/^### /gm) || []).length >= info.tables, `${doc.name}: ${doc.text.split('\n').length} lines`);
const sql = await textOf('postgres');
check('PostgreSQL export creates every table', (sql.text.match(/CREATE TABLE/g) || []).length === info.tables, sql.name);

// A schema with no FKs: the panel suggests them, the button appends them, the diagram draws them.
await page.evaluate(() => OD.app.openText('suggest.dbml', 'Table users {\n  id int [pk]\n}\nTable categories {\n  id int [pk]\n}\nTable posts {\n  id int [pk]\n  user_id int\n  category_id int\n}\n'));
await page.waitForTimeout(300);
const sug = await page.evaluate(() => ({ items: document.querySelectorAll('#problem-list li.suggest').length, button: document.querySelector('.pr-suggest').textContent }));
await page.click('.pr-suggest');
await page.waitForTimeout(500);
const added = await page.evaluate(() => ({ refs: OD.app.state.model.refs.length, left: document.querySelectorAll('#problem-list li.suggest').length, tail: document.querySelector('#editor').value.trim().split('\n').slice(-2) }));
check('suggested refs are appended and drawn', sug.items === 2 && added.refs === 2 && added.left === 0, `${sug.button} → ${added.tail.join(' | ')}`);
await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
await page.waitForTimeout(500);
check('undo removes the suggested refs', (await page.evaluate(() => OD.app.state.model.refs.length)) === 0);

// Open from a URL: GitHub page links become raw URLs, ?url= renders at once, and a
// .layout.json next to the .dbml is applied. The raw host is mocked, so no network is needed.
const conv = await page.evaluate(() => [
  OD.rawUrl('https://github.com/acme/db/blob/main/docs/schema.dbml'),
  OD.rawUrl('github.com/acme/db/raw/feature/x/schema.dbml'),
  OD.rawUrl('https://gist.github.com/someone/abc123'),
  OD.rawUrl('https://gitlab.com/acme/db/-/blob/main/schema.dbml'),
  OD.rawUrl('https://stepanic.github.io/open-diagram/?url=https://github.com/acme/db/blob/main/schema.dbml'),
]);
check('GitHub, Gist and GitLab links map to raw files', JSON.stringify(conv) === JSON.stringify([
  'https://raw.githubusercontent.com/acme/db/main/docs/schema.dbml',
  'https://raw.githubusercontent.com/acme/db/feature/x/schema.dbml',
  'https://gist.githubusercontent.com/someone/abc123/raw',
  'https://gitlab.com/acme/db/-/raw/main/schema.dbml',
  'https://raw.githubusercontent.com/acme/db/main/schema.dbml',
]), conv.join(' '));
const remote = await context.newPage();
const remoteErrors = [];
remote.on('pageerror', (e) => remoteErrors.push(String(e)));
await remote.route('https://raw.githubusercontent.com/**', (route) => {
  const u = route.request().url();
  if (u.endsWith('/shop.dbml')) return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, contentType: 'text/plain', body: 'Table customers {\n  id int [pk]\n}\nTable orders {\n  id int [pk]\n  customer_id int [ref: > customers.id]\n}\n' });
  if (u.endsWith('/shop.layout.json')) return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, contentType: 'application/json', body: JSON.stringify({ positions: { customers: { x: 0, y: 0 }, orders: { x: 900, y: 40 } } }) });
  return route.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: '' });
});
await remote.goto(`${url}?url=https://github.com/acme/shop/blob/main/db/shop.dbml`);
await remote.waitForFunction(() => OD.app && OD.app.state.model && OD.app.state.model.tables.length === 2, null, { timeout: 5000 }).catch(() => {});
await remote.waitForTimeout(300);
const r1 = await remote.evaluate(() => ({
  tables: document.querySelectorAll('.od-table').length,
  doc: document.querySelector('#doc-name').textContent,
  orders: OD.app.state.positions.get('orders'),
  query: new URLSearchParams(location.search).get('url'),
}));
check('?url= with a GitHub link renders the file and its layout', r1.tables === 2 && r1.doc === 'acme/shop/main/db/shop.dbml' && r1.orders && r1.orders.x === 900 && r1.query === 'https://github.com/acme/shop/blob/main/db/shop.dbml', JSON.stringify(r1));
await remote.click('[data-action="url-menu"]');
const menu = await remote.evaluate(() => ({ value: document.querySelector('#url-input').value, copy: !document.querySelector('#url-copy').disabled }));
check('URL menu shows the source and offers a share link', menu.copy && menu.value === r1.query, JSON.stringify(menu));
await remote.keyboard.press('Escape');
await remote.evaluate(() => {
  const ed = document.querySelector('#editor');
  ed.focus();
  ed.setSelectionRange(ed.value.length, ed.value.length);
});
await remote.keyboard.type('\n// edited');
const r2 = await remote.evaluate(() => ({ search: location.search, remote: OD.app.state.remote }));
check('editing drops ?url= so a reload cannot discard the edit', r2.search === '' && r2.remote === null, JSON.stringify(r2));
await remote.goto(`${url}?url=https://raw.githubusercontent.com/acme/shop/main/missing.dbml`);
await remote.waitForTimeout(800);
const r3 = await remote.evaluate(() => ({ status: document.querySelector('#status').textContent, cls: document.querySelector('#status').className, tables: document.querySelectorAll('.od-table').length }));
check('a URL that fails shows an error and keeps the last document', r3.cls === 'error' && /HTTP 404/.test(r3.status) && r3.tables > 0, r3.status);
check('no page errors while opening URLs', remoteErrors.length === 0, remoteErrors.join(' | '));
await remote.close();

// Read-only embed: examples/embed.html over a fake origin, so src= can fetch a file next to it.
const embed = await context.newPage();
const embedErrors = [];
const elkLoads = [];
embed.on('pageerror', (e) => embedErrors.push(String(e)));
embed.on('console', (m) => m.type() === 'error' && embedErrors.push(m.text()));
// http://embed.test/ serves the repo, as GitHub Pages serves the site.
const serveRepo = (route) => {
  const rel = decodeURIComponent(new URL(route.request().url()).pathname).slice(1) || 'index.html';
  if (/elk(\.bundled)?\.js$/.test(rel)) elkLoads.push(rel);
  route.fulfill({ path: path.join(root, rel) });
};
await embed.route('http://embed.test/**', serveRepo);
const embedState = () => embed.evaluate(() => [...document.querySelectorAll('open-diagram')].map((e) => ({
  id: e.id,
  tables: e.shadowRoot.querySelectorAll('.od-table').length,
  message: e.shadowRoot.querySelector('.message').hidden ? '' : e.shadowRoot.querySelector('.message').textContent,
  focus: e.shadowRoot.querySelector('svg').classList.contains('od-focus'),
})));
// The same page without its ELK-hungry diagram: compact layout must not fetch ELK.
await embed.route('http://embed.test/examples/compact.html', async (route) => {
  const html = readFileSync(path.join(root, 'examples/embed.html'), 'utf8').replace(/<open-diagram id="remote"[^>]*><\/open-diagram>/, '');
  route.fulfill({ contentType: 'text/html', body: html });
});
await embed.goto('http://embed.test/examples/compact.html');
await embed.waitForFunction(() => document.querySelectorAll('open-diagram').length === 3 && [...document.querySelectorAll('open-diagram')].every((e) => e.shadowRoot.querySelector('.od-table') || !e.shadowRoot.querySelector('.message').hidden), null, { timeout: 5000 }).catch(() => {});
check('embed with compact layouts does not load ELK', elkLoads.length === 0 && (await embed.evaluate(() => !window.ELK)), elkLoads.join(', '));
await embed.goto('http://embed.test/examples/embed.html');
await embed.waitForFunction(() => {
  const r = document.querySelector('#remote');
  return r && r.shadowRoot.querySelectorAll('.od-table').length > 5;
}, null, { timeout: 8000 }).catch(() => {});
const es = await embedState();
const byId = (id) => es.find((e) => e.id === id) || {};
check('inline <open-diagram> renders and focuses posts.author_id', byId('inline').tables === 3 && byId('inline').focus, JSON.stringify(byId('inline')));
check('src= loads the file, left-right loads ELK lazily', byId('remote').tables > 5 && elkLoads.length === 1, `${byId('remote').tables} tables, ELK ${elkLoads.length}×`);
check('```dbml block becomes a diagram', (await embed.locator('pre code.language-dbml').count()) === 0 && es.some((e) => !e.id && e.tables === 2), JSON.stringify(es.map((e) => e.tables)));
check('broken DBML shows the parse error', /^Line 1:/.test(byId('broken').message), byId('broken').message);
const row = embed.locator('#inline').locator('.od-row[data-key="posts"][data-field="author_id"]');
await row.hover();
const embedTip = await embed.evaluate(() => {
  const t = document.querySelector('#inline').shadowRoot.querySelector('.tooltip');
  return t.hidden ? '' : t.textContent;
});
check('embed tooltip shows the field note', embedTip.includes('Who wrote it'), embedTip.trim().replace(/\s+/g, ' ').slice(0, 80));
const scrolled = await embed.evaluate(async () => {
  const el = document.querySelector('#remote');
  const before = { ...el.viewer.view };
  el.shadowRoot.querySelector('svg').dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true }));
  return { panned: el.viewer.view.y !== before.y };
});
check('plain wheel over an embed leaves the view alone (page scrolls)', !scrolled.panned, JSON.stringify(scrolled));
check('no errors on the embed page', embedErrors.length === 0, embedErrors.join(' | '));
await embed.screenshot({ path: path.join(outDir, 'embed.png'), fullPage: true });
await embed.close();

// Share: a #dbml= link for edited text, the <iframe> and <open-diagram> snippets, dist/.
const share = await context.newPage();
const shareErrors = [];
const watch = (p) => {
  p.on('pageerror', (e) => shareErrors.push(String(e)));
  p.on('console', (m) => m.type() === 'error' && shareErrors.push(m.text()));
};
watch(share);
await share.route('http://embed.test/**', serveRepo);
await share.goto('http://embed.test/index.html');
await share.waitForFunction(() => OD.app && OD.app.state.model);
const made = await share.evaluate(async (text) => {
  await OD.app.openText('shop & co.dbml', text);
  OD.app.state.positions.set('orders', { x: 700.4, y: 55.6 });
  OD.app.renderer.render(OD.app.state.positions);
  return { link: await OD.app.shareUrl(), iframe: await OD.app.embedSnippet('iframe'), element: await OD.app.embedSnippet('element') };
}, 'Table customers {\n  id int [pk]\n  name varchar [note: \'<b>&\']\n}\nTable orders {\n  id int [pk]\n  customer_id int [ref: > customers.id]\n}\n');
await share.close();
// A fresh browser profile, so nothing can come from localStorage.
const fresh = await browser.newContext({ viewport: { width: 1200, height: 800 } });
await fresh.route('http://embed.test/**', serveRepo);
await fresh.route('http://embed.test/snippet.html', (route) => route.fulfill({ contentType: 'text/html', body: `<!doctype html><meta charset="utf-8"><body>${made.element}</body>` }));
const other = await fresh.newPage();
watch(other);
await other.goto(made.link);
await other.waitForFunction(() => OD.app && OD.app.state.model && OD.app.state.model.tables.length === 2, null, { timeout: 5000 }).catch(() => {});
const sh1 = await other.evaluate(() => ({ doc: OD.app.state.docName, orders: OD.app.state.positions.get('orders'), hash: location.hash, note: OD.app.state.model.tableByKey.get('customers').fieldByName.get('name').note }));
check('#dbml= share link opens the edited text with its layout', /^http:\/\/embed\.test\/#dbml=/.test(made.link) && sh1.doc === 'shop & co.dbml' && sh1.orders && sh1.orders.x === 700 && sh1.orders.y === 56 && sh1.note === '<b>&' && sh1.hash === '', `${made.link.length} chars, ${JSON.stringify(sh1)}`);
const iframeSrc = (made.iframe.match(/ src="([^"]+)"/) || [])[1] || '';
await other.goto(iframeSrc.replace(/&amp;/g, '&'));
const embedOf = (p, sel) => p.evaluate((sel) => {
  const el = document.querySelector(sel);
  return { tables: el.shadowRoot.querySelectorAll('.od-table').length, orders: el.renderer.positions.get('orders'), open: el.shadowRoot.querySelector('a').hidden ? '' : el.shadowRoot.querySelector('a').href, message: el.shadowRoot.querySelector('.message').hidden ? '' : el.shadowRoot.querySelector('.message').textContent };
}, sel);
await other.waitForFunction(() => document.querySelector('#diagram').shadowRoot.querySelectorAll('.od-table').length === 2, null, { timeout: 5000 }).catch(() => {});
const sh2 = await embedOf(other, '#diagram');
check('<iframe> snippet: embed.html draws the hash with its layout', iframeSrc.startsWith('http://embed.test/embed.html#dbml=') && sh2.tables === 2 && sh2.orders && sh2.orders.x === 700 && sh2.open.startsWith('http://embed.test/#dbml='), JSON.stringify(sh2));
await other.goto('http://embed.test/embed.html#src=examples/open-ledger.dbml&detail=keys');
await other.waitForFunction(() => document.querySelector('#diagram').shadowRoot.querySelectorAll('.od-table').length > 5, null, { timeout: 5000 }).catch(() => {});
const sh3 = await embedOf(other, '#diagram');
check('embed.html#src= loads a file and links to ?url=', sh3.tables > 5 && sh3.open.includes('?url=http%3A%2F%2Fembed.test%2Fexamples%2Fopen-ledger.dbml'), `${sh3.tables} tables, ${sh3.open}`);
await other.goto('http://embed.test/embed.html#dbml=!!');
await other.waitForTimeout(300);
const sh4 = await other.evaluate(() => ({ note: document.querySelector('#note').hidden ? '' : document.querySelector('#note').textContent, diagram: !document.querySelector('#diagram').hidden }));
check('embed.html with a damaged hash says so', /^This link is damaged/.test(sh4.note) && !sh4.diagram, JSON.stringify(sh4));
const bundle = readFileSync(path.join(root, 'dist/open-diagram-embed.js'), 'utf8');
check('dist/open-diagram-embed.js is built from the current src (npm run build)', bundle.includes(`Sources: ${sourcesHash()} */`), (bundle.match(/Sources: (\w+)/) || [])[1]);
elkLoads.length = 0;
await other.goto('http://embed.test/snippet.html');
await other.waitForFunction(() => { const el = document.querySelector('open-diagram'); return el && el.renderer && el.shadowRoot.querySelectorAll('.od-table').length === 2; }, null, { timeout: 5000 }).catch(() => {});
const sh5 = await embedOf(other, 'open-diagram');
check('<open-diagram> snippet works with the dist bundle alone, without ELK', made.element.includes('http://embed.test/dist/open-diagram-embed.js') && sh5.tables === 2 && sh5.orders && sh5.orders.x === 700 && elkLoads.length === 0, JSON.stringify(sh5));
await other.evaluate(() => document.querySelector('open-diagram').setAttribute('algorithm', 'left-right'));
await other.evaluate(() => document.querySelector('open-diagram').removeAttribute('layout'));
await other.waitForFunction(() => window.ELK, null, { timeout: 5000 }).catch(() => {});
check('the bundle loads ELK from dist/elk.js', elkLoads.join() === 'dist/elk.js', elkLoads.join());
check('no errors while sharing and embedding', shareErrors.length === 0, shareErrors.join(' | '));
await fresh.close();

const realErrors = consoleErrors.filter((e) => !/Unable to resolve platform/.test(e));
check('no console errors', realErrors.length === 0, realErrors.join(' | '));

await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed · screenshots in ${path.relative(process.cwd(), outDir)}/`);
process.exit(failed ? 1 : 0);
