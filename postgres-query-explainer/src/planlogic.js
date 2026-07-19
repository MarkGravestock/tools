// ---- Plan annotation logic (pure, no DOM) ----------------------------------
// Consumes one plan object from EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON).

const NODE_DOCS = {
  'Seq Scan': {
    what: 'Reads every row in the table, top to bottom.',
    detail: 'No index is used. Cost grows linearly with table size, but for small tables or queries that need most rows this is the cheapest option — indexes are not free to traverse.',
  },
  'Index Scan': {
    what: 'Walks a B-tree index, then fetches each matching row from the table.',
    detail: 'Each index hit costs an extra trip to the heap (the table) to fetch the full row and check visibility. Efficient for a small share of rows; for large shares the random heap access can be slower than a sequential scan.',
  },
  'Index Only Scan': {
    what: 'Answers the query from the index alone — the table is (mostly) never touched.',
    detail: 'Possible when every column the query needs is in the index. "Heap Fetches" counts rows where Postgres still had to visit the table because the visibility map wasn\u2019t up to date — VACUUM keeps that number low.',
  },
  'Bitmap Index Scan': {
    what: 'Scans an index and builds an in-memory bitmap of matching row locations.',
    detail: 'Produces page positions rather than rows. Feeds a Bitmap Heap Scan above it, and multiple bitmaps can be combined with BitmapOr / BitmapAnd.',
  },
  'Bitmap Heap Scan': {
    what: 'Fetches table pages in physical order using a bitmap built below it.',
    detail: 'A middle ground between index scan and sequential scan: index selectivity, but heap pages read in order (fewer random reads). If the bitmap outgrows work_mem it degrades to "lossy" mode, tracking whole pages and re-checking the condition per row.',
  },
  'BitmapOr': {
    what: 'Combines two or more bitmaps with OR.',
    detail: 'This is how Postgres uses several single-column indexes to satisfy an OR condition — something a single B-tree scan can\u2019t do.',
  },
  'BitmapAnd': {
    what: 'Intersects two or more bitmaps with AND.',
    detail: 'Lets Postgres combine separate indexes on different columns instead of requiring one composite index.',
  },
  'Tid Scan': {
    what: 'Fetches rows directly by physical position (ctid).',
    detail: 'The fastest possible access path — no index, no scan, just "go to page X, item Y". Rarely seen outside of maintenance queries because ctids change when rows are updated or the table is vacuumed.',
  },
  'Nested Loop': {
    what: 'For each row from the outer (first) child, runs the inner (second) child to find matches.',
    detail: 'Ideal when the outer side is small and the inner side has a fast parameterised lookup (usually an index). Cost is outer rows \u00d7 inner lookup cost, so it degrades badly if the outer estimate is wrong.',
  },
  'Hash Join': {
    what: 'Builds a hash table from one input, then probes it with rows from the other.',
    detail: 'The workhorse for joining large inputs on equality. The smaller input (under the Hash node) is loaded into memory first; if it exceeds work_mem it splits into batches spilled to disk.',
  },
  'Merge Join': {
    what: 'Merges two inputs that are both sorted on the join key.',
    detail: 'Reads both sides once, in step. Chosen when sorted input is available cheaply (e.g. from indexes) or the inputs are huge. May need explicit Sort nodes below it if no sorted path exists.',
  },
  'Hash': {
    what: 'Loads its child\u2019s rows into an in-memory hash table.',
    detail: 'The build side of a Hash Join. "Batches: 1" means it all fit in work_mem; more than one batch means it spilled to disk and rows were written and re-read.',
  },
  'Materialize': {
    what: 'Buffers its child\u2019s output so it can be re-read cheaply.',
    detail: 'Usually appears under the inner side of a join that will be rescanned many times, saving Postgres from recomputing the child for every outer row.',
  },
  'Memoize': {
    what: 'Caches inner-side results keyed by the join parameter.',
    detail: 'When the outer side of a nested loop repeats the same key, Memoize serves the cached rows instead of re-running the index lookup. The hit/miss ratio below tells you whether the cache paid off.',
  },
  'Sort': {
    what: 'Sorts its input.',
    detail: 'The method matters: "quicksort" ran in memory; "top-N heapsort" kept only the N rows a LIMIT needs; "external merge" spilled to disk because the data exceeded work_mem.',
  },
  'Incremental Sort': {
    what: 'Finishes a sort that\u2019s already partly done.',
    detail: 'The input arrives sorted on a prefix of the requested keys (e.g. from an index), so Postgres only sorts within each group of equal prefix values. Much cheaper than a full sort and starts streaming rows sooner.',
  },
  'Aggregate': {
    what: 'Computes aggregate functions (count, sum, \u2026).',
    detail: '',
  },
  'WindowAgg': {
    what: 'Computes window functions over partitions of ordered rows.',
    detail: 'Requires its input ordered by PARTITION BY / ORDER BY keys, which is why a Sort or Incremental Sort usually sits beneath it. Unlike GROUP BY, every input row is kept.',
  },
  'Unique': {
    what: 'Removes adjacent duplicate rows from sorted input.',
    detail: 'The sorted-input version of DISTINCT — cheap because duplicates arrive next to each other. (The alternative is hashing via HashAggregate.)',
  },
  'Limit': {
    what: 'Stops after emitting the requested number of rows.',
    detail: 'Powerful because it lets the whole plan below stop early — nodes beneath a Limit often show far fewer actual rows than planned, which here is by design, not a mis-estimate.',
  },
  'Append': {
    what: 'Concatenates the output of several children.',
    detail: 'Appears for UNION ALL and for partitioned tables, where each surviving partition is one child. Partitions the planner could prove irrelevant are pruned and never appear.',
  },
  'Merge Append': {
    what: 'Merges several sorted children, preserving order.',
    detail: 'Lets a partitioned table deliver globally ordered output without re-sorting — each partition\u2019s index provides order and this node interleaves them.',
  },
  'Recursive Union': {
    what: 'Drives a WITH RECURSIVE query.',
    detail: 'Runs the non-recursive term once, then repeats the recursive term against the previous iteration\u2019s rows (the "working table") until no new rows appear.',
  },
  'WorkTable Scan': {
    what: 'Reads the previous iteration\u2019s rows inside a recursive CTE.',
    detail: 'The recursive term\u2019s self-reference. Its actual loop count equals the number of iterations the recursion ran.',
  },
  'CTE Scan': {
    what: 'Reads rows from a materialised WITH (CTE) result.',
    detail: 'The CTE below was computed once and stored; this node reads that store. Since PostgreSQL 12, CTEs referenced once are inlined instead unless you write AS MATERIALIZED.',
  },
  'Subquery Scan': {
    what: 'Reads rows from a sub-select that couldn\u2019t be flattened into the outer query.',
    detail: 'Often optimised away entirely; when visible it usually just relabels columns from the child plan.',
  },
  'Function Scan': {
    what: 'Treats a function\u2019s result set as a table.',
    detail: 'generate_series, unnest, jsonb_to_recordset and friends. The planner has limited insight into how many rows a function returns, so estimates here are often guesses (default: 1000 for set-returning SQL functions, or the ROWS clause of the function definition).',
  },
  'Values Scan': {
    what: 'Reads rows from a literal VALUES list.',
    detail: 'An inline table written directly in the query — handy for joining a small fixed set of values against real tables.',
  },
  'Result': {
    what: 'Produces a computed row, or gates its child with a one-time filter.',
    detail: 'Appears for expressions needing no table, and for "one-time filters" the executor can evaluate once instead of per row.',
  },
  'ProjectSet': {
    what: 'Expands set-returning functions in the SELECT list.',
    detail: 'Each input row can fan out into many output rows (e.g. unnest in the select list).',
  },
  'SetOp': {
    what: 'Computes INTERSECT or EXCEPT.',
    detail: 'Tags rows by which input they came from, then compares counts per distinct row — hashed or sorted, like Aggregate.',
  },
  'Group': {
    what: 'Groups adjacent equal rows from sorted input (GROUP BY without aggregates).',
    detail: '',
  },
  'LockRows': {
    what: 'Locks each row as it flows through (SELECT \u2026 FOR UPDATE / SHARE).',
    detail: '',
  },
  'Gather': {
    what: 'Collects rows from parallel worker processes.',
    detail: 'The plan fragment below runs simultaneously in several worker processes plus the leader; Gather merges their output streams in arrival order. (The in-browser PGlite build is single-process, so this node only appears against a real server.)',
  },
  'Gather Merge': {
    what: 'Collects rows from parallel workers, preserving sort order.',
    detail: 'Like Gather, but each worker’s output is sorted and this node interleaves the streams to keep the overall order — avoiding a full re-sort above.',
  },
  'Foreign Scan': {
    what: 'Reads rows from a foreign table via a foreign data wrapper.',
    detail: 'The actual work happens in an external system (another Postgres via postgres_fdw, a file, another database). Costs and row counts depend on what the FDW reports, and conditions may or may not be pushed down to the remote side.',
  },
  'Sample Scan': {
    what: 'Reads a random sample of a table (TABLESAMPLE).',
    detail: 'BERNOULLI samples individual rows (visits every page); SYSTEM samples whole pages (much cheaper, less uniform).',
  },
  'Table Function Scan': {
    what: 'Reads rows produced by a table function such as XMLTABLE.',
    detail: '',
  },
  'Named Tuplestore Scan': {
    what: 'Reads a named row store, such as a trigger’s transition table.',
    detail: 'Appears in AFTER ... REFERENCING OLD/NEW TABLE trigger functions, reading the set of rows the triggering statement touched.',
  },
  'Custom Scan': {
    what: 'A scan provided by an extension.',
    detail: 'Extensions (Citus, TimescaleDB, columnar stores, …) can inject their own plan node types; the semantics depend on the extension.',
  },
  'ModifyTable': {
    what: 'Applies INSERT / UPDATE / DELETE / MERGE changes produced by the plan below.',
    detail: '',
  },
};

