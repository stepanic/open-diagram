// Every visual decision of the diagram lives here. Change values, reload the page.
// The renderer reads only from this object, and SVG/PNG export embeds the same values.
(function (OD) {
  OD.theme = {
    fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    monoFamily: '"JetBrains Mono", "SF Mono", Menlo, Consolas, monospace',
    fontSize: 13,

    table: {
      headerHeight: 36,
      rowHeight: 28,
      paddingX: 12,
      iconWidth: 18, // left column for the PK / FK icon
      typeGap: 24, // minimum space between field name and type
      minWidth: 200,
      radius: 6,
      background: '#ffffff',
      border: '#d5dbe5',
      borderSelected: '#2563eb',
      shadow: 'rgba(15, 23, 42, 0.08)',
      headerDefault: '#316896',
      headerText: '#ffffff',
      fieldText: '#1f2937',
      typeText: '#8792a6',
      rowDivider: '#eef1f5',
      rowHover: '#eef4ff',
      pkIcon: '#d4a20b',
      fkIcon: '#7c8aa0',
      notNullMark: true, // draws "NN" next to the type
      noteMark: '#fbbf24', // corner fold on tables/fields with a note
    },

    ref: {
      color: '#9aa5b8',
      activeColor: '#2563eb',
      width: 1.5,
      activeWidth: 2.25,
      stub: 22, // horizontal run before the first bend
      radius: 8, // corner rounding
      marker: 'crowsfoot', // 'crowsfoot' | 'labels'
      dimOpacity: 0.18, // other refs while a table is highlighted
      inactiveDash: '2 4', // refs marked [inactive]
    },

    dep: {
      color: '#8b5cf6', // when the Dep has no color of its own
      width: 1.25,
      dash: '6 4',
      arrow: 7, // arrowhead length at the derived (downstream) end
      opacity: 0.85,
    },

    focus: {
      // What the editor cursor points at: everything else fades to dimOpacity.
      color: '#f59e0b',
      rowFill: '#fef3c7',
      dimOpacity: 0.25,
    },

    group: {
      padding: 22,
      labelHeight: 34,
      radius: 10,
      fillOpacity: 0.07,
      strokeOpacity: 0.5,
      defaultColor: '#64748b',
      labelSize: 14,
    },

    note: {
      width: 260,
      padding: 12,
      lineHeight: 18,
      background: '#fff8c5',
      border: '#e9d66b',
      text: '#5b4a00',
    },

    canvas: {
      background: '#f6f8fb',
      gridDot: '#d9dfe8',
      gridSize: 20,
    },

    layout: {
      direction: 'RIGHT', // ELK: RIGHT | DOWN | LEFT | UP
      nodeSpacing: 48,
      layerSpacing: 110,
      componentSpacing: 80,
      aspectRatio: 1.6, // target width/height when packing groups and unconnected tables
      elk: {}, // extra ELK options for the whole diagram (https://eclipse.dev/elk/reference/options.html)
      elkGroup: {}, // extra ELK options inside each TableGroup
    },
  };
})((window.OD = window.OD || {}));
