# DBML: sve značajke jezika i što od njih Open Diagram prikazuje (2026-10-19)

Izvor: službena dokumentacija na <https://dbml.dbdiagram.io/home>, stranice `/docs`,
`/syntax/enrichment-visualization`, `/syntax/data-lineage`, `/syntax/module-system`,
`/syntax/language-basics` (pročitano 2026-10-19). Ovo je sažetak vlastitim riječima s kratkim
primjerima, ne preslika.

Stupac **Parser** je provjeren: svaki primjer je parsiran s `@dbml/core` 10.3.1 (`dbmlv2`), istim
kojeg koristi `vendor/dbml-core.js`. Sve značajke ispod prolaze. Stupac **Open Diagram** kaže
koristi li `src/model.js` / `src/render.js` tu informaciju.

Legenda: ✅ prikazano · 🟡 djelomično · ❌ parsira se, ali se ne prikazuje

## 1. Osnove jezika

| Značajka | Sintaksa | Open Diagram |
| --- | --- | --- |
| Komentari | `// red`, `/* blok */` | ✅ (highlight) |
| String | `'tekst'`, escape `\'` i `\\` | ✅ |
| Višeredni string | `'''…'''`; zajednička uvlaka se skida, `\` na kraju retka spaja redove | 🟡 Markdown u tooltipovima i panelu projekta; sticky bilješke na platnu su čisti tekst |
| Navodnici za imena | `"column name"`, `"double precision"` | ✅ |
| Izraz | `` `now()` `` | ✅ |
| Ključne riječi | ne razlikuju velika/mala slova (`Table` = `table`) | ✅ |

## 2. Projekt, sheme, tablice

```dbml
Project open_ledger {
  database_type: 'PostgreSQL'
  Note: '''
    # Naslov
    Markdown opis cijelog modela
  '''
}

Table core.users as U [headercolor: #3498DB, owner: "data-team"] {
  id integer [pk, increment]
  email varchar(255) [unique, not null, note: 'login']
  status user_status [default: 'active']
  balance decimal(12,2) [check: `balance >= 0`]
  Note: 'Tablica s bilješkom'          // ili Note { '…' }
}
```

| Značajka | Detalj | Open Diagram |
| --- | --- | --- |
| `Project` | `database_type`, `Note` (Markdown u višerednom stringu) | ✅ gumb **Project** (tipka P) otvara panel s Markdownom |
| Shema | `schema.table`; bez sheme je `public` | ✅ ime `schema.table` |
| Alias | `Table x as X`, pa `Ref: X.id …` | ✅ tooltip |
| `headercolor` | `#rgb` ili `#rrggbb` | ✅ |
| Postavke stupca | `pk` / `primary key`, `null` / `not null`, `unique`, `increment`, `default:`, `note:` | ✅ ikone, NN, tooltip |
| `default` | broj, `'string'`, `` `izraz` ``, `true/false/null` | ✅ tooltip |
| `check` na stupcu | `` [check: `expr`] ``, može ih biti više | ✅ tooltip polja |
| `checks { }` blok | `` checks { `a + b >= 0` [name: 'chk'] } `` | ✅ tooltip tablice (ime + izraz) |
| Custom svojstva | `[owner: "data-team"]` na Table, Column, TableGroup, sticky Note | ✅ tooltip (tablica, polje, grupa, Dep); sticky Note ❌ |
| `Metadata` blok | `Metadata Table users { owner: 'x' }`, `Metadata Column users.id { pii: 'true' }`; ima prednost pred inline svojstvima | ✅ isto kao custom svojstva (parser ih spaja u `metadata`) |

## 3. Indeksi

```dbml
indexes {
  created_at [name: 'idx_created', note: 'za sortiranje']
  (country, booking_date) [unique]
  (`lower(email)`) [type: hash]
  (a, b) [pk]
}
```

Postavke: `type` (`btree`, `hash`), `name`, `unique`, `pk`, `note`.
Open Diagram: ✅ kompozitni `pk` i jednostupčani `unique` označe polja, a tooltip tablice ispiše
svaki indeks s imenom, stupcima/izrazima, `type` i `note`.

