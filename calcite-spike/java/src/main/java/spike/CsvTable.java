package spike;

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
 * An in-memory Calcite table built from CSV text. Deliberately naive
 * (no quoting/escaping) — sample data for the spike is fully controlled.
 * Queries against it go through Calcite's normal Enumerable convention,
 * i.e. Janino-compiled generated code, which is exactly what the spike
 * needs to exercise.
 */
final class CsvTable extends AbstractTable implements ScannableTable {

  private final List<String> names;
  private final List<SqlTypeName> types;
  private final List<Object[]> rows;

  private CsvTable(List<String> names, List<SqlTypeName> types, List<Object[]> rows) {
    this.names = names;
    this.types = types;
    this.rows = rows;
  }

  static CsvTable fromCsv(String csv) {
    String[] lines = csv.trim().split("\r?\n");
    if (lines.length < 1 || lines[0].trim().isEmpty()) {
      throw new IllegalArgumentException("CSV needs a header line");
    }
    String[] header = lines[0].split(",");
    List<String> names = new ArrayList<>();
    for (String h : header) {
      names.add(h.trim().toUpperCase());
    }
    int width = names.size();

    List<String[]> raw = new ArrayList<>();
    for (int i = 1; i < lines.length; i++) {
      if (lines[i].trim().isEmpty()) continue;
      String[] cells = lines[i].split(",", -1);
      if (cells.length != width) {
        throw new IllegalArgumentException(
            "Row " + i + " has " + cells.length + " cells, expected " + width);
      }
      for (int c = 0; c < width; c++) {
        cells[c] = cells[c].trim();
      }
      raw.add(cells);
    }

    List<SqlTypeName> types = new ArrayList<>();
    for (int c = 0; c < width; c++) {
      types.add(inferType(raw, c));
    }

    List<Object[]> rows = new ArrayList<>();
    for (String[] cells : raw) {
      Object[] row = new Object[width];
      for (int c = 0; c < width; c++) {
        row[c] = convert(cells[c], types.get(c));
      }
      rows.add(row);
    }
    return new CsvTable(names, types, rows);
  }

  private static SqlTypeName inferType(List<String[]> raw, int col) {
    boolean allInt = true;
    boolean allDouble = true;
    boolean any = false;
    for (String[] cells : raw) {
      String v = cells[col];
      if (v.isEmpty()) continue;
      any = true;
      if (allInt) {
        try { Integer.parseInt(v); } catch (NumberFormatException e) { allInt = false; }
      }
      if (allDouble) {
        try { Double.parseDouble(v); } catch (NumberFormatException e) { allDouble = false; }
      }
    }
    if (!any) return SqlTypeName.VARCHAR;
    if (allInt) return SqlTypeName.INTEGER;
    if (allDouble) return SqlTypeName.DOUBLE;
    return SqlTypeName.VARCHAR;
  }

  private static Object convert(String v, SqlTypeName type) {
    if (v.isEmpty()) return null;
    switch (type) {
      case INTEGER: return Integer.valueOf(v);
      case DOUBLE: return Double.valueOf(v);
      default: return v;
    }
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
}
