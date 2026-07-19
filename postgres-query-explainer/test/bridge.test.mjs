// End-to-end test of bridge/bridge.mjs — no real Postgres server needed:
// PGlite is exposed over the Postgres wire protocol via pglite-socket, and
// the bridge's pg driver connects to it like any other server.
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { spawn } from 'node:child_process';

const PG_PORT = 5544;
const TOKEN = 'bridge-test-token';
let failures = 0;

function check(name, cond, extra) {
  console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : '  :: ' + JSON.stringify(extra ?? null)?.slice(0, 200)));
  if (!cond) failures++;
}

const db = await PGlite.create();
await db.exec("create table fruit(id int primary key, name text); insert into fruit values (1,'apple'),(2,'pear'),(3,'plum');");

// pglite-socket serves one client connection at a time, so give each bridge
// its own socket-server session.
let sock = null;
async function startSock() { sock = new PGLiteSocketServer({ db, port: PG_PORT, host: '127.0.0.1' }); await sock.start(); }
async function stopSock() { try { await sock.stop(); } catch {} sock = null; }
function stopBridge(child) {
  return new Promise((resolve) => { child.on('exit', resolve); child.kill(); setTimeout(resolve, 2000); });
}

function startBridge(port, extraArgs = []) {
  const child = spawn(process.execPath, [
    'bridge/bridge.mjs',
    '--conn', `postgres://postgres:postgres@127.0.0.1:${PG_PORT}/template1`,
    '--name', 'pglite', '--token', TOKEN, '--port', String(port), ...extraArgs,
  ], { stdio: ['ignore', 'pipe', 'inherit'] });
  return new Promise((resolve, reject) => {
    child.stdout.on('data', (d) => { if (/listening/.test(String(d))) resolve(child); });
    child.on('exit', (c) => reject(new Error('bridge exited early: ' + c)));
    setTimeout(() => reject(new Error('bridge did not start')), 8000);
  });
}

const api = (port) => ({
  info: () => fetch(`http://127.0.0.1:${port}/api/info`, { headers: { authorization: 'Bearer ' + TOKEN } }),
  run: (body) => fetch(`http://127.0.0.1:${port}/api/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + TOKEN },
    body: JSON.stringify({ profile: 'pglite', ...body }),
  }),
});

// ---- read-only bridge ------------------------------------------------------
await startSock();
const roBridge = await startBridge(7444);
const ro = api(7444);
try {
  const noAuth = await fetch('http://127.0.0.1:7444/api/info');
  check('rejects missing token', noAuth.status === 401);

  const info = await (await ro.info()).json();
  check('info lists profile with version', info.profiles?.[0]?.name === 'pglite' && /PostgreSQL/.test(info.profiles[0].version || ''), info);
  check('info reports read-only', info.allowWrites === false);

  let r = await ro.run({ statements: ['select name from fruit order by id'], explain: true, mutating: false, rowCap: 200 });
  let j = await r.json();
  check('select returns rows', r.ok && j.rowCount === 3 && j.rows[0].name === 'apple', j);
  check('select returns plan', j.plan && j.plan['Plan'] && j.plan['Execution Time'] !== undefined, j.plan && Object.keys(j.plan));
  check('plan node has a type', typeof j.plan?.['Plan']?.['Node Type'] === 'string', j.plan?.['Plan']);

  r = await ro.run({ statements: ["insert into fruit values (9,'kiwi')"], explain: true, mutating: true, rowCap: 200 });
  j = await r.json();
  check('write blocked when read-only', !r.ok && /read-only/i.test(j.error || ''), j);
  check('read-only error carries --allow-writes hint', /--allow-writes/.test(j.hint || ''), j);

  r = await ro.run({ statements: ['set enable_seqscan = off', 'select count(*) from fruit'], explain: true, mutating: false, rowCap: 200 });
  j = await r.json();
  check('setup statements run before the last', r.ok && Number(j.rows[0].count) === 3, j);
} finally { await stopBridge(roBridge); await stopSock(); }

// ---- writes-allowed bridge: everything still rolls back --------------------
await startSock();
const rwBridge = await startBridge(7445, ['--allow-writes']);
const rw = api(7445);
try {
  let r = await rw.run({
    statements: ['create table scratch(x int)', 'insert into scratch values (1),(2)', 'select count(*) as n from scratch'],
    explain: true, mutating: false, rowCap: 200,
  });
  let j = await r.json();
  check('write script runs with --allow-writes', r.ok && Number(j.rows[0].n) === 2, j);

  r = await rw.run({ statements: ['select count(*) from scratch'], explain: true, mutating: false, rowCap: 200 });
  j = await r.json();
  check('previous run was rolled back (table gone)', !r.ok && /scratch/.test(j.error || ''), j);

  r = await rw.run({ statements: ["update fruit set name = 'gone'"], explain: true, mutating: true, rowCap: 200 });
  j = await r.json();
  check('EXPLAIN ANALYZE of a write returns a plan, no rows', r.ok && j.plan && j.rows.length === 0, j);

  r = await rw.run({ statements: ['select name from fruit where id = 1'], explain: true, mutating: false, rowCap: 200 });
  j = await r.json();
  check('analyzed update was rolled back', r.ok && j.rows[0].name === 'apple', j);
} finally { await stopBridge(rwBridge); await stopSock(); }

await db.close();
console.log(failures ? failures + ' FAILURES' : 'ALL PASS');
process.exit(failures ? 1 : 0);
