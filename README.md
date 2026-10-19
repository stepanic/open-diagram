# Open Diagram

Offline DBML diagram renderer in a single `index.html`: no server, no network, no build step to use it.
It reads the same DBML as [dbdiagram.io](https://dbdiagram.io) (parsed by `@dbml/core` 10.x), for
anyone who keeps a database schema as text and wants to see it, lay it out and export it locally.

**[Try it](https://stepanic.github.io/open-diagram/)**, or open `index.html` from a clone.

![Open Diagram showing a DiagramView of a ledger schema, with the editor on the left](docs/screenshot.png)

## Why

dbdiagram.io is proprietary and online only; its open part is the DBML parser. drawDB imports DBML
through `@dbml/core` 3.x, which does not read current DBML (TablePartial, DiagramView, Dep, records).
Open Diagram uses the current parser and draws everything with its own SVG renderer.

## Use

Open `index.html` directly (`file://` works).

- **Open / Save**: load a `.dbml` (or a `.layout.json`), download the DBML. Drag and drop works too.
- **URL ▾**: open a `.dbml` from a link and copy a link to share it. GitHub, Gist and GitLab file
  links work as they are (they are read from the raw file); other servers have to allow
  cross-origin requests. The same works in the address bar:
  `https://stepanic.github.io/open-diagram/?url=https://github.com/owner/repo/blob/main/schema.dbml`,
  optionally with `&view=<DiagramView>` and `&layout=<url of a .layout.json>`. Without `layout`, a
  `.layout.json` next to the `.dbml` is used if there is one and this browser has not arranged the
  file itself. Editing the text drops `?url=` from the address, so a reload keeps the edit.
  Text that did not come from a URL (edited, or opened from disk) is shared as
  `…/open-diagram/#dbml=…&layout=…`: the schema and the positions, deflated into the hash, which
  never reaches the server. Large schemas make long links (open-ledger: ~17 KB).
  **Share embed** copies an `<iframe>` or an `<open-diagram>` snippet of the current diagram
  (see [Embed](#embed)).
- **Drag** a table by any part of it; drag a TableGroup by its title to move the whole group.
- **Scroll** pans, **pinch** or **⌘/Ctrl + scroll** zooms, **F** fits, **Esc** clears the selection.
- **Click** a table to highlight its refs, **double-click** to jump to it in the editor.
- **Follow** (or **Z**): the canvas zooms to the element under the editor caret, between 50 % and
  125 %; a field fits its table, a ref both tables. Moving within the same table only pans if the
  row leaves the screen. A manual pan or zoom pauses it until the caret reaches another element.
- **Hover** a field, header, ref or group title for notes, flags, defaults, enum values and refs.
- **Problems** under the editor: checks the parser does not make (no primary key, duplicate index or
  index name, `not null` with `default: null`, refs between different types, `set null` on a
  `not null` column, one-to-one refs on non-unique columns, foreign keys without an index, unused
  enums) and refs that column names suggest (`user_id` → `users.id`). Click one to jump to its line;
  **Add N refs** appends the suggested `Ref:` lines at the end of the source for review (⌘Z undoes).
- **Export ▾**: Mermaid `erDiagram` (`.mmd`, plus a fenced block on the clipboard), Markdown
  documentation (project note, Mermaid diagram, every table with fields, indexes and refs, enums),
  and SQL for PostgreSQL, MySQL, SQL Server or Oracle. Mermaid and Markdown follow the current
  DiagramView; SQL is always the whole model.
- **Detail**: all fields, keys only (PK/FK/referenced), or names only.
- **Auto layout** discards manual positions and offers four algorithms (keys **1–4** while the menu
  is open): **Left-right** (follows foreign keys), **Pipeline** (groups as stages left to right,
  tables stacked), **Snowflake** (most connected in the centre), **Compact** (rectangle packing).
  The last one used is remembered. Positions are remembered per file name in
  localStorage; **Layout** downloads them as JSON so they can travel with the `.dbml`.

## Embed

A read-only diagram in another page: pan, zoom, tooltips, click to highlight, no editor.
Try [examples/embed.html](https://stepanic.github.io/open-diagram/examples/embed.html). The
quickest way is **URL ▾ → Share embed** in the app, which copies either form below with the current
positions, view and detail level.

One script, then as many diagrams as the page needs:

```html
<script src="https://stepanic.github.io/open-diagram/dist/open-diagram-embed.js"></script>

<open-diagram src="https://github.com/you/repo/blob/main/schema.dbml" height="480px"></open-diagram>
<open-diagram focus="posts.author_id">Table posts { … }</open-diagram>
```

Attributes: `src` (or the DBML as the element's text), `layout` (a `.layout.json` URL saved by the
app, or that JSON inline), `algorithm` (`compact` by default; `left-right` and `pipeline` load ELK
on demand), `detail`, `view`, `height`, `focus` (`table` or `table.field`). Fenced
```` ```dbml ```` blocks and `<pre class="dbml">` on the page become diagrams too. The wheel scrolls
the page; ⌘/Ctrl + scroll or pinch zooms.

Where a page cannot run scripts (Notion, many CMSs), an iframe of `embed.html` does the same over
the whole frame. Everything is in the hash: `#dbml=<deflated text>` or `#src=<URL of a .dbml>`,
plus `&layout=`, `&view=`, `&detail=`, `&algorithm=`, `&focus=`.

```html
<iframe src="https://stepanic.github.io/open-diagram/embed.html#src=https://github.com/you/repo/blob/main/schema.dbml"
        width="100%" height="480" style="border: 1px solid #d0d7de; border-radius: 8px" loading="lazy"></iframe>
```

`dist/open-diagram-embed.js` is ~630 KB (~170 KB gzip): `@dbml/core` and the renderer, without the
editor. ELK (`dist/elk.js`, ~1.6 MB) is fetched only for the layered layouts; set `OD.elkUrl`
before the script to load it from elsewhere. Licences: [`dist/LICENSES.txt`](dist/LICENSES.txt).
To host it yourself, copy `dist/` as it is.

## Supported DBML

- `Project` with a Markdown note (**Project** panel, key **P**)
- tables: schemas, aliases, `headercolor`, notes, `check` and `checks { }`, custom properties
  and `Metadata` blocks (in tooltips)
- fields: pk, unique, not null, increment, default, note, inline refs; enum types
- indexes, composite and single-column
- `Ref` with every relation type, composite refs, optional ends (`>?`, drawn 0..1) and inactive
  refs (dashed)
- enums, `TableGroup` (colour, note) and sticky `Note`s
- `TablePartial` (injected fields are marked), `records` (a sample in the table tooltip)
- `DiagramView` (view picker in the toolbar) and data lineage `Dep` (key **L** toggles it)

Not supported: modules (`use` / `reuse` across files) and SQL import (SQL export works).
Details per feature, in Croatian: [docs/2026-10-19-dbml-znacajke.md](docs/2026-10-19-dbml-znacajke.md).

## Customise

All visual decisions are in [`src/theme.js`](src/theme.js): fonts, sizes, colours, ref markers
(`crowsfoot` or `labels`), group styling, ELK layout options. SVG/PNG export embeds the same styles.

| File | Role |
| --- | --- |
| `src/model.js` | DBML → plain model (tables, refs, groups, notes, enums) via `@dbml/core` |
| `src/lint.js` | schema checks and ref suggestions for the Problems panel |
| `src/export.js` | Mermaid `erDiagram` and Markdown documentation |
| `src/geometry.js` | box sizes, ref routing with obstacle avoidance, markers |
| `src/layout.js` | the four auto layouts (ELK layered, stack, spiral, shelf packing), groups first, then the whole diagram |
| `src/render.js` | SVG drawing and export |
| `src/highlight.js` | DBML syntax highlighting for the editor (coloured layer under a transparent textarea) |
| `src/viewer.js` | pan, zoom, follow, tooltips and click to select; shared by the app and the embed |
| `src/url.js` | GitHub, Gist and GitLab links → raw files; the `#dbml=` hash |
| `src/embed.js` | `<open-diagram>` web component and ```` ```dbml ```` block upgrade |
| `src/app.js` | editor, table dragging, persistence, files, menus |

## Develop

```bash
npm install
npm run build          # rebuild vendor/ and dist/ (after upgrading a library or changing the embed)
npm test               # headless Chrome smoke test on examples/open-ledger.dbml
npm test -- my.dbml    # same on another file
```

`vendor/` and `dist/` are committed so the app and the embed run without `npm install` or a build
on GitHub Pages; `npm test` fails when `dist/` is older than `src/`. The `@dbml/core` bundle leaves out
its SQL importers (ANTLR, ~34 MB), so it is ~0.6 MB: DBML is parsed, and SQL can be exported
but not imported.

## Licences

Open Diagram: MIT. Bundled in `vendor/`: [`@dbml/core`](https://github.com/holistics/dbml)
(Apache-2.0) and [`elkjs`](https://github.com/kieler/elkjs) (EPL-2.0), with their bundled
dependencies; licence texts in [`vendor/THIRD_PARTY_LICENSES.md`](vendor/THIRD_PARTY_LICENSES.md).
`examples/open-ledger.dbml` is from [pinkainc/open-ledger](https://github.com/pinkainc/open-ledger) (MIT).

## Design notes (in Croatian)

- [docs/2026-10-17-renderer-odluke.md](docs/2026-10-17-renderer-odluke.md): odluke, mjerenja rasporeda, zamke, otvorene stavke
- [docs/2026-10-19-dbml-znacajke.md](docs/2026-10-19-dbml-znacajke.md): sve značajke DBML-a, što Open Diagram od njih prikazuje, što dodati
- [docs/2026-10-19-embed.md](docs/2026-10-19-embed.md): read-only ugradnja dijagrama u druge web stranice
