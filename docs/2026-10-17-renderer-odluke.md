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
  dijagrama; spremanje rasporeda u
  sam `.dbml` (sad localStorage + `.layout.json`).

## 2026-10-19: četiri auto layouta i highlighting

### Auto layout (`src/layout.js`)

Izbornik kao na dbdiagramu: Left-right, Pipeline, Snowflake i Compact (tipke 1–4 dok je izbornik
otvoren). Izbor se pamti u localStorage (`layoutAlgorithm`).

Svaki algoritam radi u dvije razine: prvo tablice unutar grupe, zatim grupe kao kutije zajedno s
tablicama bez grupe i bilješkama. Okvir grupe je bbox njenih tablica (`render.js` → `drawGroups`),
pa algoritam koji bi slagao tablice preko granica grupa dao bi okvire koji se preklapaju. Zbog toga
je odbačena varijanta s jednim zajedničkim rasporedom svih tablica, kakvu vjerojatno ima dbdiagramov
Left-right.

| Algoritam | Unutar grupe | Grupe | open-ledger bbox |
| --- | --- | --- | --- |
| Left-right | ELK layered (0.75 razmaka) | ELK layered s bridovima između grupa | 2851 × 2418 |
| Pipeline | stupac, topološki (referencirane prve) | ELK layered, `aspectRatio 3` | 2292 × 1892 |
| Snowflake | vlastita spirala | vlastita spirala | 2608 × 1977 |
| Compact | shelf packing, najviše prvo | shelf packing | 1994 × 2030 |

Snowflake je pohlepan: idući je čvor onaj s najviše veza prema već postavljenima. Postavlja se
što bliže težištu tih susjeda, a mjesto se traži po spirali koja počinje na strani okrenutoj od
središta. Preklapanje je isključeno konstrukcijom, jer se provjerava svaki kandidat. ELK `stress`
i `force` su preskočeni jer ne jamče da se kutije ne preklapaju.

Smoke test za svaki algoritam provjerava da nema preklapanja tablica, grupa ni tuđih tablica
unutar grupe i sprema `test-output/layout-<id>.png`.

### Highlighting u editoru (`src/highlight.js`)

Ispod prozirne `<textarea>` je obojeni `<pre>`, pa undo, selekcija, Tab i skok na grešku ostaju
nativni. Uvjet je da oba sloja imaju identičan tekst i širine znakova:

- Nema bolda ni kurziva. U nekim fallback fontima mijenjaju širinu, a onda se kursor razilazi s
  bojama.
- `<pre>` dobiva dodatni `\n ` na kraju da mu raspon scrolla bude jednak textareinom (provjereno do
  dna: `scrollTop` 8932 = 8932).
- Test „highlight matches the editor text" uspoređuje `textContent` s `editor.value`.

Boja se cijeli tekst na svaki `input`. Za 500 redaka to je trenutno. Za vrlo velike datoteke
trebalo bi bojati samo vidljivi dio.

### Zamke

- **Cache**: `python3 -m http.server` šalje `Last-Modified`, pa Brave nakon izmjene JS-a posluži
  staru verziju. Treba tvrdi reload (Cmd+Shift+R).
- **Port 8765** je na ovom Macu stalno zauzet drugim Python procesom. Za lokalno posluživanje koristi
  se drugi port (npr. 8791).
- **„Untitled" nakon otvaranja `index.html`**: aplikacija pokazuje ugrađeni SAMPLE ili zadnji izvor
  iz localStoragea, ne datoteku iz `examples/`. Datoteku treba učitati preko Open, drag & dropa ili
  `OD.app.openText(name, text)`.

## 2026-10-19: Dep, DiagramView, Project i ostatak DBML-a

Stanje po značajkama je u `docs/2026-10-19-dbml-znacajke.md`. Ovdje samo zamke:

- **Lokalni server mora slati `Cache-Control: no-store`.** `python3 -m http.server` šalje samo
  `Last-Modified`, pa je Brave nakon izmjene uzeo novi `app.js` i stari `model.js` iz cachea
  (`renderViewMenu` je pao na `views` koji ne postoji). Mali handler koji dodaje `no-store` to
  rješava; i tada nakon izmjene treba Cmd+Shift+R.
- **Test hovera na liniju**: sredina bounding boxa putanje je obično prazno platno. Test uzima
  `getPointAtLength(len / 2)` i preračuna ga s `getScreenCTM()`.
- `OD.applyView` vraća novi model (podskup tablica, refova, depova, grupa, bilježaka), pa layout,
  crtanje i izvoz ne znaju za poglede. Puni model je u `state.fullModel`.

## 2026-10-19: pretraga u editoru i veza kursor → dijagram

- **⌘F** otvara traku za pretragu nad editorom (bez razlike velikih i malih slova, običan tekst).
  Enter / ⇧Enter ili ⌘G / ⇧⌘G idu kroz pogotke, Esc vraća fokus u editor s označenim pogotkom.
  Pogoci se crtaju u sloju `#search-marks` ispod highlighta (isti font i scroll), jer
  `<textarea>` ne pokazuje selekciju dok nije u fokusu.
