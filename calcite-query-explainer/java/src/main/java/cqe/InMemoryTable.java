package cqe;

import java.util.ArrayList;
import java.util.List;

import org.apache.calcite.DataContext;
import org.apache.calcite.linq4j.Enumerable;
import org.apache.calcite.linq4j.Linq4j;
import org.apache.calcite.rel.type.RelDataType;
import org.apache.calcite.rel.type.RelDataTypeFactory;
import org.apache.calcite.schema.ScannableTable;
import org.apache.calcite.schema.impl.AbstractTable;
import org.apache.calcite.sql.type.SqlTypeName;

/**
 * A column-typed, in-memory Calcite table. Rows are plain Object[] and scanning
 * goes through the normal Enumerable convention, so queries exercise the same
 * Janino-compiled code path as any other Calcite source.
 */
final class InMemoryTable extends AbstractTable implements ScannableTable {

  private final List<String> names;
  private final List<SqlTypeName> types;
  private final List<Object[]> rows;

  InMemoryTable(List<String> names, List<SqlTypeName> types, List<Object[]> rows) {
    this.names = names;
    this.types = types;
    this.rows = rows;
  }

  List<String> columnNames() { return names; }
  List<SqlTypeName> columnTypes() { return types; }
  int rowCount() { return rows.size(); }

  @Override public RelDataType getRowType(RelDataTypeFactory typeFactory) {
    RelDataTypeFactory.Builder builder = typeFactory.builder();
    for (int i = 0; i < names.size(); i++) {
      builder.add(names.get(i),
          typeFactory.createTypeWithNullability(
              typeFactory.createSqlType(types.get(i)), true));
    }
    return builder.build();
  }

  @Override public Enumerable<Object[]> scan(DataContext root) {
    return Linq4j.asEnumerable(rows);
  }

  /** Infers a column type from a sample of raw string values (empty = null). */
  static SqlTypeName inferFromStrings(List<String> values) {
    boolean allInt = true;
    boolean allDouble = true;
    boolean allBool = true;
    boolean any = false;
    for (String v : values) {
      if (v == null || v.isEmpty()) continue;
      any = true;
      if (allInt) {
        try { Long.parseLong(v); } catch (NumberFormatException e) { allInt = false; }
      }
      if (allDouble) {
        try { Double.parseDouble(v); } catch (NumberFormatException e) { allDouble = false; }
      }
      if (allBool && !v.equalsIgnoreCase("true") && !v.equalsIgnoreCase("false")) {
        allBool = false;
      }
    }
    if (!any) return SqlTypeName.VARCHAR;
    if (allBool) return SqlTypeName.BOOLEAN;
    if (allInt) return SqlTypeName.BIGINT;
    if (allDouble) return SqlTypeName.DOUBLE;
    return SqlTypeName.VARCHAR;
  }

  /** Coerces a raw string to the column's Java type; empty string becomes null. */
  static Object coerce(String v, SqlTypeName type) {
    if (v == null || v.isEmpty()) return null;
    switch (type) {
      case BIGINT: return Long.valueOf(v);
      case DOUBLE: return Double.valueOf(v);
      case BOOLEAN: return Boolean.valueOf(v.equalsIgnoreCase("true"));
      default: return v;
    }
  }

  static List<String> column(List<String[]> rows, int col) {
    List<String> out = new ArrayList<>(rows.size());
    for (String[] r : rows) out.add(r[col]);
    return out;
  }
}
