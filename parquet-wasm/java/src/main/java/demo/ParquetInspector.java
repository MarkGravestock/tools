package demo;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.util.List;

import dev.hardwood.InputFile;
import dev.hardwood.metadata.FileMetaData;
import dev.hardwood.reader.ParquetFileReader;
import dev.hardwood.schema.ColumnSchema;
import dev.hardwood.schema.FileSchema;

/// Reads a Parquet file's metadata, schema, and rows with Hardwood and renders
/// them as JSON. Shared by the JVM/Node entry points and the interactive wasm
/// build, so the exact same Java produces the exact same JSON everywhere.
///
/// Uses {@link SyncParquetReader} (single-threaded) because the wasm target
/// can't compile Hardwood's virtual-thread pipeline.
public final class ParquetInspector {

    private ParquetInspector() {
    }

    /// Inspects raw Parquet bytes; returns a JSON object, or {@code {"error":...}}.
    public static String inspectToJson(byte[] bytes) {
        try {
            ByteBuffer buffer = ByteBuffer.wrap(bytes);

            StringBuilder sb = new StringBuilder("{");
            appendMetadata(sb, buffer.duplicate());

            SyncParquetReader.Table table = SyncParquetReader.read(InputFile.of(buffer.duplicate()));
            sb.append(",\"rows\":");
            appendRows(sb, table);
            return sb.append("}").toString();
        } catch (Throwable t) {
            return "{\"error\":" + jsonStr(describe(t)) + "}";
        }
    }

    private static void appendMetadata(StringBuilder sb, ByteBuffer buffer) throws IOException {
        try (ParquetFileReader reader = ParquetFileReader.open(InputFile.of(buffer))) {
            FileMetaData meta = reader.getFileMetaData();
            FileSchema schema = reader.getFileSchema();

            sb.append("\"createdBy\":").append(jsonStr(meta.createdBy()))
              .append(",\"numRows\":").append(meta.numRows())
              .append(",\"rowGroups\":").append(meta.rowGroups().size())
              .append(",\"byteCount\":").append(buffer.capacity())
              .append(",\"columns\":[");

            List<ColumnSchema> columns = schema.getColumns();
            for (int i = 0; i < columns.size(); i++) {
                ColumnSchema column = columns.get(i);
                if (i > 0) sb.append(',');
                sb.append("{\"name\":").append(jsonStr(column.name()))
                  .append(",\"type\":").append(jsonStr(String.valueOf(column.type())))
                  .append(",\"logicalType\":")
                  .append(column.logicalType() == null ? "null" : jsonStr(String.valueOf(column.logicalType())))
                  .append('}');
            }
            sb.append(']');
        }
    }

    private static void appendRows(StringBuilder sb, SyncParquetReader.Table table) {
        sb.append("{\"columns\":[");
        List<String> names = table.columnNames();
        for (int i = 0; i < names.size(); i++) {
            if (i > 0) sb.append(',');
            sb.append(jsonStr(names.get(i)));
        }
        sb.append("],\"values\":[");
        List<String[]> rows = table.rows();
        for (int r = 0; r < rows.size(); r++) {
            if (r > 0) sb.append(',');
            sb.append('[');
            String[] row = rows.get(r);
            for (int c = 0; c < row.length; c++) {
                if (c > 0) sb.append(',');
                sb.append(jsonStr(row[c]));
            }
            sb.append(']');
        }
        sb.append("]}");
    }

    private static String describe(Throwable t) {
        String msg = t.getMessage();
        return t.getClass().getSimpleName() + (msg == null ? "" : ": " + msg);
    }

    /// Minimal JSON string encoding — keeps the boundary dependency-free.
    static String jsonStr(String s) {
        if (s == null) return "null";
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
                    if (c < 0x20) sb.append(String.format("\\u%04x", (int) c));
                    else sb.append(c);
            }
        }
        return sb.append('"').toString();
    }
}
