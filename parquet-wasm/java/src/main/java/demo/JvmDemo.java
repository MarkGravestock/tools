package demo;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

import dev.hardwood.InputFile;
import dev.hardwood.reader.ParquetFileReader;
import dev.hardwood.reader.RowReader;
import dev.hardwood.schema.ColumnSchema;

/// Entry point for a regular JVM run. Uses Hardwood's public {@code RowReader}
/// API, which decodes pages in parallel on virtual threads — the way the
/// library is meant to be used when threads are available.
public class JvmDemo {

    public static void main(String[] args) throws IOException {
        ParquetDemo.run("multi-threaded RowReader, JVM", fileBytes -> {
            try (ParquetFileReader reader = ParquetFileReader.open(InputFile.of(fileBytes));
                 RowReader rows = reader.rowReader()) {
                List<ColumnSchema> columns = reader.getFileSchema().getColumns();
                List<String> names = new ArrayList<>(columns.size());
                for (ColumnSchema column : columns) {
                    names.add(column.name());
                }
                List<String[]> data = new ArrayList<>();
                while (rows.hasNext()) {
                    rows.next();
                    String[] row = new String[columns.size()];
                    for (int c = 0; c < columns.size(); c++) {
                        Object value = rows.getValue(c);
                        row[c] = switch (value) {
                            case null -> "null";
                            case byte[] bytes -> '"' + new String(bytes, java.nio.charset.StandardCharsets.UTF_8) + '"';
                            default -> String.valueOf(value);
                        };
                    }
                    data.add(row);
                }
                return new SyncParquetReader.Table(names, data);
            }
        });
    }
}
