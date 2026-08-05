/**
 * 收藏视图。
 * - 顶部统计:收藏总数
 * - 列表展示:题干(截断)、答案、收藏时间
 * - 每条收藏:"重做"按钮发 review_request,"移除"按钮发 toggle_favorite(后端再推 favorites_update)
 * - 空状态:"还没有收藏,在题目上点 ⭐ 即可收藏"
 *
 * 样式复用 .wrong-* 类(错题本同构),避免新增 CSS。
 */
import { useEffect, useState } from "react";
import { useExamForgeStore } from "../store";
import { Bookmark, ChevronDown, Quote } from "lucide-react";
import type { ClientEvent } from "../types";
import { useWorkspaceStore } from "../workspaceStore";
import { formatAnswer, formatQuestionContext } from "../utils/judge";
import { toast } from "sonner";

interface FavoritesViewProps {
  /** 发送事件到后端的回调(重做 / 移除收藏) */
  sendEvent: (event: ClientEvent) => void;
  onNavigate?: () => void;
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

export function FavoritesView({ sendEvent, onNavigate }: FavoritesViewProps) {
  const favorites = useExamForgeStore((s) => s.favorites);
  const pages = useExamForgeStore((s) => s.pages);
  const goToPage = useExamForgeStore((s) => s.goToPage);
  const goToQuestion = useExamForgeStore((s) => s.goToQuestion);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<Set<string>>(new Set());
  const addQuote = useWorkspaceStore((s) => s.addQuote);
  const focusDock = useWorkspaceStore((s) => s.focusDock);

  useEffect(() => setPending(new Set()), [favorites]);

  if (favorites.length === 0) {
    return (
      <div className="wrong-empty">
        <Bookmark size={22} aria-hidden="true" />
        <p className="wrong-empty-hint">还没有收藏</p>
      </div>
    );
  }

  return (
    <div className="wrong-view">
      <div className="wrong-stats">
        <div className="wrong-stat-item">
          <span className="wrong-stat-num">{favorites.length}</span>
          <span className="wrong-stat-label">已收藏</span>
        </div>
      </div>

      <ul className="wrong-list">
        {favorites.map((item, i) => (
          (() => {
            const pageIndex = pages.findIndex((page) => page.kind === "quiz" && ((page.content as { questions?: Array<{ id: string; question: string }> }).questions ?? []).some((question) => question.id === item.id || question.question === item.question));
            const quizQuestions = pageIndex >= 0 ? ((pages[pageIndex].content as { questions?: import("../types").QuizQuestion[] }).questions ?? []) : [];
            const questionIndex = quizQuestions.findIndex((question) => question.id === item.id || question.question === item.question);
            const sourceQuestion = quizQuestions[questionIndex];
            const answerText = sourceQuestion
              ? formatAnswer(sourceQuestion.type, item.answer, sourceQuestion.options)
              : typeof item.answer === "number" ? `选项 ${String.fromCharCode(65 + item.answer)}` : stringify(item.answer);
            return (
          <li className="wrong-item" key={`${item.id}-${i}`}>
            <div className="wrong-item-head">
              <button type="button" className="favorite-question-toggle" onClick={() => setExpanded((previous) => {
                const next = new Set(previous);
                if (next.has(item.id)) next.delete(item.id); else next.add(item.id);
                return next;
              })} aria-expanded={expanded.has(item.id)}>
                <span className="wrong-item-question">{expanded.has(item.id) ? item.question : truncate(item.question)}</span>
                <ChevronDown size={14} />
              </button>
              <span className="wrong-item-reason">收藏</span>
            </div>
            <div className="wrong-item-body">
              <div className="wrong-item-row">
                <span className="wrong-item-row-label">正确答案</span>
                <code className="wrong-item-row-value">{answerText}</code>
              </div>
            </div>
            <div className="wrong-item-foot">
              <span className="wrong-item-time">{formatTime(item.timestamp)}</span>
              <div className="wrong-item-actions">
                <button
                  type="button"
                  className="wrong-btn"
                  onClick={() => {
                    addQuote({ text: sourceQuestion ? formatQuestionContext(sourceQuestion) : `题目：${item.question}`, pageTitle: "收藏题目" });
                    focusDock();
                  }}
                >
                  <Quote size={14} /> 引用
                </button>
                <button
                  type="button"
                  className="wrong-btn wrong-btn-redo"
                  onClick={() => {
                    if (pageIndex >= 0 && questionIndex >= 0) {
                      goToPage(pageIndex);
                      goToQuestion(questionIndex);
                      onNavigate?.();
                      toast.success("已回到原题");
                      return;
                    }
                    sendEvent({ event: "review_request", data: [item.question] });
                    toast.success("已提交重做请求，等待 Agent 生成题目");
                  }}
                >
                  重做
                </button>
                <button
                  type="button"
                  className="wrong-btn wrong-btn-remove"
                  disabled={pending.has(item.id)}
                  onClick={() => {
                    setPending((previous) => new Set(previous).add(item.id));
                    sendEvent({
                      event: "toggle_favorite",
                      question_id: item.id,
                      question: item.question,
                      answer: item.answer,
                    });
                  }}
                >
                  {pending.has(item.id) ? "处理中" : "移除"}
                </button>
              </div>
            </div>
          </li>
            );
          })()
        ))}
      </ul>
    </div>
  );
}
