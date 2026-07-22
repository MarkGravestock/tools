package cqe;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import org.apache.calcite.sql.type.SqlTypeName;

/** Builds {@link InMemoryTable}s from CSV or JSON text. */
final class Tables {

  private static final ObjectMapper MAPPER = new ObjectMapper();

  /**
   * CSV with a header row. Deliberately naive splitting (no quoted commas) —
   * sample data is controlled, and users pasting rich CSV can use JSON instead.
   */
  static InMemoryTable fromCsv(String csv) {
    String[] lines = csv.replace("﻿", "").trim().split("\r?\n");
    if (lines.length == 0 || lines[0].trim().isEmpty()) {
      throw new IllegalArgumentException("CSV needs a header line");
    }
    String[] header = lines[0].split(",", -1);
    List<String> names = new ArrayList<>();
    for (String h : header) names.add(normalise(h));
    int width = names.size();

    List<String[]> raw = new ArrayList<>();
    for (int i = 1; i < lines.length; i++) {
      if (lines[i].trim().isEmpty()) continue;
      String[] cells = lines[i].split(",", -1);
      if (cells.length != width) {
        throw new IllegalArgumentException(
            "Row " + i + " has " + cells.length + " values, expected " + width);
      }
      for (int c = 0; c < width; c++) cells[c] = cells[c].trim();
      raw.add(cells);
    }

    List<SqlTypeName> types = new ArrayList<>();
    for (int c = 0; c < width; c++) {
      types.add(InMemoryTable.inferFromStrings(InMemoryTable.column(raw, c)));
    }
    List<Object[]> rows = new ArrayList<>();
    for (String[] cells : raw) {
      Object[] row = new Object[width];
      for (int c = 0; c < width; c++) row[c] = InMemoryTable.coerce(cells[c], types.get(c));
      rows.add(row);
    }
    return new InMemoryTable(names, types, rows);
  }

  /**
   * A JSON array of flat objects, e.g. {@code [{"id":1,"name":"Ann"}, ...]}.
   * Columns are the union of keys in first-seen order; types come from the
   * JSON value kinds (a column with any string becomes VARCHAR).
   */
  static InMemoryTable fromJson(String json) {
    JsonNode root;
    try {
      root = MAPPER.readTree(json);
    } catch (Exception e) {
      throw new IllegalArgumentException("Invalid JSON: " + e.getMessage());
    }
    if (root == null || !root.isArray()) {
      throw new IllegalArgumentException("JSON must be an array of objects");
    }

    Set<String> keys = new LinkedHashSet<>();
    for (JsonNode row : root) {
      if (!row.isObject()) throw new IllegalArgumentException("Each JSON element must be an object");
      row.fieldNames().forEachRemaining(keys::add);
    }
    List<String> names = new ArrayList<>();
    List<String> originalKeys = new ArrayList<>(keys);
    for (String k : originalKeys) names.add(normalise(k));

    List<SqlTypeName> types = new ArrayList<>();
    for (String key : originalKeys) types.add(inferJson(root, key));

    List<Object[]> rows = new ArrayList<>();
    for (JsonNode row : root) {
      Object[] out = new Object[originalKeys.size()];
      for (int c = 0; c < originalKeys.size(); c++) {
        out[c] = jsonValue(row.get(originalKeys.get(c)), types.get(c));
      }
      rows.add(out);
    }
    return new InMemoryTable(names, types, rows);
  }

  private static SqlTypeName inferJson(JsonNode array, String key) {
    boolean allInt = true;
    boolean allNum = true;
    boolean allBool = true;
    boolean any = false;
    for (JsonNode row : array) {
      JsonNode v = row.get(key);
      if (v == null || v.isNull() || v.isMissingNode()) continue;
      any = true;
      if (!v.isIntegralNumber()) allInt = false;
      if (!v.isNumber()) allNum = false;
      if (!v.isBoolean()) allBool = false;
    }
    if (!any) return SqlTypeName.VARCHAR;
    if (allBool) return SqlTypeName.BOOLEAN;
    if (allInt) return SqlTypeName.BIGINT;
    if (allNum) return SqlTypeName.DOUBLE;
    return SqlTypeName.VARCHAR;
  }

  private static Object jsonValue(JsonNode v, SqlTypeName type) {
    if (v == null || v.isNull() || v.isMissingNode()) return null;
    switch (type) {
      case BIGINT: return v.asLong();
      case DOUBLE: return v.asDouble();
      case BOOLEAN: return v.asBoolean();
      default: return v.isValueNode() ? v.asText() : v.toString();
    }
  }

  /** Column names become upper-case SQL identifiers with non-word chars as underscores. */
  private static String normalise(String raw) {
    String s = raw.trim().replaceAll("[^A-Za-z0-9_]", "_").toUpperCase();
    if (s.isEmpty()) s = "COL";
    if (Character.isDigit(s.charAt(0))) s = "_" + s;
    return s;
  }

  private Tables() {}
}
