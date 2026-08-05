/**
 * 代码沙箱执行器。
 *
 * 按 language 分发到不同执行后端:
 * - javascript:node:vm 沙箱(进程内,无子进程),超时由 vm timeout 保证
 * - c / cpp:gcc / g++ 编译后执行子进程
 * - java:javac 编译 + java 执行子进程
 * - python:python3 执行子进程
 *
 * 安全限制:
 * - 时间:单次执行 3 秒上限(超时 SIGKILL)
 * - 内存:Linux 用 ulimit -v 限制 256MB(JVM 需要更大地址空间,Java 不施加);Windows 无法限制内存
 * - 网络:JS 沙箱不暴露 fetch/http;子进程层面无法限制
 * - 文件系统:JS 沙箱不暴露 fs;子进程层面无法限制
 *
 * TODO(安全):真正的隔离需要 Docker + cgroup,可精确限制内存/CPU/网络/文件系统,
 * 并限制可调用的系统调用(seccomp)。当前实现适用于可信 Agent 生成的代码,
 * 不适合直接执行任意不可信代码。
 */

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import vm from "node:vm";
import { join } from "node:path";
import { createTempFile, createTempDir } from "./tmpfile.js";

export type SupportedLanguage = "python" | "javascript" | "java" | "c" | "cpp";

export interface TestCase {
  input: string;
  expected: string;
}

export interface CaseResult {
  passed: boolean;
  actual: string;
  expected: string;
  time_ms: number;
}

export interface RunResult {
  results: CaseResult[];
  exit_code: number;
  /** 编译错误或整体错误(如编译器未安装) */
  error?: string;
}

/** 单次执行超时上限(毫秒)。 */
const TIMEOUT_MS = 3000;
/** 内存上限(KB),256MB。 */
const MEMORY_LIMIT_KB = 256 * 1024;
const IS_WIN = process.platform === "win32";
const IS_LINUX = process.platform === "linux";

/** 子进程执行结果。 */
interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  /** 命令未找到(ENOENT)。 */
  notFound: boolean;
}

/**
 * 运行一个子进程,喂入 stdin,捕获 stdout/stderr,超时 kill。
 *
 * 不使用 exec(避免 shell 注入);命令与参数以 argv 数组方式透传。
 * Linux 下可选地用 /bin/sh 包一层 ulimit 限制虚拟内存:
 *   /bin/sh -c 'ulimit -v <N>; exec "$@"' -- <cmd> <args...>
 * 脚本字符串是静态的,真正的命令与参数作为 argv 透传(`"$@"`),无注入风险。
 *
 * @param command 可执行程序名(如 gcc / g++ / java / python3)
 * @param args 参数数组
 * @param options.input 写入子进程 stdin 的内容(可选)
 * @param options.cwd 工作目录(可选)
 * @param options.memLimit 是否施加 256MB 内存限制(仅 Linux 生效)
 */
function runProcess(
  command: string,
  args: string[],
  options: { input?: string; cwd?: string; memLimit?: boolean } = {},
): Promise<ExecResult> {
  return new Promise((resolve) => {
    const useUlimit = IS_LINUX && options.memLimit === true;
    const finalCmd = useUlimit ? "/bin/sh" : command;
    const finalArgs = useUlimit
      ? ["-c", `ulimit -v ${MEMORY_LIMIT_KB}; exec "$@"`, "--", command, ...args]
      : args;

    const child = spawn(finalCmd, finalArgs, {
      cwd: options.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let timedOut = false;
    let settled = false;

    // 收集输出;附加 error 监听防止未捕获异常导致进程崩溃
    child.stdout?.on("data", (chunk: Buffer) => stdoutChunks.push(Buffer.from(chunk)));
    child.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(Buffer.from(chunk)));
    child.stdout?.on("error", () => {});
    child.stderr?.on("error", () => {});
    child.stdin?.on("error", () => {
      // 子进程可能已退出,stdin 写入失败可忽略
    });

    if (options.input !== undefined) {
      child.stdin?.write(options.input);
    }
    child.stdin?.end();

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGKILL");
      } catch {
        // 子进程可能已退出,忽略
      }
    }, TIMEOUT_MS);

    const finish = (result: ExecResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    child.on("error", (err: Error) => {
      const code = (err as NodeJS.ErrnoException).code;
      const notFound = code === "ENOENT";
      finish({
        stdout: "",
        stderr: notFound ? "" : err.message,
        exitCode: -1,
        timedOut: false,
        notFound,
      });
    });

    child.on("close", (code) => {
      finish({
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        exitCode: code ?? -1,
        timedOut,
        notFound: false,
      });
    });
  });
}

/** JS 沙箱执行结果(与 ExecResult 同构,便于复用 judgeCase)。 */
interface JsExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}

