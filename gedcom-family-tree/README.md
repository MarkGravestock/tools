# GEDCOM Family Tree

A single-file family tree viewer and GEDCOM validator that runs entirely in the
browser. Open a `.ged` file and you get two things: the whole tree drawn on one
generation grid, and a report on how the file measures up against the GEDCOM
5.5.1 specification.

Nothing is uploaded. The file is read with the browser's own file reader —
there is no server, no account, and no network request. Open the page offline
and it still works.

## Usage

Open `gedcom-family-tree.html` in a browser and drop a GEDCOM file on it.
First load fetches two fonts from Google Fonts; after that it is all local.

- **Everyone** draws every individual in the file, exactly once, on a
  generation grid. Zoomed out past 30% the cards drop their labels and become
  solid blocks, so a large file reads as a map of who sits in which generation
  rather than a smear of unreadable text.
- **Around one person** narrows to a chosen person's ancestors, descendants,
  siblings and cousins, to a depth you set. Pick someone, then
  *Show their relatives*.
- **Search** (or `/`) finds a person by name and zooms to them.
- Hovering anyone shows a quick-glance card — name, dates, birth/death place,
  occupation, parents, spouse(s), child count — without needing to click.
  Clicking opens the full panel: every event the file records for them, not
  just birth and death but residences, baptisms, probate, military service
  and whatever else the exporter wrote down, plus parents, siblings, each
  marriage with its children, notes, sources and media. In a focused view it
  also says how many generations the person sits from the one you focused on.
- **Report** opens the validation report. **SVG** downloads the current view.
- Keys: `/` search · `f` fit · `+` / `−` zoom · `Esc` close.

## What it draws

A GEDCOM is a graph, not a tree. People remarry, cousins marry each other, and
most exports hold several unconnected families. Walking descendants from a
single root — what most simple viewers do — draws a fraction of the file and
silently drops the rest.

This lays out the graph instead:

1. every individual gets a generation, by relaxation over the parent links, so
   a child is always below its parents and spouses share a row;
2. people married within a generation are grouped into a cluster, so couples
   sit side by side and someone who married three times sits among all three;
3. clusters are ordered per generation by a depth-first walk down the family
   links, then nudged toward their relatives by barycentre passes;
4. each row is placed by isotonic regression against those barycentres, which
   is the exact least-squares fit subject to "keep the order, do not overlap" —
   one pass, no tuning, and it compacts slack out of the row rather than only
   ever pushing rightwards;
5. unconnected components are laid out one after another.

The result places every person once and draws every family link explicitly.
Marriages are a link between the two cards with the year on it; a dissolved
marriage is dashed. Children hang off a junction below the couple. A child
linked by adoption, fostering or a step relationship gets a dashed riser.

A married-in spouse sits right next to their partner, which is correct — but
without a cue it can look like two unrelated families got mixed together in
one row. A faint dotted line marks where one birth family's children end and
the next family's begin, so that adjacency reads as intentional grouping.

## What it validates

The report groups findings by rule, so a file with 446 mixed-case month names
produces one entry with a count rather than 446 lines. Each finding says what
the specification requires, why it matters, and gives sample line numbers.

| Category | Examples |
|---|---|
| Syntax | lines that do not match the GEDCOM line grammar, level jumps, lines over 255 characters, over-long XREF_IDs, padded values |
| Structure | missing or duplicated `HEAD`/`TRLR`, missing `GEDC.VERS`/`FORM`/`CHAR`, character sets outside the four 5.5.1 defines |
| Grammar | tags in places 5.5.1 does not allow them — `MARR` on an individual, `ADDR` directly under `INDI`, `DATE` under `OBJE`, anything outside `EVENT_DETAIL` or `PERSONAL_NAME_STRUCTURE` |
| References | pointers to records that do not exist, duplicate XREF_IDs, records with no XREF_ID, links recorded from only one end, records nothing points at |
| Dates | values that are not a `DATE_VALUE` — `1914-1920` instead of `FROM 1914 TO 1920`, `29/12/1903`, full month names, `Abt.` for `ABT`, a place name in a date field |
| Multimedia | `OBJE` with no `FILE`, `FILE` with no reference, `FILE` with no `FORM` |
| Individuals | names without `/surname/` delimiters, multiple `NAME`s, no usable `SEX`, a child of more than one family |
| Families | a family with fewer than two members that exist, `HUSB` pointing at someone recorded female, a person who is both spouse and child of the same family, duplicate `CHIL` |
| Plausibility | death before birth, lifespan over 115, a parent under 12 or over 65, a child born after a parent died, a marriage after a spouse died, an individual who is their own ancestor |
| Extensions | vendor `_`-prefixed tags and records, noted rather than faulted |

