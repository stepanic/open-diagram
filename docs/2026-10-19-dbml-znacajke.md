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
| Višeredni string | `'''…'''`; zajednička uvlaka se skida, `\` na kraju retka spaja redove | 🟡 bilješke se prikažu kao čisti tekst |
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
| `Project` | `database_type`, `Note` (Markdown u višerednom stringu) | ❌ bilješka projekta se nigdje ne vidi |
| Shema | `schema.table`; bez sheme je `public` | ✅ ime `schema.table` |
| Alias | `Table x as X`, pa `Ref: X.id …` | ✅ tooltip |
| `headercolor` | `#rgb` ili `#rrggbb` | ✅ |
| Postavke stupca | `pk` / `primary key`, `null` / `not null`, `unique`, `increment`, `default:`, `note:` | ✅ ikone, NN, tooltip |
| `default` | broj, `'string'`, `` `izraz` ``, `true/false/null` | ✅ tooltip |
| `check` na stupcu | `` [check: `expr`] ``, može ih biti više | ❌ |
| `checks { }` blok | `` checks { `a + b >= 0` [name: 'chk'] } `` | ❌ |
| Custom svojstva | `[owner: "data-team"]` na Table, Column, TableGroup, sticky Note | ❌ |
| `Metadata` blok | `Metadata Table users { owner: 'x' }`, `Metadata Column users.id { pii: 'true' }`; ima prednost pred inline svojstvima | ❌ |

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
Open Diagram: 🟡 kompozitni `pk` i jednostupčani `unique` označe polja, a tooltip tablice ispiše
popis stupaca. `name`, `type`, `note` i indeksi s izrazima se ne prikazuju.

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
| Opcionalna strana | `>?`, `?>` … (parser daje relaciju `0..1`) | ❌ crta se kao obična `1` |
| `delete` / `update` | `cascade`, `restrict`, `set null`, `set default`, `no action` | ✅ tooltip |
| `color` | boja linije | ✅ |
| `inactive` | „neaktivna" veza, dbdiagram je crta točkasto | ❌ crta se kao puna |
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
Open Diagram: ✅ parser ubaci stupce, pa ih crtež vidi kao obične. Ne označava se koji je
stupac došao iz partiala (`field.injectedPartial` postoji u parseru).

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
Open Diagram: ❌ (`db.records[]` postoji).

## 9. DiagramView (pogledi)

```dbml
DiagramView novac {
  Tables { wallets balances symbols }
  TableGroups { money }
  Notes { legenda }
}
DiagramView sve { Tables { * } }
```

Kategorije: `Tables`, `Notes`, `TableGroups`, `Schemas`. Open Diagram: ❌ (`db.diagramViews[]`).

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
Open Diagram: ❌.

## 11. Moduli (više datoteka)

```dbml
use * from './base'                       // sve
use { table users as u  schema auth } from './auth'
reuse * from './users'                    // proslijedi dalje onome tko uveze ovu datoteku
```

`use` nije tranzitivan, a kružni importi su dozvoljeni. Open Diagram: ❌, jer otvara jednu
datoteku i nema pristup susjednim.

## Što bi trebalo dodati u renderer (po vrijednosti)

1. **`inactive` i opcionalni refovi**: točkasta linija, odnosno prazan krug na `0..1` kraju.
   Malo posla u `geometry.js` / `render.js`.
2. **Bilješka projekta** kao panel ili sticky na platnu, uz Markdown u svim bilješkama
   (naslovi, liste, `code`).
3. **`checks` i custom svojstva** u tooltipu tablice i polja. Za svojstva i oznaka na tablici
   (npr. „pii").
4. **DiagramView**: padajući izbornik koji prikaže samo tablice, grupe i bilješke iz pogleda.
5. **`Dep` lineage**: druga vrsta linije (isprekidana, sa strelicom) između tablica ili stupaca.
6. **Records**: tablica s primjerima u tooltipu ili panelu.
7. Oznaka stupaca iz TablePartiala (npr. sivi tekst).
