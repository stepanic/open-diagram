// <open-diagram>: a read-only DBML diagram for other pages, with pan, zoom, tooltips and click to
// select, but no editor. ```dbml blocks (pre > code.language-dbml) and <pre class="dbml"> are
// turned into one each, the way Mermaid does it. Attributes:
//   src        URL of a .dbml (GitHub, Gist and GitLab page links work); or the DBML as the
//              element's text
//   layout     URL of a .layout.json saved by the app; without it the diagram is auto laid out
//   algorithm  compact (default), left-right, pipeline, snowflake; only the layered ones load ELK
//   detail     all (default), keys, header
//   view       DiagramView to show
//   height     CSS height, default 480px; the width is that of the parent
//   focus      table or table.field to light up and zoom to once loaded
(function (OD) {
  const APP_URL = 'https://stepanic.github.io/open-diagram/';
  const ATTRS = ['src', 'layout', 'algorithm', 'detail', 'view', 'height', 'focus'];

  const CSS = `
:host { display: block; position: relative; height: 480px; border: 1px solid #d0d7de; border-radius: 8px;
  overflow: hidden; font: 13px/1.4 system-ui, -apple-system, 'Segoe UI', sans-serif; color: #1f2328; }
:host(:focus-visible) { outline: 2px solid #2563eb; outline-offset: 2px; }
svg { position: absolute; inset: 0; width: 100%; height: 100%; cursor: grab; touch-action: none; user-select: none; }
svg.dragging { cursor: grabbing; }
.tools { position: absolute; right: 8px; bottom: 8px; display: flex; gap: 4px; }
.tools button, .tools a { min-width: 28px; height: 28px; padding: 0 8px; border: 1px solid #d0d7de; border-radius: 6px;
  background: #fff; color: inherit; font: inherit; line-height: 26px; text-align: center; text-decoration: none; cursor: pointer; }
.tools button:hover, .tools a:hover { background: #f3f4f6; }
.message { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; padding: 16px;
  color: #57606a; text-align: center; white-space: pre-wrap; }
.message.error { color: #b91c1c; }
.tooltip { position: fixed; z-index: 10; max-width: 360px; padding: 8px 10px; border-radius: 6px; background: #0f172a;
  color: #f1f5f9; font-size: 12px; line-height: 1.45; box-shadow: 0 6px 20px rgba(15, 23, 42, 0.25); pointer-events: none; }
.tooltip code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px; color: #93c5fd; }
.tooltip .tt-flags, .tooltip .tt-muted { color: #94a3b8; }
.tooltip .tt-note { margin-top: 4px; color: #fde68a; }
.tooltip .tt-note p, .tooltip .tt-note ul, .tooltip .tt-note ol, .tooltip .tt-note pre { margin: 0 0 4px; }
.tooltip .tt-note ul, .tooltip .tt-note ol { padding-left: 16px; }
.tooltip .tt-refs, .tooltip .tt-enum, .tooltip .tt-props { margin-top: 4px; color: #cbd5e1; }
.tooltip .tt-props span { color: #94a3b8; }
.tooltip .tt-records { margin-top: 6px; border-collapse: collapse; font-size: 11px; }
.tooltip .tt-records th, .tooltip .tt-records td { border: 1px solid #334155; padding: 1px 5px; text-align: left; max-width: 140px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tooltip .tt-records th { color: #94a3b8; font-weight: 600; }
[hidden] { display: none !important; }
`;

  // Absolute links go through rawUrl (GitHub page → raw file); anything else is relative to the page.
  const resolve = (url) => (/^(https?:)?\/\//i.test(url) || /^[\w-]+(\.[\w-]+)+\//.test(url) ? OD.rawUrl(url) : new URL(url, document.baseURI).href);

  async function fetchText(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  }

  class OpenDiagram extends HTMLElement {
    static get observedAttributes() {
      return ATTRS;
    }

    constructor() {
      super();
      const root = this.attachShadow({ mode: 'open' });
      root.innerHTML = `<style>${CSS}</style><svg part="diagram"></svg><div class="message" hidden></div>
        <div class="tools" part="tools"><button data-do="out" title="Zoom out (-)">−</button><button data-do="in" title="Zoom in (+)">+</button><button data-do="fit" title="Fit (F)">Fit</button><a target="_blank" rel="noopener" title="Open in Open Diagram" hidden>↗</a></div>
        <div class="tooltip" hidden></div>`;
      this.messageEl = root.querySelector('.message');
      this.openLink = root.querySelector('a');
      this.renderer = new OD.Renderer(root.querySelector('svg'));
      this.viewer = new OD.Viewer(this.renderer, { tooltip: root.querySelector('.tooltip'), wheel: 'page' });
      root.querySelector('.tools').addEventListener('click', (e) => {
        const b = e.target.closest('[data-do]');
        if (b) this.act(b.dataset.do);
      });
      this.addEventListener('keydown', (e) => {
        const key = { f: 'fit', '+': 'in', '=': 'in', '-': 'out', Escape: 'clear' }[e.key];
        if (!key || e.metaKey || e.ctrlKey) return;
        e.preventDefault();
        this.act(key);
      });
      // A diagram that starts hidden (a closed <details>, a tab) is fitted once it gets a size.
      this.sized = false;
      new ResizeObserver(() => {
        const r = this.getBoundingClientRect();
        if (r.width && r.height && !this.sized && this.renderer.model) this.fit();
        this.sized = !!(r.width && r.height && this.renderer.model);
      }).observe(this);
      this.loading = 0;
    }

    connectedCallback() {
      if (!this.hasAttribute('tabindex')) this.tabIndex = 0;
      // Parsed by the browser after the script ran: the inline DBML is not there yet.
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => this.schedule(), { once: true });
      else this.schedule();
    }

    attributeChangedCallback(name) {
      if (name === 'height') this.style.height = this.getAttribute('height') || '';
      else if (this.isConnected) this.schedule();
    }

    // Several attributes set in a row cause one load.
    schedule() {
      if (this.pending) return;
      this.pending = true;
      queueMicrotask(() => {
        this.pending = false;
        this.load();
      });
    }

    act(what) {
      if (what === 'fit') this.fit();
      else if (what === 'in') this.viewer.zoomCenter(1.2);
      else if (what === 'out') this.viewer.zoomCenter(1 / 1.2);
      else if (what === 'clear') {
        this.renderer.setSelected(null);
        this.renderer.setFocus(null);
      }
    }

    fit() {
      if (this.renderer.model) this.viewer.fit();
    }

    message(text, error = false) {
      this.messageEl.hidden = !text;
      this.messageEl.textContent = text || '';
      this.messageEl.classList.toggle('error', error);
    }

    async load() {
      const run = ++this.loading;
      const stale = () => run !== this.loading;
      const src = this.getAttribute('src');
      const layoutAttr = this.getAttribute('layout');
      let text;
      let positions = null;
      try {
        if (src) {
          this.message('Loading…');
          text = await fetchText(resolve(src));
        } else text = this.textContent;
        if (layoutAttr) {
          const data = JSON.parse(await fetchText(resolve(layoutAttr)));
          positions = data.positions || data;
        }
      } catch (err) {
        if (!stale()) this.message(`Could not load ${src && !text ? src : layoutAttr} (${err.message})`, true);
        return;
      }
      if (stale()) return;
      if (!text.trim()) return this.message('No DBML');
      let model;
      try {
        model = OD.applyView(OD.buildModel(text), this.getAttribute('view'));
      } catch (err) {
        const first = OD.formatErrors(err)[0];
        return this.message(`${first.line ? `Line ${first.line}: ` : ''}${first.message}`, true);
      }
      const renderer = this.renderer;
      renderer.setModel(model, this.getAttribute('detail') || 'all');
      const placed = new Map();
      const keys = [...model.tables.map((t) => t.key), ...model.notes.map((n) => n.key)];
      for (const k of keys) if (positions && positions[k]) placed.set(k, { x: positions[k].x, y: positions[k].y });
      const missing = keys.filter((k) => !placed.has(k));
      try {
        if (missing.length === keys.length) {
          const laid = await OD.autoLayout(model, renderer.sizes, this.getAttribute('algorithm') || 'compact');
          laid.forEach((p, k) => placed.set(k, p));
        } else if (missing.length) {
          // Tables the layout file does not know go in a row under the rest, as in the app.
          renderer.positions = placed;
          const bb = renderer.contentBox();
          let x = bb.x;
          for (const k of missing) {
            placed.set(k, { x, y: bb.y + bb.h + 60 });
            x += renderer.sizes.get(k).w + 40;
          }
        }
      } catch (err) {
        if (!stale()) this.message(err.message, true);
        return;
      }
      if (stale()) return;
      this.message('');
      renderer.render(placed);
      this.fit();
      const r = this.getBoundingClientRect();
      this.sized = !!(r.width && r.height);
      this.focusOnAttr();
      this.openLink.hidden = !src;
      if (src) this.openLink.href = `${OD.appUrl || APP_URL}?url=${encodeURIComponent(resolve(src))}${this.getAttribute('view') ? `&view=${encodeURIComponent(this.getAttribute('view'))}` : ''}`;
      this.dispatchEvent(new CustomEvent('load', { detail: { tables: model.tables.length, refs: model.refs.length } }));
    }

    // focus="table" or "table.field"; a table name may itself contain a schema dot.
    focusOnAttr() {
      const focus = this.getAttribute('focus');
      const m = this.renderer.model;
      if (!focus || !m) return;
      let el = m.tableByKey.has(focus) ? { kind: 'table', key: focus } : null;
      const dot = focus.lastIndexOf('.');
      if (!el && dot > 0) {
        const t = m.tableByKey.get(focus.slice(0, dot));
        if (t && t.fieldByName.has(focus.slice(dot + 1))) el = { kind: 'field', key: t.key, field: focus.slice(dot + 1) };
      }
      if (!el) return;
      this.renderer.setFocus(OD.focusFor(m, el));
      this.viewer.resetFollow();
      this.viewer.focusOn(el);
    }
  }

  // ```dbml fenced blocks and <pre class="dbml"> → <open-diagram>, keeping the text as its source.
  function upgradeBlocks(root = document) {
    root.querySelectorAll('pre > code.language-dbml, pre.dbml').forEach((node) => {
      const pre = node.tagName === 'PRE' ? node : node.parentElement;
      if (!pre.isConnected) return;
      const el = document.createElement('open-diagram');
      for (const a of ATTRS) if (pre.dataset[a]) el.setAttribute(a, pre.dataset[a]);
      el.textContent = pre.textContent;
      pre.replaceWith(el);
    });
  }

  if (!customElements.get('open-diagram')) customElements.define('open-diagram', OpenDiagram);
  OD.upgradeBlocks = upgradeBlocks;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => upgradeBlocks());
  else upgradeBlocks();
})((window.OD = window.OD || {}));