/**
 * 在 node:vm 沙箱中执行 JavaScript 代码。
 *
 * 上下文只注入 console / print / readline,不暴露 process/require/fetch/fs。
 * vm 的 timeout 仅对同步执行生效;异步(Promise 微任务)不受其覆盖,但判题主打同步代码。
 * TODO:真正的 JS 隔离需要独立 V8 Isolate 或 worker + 资源限额。
 */
function runJavaScript(code: string, input: string): JsExecResult {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  // 统一换行,逐行喂给 readline
  const inputLines = input.length > 0 ? input.replace(/\r\n/g, "\n").split("\n") : [];
  let inputIndex = 0;

  const formatArg = (a: unknown): string => {
    if (typeof a === "string") return a;
    if (a === null) return "null";
    if (a === undefined) return "undefined";
    if (a instanceof Error) return a.stack || a.message;
    try {
      return JSON.stringify(a);
    } catch {
      return String(a);
    }
  };

  // vm 上下文自带标准内置对象(Math/JSON/Date/Array/Object/Promise 等),
  // 这里只注入自定义全局,避免覆盖上下文原生内置导致 instanceof 错乱。
  const sandbox: Record<string, unknown> = {
    console: {
      log: (...args: unknown[]) => stdoutChunks.push(args.map(formatArg).join(" ") + "\n"),
      info: (...args: unknown[]) => stdoutChunks.push(args.map(formatArg).join(" ") + "\n"),
      error: (...args: unknown[]) => stderrChunks.push(args.map(formatArg).join(" ") + "\n"),
      warn: (...args: unknown[]) => stderrChunks.push(args.map(formatArg).join(" ") + "\n"),
    },
    print: (...args: unknown[]) => stdoutChunks.push(args.map(formatArg).join(" ") + "\n"),
    // 逐行读取 test case 的 input;读完返回空串
    readline: () => (inputIndex < inputLines.length ? inputLines[inputIndex++] : ""),
    read_line: () => (inputIndex < inputLines.length ? inputLines[inputIndex++] : ""),
  };

  const context = vm.createContext(sandbox);
  let exitCode = 0;
  let timedOut = false;

  try {
    vm.runInContext(code, context, {
      timeout: TIMEOUT_MS,
      filename: "sandbox.js",
    });
  } catch (e) {
    exitCode = 1;
    const msg = e instanceof Error ? e.message : String(e);
    // vm 超时抛出的错误信息包含 "Script execution timed out"
    if (msg.includes("timed out") || msg.includes("execution timed out")) {
      timedOut = true;
    }
    stderrChunks.push(msg);
  }

  return {
    stdout: stdoutChunks.join(""),
    stderr: stderrChunks.join(""),
    exitCode,
    timedOut,
  };
}

/**
 * 根据单次执行结果与期望输出判定一个 test case。
 * - 超时:passed=false,actual 标注超时
 * - 非零退出码(运行时错误):passed=false;若 stdout 为空,actual 标注运行时错误信息以便 Agent 排查
 * - 正常退出:对比 stdout 与 expected(都去首尾空白)
 */
function judgeCase(
  result: { stdout: string; stderr: string; exitCode: number; timedOut: boolean },
  expected: string,
  timeMs: number,
): CaseResult {
  const expectedTrimmed = expected.trim();
  if (result.timedOut) {
    return {
      passed: false,
      actual: "(timed out, 3s limit)",
      expected: expectedTrimmed,
      time_ms: timeMs,
    };
  }
  const actual = result.stdout.trim();
  if (result.exitCode !== 0 && actual === "") {
    const errTail = result.stderr.trim().slice(0, 200);
    return {
      passed: false,
      actual: `(runtime error, exit code ${result.exitCode})${errTail ? `: ${errTail}` : ""}`,
      expected: expectedTrimmed,
      time_ms: timeMs,
    };
  }
  return {
    passed: result.exitCode === 0 && actual === expectedTrimmed,
    actual,
    expected: expectedTrimmed,
    time_ms: timeMs,
  };
}

/** JavaScript:对每个 test case 在独立 vm 上下文执行。 */
async function runJsAllCases(code: string, testCases: TestCase[]): Promise<RunResult> {
  const results: CaseResult[] = [];
  let allPassed = true;
  for (const tc of testCases) {
    const start = Date.now();
    const r = runJavaScript(code, tc.input);
    const timeMs = Date.now() - start;
    const res = judgeCase(r, tc.expected, timeMs);
    if (!res.passed) allPassed = false;
    results.push(res);
  }
  return { results, exit_code: allPassed ? 0 : 1 };
}

