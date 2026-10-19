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
    showDeps: store.get('showDeps', true),
    viewName: null, // DiagramView currently shown, null = whole model
    fullModel: null, // model before the DiagramView filter
    model: null,
    positions: new Map(),
    view: { x: 0, y: 0, k: 1 },
    fitted: false,
  };

  const svg = $('#diagram');
  const editor = $('#editor');
  const gutter = $('#gutter');
  const highlight = $('#highlight');
  const searchMarks = $('#search-marks');
  const statusEl = $('#status');
  const tooltip = $('#tooltip');
  const renderer = new OD.Renderer(svg);

  // ---- editor ------------------------------------------------------------------------

  let errorLines = new Set();
  let warnLines = new Set();

  function renderGutter() {
    const count = editor.value.split('\n').length;
    let html = '';
    for (let i = 1; i <= count; i++) html += `<div${errorLines.has(i) ? ' class="err"' : warnLines.has(i) ? ' class="warn"' : ''}>${i}</div>`;
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
    searchMarks.scrollTop = editor.scrollTop;
    searchMarks.scrollLeft = editor.scrollLeft;
    placeLineMark();
  }

  // Diagram → source: a band on the line a clicked element comes from. The editor does not take
  // focus, so canvas shortcuts (F, +, -) keep working instead of typing into the DBML.
  const lineMark = $('#line-mark');
  let markedLine = 0;

  function placeLineMark() {
    lineMark.hidden = !markedLine;
    if (!markedLine) return;
    const lh = parseFloat(getComputedStyle(editor).lineHeight);
    lineMark.style.top = `${parseFloat(getComputedStyle(editor).paddingTop) + (markedLine - 1) * lh - editor.scrollTop}px`;
  }

  function markSourceLine(line) {
    markedLine = line || 0;
    if (markedLine) {
      const lh = parseFloat(getComputedStyle(editor).lineHeight);
      const top = (markedLine - 1) * lh;
      if (top < editor.scrollTop || top > editor.scrollTop + editor.clientHeight - lh * 2) editor.scrollTop = Math.max(0, top - editor.clientHeight / 3);
      editor.scrollLeft = 0;
    }
    syncScroll();
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
    if (!searchBar.hidden) runSearch({ jump: false });
    clearTimeout(parseTimer);
    parseTimer = setTimeout(() => {
      state.source = editor.value;
      store.set('source', state.source);
      parse();
    }, 300);
  });
  editor.addEventListener('scroll', syncScroll);

  // ---- editor search (⌘F) -----------------------------------------------------------

  const searchBar = $('#search');
  const searchInput = $('#search-input');
  const search = { matches: [], index: -1, length: 0 };

  function openSearch() {
    const sel = editor.value.slice(editor.selectionStart, editor.selectionEnd);
    if (sel && !sel.includes('\n')) searchInput.value = sel;
    searchBar.hidden = false;
    searchInput.focus();
    searchInput.select();
    runSearch({ jump: true });
  }

  function closeSearch() {
    const m = search.matches[search.index];
    searchBar.hidden = true;
    search.matches = [];
    renderSearchMarks();
    editor.focus();
    if (m !== undefined) editor.setSelectionRange(m, m + search.length);
  }

  // Case-insensitive plain text. jump: move to the first match at or after the caret.
  function runSearch({ jump }) {
    const q = searchInput.value.toLowerCase();
    const text = editor.value.toLowerCase();
    search.matches = [];
    search.length = q.length;
    if (q) for (let i = text.indexOf(q); i >= 0; i = text.indexOf(q, i + q.length)) search.matches.push(i);
    if (jump) {
      const from = editor.selectionStart;
      const next = search.matches.findIndex((m) => m >= from);
      gotoMatch(next < 0 ? 0 : next);
    } else {
      search.index = Math.min(search.index, search.matches.length - 1);
      renderSearchMarks();
    }
  }

  function gotoMatch(i) {
    const n = search.matches.length;
    search.index = n ? (i + n) % n : -1;
    renderSearchMarks();
    if (!n) return;
    const m = search.matches[search.index];
    editor.setSelectionRange(m, m + search.length);
    const before = editor.value.slice(0, m);
    const line = before.split('\n').length;
    const col = m - before.lastIndexOf('\n') - 1;
    revealInEditor(line, col);
    focusLine(line);
  }

  let charWidth = 0;
  function revealInEditor(line, col) {
    const lh = parseFloat(getComputedStyle(editor).lineHeight);
    const top = (line - 1) * lh;
    if (top < editor.scrollTop || top > editor.scrollTop + editor.clientHeight - lh * 3) editor.scrollTop = Math.max(0, top - editor.clientHeight / 3);
    if (!charWidth) {
      const ctx = document.createElement('canvas').getContext('2d');
      ctx.font = getComputedStyle(editor).font;
      charWidth = ctx.measureText('0').width;
    }
    const x = col * charWidth;
    if (x < editor.scrollLeft || x > editor.scrollLeft + editor.clientWidth - 80) editor.scrollLeft = Math.max(0, x - editor.clientWidth / 3);
    syncScroll();
  }

  function renderSearchMarks() {
    const { matches, index, length } = search;
    const text = editor.value;
    searchBar.classList.toggle('none', !!searchInput.value && !matches.length);
    $('#search-count').textContent = searchInput.value ? `${matches.length ? index + 1 : 0}/${matches.length}` : '';
    if (searchBar.hidden || !matches.length) {
      searchMarks.innerHTML = '';
      return;
    }
    let html = '';
    let at = 0;
    matches.forEach((m, i) => {
      html += `${esc(text.slice(at, m))}<mark${i === index ? ' class="cur"' : ''}>${esc(text.slice(m, m + length))}</mark>`;
      at = m + length;
    });
    searchMarks.innerHTML = `${html}${esc(text.slice(at))}\n `;
    syncScroll();
  }

  searchInput.addEventListener('input', () => runSearch({ jump: true }));
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      gotoMatch(search.index + (e.shiftKey ? -1 : 1));
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeSearch();
    }
  });
  searchBar.querySelectorAll('[data-search]').forEach((b) =>
    b.addEventListener('click', () => {
      if (b.dataset.search === 'close') closeSearch();
      else gotoMatch(search.index + (b.dataset.search === 'prev' ? -1 : 1));
    }),
  );

  // ---- editor cursor → diagram -------------------------------------------------------
  // The element under the caret lights up on the canvas and scrolls into view.

  let focusedLine = 0;
  const caretLine = () => editor.value.slice(0, editor.selectionStart).split('\n').length;

  function focusLine(line, { reveal = true } = {}) {
    focusedLine = line;
    if (!state.fullModel || !state.model) return;
    const el = OD.elementAtLine(state.fullModel, line);
    renderer.setFocus(OD.focusFor(state.model, el));
    if (reveal) revealFocus();
  }

  function clearFocus() {
    focusedLine = 0;
    renderer.setFocus(null);
  }

  let caretFrame = 0;
  document.addEventListener('selectionchange', () => {
    if (document.activeElement !== editor) return;
    cancelAnimationFrame(caretFrame);
    caretFrame = requestAnimationFrame(() => {
      if (markedLine) markSourceLine(0);
      const line = caretLine();
      if (line !== focusedLine) focusLine(line);
    });
  });
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
      state.fullModel = model;
    } catch (err) {
      const errors = OD.formatErrors(err);
      errorLines = new Set(errors.map((e) => e.line).filter(Boolean));
      renderProblems(null);
      renderGutter();
      const first = errors[0];
      setStatus(`${first.line ? `Line ${first.line}: ` : ''}${first.message}${errors.length > 1 ? `  (+${errors.length - 1} more)` : ''}`, 'error');
      statusEl.onclick = () => jumpToLine(first.line);
      return;
    }
    errorLines = new Set();
    renderProblems(model);
    renderGutter();
    statusEl.onclick = null;
    renderViewMenu();
    renderProject();
    if (state.viewName && !model.views.some((v) => v.name === state.viewName)) setView(null, { apply: false });
    await applyModel(OD.applyView(model, state.viewName));
    showStatus();
    if (focusedLine) focusLine(focusedLine, { reveal: false });
  }

  function showStatus() {
    const m = state.model;
    const parts = [`${m.tables.length} tables`, `${m.refs.length} refs`];
    if (m.deps.length) parts.push(`${m.deps.length} deps`);
    parts.push(`${m.groups.length} groups`);
    if (m.notes.length) parts.push(`${m.notes.length} notes`);
    if (state.viewName) parts.push(`view ${state.viewName}`);
    setStatus(parts.join(' · '));
  }

  // ---- problems panel ----------------------------------------------------------------

  const problemsEl = $('#problems');
  const problemList = $('#problem-list');
  let suggestions = [];

  function renderProblems(model) {
    const problems = model ? OD.lint(model) : [];
    suggestions = model ? OD.suggestRefs(model) : [];
    const lineOf = (s) => model.tableByKey.get(s.from.table).fieldByName.get(s.from.field).line;
    const items = [
      ...problems,
      ...suggestions.map((s) => ({ level: 'suggest', message: `${s.from.table}.${s.from.field} looks like a ref to ${s.to.table}.${s.to.field}`, line: lineOf(s) })),
    ];
    warnLines = new Set(problems.filter((p) => p.level === 'warning').map((p) => p.line).filter(Boolean));
    problemsEl.hidden = !items.length;
    problemsEl.classList.toggle('collapsed', !store.get('problemsOpen', true));
    const count = (level, one, many) => {
      const n = items.filter((i) => i.level === level).length;
      return n ? `${n} ${n === 1 ? one : many}` : null;
    };
    $('.pr-toggle').textContent = `Problems: ${[count('warning', 'warning', 'warnings'), count('info', 'note', 'notes'), count('suggest', 'suggested ref', 'suggested refs')].filter(Boolean).join(' · ')}`;
    const add = $('.pr-suggest');
    add.hidden = !suggestions.length;
    add.textContent = `Add ${suggestions.length} ref${suggestions.length === 1 ? '' : 's'}`;
    problemList.replaceChildren(...items.map((p) => {
      const li = document.createElement('li');
      li.className = p.level;
      li.textContent = p.message;
      if (p.line) {
        const n = document.createElement('span');
        n.className = 'pr-line';
        n.textContent = p.line;
        li.prepend(n);
        li.addEventListener('click', () => jumpToLine(p.line));
      }
      return li;
    }));
  }

  // Appends the suggested refs at the end of the source, as an undoable edit, for review.
  function addSuggestedRefs() {
    if (!suggestions.length) return;
    const text = `${editor.value.endsWith('\n') ? '' : '\n'}\n// Suggested from column names: keep, fix or delete\n${suggestions.map((s) => `${s.dbml} // suggested`).join('\n')}\n`;
    editor.focus();
    editor.setSelectionRange(editor.value.length, editor.value.length);
    if (!document.execCommand('insertText', false, text)) {
      editor.value += text;
      editor.dispatchEvent(new Event('input'));
    }
    editor.scrollTop = editor.scrollHeight;
  }

  // Each DiagramView keeps its own layout, so a view can be arranged on its own.
  const positionsKey = () => `positions:${state.docName}${state.viewName ? `#${state.viewName}` : ''}`;

  async function applyModel(model, { relayout = false } = {}) {
    state.model = model;
    renderer.setModel(model, state.detail);
    const saved = relayout ? {} : store.get(positionsKey(), {});
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
    store.set(positionsKey(), Object.fromEntries(state.positions));
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

  // Pan (and zoom out if needed) so the focused elements are on screen; animated.
  let viewAnim = 0;
  function revealFocus() {
    const bb = renderer.focusBox();
    if (!bb) return;
    const r = svg.getBoundingClientRect();
    const { x, y, k } = state.view;
    const pad = 30;
    const sx = bb.x * k + x;
    const sy = bb.y * k + y;
    if (sx >= pad && sy >= pad && sx + bb.w * k <= r.width - pad && sy + bb.h * k <= r.height - pad) return;
    const nk = Math.max(0.1, Math.min(k, (r.width - pad * 2) / bb.w, (r.height - pad * 2) / bb.h));
    const to = { k: nk, x: r.width / 2 - (bb.x + bb.w / 2) * nk, y: r.height / 2 - (bb.y + bb.h / 2) * nk };
    const from = { ...state.view };
    const t0 = performance.now();
    cancelAnimationFrame(viewAnim);
    const step = (now) => {
      const t = Math.min(1, (now - t0) / 220);
      const e = 1 - (1 - t) ** 3;
      state.view = { k: from.k + (to.k - from.k) * e, x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e };
      applyView();
      if (t < 1) viewAnim = requestAnimationFrame(step);
    };
    viewAnim = requestAnimationFrame(step);
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
    drag.target = e.target;
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
    if (!drag.moved) {
      clearFocus();
      renderer.setSelected(drag.clickKey || null);
      const line = sourceLineOf(drag.target);
      markSourceLine(line);
      if (line) focusLine(line, { reveal: false });
    }
    drag = null;
  });

  // Source line of the diagram element under `target`: field row, ref, dep, group title,
  // table header or sticky note.
  function sourceLineOf(target) {
    const m = state.model;
    if (!m || !target || !target.closest) return null;
    const row = target.closest('.od-row');
    if (row) return m.tableByKey.get(row.dataset.key).fieldByName.get(row.dataset.field).line;
    const ref = target.closest('.od-ref-hit');
    if (ref) return m.refs.find((r) => r.id === ref.dataset.ref).line;
    const dep = target.closest('.od-dep-hit');
    if (dep) return m.deps.find((d) => d.id === dep.dataset.dep).line;
    const grp = target.closest('.od-group-handle, .od-group-label');
    if (grp) return m.groups.find((g) => g.key === grp.dataset.group).line;
    const node = target.closest('.od-table');
    if (node) {
      const item = m.tableByKey.get(node.dataset.key) || m.notes.find((n) => n.key === node.dataset.key);
      return item && item.line;
    }
    return null;
  }

  // Double click: into the editor at that line, ready to edit.
  svg.addEventListener('dblclick', (e) => {
    const line = sourceLineOf(e.target);
    if (!line) return;
    markSourceLine(0);
    jumpToLine(line);
  });

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

  function tooltipHtml(target) {
    const m = state.model;
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

  let tooltipTarget = null;
  function showTooltipFor(e) {
    const target = e.target.closest('.od-row, .od-table-header, .od-ref-hit, .od-dep-hit, .od-group-label, .od-group-handle');
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
    state.viewName = store.get(`view:${name}`, null);
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
    'export-menu': () => (exportMenu.hidden = !exportMenu.hidden),
    'toggle-problems': () => {
      store.set('problemsOpen', problemsEl.classList.toggle('collapsed') === false);
    },
    'add-suggested-refs': addSuggestedRefs,
    fit,
    'zoom-in': () => zoomCenter(1.2),
    'zoom-out': () => zoomCenter(1 / 1.2),
    'toggle-deps': () => setShowDeps(!state.showDeps),
    'toggle-project': () => {
      const panel = $('#project-panel');
      if (panel.hidden && !state.fullModel.project.note) return;
      panel.hidden = !panel.hidden;
      $('[data-action="toggle-project"]').setAttribute('aria-pressed', String(!panel.hidden));
    },
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

  // Text exports. Mermaid and Markdown follow the current DiagramView, like SVG and PNG; SQL is
  // generated from the whole source by @dbml/core.
  const exportMenu = $('#export-menu');
  const SQL_NAMES = { postgres: 'PostgreSQL', mysql: 'MySQL', mssql: 'SQL Server', oracle: 'Oracle' };
  async function exportAs(kind) {
    exportMenu.hidden = true;
    const name = `${baseName()}${state.viewName ? `.${state.viewName}` : ''}`;
    try {
      if (kind === 'mermaid') {
        const text = OD.toMermaid(state.model);
        download(`${name}.mmd`, new Blob([text], { type: 'text/plain' }));
        try {
          await navigator.clipboard.writeText(`\`\`\`mermaid\n${text}\`\`\`\n`);
          setStatus(`Saved ${name}.mmd; a \`\`\`mermaid block is on the clipboard`);
        } catch {
          setStatus(`Saved ${name}.mmd`);
        }
      } else if (kind === 'markdown') {
        download(`${name}.md`, new Blob([OD.toMarkdown(state.model, baseName())], { type: 'text/markdown' }));
      } else {
        const db = window.dbmlCore.Parser.parse(state.source, 'dbmlv2');
        download(`${baseName()}.${kind}.sql`, new Blob([window.dbmlCore.ModelExporter.export(db, kind)], { type: 'text/plain' }));
        setStatus(`Saved ${baseName()}.${kind}.sql (${SQL_NAMES[kind]})`);
      }
    } catch (err) {
      setStatus(`Export failed: ${OD.formatErrors(err)[0].message}`, 'error');
    }
  }
  exportMenu.querySelectorAll('[data-export]').forEach((b) => b.addEventListener('click', () => exportAs(b.dataset.export)));

  // DiagramView picker: shown only when the DBML has views.
  const viewSelect = $('#view');
  function renderViewMenu() {
    const views = state.fullModel.views;
    viewSelect.hidden = !views.length;
    viewSelect.innerHTML = '';
    viewSelect.append(new Option('Whole model', ''));
    for (const v of views) viewSelect.append(new Option(`View: ${v.name}`, v.name));
    viewSelect.value = state.viewName || '';
  }
  function setView(name, { apply = true } = {}) {
    state.viewName = name || null;
    store.set(`view:${state.docName}`, state.viewName);
    viewSelect.value = state.viewName || '';
    if (!apply) return;
    state.positions = new Map();
    state.fitted = false;
    renderer.setSelected(null);
    applyModel(OD.applyView(state.fullModel, state.viewName)).then(() => {
      showStatus();
      if (focusedLine) focusLine(focusedLine, { reveal: false });
    });
  }
  viewSelect.addEventListener('change', (e) => setView(e.target.value));

  // Lineage (Dep) lines can be hidden; the choice is remembered.
  const depsButton = $('[data-action="toggle-deps"]');
  function setShowDeps(on) {
    state.showDeps = on;
    store.set('showDeps', on);
    svg.classList.toggle('od-hide-deps', !on);
    depsButton.setAttribute('aria-pressed', String(on));
  }

  // Project note (Markdown) in a panel over the canvas.
  function renderProject() {
    const p = state.fullModel.project;
    const button = $('[data-action="toggle-project"]');
    button.hidden = !p.note;
    depsButton.hidden = !state.fullModel.deps.length;
    if (!p.note) {
      $('#project-panel').hidden = true;
      return;
    }
    const meta = [p.name, p.databaseType].filter(Boolean).map(esc).join(' · ');
    $('#project-body').innerHTML = `${meta ? `<div class="pp-meta">${meta}</div>` : ''}${md(p.note)}`;
  }

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
    if (!exportMenu.hidden && !e.target.closest('#export-menu, [data-action="export-menu"]')) exportMenu.hidden = true;
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
    } else if (mod && e.key === 'f' && !document.body.classList.contains('editor-hidden')) {
      e.preventDefault();
      openSearch();
    } else if (mod && e.key === 'g' && !searchBar.hidden) {
      e.preventDefault();
      gotoMatch(search.index + (e.shiftKey ? -1 : 1));
    } else if (e.target.closest('input, textarea, select')) {
      return;
    } else if (!layoutMenu.hidden && (e.key === 'Escape' || OD.layoutAlgorithms.some((a) => a.key === e.key))) {
      const a = OD.layoutAlgorithms.find((x) => x.key === e.key);
      if (a) relayout(a.id);
      else toggleLayoutMenu(false);
    } else if (e.key === 'f') fit();
    else if (e.key === 'l' && state.fullModel && state.fullModel.deps.length) actions['toggle-deps']();
    else if (e.key === 'p') actions['toggle-project']();
    else if (e.key === '+' || e.key === '=') zoomCenter(1.2);
    else if (e.key === '-') zoomCenter(1 / 1.2);
    else if (e.key === 'Escape') {
      exportMenu.hidden = true;
      clearFocus();
      markSourceLine(0);
      renderer.setSelected(null);
    }
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
  state.viewName = store.get(`view:${state.docName}`, null);
  setShowDeps(state.showDeps);
  editor.value = state.source;
  renderGutter();
  renderHighlight();
  parse();

  OD.app = { state, renderer, openText, actions, fit, relayout, setView, md, focusLine, openSearch };
})((window.OD = window.OD || {}));
