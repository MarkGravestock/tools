package demo;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

import dev.hardwood.InputFile;
import dev.hardwood.internal.reader.HardwoodContextImpl;
import dev.hardwood.internal.reader.Page;
import dev.hardwood.internal.reader.PageDecoder;
import dev.hardwood.internal.reader.PageInfo;
import dev.hardwood.internal.reader.PageSource;
import dev.hardwood.internal.reader.RowGroupIterator;
import dev.hardwood.internal.schema.ProjectedSchema;
import dev.hardwood.schema.ColumnProjection;
import dev.hardwood.schema.ColumnSchema;
import dev.hardwood.schema.FileSchema;

/// A deliberately single-threaded Parquet row reader built on Hardwood's
/// internal decode machinery.
///
/// Hardwood's public {@code RowReader} pipelines page fetch and decode across
/// virtual threads and a platform thread pool ({@code ColumnWorker}), which the
/// GraalVM Native Image WebAssembly backend cannot compile (threads are
/// unsupported on that platform). The underlying building blocks —
/// {@code RowGroupIterator} for footer/offset planning, {@code PageSource} for
/// page iteration, and {@code PageDecoder} for decompression + decoding — are
/// all synchronous, so this class drives them column by column on the caller
/// thread instead. Flat (non-nested) schemas only, which is all the demo needs.
public final class SyncParquetReader {

    /// Column names plus rows of already-formatted cell values.
    public record Table(List<String> columnNames, List<String[]> rows) {
    }

    private SyncParquetReader() {
    }

    public static Table read(InputFile inputFile) throws IOException {
        // The context's fixed thread pool is created lazily and this reader
        // never submits to it, so no thread is ever started — safe under wasm.
        try (HardwoodContextImpl context = HardwoodContextImpl.create(1)) {
            RowGroupIterator rowGroups = new RowGroupIterator(List.of(inputFile), context, 0L);
            FileSchema schema = rowGroups.openFirst();
            if (!schema.isFlatSchema()) {
                throw new IOException("SyncParquetReader only supports flat schemas, got: " + schema.getName());
            }
            ProjectedSchema projected = rowGroups.initialize(ColumnProjection.all(), null);

            int columnCount = projected.getProjectedColumnCount();
            List<String> names = new ArrayList<>(columnCount);
            List<List<String>> columns = new ArrayList<>(columnCount);
            for (int i = 0; i < columnCount; i++) {
                ColumnSchema column = projected.getProjectedColumn(i);
                names.add(column.name());
                columns.add(readColumn(rowGroups, i, context));
            }

            int rowCount = columns.isEmpty() ? 0 : columns.get(0).size();
            List<String[]> rows = new ArrayList<>(rowCount);
            for (int r = 0; r < rowCount; r++) {
                String[] row = new String[columnCount];
                for (int c = 0; c < columnCount; c++) {
                    row[c] = columns.get(c).get(r);
                }
                rows.add(row);
            }
            return new Table(names, rows);
        }
    }

    private static List<String> readColumn(RowGroupIterator rowGroups, int projectedIndex,
                                           HardwoodContextImpl context) throws IOException {
        List<String> values = new ArrayList<>();
        PageSource pages = new PageSource(rowGroups, projectedIndex);
        PageInfo pageInfo;
        while ((pageInfo = pages.next()) != null) {
            if (pageInfo.isNullPlaceholder()) {
                for (int i = 0; i < pageInfo.placeholderNumValues(); i++) {
                    values.add("null");
                }
                continue;
            }
            PageDecoder decoder = new PageDecoder(
                    pageInfo.columnMetaData(), pageInfo.columnSchema(), context.decompressorFactory());
            Page page = decoder.decodePage(pageInfo.pageData(), pageInfo.dictionary());
            ColumnSchema column = pageInfo.columnSchema();
            for (int i = 0; i < page.size(); i++) {
                values.add(ValueFormatter.format(page, i, column));
            }
        }
        return values;
    }
}