/** C / C++:写源码 -> 编译 -> 逐用例执行产物。 */
async function runCOrCpp(params: {
  code: string;
  ext: string;
  compiler: string;
  notFoundMsg: string;
  testCases: TestCase[];
}): Promise<RunResult> {
  const temp = await createTempFile(params.ext);
  let binaryPath = "";
  try {
    await fs.writeFile(temp.path, params.code, "utf8");

    const binaryExt = IS_WIN ? ".exe" : ".out";
    binaryPath = temp.path.slice(0, temp.path.length - params.ext.length) + binaryExt;

    // 编译(编译期不施加内存限制,避免误伤编译器)
    const compileRes = await runProcess(params.compiler, ["-o", binaryPath, temp.path], {
      memLimit: false,
    });
    if (compileRes.notFound) {
      return { results: [], exit_code: -1, error: params.notFoundMsg };
    }
    if (compileRes.exitCode !== 0) {
      return {
        results: [],
        exit_code: compileRes.exitCode,
        error: "Compilation failed:\n" + compileRes.stderr.trim(),
      };
    }

    // 逐用例执行产物
    const results: CaseResult[] = [];
    let allPassed = true;
    for (const tc of params.testCases) {
      const start = Date.now();
      const r = await runProcess(binaryPath, [], { input: tc.input, memLimit: true });
      const timeMs = Date.now() - start;
      const res = judgeCase(r, tc.expected, timeMs);
      if (!res.passed) allPassed = false;
      results.push(res);
    }
    return { results, exit_code: allPassed ? 0 : 1 };
  } finally {
    await temp.cleanup();
    if (binaryPath) {
      await fs.rm(binaryPath, { force: true }).catch(() => {});
    }
  }
}

/** Java:写 Main.java -> javac 编译 -> java Main 逐用例执行。 */
async function runJavaAllCases(code: string, testCases: TestCase[]): Promise<RunResult> {
  const tempDir = await createTempDir();
  try {
    const srcPath = join(tempDir.path, "Main.java");
    await fs.writeFile(srcPath, code, "utf8");

    // 编译:cwd 设为临时目录,产物 Main.class 落在同目录
    const compileRes = await runProcess("javac", ["Main.java"], {
      cwd: tempDir.path,
      memLimit: false,
    });
    if (compileRes.notFound) {
      return {
        results: [],
        exit_code: -1,
        error: "javac not found. Please install a JDK to run Java code.",
      };
    }
    if (compileRes.exitCode !== 0) {
      return {
        results: [],
        exit_code: compileRes.exitCode,
        error: "Compilation failed:\n" + compileRes.stderr.trim(),
      };
    }

    // 执行 `java Main`,cwd 指向临时目录以找到 Main.class
    // JVM 需要较大虚拟地址空间,不施加 ulimit;内存隔离 TODO(需 Docker)
    const results: CaseResult[] = [];
    let allPassed = true;
    for (const tc of testCases) {
      const start = Date.now();
      const r = await runProcess("java", ["Main"], {
        input: tc.input,
        cwd: tempDir.path,
        memLimit: false,
      });
      const timeMs = Date.now() - start;
      const res = judgeCase(r, tc.expected, timeMs);
      if (!res.passed) allPassed = false;
      results.push(res);
    }
    return { results, exit_code: allPassed ? 0 : 1 };
  } finally {
    await tempDir.cleanup();
  }
}

/** Python:写 .py -> python3 执行子进程。 */
async function runPythonAllCases(code: string, testCases: TestCase[]): Promise<RunResult> {
  // Windows 上通常为 python,类 Unix 为 python3
  const cmd = IS_WIN ? "python" : "python3";
  const temp = await createTempFile(".py");
  try {
    await fs.writeFile(temp.path, code, "utf8");

    const results: CaseResult[] = [];
    let allPassed = true;
    for (const tc of testCases) {
      const start = Date.now();
      const r = await runProcess(cmd, [temp.path], { input: tc.input, memLimit: true });
      const timeMs = Date.now() - start;
      if (r.notFound) {
        return {
          results,
          exit_code: -1,
          error: `${cmd} not found. Please install Python 3 to run Python code.`,
        };
      }
      const res = judgeCase(r, tc.expected, timeMs);
      if (!res.passed) allPassed = false;
      results.push(res);
    }
    return { results, exit_code: allPassed ? 0 : 1 };
  } finally {
    await temp.cleanup();
  }
}

/**
 * 代码沙箱入口:按语言分发执行。
 * @returns 判题结果(results + exit_code + 可选的 error)
 */
export async function runCode(
  language: SupportedLanguage,
  code: string,
  testCases: TestCase[],
): Promise<RunResult> {
  switch (language) {
    case "javascript":
      return runJsAllCases(code, testCases);
    case "c":
      return runCOrCpp({
        code,
        ext: ".c",
        compiler: "gcc",
        notFoundMsg: "gcc not found. Please install gcc to run C code.",
        testCases,
      });
    case "cpp":
      return runCOrCpp({
        code,
        ext: ".cpp",
        compiler: "g++",
        notFoundMsg: "g++ not found. Please install g++ to run C++ code.",
        testCases,
      });
    case "java":
      return runJavaAllCases(code, testCases);
    case "python":
      return runPythonAllCases(code, testCases);
    default:
      return {
        results: [],
        exit_code: -1,
        error: `Unsupported language: ${language}`,
      };
  }
}
