import type { CSSProperties } from "react";
import { useExamForgeStore } from "../store";
import type { ResultItem, ResultSummary } from "../types";
import { formatAnswer } from "../utils/judge";

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0 秒";
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes} 分` : `${minutes} 分 ${rest} 秒`;
}

function getResultMark(result: ResultItem): { className: string; text: string } {
  if (result.verdict === "partial") return { className: "partial", text: "△ 部分正确" };
  if (result.verdict === "skipped") return { className: "fail", text: "跳过" };
  if (result.correct === true) return { className: "ok", text: "✓ 正确" };
  if (result.correct === false || result.verdict === "wrong") return { className: "fail", text: "✗ 错误" };
  return { className: "unknown", text: "未判定" };
}

export function ResultView() {
  const result = useExamForgeStore((s) => s.result);
  const quiz = useExamForgeStore((s) => s.quiz);

  if (!result) return null;

  const summary: ResultSummary = result.summary ?? { accuracy: 0, time_spent: 0 };
  const results: ResultItem[] = result.results ?? [];
  const qMap = new Map((quiz?.questions ?? []).map((q) => [q.id, q]));
  const accuracyPct = Math.round((summary.accuracy ?? 0) * 100);

  return (
    <div className="result-view">
      <section className="result-summary">
        <div className="result-accuracy">
          <span className="result-accuracy-num">{accuracyPct}%</span>
          <span className="result-accuracy-label">正确率</span>
        </div>
        <div className="result-meta">
          <div className="result-meta-item">
            <span className="result-meta-label">用时</span>
            <span className="result-meta-value">{formatTime(summary.time_spent ?? 0)}</span>
          </div>
          {summary.feedback && (
            <div className="result-meta-item result-feedback">
              <span className="result-meta-label">Agent 反馈</span>
              <span className="result-meta-value">{summary.feedback}</span>
            </div>
          )}
          {summary.grading_notes && (
            <div className="result-meta-item result-feedback">
              <span className="result-meta-label">批改说明</span>
              <span className="result-meta-value">{summary.grading_notes}</span>
            </div>
          )}
        </div>
      </section>

      <section className="result-list">
        <h3 className="result-list-title">逐题结果</h3>
        {results.length === 0 && <p className="result-empty">暂无逐题结果</p>}
        {results.map((r, i) => {
          const q = qMap.get(r.id);
          const mark = getResultMark(r);
          return (
            <div
              className={`result-item ${mark.className}`}
              key={r.id}
              style={{ "--i": i } as CSSProperties}
            >
              <div className="result-item-head">
                <span className="result-no">第 {i + 1} 题</span>
                <span className={`result-mark ${mark.className}`}>{mark.text}</span>
              </div>
              {q && <p className="result-q-text">{q.question}</p>}
              {r.user_answer !== undefined && r.user_answer !== "" && (
                <div className="result-row">
                  <span className="result-row-label">你的答案</span>
                  <code className="result-row-value">{String(r.user_answer)}</code>
                </div>
              )}
              {(r.correct_answer !== undefined || (q && q.answer !== undefined && q.answer !== null)) && (
                <div className="result-row">
                  <span className="result-row-label">正确答案</span>
                  <code className="result-row-value">
                    {r.correct_answer !== undefined
                      ? String(r.correct_answer)
                      : q
                        ? formatAnswer(q.type, q.answer, q.options)
                        : ""}
                  </code>
                </div>
              )}
              {typeof r.score === "number" && typeof r.maxScore === "number" && (
                <div className="result-row">
                  <span className="result-row-label">得分</span>
                  <code className="result-row-value">{`${r.score} / ${r.maxScore}`}</code>
                </div>
              )}
              {r.explanation && (
                <div className="result-explain">
                  <span className="result-explain-label">解析</span>
                  <span className="result-explain-text">{r.explanation}</span>
                </div>
              )}
              {r.code_output && (
                <div className="result-code-output-wrap">
                  <span className="result-row-label">运行结果</span>
                  <pre className="result-code-output">{r.code_output}</pre>
                </div>
              )}
            </div>
          );
        })}
      </section>
    </div>
  );
}
