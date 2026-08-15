// Lays out a whole lineage-linked graph — not a single descendant tree.
//
// A GEDCOM is a graph, not a tree: people remarry, cousins marry each other,
// and a file usually holds several unconnected families. Walking descendants
// from one root draws a fraction of it. This does the general thing:
//
//   1. every individual gets a generation, by relaxation over the parent links
//   2. individuals married within a generation are grouped into a cluster, so
//      couples (and second and third marriages) always sit side by side
//   3. clusters are ordered per generation by a depth-first walk, then nudged
//      toward their relatives by barycentre passes with separation constraints
//   4. disconnected components are laid out one after another
//
// The result places every person exactly once and every family link explicitly.

const CARD_W = 152;
const CARD_H = 62;
const MATE_GAP = 30;      // between two cards of a couple (the marriage link sits here)
const CLUSTER_GAP = 46;   // between neighbouring clusters in a row
const ROW_GAP = 104;      // vertical space between card rows
const COMPONENT_GAP = 130;
const ROW_H = CARD_H + ROW_GAP;

// ---- Generations ------------------------------------------------------------

// Monotone relaxation: a child is at least one row below its parents, and
// spouses share a row. Both rules only ever push a person downwards, so this
// terminates even on files where a marriage links two different generations.
function assignGenerations(people, families) {
  const gen = new Map();
  for (const p of people) gen.set(p.id, 0);

  const famList = [...families];
  const limit = Math.max(20, people.length + 4);
  for (let pass = 0; pass < limit; pass++) {
    let moved = false;
    for (const f of famList) {
      const spouses = f.spouses.filter((s) => gen.has(s.id));
      let g = 0;
      for (const s of spouses) g = Math.max(g, gen.get(s.id));
      for (const s of spouses) if (gen.get(s.id) < g) { gen.set(s.id, g); moved = true; }
      for (const c of f.childRefs) {
        if (!gen.has(c.id)) continue;
        if (gen.get(c.id) < g + 1) { gen.set(c.id, g + 1); moved = true; }
      }
    }
    if (!moved) break;
  }
  return gen;
}

// ---- Components -------------------------------------------------------------