## 4. Relacije (`Ref`)

```dbml
Ref fk_name: posts.user_id > users.id [delete: cascade, update: no action, color: #79AD51]
Ref { posts.user_id > users.id [inactive] }
Ref: a.(x, y) > b.(p, q)                    // kompozitna
Ref: blog.posts.user_id > core.users.id     // preko shema
user_id int [ref: > users.id]               // inline: bez imena i postavki
```

| Značajka | Detalj | Open Diagram |
| --- | --- | --- |
| Operatori | `<` 1–N, `>` N–1, `-` 1–1, `<>` N–N | ✅ |
| Opcionalna strana | `>?`, `?>` … (parser daje relaciju `0..1`) | ✅ prazan krug uz crticu na `0..1` kraju, `0..1` u tooltipu |
| `delete` / `update` | `cascade`, `restrict`, `set null`, `set default`, `no action` | ✅ tooltip |
| `color` | boja linije | ✅ |
| `inactive` | „neaktivna" veza, dbdiagram je crta točkasto | ✅ točkasta linija (`theme.ref.inactiveDash`) |
| 1–1 smjer | u long/short formi FK je drugi stupac; inline je FK stupac s `ref` | ✅ |

## 5. Enumi

```dbml
Enum payments.status {
  pending
  "in progress" [note: 'čeka banku']
}
Table t { s payments.status }
```

Open Diagram: ✅ tooltip polja pokaže vrijednosti i njihove bilješke.

## 6. TableGroup i sticky Note

```dbml
TableGroup money [color: #0f766e, note: 'Novac', team: "core"] {
  symbols
  wallets
  Note: 'ili bilješka unutar bloka'
}

Note legenda [color: #F4D03F] {
  '''
  Višeredna bilješka na platnu.
  '''
}
Note bez_pozadine [color: none] { '…' }
```

Open Diagram: ✅ grupe (boja, bilješka u tooltipu, povlačenje), ✅ sticky bilješke (boja).
`color: none` nije provjeren. Custom svojstva grupe se ne prikazuju.

## 7. TablePartial (ponovljeni stupci)

```dbml
TablePartial record_base [headercolor: #334155] {
  luid varchar [pk]
  ledger varchar [not null]
  moment timestamp
  indexes { (ledger, luid) [unique] }
}

Table wallets {
  ~record_base
  handle varchar [not null]
}
```

Lokalna definicija stupca ima prednost pred partialom, a od više partiala pobjeđuje zadnji.
Open Diagram: ✅ parser ubaci stupce, pa ih crtež vidi kao obične; tooltip polja kaže
`from ~partial`. Na samom platnu se ne razlikuju.

## 8. Records (primjer podataka)

```dbml
records wallets(handle, symbol) {
  'alice', 'usd'
  'bob', 'eur'
}
Table symbols {
  handle varchar
  records [example] { 'usd' }      // [example]: ostaje u DBML-u, ne ide u SQL INSERT
}
```

Vrijednosti: stringovi, brojevi, `true/false` (i `'Y'/'N'`, `1/0`), `null`, datumi kao
string, enum `Status.active`, izrazi u backtickovima. Jedan `records` blok po tablici.
Open Diagram: ✅ tooltip zaglavlja tablice pokaže do 5 redaka i 6 stupaca.

## 9. DiagramView (pogledi)

```dbml
DiagramView novac {
  Tables { wallets balances symbols }
  TableGroups { money }
  Notes { legenda }
}
DiagramView sve { Tables { * } }
```

Kategorije: `Tables`, `Notes`, `TableGroups`, `Schemas`. Open Diagram: ✅ izbornik pogleda u alatnoj traci
(`OD.applyView`). Svaki pogled ima vlastiti raspored u localStorage (`positions:<doc>#<view>`).

Zamka parsera: `Tables { * }` i nenavedena kategorija tablica oba dolaze kao `[]` čim je u pogledu
navedena bilo koja druga kategorija tablica. Zato vrijedi: sve tri kategorije tablica prazne (`[]`)
= sve tablice; sve `null` = nijedna; inače unija navedenog. `Tables { * }` uz `TableGroups { g }`
se zato čita kao „samo g". Za bilješke je razlika jasna: `null` nijedna, `[]` sve.