- **Kursor u editoru** (`selectionchange`) → `OD.elementAtLine` nađe najuži element čiji raspon
  redaka sadrži kursor (model ga puni iz `token.start/end.line` parsera u `model.sources`), a
  `OD.focusFor` ga pretvori u tablice, polja, refove, depove, grupe i bilješke za isticanje.
  Ostalo se zatamni (`theme.focus.dimOpacity`), a pogled se animirano pomakne (i po potrebi
  odzumira) da istaknuto stane na ekran. Klik na prazno platno ili Esc briše isticanje.
- Polja iz TablePartiala imaju token u partialu, ne u tablici: kursor na retku polja u
  `TablePartial` bloku istakne to polje u svim tablicama koje ga koriste; redak `~partial` u
  tablici istakne samo tablicu.
- Inline ref ima isti redak kao polje; tada pobjeđuje polje, koje ionako istakne i svoje refove.
- Pogodak pretrage također pomiče isticanje na dijagramu.
- **Obrnuti smjer (dijagram → source):** klik na polje, ref, Dep liniju, naslov grupe, zaglavlje
  tablice ili bilješku označi narančastom trakom (`#line-mark`) redak iz kojeg element dolazi
  (`field.line`, `ref.line`, `dep.line`, `group.line`) i istakne ga na dijagramu. Editor namjerno
  ne dobiva fokus: inače bi tipke platna (F, +, -) upisivale znakove u DBML. Dvoklik skače u
  editor na taj redak (s fokusom) za uređivanje. Polje iz partiala vodi na redak u `TablePartial`.

## 2026-10-19: Follow i otvaranje s URL-a

### Follow (zoom za kursorom)

- **Cilj nije `renderer.focusBox()`.** Fokus polja uključuje sve tablice s kojima je polje
  povezano refom, pa bi zoom na `users.id` odzumirao pola sheme. `followTarget()` u `app.js` zato
  bira sam element: polje → njegova tablica (red se centrira kad tablica ne stane), ref → obje
  tablice, grupa → okvir grupe, ostalo (enum, partial, Dep) → `focusBox()`.
- **Zoom je ograničen na [0.5, 1.25].** Fit na malu tablicu bez gornje granice daje 300–400 %. Na
  `open-ledger` tablica s 20 polja stane pri 1.25, a grupa `ledger` također.
- **Ključ cilja (`t:<tablica>`, `r:<ref>`, `g:<grupa>`)** odlučuje hoće li se pogled pomaknuti:
  kretanje po poljima iste tablice ne trese platno, osim kad red izađe s ekrana. Debounce od
  150 ms, a označavanje na dijagramu ostaje trenutno.
- **Ručni pan/zoom/Fit pauzira** praćenje do sljedećeg cilja, umjesto da ga isključi trajno.
- **Zamka:** `fit()` nije prekidao animaciju `revealFocus` koja je bila u tijeku, pa ju je
  animacija prepisala 220 ms kasnije. Prije se to nije vidjelo jer je element obično već bio na
  ekranu. Sad `fit()` zove `pauseFollow()`, koji prekida i animaciju.

### `?url=` i dijeljenje

- **Raw adrese:** `github.com/o/r/blob|raw/<ref>/<put>` → `raw.githubusercontent.com/o/r/<ref>/<put>`,
  `gist.github.com/u/id` → `gist.githubusercontent.com/u/id/raw` (prva datoteka gista),
  GitLab `/-/blob/` → `/-/raw/`. `raw.githubusercontent.com` šalje
  `Access-Control-Allow-Origin: *`, pa radi i s `file://`. Ostali hostovi ovise o svom CORS-u.
- **Ime dokumenta je put raw URL-a bez hosta** (`owner/repo/ref/put.dbml`). Rasporedi u
  localStorageu su po imenu, pa dva `schema.dbml` iz različitih repoa ne dijele položaje.
- **`.layout.json` uz `.dbml`** se primijeni samo kad browser nema svoje položaje za tu
  datoteku. Inače bi svaki reload poništio ručno razmještanje. Eksplicitni `&layout=` uvijek
  pobjeđuje.
- **Prvo tipkanje briše `?url=`** (`forgetRemote()`), jer bi reload s parametrom ponovno povukao
  datoteku i bez upozorenja bacio izmjene. Izmijenjeni tekst zato nema link za dijeljenje.
- **Neuspjelo učitavanje** iscrta zadnji dokument iz localStoragea pa tek onda postavi grešku u
  status. Obrnutim redom bi `parse()` prepisao poruku.
- **Test** lažira `raw.githubusercontent.com` preko `page.route`, pa ne treba mrežu. 404 za
  `.layout.json` je očekivan i ne smije se brojati kao greška.

### Otvoreno

- Embed: prijedlog je u [2026-10-19-embed.md](2026-10-19-embed.md). Prvi korak je `src/viewer.js`.
- Share link za lokalno izmijenjen tekst (npr. `#dbml=` deflate u hashu, vidi embed dokument).