function findComponents(people, families) {
  const parent = new Map(people.map((p) => [p.id, p.id]));
  const find = (a) => { while (parent.get(a) !== a) { parent.set(a, parent.get(parent.get(a))); a = parent.get(a); } return a; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };

  for (const f of families) {
    const members = [...f.spouses, ...f.childRefs].filter((m) => parent.has(m.id)).map((m) => m.id);
    for (let i = 1; i < members.length; i++) union(members[0], members[i]);
  }
  const groups = new Map();
  for (const p of people) {
    const root = find(p.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(p);
  }
  return [...groups.values()];
}

// ---- Clusters (a run of people married within one generation) ---------------

function buildClusters(people, families, gen) {
  const inSet = new Set(people.map((p) => p.id));
  const mates = new Map(people.map((p) => [p.id, new Set()]));
  for (const f of families) {
    const s = f.spouses.filter((x) => inSet.has(x.id));
    for (let i = 0; i < s.length; i++) {
      for (let j = i + 1; j < s.length; j++) {
        if (gen.get(s[i].id) !== gen.get(s[j].id)) continue;
        mates.get(s[i].id).add(s[j].id);
        mates.get(s[j].id).add(s[i].id);
      }
    }
  }

  const byId = new Map(people.map((p) => [p.id, p]));
  const seen = new Set();
  const clusters = [];

  for (const p of people) {
    if (seen.has(p.id)) continue;
    // Collect the connected marriage group, then walk it as a chain so the
    // most-married person ends up with a partner on each side.
    const group = [];
    const stack = [p.id];
    seen.add(p.id);
    while (stack.length) {
      const id = stack.pop();
      group.push(id);
      for (const m of mates.get(id)) if (!seen.has(m)) { seen.add(m); stack.push(m); }
    }
    clusters.push({
      id: 'C' + clusters.length,
      gen: gen.get(p.id),
      members: orderChain(group, mates, byId).map((id) => byId.get(id)),
      x: 0, seed: 0,
    });
  }

  for (const c of clusters) {
    c.width = c.members.length * CARD_W + (c.members.length - 1) * MATE_GAP;
    c.index = new Map(c.members.map((m, i) => [m.id, i]));
  }
  return clusters;
}

// Greedy chain through the marriage sub-graph: start at an end (or the least
// married person), then always step to the neighbour with the fewest options
// left, which keeps a serial remarrier in the middle of their spouses.
function orderChain(ids, mates, byId) {
  if (ids.length <= 1) return ids;
  const remaining = new Set(ids);
  const degree = (id) => [...mates.get(id)].filter((m) => remaining.has(m)).length;
  let start = ids[0];
  for (const id of ids) {
    if (degree(id) < degree(start)) start = id;
    else if (degree(id) === degree(start) && birthKey(byId.get(id)) < birthKey(byId.get(start))) start = id;
  }
  const out = [];
  let cur = start;
  while (cur) {
    out.push(cur);
    remaining.delete(cur);
    const next = [...mates.get(cur)]
      .filter((m) => remaining.has(m))
      .sort((a, b) => degree(a) - degree(b) || birthKey(byId.get(a)) - birthKey(byId.get(b)))[0];
    cur = next || null;
  }
  // Anything unreachable (a marriage group that is not a simple chain) follows.
  for (const id of ids) if (remaining.has(id)) { out.push(id); remaining.delete(id); }
  return out;
}

const birthKey = (p) => (p && p.birthYear !== null && p.birthYear !== undefined ? p.birthYear : 9999);

// ---- Ordering seed ----------------------------------------------------------

// A depth-first walk down the family links, so siblings stay together and a
// couple's children sit under them before anything else claims the space.
function seedOrder(clusters, families, gen) {
  const clusterOf = new Map();
  for (const c of clusters) for (const m of c.members) clusterOf.set(m.id, c);

  const childFamilies = new Map(); // cluster -> families it is the parent side of
  for (const f of families) {
    for (const s of f.spouses) {
      const c = clusterOf.get(s.id);
      if (!c) continue;
      if (!childFamilies.has(c)) childFamilies.set(c, new Set());
      childFamilies.get(c).add(f);
    }
  }

  let counter = 0;
  const visited = new Set();
  const walk = (c) => {
    if (!c || visited.has(c)) return;
    visited.add(c);
    c.seed = counter++;
    const fams = [...(childFamilies.get(c) || [])]
      .sort((a, b) => (a.marriageYear ?? 9999) - (b.marriageYear ?? 9999));
    for (const f of fams) {
      const children = [...f.childRefs].sort((a, b) => birthKey(a) - birthKey(b));
      for (const ch of children) walk(clusterOf.get(ch));
    }
  };

  // Start from the oldest generations so the walk runs downwards.
  const roots = [...clusters].sort((a, b) =>
    a.gen - b.gen ||
    Math.min(...a.members.map(birthKey)) - Math.min(...b.members.map(birthKey)) ||
    a.members.length - b.members.length);
  for (const c of roots) walk(c);
  return clusterOf;
}

// ---- Horizontal placement ---------------------------------------------------

// Pool-adjacent-violators: the least-squares fit to `v` that is non-decreasing.
// O(n), and exact — no iteration to tune.
function isotonic(v) {
  const blocks = []; // { sum, len }
  for (let i = 0; i < v.length; i++) {
    let b = { sum: v[i], len: 1 };
    while (blocks.length) {
      const prev = blocks[blocks.length - 1];
      if (prev.sum / prev.len <= b.sum / b.len) break;
      blocks.pop();
      b = { sum: prev.sum + b.sum, len: prev.len + b.len };
    }
    blocks.push(b);
  }
  const out = [];
  for (const b of blocks) {
    const mean = b.sum / b.len;
    for (let k = 0; k < b.len; k++) out.push(mean);
  }
  return out;
}

// Places one row of clusters as close to `desired` as the ordering and the
// minimum gap allow. Substituting z[i] = x[i] - offset[i] turns "no overlap,
// keep the order" into "z must not decrease", so the best placement is the
// isotonic regression of the desired positions — optimal in one pass, and it
// compacts slack out of the row instead of only ever pushing rightwards.
function placeRow(row, desired) {
  if (!row.length) return;
  const offsets = new Array(row.length);
  let acc = 0;
  for (let i = 0; i < row.length; i++) {
    offsets[i] = acc;
    acc += row[i].width + CLUSTER_GAP;
  }
  const z = isotonic(row.map((c, i) => (desired ? desired[i] : c.x) - offsets[i]));
  for (let i = 0; i < row.length; i++) row[i].x = z[i] + offsets[i];
}

function barycentrePasses(rows, clusters, families, clusterOf, passes) {
  const parentsOf = new Map(clusters.map((c) => [c, new Set()]));
  const childrenOf = new Map(clusters.map((c) => [c, new Set()]));
  for (const f of families) {
    const parentClusters = new Set(f.spouses.map((s) => clusterOf.get(s.id)).filter(Boolean));
    const childClusters = new Set(f.childRefs.map((c) => clusterOf.get(c.id)).filter(Boolean));
    for (const pc of parentClusters) {
      for (const cc of childClusters) {
        if (pc === cc) continue;
        childrenOf.get(pc).add(cc);
        parentsOf.get(cc).add(pc);
      }
    }
  }
  const centre = (c) => c.x + c.width / 2;
  const meanOf = (set) => {
    if (!set.size) return null;
    let sum = 0;
    for (const c of set) sum += centre(c);
    return sum / set.size;
  };

  const genList = [...rows.keys()].sort((a, b) => a - b);
  for (let pass = 0; pass < passes; pass++) {
    const down = pass % 2 === 0;
    const order = down ? genList : [...genList].reverse();
    for (const g of order) {
      const row = rows.get(g);
      const desired = row.map((c) => {
        const m = meanOf(down ? parentsOf.get(c) : childrenOf.get(c));
        return (m === null ? centre(c) : m) - c.width / 2;
      });
      placeRow(row, desired);
    }
  }
}

// ---- Entry point ------------------------------------------------------------

// `individuals` and `families` may be the whole file or any subset; the subset
// is closed over families automatically (a family is drawn when at least one
// of its members is in the subset).
function layoutGraph(individuals, families, options = {}) {
  const people = [...individuals.values ? individuals.values() : individuals];
  if (!people.length) return emptyLayout();
  const inSet = new Set(people.map((p) => p.id));
  const famList = [...(families.values ? families.values() : families)]
    .filter((f) => f.spouses.some((s) => inSet.has(s.id)) || f.childRefs.some((c) => inSet.has(c.id)));

  const gen = assignGenerations(people, famList);
  const components = findComponents(people, famList);
  // Bigger families first, and singletons last, so the canvas reads left to right.
  components.sort((a, b) => b.length - a.length || birthKey(a[0]) - birthKey(b[0]));

  const allClusters = [];
  const allNodes = [];
  const allFamilyNodes = [];
  let offsetX = 0;

  for (const comp of components) {
    const compFams = famList.filter((f) =>
      [...f.spouses, ...f.childRefs].some((m) => comp.some((p) => p.id === m.id)));
    const clusters = buildClusters(comp, compFams, gen);
    const clusterOf = seedOrder(clusters, compFams, gen);

    const rows = new Map();
    for (const c of clusters) {
      if (!rows.has(c.gen)) rows.set(c.gen, []);
      rows.get(c.gen).push(c);
    }
    for (const row of rows.values()) {
      row.sort((a, b) => a.seed - b.seed);
      let x = 0;
      for (const c of row) { c.x = x; x += c.width + CLUSTER_GAP; }
    }
    barycentrePasses(rows, clusters, compFams, clusterOf, options.passes ?? 8);

    // Normalise this component to start at the running offset.
    let minX = Infinity, maxX = -Infinity;
    for (const c of clusters) { minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x + c.width); }
    const shift = offsetX - minX;
    for (const c of clusters) c.x += shift;
    offsetX += (maxX - minX) + COMPONENT_GAP;

    for (const c of clusters) {
      allClusters.push(c);
      c.members.forEach((m, i) => {
        allNodes.push({
          person: m,
          id: m.id,
          gen: c.gen,
          x: c.x + i * (CARD_W + MATE_GAP),
          y: c.gen * ROW_H,
          w: CARD_W, h: CARD_H,
          cluster: c,
        });
      });
    }
    for (const f of compFams) allFamilyNodes.push(f);
  }

  const nodeById = new Map(allNodes.map((n) => [n.id, n]));

  // Family junctions and the links that hang off them.
  const familyNodes = [];
  for (const f of allFamilyNodes) {
    const spouseNodes = f.spouses.map((s) => nodeById.get(s.id)).filter(Boolean);
    const childNodes = f.childRefs.map((c) => nodeById.get(c.id)).filter(Boolean);

    // In a focused view a family may have only one member on screen; it then
    // has no link to draw, so it is not a family of this view.
    if (spouseNodes.length + childNodes.length < 2) continue;

    const anchorSource = spouseNodes.length ? spouseNodes : childNodes;
    const jx = anchorSource.reduce((s, n) => s + n.x + n.w / 2, 0) / anchorSource.length;
    const jy = spouseNodes.length
      ? Math.max(...spouseNodes.map((n) => n.y)) + CARD_H
      : Math.min(...childNodes.map((n) => n.y)) - ROW_GAP / 2;

    // Adjacent couple: the marriage link is the short run between the cards.
    let mate = null;
    if (spouseNodes.length === 2) {
      const [a, b] = spouseNodes.slice().sort((p, q) => p.x - q.x);
      mate = { x1: a.x + a.w, y1: a.y + a.h / 2, x2: b.x, y2: b.y + b.h / 2, adjacent: Math.abs(b.x - (a.x + a.w) - MATE_GAP) < 1 };
    }

    familyNodes.push({
      family: f,
      id: f.id,
      x: jx,
      y: jy,
      spouseNodes,
      childNodes,
      mate,
      // The horizontal sibling bar sits midway between the two rows.
      barY: childNodes.length ? Math.min(...childNodes.map((n) => n.y)) - ROW_GAP / 2 : jy,
    });
  }

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const n of allNodes) {
    minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x + n.w);
    minY = Math.min(minY, n.y); maxY = Math.max(maxY, n.y + n.h);
  }

  const generations = new Map();
  for (const n of allNodes) generations.set(n.gen, (generations.get(n.gen) || 0) + 1);

  return {
    nodes: allNodes,
    nodeById,
    familyNodes,
    clusters: allClusters,
    components: components.length,
    generations,
    bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
    metrics: { CARD_W, CARD_H, MATE_GAP, ROW_GAP, ROW_H },
  };
}

