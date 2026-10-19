// DBML source → plain diagram model. Nothing here knows about SVG.
(function (OD) {
  const DEFAULT_SCHEMA = 'public';

  const qualify = (schemaName, name) => (schemaName && schemaName !== DEFAULT_SCHEMA ? `${schemaName}.${name}` : name);

  // Relation of one endpoint as seen from that endpoint: '1', '0..1' (from >? and the like) or '*'.
  const isMany = (relation) => relation === '*';

  // Custom properties (`[owner: 'x']`, Metadata blocks) as [key, value] pairs, or null.
  const props = (metadata) => (metadata && Object.keys(metadata).length ? Object.entries(metadata) : null);

  const checksOf = (checks) => (checks || []).map((c) => ({ name: c.name || null, expression: c.expression }));

  function buildModel(source) {
    const db = window.dbmlCore.Parser.parse(source, 'dbmlv2');

    const enums = new Map();
    const tables = [];
    const tableByKey = new Map();
    const refs = [];
    const deps = [];
    const groups = [];

    for (const schema of db.schemas) {
      for (const e of schema.enums) {
        enums.set(qualify(schema.name, e.name), e.values.map((v) => ({ name: v.name, note: v.note || null })));
      }
    }

    for (const schema of db.schemas) {
      for (const t of schema.tables) {
        const key = qualify(schema.name, t.name);
        const fields = t.fields.map((f) => ({
          name: f.name,
          type: f.type.type_name,
          enumKey: enums.has(qualify(f.type.schemaName, f.type.type_name)) ? qualify(f.type.schemaName, f.type.type_name) : null,
          pk: !!f.pk,
          unique: !!f.unique,
          notNull: !!f.not_null,
          increment: !!f.increment,
          default: f.dbdefault ? f.dbdefault.value : null,
          note: f.note || null,
          checks: checksOf(f.checks),
          props: props(f.metadata),
          partial: f.injectedPartial ? f.injectedPartial.name : null,
          fk: false,
          referenced: false,
        }));
        const fieldByName = new Map(fields.map((f) => [f.name, f]));

        // Composite primary keys and single-column unique indexes mark their fields too.
        for (const idx of t.indexes) {
          const cols = idx.columns.filter((c) => c.type === 'column').map((c) => fieldByName.get(c.value)).filter(Boolean);
          if (idx.pk) cols.forEach((f) => (f.pk = true));
          if (idx.unique && cols.length === 1) cols[0].unique = true;
        }

        const table = {
          key,
          name: key,
          alias: t.alias || null,
          note: t.note || null,
          headerColor: t.headerColor || null,
          line: t.token ? t.token.start.line : null,
          fields,
          fieldByName,
          indexes: t.indexes.map((idx) => ({
            columns: idx.columns.map((c) => c.value),
            pk: !!idx.pk,
            unique: !!idx.unique,
            name: idx.name || null,
            type: idx.type || null,
            note: idx.note || null,
          })),
          checks: checksOf(t.checks),
          props: props(t.metadata),
          records: [],
          group: null,
        };
        tables.push(table);
        tableByKey.set(key, table);
      }
    }

    for (const schema of db.schemas) {
      for (const r of schema.refs) {
        const [a, b] = r.endpoints.map((ep) => ({
          table: qualify(ep.schemaName, ep.tableName),
          fields: ep.fieldNames,
          many: isMany(ep.relation),
          optional: ep.relation === '0..1',
        }));
        if (!tableByKey.has(a.table) || !tableByKey.has(b.table)) continue;
        // The foreign key sits on the "many" side; for 1–1 refs DBML lists the owning side second.
        const fkSide = a.many && !b.many ? a : b.many && !a.many ? b : b;
        const pkSide = fkSide === a ? b : a;
        for (const name of fkSide.fields) {
          const f = tableByKey.get(fkSide.table).fieldByName.get(name);
          if (f) f.fk = true;
        }
        for (const name of pkSide.fields) {
          const f = tableByKey.get(pkSide.table).fieldByName.get(name);
          if (f) f.referenced = true;
        }
        refs.push({
          id: `ref${refs.length}`,
          name: r.name || null,
          from: fkSide,
          to: pkSide,
          onDelete: r.onDelete || null,
          onUpdate: r.onUpdate || null,
          color: r.color || null,
          inactive: !!r.inactive,
        });
      }

      // Data lineage: one entry per edge, upstream (source) → downstream (derived).
      for (const d of schema.deps || []) {
        for (const e of d.edges) {
          const from = { table: qualify(e.upstream.schemaName, e.upstream.tableName), fields: e.upstream.fieldNames || [] };
          const to = { table: qualify(e.downstream.schemaName, e.downstream.tableName), fields: e.downstream.fieldNames || [] };
          if (!tableByKey.has(from.table) || !tableByKey.has(to.table)) continue;
          deps.push({
            id: `dep${deps.length}`,
            name: d.name || null,
            from,
            to,
            color: d.color || null,
            note: d.note || null,
            props: props(d.metadata),
          });
        }
      }

      for (const g of schema.tableGroups) {
        const group = {
          key: qualify(schema.name, g.name),
          name: g.name,
          color: g.color || null,
          note: g.note || null,
          props: props(g.metadata),
          tables: g.tables.map((t) => qualify(t.schema.name, t.name)),
        };
        group.tables.forEach((k) => tableByKey.has(k) && (tableByKey.get(k).group = group.key));
        groups.push(group);
      }
    }

    const notes = db.notes.map((n) => ({
      key: `note:${n.name}`,
      name: n.name,
      content: n.content || '',
      color: n.color || null,
      line: n.token ? n.token.start.line : null,
    }));

    for (const r of db.records || []) {
      const t = tableByKey.get(qualify(r.schemaName, r.tableName));
      if (t) t.records.push({ columns: r.columns, rows: r.values.map((row) => row.map((v) => v.value)) });
    }

    const views = (db.diagramViews || []).map((v) => ({ name: v.name, entities: v.visibleEntities }));

    return {
      project: { name: db.name || null, note: db.note || null, databaseType: db.databaseType || null },
      tables,
      tableByKey,
      refs,
      deps,
      groups,
      notes,
      enums,
      views,
    };
  }

  // The part of a model one DiagramView shows. The parser gives every category as null (not
  // listed), [] (`{ * }`) or a list of names; when several table categories come back empty
  // they all read `*`, so an all-empty table side means every table.
  function applyView(model, viewName) {
    const view = model.views.find((v) => v.name === viewName);
    if (!view) return model;
    const e = view.entities;
    const tableSide = [e.tables, e.tableGroups, e.schemas];
    let keep;
    if (tableSide.every((x) => x === null)) keep = new Set();
    else if (tableSide.every((x) => !x || !x.length)) keep = new Set(model.tables.map((t) => t.key));
    else {
      keep = new Set((e.tables || []).map((t) => qualify(t.schemaName, t.name)));
      for (const g of e.tableGroups || []) {
        const grp = model.groups.find((x) => x.name === g.name);
        if (grp) grp.tables.forEach((k) => keep.add(k));
      }
      const schemas = new Set((e.schemas || []).map((s) => s.name));
      for (const t of model.tables) if (schemas.has(t.key.includes('.') ? t.key.split('.')[0] : DEFAULT_SCHEMA)) keep.add(t.key);
    }
    const noteNames = e.stickyNotes === null ? new Set() : e.stickyNotes.length ? new Set(e.stickyNotes.map((n) => n.name)) : null;
    const tables = model.tables.filter((t) => keep.has(t.key));
    const both = (x) => keep.has(x.from.table) && keep.has(x.to.table);
    return {
      ...model,
      tables,
      tableByKey: new Map(tables.map((t) => [t.key, t])),
      refs: model.refs.filter(both),
      deps: model.deps.filter(both),
      groups: model.groups.map((g) => ({ ...g, tables: g.tables.filter((k) => keep.has(k)) })).filter((g) => g.tables.length),
      notes: model.notes.filter((n) => !noteNames || noteNames.has(n.name)),
      view: view.name,
    };
  }

  // Parser errors come as { diags: [{ message, location: { start: { line, column } } }] }.
  function formatErrors(err) {
    const diags = err && Array.isArray(err.diags) ? err.diags : [{ message: String((err && err.message) || err) }];
    return diags.map((d) => ({
      message: d.message,
      line: d.location ? d.location.start.line : null,
      column: d.location ? d.location.start.column : null,
    }));
  }

  OD.buildModel = buildModel;
  OD.applyView = applyView;
  OD.formatErrors = formatErrors;
})((window.OD = window.OD || {}));
