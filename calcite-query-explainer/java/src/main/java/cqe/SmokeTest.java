package cqe;

/**
 * Local JVM smoke test — exercises exactly the calls the browser page makes,
 * so a green run here isolates any browser-only failure to CheerpJ itself.
 * Run with {@code gradle run}.
 */
public final class SmokeTest {

  static final String EMP_CSV =
      "emp_id,name,dept_id,salary\n"
      + "1,Alice,10,95000\n"
      + "2,Bob,20,72000\n"
      + "3,Carol,10,105000\n"
      + "4,Dave,30,64000\n"
      + "5,Eve,20,88000\n";

  // Departments as JSON, to prove a join across two different input formats.
  static final String DEPT_JSON =
      "[{\"dept_id\":10,\"dept_name\":\"Engineering\",\"remote\":true},"
      + "{\"dept_id\":20,\"dept_name\":\"Sales\",\"remote\":false},"
      + "{\"dept_id\":30,\"dept_name\":\"Support\",\"remote\":true}]";

  static final String JOIN_SQL =
      "select d.dept_name, count(*) as headcount, avg(e.salary) as avg_salary "
      + "from emp e join dept d on e.dept_id = d.dept_id "
      + "group by d.dept_name order by avg_salary desc";

  public static void main(String[] args) {
    boolean ok = true;

    System.out.println("== register (CSV + JSON) ==");
    System.out.println(QueryRunner.registerCsv("emp", EMP_CSV));
    System.out.println(QueryRunner.registerJson("dept", DEPT_JSON));

    System.out.println("== select literal ==");
    String r1 = QueryRunner.run("select 1 as c");
    System.out.println(r1);
    ok &= must(r1, "\"rows\":[[1]]");

    System.out.println("== cross-format join + aggregate ==");
    String r2 = QueryRunner.run(JOIN_SQL);
    System.out.println(r2);
    ok &= must(r2, "Engineering");
    ok &= must(r2, "\"columns\":[\"DEPT_NAME\",\"HEADCOUNT\",\"AVG_SALARY\"]");

    System.out.println("== explain (logical + physical) ==");
    String r3 = QueryRunner.explain(JOIN_SQL);
    System.out.println(r3);
    ok &= must(r3, "LogicalJoin");         // logical stage present
    ok &= must(r3, "EnumerableAggregate"); // physical stage present

    System.out.println("== error is reported, not thrown ==");
    String r4 = QueryRunner.run("select * from nope");
    System.out.println(r4);
    ok &= must(r4, "\"error\"");

    if (!ok) {
      System.err.println("SMOKE FAILED");
      System.exit(1);
    }
    System.out.println("SMOKE OK");
  }

  private static boolean must(String result, String expected) {
    if (result.contains(expected)) return true;
    System.err.println("MISSING: " + expected);
    return false;
  }

  private SmokeTest() {}
}
