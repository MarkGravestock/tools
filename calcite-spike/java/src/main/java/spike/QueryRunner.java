package spike;

import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Properties;

import org.apache.calcite.jdbc.CalciteConnection;
import org.apache.calcite.schema.SchemaPlus;

/**
 * Static facade called from JavaScript via CheerpJ library mode.
 * All inputs and outputs are strings (CSV in, JSON out) to keep the
 * JS/Java boundary trivial.
 */
public final class QueryRunner {

  private static final Map<String, CsvTable> TABLES = new LinkedHashMap<>();

  private QueryRunner() {}

  /**
   * Parses CSV text (first line = header) and registers it as a table.
   * Column types are inferred: INTEGER if every value parses as an int,
   * else DOUBLE, else VARCHAR. Returns a JSON description of the schema.
   */
  public static String registerCsv(String name, String csv) {
    try {
      CsvTable table = CsvTable.fromCsv(csv);
      TABLES.put(name.toUpperCase(), table);
      StringBuilder sb = new StringBuilder();
      sb.append("{\"table\":").append(Json.str(name.toUpperCase()))
        .append(",\"rowCount\":").append(table.rowCount())
        .append(",\"columns\":[");
      for (int i = 0; i < table.columnNames().size(); i++) {
        if (i > 0) sb.append(',');
        sb.append("{\"name\":").append(Json.str(table.columnNames().get(i)))
          .append(",\"type\":").append(Json.str(table.columnTypes().get(i).name()))
          .append('}');
      }
      return sb.append("]}").toString();
    } catch (Throwable t) {
      return Json.error(t);
    }
  }

  /** Runs a SQL query; returns {"columns":[...],"rows":[[...],...]} or {"error":...}. */
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

  /** Returns the physical plan for a query as {"plan":"..."} or {"error":...}. */
  public static String explain(String sql) {
    try (Connection conn = connect();
         Statement stmt = conn.createStatement();
         ResultSet rs = stmt.executeQuery("explain plan for " + sql)) {
      StringBuilder plan = new StringBuilder();
      while (rs.next()) {
        plan.append(rs.getString(1));
      }
      return "{\"plan\":" + Json.str(plan.toString()) + "}";
    } catch (Throwable t) {
      return Json.error(t);
    }
  }

  private static Connection connect() throws Exception {
    Properties props = new Properties();
    // Direct Driver instantiation: avoids DriverManager/ServiceLoader,
    // one less moving part under an unusual JVM.
    Connection conn =
        new org.apache.calcite.jdbc.Driver().connect("jdbc:calcite:", props);
    CalciteConnection calcite = conn.unwrap(CalciteConnection.class);
    SchemaPlus root = calcite.getRootSchema();
    for (Map.Entry<String, CsvTable> e : TABLES.entrySet()) {
      root.add(e.getKey(), e.getValue());
    }
    return calcite;
  }

  /** Minimal JSON encoding — avoids a serializer dependency at the boundary. */
  static final class Json {
    static String str(String s) {
      StringBuilder sb = new StringBuilder("\"");
      for (int i = 0; i < s.length(); i++) {
        char c = s.charAt(i);
        switch (c) {
          case '"': sb.append("\\\""); break;
          case '\\': sb.append("\\\\"); break;
          case '\n': sb.append("\\n"); break;
          case '\r': sb.append("\\r"); break;
          case '\t': sb.append("\\t"); break;
          default:
            if (c < 0x20) {
              sb.append(String.format("\\u%04x", (int) c));
            } else {
              sb.append(c);
            }
        }
      }
      return sb.append('"').toString();
    }

    static String value(Object o) {
      if (o == null) return "null";
      if (o instanceof Number || o instanceof Boolean) return o.toString();
      return str(o.toString());
    }

    static String error(Throwable t) {
      Throwable root = t;
      List<String> chain = new ArrayList<>();
      while (root != null) {
        String msg = root.getMessage();
        chain.add(root.getClass().getSimpleName() + (msg == null ? "" : ": " + msg));
        root = root.getCause();
      }
      return "{\"error\":" + str(String.join(" <- ", chain)) + "}";
    }

    private Json() {}
  }
}
