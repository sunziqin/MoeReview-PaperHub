/**
 * 编程题渲染组件。
 * 当前使用 textarea(等宽字体),后续可替换为 CodeMirror。
 * 显示语言标识。
 *
 * 代码下方有"运行"和"判题"按钮:
 * - 运行:在前端 Pyodide 沙箱里执行用户代码(不带测试用例),显示 stdout/stderr。
 * - 判题:对所有测试用例执行代码,逐条显示 ✓/✗ + actual/expected + 汇总。
 * Pyodide 懒加载,第一次运行时显示"正在加载 Python 运行环境..."。
 */
import { useState } from "react";
import type { QuizQuestion } from "../../types";
import { isPyodideReady, runPython } from "../../services/pyodideSandbox";
import { runPythonTests, type TestCase, type TestResult } from "../../services/runTests";

interface CodeQuestionProps {
  question: QuizQuestion;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

/** 运行/判题的忙状态 */
type Busy = "idle" | "run" | "judge";

export function CodeQuestion({ question, value, onChange, disabled = false }: CodeQuestionProps) {
  const language = question.language ?? "code";

  const [busy, setBusy] = useState<Busy>("idle");
  const [busyMsg, setBusyMsg] = useState("");
  const [output, setOutput] = useState<{
    stdout: string;
    stderr: string;
    error?: string;
  } | null>(null);
  const [results, setResults] = useState<TestResult[] | null>(null);

  // 从题目里取测试用例(test_cases 类型是 unknown[],这里断言为 TestCase[])
  const testCases = (question.test_cases as TestCase[] | undefined) ?? [];

  /** 运行:执行用户代码,不带测试用例 */
  const handleRun = async () => {
    if (busy !== "idle" || disabled) return;
    const ready = isPyodideReady();
    setBusy("run");
    setBusyMsg(ready ? "运行中..." : "正在加载 Python 运行环境...");
    setOutput(null);
    setResults(null);
    try {
      const res = await runPython(value);
      setOutput(res);
    } catch {
      setOutput({ stdout: "", stderr: "", error: "加载 Python 环境失败,请检查网络后重试" });
    } finally {
      setBusy("idle");
      setBusyMsg("");
    }
  };

  /** 判题:执行所有测试用例 */
  const handleJudge = async () => {
    if (busy !== "idle" || disabled || testCases.length === 0) return;
    const ready = isPyodideReady();
    setBusy("judge");
    setBusyMsg(ready ? "运行中..." : "正在加载 Python 运行环境...");
    setOutput(null);
    setResults(null);
    try {
      const res = await runPythonTests(value, testCases);
      setResults(res);
    } catch {
      setOutput({ stdout: "", stderr: "", error: "加载 Python 环境失败,请检查网络后重试" });
    } finally {
      setBusy("idle");
      setBusyMsg("");
    }
  };

  const isBusy = busy !== "idle";

  return (
    <div className="q-code">
      <p className="q-text">{question.question}</p>
      <div className="q-code-head">
        <span className="q-code-lang">{language}</span>
      </div>
      <textarea
        className="q-code-area"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={`// 在此输入 ${language} 代码...`}
        rows={12}
        spellCheck={false}
        disabled={disabled}
        aria-label="代码答案"
      />

      <div className="q-code-actions">
        <button
          type="button"
          className="q-btn q-btn-ghost"
          onClick={handleRun}
          disabled={isBusy || disabled}
        >
          运行
        </button>
        <button
          type="button"
          className="q-btn q-btn-primary"
          onClick={handleJudge}
          disabled={isBusy || disabled || testCases.length === 0}
          title={testCases.length === 0 ? "本题没有测试用例" : undefined}
        >
          判题
        </button>
      </div>

      {/* 忙状态提示 */}
      {isBusy && (
        <div className="q-code-output">
          <div className="q-code-busy">{busyMsg}</div>
        </div>
      )}

      {/* 运行输出 */}
      {!isBusy && output && (
        <div className="q-code-output">
          {output.stdout && <pre className="q-code-stdout">{output.stdout}</pre>}
          {output.stderr && <pre className="q-code-stderr">{output.stderr}</pre>}
          {output.error && <pre className="q-code-stderr">{output.error}</pre>}
          {!output.stdout && !output.stderr && !output.error && (
            <pre className="q-code-stdout q-code-empty">(无输出)</pre>
          )}
        </div>
      )}

      {/* 判题结果 */}
      {!isBusy && results && (
        <div className="q-code-output">
          <div className="q-code-summary">
            {results.filter((r) => r.passed).length} / {results.length} 通过
          </div>
          {results.map((r, i) => (
            <div className={`q-code-case ${r.passed ? "ok" : "fail"}`} key={i}>
              <div className="q-code-case-head">
                <span className="q-code-case-mark">{r.passed ? "✓" : "✗"}</span>
                <span className="q-code-case-no">用例 {i + 1}</span>
                <span className="q-code-case-time">{r.time_ms} ms</span>
              </div>
              {!r.passed && (
                <div className="q-code-case-body">
                  {r.error ? (
                    <pre className="q-code-stderr">{r.error}</pre>
                  ) : (
                    <>
                      <div className="q-code-diff">
                        <span className="q-code-diff-label">期望</span>
                        <pre className="q-code-diff-val">{r.expected}</pre>
                      </div>
                      <div className="q-code-diff">
                        <span className="q-code-diff-label">实际</span>
                        <pre className="q-code-diff-val">{r.actual}</pre>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
