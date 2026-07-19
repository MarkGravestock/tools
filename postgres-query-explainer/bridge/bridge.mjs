#!/usr/bin/env node
// pg-explain-bridge — localhost HTTP bridge between the Postgres Query
// Explainer page and real PostgreSQL servers.
//
//   node bridge.mjs --conn "postgres://user:pass@host:5432/db" [--name prod]
//                   [--conn ... --name ...] [--port 7432] [--token SECRET]
//                   [--allow-writes] [--timeout 30000]
//
// Connection strings (credentials included) live HERE, on the command line /
// in your shell history management — the browser only ever sees the bridge
// URL, a session token, and profile labels. Every request runs inside a
// transaction that is ALWAYS rolled back, and sessions are read-only unless
// --allow-writes is given. Listens on 127.0.0.1 only.

import { createServer } from 'node:http';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import pg from 'pg';

// ---- CLI -------------------------------------------------------------------
const argv = process.argv.slice(2);
const opts = { conns: [], port: 7432, token: null, allowWrites: false, timeout: 30000 };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--conn') opts.conns.push({ conn: argv[++i], name: null });
  else if (a === '--name') { if (!opts.conns.length) fail('--name must follow a --conn'); opts.conns[opts.conns.length - 1].name = argv[++i]; }
  else if (a === '--port') opts.port = Number(argv[++i]);
  else if (a === '--token') opts.token = argv[++i];
  else if (a === '--allow-writes') opts.allowWrites = true;
  else if (a === '--timeout') opts.timeout = Number(argv[++i]);
  else if (a === '--help' || a === '-h') { usage(); process.exit(0); }
  else fail('unknown argument: ' + a);
}
if (!opts.conns.length) { usage(); fail('at least one --conn is required'); }
if (!Number.isInteger(opts.port) || opts.port < 1 || opts.port > 65535) fail('invalid --port');
if (!Number.isInteger(opts.timeout) || opts.timeout < 100) fail('invalid --timeout (ms)');

function usage() {
  console.log('Usage: node bridge.mjs --conn "postgres://user:pass@host/db" [--name label] [--port 7432] [--token SECRET] [--allow-writes] [--timeout ms]');
}
function fail(msg) { console.error('pg-explain-bridge: ' + msg); process.exit(1); }

// ---- Profiles --------------------------------------------------------------
function describeConn(conn, fallback) {
  try {
    const u = new URL(conn);
    return {
      host: u.hostname || 'localhost',
      port: u.port || '5432',
      database: decodeURIComponent(u.pathname.replace(/^\//, '')) || '',
      user: decodeURIComponent(u.username || ''),
    };
  } catch { return { host: '?', port: '?', database: fallback, user: '?' }; }
}

const profiles = opts.conns.map((c, i) => {
  const d = describeConn(c.conn, 'profile-' + (i + 1));
  const name = c.name || (d.database ? d.database + '@' + d.host : 'profile-' + (i + 1));
  return { name, meta: d, pool: new pg.Pool({ connectionString: c.conn, max: 2, idleTimeoutMillis: 30000 }), version: null };
});
{
  const seen = new Set();
  for (const p of profiles) {
    if (seen.has(p.name)) fail('duplicate profile name "' + p.name + '" — disambiguate with --name');
    seen.add(p.name);
  }
}

const token = opts.token || randomBytes(16).toString('hex');
const tokenHash = createHash('sha256').update(token).digest();
function tokenOk(header) {
  const m = /^Bearer\s+(.+)$/.exec(header || '');
  if (!m) return false;
  return timingSafeEqual(createHash('sha256').update(m[1]).digest(), tokenHash);
}

// ---- HTTP helpers ----------------------------------------------------------
function cors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
  res.setHeader('Access-Control-Max-Age', '86400');
  // Chrome Private Network Access preflight (public page -> localhost).
  if (req.headers['access-control-request-private-network']) {
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
  }
  res.setHeader('Vary', 'Origin');
}

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(body);
}