Errors are departures from the specification. Warnings are legal but lossy or
ambiguous. Notes are observations. **Everything readable is drawn regardless** —
the validator reports, it does not refuse.

Where a file breaks a rule the viewer can work around, it does so and says as
much: a `FAMS` with no matching `HUSB`/`WIFE` is joined up so the family still
draws, and reported as an error.

## Development

```
npm install     # jsdom, for the smoke test only
npm test        # parser, validator and layout — no dependencies needed
npm run build   # inline src/ modules into gedcom-family-tree.html
npm run smoke   # drives the built file end to end in jsdom
```

`npm test` runs 138 assertions against two fixtures: `clean.ged`, which must
produce zero errors and zero warnings, and `quirks.ged`, which reproduces every
defect found in a real Ancestry.com export and asserts each one is caught. It
also checks layout invariants — everyone placed once, no overlapping cards,
children below their parents, couples level, and (given two sibling groups
joined only through a grandchild-generation marriage) that each family's
children land in one contiguous block rather than interleaved by raw birth
year, with exactly one divider marker between the two blocks — including for
an uncle–niece marriage, which is the case that breaks naive generation
numbering.

`npm run smoke` loads the built HTML, feeds it a GEDCOM and checks the page
really drew the tree, the report, the detail drawer and the search. It writes
`test/preview.svg` so a layout change can be eyeballed. Point it at a real
export with `SMOKE_GED=path/to/file.ged npm run smoke`.

| Path | Purpose |
|---|---|
| `gedcom-family-tree.html` | The tool (built artefact — don't edit directly) |
| `src/template.html` | UI, styles, app wiring |
| `src/gedcom.js` | Tokenizer, record tree, model, date and name parsing |
| `src/validate.js` | The 5.5.1 rules |
| `src/layout.js` | Generation assignment and graph layout |
| `src/build.mjs` | Inlines the modules into the template |
| `test/` | Unit tests, fixtures, and the jsdom smoke test |

The modules are plain ES modules with no dependencies, so Node imports them
directly for testing; the build strips their imports and export blocks and
inlines them into the page's single module script.

## Caveats

- GEDCOM 7.0 files are not the target. The tokenizer will read one, but the
  rules checked are 5.5.1's, so a 7.0 file will report differences that are not
  faults. The report says which version the header declared.
- ANSEL-encoded files are read as UTF-8 and will show mangled accented
  characters. The header's `CHAR` value is reported; re-export as UTF-8.
- A file with a very wide generation produces a very wide canvas — 477 people
  across nine generations comes out about 33,000 pixels wide. That is the shape
  of the data, not a layout failure; the overview zoom and the focused view are
  the way through it.
- A person who married into a different family competes for a single position
  between their birth siblings and their spouse's birth siblings — they can sit
  contiguous with only one side. This is not a bug to fix but a structural
  property of genealogical data: it is a DAG (a person is simultaneously a
  child in one family and a parent in another, and cousin marriages create
  cross-links), and no algorithm built on strict hierarchical tree-drawing can
  make both a person's birth family and their marriage family fully contiguous
  at once when the two compete for the same row. It is rare in practice — in
  the 477-person file used to build this, 5 people (1.0%) end up separated
  from their birth siblings this way, always because they married into a
  family whose own walk reached their shared couple-cluster first.

## Further reading

- [The GEDCOM Standard 5.5.1](https://gedcom.io/specifications/ged551.pdf) — the specification this checks against
- [GEDCOM Standard Release 7](https://gedcom.io/) — the current successor
- [FamilySearch GEDCOM validation notes](https://gedcom.io/tools/)

See `COLOPHON.md` for how this was built.
