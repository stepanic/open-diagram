// DBML source → plain diagram model. Nothing here knows about SVG.
(function (OD) {
  const DEFAULT_SCHEMA = 'public';

  const qualify = (schemaName, name) => (schemaName && schemaName !== DEFAULT_SCHEMA ? `${schemaName}.${name}` : name);

  // Relation of one endpoint as seen from that endpoint: '1', '0..1' (from >? and the like) or '*'.
  const isMany = (relation) => relation === '*';

  // Custom properties (`[owner: 'x']`, Metadata blocks) as [key, value] pairs, or null.
  const props = (metadata) => (metadata && Object.keys(metadata).length ? Object.entries(metadata) : null);

  // Source line range [start, end] of a parsed element (1-based, inclusive), or null.
  const span = (o) => (o && o.token ? [o.token.start.line, o.token.end.line] : null);

  const checksOf = (checks) => (checks || []).map((c) => ({ name: c.name || null, expression: c.expression }));

  function buildModel(source) {
    const db = window.dbmlCore.Parser.parse(source, 'dbmlv2');

    const enums = new Map();
    const tables = [];
    const tableByKey = new Map();
    const refs = [];
    const deps = [];
    const groups = [];
    // Which diagram element each stretch of source describes; see elementAtLine().
    const sources = [];
    const locate = (o, target) => {
      const r = span(o);
      if (r) sources.push({ start: r[0], end: r[1], ...target });
    };

    for (const schema of db.schemas) {
      for (const e of schema.enums) {
        enums.set(qualify(schema.name, e.name), e.values.map((v) => ({ name: v.name, note: v.note || null })));
        locate(e, { kind: 'enum', key: qualify(schema.name, e.name) });
      }
    }
    for (const p of db.tablePartials || []) {
      locate(p, { kind: 'partial', name: p.name });
      for (const f of p.fields || []) locate(f, { kind: 'partial', name: p.name, field: f.name });
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
          defaultType: f.dbdefault ? f.dbdefault.type : null,
          note: f.note || null,
          checks: checksOf(f.checks),
          props: props(f.metadata),
          partial: f.injectedPartial ? f.injectedPartial.name : null,
          line: f.token ? f.token.start.line : null,
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
            line: idx.token ? idx.token.start.line : null,
          })),
          checks: checksOf(t.checks),
          props: props(t.metadata),
          records: [],
          group: null,
        };
        tables.push(table);
        tableByKey.set(key, table);
        locate(t, { kind: 'table', key });
        // Fields from a partial point at the partial's lines, which the partial entry covers.
        t.fields.forEach((f) => !f.injectedPartial && locate(f, { kind: 'field', key, field: f.name }));
        t.indexes.forEach((idx) => locate(idx, { kind: 'table', key }));
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
        locate(r, { kind: 'ref', id: `ref${refs.length}` });
        refs.push({
          id: `ref${refs.length}`,
          name: r.name || null,
          from: fkSide,
          to: pkSide,
          onDelete: r.onDelete || null,
          onUpdate: r.onUpdate || null,
          color: r.color || null,
          inactive: !!r.inactive,
          line: r.token ? r.token.start.line : null,
        });
      }

      // Data lineage: one entry per edge, upstream (source) → downstream (derived).
      for (const d of schema.deps || []) {
        const ids = [];
        for (const e of d.edges) {
          const from = { table: qualify(e.upstream.schemaName, e.upstream.tableName), fields: e.upstream.fieldNames || [] };
          const to = { table: qualify(e.downstream.schemaName, e.downstream.tableName), fields: e.downstream.fieldNames || [] };
          if (!tableByKey.has(from.table) || !tableByKey.has(to.table)) continue;
          ids.push(`dep${deps.length}`);
          locate(e, { kind: 'dep', ids: [`dep${deps.length}`] });
          deps.push({
            id: `dep${deps.length}`,
            name: d.name || null,
            from,
            to,
            color: d.color || null,
            note: d.note || null,
            props: props(d.metadata),
            line: e.token ? e.token.start.line : null,
          });
        }
        locate(d, { kind: 'dep', ids });
      }

      for (const g of schema.tableGroups) {
        const group = {
          key: qualify(schema.name, g.name),
          name: g.name,
          color: g.color || null,
          note: g.note || null,
          props: props(g.metadata),
          line: g.token ? g.token.start.line : null,
          tables: g.tables.map((t) => qualify(t.schema.name, t.name)),
        };
        group.tables.forEach((k) => tableByKey.has(k) && (tableByKey.get(k).group = group.key));
        groups.push(group);
        locate(g, { kind: 'group', key: group.key });
      }
    }

    db.notes.forEach((n) => locate(n, { kind: 'note', key: `note:${n.name}` }));
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
      if (t) locate(r, { kind: 'table', key: t.key });
    }
    (db.diagramViews || []).forEach((v) => locate(v, { kind: 'view', name: v.name }));
    locate(db, { kind: 'project' });

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
      sources,
    };
  }

  // The innermost element whose source contains `line`; on equal ranges the later entry wins,
  // so a field line with an inline ref resolves to the ref only when the ref spans less.
  function elementAtLine(model, line) {
    let best = null;
    for (const s of model.sources) {
      if (line < s.start || line > s.end) continue;
      if (!best || s.end - s.start < best.end - best.start || (s.end - s.start === best.end - best.start && s.kind === 'field')) best = s;
    }
    return best;
  }

  // Everything on the diagram one source element stands for: the tables, fields, refs, deps,
  // groups and notes to light up.
  function focusFor(model, el) {
    const f = { tables: new Set(), fields: new Map(), refs: new Set(), deps: new Set(), groups: new Set(), notes: new Set() };
    if (!el) return f;
    const addField = (key, name) => {
      f.tables.add(key);
      if (!f.fields.has(key)) f.fields.set(key, new Set());
      f.fields.get(key).add(name);
      for (const r of model.refs) {
        if ((r.from.table === key && r.from.fields.includes(name)) || (r.to.table === key && r.to.fields.includes(name))) addRef(r);
      }
      for (const d of model.deps) {
        if ((d.from.table === key && d.from.fields.includes(name)) || (d.to.table === key && d.to.fields.includes(name))) addDep(d);
      }
    };
    const addRef = (r) => {
      f.refs.add(r.id);
      f.tables.add(r.from.table).add(r.to.table);
    };
    const addDep = (d) => {
      f.deps.add(d.id);
      f.tables.add(d.from.table).add(d.to.table);
    };
    switch (el.kind) {
      case 'table':
        f.tables.add(el.key);
        break;
      case 'field':
        addField(el.key, el.field);
        break;
      case 'ref':
        model.refs.filter((r) => r.id === el.id).forEach((r) => {
          addRef(r);
          r.from.fields.forEach((n) => f.fields.has(r.from.table) ? f.fields.get(r.from.table).add(n) : f.fields.set(r.from.table, new Set([n])));
          r.to.fields.forEach((n) => f.fields.has(r.to.table) ? f.fields.get(r.to.table).add(n) : f.fields.set(r.to.table, new Set([n])));
        });
        break;
      case 'dep':
        model.deps.filter((d) => el.ids.includes(d.id)).forEach(addDep);
        break;
      case 'group': {
        const g = model.groups.find((x) => x.key === el.key);
        if (g) {
          f.groups.add(g.key);
          g.tables.forEach((k) => f.tables.add(k));
        }
        break;
      }
      case 'enum':
        for (const t of model.tables) for (const fld of t.fields) if (fld.enumKey === el.key) addField(t.key, fld.name);
        break;
      case 'partial':
        for (const t of model.tables) for (const fld of t.fields) if (fld.partial === el.name && (!el.field || fld.name === el.field)) addField(t.key, fld.name);
        break;
      case 'note':
        f.notes.add(el.key);
        break;
      case 'view': {
        const v = applyView(model, el.name);
        v.tables.forEach((t) => f.tables.add(t.key));
        v.notes.forEach((n) => f.notes.add(n.key));
        break;
      }
      default:
    }
    // Only what is on the current diagram (a DiagramView may hide the rest).
    for (const k of [...f.tables]) if (!model.tableByKey.has(k)) f.tables.delete(k);
    return f;
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
  OD.elementAtLine = elementAtLine;
  OD.focusFor = focusFor;
  OD.formatErrors = formatErrors;
})((window.OD = window.OD || {}));
