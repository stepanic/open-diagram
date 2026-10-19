// Text exports of the model: Mermaid erDiagram and Markdown documentation.
(function (OD) {
  // Mermaid entity and attribute names allow letters, digits, `_` and `-`.
  const mermaidId = (s) => String(s).replace(/[^\w-]/g, '_').replace(/^(\d)/, '_$1');
  // Types also allow parentheses and brackets: varchar(255), int[].
  const mermaidType = (s) => String(s || 'unknown').replace(/\s+/g, '_').replace(/,/g, '_').replace(/[^\w()[\]-]/g, '_');
  const mermaidText = (s) => String(s).replace(/"/g, "'").replace(/\s+/g, ' ').trim();

  // Relationship markers seen from each side: the FK side first, the referenced side second.
  function mermaidLink(r, model) {
    const from = model.tableByKey.get(r.from.table);
    const nullable = r.from.fields.some((n) => !from.fieldByName.get(n)?.notNull && !from.fieldByName.get(n)?.pk);
    const toMark = r.to.many ? 'o{' : r.to.optional || nullable ? 'o|' : '||';
    const fromMark = r.from.many ? '}o' : '|o';
    return `${fromMark}--${toMark}`;
  }

  function toMermaid(model) {
    const ids = new Map();
    const used = new Set();
    for (const t of model.tables) {
      let id = mermaidId(t.key);
      while (used.has(id)) id += '_';
      used.add(id);
      ids.set(t.key, id);
    }
    const lines = ['erDiagram'];
    for (const t of model.tables) {
      const id = ids.get(t.key);
      lines.push(`  ${id}${id !== t.key ? `["${mermaidText(t.key)}"]` : ''} {`);
      for (const f of t.fields) {
        const keys = [f.pk && 'PK', f.fk && 'FK', f.unique && !f.pk && 'UK'].filter(Boolean).join(', ');
        const note = f.note ? ` "${mermaidText(f.note).slice(0, 120)}"` : '';
        lines.push(`    ${mermaidType(f.type)} ${mermaidId(f.name)}${keys ? ` ${keys}` : ''}${note}`);
      }
      lines.push('  }');
    }
    for (const r of model.refs) {
      const label = r.name || r.from.fields.join(', ');
      lines.push(`  ${ids.get(r.from.table)} ${mermaidLink(r, model)} ${ids.get(r.to.table)} : "${mermaidText(label)}"`);
    }
    return `${lines.join('\n')}\n`;
  }

  // ---- Markdown ------------------------------------------------------------------------

  const cell = (s) => (s === null || s === undefined || s === '' ? '' : String(s).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>'));
  const code = (s) => (s === null || s === undefined || s === '' ? '' : `\`${String(s).replace(/`/g, "'")}\``);
  // GitHub's heading anchors: lower case, punctuation dropped, spaces to dashes.
  const anchor = (s) => `#${String(s).toLowerCase().replace(/[^\w\- ]/g, '').replace(/ /g, '-')}`;
  const tableLink = (key) => `[${key}](${anchor(key)})`;

  function table(head, rows) {
    if (!rows.length) return [];
    return [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`), ''];
  }

  function toMarkdown(model, title) {
    const out = [];
    const p = model.project;
    out.push(`# ${p.name || title}`, '');
    if (model.view) out.push(`DiagramView: **${model.view}**`, '');
    if (p.databaseType) out.push(`Database: ${p.databaseType}`, '');
    if (p.note) out.push(p.note.trim(), '');

    out.push('## Diagram', '', '```mermaid', toMermaid(model).trimEnd(), '```', '');

    out.push('## Tables', '');
    const grouped = new Set();
    for (const g of model.groups) {
      out.push(`- **${g.name}**${g.note ? `: ${g.note.split('\n')[0]}` : ''}`);
      for (const k of g.tables) {
        out.push(`  - ${tableLink(k)}`);
        grouped.add(k);
      }
    }
    for (const t of model.tables) if (!grouped.has(t.key)) out.push(`- ${tableLink(t.key)}`);
    out.push('');

    for (const t of model.tables) {
      out.push(`### ${t.key}`, '');
      const meta = [t.alias && `alias ${code(t.alias)}`, t.group && `group ${t.group}`, ...(t.props || []).map(([k, v]) => `${k}: ${code(v)}`)].filter(Boolean);
      if (meta.length) out.push(meta.join(' · '), '');
      if (t.note) out.push(t.note.trim(), '');

      const refsOf = (f) => model.refs.filter((r) => r.from.table === t.key && r.from.fields.includes(f.name));
      out.push(...table(['Field', 'Type', 'Key', 'Null', 'Default', 'Note'], t.fields.map((f) => [
        code(f.name),
        code(f.type),
        [f.pk && 'PK', f.unique && !f.pk && 'unique', f.increment && 'increment', ...refsOf(f).map((r) => `FK → ${tableLink(r.to.table)}.${r.to.fields[r.from.fields.indexOf(f.name)]}`)].filter(Boolean).join(', '),
        f.notNull || f.pk ? 'not null' : '',
        code(f.default),
        [f.note, f.enumKey && `enum ${f.enumKey}`, f.partial && `from ${f.partial}`].filter(Boolean).join(' · '),
      ])));

      out.push(...table(['Index', 'Columns', 'Kind', 'Note'], t.indexes.map((i) => [
        i.name ? code(i.name) : '',
        i.columns.map(code).join(', '),
        [i.pk && 'PK', i.unique && 'unique', i.type].filter(Boolean).join(', '),
        i.note,
      ])));

      const checks = t.checks.concat(t.fields.flatMap((f) => f.checks.map((c) => ({ ...c, field: f.name }))));
      if (checks.length) {
        out.push('Checks:', '', ...checks.map((c) => `- ${c.field ? `${code(c.field)}: ` : ''}${code(c.expression)}${c.name ? ` (${c.name})` : ''}`), '');
      }

      const incoming = model.refs.filter((r) => r.to.table === t.key);
      if (incoming.length) {
        out.push('Referenced by:', '', ...incoming.map((r) => `- ${tableLink(r.from.table)}.${r.from.fields.join(', ')}${r.onDelete ? ` (delete: ${r.onDelete})` : ''}`), '');
      }
    }

    const enumKeys = [...new Set(model.tables.flatMap((t) => t.fields.map((f) => f.enumKey).filter(Boolean)))];
    const allEnums = model.view ? enumKeys : [...model.enums.keys()];
    if (allEnums.length) {
      out.push('## Enums', '');
      for (const k of allEnums) {
        out.push(`### ${k}`, '', ...table(['Value', 'Note'], model.enums.get(k).map((v) => [code(v.name), v.note])));
      }
    }

    if (model.notes.length) {
      out.push('## Notes', '');
      for (const n of model.notes) out.push(`### ${n.name}`, '', n.content.trim(), '');
    }
    return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
  }

  OD.toMermaid = toMermaid;
  OD.toMarkdown = toMarkdown;
})((window.OD = window.OD || {}));