// Groups node types into families for the colour key. Keys match --cat-* CSS vars.
const NODE_CATEGORY = {
  'Seq Scan': 'scan', 'Index Scan': 'scan', 'Index Only Scan': 'scan',
  'Bitmap Index Scan': 'scan', 'Bitmap Heap Scan': 'scan', 'BitmapOr': 'scan', 'BitmapAnd': 'scan',
  'Tid Scan': 'scan', 'CTE Scan': 'scan', 'Subquery Scan': 'scan', 'Function Scan': 'scan',
  'Values Scan': 'scan', 'WorkTable Scan': 'scan', 'Sample Scan': 'scan', 'Foreign Scan': 'scan',
  'Named Tuplestore Scan': 'scan', 'Table Function Scan': 'scan', 'Custom Scan': 'scan',
  'Nested Loop': 'join', 'Hash Join': 'join', 'Merge Join': 'join',
  'Aggregate': 'aggregate', 'WindowAgg': 'aggregate', 'Group': 'aggregate', 'SetOp': 'aggregate', 'Unique': 'aggregate',
  'Sort': 'sort', 'Incremental Sort': 'sort',
  'Append': 'combine', 'Merge Append': 'combine', 'Recursive Union': 'combine', 'Gather': 'combine', 'Gather Merge': 'combine',
  'Hash': 'buffer', 'Materialize': 'buffer', 'Memoize': 'buffer',
  'ModifyTable': 'modify', 'LockRows': 'modify',
  'Limit': 'control', 'Result': 'control', 'ProjectSet': 'control',
};