## 10. Data lineage (`Dep`)

```dbml
Dep: raw_orders -> stg_orders                  // tablica → tablica
Dep: raw_orders.amount -> stg_orders.revenue   // stupac → stupac
Table fct [dep: <- stg_orders] { revenue int [dep: -> report.total] }

Dep order_staging [color: #79AD51] {
  raw_orders -> stg_orders
  raw_payments -> stg_orders
  note: 'join + izračun prihoda'
  materialized: table
  query: '''SELECT …'''
}
```

Strelica uvijek ide od izvora prema izvedenom. Svi bridovi u bloku moraju završiti u istoj tablici.
Open Diagram: ✅ isprekidana linija s punom strelicom u izvedenu tablicu, boja iz `[color]` ili
`theme.dep.color`; stupac → stupac se veže na red polja. Gumb **Lineage** (tipka L) ih skriva.
Tooltip linije: ime bloka, krajevi, bilješka. Inline `[dep: …]` parser stavlja u isti `schema.deps`.
Dep linije ne utječu na auto layout.

## 11. Moduli (više datoteka)

```dbml
use * from './base'                       // sve
use { table users as u  schema auth } from './auth'
reuse * from './users'                    // proslijedi dalje onome tko uveze ovu datoteku
```

`use` nije tranzitivan, a kružni importi su dozvoljeni. Open Diagram: ❌, jer otvara jednu
datoteku i nema pristup susjednim.

## Što je još otvoreno

Stavke 1–4 s popisa od 2026-10-19 (opcionalni/`inactive` refovi, `Dep`, `DiagramView`, bilješka
projekta, `checks`, svojstva, records) napravljene su istog dana. Ostaje:

1. Markdown na sticky bilješkama na platnu (SVG tekst, sad čisti tekst).
2. Oznaka stupaca iz TablePartiala na samom platnu (npr. sivi tekst).
3. Custom svojstva sticky bilješki i oznaka na tablici (npr. „pii").
4. Enum kao vlastiti blok na platnu (sad samo u tooltipu polja).
5. Moduli (`use`/`reuse`): nema pristupa susjednim datotekama.

## Dodano iz usporedbe s drawdb-om (2026-10-19)

Panel s problemima (`src/lint.js`), prijedlog refova po imenima stupaca, izvoz u Mermaid i
Markdown (`src/export.js`) te SQL izvoz (`ModelExporter` iz `@dbml/core`, bundle +110 KB).
Što parser 10.x već sam odbija, pa lint to ne ponavlja: duplicirana tablica, stupac i ref,
prazan enum, ref na nepostojeći stupac. SQL **uvoz** nije dodan: treba ANTLR parsere (~34 MB).
Mermaid izvoz provjeren na open-ledgeru s Mermaidom 11 (parse i render bez greške).

Mjerenja i zamke iz te sesije:

- Na open-ledgeru lint daje 0 upozorenja i 32 bilješke, od toga 29 „FK bez indeksa": tamo
  indeksi počinju s `ledger` (`(ledger, wallet, …)`), pa `wallet` nije vodeći stupac. Za
  Postgres je to točno, ali je bučno; ako zasmeta, kandidat za prekidač.
- Prijedlog refova po golom imenu ključa (`luid` → tablica s PK `luid`) bez ograničenja dao je
  38 lažnih prijedloga na open-ledgeru, jer 20-ak tablica ima PK `luid`. Sad se golo ime
  uzima samo kad ga točno jedna tablica ima kao ključ.
- Mermaid se ne provjerava u `npm test` (nije ovisnost). Ručna provjera: `npm i mermaid@11` u
  privremeni direktorij, pa u Playwrightu (`channel: 'chrome'`) `mermaid.render()` na izvozu;
  pri grešci baca iznimku s „Parse error", što je provjereno na namjerno pokvarenom ulazu.
- Prazan `indexes { }` parser tiho proguta (nema elementa ni tokena), pa ga lint ne može javiti.
