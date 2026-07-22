// Sample datasets and example queries for the Calcite Query Explainer.
//
// Three small tables in two formats, so a join genuinely crosses CSV and JSON:
//   employees (CSV) · departments (JSON) · sales (CSV)
// Pure data — inlined into the page at build time.

const EMPLOYEES_CSV = `emp_id,name,dept_id,salary,hired
1,Alice,10,95000,2019-03-01
2,Bob,20,72000,2021-07-15
3,Carol,10,105000,2017-11-20
4,Dave,30,64000,2022-01-10
5,Eve,20,88000,2020-05-30
6,Frank,10,78000,2023-02-01
7,Grace,30,69000,2018-09-12
8,Heidi,20,91000,2016-04-25
9,Ivan,10,82000,2021-12-03
10,Judy,30,60000,2023-08-19`;

const DEPARTMENTS_JSON = `[
  { "dept_id": 10, "dept_name": "Engineering", "remote": true,  "budget": 1200000 },
  { "dept_id": 20, "dept_name": "Sales",       "remote": false, "budget": 800000 },
  { "dept_id": 30, "dept_name": "Support",     "remote": true,  "budget": 450000 }
]`;

const SALES_CSV = `sale_id,emp_id,amount,region,closed
101,2,12000,EMEA,true
102,5,8400,AMER,true
103,2,15500,EMEA,false
104,8,22000,APAC,true
105,5,9100,AMER,true
106,8,3300,APAC,false
107,2,17800,EMEA,true
108,5,6200,AMER,false`;

const DATASETS = [
  {
    name: "employees",
    format: "csv",
    text: EMPLOYEES_CSV,
    note: "10 people, one row per employee — comma-separated with a header.",
  },
  {
    name: "departments",
    format: "json",
    text: DEPARTMENTS_JSON,
    note: "3 departments as a JSON array of objects, including a boolean and a budget.",
  },
  {
    name: "sales",
    format: "csv",
    text: SALES_CSV,
    note: "8 closed/open deals, each tied to an employee.",
  },
];

// Example queries, grouped by topic. `sql` is what runs; `note` is a one-liner
// shown alongside so people know what to look for in the plan.
const EXAMPLES = [
  {
    group: "Basics",
    title: "Filter and project",
    note: "A plain scan with a WHERE — the simplest possible plan.",
    sql: `select name, salary
from employees
where salary >= 80000
order by salary desc`,
  },
  {
    group: "Basics",
    title: "Constant folding",
    note: "The optimizer evaluates 50000 + 30000 once — compare the arithmetic in the logical vs physical plan.",
    sql: `select name, salary
from employees
where salary > 50000 + 30000`,
  },
  {
    group: "Joins",
    title: "Cross-format join (CSV ⋈ JSON)",
    note: "employees is CSV, departments is JSON — Calcite joins them without caring.",
    sql: `select e.name, d.dept_name
from employees e
join departments d on e.dept_id = d.dept_id
order by d.dept_name, e.name`,
  },
  {
    group: "Joins",
    title: "Filter pushdown",
    note: "The remote = true predicate starts above the join in the logical plan and sinks toward the scan after optimization.",
    sql: `select e.name, d.dept_name
from employees e
join departments d on e.dept_id = d.dept_id
where d.remote = true`,
  },
  {
    group: "Aggregates",
    title: "Headcount and average pay by department",
    note: "Join, group, aggregate — watch the optimizer pick a physical join and inject sorts.",
    sql: `select d.dept_name,
       count(*) as headcount,
       avg(e.salary) as avg_salary
from employees e
join departments d on e.dept_id = d.dept_id
group by d.dept_name
order by avg_salary desc`,
  },
  {
    group: "Aggregates",
    title: "Having clause",
    note: "A post-aggregate filter — see where HAVING lands relative to the group-by.",
    sql: `select dept_id, count(*) as n, max(salary) as top
from employees
group by dept_id
having count(*) > 2`,
  },
  {
    group: "Optimizer",
    title: "Top-N (ORDER BY + LIMIT)",
    note: "The logical Sort + Limit fuse into a single top-N operator that never sorts the whole table.",
    sql: `select name, salary
from employees
order by salary desc
limit 3`,
  },
  {
    group: "Optimizer",
    title: "Redundant predicate",
    note: "1 = 1 and an always-true OR are simplified away before execution.",
    sql: `select name
from employees
where 1 = 1 and (dept_id = 10 or true)`,
  },
  {
    group: "Cross-format",
    title: "Three-table join with aggregation",
    note: "employees (CSV) ⋈ departments (JSON) ⋈ sales (CSV): total closed revenue per department.",
    sql: `select d.dept_name,
       sum(s.amount) as revenue,
       count(distinct e.emp_id) as sellers
from sales s
join employees e on s.emp_id = e.emp_id
join departments d on e.dept_id = d.dept_id
where s.closed = true
group by d.dept_name
order by revenue desc`,
  },
  {
    group: "Cross-format",
    title: "Subquery: above-average earners",
    note: "A correlated-looking predicate the planner rewrites into a join against an aggregate.",
    sql: `select name, salary
from employees
where salary > (select avg(salary) from employees)
order by salary desc`,
  },
];

export { DATASETS, EXAMPLES };
