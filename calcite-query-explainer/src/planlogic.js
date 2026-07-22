// Parsing and annotation for Apache Calcite plan text.
//
// Calcite's `EXPLAIN PLAN ... FOR` prints one operator per line, indented two
// spaces per level of depth, e.g.
//
//   EnumerableAggregate(group=[{3}], HEADCOUNT=[COUNT()])
//     EnumerableMergeJoin(condition=[=($0, $2)], joinType=[inner])
//       EnumerableTableScan(table=[[EMP]])
//       EnumerableTableScan(table=[[DEPT]])
//
// This module turns that into a tree and annotates each operator with a
// category (for colour) and a plain-English description. Pure and dependency
// free, so it is inlined into the page at build time and unit-tested directly.

// Operator categories → colour key. The colour variables (--cat-*) are shared
// with the rest of the site's theme.
const CATEGORIES = {
  scan: { label: "Scan", css: "--cat-scan" },
  join: { label: "Join", css: "--cat-join" },
  aggregate: { label: "Aggregate", css: "--cat-aggregate" },
  sort: { label: "Sort / Limit", css: "--cat-sort" },
  project: { label: "Project / Filter", css: "--cat-combine" },
  set: { label: "Set op", css: "--cat-buffer" },
  values: { label: "Values", css: "--cat-control" },
  other: { label: "Other", css: "--cat-control" },
};

// Known operators. The base name (with the Logical/Enumerable/Bindable prefix
// stripped) maps to a category and a description. Both planning stages share
// this table, so LogicalJoin and EnumerableMergeJoin are annotated coherently.
const OPERATORS = {
  TableScan: { cat: "scan", desc: "Reads every row of a registered table." },
  Values: { cat: "values", desc: "Emits a fixed set of literal rows — no table involved." },

  Join: { cat: "join", desc: "Joins two inputs on a condition." },
  MergeJoin: { cat: "join", desc: "Join that relies on both inputs being sorted on the key, matching them in one pass." },
  HashJoin: { cat: "join", desc: "Builds a hash table from one input and probes it with the other." },
  NestedLoopJoin: { cat: "join", desc: "For each left row, scans the right input — used when no equi-key is available." },
  Correlate: { cat: "join", desc: "Runs the right input once per left row, passing values in (a correlated subquery)." },

  Aggregate: { cat: "aggregate", desc: "Groups rows and computes aggregates (COUNT, SUM, AVG, …)." },

  Sort: { cat: "sort", desc: "Orders rows; also carries LIMIT/OFFSET when present." },
  Limit: { cat: "sort", desc: "Caps the number of rows (LIMIT/OFFSET)." },
  SortLimit: { cat: "sort", desc: "Orders rows and applies LIMIT/OFFSET together." },
  EnumerableLimitSort: { cat: "sort", desc: "Top-N: keeps only the rows needed to satisfy ORDER BY + LIMIT." },

  Project: { cat: "project", desc: "Selects and computes the output columns." },
  Calc: { cat: "project", desc: "Fused project + filter — the optimizer's combined row-shaping operator." },
  Filter: { cat: "project", desc: "Drops rows that fail a predicate (WHERE / HAVING)." },

  Union: { cat: "set", desc: "Concatenates inputs (UNION / UNION ALL)." },
  Minus: { cat: "set", desc: "Rows in the first input that are not in the others (EXCEPT)." },
  Intersect: { cat: "set", desc: "Rows present in every input (INTERSECT)." },

  Window: { cat: "aggregate", desc: "Computes window functions (OVER …)." },
  Uncollect: { cat: "other", desc: "Expands an array/multiset column into rows." },
  TableFunctionScan: { cat: "other", desc: "Invokes a table-valued function." },
};

// Engine prefixes stripped to find the base operator name.
const PREFIXES = ["Enumerable", "Logical", "Bindable", "Interpreter", "Jdbc"];

function baseName(op) {
  for (const p of PREFIXES) {
    if (op.startsWith(p) && op.length > p.length) return op.slice(p.length);
  }
  return op;
}

