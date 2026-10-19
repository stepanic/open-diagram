// Schema checks the DBML parser does not make, and ref suggestions from column names.
// Both read the plain model; nothing here changes the source.
(function (OD) {
  // Type families that hold the same values, so a ref between them is not a mismatch.
  const FAMILIES = [
    ['smallint', 'int2', 'smallserial', 'serial2'],
    ['int', 'integer', 'int4', 'serial', 'serial4', 'mediumint'],
    ['bigint', 'int8', 'bigserial', 'serial8'],
    ['varchar', 'character varying', 'text', 'string', 'nvarchar', 'char', 'character', 'nchar', 'citext'],
    ['bool', 'boolean'],
    ['numeric', 'decimal'],
    ['real', 'float4'],
    ['double precision', 'float8', 'double', 'float'],
    ['timestamp', 'timestamp without time zone', 'datetime'],
    ['timestamptz', 'timestamp with time zone'],
  ];
  const familyOf = new Map(FAMILIES.flatMap((names) => names.map((n) => [n, names[0]])));

  // Base type without length or precision, lower case, folded into its family.
  function baseType(field) {
    if (field.enumKey) return `enum:${field.enumKey}`;
    const t = String(field.type || '').toLowerCase().replace(/\(.*\)/, '').replace(/\[\]$/, '[]').trim();
    return familyOf.get(t) || t;
  }

  const fieldList = (t, names) => (names.length === 1 ? `${t}.${names[0]}` : `${t}.(${names.join(', ')})`);

  // [{ level: 'warning' | 'info', message, line }] sorted by line.
  function lint(model) {
    const out = [];
    const add = (level, message, line) => out.push({ level, message, line: line || null });

    const indexNames = new Map();
    for (const t of model.tables) {
      if (!t.fields.some((f) => f.pk)) add('warning', `${t.name} has no primary key`, t.line);

      const seen = new Map();
      for (const idx of t.indexes) {
        const cols = idx.columns.join(', ');
        if (seen.has(cols)) add('warning', `${t.name}: index (${cols}) duplicates the one on line ${seen.get(cols)}`, idx.line);
        else seen.set(cols, idx.line);
        if (idx.name) {
          const schema = t.key.includes('.') ? t.key.split('.')[0] : '';
          const k = `${schema}\u0000${idx.name}`;
          if (indexNames.has(k)) add('warning', `index name "${idx.name}" is already used in ${indexNames.get(k)}`, idx.line);
          else indexNames.set(k, t.name);
        }
      }

      for (const f of t.fields) {
        if (f.notNull && f.default === 'null' && f.defaultType !== 'string') add('warning', `${t.name}.${f.name} is not null but defaults to null`, f.line);
      }
    }

    for (const r of model.refs) {
      const from = model.tableByKey.get(r.from.table);
      const to = model.tableByKey.get(r.to.table);
      r.from.fields.forEach((name, i) => {
        const a = from.fieldByName.get(name);
        const b = to.fieldByName.get(r.to.fields[i]);
        if (!a || !b) return;
        if (baseType(a) !== baseType(b)) {
          add('warning', `ref ${r.from.table}.${a.name} (${a.type}) → ${r.to.table}.${b.name} (${b.type}): types differ`, r.line);
        }
      });
      const fkFields = r.from.fields.map((n) => from.fieldByName.get(n)).filter(Boolean);
      if ((r.onDelete || '').toLowerCase() === 'set null' && fkFields.some((f) => f.notNull)) {
        add('warning', `ref ${fieldList(r.from.table, r.from.fields)}: delete: set null on a not null column`, r.line);
      }
      if ((r.onUpdate || '').toLowerCase() === 'set null' && fkFields.some((f) => f.notNull)) {
        add('warning', `ref ${fieldList(r.from.table, r.from.fields)}: update: set null on a not null column`, r.line);
      }
      if (!r.from.many && !r.to.many && !isUniqueOn(from, r.from.fields)) {
        add('info', `one-to-one ref on ${fieldList(r.from.table, r.from.fields)}, which is not unique`, r.line);
      }
    }

    // Foreign keys without an index that starts with them (Postgres does not add one).
    const indexed = new Set();
    for (const r of model.refs) {
      const t = model.tableByKey.get(r.from.table);
      const k = `${t.key}\u0000${r.from.fields.join(',')}`;
      if (indexed.has(k)) continue;
      indexed.add(k);
      if (!isLeadingIndex(t, r.from.fields)) add('info', `foreign key ${fieldList(t.name, r.from.fields)} has no index`, r.line);
    }

    const used = new Set(model.tables.flatMap((t) => t.fields.map((f) => f.enumKey).filter(Boolean)));
    for (const s of model.sources) {
      if (s.kind === 'enum' && !used.has(s.key)) add('info', `enum ${s.key} is not used by any field`, s.start);
    }

    const rank = { warning: 0, info: 1 };
    return out.sort((a, b) => rank[a.level] - rank[b.level] || (a.line || 0) - (b.line || 0));
  }

  function isUniqueOn(table, names) {
    if (names.length === 1) {
      const f = table.fieldByName.get(names[0]);
      if (f && (f.unique || (f.pk && table.fields.filter((x) => x.pk).length === 1))) return true;
    }
    const want = [...names].sort().join(',');
    return table.indexes.some((i) => (i.unique || i.pk) && [...i.columns].sort().join(',') === want);
  }

  // A primary key, unique field or index whose leading columns are exactly `names`.
  function isLeadingIndex(table, names) {
    if (names.length === 1 && table.fieldByName.get(names[0])?.unique) return true;
    const pk = table.fields.filter((f) => f.pk).map((f) => f.name);
    const candidates = [...table.indexes.map((i) => i.columns), pk];
    return candidates.some((cols) => names.length <= cols.length && names.every((n, i) => cols[i] === n));
  }

  // Simple English singular: categories → category, addresses → address, users → user.
  function singular(name) {
    if (/ies$/.test(name)) return name.slice(0, -3) + 'y';
    if (/(s|x|z|ch|sh)es$/.test(name)) return name.slice(0, -2);
    if (/s$/.test(name) && !/ss$/.test(name)) return name.slice(0, -1);
    return name;
  }

  const ident = (part) => (/^[A-Za-z_]\w*$/.test(part) ? part : `"${part.replace(/"/g, '\\"')}"`);
  const qualified = (key, field) => `${key.split('.').map(ident).join('.')}.${ident(field)}`;

  // Refs the column names suggest but the DBML does not declare: `user_id` → `users.id`.
  // Returns [{ from: {table, field}, to: {table, field}, many, dbml }].
  function suggestRefs(model) {
    const linked = new Set();
    for (const r of model.refs) {
      for (const side of [r.from, r.to]) side.fields.forEach((n) => linked.add(`${side.table}\u0000${n}`));
    }
    // A bare key name (`code` → `countries.code`) only counts when one table has it as its key.
    const keyNames = new Map();
    for (const t of model.tables) {
      const pks = t.fields.filter((f) => f.pk);
      if (pks.length === 1) keyNames.set(pks[0].name.toLowerCase(), (keyNames.get(pks[0].name.toLowerCase()) || 0) + 1);
    }
    const out = [];
    for (const parent of model.tables) {
      const pks = parent.fields.filter((f) => f.pk);
      if (pks.length !== 1) continue;
      const pk = pks[0];
      const plain = parent.key.split('.').pop().toLowerCase();
      const one = singular(plain);
      const id = pk.name.toLowerCase();
      const names = new Set([`${one}_${id}`, `${plain}_${id}`, `${one}${id}`]);
      if (id !== 'id' && keyNames.get(id) === 1) names.add(id);
      for (const child of model.tables) {
        if (child === parent) continue;
        for (const f of child.fields) {
          if (!names.has(f.name.toLowerCase()) || (f.pk && child.fields.filter((x) => x.pk).length === 1)) continue;
          if (linked.has(`${child.key}\u0000${f.name}`) || baseType(f) !== baseType(pk)) continue;
          const many = !f.unique;
          out.push({
            from: { table: child.key, field: f.name },
            to: { table: parent.key, field: pk.name },
            many,
            dbml: `Ref: ${qualified(child.key, f.name)} ${many ? '>' : '-'} ${qualified(parent.key, pk.name)}`,
          });
        }
      }
    }
    return out;
  }

  OD.lint = lint;
  OD.suggestRefs = suggestRefs;
  OD.baseType = baseType;
})((window.OD = window.OD || {}));
