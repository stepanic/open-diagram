// Automatic placement, in four flavours (OD.layoutAlgorithms). Every algorithm works on two levels:
// the tables inside each TableGroup are placed first, then the groups (as boxes) together with the
// ungrouped tables and notes. A group box is always the bounding box of its tables, so laying out
// the members first keeps groups from overlapping each other.
(function (OD) {
  // ELK (1.6 MB) is needed only by the layered algorithms. When the page has not loaded
  // elk.bundled.js it is fetched on first use, from OD.elkUrl or next to this script in vendor/.
  const here = document.currentScript && document.currentScript.src;
  let elk = null;
  function getElk() {
    if (!elk) {
      elk = window.ELK
        ? Promise.resolve(new window.ELK())
        : new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = OD.elkUrl || new URL('../vendor/elk.bundled.js', here || location.href).href;
            s.onload = () => resolve(new window.ELK());
            s.onerror = () => {
              elk = null;
              reject(new Error(`Could not load ELK from ${s.src}`));
            };
            document.head.appendChild(s);
          });
    }
    return elk;
  }

  const ALGORITHMS = [
    {
      id: 'left-right',
      key: '1',
      name: 'Left-right',
      description: 'Arrange tables left to right following their foreign-key relationships. Best for schemas with long relationship chains.',
    },
    {
      id: 'pipeline',
      key: '2',
      name: 'Pipeline',
      description: 'Arrange tables left to right along their data-dependency lineage. Table groups become stages ordered left to right, with their tables stacked vertically.',
    },
    {
      id: 'snowflake',
      key: '3',
      name: 'Snowflake',
      description: 'Arrange tables in a snowflake shape, with the most connected tables in the center. Ideal for densely connected diagrams like data warehouses.',
    },
    {
      id: 'compact',
      key: '4',
      name: 'Compact',
      description: 'Arrange tables in a compact rectangle layout. Ideal for diagrams with few relationships and tables.',
    },
  ];

  // ---- placement primitives ------------------------------------------------------------
  // Each takes items [{id, w, h}] and edges [[from, to]] between item ids and resolves to
  // {pos: Map<id, {x, y}>, w, h} with the top-left corner of the content at 0,0.

  function normalise(items, pos) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const it of items) {
      const p = pos.get(it.id);
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x + it.w);
      y1 = Math.max(y1, p.y + it.h);
    }
    if (!items.length) return { pos, w: 0, h: 0 };
    for (const p of pos.values()) {
      p.x = Math.round(p.x - x0);
      p.y = Math.round(p.y - y0);
    }
    return { pos, w: x1 - x0, h: y1 - y0 };
  }

  // ELK layered, left to right. Unconnected parts are packed towards aspectRatio.
  async function layered(items, edges, { spacing = 1, aspectRatio } = {}) {
    const L = OD.theme.layout;
    const graph = {
      id: 'root',
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': L.direction,
        'elk.aspectRatio': String(aspectRatio || L.aspectRatio),
        'elk.spacing.nodeNode': String(L.nodeSpacing * spacing),
        'elk.layered.spacing.nodeNodeBetweenLayers': String(L.layerSpacing * spacing),
        'elk.spacing.componentComponent': String(L.componentSpacing * spacing),
        'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
        'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
        'elk.padding': '[top=0,left=0,bottom=0,right=0]',
        ...L.elk,
      },
      children: items.map((it) => ({ id: it.id, width: it.w, height: it.h })),
      edges: edges.map(([a, b], i) => ({ id: `e${i}`, sources: [a], targets: [b] })),
    };
    const result = await (await getElk()).layout(graph);
    const pos = new Map(result.children.map((c) => [c.id, { x: c.x, y: c.y }]));
    return normalise(items, pos);
  }

  // Order items so that referenced ones come before the ones pointing at them (cycles broken
  // by model order), then stack them in one column.
  function stack(items, edges) {
    const gap = OD.theme.layout.nodeSpacing * 0.6;
    const pos = new Map();
    let y = 0;
    for (const it of topoOrder(items, edges)) {
      pos.set(it.id, { x: 0, y });
      y += it.h + gap;
    }
    return normalise(items, pos);
  }

  function topoOrder(items, edges) {
    const indeg = new Map(items.map((it) => [it.id, 0]));
    const out = new Map(items.map((it) => [it.id, []]));
    for (const [a, b] of edges) {
      out.get(a).push(b);
      indeg.set(b, indeg.get(b) + 1);
    }
    const done = new Set();
    const order = [];
    while (order.length < items.length) {
      // First ready item in model order; with a cycle, the first one left.
      const next = items.find((it) => !done.has(it.id) && indeg.get(it.id) === 0) || items.find((it) => !done.has(it.id));
      done.add(next.id);
      order.push(next);
      for (const b of out.get(next.id)) indeg.set(b, indeg.get(b) - 1);
    }
    return order;
  }

  // Most connected item in the middle; every next one is the item with the most links to what is
  // already placed, put as close as it fits to the centre of its placed neighbours, searching
  // outwards along a spiral that starts on the side facing away from the middle.
  function snowflake(items, edges) {
    const gap = OD.theme.layout.nodeSpacing;
    const adj = new Map(items.map((it) => [it.id, new Set()]));
    for (const [a, b] of edges) {
      adj.get(a).add(b);
      adj.get(b).add(a);
    }
    const rects = [];
    const centre = new Map();
    const pos = new Map();
    const free = (x, y, w, h) => rects.every((r) => x >= r.x + r.w + gap || r.x >= x + w + gap || y >= r.y + r.h + gap || r.y >= y + h + gap);

    const left = [...items];
    while (left.length) {
      let best = 0, bestScore = -1;
      left.forEach((it, i) => {
        let linked = 0;
        for (const n of adj.get(it.id)) if (pos.has(n)) linked++;
        const score = linked * 1000 + adj.get(it.id).size;
        if (score > bestScore) [best, bestScore] = [i, score];
      });
      const it = left.splice(best, 1)[0];

      const placed = [...adj.get(it.id)].filter((n) => pos.has(n));
      let tx = 0, ty = 0;
      for (const n of placed) {
        tx += centre.get(n).x / placed.length;
        ty += centre.get(n).y / placed.length;
      }
      const away = Math.atan2(ty, tx);
      let spot = null;
      for (let r = 0; !spot; r += 12) {
        const steps = Math.max(1, Math.ceil((2 * Math.PI * r) / 24));
        for (let s = 0; s < steps && !spot; s++) {
          // 0, +1, -1, +2, -2 … steps away from the outward direction.
          const k = s % 2 ? (s + 1) / 2 : -s / 2;
          const a = away + (2 * Math.PI * k) / steps;
          const cx = tx + r * Math.cos(a);
          const cy = ty + r * Math.sin(a);
          if (free(cx - it.w / 2, cy - it.h / 2, it.w, it.h)) spot = { cx, cy };
        }
      }
      rects.push({ x: spot.cx - it.w / 2, y: spot.cy - it.h / 2, w: it.w, h: it.h });
      centre.set(it.id, { x: spot.cx, y: spot.cy });
      pos.set(it.id, { x: spot.cx - it.w / 2, y: spot.cy - it.h / 2 });
    }
    return normalise(items, pos);
  }

  // Shelf packing: tallest first, rows as wide as a rectangle of aspectRatio holding them all.
  function compact(items) {
    const L = OD.theme.layout;
    const gap = L.nodeSpacing * 0.75;
    const area = items.reduce((s, it) => s + (it.w + gap) * (it.h + gap), 0);
    const rowWidth = Math.max(...items.map((it) => it.w), Math.sqrt(area * L.aspectRatio));
    const pos = new Map();
    let x = 0, y = 0, rowH = 0;
    for (const it of [...items].sort((a, b) => b.h - a.h)) {
      if (x > 0 && x + it.w > rowWidth) {
        x = 0;
        y += rowH + gap;
        rowH = 0;
      }
      pos.set(it.id, { x, y });
      x += it.w + gap;
      rowH = Math.max(rowH, it.h);
    }
    return normalise(items, pos);
  }

  const PLACE = {
    'left-right': { inner: (i, e) => layered(i, e, { spacing: 0.75 }), outer: layered },
    pipeline: { inner: stack, outer: (i, e) => layered(i, e, { aspectRatio: 3 }) },
    snowflake: { inner: snowflake, outer: snowflake },
    compact: { inner: compact, outer: compact },
  };

  // sizes: Map<key, {w, h}> for tables and notes. Resolves to Map<key, {x, y}>.
  async function autoLayout(model, sizes, algorithm = 'left-right') {
    const place = PLACE[algorithm] || PLACE['left-right'];
    const G = OD.theme.group;
    const item = (key) => ({ id: key, w: sizes.get(key).w, h: sizes.get(key).h });

    // Edges run from the referenced table to the FK table so parents land left of children.
    const tableEdges = [];
    const seen = new Set();
    for (const r of model.refs) {
      const id = `${r.to.table}->${r.from.table}`;
      if (r.from.table === r.to.table || seen.has(id)) continue;
      seen.add(id);
      tableEdges.push([r.to.table, r.from.table]);
    }

    const unitOf = new Map();
    const groups = model.groups.filter((g) => g.tables.length);
    for (const g of groups) for (const k of g.tables) unitOf.set(k, `group:${g.key}`);
    for (const t of model.tables) if (!unitOf.has(t.key)) unitOf.set(t.key, t.key);

    // Inner layouts, then each group becomes a box the size of its tables plus padding.
    const units = [];
    const inner = new Map();
    for (const g of groups) {
      const members = g.tables.map(item);
      const keys = new Set(g.tables);
      const res = await place.inner(members, tableEdges.filter(([a, b]) => keys.has(a) && keys.has(b)));
      const id = `group:${g.key}`;
      inner.set(id, res);
      units.push({ id, w: res.w + 2 * G.padding, h: res.h + 2 * G.padding + G.labelHeight });
    }
    for (const t of model.tables) if (unitOf.get(t.key) === t.key) units.push(item(t.key));
    for (const n of model.notes) units.push(item(n.key));

    const unitEdges = [];
    const seenUnits = new Set();
    for (const [a, b] of tableEdges) {
      const ua = unitOf.get(a), ub = unitOf.get(b);
      if (ua === ub || seenUnits.has(`${ua}->${ub}`)) continue;
      seenUnits.add(`${ua}->${ub}`);
      unitEdges.push([ua, ub]);
    }

    const outer = await place.outer(units, unitEdges);
    const margin = 40;
    const positions = new Map();
    for (const u of units) {
      const p = outer.pos.get(u.id);
      const res = inner.get(u.id);
      if (!res) {
        positions.set(u.id, { x: p.x + margin, y: p.y + margin });
        continue;
      }
      for (const [k, q] of res.pos) {
        positions.set(k, { x: p.x + margin + G.padding + q.x, y: p.y + margin + G.padding + G.labelHeight + q.y });
      }
    }
    return positions;
  }

  OD.autoLayout = autoLayout;
  OD.layoutAlgorithms = ALGORITHMS;
})((window.OD = window.OD || {}));
