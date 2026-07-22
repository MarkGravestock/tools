// Unit tests for the plan-annotation module. No browser or CheerpJ needed —
// these run the pure parser against representative Calcite plan text.
// Run: node test/plan.test.mjs   (or npm test)
import assert from "node:assert/strict";
import {
  parsePlan,
  walk,
  annotate,
  baseName,
  splitLine,
  unknownOperators,
  planDiff,
} from "../src/planlogic.js";

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log("  ok  " + name);
}

// Real output captured from the Java engine's `explain` for the sample
// cross-format join (see java/.../SmokeTest.java).
const LOGICAL = [
  "LogicalSort(sort0=[$2], dir0=[DESC])",
  "  LogicalAggregate(group=[{0}], HEADCOUNT=[COUNT()], AVG_SALARY=[AVG($1)])",
  "    LogicalProject(DEPT_NAME=[$5], SALARY=[$3])",
  "      LogicalJoin(condition=[=($2, $4)], joinType=[inner])",
  "        LogicalTableScan(table=[[EMP]])",
  "        LogicalTableScan(table=[[DEPT]])",
  "",
].join("\n");

const PHYSICAL = [
  "EnumerableSort(sort0=[$2], dir0=[DESC])",
  "  EnumerableCalc(expr#0..3=[{inputs}], AVG_SALARY=[$t8])",
  "    EnumerableAggregate(group=[{3}], HEADCOUNT=[COUNT()])",
  "      EnumerableMergeJoin(condition=[=($0, $2)], joinType=[inner])",
  "        EnumerableSort(sort0=[$0], dir0=[ASC])",
  "          EnumerableCalc(expr#0..3=[{inputs}], DEPT_ID=[$t2], SALARY=[$t3])",
  "            EnumerableTableScan(table=[[EMP]])",
  "        EnumerableSort(sort0=[$0], dir0=[ASC])",
  "          EnumerableCalc(expr#0..2=[{inputs}], proj#0..1=[{exprs}])",
  "            EnumerableTableScan(table=[[DEPT]])",
  "",
].join("\n");

test("baseName strips engine prefixes", () => {
  assert.equal(baseName("EnumerableMergeJoin"), "MergeJoin");
  assert.equal(baseName("LogicalTableScan"), "TableScan");
  assert.equal(baseName("Aggregate"), "Aggregate");
});

test("splitLine separates operator from detail", () => {
  const { op, detail } = splitLine("LogicalJoin(condition=[=($2, $4)], joinType=[inner])");
  assert.equal(op, "LogicalJoin");
  assert.equal(detail, "condition=[=($2, $4)], joinType=[inner]");
  assert.equal(splitLine("EnumerableValues").op, "EnumerableValues");
});

test("annotate resolves category and description", () => {
  const a = annotate("EnumerableMergeJoin");
  assert.equal(a.category, "join");
  assert.equal(a.known, true);
  assert.ok(a.description.length > 0);
  assert.equal(annotate("EnumerableTableScan").category, "scan");
});

test("parsePlan builds the right shape from indentation", () => {
  const root = parsePlan(LOGICAL);
  assert.equal(root.op, "LogicalSort");
  assert.equal(root.children.length, 1);
  const agg = root.children[0];
  assert.equal(agg.base, "Aggregate");
  const join = agg.children[0].children[0];
  assert.equal(join.base, "Join");
  assert.equal(join.children.length, 2, "join has two scanned inputs");
  assert.equal(join.children[0].base, "TableScan");
});

test("walk visits every node in pre-order", () => {
  const names = [];
  walk(parsePlan(PHYSICAL), (n) => names.push(n.base));
  assert.equal(names[0], "Sort");
  assert.ok(names.includes("MergeJoin"));
  assert.equal(names.filter((n) => n === "TableScan").length, 2);
});

// Mirrors the Postgres tool: the plans in the example set must be fully
// documented, so an unfamiliar operator fails the build rather than rendering
// with no explanation.
test("no undocumented operators in the sample plans", () => {
  const missing = [...unknownOperators(LOGICAL), ...unknownOperators(PHYSICAL)];
  assert.deepEqual(missing, [], "undocumented operators: " + missing.join(", "));
});

test("planDiff reports what the optimizer changed", () => {
  const { added, removed } = planDiff(LOGICAL, PHYSICAL);
  assert.ok(added.includes("MergeJoin"), "physical plan introduces a MergeJoin");
  assert.ok(added.includes("Calc"), "physical plan introduces Calc");
  assert.ok(removed.includes("Join"), "logical Join is gone after optimization");
  assert.ok(removed.includes("Project"), "logical Project folded into Calc");
});

// Calcite inlines a scalar subquery as a multi-line $SCALAR_QUERY({ ... }) block
// inside the parent node's detail. Those lines must fold into the parent, not
// appear as bogus sibling operators.
test("parsePlan folds inlined scalar-subquery blocks into detail", () => {
  const plan = [
    "LogicalSort(sort0=[$1], dir0=[DESC])",
    "  LogicalProject(NAME=[$1], SALARY=[$3])",
    "    LogicalFilter(condition=[>($3, $SCALAR_QUERY({",
    "LogicalAggregate(group=[{}], EXPR$0=[AVG($0)])",
    "  LogicalProject(SALARY=[$3])",
    "    LogicalTableScan(table=[[EMPLOYEES]])",
    "}))])",
    "      LogicalTableScan(table=[[EMPLOYEES]])",
    "",
  ].join("\n");
  const bases = [];
  walk(parsePlan(plan), (n) => bases.push(n.base));
  assert.deepEqual(bases, ["Sort", "Project", "Filter", "TableScan"],
    "the subquery block folds into the Filter, leaving one clean spine");
  assert.deepEqual(unknownOperators(plan), [], "no bogus operators leak out");
  const filter = parsePlan(plan).children[0].children[0];
  assert.ok(filter.detail.includes("SCALAR_QUERY"), "subquery text is kept in the Filter detail");
});

test("parsePlan tolerates empty input", () => {
  assert.equal(parsePlan(""), null);
  assert.equal(parsePlan(null), null);
});

console.log(`\n${passed} plan tests passed.`);