// Ordered legend metadata: [key, label, description].
const CATEGORY_META = [
  ['scan', 'Scan', 'Reads rows from a table, index, CTE, or other source'],
  ['join', 'Join', 'Combines two inputs (nested loop, hash, or merge)'],
  ['aggregate', 'Aggregate / group', 'Groups rows and computes aggregates or DISTINCT'],
  ['sort', 'Sort', 'Orders rows'],
  ['combine', 'Combine', 'Appends, merges, or gathers several inputs'],
  ['buffer', 'Materialize / cache', 'Buffers or caches rows so they can be re-read'],
  ['modify', 'Modify', 'Writes rows (INSERT/UPDATE/DELETE) or takes row locks'],
  ['control', 'Control', 'Limit, result, and other flow-control steps'],
];

function nodeCategory(nodeType) {
  return NODE_CATEGORY[nodeType] || 'control';
}

const AGG_STRATEGY = {
  Plain: 'A single aggregate over all input — no GROUP BY, so one result row.',
  Hashed: 'HashAggregate: builds a hash table keyed by the GROUP BY columns. Input order doesn\u2019t matter, but the whole set of groups must fit in memory (or spill in batches).',
  Sorted: 'GroupAggregate: input arrives sorted on the GROUP BY keys, so each group finishes as soon as the key changes. Streams results without holding all groups in memory.',
  Mixed: 'Combines hashed and sorted strategies for different grouping sets.',
};

