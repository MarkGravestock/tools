package demo;

import java.io.IOException;

import dev.hardwood.InputFile;

/// Entry point for the GraalVM Native Image WebAssembly build (and equally
/// runnable on a JVM). Uses {@link SyncParquetReader} because the wasm target
/// is single-threaded: Hardwood's regular {@code RowReader} pipeline needs
/// virtual threads plus a platform thread pool, which the wasm backend cannot
/// compile.
public class WasmDemo {

    public static void main(String[] args) throws IOException {
        // Hardwood logs through java.util.logging; on the wasm target the
        // console handler dies in StackWalker.walk while inferring the caller,
        // spraying a harmless but ugly stack trace. Drop the handlers.
        java.util.logging.LogManager.getLogManager().reset();

        ParquetDemo.run("single-threaded reader, wasm-compatible",
                fileBytes -> SyncParquetReader.read(InputFile.of(fileBytes)));
    }
}
