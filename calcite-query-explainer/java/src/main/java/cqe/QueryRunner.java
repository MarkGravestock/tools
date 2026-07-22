package cqe;

import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.Statement;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Properties;
import java.util.function.Consumer;

import org.apache.calcite.jdbc.CalciteConnection;
import org.apache.calcite.plan.RelOptListener;
import org.apache.calcite.plan.RelOptPlanner;
import org.apache.calcite.runtime.Hook;
import org.apache.calcite.schema.SchemaPlus;

/**
 * Static facade called from JavaScript through CheerpJ library mode. Every
 * method takes and returns strings (table data in, JSON out) so the JS/Java
 * boundary stays trivial.
 *
 * <p>Registered tables live in a static map and are attached to a fresh
 * Calcite connection per call, so the schema is stateless between queries
 * apart from the table catalogue itself.
 */
public final class QueryRunner {

  private static final Map<String, InMemoryTable> TABLES = new LinkedHashMap<>();

  private QueryRunner() {}

  /** Registers CSV text (header row first) under {@code name}; returns a schema summary. */
  public static String registerCsv(String name, String csv) {
    try {
      return register(name, Tables.fromCsv(csv));
    } catch (Throwable t) {
      return Json.error(t);
    }
  }

  /** Registers a JSON array of objects under {@code name}; returns a schema summary. */
  public static String registerJson(String name, String json) {
    try {
      return register(name, Tables.fromJson(json));
    } catch (Throwable t) {
      return Json.error(t);
    }
  }

  /** Forgets every registered table. Returns "{}" so the caller can await it uniformly. */
  public static String reset() {
    TABLES.clear();
    return "{}";
  }

  private static String register(String name, InMemoryTable table) {
    String key = table == null ? name : name.trim().toUpperCase();
    TABLES.put(key, table);
    StringBuilder sb = new StringBuilder("{\"table\":").append(Json.str(key))
        .append(",\"rowCount\":").append(table.rowCount())
        .append(",\"columns\":[");
    for (int i = 0; i < table.columnNames().size(); i++) {
      if (i > 0) sb.append(',');
      sb.append("{\"name\":").append(Json.str(table.columnNames().get(i)))
        .append(",\"type\":").append(Json.str(table.columnTypes().get(i).getName()))
        .append('}');
    }
    return sb.append("]}").toString();
  }

  /** Runs a query; returns {@code {"columns":[...],"rows":[[...]]}} or {@code {"error":...}}. */
  public static String run(String sql) {
    try (Connection conn = connect();
         Statement stmt = conn.createStatement();
         ResultSet rs = stmt.executeQuery(sql)) {
      ResultSetMetaData md = rs.getMetaData();
      int n = md.getColumnCount();
      StringBuilder sb = new StringBuilder("{\"columns\":[");
      for (int i = 1; i <= n; i++) {
        if (i > 1) sb.append(',');
        sb.append(Json.str(md.getColumnLabel(i)));
      }
      sb.append("],\"rows\":[");
      boolean firstRow = true;
      while (rs.next()) {
        if (!firstRow) sb.append(',');
        firstRow = false;
        sb.append('[');
        for (int i = 1; i <= n; i++) {
          if (i > 1) sb.append(',');
          sb.append(Json.value(rs.getObject(i)));
        }
        sb.append(']');
      }
      return sb.append("]}").toString();
    } catch (Throwable t) {
      return Json.error(t);
    }
  }

  /**
   * Returns both planning stages as {@code {"logical":"...","physical":"..."}}:
   * the logical relational algebra before physical optimization, and the
   * optimized Enumerable plan the engine actually runs — the before/after of
   * Calcite's planner.
   */
  public static String explain(String sql) {
    try (Connection conn = connect()) {
      String logical = explainText(conn, "explain plan without implementation for " + sql);
      String physical = explainText(conn, "explain plan for " + sql);
      return "{\"logical\":" + Json.str(logical)
          + ",\"physical\":" + Json.str(physical) + "}";
    } catch (Throwable t) {
      return Json.error(t);
    }
  }

  /**
   * Returns the planner rules that fired while optimizing the query, as
   * {@code {"rules":[{"rule":"…","count":n}, …]}} in the order first seen.
   *
   * <p>Rather than rebuild a planner, this hooks the very one the JDBC path
   * uses ({@link Hook#PLANNER}) and attaches a listener, then triggers planning
   * with {@code EXPLAIN} — so the rule list matches the physical plan exactly.
   */
  public static String rules(String sql) {
    final Map<String, int[]> counts = new LinkedHashMap<>();
    RelOptListener listener = new RuleCounter(counts);
    Consumer<RelOptPlanner> attach = (planner) -> planner.addListener(listener);
    try (Hook.Closeable ignored = Hook.PLANNER.addThread(attach)) {
      try (Connection conn = connect();
           Statement stmt = conn.createStatement()) {
        stmt.executeQuery("explain plan for " + sql).close();
      }
    } catch (Throwable t) {
      return Json.error(t);
    }
    StringBuilder sb = new StringBuilder("{\"rules\":[");
    boolean first = true;
    for (Map.Entry<String, int[]> e : counts.entrySet()) {
      if (!first) sb.append(',');
      first = false;
      sb.append("{\"rule\":").append(Json.str(e.getKey()))
        .append(",\"count\":").append(e.getValue()[0]).append('}');
    }
    return sb.append("]}").toString();
  }

  /** Tallies successful rule firings; other planner events are ignored. */
  private static final class RuleCounter implements RelOptListener {
    private final Map<String, int[]> counts;
    RuleCounter(Map<String, int[]> counts) { this.counts = counts; }

    @Override public void ruleProductionSucceeded(RuleProductionEvent event) {
      if (event.isBefore()) return; // fires twice per production; count once
      String name = event.getRuleCall().getRule().toString();
      counts.computeIfAbsent(name, k -> new int[1])[0]++;
    }

    @Override public void ruleAttempted(RuleAttemptedEvent event) {}
    @Override public void relEquivalenceFound(RelEquivalenceEvent event) {}
    @Override public void relChosen(RelChosenEvent event) {}
    @Override public void relDiscarded(RelDiscardedEvent event) {}
  }

  private static String explainText(Connection conn, String explainSql) throws Exception {
    try (Statement stmt = conn.createStatement();
         ResultSet rs = stmt.executeQuery(explainSql)) {
      StringBuilder plan = new StringBuilder();
      while (rs.next()) {
        plan.append(rs.getString(1));
      }
      return plan.toString();
    }
  }

  private static Connection connect() throws Exception {
    Properties props = new Properties();
    props.setProperty("caseSensitive", "false");
    // Instantiate the Driver directly — avoids DriverManager/ServiceLoader,
    // one less moving part under CheerpJ's JVM.
    Connection conn = new org.apache.calcite.jdbc.Driver().connect("jdbc:calcite:", props);
    CalciteConnection calcite = conn.unwrap(CalciteConnection.class);
    SchemaPlus root = calcite.getRootSchema();
    for (Map.Entry<String, InMemoryTable> e : TABLES.entrySet()) {
      root.add(e.getKey(), e.getValue());
    }
    return calcite;
  }
}