const JOIN_TYPES = {
  Inner: null,
  Left: 'LEFT join: every outer row is emitted; unmatched ones get NULLs for the inner side.',
  Right: 'RIGHT join executed with sides as shown: every row from the inner (hashed/second) input survives. Postgres often flips LEFT joins into RIGHT joins so the smaller side is the one hashed.',
  Full: 'FULL join: unmatched rows from both sides are kept, NULL-padded.',
  Semi: 'Semi join (EXISTS / IN): emits each outer row at most once, as soon as one match is found — it never multiplies rows.',
  Anti: 'Anti join (NOT EXISTS): emits outer rows that have no match at all.',
  'Right Semi': 'Right semi join: EXISTS-style semantics with the inputs swapped from how you wrote them.',
  'Right Anti': 'Right anti join: NOT EXISTS-style semantics with the inputs swapped from how you wrote them.',
};

const PARENT_REL = {
  Outer: 'outer',
  Inner: 'inner',
  Member: 'member',
  Subquery: 'subquery',
  InitPlan: 'init plan',
  SubPlan: 'subplan',
};

function fmtNum(n) {
  if (n === undefined || n === null) return '?';
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M';
  if (n >= 1e4) return Math.round(n / 1e3) + 'k';
  return String(Math.round(n * 100) / 100);
}

function fmtMs(ms) {
  if (ms === undefined || ms === null) return '?';
  if (ms >= 1000) return (ms / 1000).toFixed(2) + ' s';
  if (ms >= 1) return ms.toFixed(1) + ' ms';
  return ms.toFixed(3) + ' ms';
}

function fmtKb(kb) {
  if (kb >= 1024) return (kb / 1024).toFixed(1) + ' MB';
  return kb + ' kB';
}

// Human title for a node, e.g. "Index Scan using orders_pkey on orders"
function nodeTitle(n) {
  let t = n['Node Type'];
  if (t === 'Aggregate' && n['Strategy']) {
    t = { Hashed: 'HashAggregate', Sorted: 'GroupAggregate', Plain: 'Aggregate', Mixed: 'MixedAggregate' }[n['Strategy']] || t;
  }
  if (t === 'SetOp' && n['Command']) t = n['Command'] + ' (SetOp)';
  if (n['Join Type'] && n['Join Type'] !== 'Inner' && /Join|Nested Loop/.test(t)) t += ' (' + n['Join Type'] + ')';
  if (n['Operation'] && n['Node Type'] === 'ModifyTable') t = n['Operation'];
  if (n['Parallel Aware']) t = 'Parallel ' + t;
  return t;
}

