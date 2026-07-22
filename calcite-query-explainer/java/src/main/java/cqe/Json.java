package cqe;

import java.util.ArrayList;
import java.util.List;

/** Minimal JSON output encoding — keeps the JS/Java boundary a plain string. */
final class Json {

  static String str(String s) {
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
          if (c < 0x20) {
            sb.append(String.format("\\u%04x", (int) c));
          } else {
            sb.append(c);
          }
      }
    }
    return sb.append('"').toString();
  }

  static String value(Object o) {
    if (o == null) return "null";
    if (o instanceof Boolean) return o.toString();
    if (o instanceof Number) {
      // JSON has no NaN/Infinity; fall back to a string so the payload stays valid.
      double d = ((Number) o).doubleValue();
      if (Double.isNaN(d) || Double.isInfinite(d)) return str(o.toString());
      return o.toString();
    }
    return str(o.toString());
  }

  static String error(Throwable t) {
    Throwable root = t;
    List<String> chain = new ArrayList<>();
    while (root != null) {
      String msg = root.getMessage();
      chain.add(root.getClass().getSimpleName() + (msg == null ? "" : ": " + msg));
      root = root.getCause();
    }
    return "{\"error\":" + str(String.join(" <- ", chain)) + "}";
  }

  private Json() {}
}
