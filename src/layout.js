// Automatic placement with ELK (layered). TableGroups become compound nodes so their tables stay together.
// Each group is laid out on its own (SEPARATE_CHILDREN) and the groups are then packed towards
// aspectRatio; laying out across the hierarchy produced one tall column per group.
(function (OD) {
  const elk = new window.ELK();

  // sizes: Map<key, {w, h}> for tables and notes. Resolves to Map<key, {x, y}>.
  async function autoLayout(model, sizes) {
    const L = OD.theme.layout;
    const G = OD.theme.group;
    const node = (key) => ({ id: key, width: sizes.get(key).w, height: sizes.get(key).h });

    const root = {
      id: '__root',
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': L.direction,
        'elk.hierarchyHandling': 'SEPARATE_CHILDREN',
        'elk.aspectRatio': String(L.aspectRatio),
        'elk.spacing.nodeNode': String(L.nodeSpacing),
        'elk.layered.spacing.nodeNodeBetweenLayers': String(L.layerSpacing),
        'elk.spacing.componentComponent': String(L.componentSpacing),
        'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
        'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
        'elk.padding': '[top=40,left=40,bottom=40,right=40]',
        ...L.elk,
      },
      children: [],
      edges: [],
    };

    const groupNodes = new Map();
    for (const g of model.groups) {
      const gn = {
        id: `group:${g.key}`,
        layoutOptions: {
          'elk.padding': `[top=${G.padding + G.labelHeight},left=${G.padding},bottom=${G.padding},right=${G.padding}]`,
          'elk.spacing.nodeNode': String(L.nodeSpacing * 0.75),
          'elk.layered.spacing.nodeNodeBetweenLayers': String(L.layerSpacing * 0.75),
          'elk.aspectRatio': String(L.aspectRatio),
          ...L.elkGroup,
        },
        children: [],
      };
      groupNodes.set(g.key, gn);
      root.children.push(gn);
    }
    for (const t of model.tables) {
      (t.group && groupNodes.has(t.group) ? groupNodes.get(t.group).children : root.children).push(node(t.key));
    }
    for (const n of model.notes) root.children.push(node(n.key));

    // Edges run from the referenced table to the FK table so parents land left of children.
    // ELK uses the ones inside a group; cross-group edges are ignored by SEPARATE_CHILDREN.
    const seen = new Set();
    for (const r of model.refs) {
      if (r.from.table === r.to.table) continue;
      const id = `${r.to.table}->${r.from.table}`;
      if (seen.has(id)) continue;
      seen.add(id);
      root.edges.push({ id, sources: [r.to.table], targets: [r.from.table] });
    }

    const result = await elk.layout(root);
    const positions = new Map();
    const walk = (n, ox, oy) => {
      for (const c of n.children || []) {
        const x = ox + c.x;
        const y = oy + c.y;
        if (c.id.startsWith('group:')) walk(c, x, y);
        else positions.set(c.id, { x: Math.round(x), y: Math.round(y) });
      }
    };
    walk(result, 0, 0);
    return positions;
  }

  OD.autoLayout = autoLayout;
})((window.OD = window.OD || {}));