function nodeTarget(n) {
  const bits = [];
  if (n['Index Name']) bits.push('using ' + n['Index Name']);
  if (n['Relation Name']) {
    bits.push('on ' + n['Relation Name'] + (n['Alias'] && n['Alias'] !== n['Relation Name'] ? ' ' + n['Alias'] : ''));
  } else if (n['CTE Name']) bits.push('on CTE ' + n['CTE Name']);
  else if (n['Function Name']) bits.push('on ' + n['Function Name'] + '()');
  return bits.join(' ');
}

// Static explanation for a node.
function describeNode(n) {
  const doc = NODE_DOCS[n['Node Type']];
  let what = doc ? doc.what : 'An execution step (no annotation available for this node type).';
  let detail = doc ? doc.detail : '';
  if (n['Node Type'] === 'Aggregate' && n['Strategy'] && AGG_STRATEGY[n['Strategy']]) {
    detail = AGG_STRATEGY[n['Strategy']];
  }
  const jt = n['Join Type'] && JOIN_TYPES[n['Join Type']];
  if (jt) detail = (detail ? detail + ' ' : '') + jt;
  return { what, detail };
}

// Dynamic, data-driven observations. Returns [{level: 'info'|'warn', text}]
function nodeInsights(n, totals) {
  const out = [];
  const loops = n['Actual Loops'];
  const analyzed = loops !== undefined;

  if (analyzed && loops === 0) {
    out.push({ level: 'info', text: 'Never executed — the executor could prove this branch wasn\u2019t needed (e.g. pruned at run time or short-circuited).' });
    return out;
  }

  // Estimate vs actual (per-loop comparison, reported as totals)
  if (analyzed) {
    const est = n['Plan Rows'];
    const act = n['Actual Rows'];
    if (est !== undefined && act !== undefined) {
      const totalAct = act * loops;
      n._estTotal = est * loops;
      n._actTotal = totalAct;
      const ratio = (Math.max(est, act) + 1) / (Math.min(est, act) + 1);
      const underLimit = totals.hasLimit && act < est;
      if (ratio >= 10 && !underLimit) {
        out.push({
          level: 'warn',
          text: 'Estimate off by ' + Math.round(ratio) + '\u00d7: planner expected ' + fmtNum(est) +
            ' row' + (est === 1 ? '' : 's') + ' per loop, got ' + fmtNum(act) +
            '. Mis-estimates like this are how the planner ends up choosing the wrong join or scan strategy.',
        });
      }
    }
    if (loops > 1) {
      out.push({ level: 'info', text: 'Executed ' + fmtNum(loops) + ' times (once per outer row, or once per parallel process); row and time figures shown are per execution.' });
    }
  }

  // Parallel workers (Gather / Gather Merge — real servers only)
  if (n['Workers Planned'] !== undefined) {
    const planned = n['Workers Planned'];
    const launched = n['Workers Launched'];
    if (launched !== undefined && launched < planned) {
      out.push({ level: 'warn', text: 'Only ' + launched + ' of ' + planned + ' planned workers launched — the server’s worker pool (max_parallel_workers) was exhausted, so less parallelism than the plan was costed for.' });
    } else if (launched !== undefined) {
      out.push({ level: 'info', text: launched + ' parallel worker' + (launched === 1 ? '' : 's') + ' launched (plus the leader); nodes below ran in all of them, so their figures are per process.' });
    }
  }

  // Filters
  const rrf = n['Rows Removed by Filter'];
  if (rrf > 0) {
    const kept = n['Actual Rows'] || 0;
    const pct = Math.round((rrf / (rrf + kept)) * 100);
    out.push({
      level: pct >= 90 && rrf * (loops || 1) > 1000 ? 'warn' : 'info',
      text: 'Filter discarded ' + fmtNum(rrf) + ' rows per loop (' + pct + '% of what this node read)' +
        (pct >= 90 && rrf * (loops || 1) > 1000 ? ' — an index matching this condition could avoid reading them at all.' : '.'),
    });
  }
  const rrj = n['Rows Removed by Join Filter'];
  if (rrj > 0) out.push({ level: 'info', text: 'Join filter discarded ' + fmtNum(rrj) + ' candidate pairings per loop.' });
  const rrr = n['Rows Removed by Index Recheck'];
  if (rrr > 0) {
    out.push({ level: 'warn', text: 'Recheck discarded ' + fmtNum(rrr) + ' rows: the bitmap went lossy (work_mem too small to track individual rows), so whole pages were fetched and the condition re-tested per row.' });
  }
  if (n['Lossy Heap Blocks'] > 0) {
    out.push({ level: 'warn', text: fmtNum(n['Lossy Heap Blocks']) + ' heap pages tracked lossily — the bitmap exceeded work_mem.' });
  }

  // Index Only Scan heap fetches
  if (n['Node Type'] === 'Index Only Scan' && n['Heap Fetches'] !== undefined) {
    if (n['Heap Fetches'] === 0) {
      out.push({ level: 'info', text: 'Heap fetches: 0 — every row was answered from the index alone. The visibility map is fully up to date.' });
    } else {
      out.push({ level: 'warn', text: fmtNum(n['Heap Fetches']) + ' heap fetches: these rows still required a table visit because their pages aren\u2019t marked all-visible. Running VACUUM would push this towards 0.' });
    }
  }

  // Sort details
  if (n['Sort Method']) {
    const space = n['Sort Space Used'] !== undefined ? fmtKb(n['Sort Space Used']) : '';
    if (/external/.test(n['Sort Method'])) {
      out.push({ level: 'warn', text: 'Sorted on disk (' + n['Sort Method'] + ', ' + space + ' of temp files) — the data exceeded work_mem. Raising work_mem, or letting an index provide the order, would keep this in memory.' });
    } else if (/top-N/.test(n['Sort Method'])) {
      out.push({ level: 'info', text: 'Top-N heapsort in ' + space + ': because of the LIMIT, only the current best N rows were kept in memory rather than sorting everything.' });
    } else {
      out.push({ level: 'info', text: 'Sorted in memory (' + n['Sort Method'] + ', ' + space + ').' });
    }
    if (n['Sort Key']) out.push({ level: 'info', text: 'Sort key: ' + n['Sort Key'].join(', ') });
  }
  if (n['Node Type'] === 'Incremental Sort' && n['Presorted Key']) {
    out.push({ level: 'info', text: 'Already sorted on: ' + n['Presorted Key'].join(', ') + ' — only the remaining key(s) needed sorting, group by group.' });
  }

  // Hash details
  if (n['Node Type'] === 'Hash' && n['Hash Batches'] !== undefined) {
    if (n['Hash Batches'] > 1) {
      out.push({ level: 'warn', text: 'Hash table split into ' + n['Hash Batches'] + ' batches (peak ' + fmtKb(n['Peak Memory Usage']) + ') — it didn\u2019t fit in work_mem, so both join inputs were partitioned to disk and re-read.' });
    } else {
      out.push({ level: 'info', text: 'Hash table built in one batch, peak ' + fmtKb(n['Peak Memory Usage']) + ' — fits comfortably in work_mem.' });
    }
  }
  if (n['Node Type'] === 'Aggregate' && n['Strategy'] === 'Hashed') {
    if (n['Disk Usage'] > 0) {
      out.push({ level: 'warn', text: 'Hash aggregation spilled ' + fmtKb(n['Disk Usage']) + ' to disk across ' + n['HashAgg Batches'] + ' batches — too many groups for work_mem.' });
    } else if (n['Peak Memory Usage'] !== undefined) {
      out.push({ level: 'info', text: 'All groups held in memory (peak ' + fmtKb(n['Peak Memory Usage']) + ').' });
    }
  }

  // Memoize
  if (n['Node Type'] === 'Memoize') {
    const hits = n['Cache Hits'], misses = n['Cache Misses'];
    if (hits !== undefined) {
      const total = hits + misses;
      const pct = total ? Math.round((hits / total) * 100) : 0;
      out.push({
        level: pct >= 50 ? 'info' : 'warn',
        text: 'Cache: ' + fmtNum(hits) + ' hits / ' + fmtNum(misses) + ' misses (' + pct + '% hit rate)' +
          (n['Cache Evictions'] ? ', ' + fmtNum(n['Cache Evictions']) + ' evictions' : '') +
          (pct >= 50 ? ' — repeated keys meant most lookups were served without touching the index again.' : ' — mostly unique keys, so the cache added little.'),
      });
    }
    if (n['Cache Key']) out.push({ level: 'info', text: 'Cache key: ' + n['Cache Key'] });
  }

  // Conditions worth surfacing
  const conds = [
    ['Index Cond', 'Index condition'],
    ['Order By', 'Order by (index-supplied)'],
    ['Recheck Cond', 'Recheck condition'],
    ['Hash Cond', 'Hash condition'],
    ['Merge Cond', 'Merge condition'],
    ['Join Filter', 'Join filter'],
    ['Filter', 'Filter'],
    ['TID Cond', 'TID condition'],
    ['One-Time Filter', 'One-time filter'],
    ['Group Key', 'Group key'],
  ];
  for (const [k, label] of conds) {
    if (n[k]) out.push({ level: 'cond', text: label + ': ' + (Array.isArray(n[k]) ? n[k].join(', ') : n[k]) });
  }

  // Buffers
  if (n['Shared Read Blocks'] !== undefined) {
    const hit = n['Shared Hit Blocks'] || 0, read = n['Shared Read Blocks'] || 0;
    if (hit + read > 0) {
      out.push({ level: 'buf', text: 'Buffers: ' + fmtNum(hit) + ' pages from cache' + (read ? ', ' + fmtNum(read) + ' read from storage' : '') + ' (8 kB pages, cumulative with children).' });
    }
    const tw = (n['Temp Written Blocks'] || 0);
    if (tw > 0) out.push({ level: 'buf', text: 'Temp files: ' + fmtNum(tw * 8) + ' kB written to disk.' });
  }
  return out;
}

