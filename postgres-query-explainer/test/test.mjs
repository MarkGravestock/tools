import { PGlite } from '@electric-sql/pglite';
import { EXAMPLE_DB_STEPS, EXAMPLES } from '../src/exampledb.js';
import { vector } from '@electric-sql/pglite-pgvector';
import { annotatePlan, planSummary, splitStatements, isExplainable, NODE_DOCS } from '../src/planlogic.js';

const db = new PGlite({ extensions: { vector } });
console.time('build example db');
for (const [label, sql] of EXAMPLE_DB_STEPS) await db.exec(sql);
await db.exec('vacuum analyze');
console.timeEnd('build example db');

let failures = 0;
const seenNodes = new Set();

for (const ex of EXAMPLES) {
  try {
    await db.exec('reset all');
    const stmts = splitStatements(ex.sql);
    const last = stmts[stmts.length - 1];
    for (const s of stmts.slice(0, -1)) await db.exec(s);
    if (!isExplainable(last)) throw new Error('last stmt not explainable');
    // results run
    const res = await db.query(last);
    // analyze run
    const ex1 = await db.query('explain (analyze, buffers, verbose, format json) ' + last);
    const qp = ex1.rows[0]['QUERY PLAN'][0];
    const ann = annotatePlan(qp['Plan'], qp['Planning Time']);
    const nodes = [];
    (function fl(n) { nodes.push(n); n.children.forEach(fl); })(ann.tree);
    let unknown = 0;
    nodes.forEach((n) => {
      seenNodes.add(n.raw['Node Type']);
      if (!NODE_DOCS[n.raw['Node Type']]) { unknown++; console.log('  !! no doc for', n.raw['Node Type']); }
    });
    const warns = nodes.reduce((s, n) => s + n.insights.filter((i) => i.level === 'warn').length, 0);
    console.log(
      (unknown ? 'FAIL ' : 'ok   ') + ex.title.padEnd(52).slice(0, 52),
      'nodes:' + String(nodes.length).padStart(2),
      'rows:' + String(res.rows.length).padStart(6),
      'warn:' + warns,
      '| ' + nodes.map((n) => n.title).join(' > ').slice(0, 70)
    );
    if (unknown) failures++;
  } catch (e) {
    failures++;
    console.log('FAIL', ex.title, '::', e.message.split('\n')[0]);
  }
}
await db.exec('reset all');
console.log('\nNode types seen:', [...seenNodes].sort().join(', '));
console.log(failures ? failures + ' FAILURES' : 'ALL PASS');
process.exit(failures ? 1 : 0);
