// UI wiring: editor, canvas interaction, persistence, import/export.
(function (OD) {
  const $ = (sel) => document.querySelector(sel);
  const STORE = 'open-diagram:';

  const SAMPLE = `// Paste or open a .dbml file. Drag tables, drag group titles, scroll to pan, pinch or ⌘/Ctrl+scroll to zoom.

Project sample {
  database_type: 'PostgreSQL'
}

Table users [headercolor: #316896] {
  id integer [pk, increment]
  email varchar [unique, not null]
  name varchar
  created_at timestamp [default: \`now()\`]
  Note: 'People who can sign in'
}

Table posts [headercolor: #0f766e] {
  id integer [pk, increment]
  author_id integer [not null, ref: > users.id]
  title varchar [not null]
  body text [note: 'Markdown']
  status post_status
}

Table comments [headercolor: #0f766e] {
  id integer [pk, increment]
  post_id integer [ref: > posts.id]
  user_id integer [ref: > users.id]
  body text
}

Enum post_status {
  draft
  published
}

TableGroup content [color: #0f766e] {
  posts
  comments
}
`;

  // 24×24 stroke icons for the auto layout menu.
  const icon = (body) => `<svg class="lm-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
  const LAYOUT_ICONS = {
    'left-right': icon('<rect x="2" y="3" width="6" height="6" rx="1.5"/><rect x="2" y="15" width="6" height="6" rx="1.5"/><rect x="16" y="9" width="6" height="6" rx="1.5"/><path d="M8 6h3v12H8M11 12h5"/>'),
    pipeline: icon('<circle cx="4" cy="7" r="2"/><circle cx="12" cy="7" r="2"/><circle cx="20" cy="7" r="2"/><circle cx="4" cy="17" r="2"/><circle cx="12" cy="17" r="2"/><circle cx="20" cy="17" r="2"/><path d="M6 7h4M14 7h4M6 17h4M14 17h4"/>'),
    snowflake: icon('<rect x="9.5" y="9.5" width="5" height="5" rx="1"/><circle cx="12" cy="3" r="1.8"/><circle cx="12" cy="21" r="1.8"/><circle cx="3" cy="12" r="1.8"/><circle cx="21" cy="12" r="1.8"/><path d="M12 4.8v4.7M12 14.5v4.7M4.8 12h4.7M14.5 12h4.7"/>'),
    compact: icon('<rect x="3" y="3" width="5" height="5" rx="1"/><rect x="10" y="3" width="5" height="5" rx="1"/><rect x="17" y="3" width="4" height="5" rx="1"/><rect x="3" y="10" width="5" height="5" rx="1"/><rect x="10" y="10" width="5" height="5" rx="1"/><rect x="17" y="10" width="4" height="5" rx="1"/><rect x="3" y="17" width="5" height="4" rx="1"/><rect x="10" y="17" width="5" height="4" rx="1"/><rect x="17" y="17" width="4" height="4" rx="1"/>'),
  };

  const store = {
    get(key, fallback = null) {
      try {
        const v = localStorage.getItem(STORE + key);
        return v === null ? fallback : JSON.parse(v);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(STORE + key, JSON.stringify(value));
      } catch {
        /* storage full or blocked: the diagram still works, it just won't remember */
      }
    },
  };

  const state = {
    docName: store.get('docName', 'untitled'),
    source: store.get('source', SAMPLE),
    detail: store.get('detail', 'all'),
    algorithm: store.get('layoutAlgorithm', 'left-right'),
    model: null,
    positions: new Map(),
    view: { x: 0, y: 0, k: 1 },
    fitted: false,
  };

  const svg = $('#diagram');
  const editor = $('#editor');
  const gutter = $('#gutter');
  const highlight = $('#highlight');
  const statusEl = $('#status');
  const tooltip = $('#tooltip');
  const renderer = new OD.Renderer(svg);

  // ---- editor ------------------------------------------------------------------------

  let errorLines = new Set();

  function renderGutter() {
    const count = editor.value.split('\n').length;
    let html = '';
    for (let i = 1; i <= count; i++) html += `<div${errorLines.has(i) ? ' class="err"' : ''}>${i}</div>`;
    gutter.innerHTML = html;
    syncScroll();
  }

  // The trailing line keeps the highlight as tall as the textarea's scroll range.
  function renderHighlight() {
    highlight.innerHTML = `${OD.highlightDbml(editor.value)}\n `;
    syncScroll();
  }

  function syncScroll() {
    gutter.scrollTop = editor.scrollTop;
    highlight.scrollTop = editor.scrollTop;
    highlight.scrollLeft = editor.scrollLeft;
  }

  function jumpToLine(line) {
    if (!line) return;
    const lines = editor.value.split('\n');
    const start = lines.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0);
    editor.focus();
    editor.setSelectionRange(start, start + lines[line - 1].length);
    const lh = parseFloat(getComputedStyle(editor).lineHeight);
    editor.scrollTop = Math.max(0, (line - 4) * lh);
  }

  let parseTimer = null;
  editor.addEventListener('input', () => {
    renderGutter();
    renderHighlight();
    clearTimeout(parseTimer);
    parseTimer = setTimeout(() => {
      state.source = editor.value;
      store.set('source', state.source);
      parse();
    }, 300);
  });
  editor.addEventListener('scroll', syncScroll);
  editor.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      document.execCommand('insertText', false, '  ');
    }
  });

  // ---- parse → layout → render -------------------------------------------------------

  function setStatus(text, kind = '') {
    statusEl.textContent = text;
    statusEl.className = kind;
  }

  async function parse() {
    let model;
    try {
      model = OD.buildModel(state.source);
    } catch (err) {
      const errors = OD.formatErrors(err);
      errorLines = new Set(errors.map((e) => e.line).filter(Boolean));
      renderGutter();
      const first = errors[0];
      setStatus(`${first.line ? `Line ${first.line}: ` : ''}${first.message}${errors.length > 1 ? `  (+${errors.length - 1} more)` : ''}`, 'error');
      statusEl.onclick = () => jumpToLine(first.line);
      return;
    }
    errorLines = new Set();
    renderGutter();
    statusEl.onclick = null;
    await applyModel(model);
    setStatus(`${model.tables.length} tables · ${model.refs.length} refs · ${model.groups.length} groups${model.notes.length ? ` · ${model.notes.length} notes` : ''}`);
  }

  async function applyModel(model, { relayout = false } = {}) {
    state.model = model;
    renderer.setModel(model, state.detail);
    const saved = relayout ? {} : store.get(`positions:${state.docName}`, {});
    const keys = [...model.tables.map((t) => t.key), ...model.notes.map((n) => n.key)];
    const positions = new Map();
    for (const k of keys) {
      const p = state.positions.get(k) || saved[k];
      if (p && !relayout) positions.set(k, { x: p.x, y: p.y });
    }
    const missing = keys.filter((k) => !positions.has(k));
    if (missing.length === keys.length) {
      const laid = await OD.autoLayout(model, renderer.sizes, state.algorithm);
      laid.forEach((p, k) => positions.set(k, p));
      state.fitted = false;
    } else if (missing.length) {
      // New tables on an existing layout go in a row under everything else.
      renderer.positions = positions;
      const bb = renderer.contentBox();
      let x = bb.x;
      for (const k of missing) {
        positions.set(k, { x, y: bb.y + bb.h + 60 });
        x += renderer.sizes.get(k).w + 40;
      }
    }
    state.positions = positions;
    renderer.render(positions);
    savePositions();
    if (!state.fitted) {
      fit();
      state.fitted = true;
    }
  }

  function savePositions() {
    store.set(`positions:${state.docName}`, Object.fromEntries(state.positions));
  }

  // ---- view: pan / zoom --------------------------------------------------------------

  function applyView() {
    const { x, y, k } = state.view;
    renderer.viewport.setAttribute('transform', `translate(${x},${y}) scale(${k})`);
    $('#zoom-level').textContent = `${Math.round(k * 100)}%`;
  }

  function fit() {
    const bb = renderer.contentBox();
    if (!bb) return;
    const r = svg.getBoundingClientRect();
    const pad = 40;
    const k = Math.min(2, Math.max(0.1, Math.min((r.width - pad * 2) / bb.w, (r.height - pad * 2) / bb.h)));
    state.view = { k, x: (r.width - bb.w * k) / 2 - bb.x * k, y: (r.height - bb.h * k) / 2 - bb.y * k };
    applyView();
  }

  function zoomAt(factor, cx, cy) {
    const v = state.view;
    const k = Math.min(4, Math.max(0.05, v.k * factor));
    state.view = { k, x: cx - ((cx - v.x) * k) / v.k, y: cy - ((cy - v.y) * k) / v.k };
    applyView();
  }

  function zoomCenter(factor) {
    const r = svg.getBoundingClientRect();
    zoomAt(factor, r.width / 2, r.height / 2);
  }

  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = svg.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
    else {
      state.view.x -= e.deltaX;
      state.view.y -= e.deltaY;
      applyView();
    }
  }, { passive: false });

  // ---- drag tables, groups, canvas ---------------------------------------------------

  let drag = null;

  svg.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const groupEl = e.target.closest('[data-group]');
    const tableEl = e.target.closest('.od-table');
    const start = { x: e.clientX, y: e.clientY };
    if (tableEl) {
      const key = tableEl.dataset.key;
      drag = { kind: 'nodes', keys: [key], origin: new Map([[key, { ...state.positions.get(key) }]]), start, clickKey: key, el: tableEl };
    } else if (groupEl && groupEl.matches('.od-group-handle, .od-group-label')) {
      const grp = state.model.groups.find((g) => g.key === groupEl.dataset.group);
      const keys = grp.tables.filter((k) => state.positions.has(k));
      drag = { kind: 'nodes', keys, origin: new Map(keys.map((k) => [k, { ...state.positions.get(k) }])), start };
    } else {
      drag = { kind: 'pan', origin: { ...state.view }, start };
    }
    drag.moved = false;
    svg.setPointerCapture(e.pointerId);
    hideTooltip();
  });

  svg.addEventListener('pointermove', (e) => {
    if (!drag) return showTooltipFor(e);
    const dx = e.clientX - drag.start.x;
    const dy = e.clientY - drag.start.y;
    if (!drag.moved && Math.hypot(dx, dy) < 3) return;
    if (!drag.moved && drag.el) drag.el.parentNode.appendChild(drag.el); // bring to front
    drag.moved = true;
    svg.classList.add('dragging');
    if (drag.kind === 'pan') {
      state.view.x = drag.origin.x + dx;
      state.view.y = drag.origin.y + dy;
      applyView();
      return;
    }
    const k = state.view.k;
    for (const key of drag.keys) {
      const o = drag.origin.get(key);
      state.positions.set(key, { x: Math.round(o.x + dx / k), y: Math.round(o.y + dy / k) });
      renderer.moveNode(key);
    }
    renderer.updateDynamic();
  });

  svg.addEventListener('pointerup', () => {
    if (!drag) return;
    svg.classList.remove('dragging');
    if (drag.kind === 'nodes' && drag.moved) savePositions();
    if (!drag.moved) renderer.setSelected(drag.clickKey || null);
    drag = null;
  });

  svg.addEventListener('dblclick', (e) => {
    const tableEl = e.target.closest('.od-table');
    if (!tableEl) return;
    const key = tableEl.dataset.key;
    const item = state.model.tableByKey.get(key) || state.model.notes.find((n) => n.key === key);
    jumpToLine(item && item.line);
  });

  // ---- tooltip -----------------------------------------------------------------------

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  function tooltipHtml(target) {
    const m = state.model;
    const row = target.closest('.od-row');
    if (row) {
      const t = m.tableByKey.get(row.dataset.key);
      const f = t.fieldByName.get(row.dataset.field);
      const flags = [f.pk && 'primary key', f.fk && 'foreign key', f.unique && 'unique', f.notNull && 'not null', f.increment && 'increment'].filter(Boolean);
      const refs = m.refs
        .filter((r) => (r.from.table === t.key && r.from.fields.includes(f.name)) || (r.to.table === t.key && r.to.fields.includes(f.name)))
        .map((r) => (r.from.table === t.key ? `→ ${r.to.table}.${r.to.fields.join(', ')}` : `← ${r.from.table}.${r.from.fields.join(', ')}`));
      const enumValues = f.enumKey ? m.enums.get(f.enumKey) : null;
      return `<b>${esc(t.name)}.${esc(f.name)}</b> <code>${esc(f.type)}</code>
        ${flags.length ? `<div class="tt-flags">${flags.map(esc).join(' · ')}</div>` : ''}
        ${f.default !== null ? `<div>default: <code>${esc(f.default)}</code></div>` : ''}
        ${f.note ? `<div class="tt-note">${esc(f.note)}</div>` : ''}
        ${enumValues ? `<div class="tt-enum">${enumValues.map((v) => `<code>${esc(v.name)}</code>`).join(' ')}</div>` : ''}
        ${refs.length ? `<div class="tt-refs">${refs.map(esc).join('<br>')}</div>` : ''}`;
    }
    const header = target.closest('.od-table-header');
    if (header) {
      const t = m.tableByKey.get(header.dataset.key);
      const idx = t.indexes.map((i) => `(${i.columns.join(', ')})${i.pk ? ' pk' : i.unique ? ' unique' : ''}`);
      if (!t.note && !t.alias && !idx.length) return null;
      return `<b>${esc(t.name)}</b>${t.alias ? ` <span class="tt-muted">as ${esc(t.alias)}</span>` : ''}
        ${t.note ? `<div class="tt-note">${esc(t.note)}</div>` : ''}
        ${idx.length ? `<div class="tt-refs">indexes: ${idx.map(esc).join(', ')}</div>` : ''}`;
    }
    const refEl = target.closest('.od-ref-hit');
    if (refEl) {
      const r = m.refs.find((x) => x.id === refEl.dataset.ref);
      const actions = [r.onDelete && `on delete ${r.onDelete}`, r.onUpdate && `on update ${r.onUpdate}`].filter(Boolean);
      return `<code>${esc(r.from.table)}.${esc(r.from.fields.join(', '))}</code> ${r.from.many ? '*' : '1'}–${r.to.many ? '*' : '1'}
        <code>${esc(r.to.table)}.${esc(r.to.fields.join(', '))}</code>${actions.length ? `<div class="tt-flags">${actions.map(esc).join(' · ')}</div>` : ''}`;
    }
    const groupEl = target.closest('.od-group-label, .od-group-handle');
    if (groupEl) {
      const g = m.groups.find((x) => x.key === groupEl.dataset.group);
      return g.note ? `<b>${esc(g.name)}</b><div class="tt-note">${esc(g.note)}</div>` : null;
    }
    return null;
  }

  let tooltipTarget = null;
  function showTooltipFor(e) {
    const target = e.target.closest('.od-row, .od-table-header, .od-ref-hit, .od-group-label, .od-group-handle');
    if (!target) return hideTooltip();
    if (target !== tooltipTarget) {
      tooltipTarget = target;
      const html = tooltipHtml(target);
      if (!html) return hideTooltip();
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

  function hideTooltip() {
    tooltipTarget = null;
    tooltip.hidden = true;
  }
  svg.addEventListener('pointerleave', hideTooltip);

  // ---- files -------------------------------------------------------------------------

  function download(name, blob) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  const baseName = () => state.docName.replace(/\.dbml$/i, '') || 'diagram';

  async function openText(name, text) {
    state.docName = name;
    store.set('docName', name);
    state.source = text;
    store.set('source', text);
    state.positions = new Map();
    state.fitted = false;
    editor.value = text;
    $('#doc-name').textContent = name;
    renderGutter();
    renderHighlight();
    await parse();
  }

  async function openFile(file) {
    const text = await file.text();
    if (/\.json$/i.test(file.name)) return importLayout(JSON.parse(text));
    await openText(file.name, text);
  }

  function importLayout(data) {
    const positions = data.positions || data;
    for (const [k, p] of Object.entries(positions)) if (state.model.tableByKey.has(k) || k.startsWith('note:')) state.positions.set(k, p);
    renderer.render(state.positions);
    savePositions();
    fit();
  }

  function exportPng(scale = 2) {
    const svgText = renderer.exportSvg();
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.width * scale;
      c.height = img.height * scale;
      const ctx = c.getContext('2d');
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0);
      c.toBlob((blob) => download(`${baseName()}.png`, blob), 'image/png');
    };
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`;
  }

  const actions = {
    open: () => $('#file-input').click(),
    'save-dbml': () => download(`${baseName()}.dbml`, new Blob([editor.value], { type: 'text/plain' })),
    'export-svg': () => download(`${baseName()}.svg`, new Blob([renderer.exportSvg()], { type: 'image/svg+xml' })),
    'export-png': () => exportPng(),
    'save-layout': () => download(`${baseName()}.layout.json`, new Blob([JSON.stringify({ positions: Object.fromEntries(state.positions) }, null, 2)], { type: 'application/json' })),
    'auto-layout': () => toggleLayoutMenu(),
    fit,
    'zoom-in': () => zoomCenter(1.2),
    'zoom-out': () => zoomCenter(1 / 1.2),
    'toggle-editor': () => {
      document.body.classList.toggle('editor-hidden');
      store.set('editorHidden', document.body.classList.contains('editor-hidden'));
    },
  };

  document.querySelectorAll('[data-action]').forEach((b) => b.addEventListener('click', () => actions[b.dataset.action]()));
  $('#file-input').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (f) openFile(f);
    e.target.value = '';
  });
  $('#detail').value = state.detail;
  $('#detail').addEventListener('change', (e) => {
    state.detail = e.target.value;
    store.set('detail', state.detail);
    applyModel(state.model);
  });

  // Auto layout menu: pick an algorithm with the mouse or 1–4; it is remembered for next time.
  const layoutMenu = $('#layout-menu');
  function renderLayoutMenu() {
    layoutMenu.querySelectorAll('[data-algorithm]').forEach((b) => b.classList.toggle('current', b.dataset.algorithm === state.algorithm));
  }
  function toggleLayoutMenu(open = layoutMenu.hidden) {
    layoutMenu.hidden = !open;
    if (open) renderLayoutMenu();
  }
  function relayout(algorithm) {
    toggleLayoutMenu(false);
    state.algorithm = algorithm;
    store.set('layoutAlgorithm', algorithm);
    return applyModel(state.model, { relayout: true }).then(fit);
  }
  for (const a of OD.layoutAlgorithms) {
    const b = document.createElement('button');
    b.dataset.algorithm = a.id;
    b.innerHTML = `${LAYOUT_ICONS[a.id]}<span class="lm-name"></span><kbd></kbd><span class="lm-desc"></span>`;
    b.querySelector('.lm-name').textContent = a.name;
    b.querySelector('kbd').textContent = a.key;
    b.querySelector('.lm-desc').textContent = a.description;
    b.addEventListener('click', () => relayout(a.id));
    layoutMenu.append(b);
  }
  document.addEventListener('pointerdown', (e) => {
    if (!layoutMenu.hidden && !e.target.closest('#layout-menu, [data-action="auto-layout"]')) toggleLayoutMenu(false);
  }, true);

  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) openFile(f);
  });

  window.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key === 's') {
      e.preventDefault();
      actions['save-dbml']();
    } else if (mod && e.key === 'o') {
      e.preventDefault();
      actions.open();
    } else if (e.target === editor) {
      return;
    } else if (!layoutMenu.hidden && (e.key === 'Escape' || OD.layoutAlgorithms.some((a) => a.key === e.key))) {
      const a = OD.layoutAlgorithms.find((x) => x.key === e.key);
      if (a) relayout(a.id);
      else toggleLayoutMenu(false);
    } else if (e.key === 'f') fit();
    else if (e.key === '+' || e.key === '=') zoomCenter(1.2);
    else if (e.key === '-') zoomCenter(1 / 1.2);
    else if (e.key === 'Escape') renderer.setSelected(null);
  });

  // Resizable editor pane.
  const splitter = $('#splitter');
  splitter.addEventListener('pointerdown', (e) => {
    splitter.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const w = Math.min(window.innerWidth - 200, Math.max(220, ev.clientX));
      document.documentElement.style.setProperty('--editor-width', `${w}px`);
    };
    const up = () => {
      splitter.removeEventListener('pointermove', move);
      store.set('editorWidth', getComputedStyle(document.documentElement).getPropertyValue('--editor-width'));
    };
    splitter.addEventListener('pointermove', move);
    splitter.addEventListener('pointerup', up, { once: true });
  });

  // ---- boot --------------------------------------------------------------------------

  const width = store.get('editorWidth');
  if (width) document.documentElement.style.setProperty('--editor-width', width);
  if (store.get('editorHidden')) document.body.classList.add('editor-hidden');
  $('#doc-name').textContent = state.docName;
  editor.value = state.source;
  renderGutter();
  renderHighlight();
  parse();

  OD.app = { state, renderer, openText, actions, fit, relayout };
})((window.OD = window.OD || {}));
