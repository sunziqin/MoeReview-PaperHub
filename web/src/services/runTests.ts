/**
 * 测试用例执行器。
 *
 * 对每个 test case:用 input 作为 stdin 跑一遍代码,
 * 对比 stdout(去首尾空格)和 expected(去首尾空格)。
 */
import { runPython } from "./pyodideSandbox";

/** 单条测试用例 */
export interface TestCase {
  input: string;
  expected: string;
}

/** 单条测试用例的执行结果 */
export interface TestResult {
  passed: boolean;
  actual: string;
  expected: string;
  /** 耗时(毫秒) */
  time_ms: number;
  /** 异常或超时信息 */
  error?: string;
}

/**
 * 对所有测试用例执行代码并判题。
 * 不会因为某条用例报错而中断后续用例。
 *
 * @param code 用户写的 Python 代码
 * @param testCases 测试用例数组
 */
export async function runPythonTests(
  code: string,
  testCases: TestCase[],
): Promise<TestResult[]> {
  const results: TestResult[] = [];
  for (const tc of testCases) {
    const start = performance.now();
    const res = await runPython(code, tc.input);
    const time_ms = Math.round(performance.now() - start);

    // 对比时去掉首尾空白(换行/空格)
    const actual = res.stdout.trim();
    const expected = tc.expected.trim();
    const passed = !res.error && actual === expected;

    results.push({
      passed,
      actual: res.error ? "" : actual,
      expected,
      time_ms,
      error: res.error,
    });
  }
  return results;
}