// Walk plan: compute self time, attach annotations, flatten to tree structure.
function annotatePlan(root, planning) {
  let totalTime = 0;
  let hasLimit = false;
  (function scan(n) {
    if (n['Node Type'] === 'Limit') hasLimit = true;
    (n['Plans'] || []).forEach(scan);
  })(root);

  const inclusive = (n) => (n['Actual Total Time'] || 0) * (n['Actual Loops'] || 1);
  totalTime = inclusive(root) || 1;

  function walk(n, depth, parentRel) {
    const kids = n['Plans'] || [];
    const childTime = kids.reduce((s, k) => s + inclusive(k), 0);
    const self = Math.max(0, inclusive(n) - childTime);
    const desc = describeNode(n);
    const node = {
      raw: n,
      depth,
      parentRel: parentRel ? PARENT_REL[parentRel] || parentRel.toLowerCase() : null,
      title: nodeTitle(n),
      category: nodeCategory(n['Node Type']),
      target: nodeTarget(n),
      what: desc.what,
      detail: desc.detail,
      insights: nodeInsights(n, { hasLimit }),
      estRows: n['Plan Rows'],
      actRows: n['Actual Rows'],
      loops: n['Actual Loops'],
      totalActRows: n['Actual Rows'] !== undefined ? n['Actual Rows'] * n['Actual Loops'] : undefined,
      selfTime: self,
      selfPct: Math.min(100, (self / totalTime) * 100),
      inclusiveTime: inclusive(n),
      startupCost: n['Startup Cost'],
      totalCost: n['Total Cost'],
      children: kids.map((k) => walk(k, depth + 1, k['Parent Relationship'])),
    };
    return node;
  }
  return { tree: walk(root, 0, null), totalTime, planningTime: planning, hasLimit };
}

