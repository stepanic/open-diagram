# Open Diagram

Offline DBML diagram renderer in a single `index.html`: no server, no network, no build step to use it.
Open the file in a browser, paste or open a `.dbml` file, drag things around, export SVG/PNG.

## Use

Open `index.html` directly (`file://` works).

- **Open / Save**: load a `.dbml` (or a `.layout.json`), download the DBML. Drag and drop works too.
- **Drag** a table by any part of it; drag a TableGroup by its title to move the whole group.
- **Scroll** pans, **pinch** or **⌘/Ctrl + scroll** zooms, **F** fits, **Esc** clears the selection.
- **Click** a table to highlight its refs, **double-click** to jump to it in the editor.
- **Hover** a field, header, ref or group title for notes, flags, defaults, enum values and refs.
- **Detail**: all fields, keys only (PK/FK/referenced), or names only.
- **Auto layout** discards manual positions. Positions are remembered per file name in
  localStorage; **Layout** downloads them as JSON so they can travel with the `.dbml`.

Supported DBML: tables (schemas, aliases, `headercolor`, notes), fields (pk, unique, not null,
increment, default, note, inline refs), composite and single-column indexes, `Ref` with all
relation types (including composite refs), enums, `TableGroup` (color, note) and sticky `Note`s.

## Customise

All visual decisions are in [`src/theme.js`](src/theme.js): fonts, sizes, colours, ref markers
(`crowsfoot` or `labels`), group styling, ELK layout options. SVG/PNG export embeds the same styles.

| File | Role |
| --- | --- |
| `src/model.js` | DBML → plain model (tables, refs, groups, notes, enums) via `@dbml/core` |
| `src/geometry.js` | box sizes, ref routing with obstacle avoidance, markers |
| `src/layout.js` | ELK auto layout, TableGroups as compound nodes |
| `src/render.js` | SVG drawing and export |
| `src/app.js` | editor, pan/zoom/drag, tooltips, persistence, files |

## Develop

```bash
npm install
npm run build:vendor   # rebuild vendor/ from node_modules (only after upgrading a library)
npm test               # headless Chrome smoke test on examples/open-ledger.dbml
npm test -- my.dbml    # same on another file
```

`vendor/` is committed so the app runs without `npm install`. The `@dbml/core` bundle leaves out
its SQL importers (ANTLR, ~34 MB), so it is ~0.5 MB; only DBML is parsed.

## Licences

Open Diagram: MIT. Bundled in `vendor/`: [`@dbml/core`](https://github.com/holistics/dbml)
(Apache-2.0) and [`elkjs`](https://github.com/kieler/elkjs) (EPL-2.0).
`examples/open-ledger.dbml` is from [pinkainc/open-ledger](https://github.com/pinkainc/open-ledger) (MIT).
