package demo;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;

import dev.hardwood.internal.reader.Page;
import dev.hardwood.metadata.LogicalType;
import dev.hardwood.metadata.PhysicalType;
import dev.hardwood.schema.ColumnSchema;

/// Renders a single decoded page value as a display string, using the column's
/// physical and logical type. Covers the types that show up in flat sample
/// files; anything unrecognized falls back to a raw representation.
final class ValueFormatter {

    private static final long JULIAN_EPOCH_DAY = 2_440_588L; // Julian day of 1970-01-01

    private ValueFormatter() {
    }

    static String format(Page page, int index, ColumnSchema column) {
        if (page.isNull(index)) {
            return "null";
        }
        return switch (page) {
            case Page.BooleanPage p -> String.valueOf(p.get(index));
            case Page.IntPage p -> formatInt(p.get(index), column);
            case Page.LongPage p -> formatLong(p.get(index), column);
            case Page.FloatPage p -> String.valueOf(p.get(index));
            case Page.DoublePage p -> String.valueOf(p.get(index));
            case Page.ByteArrayPage p -> formatBytes(p.get(index), column);
        };
    }

    private static String formatInt(int value, ColumnSchema column) {
        if (column.logicalType() instanceof LogicalType.DateType) {
            return LocalDate.ofEpochDay(value).toString();
        }
        return String.valueOf(value);
    }

    private static String formatLong(long value, ColumnSchema column) {
        if (column.logicalType() instanceof LogicalType.TimestampType ts) {
            long micros = switch (ts.unit()) {
                case MILLIS -> value * 1_000L;
                case MICROS -> value;
                case NANOS -> value / 1_000L;
            };
            LocalDateTime dt = LocalDateTime.ofEpochSecond(
                    Math.floorDiv(micros, 1_000_000L), (int) Math.floorMod(micros, 1_000_000L) * 1_000,
                    java.time.ZoneOffset.UTC);
            return dt.toString();
        }
        return String.valueOf(value);
    }

    private static String formatBytes(byte[] bytes, ColumnSchema column) {
        if (column.type() == PhysicalType.INT96 && bytes.length == 12) {
            return int96Timestamp(bytes);
        }
        LogicalType logical = column.logicalType();
        boolean stringy = logical instanceof LogicalType.StringType
                || logical instanceof LogicalType.EnumType
                || logical instanceof LogicalType.JsonType;
        if (stringy) {
            return quoted(new String(bytes, StandardCharsets.UTF_8));
        }
        // Impala-era sample files leave string columns unannotated; show them as
        // text when they decode cleanly as UTF-8, hex otherwise.
        if (column.type() == PhysicalType.BYTE_ARRAY) {
            try {
                return quoted(StandardCharsets.UTF_8.newDecoder()
                        .onMalformedInput(CodingErrorAction.REPORT)
                        .onUnmappableCharacter(CodingErrorAction.REPORT)
                        .decode(ByteBuffer.wrap(bytes)).toString());
            } catch (CharacterCodingException e) {
                // fall through to hex
            }
        }
        StringBuilder hex = new StringBuilder("0x");
        for (byte b : bytes) {
            hex.append(String.format("%02x", b));
        }
        return hex.toString();
    }

    /// Legacy INT96 timestamp: 8 bytes little-endian nanos-of-day followed by
    /// 4 bytes little-endian Julian day number.
    private static String int96Timestamp(byte[] bytes) {
        ByteBuffer buf = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN);
        long nanosOfDay = buf.getLong(0);
        int julianDay = buf.getInt(8);
        LocalDate date = LocalDate.ofEpochDay(julianDay - JULIAN_EPOCH_DAY);
        return LocalDateTime.of(date, LocalTime.ofNanoOfDay(nanosOfDay)).toString();
    }

    private static String quoted(String s) {
        return '"' + s + '"';
    }
}
