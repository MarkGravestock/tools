// DOM-level smoke test for the built page's UI glue, without a browser or
// CheerpJ. Runs the page's own inlined module under a minimal DOM shim, with
// cheerpjInit / cheerpjRunLibrary stubbed to return canned engine output
// captured from the real jar. Catches render/wiring bugs (bad element ids,
// broken tree building) that the pure unit tests can't. Run: npm run smoke:ui
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

// Canned engine responses (shape matches QueryRunner's JSON), so the shim needs
// no Java. The aggregate example: a 3-row result and a logical/physical plan.
const RUN = JSON.stringify({
  columns: ["DEPT_NAME", "HEADCOUNT", "AVG_SALARY"],
  rows: [["Engineering", 4, 90000], ["Sales", 3, 83666], ["Support", 3, 64333]],
});
const EXPLAIN = JSON.stringify({
  logical:
    "LogicalSort(sort0=[$2], dir0=[DESC])\n" +
    "  LogicalAggregate(group=[{0}], HEADCOUNT=[COUNT()], AVG_SALARY=[AVG($1)])\n" +
    "    LogicalProject(DEPT_NAME=[$5], SALARY=[$3])\n" +
    "      LogicalJoin(condition=[=($2, $4)], joinType=[inner])\n" +
    "        LogicalTableScan(table=[[EMPLOYEES]])\n" +
    "        LogicalTableScan(table=[[DEPARTMENTS]])\n",
  physical:
    "EnumerableSort(sort0=[$2], dir0=[DESC])\n" +
    "  EnumerableAggregate(group=[{3}], HEADCOUNT=[COUNT()])\n" +
    "    EnumerableMergeJoin(condition=[=($0, $2)], joinType=[inner])\n" +
    "      EnumerableTableScan(table=[[EMPLOYEES]])\n" +
    "      EnumerableTableScan(table=[[DEPARTMENTS]])\n",
});
const SCHEMA = (name, rows) => JSON.stringify({
  table: name.toUpperCase(), rowCount: rows,
  columns: [{ name: "A", type: "BIGINT" }, { name: "B", type: "VARCHAR" }],
});

// ---- Minimal DOM shim -----------------------------------------------------
function makeEl(tag = "div") {
  const el = {
    tagName: tag, children: [], _html: "", _text: "", value: "", checked: false,
    hidden: false, disabled: false, title: "", label: "",
    style: {}, dataset: {}, _attrs: {}, _handlers: {},
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      toggle(c, on) { if (on === undefined) on = !this._s.has(c); on ? this._s.add(c) : this._s.delete(c); },
      contains(c) { return this._s.has(c); } },
    appendChild(c) { this.children.push(c); return c; },
    setAttribute(k, v) { this._attrs[k] = v; }, getAttribute(k) { return this._attrs[k]; },
    addEventListener(ev, fn) { this._handlers[ev] = fn; },
    removeEventListener() {}, focus() {}, click() { this._handlers.click && this._handlers.click(); },
    fire(ev, arg) { this._handlers[ev] && this._handlers[ev](arg || { preventDefault() {} }); },
  };
  Object.defineProperty(el, "innerHTML", { get() { return this._html; }, set(v) { this._html = v; this.children = []; } });
  Object.defineProperty(el, "textContent", { get() { return this._text; }, set(v) { this._text = v; this._html = ""; } });
  Object.defineProperty(el, "className", { get() { return [...this.classList._s].join(" "); }, set(v) { this.classList._s = new Set(String(v).split(/\s+/).filter(Boolean)); } });
  return el;
}

function installDom() {
  const byId = new Map();
  const el = (id) => { if (!byId.has(id)) byId.set(id, makeEl()); return byId.get(id); };
  // Pre-create every id the page looks up, so getElementById never returns null.
  ["status", "ver", "themeToggle", "runBtn", "examplePicker", "addFile", "filePicker",
   "exnote", "sql", "compact", "resultsSection", "tblwrap", "rowcount", "planSection",
   "legend", "diff", "logicalTree", "physicalTree", "rawPlan", "dataSection", "schema"]
    .forEach(el);

  const documentEl = makeEl("html");
  const body = makeEl("body");
  global.document = {
    getElementById: el,
    createElement: (t) => makeEl(t),
    documentElement: documentEl,
    body,
  };
  global.location = { protocol: "http:", pathname: "/calcite-query-explainer/" };
  global.performance = { now: () => 0 };
  global.matchMedia = () => ({ matches: false });
  global.localStorage = { _s: {}, getItem(k) { return this._s[k] ?? null; }, setItem(k, v) { this._s[k] = v; } };

  // CheerpJ stubs returning canned output.
  const QueryRunner = {
    registerCsv: async (name, text) => SCHEMA(name, (text.match(/\n/g) || []).length),
    registerJson: async (name) => SCHEMA(name, 3),
    run: async () => RUN,
    explain: async () => EXPLAIN,
  };
  global.cheerpjInit = async () => {};
  global.cheerpjRunLibrary = async () => ({ cqe: { QueryRunner } });
  return { el };
}

async function main() {
  const { el } = installDom();

  // Extract the page's module script and run it as a real ES module.
  const html = readFileSync(join(root, "calcite-query-explainer.html"), "utf8");
  const m = html.match(/<script type="module">([\s\S]*?)<\/script>/);
  assert.ok(m, "found the module script in the built page");
  const bundle = join(tmpdir(), "cqe-bundle-" + process.pid + ".mjs");
  writeFileSync(bundle, m[1]);
  await import("file://" + bundle);

  // boot() is async and fired at import; let its awaited chain settle.
  await new Promise((r) => setTimeout(r, 50));

  // After boot: examples populated, samples registered, Run enabled.
  assert.equal(el("runBtn").disabled, false, "Run button is enabled after boot");
  assert.ok(el("examplePicker").children.length > 0, "example picker populated");
  assert.ok(el("schema")._html.includes("EMPLOYEES"), "sample datasets shown in schema");
  assert.ok(el("legend")._html.includes("Join"), "legend rendered");
  assert.ok(el("sql").value.length > 0, "editor seeded with an example query");

  // Run a query and check every output pane renders.
  el("runBtn").click();
  await new Promise((r) => setTimeout(r, 50));

  assert.equal(el("resultsSection").hidden, false, "results section shown");
  assert.ok(el("tblwrap")._html.includes("Engineering"), "results table rendered");
  assert.equal(el("planSection").hidden, false, "plan section shown");
  assert.ok(el("logicalTree").children.length > 0, "logical tree built nodes");
  assert.ok(el("physicalTree").children.length > 0, "physical tree built nodes");
  assert.equal(el("diff").hidden, false, "optimizer diff shown");
  assert.ok(el("diff")._html.includes("MergeJoin"), "diff names the introduced MergeJoin");
  assert.ok(el("rawPlan")._text.includes("EnumerableMergeJoin"), "raw plan text populated");
  assert.ok(/ran in/.test(el("status")._text), "status reports timing");

  console.log("  ok  boot registers samples, enables Run, renders legend + schema");
  console.log("  ok  running a query renders results, both plan trees, and the diff");
  console.log("\nUI smoke passed.");
}

main().then(() => process.exit(0), (e) => { console.error("\nUI SMOKE FAILED:\n" + (e && e.stack || e)); process.exit(1); });
