/**
 * Pyodide 沙箱服务(单例)。
 *
 * 在前端用 WASM 执行 Python 代码,天然安全隔离(无网络 / 无文件访问)。
 * Pyodide 的 WASM 文件从 CDN 加载,避免打进 bundle。
 * 只在第一次调用时懒加载,之后复用单例。
 */
import type { PyodideInterface } from "pyodide";

/** Pyodide 版本对应的 CDN 地址(WASM 文件从这里加载,不进 bundle) */
const PYODIDE_CDN_URL = "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/";

/** 单次执行超时时间(毫秒) */
const RUN_TIMEOUT_MS = 3000;

/** 执行结果 */
export interface RunResult {
  stdout: string;
  stderr: string;
  /** 异常或超时信息(不抛错到外部,统一放进这里) */
  error?: string;
}

/** pyodide 实例类型:运行时方法在实例上可用,但类型定义里是 static,这里补上 */
type Pyodide = PyodideInterface & {
  setStdin: (opts: {
    stdin?: () => null | string;
    autoEOF?: boolean;
  }) => void;
  setStdout: (opts: { batched?: (msg: string) => void }) => void;
  setStderr: (opts: { batched?: (msg: string) => void }) => void;
  runPythonAsync: (code: string) => Promise<unknown>;
};

let pyodide: Pyodide | null = null;
let loadingPromise: Promise<Pyodide> | null = null;

/**
 * 懒加载 Pyodide(第一次调用时动态 import + loadPyodide)。
 * 加载期间外部可显示"正在加载 Python 运行环境..."。
 * 多次调用复用同一个 promise,避免重复加载。
 */
export async function getPyodide(): Promise<Pyodide> {
  if (pyodide) return pyodide;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    // 动态 import,避免把 pyodide 打进主 bundle
    const { loadPyodide } = await import("pyodide");
    const instance = await loadPyodide({ indexURL: PYODIDE_CDN_URL });
    pyodide = instance as unknown as Pyodide;
    return pyodide;
  })();

  try {
    return await loadingPromise;
  } catch (e) {
    // 加载失败:清空 promise,允许下次重试
    loadingPromise = null;
    throw e;
  }
}

/** Pyodide 是否已加载完毕(用于区分"加载环境"和"运行中"两种提示) */
export function isPyodideReady(): boolean {
  return pyodide !== null;
}

/**
 * 用 Promise.race + setTimeout 实现超时控制。
 * 超时抛出 Error("执行超时")。
 * 注意:Pyodide 无法真正中断正在跑的同步死循环,这是已知限制。
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("执行超时")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/**
 * 执行 Python 代码,捕获 stdout / stderr / 异常。
 * 不会把异常抛到外部,统一放进返回结果的 error 字段。
 *
 * @param code Python 代码
 * @param stdin 标准输入(多行用 \n 分隔),按行喂给 input()
 */
export async function runPython(code: string, stdin = ""): Promise<RunResult> {
  const py = await getPyodide();

  let stdout = "";
  let stderr = "";

  // 捕获 stdout / stderr(batched 回调收到的是原始输出片段)
  py.setStdout({ batched: (msg: string) => { stdout += msg; } });
  py.setStderr({ batched: (msg: string) => { stderr += msg; } });

  // 按行拆分 stdin,逐行喂给 input();返回 null 表示 EOF
  const stdinLines = stdin.split("\n");
  let lineIdx = 0;
  py.setStdin({
    stdin: () => (lineIdx < stdinLines.length ? stdinLines[lineIdx++] : null),
    autoEOF: true,
  });

  try {
    await withTimeout(py.runPythonAsync(code), RUN_TIMEOUT_MS);
  } catch (e) {
    return {
      stdout,
      stderr,
      error: e instanceof Error ? e.message : String(e),
    };
  }

  return { stdout: stdout.trimEnd(), stderr: stderr.trimEnd() };
}
