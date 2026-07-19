// ---- Example database & example queries ------------------------------------
// A small web-shop schema: 20k customers, 2k products, 100k orders,
// ~200k order items, 30k events in a partitioned table.

const EXAMPLE_DB_STEPS = [
  ['Creating customers (20,000 rows)', `
create table customers (
  id int primary key,
  name text not null,
  country text not null,
  tier text not null,
  signed_up date not null
);
insert into customers
select i, 'customer_'||i,
  (array['GB','IE','FR','DE','US','JP','AU','BR'])[1 + i % 8],
  case when i % 20 = 0 then 'platinum' when i % 5 = 0 then 'gold' else 'standard' end,
  date '2020-01-01' + (i % 2000)
from generate_series(1, 20000) i;
create index customers_country_idx on customers (country);`],

  ['Creating products (2,000 rows)', `
create table products (
  id int primary key,
  name text not null,
  category text not null,
  price numeric(10,2) not null
);
insert into products
select i, 'product_'||i,
  (array['books','audio','cycling','photo','outdoors','kitchen'])[1 + i % 6],
  (50 + (i * 37) % 950)::numeric / 10
from generate_series(1, 2000) i;`],

  ['Creating orders (100,000 rows + 4 indexes)', `
create table orders (
  id int primary key,
  customer_id int not null references customers(id),
  status text not null,
  placed_at timestamptz not null,
  total numeric(12,2) not null
);
insert into orders
select i, 1 + (i * 7919) % 20000,
  case when i % 50 = 0 then 'cancelled' when i % 11 = 0 then 'pending' else 'shipped' end,
  timestamptz '2024-01-01' + ((i % 730) || ' days')::interval + ((i % 24) || ' hours')::interval,
  ((i * 131) % 90000)::numeric / 100 + 5
from generate_series(1, 100000) i;
create index orders_customer_idx on orders (customer_id);
create index orders_placed_at_idx on orders (placed_at);
create index orders_status_idx on orders (status);
create index orders_cust_placed_idx on orders (customer_id, placed_at);`],

  ['Creating order_items (~200,000 rows)', `
create table order_items (
  order_id int not null,
  line_no int not null,
  product_id int not null references products(id),
  qty int not null,
  primary key (order_id, line_no)
);
create index order_items_product_idx on order_items (product_id);
insert into order_items
select o.i, ln, 1 + (o.i * ln * 31) % 2000, 1 + (o.i + ln) % 5
from generate_series(1, 100000) o(i), generate_series(1, 1 + o.i % 3) ln;`],

  ['Creating events (partitioned, 30,000 rows)', `
create table events (
  id bigint generated always as identity,
  occurred_on date not null,
  kind text not null,
  payload text
) partition by range (occurred_on);
create table events_2025 partition of events for values from ('2025-01-01') to ('2026-01-01');
create table events_2026 partition of events for values from ('2026-01-01') to ('2027-01-01');
insert into events (occurred_on, kind, payload)
select date '2025-03-01' + (i % 500), (array['login','purchase','refund','view'])[1 + i % 4], 'p'||i
from generate_series(1, 30000) i;
create index events_kind_idx on events (kind);`],
  ['Creating doc_embeddings (4,000 vectors + HNSW index)', `
create extension if not exists vector;
create table doc_embeddings (
  id int primary key,
  topic text not null,
  embedding vector(8) not null
);
insert into doc_embeddings
select i,
  (array['kafka','spring','postgres','k8s'])[1 + i % 4],
  array[(i%7)::float, (i%13)::float, (i%5)::float, (i%11)::float,
        (i%3)::float, (i%17)::float, (i%2)::float, (i%19)::float]::vector
from generate_series(1, 4000) i;
create index doc_embeddings_hnsw on doc_embeddings using hnsw (embedding vector_l2_ops);`],
];