function readBody(req, limit = 5 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('request body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// ---- Endpoints -------------------------------------------------------------
async function handleInfo(res) {
  for (const p of profiles) {
    if (p.version) continue;
    try {
      const r = await p.pool.query('select version()');
      const m = /PostgreSQL [\d.]+[^,(]*/.exec(r.rows[0].version);
      p.version = m ? m[0].trim() : r.rows[0].version.slice(0, 40);
    } catch (e) { p.version = null; p.lastError = e.message; }
  }
  send(res, 200, {
    bridge: 'pg-explain-bridge',
    allowWrites: opts.allowWrites,
    timeoutMs: opts.timeout,
    profiles: profiles.map((p) => ({
      name: p.name, host: p.meta.host, port: p.meta.port, database: p.meta.database,
      user: p.meta.user, version: p.version, error: p.version ? undefined : p.lastError,
    })),
  });
}

// Runs a whole editor script in ONE transaction that is always rolled back:
//   { profile, statements: [...], explain: bool, mutating: bool, rowCap: n }
// -> { fields, rows, rowCount, plan }   (plan/rows optional)
async function handleRun(res, body) {
  const { profile: name, statements, explain, mutating, rowCap } = body;
  const profile = profiles.find((p) => p.name === name);
  if (!profile) return send(res, 400, { error: 'unknown profile: ' + name });
  if (!Array.isArray(statements) || !statements.length || statements.some((s) => typeof s !== 'string')) {
    return send(res, 400, { error: 'statements must be a non-empty array of strings' });
  }
  const cap = Math.min(Math.max(Number(rowCap) || 500, 1), 5000);

  let client;
  try { client = await profile.pool.connect(); }
  catch (e) { return send(res, 502, { error: 'could not connect to ' + name + ': ' + e.message }); }

  const out = {};
  try {
    await client.query('begin');
    await client.query('set local statement_timeout = ' + opts.timeout);
    if (!opts.allowWrites) await client.query('set transaction read only');

    const last = statements[statements.length - 1];
    for (let i = 0; i < statements.length - 1; i++) {
      try { await client.query(statements[i]); }
      catch (e) { throw withIndex(e, i); }
    }

    if (explain) {
      if (!mutating) {
        const r = await runLast(client, last, statements.length - 1);
        out.fields = (r.fields || []).map((f) => ({ name: f.name }));
        out.rowCount = r.rows.length;
        out.rows = r.rows.slice(0, cap);
      } else {
        out.fields = []; out.rows = []; out.rowCount = 0;
      }
      const ex = await runLast(client, 'explain (analyze, buffers, format json) ' + last, statements.length - 1);
      out.plan = ex.rows[0]['QUERY PLAN'][0];
    } else {
      const r = await runLast(client, last, statements.length - 1);
      out.fields = (r.fields || []).map((f) => ({ name: f.name }));
      out.rowCount = r.rows ? r.rows.length : 0;
      out.rows = (r.rows || []).slice(0, cap);
    }
  } catch (e) {
    await client.query('rollback').catch(() => {});
    client.release();
    const resp = { error: e.message, statementIndex: e._stmtIndex };
    if (e.code === '25006') resp.hint = 'The bridge is read-only by default. Restart it with --allow-writes to permit writes (they are still rolled back).';
    if (e.code === '57014') resp.hint = 'Statement timed out after ' + opts.timeout + ' ms (bridge --timeout).';
    if (e.code === '25001') resp.hint = 'This statement cannot run inside a transaction (the bridge wraps every run in one so it can roll back).';
    return send(res, 400, resp);
  }
  await client.query('rollback').catch(() => {});
  client.release();
  send(res, 200, out);
}
function runLast(client, sql, idx) {
  return client.query({ text: sql, rowMode: undefined }).catch((e) => { throw withIndex(e, idx); });
}
function withIndex(e, i) { e._stmtIndex = i; return e; }

// ---- Server ----------------------------------------------------------------
const server = createServer(async (req, res) => {
  cors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  try {
    if (!req.url.startsWith('/api/')) return send(res, 404, { error: 'not found' });
    if (!tokenOk(req.headers.authorization)) return send(res, 401, { error: 'missing or invalid bearer token' });
    if (req.method === 'GET' && req.url === '/api/info') return await handleInfo(res);
    if (req.method === 'POST' && req.url === '/api/run') {
      let body;
      try { body = JSON.parse(await readBody(req)); }
      catch (e) { return send(res, 400, { error: 'bad request body: ' + e.message }); }
      return await handleRun(res, body);
    }
    send(res, 404, { error: 'not found' });
  } catch (e) {
    send(res, 500, { error: e.message });
  }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') fail('port ' + opts.port + ' is already in use — pick another with --port');
  fail(e.message);
});

server.listen(opts.port, '127.0.0.1', () => {
  console.log('pg-explain-bridge listening on http://localhost:' + opts.port);
  console.log('  profiles: ' + profiles.map((p) => p.name).join(', '));
  console.log('  writes:   ' + (opts.allowWrites ? 'ALLOWED (still rolled back)' : 'read-only (--allow-writes to relax)'));
  console.log('  token:    ' + token);
  console.log('Paste the URL and token into the explainer page ("Connect to a server").');
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    server.close();
    await Promise.allSettled(profiles.map((p) => p.pool.end()));
    process.exit(0);
  });
}
