package demo;

import java.util.Base64;
import java.util.function.Function;

import org.graalvm.webimage.api.JS;
import org.graalvm.webimage.api.JSString;

/// Interactive entry point for the GraalVM Native Image WebAssembly build.
///
/// Instead of auto-running a fixed sample, it publishes a Java function to
/// JavaScript: `globalThis.parquetInspect(base64) -> jsonString`. The page hands
/// it a dropped file's bytes (base64-encoded, so the boundary stays a plain
/// string) and Hardwood — running as WebAssembly — returns the file's schema,
/// metadata, and rows as JSON.
///
/// Build with `-H:-AutoRunVM` so `main` (which registers the function) runs when
/// JavaScript calls `GraalVM.run([])`, rather than on module load.
public final class InteractiveInspector {

    @JS(args = {"inspect"}, value = "globalThis.parquetInspect = inspect;")
    private static native void register(Function<JSString, JSString> inspect);

    public static void main(String[] args) {
        // Hardwood logs through java.util.logging; on wasm the console handler
        // dies in StackWalker.walk while inferring the caller. Drop the handlers.
        java.util.logging.LogManager.getLogManager().reset();

        register(base64 -> JSString.of(inspect(base64.asString())));
    }

    private static String inspect(String base64) {
        try {
            byte[] bytes = Base64.getDecoder().decode(base64);
            return ParquetInspector.inspectToJson(bytes);
        } catch (Throwable t) {
            return "{\"error\":" + ParquetInspector.jsonStr("Could not read file: " + t) + "}";
        }
    }

    private InteractiveInspector() {
    }
}