// Overall summary sentence(s) for the whole plan.
// qp (optional) is the full EXPLAIN JSON object, for server-level extras
// like JIT and trigger timings that live outside the plan tree.
function planSummary(annotated, qp) {
  const bits = [];
  const nodes = [];
  (function fl(n) { nodes.push(n); n.children.forEach(fl); })(annotated.tree);
  const hottest = nodes.slice().sort((a, b) => b.selfTime - a.selfTime)[0];
  if (hottest && hottest.selfTime > 0) {
    bits.push('Most time (' + Math.round(hottest.selfPct) + '%) was spent in the ' + hottest.title + (hottest.target ? ' ' + hottest.target : '') + '.');
  }
  const warns = nodes.reduce((s, n) => s + n.insights.filter((i) => i.level === 'warn').length, 0);
  if (warns) bits.push(warns + ' warning' + (warns === 1 ? '' : 's') + ' flagged below (amber).');
  if (qp && qp['JIT'] && qp['JIT']['Timing'] && qp['JIT']['Timing']['Total'] !== undefined) {
    const jit = qp['JIT']['Timing']['Total'];
    bits.push('JIT compiled ' + qp['JIT']['Functions'] + ' functions in ' + fmtMs(jit) +
      (annotated.totalTime && jit > annotated.totalTime * 0.2 ? ' — a large share of the runtime; for short queries consider jit = off.' : '.'));
  }
  if (qp && Array.isArray(qp['Triggers']) && qp['Triggers'].length) {
    const tt = qp['Triggers'].reduce((s, t) => s + (t['Time'] || 0), 0);
    bits.push('Triggers fired: ' + qp['Triggers'].map((t) => t['Trigger Name'] + ' (' + fmtNum(t['Calls']) + '×)').join(', ') + ', ' + fmtMs(tt) + ' total.');
  }
  return bits.join(' ');
}