const EXAMPLES = [
  { group: 'Scans', title: 'Sequential scan — read the whole table', sql:
`-- No index can help with an inequality on an unindexed column,
-- so Postgres reads all 100,000 rows.
select count(*) from orders where total > 400;` },

  { group: 'Scans', title: 'Index scan — primary key lookup', sql:
`-- One B-tree descent, one heap fetch. As fast as it gets for a single row.
select * from orders where id = 4242;` },

  { group: 'Scans', title: 'Index only scan — the table is never touched', sql:
`-- orders_cust_placed_idx contains both columns the query needs,
-- and provides the requested order for free. Watch "Heap Fetches: 0".
select customer_id, placed_at from orders
where customer_id = 77
order by placed_at;` },

  { group: 'Scans', title: 'Bitmap scan — medium selectivity', sql:
`-- ~9% of rows match: too many for row-at-a-time index scans, too few
-- for a full scan. The bitmap fetches heap pages in physical order.
select avg(total) from orders where status = 'pending';` },

  { group: 'Scans', title: 'BitmapOr — combining two indexes for an OR', sql:
`-- A single B-tree can't serve an OR across different columns.
-- Postgres scans both indexes, ORs the bitmaps, then visits the heap once.
select count(*) from orders
where status = 'pending' or placed_at > '2025-12-01';` },

  { group: 'Scans', title: 'TID scan — fetch by physical row address', sql:
`-- ctid is (page, item). No index, no scan: straight to the page.
select ctid, * from orders where ctid = '(0,1)';` },

  { group: 'Joins', title: 'Nested loop — small outer side drives index lookups', sql:
`-- 11 customers on the outer side; for each, an index probe into orders.
select c.name, o.total
from customers c
join orders o on o.customer_id = c.id
where c.id between 100 and 110;` },

  { group: 'Joins', title: 'Hash join — the workhorse for big joins', sql:
`-- All customers are hashed into memory, then 100k orders probe the table.
select c.country, sum(o.total)
from customers c
join orders o on o.customer_id = c.id
group by c.country;` },

  { group: 'Joins', title: 'Merge join — both sides already sorted', sql:
`-- Both inputs can arrive sorted on the join key via their primary keys,
-- so Postgres just zips them together. The LIMIT stops it early.
select o.id, oi.product_id
from orders o
join order_items oi on oi.order_id = o.id
order by o.id
limit 50;` },

  { group: 'Joins', title: 'Semi join — EXISTS never multiplies rows', sql:
`-- Each customer is emitted at most once, however many cancelled
-- orders they have. Note "Hash Join (Semi)" vs a plain join + DISTINCT.
select count(*) from customers c
where exists (
  select 1 from orders o
  where o.customer_id = c.id and o.status = 'cancelled'
);` },

  { group: 'Joins', title: 'Anti join — NOT EXISTS', sql:
`-- Customers with no orders at all. The join emits only outer rows
-- with zero matches.
select count(*) from customers c
where not exists (select 1 from orders o where o.customer_id = c.id);` },

  { group: 'Joins', title: 'Memoize — caching repeated inner lookups', sql:
`-- product_id repeats constantly in order_items, so with hash join
-- disabled the nested loop caches inner rows per key. Watch the hit rate.
set enable_hashjoin = off;
set enable_mergejoin = off;
select oi.order_id, p.price
from order_items oi
join products p on p.id = oi.product_id
where oi.order_id between 1 and 500;` },

  { group: 'Joins', title: 'Materialize — buffering a rescanned inner side', sql:
`-- The distinct-status subquery is computed once, buffered, and replayed
-- for each of the 3 outer rows.
select c.id, s.status
from customers c
cross join (select distinct status from orders) s
where c.id <= 3;` },

  { group: 'Sorting', title: 'Top-N heapsort — LIMIT changes everything', sql:
`-- Only the 10 current-best rows are kept in memory while scanning,
-- instead of sorting all 100,000.
select * from orders order by total desc limit 10;` },

  { group: 'Sorting', title: 'External merge sort — spilling to disk', sql:
`-- Sorting ~200k rows by a computed key exceeds work_mem (4 MB here),
-- so the sort runs as an on-disk merge. Amber warning expected.
select * from order_items
order by md5(order_id::text || line_no::text);` },

  { group: 'Sorting', title: 'Incremental sort — finishing a partial order', sql:
`-- The index provides customer_id order; only ties need sorting by total.
select * from orders order by customer_id, total limit 20;` },

  { group: 'Grouping', title: 'HashAggregate — GROUP BY via hash table', sql:
`-- Three groups, built in a hash table; input order is irrelevant.
select status, count(*), avg(total) from orders group by status;` },

  { group: 'Grouping', title: 'GroupAggregate — GROUP BY over sorted input', sql:
`-- The index delivers customer_id in order, so each group completes as
-- soon as the key changes — and the LIMIT can stop the scan early.
select customer_id, count(*) from orders
group by customer_id
order by customer_id
limit 10;` },

  { group: 'Grouping', title: 'DISTINCT via Unique node', sql:
`-- Sorted input from the index means duplicates are adjacent —
-- the Unique node just skips repeats.
select distinct customer_id from orders order by customer_id limit 10;` },

  { group: 'Grouping', title: 'Window function — rank within partitions', sql:
`-- WindowAgg needs rows ordered by (status, total desc); an index
-- provides part of it, Incremental Sort finishes the job.
select id, status, total,
       rank() over (partition by status order by total desc)
from orders
limit 20;` },

  { group: 'CTEs & subqueries', title: 'Materialized CTE — computed once, then scanned', sql:
`-- AS MATERIALIZED forces the CTE to be computed and stored;
-- the outer query reads it via a CTE Scan and filters afterwards.
with spend as materialized (
  select customer_id, sum(total) as total_spend
  from orders group by customer_id
)
select * from spend where total_spend > 1000 limit 5;` },

  { group: 'CTEs & subqueries', title: 'Inlined CTE — same query, no fence', sql:
`-- Without MATERIALIZED, Postgres (12+) inlines the CTE into the outer
-- query. Compare: no CTE Scan node, and the filter is a HAVING inside
-- the aggregate.
with spend as (
  select customer_id, sum(total) as total_spend
  from orders group by customer_id
)
select * from spend where total_spend > 1000 limit 5;` },

  { group: 'CTEs & subqueries', title: 'Recursive CTE — iterate until fixpoint', sql:
`-- Recursive Union runs the seed once, then loops the recursive term
-- against the working table. WorkTable Scan shows 100 iterations.
with recursive t(n) as (
  values (1)
  union all
  select n + 1 from t where n < 100
)
select sum(n) from t;` },

  { group: 'Partitions & sets', title: 'Partition pruning — untouched partitions vanish', sql:
`-- The WHERE clause proves only events_2026 can match, so events_2025
-- never appears in the plan at all.
select kind, count(*) from events
where occurred_on >= '2026-01-01'
group by kind;` },

  { group: 'Partitions & sets', title: 'Append — reading multiple partitions', sql:
`-- This range spans both partitions: each surviving partition becomes
-- one child of the Append node.
select kind, count(*) from events
where occurred_on between '2025-11-01' and '2026-03-01'
group by kind;` },

  { group: 'Partitions & sets', title: 'EXCEPT via SetOp', sql:
`-- Countries with platinum customers but no gold ones.
select country from customers where tier = 'platinum'
except
select country from customers where tier = 'gold';` },

  { group: 'Partitions & sets', title: 'VALUES list joined to a real table', sql:
`-- An inline table in the query itself, hashed and probed like any other.
select v.code, count(o.id)
from (values ('pending'), ('cancelled')) v(code)
join orders o on o.status = v.code
group by v.code;` },

  { group: 'Planner pitfalls', title: 'Correlated predicates — why estimates go wrong', sql:
`-- The planner multiplies the selectivities of the two conditions as if
-- they were independent. Compare estimated vs actual rows on the scan.
select count(*) from orders
where status = 'cancelled' and id % 50 = 0;` },

  { group: 'Planner pitfalls', title: 'Function scan — the planner is guessing', sql:
`-- Postgres has no statistics for a function's output. Estimates for
-- set-returning functions are essentially hard-coded guesses.
select max(x) from generate_series(1, 5000) g(x);` },
];

