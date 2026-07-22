package cqe;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.Base64;

/**
 * A line-oriented driver for {@link QueryRunner}, so the Node test suite can
 * exercise the real engine end to end (the analogue of running every example
 * against a live database). Not used by the browser — the page calls
 * QueryRunner directly through CheerpJ.
 *
 * <p>Each stdin line is {@code <command> [name] [base64-payload]}; every
 * response is one line prefixed with {@code <<< }. Payloads are base64 so SQL
 * and table text can contain newlines and commas freely.
 */
public final class Repl {

  public static void main(String[] args) throws Exception {
    BufferedReader in = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
    String line;
    while ((line = in.readLine()) != null) {
      line = line.trim();
      if (line.isEmpty()) continue;
      String[] parts = line.split(" ");
      String cmd = parts[0];
      try {
        String out;
        switch (cmd) {
          case "csv":
            out = QueryRunner.registerCsv(parts[1], decode(parts[2]));
            break;
          case "json":
            out = QueryRunner.registerJson(parts[1], decode(parts[2]));
            break;
          case "reset":
            out = QueryRunner.reset();
            break;
          case "run":
            out = QueryRunner.run(decode(parts[1]));
            break;
          case "explain":
            out = QueryRunner.explain(decode(parts[1]));
            break;
          case "rules":
            out = QueryRunner.rules(decode(parts[1]));
            break;
          case "quit":
            return;
          default:
            out = "{\"error\":\"unknown command: " + cmd + "\"}";
        }
        System.out.println("<<< " + out);
        System.out.flush();
      } catch (Throwable t) {
        System.out.println("<<< " + Json.error(t));
        System.out.flush();
      }
    }
  }

  private static String decode(String b64) {
    return new String(Base64.getDecoder().decode(b64), StandardCharsets.UTF_8);
  }

  private Repl() {}
}