// Split a SQL script into statements on top-level semicolons
// (respects quotes, dollar-quoting, comments).
function splitStatements(sql) {
  const stmts = [];
  let cur = '', i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    if (c === "'") { // string literal
      cur += c; i++;
      while (i < n) { cur += sql[i]; if (sql[i] === "'" && sql[i + 1] === "'") { cur += sql[++i]; } else if (sql[i] === "'") { i++; break; } i++; }
      continue;
    }
    if (c === '"') { // quoted identifier
      cur += c; i++;
      while (i < n) { cur += sql[i]; if (sql[i] === '"') { i++; break; } i++; }
      continue;
    }
    if (c === '-' && sql[i + 1] === '-') { while (i < n && sql[i] !== '\n') { cur += sql[i]; i++; } continue; }
    if (c === '/' && sql[i + 1] === '*') { cur += '/*'; i += 2; while (i < n && !(sql[i] === '*' && sql[i + 1] === '/')) { cur += sql[i]; i++; } if (i < n) { cur += '*/'; i += 2; } continue; }
    if (c === '$') { // dollar quoting
      const m = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
      if (m) {
        const tag = m[0];
        const end = sql.indexOf(tag, i + tag.length);
        const stop = end === -1 ? n : end + tag.length;
        cur += sql.slice(i, stop); i = stop; continue;
      }
    }
    if (c === ';') { stmts.push(cur.trim()); cur = ''; i++; continue; }
    cur += c; i++;
  }
  if (cur.trim()) stmts.push(cur.trim());
  return stmts.filter((s) => s.length > 0);
}

function stripLeadingComments(stmt) {
  let s = stmt;
  for (;;) {
    const t = s.replace(/^\s+/, '');
    if (t.startsWith('--')) { const nl = t.indexOf('\n'); if (nl === -1) return ''; s = t.slice(nl + 1); continue; }
    if (t.startsWith('/*')) { const end = t.indexOf('*/'); if (end === -1) return ''; s = t.slice(end + 2); continue; }
    return t;
  }
}

function isExplainable(stmt) {
  return /^(select|insert|update|delete|merge|values|table|with|execute|declare)\b/i.test(stripLeadingComments(stmt));
}

export { annotatePlan, planSummary, splitStatements, isExplainable, describeNode, nodeInsights, nodeTitle, nodeTarget, nodeCategory, fmtNum, fmtMs, NODE_DOCS, NODE_CATEGORY, CATEGORY_META };
