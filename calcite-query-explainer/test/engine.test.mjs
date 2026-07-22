// End-to-end test against the real Calcite engine in the jar (via the cqe.Repl
// stdin driver), the analogue of the Postgres tool's "run every example against
// live PGlite" suite. Requires a JDK on PATH and app/calcite-query-explainer.jar
// already built (npm run build:jar). Run: npm run smoke
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { DATASETS, EXAMPLES } from "../src/examples.js";
import { unknownOperators } from "../src/planlogic.js";

const here = dirname(fileURLToPath(import.meta.url));
const jar = join(here, "..", "app", "calcite-query-explainer.jar");

if (!existsSync(jar)) {
  console.error("Missing " + jar + " — run `npm run build:jar` first.");
  process.exit(1);
}

const b64 = (s) => Buffer.from(s, "utf8").toString("base64");

// Minimal line-response REPL client over the Java process's stdio.
function makeEngine() {
  const proc = spawn("java", ["-cp", jar, "cqe.Repl"], {
    stdio: ["pipe", "pipe", "inherit"],
  });
  const queue = [];
  let buffer = "";
  proc.stdout.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    let nl;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      const m = line.match(/^<<< (.*)$/);
      if (m && queue.length) queue.shift()(m[1]);
    }
  });
  const send = (line) =>
    new Promise((resolve) => {
      queue.push(resolve);
      proc.stdin.write(line + "\n");
    });
  return {
    csv: (name, text) => send(`csv ${name} ${b64(text)}`).then(JSON.parse),
    json: (name, text) => send(`json ${name} ${b64(text)}`).then(JSON.parse),
    run: (sql) => send(`run ${b64(sql)}`).then(JSON.parse),
    explain: (sql) => send(`explain ${b64(sql)}`).then(JSON.parse),
    rules: (sql) => send(`rules ${b64(sql)}`).then(JSON.parse),
    close: () => proc.stdin.write("quit\n"),
  };
}

async function main() {
  const engine = makeEngine();
  let passed = 0;

  // Register the sample datasets exactly as the page does.
  for (const ds of DATASETS) {
    const res = ds.format === "json"
      ? await engine.json(ds.name, ds.text)
      : await engine.csv(ds.name, ds.text);
    assert.ok(!res.error, `register ${ds.name}: ${res.error}`);
    assert.ok(res.rowCount > 0, `${ds.name} has rows`);
    console.log(`  ok  register ${ds.name} (${res.rowCount} rows, ${res.columns.length} cols)`);
    passed++;
  }

  // Every example query must execute and produce a fully documented plan.
  const undocumented = new Set();
  for (const ex of EXAMPLES) {
    const result = await engine.run(ex.sql);
    assert.ok(!result.error, `run "${ex.title}": ${result.error}`);
    assert.ok(Array.isArray(result.columns), `"${ex.title}" returned columns`);

    const plan = await engine.explain(ex.sql);
    assert.ok(!plan.error, `explain "${ex.title}": ${plan.error}`);
    assert.ok(plan.logical && plan.physical, `"${ex.title}" has both plan stages`);
    for (const op of [...unknownOperators(plan.logical), ...unknownOperators(plan.physical)]) {
      undocumented.add(op);
    }

    const rules = await engine.rules(ex.sql);
    assert.ok(!rules.error, `rules "${ex.title}": ${rules.error}`);
    assert.ok(Array.isArray(rules.rules) && rules.rules.length > 0,
      `"${ex.title}" fired at least one optimizer rule`);
    assert.ok(rules.rules.every((r) => typeof r.rule === "string" && r.count > 0),
      `"${ex.title}" rule entries are well-formed`);

    console.log(`  ok  ${ex.group} / ${ex.title} (${result.rows.length} rows, ${rules.rules.length} rules)`);
    passed++;
  }

  assert.deepEqual(
    [...undocumented], [],
    "undocumented plan operators (add to OPERATORS in planlogic.js): " + [...undocumented].join(", ")
  );
  console.log("  ok  every example plan is fully documented");
  passed++;

  engine.close();
  console.log(`\n${passed} engine checks passed.`);
}

main().then(
  () => process.exit(0),
  (err) => { console.error("\nENGINE TEST FAILED:\n" + (err && err.message ? err.message : err)); process.exit(1); }
);
