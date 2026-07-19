import { readFileSync } from 'fs';
import { JSDOM } from 'jsdom';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';

const html = readFileSync(new URL('../postgres-query-explainer.html', import.meta.url), 'utf8');
const m = /<script type="module">([\s\S]*?)<\/script>/.exec(html);
let js = m[1].replace(/^import .* from "https:.*$/gm, ''); // real PGlite injected below

const dom = new JSDOM(html.replace(m[1], ''), { url: 'http://localhost/', runScripts: 'outside-only' });
const { window } = dom;

const fn = new Function('PGlite','vector', 'window', 'document', 'history', 'location', 'performance',
  'return (async () => {' + js + '\n; return { runQuery, loadExampleDb, splitStatements };})()');
const api = await fn(PGlite, vector, window, window.document, window.history, window.location, window.performance);

console.time('loadExampleDb');
await api.loadExampleDb();
console.timeEnd('loadExampleDb');
console.log('status:', window.document.getElementById('status').textContent);
console.log('schema tables:', window.document.querySelectorAll('.schematbl').length);
console.log('example options:', window.document.querySelectorAll('#examplePicker option').length);

// run a representative query through the real UI path
window.document.getElementById('sql').value =
  "select c.country, sum(o.total) from customers c join orders o on o.customer_id = c.id group by c.country;";
await api.runQuery();
const plan = window.document.getElementById('plan');
console.log('plan nodes rendered:', plan.querySelectorAll('.node').length);
console.log('badges:', [...plan.querySelectorAll('.nbadge')].map(b=>b.textContent).join(' > '));
console.log('summary:', window.document.getElementById('summary').textContent);
console.log('timing:', window.document.getElementById('timing').textContent);
console.log('result rows:', window.document.querySelectorAll('#results tr').length - 1);
console.log('hash set:', window.location.hash.slice(0, 40));

// multi-statement with SET (memoize example path)
window.document.getElementById('sql').value =
  "set enable_hashjoin = off;\nset enable_mergejoin = off;\nselect oi.order_id, p.price from order_items oi join products p on p.id = oi.product_id where oi.order_id between 1 and 500;";
await api.runQuery();
console.log('memoize present:', [...plan.querySelectorAll('.nbadge')].some(b=>b.textContent==='Memoize'));
console.log('warn items:', plan.querySelectorAll('.ins li.warn').length, '| cond items:', plan.querySelectorAll('.ins li.cond').length);

// error path
window.document.getElementById('sql').value = "select * from nonexistent_table;";
await api.runQuery();
console.log('error surfaced:', window.document.getElementById('status').textContent.includes('nonexistent_table'));

// DDL path (create + query own table)
window.document.getElementById('sql').value = "create table scratch(x int);";
await api.runQuery();
window.document.getElementById('sql').value = "insert into scratch select generate_series(1,100);";
await api.runQuery();
const chk = plan.querySelectorAll('.node').length;
console.log('insert explained, nodes:', chk, 'rowcount text:', window.document.getElementById('rowcount').textContent);
process.exit(0);
