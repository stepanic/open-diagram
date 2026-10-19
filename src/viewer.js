// Read-only viewer on a Renderer's SVG: pan, zoom, follow, tooltips and click to select. The app
// adds the editor and table dragging through the grab and onClick hooks; the embed uses it as is.
(function (OD) {
  // ---- tooltip -----------------------------------------------------------------------

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  // Just enough Markdown for DBML notes: headings, lists, fenced code, `code`, **bold**, *em*, links.
  function inlineMd(text) {
    return esc(text)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>')
      .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  }

  function md(text) {
    const out = [];
    let para = [];
    let list = null;
    const flush = () => {
      if (para.length) out.push(`<p>${inlineMd(para.join(' '))}</p>`);
      para = [];
      if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${inlineMd(i)}</li>`).join('')}</${list.tag}>`);
      list = null;
    };
    const lines = String(text).split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let m;
      if (/^\s*```/.test(line)) {
        flush();
        const code = [];
        while (++i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i]);
        out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
      } else if ((m = /^(#{1,3})\s+(.*)$/.exec(line))) {
        flush();
        out.push(`<h${m[1].length}>${inlineMd(m[2])}</h${m[1].length}>`);
      } else if ((m = /^\s*([-*]|\d+[.)])\s+(.*)$/.exec(line))) {
        const tag = /\d/.test(m[1]) ? 'ol' : 'ul';
        if (para.length || (list && list.tag !== tag)) flush();
        if (!list) list = { tag, items: [] };
        list.items.push(m[2]);
      } else if (!line.trim()) flush();
      else if (list && /^\s+/.test(line)) list.items[list.items.length - 1] += ` ${line.trim()}`;
      else {
        if (list) flush();
        para.push(line);
      }
    }
    flush();
    return out.join('');
  }

  const noteHtml = (note) => (note ? `<div class="tt-note">${md(note)}</div>` : '');
  const propsHtml = (props) => (props ? `<div class="tt-props">${props.map(([k, v]) => `<span>${esc(k)}:</span> ${esc(v)}`).join('<br>')}</div>` : '');
  const checksHtml = (checks) =>
    checks && checks.length ? `<div class="tt-refs">checks:<br>${checks.map((c) => `${c.name ? `${esc(c.name)}: ` : ''}<code>${esc(c.expression)}</code>`).join('<br>')}</div>` : '';
  const cardinality = (ep) => (ep.many ? '*' : ep.optional ? '0..1' : '1');
  const endpoint = (ep) => `${ep.table}${ep.fields.length ? `.${ep.fields.join(', ')}` : ''}`;

  function recordsHtml(records) {
    return records
      .map((r) => {
        const cols = r.columns.slice(0, 6);
        const more = r.columns.length > cols.length ? `<th>+${r.columns.length - cols.length}</th>` : '';
        const rows = r.rows.slice(0, 5).map((row) => `<tr>${cols.map((_, i) => `<td>${esc(row[i] === null ? 'null' : row[i])}</td>`).join('')}${more ? '<td></td>' : ''}</tr>`);
        return `<table class="tt-records"><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}${more}</tr>${rows.join('')}</table>`;
      })
      .join('');
  }

  function tooltipHtml(m, target) {
    const row = target.closest('.od-row');
    if (row) {
      const t = m.tableByKey.get(row.dataset.key);
      const f = t.fieldByName.get(row.dataset.field);
      const flags = [f.pk && 'primary key', f.fk && 'foreign key', f.unique && 'unique', f.notNull && 'not null', f.increment && 'increment'].filter(Boolean);
      const refs = m.refs
        .filter((r) => (r.from.table === t.key && r.from.fields.includes(f.name)) || (r.to.table === t.key && r.to.fields.includes(f.name)))
        .map((r) => (r.from.table === t.key ? `→ ${endpoint(r.to)} (${cardinality(r.to)})` : `← ${endpoint(r.from)}`));
      const deps = m.deps
        .filter((d) => (d.from.table === t.key && d.from.fields.includes(f.name)) || (d.to.table === t.key && d.to.fields.includes(f.name)))
        .map((d) => (d.from.table === t.key ? `⇢ ${endpoint(d.to)}` : `⇠ ${endpoint(d.from)}`));
      const enumValues = f.enumKey ? m.enums.get(f.enumKey) : null;
      return `<b>${esc(t.name)}.${esc(f.name)}</b> <code>${esc(f.type)}</code>
        ${flags.length ? `<div class="tt-flags">${flags.map(esc).join(' · ')}</div>` : ''}
        ${f.partial ? `<div class="tt-muted">from ~${esc(f.partial)}</div>` : ''}
        ${f.default !== null ? `<div>default: <code>${esc(f.default)}</code></div>` : ''}
        ${noteHtml(f.note)}
        ${checksHtml(f.checks)}
        ${propsHtml(f.props)}
        ${enumValues ? `<div class="tt-enum">${enumValues.map((v) => `<code>${esc(v.name)}</code>`).join(' ')}</div>` : ''}
        ${refs.length ? `<div class="tt-refs">${refs.map(esc).join('<br>')}</div>` : ''}
        ${deps.length ? `<div class="tt-refs">lineage:<br>${deps.map(esc).join('<br>')}</div>` : ''}`;
    }
    const header = target.closest('.od-table-header');
    if (header) {
      const t = m.tableByKey.get(header.dataset.key);
      const idx = t.indexes.map(
        (i) => `${i.name ? `${esc(i.name)} ` : ''}<code>(${esc(i.columns.join(', '))})</code>${i.pk ? ' pk' : i.unique ? ' unique' : ''}${i.type ? ` ${esc(i.type)}` : ''}${i.note ? ` <span class="tt-muted">${esc(i.note)}</span>` : ''}`,
      );
      if (!t.note && !t.alias && !idx.length && !t.checks.length && !t.props && !t.records.length) return null;
      return `<b>${esc(t.name)}</b>${t.alias ? ` <span class="tt-muted">as ${esc(t.alias)}</span>` : ''}
        ${noteHtml(t.note)}
        ${propsHtml(t.props)}
        ${idx.length ? `<div class="tt-refs">indexes:<br>${idx.join('<br>')}</div>` : ''}
        ${checksHtml(t.checks)}
        ${recordsHtml(t.records)}`;
    }
    const refEl = target.closest('.od-ref-hit');
    if (refEl) {
      const r = m.refs.find((x) => x.id === refEl.dataset.ref);
      const actions = [r.inactive && 'inactive', r.onDelete && `on delete ${r.onDelete}`, r.onUpdate && `on update ${r.onUpdate}`].filter(Boolean);
      return `${r.name ? `<b>${esc(r.name)}</b><br>` : ''}<code>${esc(endpoint(r.from))}</code> ${cardinality(r.from)}–${cardinality(r.to)}
        <code>${esc(endpoint(r.to))}</code>${actions.length ? `<div class="tt-flags">${actions.map(esc).join(' · ')}</div>` : ''}`;
    }
    const depEl = target.closest('.od-dep-hit');
    if (depEl) {
      const d = m.deps.find((x) => x.id === depEl.dataset.dep);
      return `${d.name ? `<b>${esc(d.name)}</b> <span class="tt-muted">lineage</span><br>` : '<span class="tt-muted">lineage</span><br>'}<code>${esc(endpoint(d.from))}</code> → <code>${esc(endpoint(d.to))}</code>
        ${noteHtml(d.note)}${propsHtml(d.props)}`;
    }
    const groupEl = target.closest('.od-group-label, .od-group-handle');
    if (groupEl) {
      const g = m.groups.find((x) => x.key === groupEl.dataset.group);
      return g.note || g.props ? `<b>${esc(g.name)}</b>${noteHtml(g.note)}${propsHtml(g.props)}` : null;
    }
    return null;
  }
  const TOOLTIP_TARGETS = '.od-row, .od-table-header, .od-ref-hit, .od-dep-hit, .od-group-label, .od-group-handle';

  // ---- viewer ------------------------------------------------------------------------
  // options:
  //   tooltip  element for hover cards (position: fixed); none = no tooltips
  //   onZoom(k)  after every view change
  //   grab(e)  pointerdown on the canvas; return { begin?, move(dx, dy, k), end?(moved) } to
  //            drag something yourself, or nothing to pan
  //   onClick(target, key)  click without a drag; key = table under the pointer. Without it the
  //            table gets selected.
  //   wheel    'pan' (default): the wheel pans, ⌘/Ctrl or pinch zooms. 'page': the wheel scrolls
  //            the page as usual and only ⌘/Ctrl or pinch zooms, for diagrams inside an article.

  const FOLLOW_ZOOM = [0.5, 1.25];

  class Viewer {
    constructor(renderer, options = {}) {
      this.renderer = renderer;
      this.svg = renderer.svg;
      this.options = options;
      this.view = { x: 0, y: 0, k: 1 };
      this.drag = null;
      this.anim = 0;
      // Follow: what was fitted last, and whether a manual pan or zoom has paused it.
      this.followKey = null;
      this.followPaused = false;
      this.followTimer = 0;
      this.tooltipTarget = null;
      this.bind();
    }

    get model() {
      return this.renderer.model;
    }

    // ---- pan / zoom ----

    applyView() {
      const { x, y, k } = this.view;
      this.renderer.viewport.setAttribute('transform', `translate(${x},${y}) scale(${k})`);
      if (this.options.onZoom) this.options.onZoom(k);
    }

    fit() {
      const bb = this.renderer.contentBox();
      if (!bb) return;
      this.pauseFollow(); // also stops a reveal animation that would overwrite the fit
      const r = this.svg.getBoundingClientRect();
      const pad = 40;
      const k = Math.min(2, Math.max(0.1, Math.min((r.width - pad * 2) / bb.w, (r.height - pad * 2) / bb.h)));
      this.view = { k, x: (r.width - bb.w * k) / 2 - bb.x * k, y: (r.height - bb.h * k) / 2 - bb.y * k };
      this.applyView();
    }

    zoomAt(factor, cx, cy) {
      const v = this.view;
      this.pauseFollow();
      const k = Math.min(4, Math.max(0.05, v.k * factor));
      this.view = { k, x: cx - ((cx - v.x) * k) / v.k, y: cy - ((cy - v.y) * k) / v.k };
      this.applyView();
    }

    zoomCenter(factor) {
      const r = this.svg.getBoundingClientRect();
      this.zoomAt(factor, r.width / 2, r.height / 2);
    }

    panBy(dx, dy) {
      this.pauseFollow();
      this.view.x += dx;
      this.view.y += dy;
      this.applyView();
    }

    // Pan (and zoom out if needed) so the focused elements are on screen; animated.
    revealFocus() {
      const bb = this.renderer.focusBox();
      if (!bb) return;
      const r = this.svg.getBoundingClientRect();
      const { x, y, k } = this.view;
      const pad = 30;
      const sx = bb.x * k + x;
      const sy = bb.y * k + y;
      if (sx >= pad && sy >= pad && sx + bb.w * k <= r.width - pad && sy + bb.h * k <= r.height - pad) return;
      const nk = Math.max(0.1, Math.min(k, (r.width - pad * 2) / bb.w, (r.height - pad * 2) / bb.h));
      this.animateView({ k: nk, x: r.width / 2 - (bb.x + bb.w / 2) * nk, y: r.height / 2 - (bb.y + bb.h / 2) * nk });
    }

    animateView(to) {
      const from = { ...this.view };
      const t0 = performance.now();
      cancelAnimationFrame(this.anim);
      const step = (now) => {
        const t = Math.min(1, (now - t0) / 220);
        const e = 1 - (1 - t) ** 3;
        this.view = { k: from.k + (to.k - from.k) * e, x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e };
        this.applyView();
        if (t < 1) this.anim = requestAnimationFrame(step);
      };
      this.anim = requestAnimationFrame(step);
    }

    // ---- follow: zoom to one element ----
    // Fits the element itself, not everything it refs (a field's focus spans every table it
    // points to), at a readable zoom. Moving within the same table only pans if the row
    // leaves the screen. A manual pan or zoom pauses following until another element comes.

    // { key, box, cy }: what to fit, and for a field the row to keep centred. el is an
    // OD.elementAtLine result.
    followTarget(el) {
      const m = this.model;
      const renderer = this.renderer;
      if (!el || !m) return null;
      const boxOf = (key) => renderer.box(key);
      switch (el.kind) {
        case 'table':
        case 'note':
          return { key: `t:${el.key}`, box: boxOf(el.key) };
        case 'field': {
          const box = boxOf(el.key);
          const t = m.tableByKey.get(el.key);
          return box && t && { key: `t:${el.key}`, box, cy: OD.geometry.anchorY(t, box, el.field, renderer.detail) };
        }
        case 'ref': {
          const r = m.refs.find((x) => x.id === el.id);
          return r && { key: `r:${el.id}`, box: OD.geometry.bbox([boxOf(r.from.table), boxOf(r.to.table)].filter(Boolean), 0) };
        }
        case 'group':
          return { key: `g:${el.key}`, box: renderer.groupBoxes && renderer.groupBoxes.get(el.key) };
        default:
          return { key: `${el.kind}:${el.key || el.name || (el.ids || []).join()}`, box: renderer.focusBox() };
      }
    }

    focusOn(el) {
      const target = this.followTarget(el);
      if (!target || !target.box) return;
      const r = this.svg.getBoundingClientRect();
      const pad = 40;
      const { box, cy } = target;
      if (target.key === this.followKey) {
        if (this.followPaused || cy === undefined) return;
        const { k, x, y } = this.view;
        const sy = cy * k + y;
        if (sy < pad || sy > r.height - pad) this.animateView({ k, x, y: r.height / 2 - cy * k });
        return;
      }
      this.followKey = target.key;
      this.followPaused = false;
      const fitK = Math.min((r.width - pad * 2) / box.w, (r.height - pad * 2) / box.h);
      const k = Math.min(FOLLOW_ZOOM[1], Math.max(FOLLOW_ZOOM[0], fitK));
      let y = r.height / 2 - (box.y + box.h / 2) * k;
      if (box.h * k > r.height - pad * 2) y = cy !== undefined ? r.height / 2 - cy * k : pad - box.y * k;
      this.animateView({ k, x: r.width / 2 - (box.x + box.w / 2) * k, y });
    }

    scheduleFocus(el) {
      clearTimeout(this.followTimer);
      this.followTimer = setTimeout(() => this.focusOn(el), 150);
    }

    pauseFollow() {
      cancelAnimationFrame(this.anim);
      clearTimeout(this.followTimer);
      this.followPaused = true;
    }

    resetFollow() {
      this.followKey = null;
      this.followPaused = false;
    }

    // ---- tooltip ----

    showTooltipFor(e) {
      const tooltip = this.options.tooltip;
      if (!tooltip || !this.model) return;
      const target = e.target.closest(TOOLTIP_TARGETS);
      if (!target) return this.hideTooltip();
      if (target !== this.tooltipTarget) {
        this.tooltipTarget = target;
        const html = tooltipHtml(this.model, target);
        if (!html) return this.hideTooltip();
        tooltip.innerHTML = html;
        tooltip.hidden = false;
      }
      if (tooltip.hidden) return;
      const pad = 14;
      const tw = tooltip.offsetWidth;
      const th = tooltip.offsetHeight;
      tooltip.style.left = `${Math.min(e.clientX + pad, window.innerWidth - tw - 8)}px`;
      tooltip.style.top = `${e.clientY + pad + th > window.innerHeight ? e.clientY - th - pad : e.clientY + pad}px`;
    }

    hideTooltip() {
      this.tooltipTarget = null;
      if (this.options.tooltip) this.options.tooltip.hidden = true;
    }

    // ---- pointer ----

    bind() {
      const svg = this.svg;
      svg.addEventListener('wheel', (e) => {
        const zoom = e.ctrlKey || e.metaKey;
        if (!zoom && this.options.wheel === 'page') return;
        e.preventDefault();
        const r = svg.getBoundingClientRect();
        if (zoom) this.zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
        else this.panBy(-e.deltaX, -e.deltaY);
      }, { passive: false });

      svg.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        const own = this.options.grab && this.options.grab(e);
        this.drag = own || { pan: true, origin: { ...this.view } };
        this.drag.start = { x: e.clientX, y: e.clientY };
        this.drag.moved = false;
        this.drag.target = e.target;
        svg.setPointerCapture(e.pointerId);
        this.hideTooltip();
      });

      svg.addEventListener('pointermove', (e) => {
        const drag = this.drag;
        if (!drag) return this.showTooltipFor(e);
        const dx = e.clientX - drag.start.x;
        const dy = e.clientY - drag.start.y;
        if (!drag.moved && Math.hypot(dx, dy) < 3) return;
        if (!drag.moved && drag.begin) drag.begin();
        drag.moved = true;
        svg.classList.add('dragging');
        if (drag.pan) {
          this.pauseFollow();
          this.view.x = drag.origin.x + dx;
          this.view.y = drag.origin.y + dy;
          this.applyView();
        } else drag.move(dx, dy, this.view.k);
      });

      svg.addEventListener('pointerup', () => {
        const drag = this.drag;
        if (!drag) return;
        this.drag = null;
        svg.classList.remove('dragging');
        if (drag.end) drag.end(drag.moved);
        if (drag.moved) return;
        const node = drag.target.closest && drag.target.closest('.od-table');
        const key = node ? node.dataset.key : null;
        if (this.options.onClick) this.options.onClick(drag.target, key);
        else this.renderer.setSelected(key);
      });

      svg.addEventListener('pointerleave', () => this.hideTooltip());
    }
  }

  OD.Viewer = Viewer;
  OD.md = md;
  OD.esc = esc;
})((window.OD = window.OD || {}));
