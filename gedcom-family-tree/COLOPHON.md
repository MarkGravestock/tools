# Colophon

Built 15 August 2026 with Claude (Anthropic), in the spirit of the
[simonw/tools colophon](https://tools.simonwillison.net/colophon), which links
every tool to the LLM transcripts that produced it.

## Prompt

> can you review this ged viewer and align it with the tools in the tools
> project. can you pay attention to the visual presentation, and ensure that it
> fully renders the attached gedcom directly. validate that the gedcom meets
> the spec.

Supplied with a standalone `lineage-family-tree.html` and a 477-person
Ancestry.com export.

## What the starting point got wrong

The review found one structural bug that mattered more than everything else
combined. `buildTree` walked descendants from a single root chosen by
`findRoot`, with a `seen` set that stopped a person being visited twice.
Against the supplied file that drew **18 of 477 people — 4%**. The remaining
96% were not hidden behind a control; they were never in the DOM. The file has
103 individuals with no recorded parents, and a single root reaches almost none
of them.

Three smaller ones fell out of the same walk: only the first spouse of a
remarriage was drawn, disconnected components were dropped entirely, and the
parser read only levels 1 and 2, so `CONC`/`CONT` continuation lines were
discarded and every long note and source citation was silently truncated.

## Key decisions

- **Lay out the graph, not a tree.** Generations by monotone relaxation over
  the parent links; marriage clusters so a remarried person sits among all
  their spouses; barycentre passes for ordering.
- **Isotonic regression for row placement.** Substituting `z[i] = x[i] -
  offset[i]` turns "keep the order, do not overlap" into "`z` must not
  decrease", so the best placement against the barycentre targets is the
  isotonic regression of them — exact, O(n), one pass. The first attempt was a
  two-sweep left/right heuristic; it left 35 overlapping cards and came out
  56,600 pixels wide. Pool-adjacent-violators gave zero overlaps at 33,500.
- **Level of detail.** 477 people over nine generations fits the window at
  about 2%. Rather than pretend otherwise, below 30% the cards drop their text
  and switch to a solid fill, so the overview reads as a generational map. The
  faint tints used for cards at reading zoom are invisible at 2%, so each card
  carries a second solid rect shown only in that mode — which also keeps the
  SVG export free of stylesheet-dependent colour.
- **Report, do not refuse.** The validator never gates rendering. Where a file
  breaks a rule the viewer can work around — a one-sided `FAMS`, a dangling
  `WIFE` — it repairs the model to draw the family, records the repair, and
  reports it as an error.
- **Group findings by rule.** The supplied file has 550 dates whose only fault
  is a lower-case month. One report entry with a count beats 550 lines.
- **No dependencies.** The original pulled D3 from a CDN for a tree layout that
  was the wrong shape anyway. Zoom, pan and SVG generation are about 80 lines;
  the layout is its own module. `npm test` needs nothing installed.

## Bugs met along the way

- `Element.append()` returns `undefined`, so `g.append(el('title')).textContent
  = …` threw on the first card. Only the browser caught it — the pure-module
  tests never touch the DOM.
- jsdom does not execute `<script type="module">`. The smoke test lifts the
  page's script out of the HTML and evaluates it against the jsdom window,
  which is the same trick the Postgres tool's smoke test uses.
- Restricting the layout to a subset pulled in every family with *any* member
  in the subset, so a 33-person focused view reported 33 families and drew
  stub links to people who were not on screen. A family now needs at least two
  members present to be a family of that view.
- The parser's repair for a one-sided `FAMS` tested `!f.wife` rather than
  `!f.wifeRef`, so a slot holding a pointer to a missing record counted as
  occupied and the repair never fired — exactly the case in the supplied file,
  where `@F108@` has `WIFE @I13@` and no `@I13@` record.

## The supplied file

477 individuals, 108 families, 22,414 lines, written by Ancestry.com Member
Trees 2025.08. Structurally sound — no unreadable lines, no level jumps, no
duplicate identifiers, correct `HEAD`/`TRLR`. Against 5.5.1 it reports 72
errors across 9 rules, 128 warnings and 820 notes: 23 multimedia records whose
`FILE` has no reference (the images are not in the export), `MARR` and `ADDR`
on individual records, `DATE`/`PLAC` on multimedia records, 17 dates written as
`2003-2005` or `29/12/1903`, one pointer to a record that is not in the file,
and one spouse link recorded from only one end. It draws completely.

## Versions at build time

No runtime dependencies. jsdom 25 for the smoke test. Fonts: Space Grotesk +
IBM Plex Mono via Google Fonts, shared with the rest of the collection.