function emptyLayout() {
  return {
    nodes: [], nodeById: new Map(), familyNodes: [], clusters: [], components: 0,
    generations: new Map(), bounds: { x: 0, y: 0, width: 0, height: 0 },
    metrics: { CARD_W, CARD_H, MATE_GAP, ROW_GAP, ROW_H },
  };
}

// ---- Subset selection -------------------------------------------------------

// Everyone within reach of `startId`: `up` generations of ancestors, `down`
// generations of descendants, each ancestor's own children (so aunts, uncles
// and cousins appear rather than a bare pedigree line), and the spouses that
// make those families whole.
function relatedSubset(individuals, startId, up = Infinity, down = Infinity) {
  const picked = new Map();
  const start = individuals.get(startId);
  if (!start) return picked;

  const keep = (p) => { if (p) picked.set(p.id, p); };
  const climbed = new Map();
  const descended = new Map();

  const descend = (p, depth) => {
    if (depth > down) return;
    if ((descended.get(p.id) ?? -1) >= down - depth) return;
    descended.set(p.id, down - depth);
    keep(p);
    for (const f of p.spouseFamilies) {
      f.spouses.forEach(keep);
      for (const c of f.childRefs) descend(c, depth + 1);
    }
  };

  const climb = (p, depth) => {
    if (depth > up) return;
    if ((climbed.get(p.id) ?? -1) >= up - depth) return;
    climbed.set(p.id, up - depth);
    keep(p);
    for (const f of p.parentFamilies) {
      for (const s of f.spouses) { keep(s); climb(s, depth + 1); }
      // The siblings of the line, and their families one step on.
      for (const c of f.childRefs) descend(c, Math.max(0, down - 1));
    }
  };

  climb(start, 0);
  descend(start, 0);
  return picked;
}

export { layoutGraph, relatedSubset, assignGenerations, findComponents, CARD_W, CARD_H, MATE_GAP, ROW_GAP, ROW_H };
