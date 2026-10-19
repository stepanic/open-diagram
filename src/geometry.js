// Sizes of diagram boxes and the routing of reference lines. Pure functions of model + theme.
(function (OD) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  function textWidth(text, weight = 400, size = OD.theme.fontSize) {
    ctx.font = `${weight} ${size}px ${OD.theme.fontFamily}`;
    return ctx.measureText(text).width;
  }

  // detail: 'all' | 'keys' (PK, FK and referenced fields) | 'header'
  function visibleFields(table, detail) {
    if (detail === 'header') return [];
    if (detail === 'keys') return table.fields.filter((f) => f.pk || f.fk || f.referenced);
    return table.fields;
  }

  function typeLabel(f) {
    return OD.theme.table.notNullMark && f.notNull && !f.pk ? `${f.type} NN` : f.type;
  }

  function tableSize(table, detail) {
    const T = OD.theme.table;
    const fields = visibleFields(table, detail);
    let w = textWidth(table.name, 600) + T.paddingX * 2 + (table.note ? 14 : 0);
    for (const f of fields) {
      w = Math.max(w, T.paddingX * 2 + T.iconWidth + textWidth(f.name, f.pk ? 600 : 400) + T.typeGap + textWidth(typeLabel(f)));
    }
    return {
      w: Math.ceil(Math.max(T.minWidth, w)),
      h: T.headerHeight + fields.length * T.rowHeight,
    };
  }

  function wrapText(text, maxWidth) {
    const lines = [];
    for (const para of String(text).split('\n')) {
      let line = '';
      for (const word of para.split(/\s+/)) {
        const next = line ? `${line} ${word}` : word;
        if (line && textWidth(next) > maxWidth) {
          lines.push(line);
          line = word;
        } else line = next;
      }
      lines.push(line);
    }
    return lines;
  }

  function noteSize(note) {
    const N = OD.theme.note;
    const lines = wrapText(note.content, N.width - N.padding * 2);
    return { w: N.width, h: N.padding * 2 + 22 + lines.length * N.lineHeight, lines };
  }

  // Y of a field's row centre, or of the header when the field is hidden at this detail level.
  function anchorY(table, box, fieldName, detail) {
    const T = OD.theme.table;
    const idx = visibleFields(table, detail).findIndex((f) => f.name === fieldName);
    return idx < 0 ? box.y + T.headerHeight / 2 : box.y + T.headerHeight + idx * T.rowHeight + T.rowHeight / 2;
  }

  // How many obstacle boxes an axis-aligned segment passes through.
  function hits(x1, y1, x2, y2, obstacles) {
    const [lx, hx] = x1 < x2 ? [x1, x2] : [x2, x1];
    const [ly, hy] = y1 < y2 ? [y1, y2] : [y2, y1];
    let n = 0;
    for (const o of obstacles) if (lx < o.x + o.w && hx > o.x && ly < o.y + o.h && hy > o.y) n++;
    return n;
  }

  // X for the vertical run of a route: the candidate in [lo, hi] crossing the fewest obstacles,
  // nearest to `preferred` on ties. Candidates are the preferred X and the gaps beside each box.
  function pickX(lo, hi, preferred, y1, y2, xStart, xEnd, obstacles) {
    const gap = OD.theme.ref.stub / 2;
    const candidates = [preferred];
    for (const o of obstacles) candidates.push(o.x - gap, o.x + o.w + gap);
    let best = preferred;
    let bestScore = Infinity;
    for (const x of candidates) {
      if (x < lo || x > hi) continue;
      const score = (hits(xStart, y1, x, y1, obstacles) + hits(x, y1, x, y2, obstacles) + hits(x, y2, xEnd, y2, obstacles)) * 1e6 + Math.abs(x - preferred);
      if (score < bestScore) {
        bestScore = score;
        best = x;
      }
    }
    return best;
  }

  // Orthogonal route between two table boxes. Returns the polyline and the outward direction
  // (+1 right, -1 left) at each end so markers can be drawn facing away from the table.
  // obstacles: the other boxes on the canvas, which the vertical run tries to avoid.
  function routeRef(a, ay, b, by, obstacles = []) {
    const S = OD.theme.ref.stub;
    const aR = a.x + a.w;
    const bR = b.x + b.w;
    let start, end;
    if (a === b) {
      const x = aR + S * 1.6;
      start = { x: aR, y: ay, dir: 1 };
      end = { x: aR, y: by === ay ? ay + 1 : by, dir: 1 };
      return { points: [start, { x, y: start.y }, { x, y: end.y }, end], start, end };
    }
    if (aR + S * 2 <= b.x || bR + S * 2 <= a.x) {
      const rightward = aR + S * 2 <= b.x;
      start = rightward ? { x: aR, y: ay, dir: 1 } : { x: a.x, y: ay, dir: -1 };
      end = rightward ? { x: b.x, y: by, dir: -1 } : { x: bR, y: by, dir: 1 };
      const lo = Math.min(start.x, end.x) + S;
      const hi = Math.max(start.x, end.x) - S;
      const x = pickX(lo, hi, (start.x + end.x) / 2, ay, by, start.x, end.x, obstacles);
      return { points: [start, { x, y: ay }, { x, y: by }, end], start, end };
    }
    // Horizontally overlapping boxes: leave both on the side where their edges line up better.
    const useRight = Math.abs(aR - bR) <= Math.abs(a.x - b.x);
    start = useRight ? { x: aR, y: ay, dir: 1 } : { x: a.x, y: ay, dir: -1 };
    end = useRight ? { x: bR, y: by, dir: 1 } : { x: b.x, y: by, dir: -1 };
    const edge = useRight ? Math.max(aR, bR) + S : Math.min(a.x, b.x) - S;
    const x = useRight
      ? pickX(edge, edge + 400, edge, ay, by, start.x, end.x, obstacles)
      : pickX(edge - 400, edge, edge, ay, by, start.x, end.x, obstacles);
    return { points: [start, { x, y: ay }, { x, y: by }, end], start, end };
  }

  // Polyline → SVG path with rounded corners.
  function roundedPath(points, radius) {
    const pts = points.filter((p, i) => i === 0 || p.x !== points[i - 1].x || p.y !== points[i - 1].y);
    let d = `M${pts[0].x},${pts[0].y}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const p = pts[i];
      const prev = pts[i - 1];
      const next = pts[i + 1];
      const r = Math.min(radius, Math.hypot(p.x - prev.x, p.y - prev.y) / 2, Math.hypot(next.x - p.x, next.y - p.y) / 2);
      const inX = p.x - Math.sign(p.x - prev.x) * r;
      const inY = p.y - Math.sign(p.y - prev.y) * r;
      const outX = p.x + Math.sign(next.x - p.x) * r;
      const outY = p.y + Math.sign(next.y - p.y) * r;
      d += ` L${inX},${inY} Q${p.x},${p.y} ${outX},${outY}`;
    }
    const last = pts[pts.length - 1];
    return `${d} L${last.x},${last.y}`;
  }

  // Marker at an endpoint: crow's foot for "many", a bar for "one".
  function markerPath(end, many) {
    const { x, y, dir } = end;
    if (many) {
      const tip = x + dir * 12;
      return `M${tip},${y} L${x},${y - 6} M${tip},${y} L${x},${y} M${tip},${y} L${x},${y + 6}`;
    }
    const bar = x + dir * 9;
    return `M${bar},${y - 6} L${bar},${y + 6}`;
  }

  // The "zero" of a 0..1 end: a hollow circle just past the bar.
  function optionalPath(end) {
    const r = 3.5;
    const cx = end.x + end.dir * 17;
    return `M${cx - r},${end.y} a${r},${r} 0 1,0 ${r * 2},0 a${r},${r} 0 1,0 ${-r * 2},0`;
  }

  // Filled arrowhead pointing into the table at `end`.
  function arrowPath(end, len) {
    const { x, y, dir } = end;
    const base = x + dir * len;
    return `M${x},${y} L${base},${y - len * 0.55} L${base},${y + len * 0.55} Z`;
  }

  function bbox(boxes, pad = 0) {
    if (!boxes.length) return null;
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const b of boxes) {
      x1 = Math.min(x1, b.x);
      y1 = Math.min(y1, b.y);
      x2 = Math.max(x2, b.x + b.w);
      y2 = Math.max(y2, b.y + b.h);
    }
    return { x: x1 - pad, y: y1 - pad, w: x2 - x1 + pad * 2, h: y2 - y1 + pad * 2 };
  }

  OD.geometry = { textWidth, visibleFields, typeLabel, tableSize, noteSize, anchorY, routeRef, roundedPath, markerPath, optionalPath, arrowPath, bbox };
})((window.OD = window.OD || {}));
