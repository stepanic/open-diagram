// DBML source → plain diagram model. Nothing here knows about SVG.
(function (OD) {
  const DEFAULT_SCHEMA = 'public';

  const qualify = (schemaName, name) => (schemaName && schemaName !== DEFAULT_SCHEMA ? `${schemaName}.${name}` : name);

  // Relation of one endpoint as seen from that endpoint: '1' or '*'.
  const isMany = (relation) => relation === '*';

  function buildModel(source) {
    const db = window.dbmlCore.Parser.parse(source, 'dbmlv2');

    const enums = new Map();
    const tables = [];
    const tableByKey = new Map();
    const refs = [];
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
          })),
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
        });
      }

      for (const g of schema.tableGroups) {
        const group = {
          key: qualify(schema.name, g.name),
          name: g.name,
          color: g.color || null,
          note: g.note || null,
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

    return {
      project: { name: db.name || null, note: db.note || null, databaseType: db.databaseType || null },
      tables,
      tableByKey,
      refs,
      groups,
      notes,
      enums,
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
  OD.formatErrors = formatErrors;
})((window.OD = window.OD || {}));
