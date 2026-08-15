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

## Second pass: sibling grouping and a hover preview

> it's a good start, but the visualisation within a generation seems to mix
> family member groups rather than separating by marriage. can you research
> about how best to display a family tree. also it'd be good to provide a
> details panel when a person is highlighted including additional details

### Diagnosis before the fix

Rather than guess, this was measured first: a script counted, for every
generation row, how many people from the same birth family had an unrelated
person's cluster wedged between them. Against the supplied file: **1,010**
such interlopers. One concrete case — Ann Dean and her six siblings, all
children of the same family record — had 71 unrelated people's cards sitting
between the first sibling and the last, out of a 122-person row.

### The bug

`seedOrder`'s walk is supposed to visit a family's children depth-first, so
siblings get consecutive position-seeds and end up adjacent. It builds a
`Map<personId, cluster>` keyed by string IDs, then recurses:

```js
for (const ch of children) walk(clusterOf.get(ch));
```

`ch` is an `Individual` *object* (`family.childRefs` holds parsed records, not
ID strings) — so `clusterOf.get(ch)` looked up an object key in a map indexed
by strings and always got `undefined`. `walk(undefined)` returns immediately.
The recursion into every family's children had been a silent no-op since the
function was written; every cluster below the very first generation was
actually being seeded by its own raw position in a birth-year-sorted list of
*all* clusters in the component, with no regard for which family it belonged
to. The fix is one token: `clusterOf.get(ch.id)`.

A targeted test now guards this: two sibling groups, connected into one
component only through a grandchild-generation cousin marriage (so no
generation-1 person marries across the families, isolating the recursion bug
from the separate DAG-sharing question below). Reverting the fix makes it
fail; six of the seven other tests it sits beside don't move, because the
small fixtures never had enough depth to exercise the recursion.

After the fix, the same interloper count drops from 1,010 to 54 — the
remainder is a different, much smaller phenomenon (below), not a bug.

### Research

Asked to research how family trees are best displayed before redesigning
anything. The literature converges on the same shape this tool already had in
outline: adapt Reingold–Tilford/Walker tidy-tree layout by treating a married
couple as one compound node (`parent1 + marriage-node + parent2`), centre
their children beneath that compound node, and visit siblings in a single
consistent order on every pass so contiguity isn't accidental. That confirmed
the *design* — generation rows, marriage clusters, DFS-seeded order,
barycentre nudging — was the right shape; the bug had just broken the one
step (the DFS) that made it work.

The same reading surfaced the structural limit that explains the 54 remaining
cases: standard tree-drawing algorithms assume one parent per node, a single
root, and no cycles, none of which hold for a genealogy, where a person is
simultaneously a *child* in their birth family and a *parent* in their own —
a DAG, not a tree. A married person's cluster can only be "claimed" by one
side's depth-first walk; keeping them contiguous with their birth siblings
and their spouse's birth siblings at once is only possible when the two
families happen to sit next to each other already. Measuring it precisely:
of 477 people, 5 (1.0%, across 4 of 61 same-row sibling groups) end up
separated from a sibling this way. That's a documented, tested limit, not a
bug — see the README's Caveats.

Sources consulted: [Drawing Genealogy Graphs, Part 1](https://tbt.qkation.com/posts/draw-tree-using-reingold-tilford-algorithm/)
(the compound marriage-node adaptation of Reingold–Tilford); [Efficient
Algorithms for Drawing Large Genealogy Trees](https://repositum.tuwien.at/bitstream/20.500.12708/220457/1/Racine%20Florian%20-%202025%20-%20Efficient%20Algorithms%20for%20Drawing%20Large%20Genealogy%20Trees.pdf)
(2025 thesis on why hierarchical tree algorithms' assumptions don't hold for
genealogical DAGs); general search across genealogical graph-layout
literature (TimeNets, GenealogyVis, and others) confirming marriage-node
clustering and consistent traversal order as the standard approach.

### Hover preview

Added a lightweight peek card that appears on hover — name, dates, birth and
death place, occupation, parents, spouse(s), child count — so browsing the
tree doesn't require a click per person. The existing click-through drawer
stays for the full picture (every event, every source, every note); the peek
is delegated off two `pointerover`/`pointerout` listeners on the SVG rather
than per-card wiring, since those events (unlike `mouseenter`/`mouseleave`)
bubble and support `closest()`. The detail drawer gained two small additions
in the same pass: age at death when both years are known, and — in a focused
view — how many generations the selected person sits from the one you
focused on.

## Versions at build time

No runtime dependencies. jsdom 25 for the smoke test. Fonts: Space Grotesk +
IBM Plex Mono via Google Fonts, shared with the rest of the collection.