EXAMPLES.push(
  { group: 'Vector search (pgvector)', title: 'HNSW index — approximate nearest neighbour', sql:
`-- The <-> (L2 distance) ORDER BY + LIMIT pattern is what HNSW serves.
-- Note "Order By" on the Index Scan: the index returns rows in
-- (approximate) distance order, so no Sort node is needed.
select id, topic, embedding <-> '[1,2,3,4,5,6,1,2]' as distance
from doc_embeddings
order by embedding <-> '[1,2,3,4,5,6,1,2]'
limit 5;` },

  { group: 'Vector search (pgvector)', title: 'Exact search — same query, no index', sql:
`-- With the index disabled you get the exact answer: a full scan
-- computing 4,000 distances, then a top-N heapsort. Compare the
-- results with the HNSW example — approximate means approximate.
set enable_indexscan = off;
select id, topic, embedding <-> '[1,2,3,4,5,6,1,2]' as distance
from doc_embeddings
order by embedding <-> '[1,2,3,4,5,6,1,2]'
limit 5;` },

  { group: 'Vector search (pgvector)', title: 'Filtered ANN — the post-filter gotcha', sql:
`-- The WHERE clause is applied *after* the index returns candidates in
-- distance order. Watch "Rows Removed by Filter": with a selective
-- filter, HNSW walks more of the graph — and can even return fewer
-- rows than your LIMIT asked for.
select id, topic, embedding <-> '[1,2,3,4,5,6,1,2]' as distance
from doc_embeddings
where topic = 'kafka'
order by embedding <-> '[1,2,3,4,5,6,1,2]'
limit 5;` }
);

export { EXAMPLE_DB_STEPS, EXAMPLES };
