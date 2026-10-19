// Draws the model into an <svg>. Styling comes from OD.theme via an embedded <style>,
// so an exported SVG looks exactly like the screen.
(function (OD) {
  const NS = 'http://www.w3.org/2000/svg';
  const G = () => OD.geometry;

  function el(tag, attrs = {}, parent = null, text = null) {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) n.setAttribute(k, v);
    if (text !== null) n.textContent = text;
    if (parent) parent.appendChild(n);
    return n;
  }

  function isLight(hex) {
    const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return false;
    const h = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1];
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.62;
  }

  function styleSheet() {
    const t = OD.theme;
    const T = t.table;
    const R = t.ref;
    return `
      .od-root { font-family: ${t.fontFamily}; font-size: ${t.fontSize}px; }
      .od-table-bg { fill: ${T.background}; filter: drop-shadow(0 1px 3px ${T.shadow}); }
      .od-table-border { fill: none; stroke: ${T.border}; stroke-width: 1; }
      .od-table.selected .od-table-border { stroke: ${T.borderSelected}; stroke-width: 2; }
      .od-table-title { font-weight: 600; dominant-baseline: central; }
      .od-row-bg { fill: transparent; }
      .od-row:hover .od-row-bg, .od-row.active .od-row-bg { fill: ${T.rowHover}; }
      .od-row-divider { stroke: ${T.rowDivider}; stroke-width: 1; }
      .od-field-name { fill: ${T.fieldText}; dominant-baseline: central; }
      .od-field-name.pk { font-weight: 600; }
      .od-field-type { fill: ${T.typeText}; dominant-baseline: central; text-anchor: end; }
      .od-icon-pk { stroke: ${T.pkIcon}; fill: none; stroke-width: 1.5; stroke-linecap: round; }
      .od-icon-fk { stroke: ${T.fkIcon}; fill: none; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
      .od-note-mark { fill: ${T.noteMark}; }
      .od-ref-line, .od-ref-marker { fill: none; stroke: ${R.color}; stroke-width: ${R.width}; }
      .od-ref-hit { fill: none; stroke: transparent; stroke-width: 12; }
      .od-ref-label { fill: ${R.color}; font-size: 11px; font-weight: 600; dominant-baseline: central; text-anchor: middle; }
      .od-dim .od-ref { opacity: ${R.dimOpacity}; }
      .od-ref.active, .od-ref:hover { opacity: 1; }
      .od-ref.active .od-ref-line, .od-ref.active .od-ref-marker, .od-ref:hover .od-ref-line, .od-ref:hover .od-ref-marker {
        stroke: ${R.activeColor}; stroke-width: ${R.activeWidth};
      }
      .od-ref.active .od-ref-label { fill: ${R.activeColor}; }
      .od-ref.inactive .od-ref-line { stroke-dasharray: ${R.inactiveDash}; }
      .od-ref-optional { fill: ${t.canvas.background}; stroke: ${R.color}; stroke-width: ${R.width}; }
      .od-ref.active .od-ref-optional, .od-ref:hover .od-ref-optional { stroke: ${R.activeColor}; }
      .od-dep { opacity: ${t.dep.opacity}; }
      .od-dep-line { fill: none; stroke-width: ${t.dep.width}; stroke-dasharray: ${t.dep.dash}; }
      .od-dep-hit { fill: none; stroke: transparent; stroke-width: 12; }
      .od-dim .od-dep { opacity: ${R.dimOpacity}; }
      .od-dep.active, .od-dep:hover { opacity: 1; }
      .od-dep.active .od-dep-line, .od-dep:hover .od-dep-line { stroke-width: ${t.dep.width * 1.6}; }
      .od-hide-deps .od-deps { display: none; }
      .od-focus .od-table:not(.focused), .od-focus .od-group:not(.focused) { opacity: ${t.focus.dimOpacity}; }
      .od-focus .od-ref:not(.active), .od-focus .od-dep:not(.active) { opacity: ${t.focus.dimOpacity * 0.5}; }
      .od-table.focused .od-table-border { stroke: ${t.focus.color}; stroke-width: 2.5; }
      .od-row.focused .od-row-bg { fill: ${t.focus.rowFill}; }
      .od-group.focused rect:first-child { stroke-width: 2.5; stroke-opacity: 1; }
      .od-group-label { font-weight: 700; font-size: ${t.group.labelSize}px; dominant-baseline: central; }
      .od-note-bg { fill: ${t.note.background}; stroke: ${t.note.border}; }
      .od-note-title { font-weight: 600; fill: ${t.note.text}; dominant-baseline: central; }
      .od-note-text { fill: ${t.note.text}; }
    `;
  }

  // Header with only the top corners rounded.
  function headerPath(w, h, r) {
    return `M0,${h} V${r} Q0,0 ${r},0 H${w - r} Q${w},0 ${w},${r} V${h} Z`;
  }

  class Renderer {
    constructor(svg) {
      this.svg = svg;
      this.model = null;
      this.detail = 'all';
      this.sizes = new Map();
      this.positions = new Map();
      this.selected = null;
      this.focus = null; // what the editor cursor points at, see setFocus()
      this.buildSkeleton();
    }

    buildSkeleton() {
      const C = OD.theme.canvas;
      this.svg.innerHTML = '';
      this.svg.classList.add('od-root');
      this.svg.style.background = C.background;
      el('style', {}, this.svg, styleSheet());
      const defs = el('defs', {}, this.svg);
      const pat = el('pattern', { id: 'od-grid', width: C.gridSize, height: C.gridSize, patternUnits: 'userSpaceOnUse' }, defs);
      el('circle', { cx: 1, cy: 1, r: 1, fill: C.gridDot }, pat);
      this.viewport = el('g', { class: 'od-viewport' }, this.svg);
      this.gridRect = el('rect', { class: 'od-grid', x: -1e5, y: -1e5, width: 2e5, height: 2e5, fill: 'url(#od-grid)' }, this.viewport);
      this.layerGroups = el('g', { class: 'od-groups' }, this.viewport);
      this.layerRefs = el('g', { class: 'od-refs' }, this.viewport);
      this.layerDeps = el('g', { class: 'od-deps' }, this.viewport);
      this.layerTables = el('g', { class: 'od-tables' }, this.viewport);
    }

    setModel(model, detail) {
      this.model = model;
      this.detail = detail;
      this.sizes = new Map();
      for (const t of model.tables) this.sizes.set(t.key, G().tableSize(t, detail));
      for (const n of model.notes) this.sizes.set(n.key, G().noteSize(n));
    }

    box(key) {
      const p = this.positions.get(key);
      const s = this.sizes.get(key);
      return p && s ? { x: p.x, y: p.y, w: s.w, h: s.h } : null;
    }

    render(positions) {
      this.positions = positions;
      this.layerTables.innerHTML = '';
      this.tableNodes = new Map();
      for (const t of this.model.tables) this.drawTable(t);
      for (const n of this.model.notes) this.drawNote(n);
      this.updateDynamic();
      this.setSelected(this.selected && this.model.tableByKey.has(this.selected) ? this.selected : null);
      this.applyFocus();
    }

    // Groups and refs depend on table positions; redraw them while dragging.
    updateDynamic() {
      this.drawGroups();
      this.drawRefs();
      this.drawDeps();
      if (this.selected) this.markActiveRefs(this.selected);
      this.applyFocus();
    }

    moveNode(key) {
      const p = this.positions.get(key);
      const node = this.tableNodes.get(key);
      if (node && p) node.setAttribute('transform', `translate(${p.x},${p.y})`);
    }

    drawTable(t) {
      const T = OD.theme.table;
      const { w, h } = this.sizes.get(t.key);
      const p = this.positions.get(t.key) || { x: 0, y: 0 };
      const header = t.headerColor || T.headerDefault;
      const g = el('g', { class: 'od-table', 'data-key': t.key, transform: `translate(${p.x},${p.y})` }, this.layerTables);
      this.tableNodes.set(t.key, g);

      el('rect', { class: 'od-table-bg', width: w, height: h, rx: T.radius }, g);
      const head = el('g', { class: 'od-table-header', 'data-key': t.key }, g);
      el('path', { d: headerPath(w, T.headerHeight, T.radius), fill: header }, head);
      el('text', { class: 'od-table-title', x: T.paddingX, y: T.headerHeight / 2, fill: isLight(header) ? '#111827' : T.headerText }, head, t.name);
      if (t.note) el('path', { class: 'od-note-mark', d: `M${w - 12},0 H${w - T.radius} Q${w},0 ${w},${T.radius} V12 Z` }, head);

      G().visibleFields(t, this.detail).forEach((f, i) => {
        const y = T.headerHeight + i * T.rowHeight;
        const row = el('g', { class: 'od-row', 'data-key': t.key, 'data-field': f.name, transform: `translate(0,${y})` }, g);
        el('rect', { class: 'od-row-bg', width: w, height: T.rowHeight }, row);
        if (i > 0) el('line', { class: 'od-row-divider', x1: 0, x2: w, y1: 0, y2: 0 }, row);
        const cy = T.rowHeight / 2;
        if (f.pk) this.drawKeyIcon(row, T.paddingX, cy);
        else if (f.fk) this.drawFkIcon(row, T.paddingX, cy);
        el('text', { class: `od-field-name${f.pk ? ' pk' : ''}`, x: T.paddingX + T.iconWidth, y: cy }, row, f.name);
        el('text', { class: 'od-field-type', x: w - T.paddingX, y: cy }, row, G().typeLabel(f));
        if (f.note) el('path', { class: 'od-note-mark', d: `M${w - 7},0 H${w} V7 Z` }, row);
      });

      el('rect', { class: 'od-table-border', width: w, height: h, rx: T.radius }, g);
    }

    drawKeyIcon(parent, x, cy) {
      const g = el('g', { class: 'od-icon-pk', transform: `translate(${x},${cy - 6})` }, parent);
      el('circle', { cx: 3.5, cy: 3.5, r: 2.8 }, g);
      el('path', { d: 'M5.5,5.5 L11,11 M8.5,8.5 L10,7 M10,10 L11.5,8.5' }, g);
    }

    drawFkIcon(parent, x, cy) {
      el('path', { class: 'od-icon-fk', d: `M${x},${cy} H${x + 10} M${x + 7},${cy - 3} L${x + 10},${cy} L${x + 7},${cy + 3}` }, parent);
    }

    drawNote(n) {
      const N = OD.theme.note;
      const { w, h, lines } = this.sizes.get(n.key);
      const p = this.positions.get(n.key) || { x: 0, y: 0 };
      const g = el('g', { class: 'od-table od-note', 'data-key': n.key, transform: `translate(${p.x},${p.y})` }, this.layerTables);
      this.tableNodes.set(n.key, g);
      el('rect', { class: 'od-note-bg', width: w, height: h, rx: 4, fill: n.color || null }, g);
      el('text', { class: 'od-note-title', x: N.padding, y: N.padding + 8 }, g, n.name);
      const text = el('text', { class: 'od-note-text', x: N.padding, y: N.padding + 22 }, g);
      lines.forEach((line, i) => el('tspan', { x: N.padding, dy: i === 0 ? N.lineHeight - 4 : N.lineHeight }, text, line));
    }

    drawGroups() {
      const Gt = OD.theme.group;
      this.layerGroups.innerHTML = '';
      this.groupBoxes = new Map();
      for (const grp of this.model.groups) {
        const boxes = grp.tables.map((k) => this.box(k)).filter(Boolean);
        const bb = G().bbox(boxes, Gt.padding);
        if (!bb) continue;
        bb.y -= Gt.labelHeight;
        bb.h += Gt.labelHeight;
        this.groupBoxes.set(grp.key, bb);
        const color = grp.color || Gt.defaultColor;
        const g = el('g', { class: 'od-group', 'data-group': grp.key }, this.layerGroups);
        el('rect', {
          x: bb.x, y: bb.y, width: bb.w, height: bb.h, rx: Gt.radius,
          fill: color, 'fill-opacity': Gt.fillOpacity, stroke: color, 'stroke-opacity': Gt.strokeOpacity,
        }, g);
        el('rect', { class: 'od-group-handle', 'data-group': grp.key, x: bb.x, y: bb.y, width: bb.w, height: Gt.labelHeight, fill: 'transparent' }, g);
        el('text', { class: 'od-group-label', 'data-group': grp.key, x: bb.x + Gt.padding, y: bb.y + Gt.labelHeight / 2 + 4, fill: color }, g, grp.name);
      }
    }

    drawRefs() {
      const R = OD.theme.ref;
      this.layerRefs.innerHTML = '';
      this.refNodes = new Map();
      const allBoxes = [...this.positions.keys()].map((k) => [k, this.box(k)]).filter(([, b]) => b);
      for (const r of this.model.refs) {
        const a = this.box(r.from.table);
        const b = this.box(r.to.table);
        if (!a || !b) continue;
        const ta = this.model.tableByKey.get(r.from.table);
        const tb = this.model.tableByKey.get(r.to.table);
        const ay = G().anchorY(ta, a, r.from.fields[0], this.detail);
        const by = G().anchorY(tb, b, r.to.fields[0], this.detail);
        const obstacles = allBoxes.filter(([k]) => k !== r.from.table && k !== r.to.table).map(([, box]) => box);
        const route = G().routeRef(a, ay, b, by, obstacles);
        const g = el('g', { class: `od-ref${r.inactive ? ' inactive' : ''}`, 'data-ref': r.id }, this.layerRefs);
        const d = G().roundedPath(route.points, R.radius);
        el('path', { class: 'od-ref-hit', d, 'data-ref': r.id }, g);
        el('path', { class: 'od-ref-line', d, style: r.color ? `stroke:${r.color}` : null }, g);
        if (R.marker === 'labels') {
          for (const [end, many] of [[route.start, r.from.many], [route.end, r.to.many]]) {
            el('text', { class: 'od-ref-label', x: end.x + end.dir * 10, y: end.y - 8 }, g, many ? '*' : '1');
          }
        } else {
          el('path', { class: 'od-ref-marker', d: G().markerPath(route.start, r.from.many) + G().markerPath(route.end, r.to.many) }, g);
          const optional = [[route.start, r.from], [route.end, r.to]].filter(([, ep]) => ep.optional);
          if (optional.length) el('path', { class: 'od-ref-optional', d: optional.map(([end]) => G().optionalPath(end)).join('') }, g);
        }
        this.refNodes.set(r.id, g);
      }
    }

    // Lineage edges: dashed, routed like refs, with an arrow into the derived table.
    drawDeps() {
      const D = OD.theme.dep;
      this.layerDeps.innerHTML = '';
      this.depNodes = new Map();
      const allBoxes = [...this.positions.keys()].map((k) => [k, this.box(k)]).filter(([, b]) => b);
      for (const dep of this.model.deps) {
        const a = this.box(dep.from.table);
        const b = this.box(dep.to.table);
        if (!a || !b) continue;
        const ta = this.model.tableByKey.get(dep.from.table);
        const tb = this.model.tableByKey.get(dep.to.table);
        const ay = G().anchorY(ta, a, dep.from.fields[0], this.detail);
        const by = G().anchorY(tb, b, dep.to.fields[0], this.detail);
        const obstacles = allBoxes.filter(([k]) => k !== dep.from.table && k !== dep.to.table).map(([, box]) => box);
        const route = G().routeRef(a, ay, b, by, obstacles);
        const color = dep.color || D.color;
        const g = el('g', { class: 'od-dep', 'data-dep': dep.id }, this.layerDeps);
        const d = G().roundedPath(route.points, OD.theme.ref.radius);
        el('path', { class: 'od-dep-hit', d, 'data-dep': dep.id }, g);
        el('path', { class: 'od-dep-line', d, stroke: color }, g);
        el('path', { class: 'od-dep-arrow', d: G().arrowPath(route.end, D.arrow), fill: color }, g);
        this.depNodes.set(dep.id, g);
      }
    }

    setSelected(key) {
      this.selected = key;
      for (const [k, n] of this.tableNodes) n.classList.toggle('selected', k === key);
      this.svg.classList.toggle('od-dim', !!key);
      this.markActiveRefs(key);
      if (this.focus) this.applyFocus();
    }

    markActiveRefs(key) {
      for (const r of this.model.refs) {
        const n = this.refNodes.get(r.id);
        if (n) n.classList.toggle('active', !!key && (r.from.table === key || r.to.table === key));
      }
      for (const dep of this.model.deps) {
        const n = this.depNodes && this.depNodes.get(dep.id);
        if (n) n.classList.toggle('active', !!key && (dep.from.table === key || dep.to.table === key));
      }
    }

    // Light up one source element (OD.focusFor) and fade the rest; null clears it.
    setFocus(focus) {
      const empty = !focus || !(focus.tables.size || focus.notes.size || focus.refs.size || focus.deps.size);
      this.focus = empty ? null : focus;
      this.applyFocus();
    }

    applyFocus() {
      const f = this.focus;
      this.svg.classList.toggle('od-focus', !!f);
      if (!this.tableNodes) return;
      for (const [k, n] of this.tableNodes) n.classList.toggle('focused', !!f && (f.tables.has(k) || f.notes.has(k)));
      this.svg.querySelectorAll('.od-row').forEach((row) => {
        const fields = f && f.fields.get(row.dataset.key);
        row.classList.toggle('focused', !!fields && fields.has(row.dataset.field));
      });
      this.svg.querySelectorAll('.od-group').forEach((g) => g.classList.toggle('focused', !!f && f.groups.has(g.dataset.group)));
      if (!this.refNodes || !this.depNodes) return;
      this.markActiveRefs(this.selected);
      if (f) {
        for (const [id, n] of this.refNodes) if (f.refs.has(id)) n.classList.add('active');
        for (const [id, n] of this.depNodes) if (f.deps.has(id)) n.classList.add('active');
      }
    }

    // Bounding box of the focused boxes (tables and notes), for scrolling them into view.
    focusBox() {
      if (!this.focus) return null;
      const keys = [...this.focus.tables, ...this.focus.notes];
      const boxes = keys.map((k) => this.box(k)).filter(Boolean);
      for (const k of this.focus.groups) if (this.groupBoxes && this.groupBoxes.get(k)) boxes.push(this.groupBoxes.get(k));
      return G().bbox(boxes, 0);
    }

    contentBox() {
      const boxes = [...this.positions.keys()].map((k) => this.box(k)).filter(Boolean);
      if (this.groupBoxes) boxes.push(...this.groupBoxes.values());
      return G().bbox(boxes, 0);
    }

    // Standalone SVG of the whole diagram (no grid, no selection).
    exportSvg(padding = 32) {
      const bb = this.contentBox();
      const clone = this.svg.cloneNode(true);
      clone.querySelector('.od-grid').remove();
      clone.querySelector('.od-viewport').removeAttribute('transform');
      clone.classList.remove('od-dim', 'od-focus');
      clone.querySelectorAll('.selected, .active, .focused').forEach((n) => n.classList.remove('selected', 'active', 'focused'));
      clone.querySelectorAll('.od-ref-hit, .od-dep-hit, .od-group-handle').forEach((n) => n.remove());
      clone.setAttribute('xmlns', NS);
      clone.setAttribute('viewBox', `${bb.x - padding} ${bb.y - padding} ${bb.w + padding * 2} ${bb.h + padding * 2}`);
      clone.setAttribute('width', Math.ceil(bb.w + padding * 2));
      clone.setAttribute('height', Math.ceil(bb.h + padding * 2));
      clone.removeAttribute('style');
      clone.removeAttribute('id');
      const bg = el('rect', { x: bb.x - padding, y: bb.y - padding, width: bb.w + padding * 2, height: bb.h + padding * 2, fill: OD.theme.canvas.background });
      clone.insertBefore(bg, clone.querySelector('.od-viewport'));
      return new XMLSerializer().serializeToString(clone);
    }
  }

  OD.Renderer = Renderer;
})((window.OD = window.OD || {}));