// Split one plan line into { op, detail }. The operator name runs up to the
// first "(", and the remainder (without the outer parens) is the detail.
function splitLine(text) {
  const paren = text.indexOf("(");
  if (paren === -1) return { op: text.trim(), detail: "" };
  const op = text.slice(0, paren).trim();
  let detail = text.slice(paren + 1).trim();
  if (detail.endsWith(")")) detail = detail.slice(0, -1);
  return { op, detail };
}

function annotate(op) {
  const base = baseName(op);
  const known = OPERATORS[base];
  const cat = known ? known.cat : "other";
  return {
    category: cat,
    categoryLabel: CATEGORIES[cat].label,
    categoryCss: CATEGORIES[cat].css,
    description: known ? known.desc : null,
    known: !!known,
  };
}

// Net bracket balance of a line: (opened − closed) across () {} [].
function bracketDelta(s) {
  let d = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "(" || c === "{" || c === "[") d++;
    else if (c === ")" || c === "}" || c === "]") d--;
  }
  return d;
}

// Parse indented plan text into a tree of nodes. Returns the root node, or null
// if the text has no operator lines. Each node:
//   { op, base, detail, depth, category, categoryLabel, categoryCss,
//     description, known, children: [] }
//
// A node's detail can itself contain a multi-line block — Calcite renders a
// scalar subquery inline as `$SCALAR_QUERY({ …nested plan… })`. Such lines leave
// brackets open, so any following lines are folded into the current node's
// detail until the brackets balance again, rather than being mistaken for
// sibling operators.
function parsePlan(planText) {
  const lines = String(planText || "").replace(/\r/g, "").split("\n")
    .filter((l) => l.trim().length > 0);
  if (lines.length === 0) return null;

  const root = { children: [] };
  const stack = [{ depth: -1, node: root }];
  let carry = 0;     // unbalanced brackets left open by earlier lines
  let lastNode = null;

  for (const line of lines) {
    if (carry > 0) {
      // Continuation of the previous operator's detail (an inlined subquery).
      if (lastNode) lastNode.detail += "\n" + line.trim();
      carry += bracketDelta(line);
      continue;
    }

    const indent = line.length - line.replace(/^ +/, "").length;
    const depth = indent >> 1; // two spaces per level
    const { op, detail } = splitLine(line.trim());
    const a = annotate(op);
    const node = {
      op,
      base: baseName(op),
      detail,
      depth,
      category: a.category,
      categoryLabel: a.categoryLabel,
      categoryCss: a.categoryCss,
      description: a.description,
      known: a.known,
      children: [],
    };
    while (stack.length > 1 && stack[stack.length - 1].depth >= depth) stack.pop();
    stack[stack.length - 1].node.children.push(node);
    stack.push({ depth, node });
    lastNode = node;
    carry += bracketDelta(line);
  }

  return root.children.length === 1 ? root.children[0] : { synthetic: true, children: root.children };
}

// Walk a parsed tree, calling fn(node, depth) in pre-order.
function walk(node, fn, depth = 0) {
  if (!node) return;
  if (!node.synthetic) fn(node, depth);
  const childDepth = node.synthetic ? depth : depth + 1;
  for (const c of node.children) walk(c, fn, childDepth);
}

// Distinct operators that appear in a plan but aren't in the OPERATORS table.
// Used by the test suite to flag missing documentation.
function unknownOperators(planText) {
  const missing = new Set();
  walk(parsePlan(planText), (n) => { if (!n.known) missing.add(n.base); });
  return [...missing];
}

// A compact list of the operator-name differences between two plans, so the UI
// can say what the optimizer changed (e.g. "Join → EnumerableMergeJoin").
function planDiff(logicalText, physicalText) {
  const count = (text) => {
    const m = {};
    walk(parsePlan(text), (n) => { m[n.base] = (m[n.base] || 0) + 1; });
    return m;
  };
  const before = count(logicalText);
  const after = count(physicalText);
  const added = [];
  const removed = [];
  for (const k of Object.keys(after)) if (!before[k]) added.push(k);
  for (const k of Object.keys(before)) if (!after[k]) removed.push(k);
  return { added, removed };
}

export {
  CATEGORIES,
  OPERATORS,
  baseName,
  splitLine,
  annotate,
  parsePlan,
  walk,
  unknownOperators,
  planDiff,
};
