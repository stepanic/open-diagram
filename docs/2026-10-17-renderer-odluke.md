# Renderer: odluke, mjerenja, zamke (2026-10-17)

Prva verzija Open Diagrama. Ovdje je ono što se ne vidi iz koda.

## Zašto vlastiti renderer

dbdiagram.io je vlasnički (Holistics) i radi samo online, uz račun. Otvoreni dio je parser.

Umjesto toga: `@dbml/core` (Apache-2.0, isti Holisticsov parser) + `elkjs` + vlastiti SVG.

## @dbml/core: 15 MB → 476 KB

`Parser.mjs` statički uvozi ANTLR SQL importere (`parse/ANTLR` ≈ 34 MB na disku). Za
`dbmlv2` ne trebaju, jer on ide kroz `@dbml/parse` (`Compiler`). esbuild plugin u
`scripts/build-vendor.mjs` zamjenjuje `ANTLR/ASTGeneration/index.mjs` i
`deprecated/*Parser.mjs` stubovima koji bacaju grešku ako ih se pozove.
Ako nova verzija `@dbml/core` promijeni imena tih importa, build pada na nedostajućem exportu.
Popravak je regex u pluginu.

Greške parsera dolaze kao `err.diags[]` s `location.start.line` (1-based).

## Raspored: SEPARATE_CHILDREN

Mjereno na `examples/open-ledger.dbml` (28 tablica, 9 grupa, 27 refova):

| ELK varijanta | bbox (px) | fit zoom |
| --- | --- | --- |
| `INCLUDE_CHILDREN` (bazno) | 2112 × 4012 | 0.22 |
| + `aspectRatio 1.6` | 2112 × 4012 | 0.22 |
| + `wrapping MULTI_EDGE` | 2112 × 4012 | 0.22 |
| `direction DOWN` | 2980 × 3296 | 0.27 |
| **`SEPARATE_CHILDREN` + `aspectRatio 1.6`** | **2225 × 2229** | **0.39** |

Cijena: refovi između grupa ne utječu na raspored, pa linije između grupa znaju biti duge.

## Routing refova

Ortogonalna linija s jednim vertikalnim segmentom. Za njegov x isprobavaju se sredina i
procjepi uz svaku drugu tablicu, a bira se onaj koji siječe najmanje kutija (pa onaj najbliži
sredini). Horizontalni dijelovi se ne izbjegavaju: linija može proći ispod tablice koja joj stoji
na putu u istom retku.

## Zamke

- **`file://` i ES moduli**: `<script type="module">` pada na CORS-u s `file://`, zato su svi
  fajlovi klasične skripte s globalnim `window.OD`.
- **Promjena DOM-a na pointerdown kvari dblclick**: tablica se pomiče na vrh tek kad
  povlačenje stvarno krene.
- **Playwright bez preuzimanja browsera**: test koristi `channel: 'chrome'` (instalirani
  Chrome), a tek ako ga nema, Playwrightov Chromium.
- `Unable to resolve platform.` u konzoli dolazi iz bundlea `@dbml/core` i bezopasno je; test ga
  ignorira.

## Otvoreno

- Ideje koje nisu napravljene: izbjegavanje prepreka i za horizontalne segmente; tamna tema
  dijagrama; syntax highlighting u editoru (sad je običan textarea); spremanje rasporeda u
  sam `.dbml` (sad localStorage + `.layout.json`).
