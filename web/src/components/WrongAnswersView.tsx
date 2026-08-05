/**
 * 错题本视图。
 * - 顶部统计:总错题数、按原因分组(做错 X 题 / 跳过 Y 题)
 * - 列表展示:题干(截断)、用户答案、正确答案、原因、时间
 * - 每条错题:"重做"按钮发 review_request,"移出"按钮前端本地移除
 * - 空状态:"还没有错题,继续加油!"
 */
import type { CSSProperties } from "react";
import { useExamForgeStore } from "../store";
import type { ClientEvent } from "../types";

interface WrongAnswersViewProps {
  /** 发送事件到后端的回调(重做按钮发 review_request) */
  sendEvent: (event: ClientEvent) => void;
}

/** 把 unknown 安全转为可展示字符串 */
function stringify(value: unknown): string {
  if (value === undefined || value === null) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** 截断题干到指定长度 */
function truncate(text: string, max = 60): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

/** 格式化时间戳 */
function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function WrongAnswersView({ sendEvent }: WrongAnswersViewProps) {
  const wrongAnswers = useExamForgeStore((s) => s.wrongAnswers);
  const removeWrongAnswer = useExamForgeStore((s) => s.removeWrongAnswer);

  // 按原因分组统计
  const wrongCount = wrongAnswers.filter((w) => w.reason === "wrong").length;
  const skipCount = wrongAnswers.filter((w) => w.reason === "skip").length;

  if (wrongAnswers.length === 0) {
    return (
      <div className="wrong-empty">
        <p className="wrong-empty-hint">还没有错题,继续加油!</p>
      </div>
    );
  }

  return (
    <div className="wrong-view">
      <div className="wrong-stats">
        <div className="wrong-stat-item">
          <span className="wrong-stat-num">{wrongAnswers.length}</span>
          <span className="wrong-stat-label">总错题</span>
        </div>
        <div className="wrong-stat-item">
          <span className="wrong-stat-num wrong-stat-wrong">{wrongCount}</span>
          <span className="wrong-stat-label">做错</span>
        </div>
        <div className="wrong-stat-item">
          <span className="wrong-stat-num wrong-stat-skip">{skipCount}</span>
          <span className="wrong-stat-label">跳过</span>
        </div>
      </div>

      <ul className="wrong-list">
        {wrongAnswers.map((item, i) => (
          <li
            className={`wrong-item ${item.reason === "skip" ? "skip" : "wrong"}`}
            key={`${item.timestamp}-${i}`}
            style={{ "--i": i } as CSSProperties}
          >
            <div className="wrong-item-head">
              <span className="wrong-item-question" title={item.question}>
                {truncate(item.question)}
              </span>
              <span className={`wrong-item-reason ${item.reason}`}>
                {item.reason === "skip" ? "跳过" : "做错"}
              </span>
            </div>
            <div className="wrong-item-body">
              <div className="wrong-item-row">
                <span className="wrong-item-row-label">你的答案</span>
                <code className="wrong-item-row-value">{stringify(item.userAnswer)}</code>
              </div>
              <div className="wrong-item-row">
                <span className="wrong-item-row-label">正确答案</span>
                <code className="wrong-item-row-value">
                  {item.explanation || stringify(item.correctAnswer)}
                </code>
              </div>
            </div>
            <div className="wrong-item-foot">
              <span className="wrong-item-time">{formatTime(item.timestamp)}</span>
              <div className="wrong-item-actions">
                <button
                  type="button"
                  className="wrong-btn wrong-btn-redo"
                  onClick={() =>
                    sendEvent({ event: "review_request", data: [item.question] })
                  }
                >
                  重做
                </button>
                <button
                  type="button"
                  className="wrong-btn wrong-btn-remove"
                  onClick={() => removeWrongAnswer(i)}
                >
                  移出
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
