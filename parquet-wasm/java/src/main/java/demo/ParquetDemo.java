package demo;

import java.io.IOException;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.util.List;

import dev.hardwood.InputFile;
import dev.hardwood.metadata.FileMetaData;
import dev.hardwood.metadata.RowGroup;
import dev.hardwood.reader.ParquetFileReader;
import dev.hardwood.schema.ColumnSchema;
import dev.hardwood.schema.FileSchema;

/// Shared demo logic: loads the bundled Apache sample file
/// (`alltypes_plain.parquet` from `apache/parquet-testing`) from the classpath,
/// prints its metadata and schema via Hardwood's public reader API, then prints
/// every row. Row decoding is pluggable so the JVM entry point can use
/// Hardwood's threaded {@code RowReader} while the wasm entry point uses the
/// single-threaded {@link SyncParquetReader}.
final class ParquetDemo {

    static final String SAMPLE_RESOURCE = "/data/alltypes_plain.parquet";

    interface RowSource {
        SyncParquetReader.Table rows(ByteBuffer fileBytes) throws IOException;
    }

    private ParquetDemo() {
    }

    static void run(String runtimeLabel, RowSource rowSource) throws IOException {
        System.out.println("=== Hardwood Parquet demo (" + runtimeLabel + ") ===");
        System.out.println();

        ByteBuffer fileBytes = loadSample();
        System.out.println("Loaded " + SAMPLE_RESOURCE + " from classpath ("
                + fileBytes.remaining() + " bytes)");
        System.out.println();

        printMetadata(fileBytes.duplicate());

        SyncParquetReader.Table table = rowSource.rows(fileBytes.duplicate());
        printTable(table);
    }

    private static ByteBuffer loadSample() throws IOException {
        try (InputStream in = ParquetDemo.class.getResourceAsStream(SAMPLE_RESOURCE)) {
            if (in == null) {
                throw new IOException("Sample resource not found: " + SAMPLE_RESOURCE);
            }
            return ByteBuffer.wrap(in.readAllBytes());
        }
    }

    private static void printMetadata(ByteBuffer fileBytes) throws IOException {
        try (ParquetFileReader reader = ParquetFileReader.open(InputFile.of(fileBytes))) {
            FileMetaData meta = reader.getFileMetaData();
            FileSchema schema = reader.getFileSchema();

            System.out.println("created by : " + meta.createdBy());
            System.out.println("rows       : " + meta.numRows());
            List<RowGroup> rowGroups = meta.rowGroups();
            System.out.println("row groups : " + rowGroups.size());
            System.out.println();
            System.out.println("columns:");
            for (ColumnSchema column : schema.getColumns()) {
                String logical = column.logicalType() == null ? "" : "  (" + column.logicalType() + ")";
                System.out.printf("  %-18s %s%s%n", column.name(), column.type(), logical);
            }
            System.out.println();
        }
    }

    private static void printTable(SyncParquetReader.Table table) {
        List<String> names = table.columnNames();
        int columns = names.size();
        int[] widths = new int[columns];
        for (int c = 0; c < columns; c++) {
            widths[c] = names.get(c).length();
        }
        for (String[] row : table.rows()) {
            for (int c = 0; c < columns; c++) {
                widths[c] = Math.max(widths[c], row[c].length());
            }
        }

        StringBuilder header = new StringBuilder();
        for (int c = 0; c < columns; c++) {
            header.append(pad(names.get(c), widths[c])).append("  ");
        }
        System.out.println(header.toString().stripTrailing());
        System.out.println("-".repeat(header.toString().stripTrailing().length()));
        for (String[] row : table.rows()) {
            StringBuilder line = new StringBuilder();
            for (int c = 0; c < columns; c++) {
                line.append(pad(row[c], widths[c])).append("  ");
            }
            System.out.println(line.toString().stripTrailing());
        }
        System.out.println();
        System.out.println(table.rows().size() + " rows");
    }

    private static String pad(String s, int width) {
        return s + " ".repeat(width - s.length());
    }
}
