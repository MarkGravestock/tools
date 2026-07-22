package spike;

/**
 * Local JVM smoke test — exercises exactly the calls the browser page makes,
 * so a green run here isolates any browser failure to CheerpJ itself.
 */
public final class SpikeMain {

  static final String EMP_CSV =
      "emp_id,name,dept_id,salary\n"
      + "1,Alice,10,95000\n"
      + "2,Bob,20,72000\n"
      + "3,Carol,10,105000\n"
      + "4,Dave,30,64000\n"
      + "5,Eve,20,88000\n";

  static final String DEPT_CSV =
      "dept_id,dept_name\n"
      + "10,Engineering\n"
      + "20,Sales\n"
      + "30,Support\n";

  static final String JOIN_SQL =
      "select d.dept_name, count(*) as headcount, avg(e.salary) as avg_salary "
      + "from emp e join dept d on e.dept_id = d.dept_id "
      + "group by d.dept_name order by avg_salary desc";

  public static void main(String[] args) {
    boolean ok = true;

    System.out.println("== registerCsv ==");
    System.out.println(QueryRunner.registerCsv("emp", EMP_CSV));
    System.out.println(QueryRunner.registerCsv("dept", DEPT_CSV));

    System.out.println("== select 1 ==");
    // note: "one" is a Calcite parser keyword (ONE ROW PER MATCH), so "c" it is
    String r1 = QueryRunner.run("select 1 as c");
    System.out.println(r1);
    ok &= check(r1, "\"rows\":[[1]]");

    System.out.println("== join + aggregate ==");
    String r2 = QueryRunner.run(JOIN_SQL);
    System.out.println(r2);
    ok &= check(r2, "Engineering");
    ok &= check(r2, "\"columns\":[\"DEPT_NAME\",\"HEADCOUNT\",\"AVG_SALARY\"]");

    System.out.println("== explain ==");
    String r3 = QueryRunner.explain(JOIN_SQL);
    System.out.println(r3);
    ok &= check(r3, "Join(");  // merge or hash join — either proves codegen

    if (!ok) {
      System.err.println("SPIKE FAILED");
      System.exit(1);
    }
    System.out.println("SPIKE OK");
  }

  private static boolean check(String result, String expected) {
    if (result.contains(expected)) return true;
    System.err.println("MISSING: " + expected);
    return false;
  }

  private SpikeMain() {}
}
