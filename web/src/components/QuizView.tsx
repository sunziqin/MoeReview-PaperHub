/**
 * 做题视图。
 *
 * - sequential 模式:逐题渲染,顶部进度,底部按钮区(上一题/查看答案/不会看解析/提交)。
 *   choice/fill 提交后即时判题,显示对错反馈,2 秒后或点"下一题"进入下一题;
 *   short_answer/code 提交后不判题直接进下一题;最后一题提交后把所有答案发给后端。
 * - batch 模式:所有题目一次性渲染,底部"提交全部"按钮一次性提交。
 *
 * 答案可见性:每题可"查看答案"(发 peek_answer,不提交),"不会直接看解析"(发 give_up,入错题本)。
 * 快捷键(sequential):1-9/a-d 选选项、Enter 提交、Shift+Enter 查看答案、→↓ 下一题、←↑ 上一题。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Quote, Star } from "lucide-react";
import { toast } from "sonner";
import { useExamForgeStore } from "../store";
import { useWorkspaceStore } from "../workspaceStore";
import type { ClientEvent, QuizQuestion } from "../types";
import { formatAnswer, formatQuestionContext, judgeChoice, judgeFill } from "../utils/judge";
import { ChoiceQuestion } from "./quiz/ChoiceQuestion";
import { CodeQuestion } from "./quiz/CodeQuestion";
import { FillQuestion } from "./quiz/FillQuestion";
import { ShortAnswerQuestion } from "./quiz/ShortAnswerQuestion";

interface QuizViewProps {
  /** 发送事件到后端的回调(由 useExamForge 提供) */
  sendEvent: (event: ClientEvent) => boolean | void;
}

type QuizDeliveryNotice = {
  tone: "saved" | "sent" | "warning" | "error";
  text: string;
};

export function QuizView({ sendEvent }: QuizViewProps) {
  const quiz = useExamForgeStore((s) => s.quiz);
  const currentQuestionIndex = useExamForgeStore((s) => s.currentQuestionIndex);
  const userAnswers = useExamForgeStore((s) => s.userAnswers);
  const favorites = useExamForgeStore((s) => s.favorites);
  const connectionStatus = useExamForgeStore((s) => s.connectionStatus);
  const currentSessionId = useExamForgeStore((s) => s.currentSessionId);
  const currentSession = useExamForgeStore((s) =>
    s.sessions.find((session) => session.id === s.currentSessionId),
  );
  const nextQuestion = useExamForgeStore((s) => s.nextQuestion);
  const prevQuestion = useExamForgeStore((s) => s.prevQuestion);
  const setUserAnswer = useExamForgeStore((s) => s.setUserAnswer);
  const addWrongAnswer = useExamForgeStore((s) => s.addWrongAnswer);
  const currentPage = useExamForgeStore((s) => s.pages[s.currentPageIndex] ?? null);
  const addQuote = useWorkspaceStore((s) => s.addQuote);
  const focusDock = useWorkspaceStore((s) => s.focusDock);

  // sequential:当前题提交状态、对错反馈、是否查看答案
  const [submitted, setSubmitted] = useState(false);
  const [feedback, setFeedback] = useState<boolean | null>(null);
  const [peeking, setPeeking] = useState(false);
  const [deliveryNotice, setDeliveryNotice] = useState<QuizDeliveryNotice | null>(null);
  // batch:每题答案可见性
  const [peekIds, setPeekIds] = useState<Record<string, boolean>>({});

  // 切题或换 quiz 时重置 sequential 局部状态
  useEffect(() => {
    setSubmitted(false);
    setFeedback(null);
    setPeeking(false);
    setDeliveryNotice(null);
  }, [currentQuestionIndex, quiz]);

  const questions = quiz?.questions ?? [];
  const currentQ = questions[currentQuestionIndex];
  const isLast = currentQuestionIndex >= questions.length - 1;
  const agentStatus = currentSession?.agentConnection?.status ?? "offline";
  const agentCanReceive = ["idle", "waiting", "working"].includes(agentStatus);

  /** 把所有答案发给后端 */
  const finishAll = useCallback((): boolean => {
    if (connectionStatus !== "connected") {
      const text = "提交失败：Hub 未连接。请等顶部状态恢复后再提交。";
      setDeliveryNotice({ tone: "error", text });
      toast.error(text);
      return false;
    }

    if (!currentSessionId) {
      const text = "提交失败：当前没有绑定会话。请先选择或接管一个会话。";
      setDeliveryNotice({ tone: "error", text });
      toast.error(text);
      return false;
    }

    const sent = sendEvent({ event: "quiz_answer", data: userAnswers });
    if (sent === false) {
      const text = "提交失败：Hub 连接已断开，答案没有发出。请等恢复连接后再提交。";
      setDeliveryNotice({ tone: "error", text });
      toast.error(text);
      return false;
    }

    if (!agentCanReceive) {
      const text = "答案已送达 Hub，但当前会话没有在线 Agent。需要回 Agent 那边唤醒或重新接管后处理。";
      setDeliveryNotice({ tone: "warning", text });
      toast.warning(text);
      return true;
    }

    const text = agentStatus === "working"
      ? "答案已送达 Hub，Agent 正在处理；如果本轮没读取，会在下一轮继续可见。"
      : "答案已送达 Hub，等待 Agent 处理。";
    setDeliveryNotice({ tone: "sent", text });
    toast.success(text);
    return true;
  }, [agentCanReceive, agentStatus, connectionStatus, currentSessionId, sendEvent, userAnswers]);

  /** 进入下一题,最后一题则提交全部 */
  const goToNext = () => {
    if (isLast) {
      finishAll();
    } else {
      setDeliveryNotice({ tone: "saved", text: "本题答案已保存，完成全部题目后会统一提交给 Agent。" });
      nextQuestion();
    }
  };

  /** 上一题 */
  const goToPrev = () => {
    if (currentQuestionIndex > 0) prevQuestion();
  };

  /** 提交当前题(sequential) */
  const submitCurrent = () => {
    if (!currentQ) return;
    // 已提交(choice/fill):再次点则进入下一题
    if (submitted) {
      goToNext();
      return;
    }
    const ua = userAnswers[currentQ.id];
    if (currentQ.type === "choice") {
      const correct = judgeChoice(ua, currentQ.answer);
      setFeedback(correct);
      setSubmitted(true);
      setDeliveryNotice({
        tone: "saved",
        text: isLast ? "本题已判定。点击“完成”后会把整套答案提交给 Agent。" : "本题已判定并保存，稍后进入下一题。",
      });
      if (!correct) {
        addWrongAnswer({
          question: currentQ.question,
          userAnswer: ua,
          correctAnswer: currentQ.answer,
          explanation: formatAnswer("choice", currentQ.answer, currentQ.options),
          timestamp: Date.now(),
          reason: "wrong",
        });
      }
      return;
    }
    if (currentQ.type === "fill") {
      const correct = judgeFill(ua, currentQ.answer);
      setFeedback(correct);
      setSubmitted(true);
      setDeliveryNotice({
        tone: "saved",
        text: isLast ? "本题已判定。点击“完成”后会把整套答案提交给 Agent。" : "本题已判定并保存，稍后进入下一题。",
      });
      if (!correct) {
        addWrongAnswer({
          question: currentQ.question,
          userAnswer: ua,
          correctAnswer: currentQ.answer,
          explanation: formatAnswer("fill", currentQ.answer),
          timestamp: Date.now(),
          reason: "wrong",
        });
      }
      return;
    }
    // short_answer / code 不前端判题,直接进下一题
    goToNext();
  };

  /** 切换查看答案(不提交) */
  const peekAnswer = () => {
    if (!currentQ) return;
    const next = !peeking;
    setPeeking(next);
    if (next) {
      sendEvent({ event: "quiz_action", action: "peek_answer", id: currentQ.id });
    }
  };

  /** 不会,直接看解析(标记跳过,入错题本) */
  const giveUp = () => {
    if (!currentQ) return;
    sendEvent({ event: "quiz_action", action: "give_up", id: currentQ.id });
    addWrongAnswer({
      question: currentQ.question,
      userAnswer: userAnswers[currentQ.id],
      correctAnswer: currentQ.answer,
      explanation: formatAnswer(currentQ.type, currentQ.answer, currentQ.options),
      timestamp: Date.now(),
      reason: "skip",
    });
    setPeeking(true);
  };

  /** 判断指定题目是否已收藏(按 question.id 匹配) */
  const isFavorited = (id: string) => favorites.some((f) => f.id === id);

  /** 切换收藏状态:发 toggle_favorite 到后端,后端推送 favorites_update 回前端同步 */
  const toggleFavoriteQuestion = (q: QuizQuestion) => {
    sendEvent({
      event: "toggle_favorite",
      question_id: q.id,
      question: q.question,
      answer: q.answer,
    });
  };

  /** 渲染收藏按钮 */
  const renderQuestionTools = (q: QuizQuestion) => (
    <div className="q-card-tools">
      <button
        type="button"
        className="q-quote-btn"
        onClick={() => {
          addQuote({ text: formatQuestionContext(q), pageId: currentPage?.id, pageTitle: currentPage?.title });
          focusDock();
        }}
        title="引用提问"
        aria-label="引用题目提问"
      >
        <Quote size={17} />
      </button>
      <button
      type="button"
      className={`q-fav-btn${isFavorited(q.id) ? " active" : ""}`}
      onClick={() => toggleFavoriteQuestion(q)}
      title={isFavorited(q.id) ? "取消收藏" : "收藏"}
      aria-label={isFavorited(q.id) ? "取消收藏" : "收藏"}
      aria-pressed={isFavorited(q.id)}
    >
      <Star size={18} fill={isFavorited(q.id) ? "currentColor" : "none"} />
      </button>
    </div>
  );

  // ---- 键盘快捷键(用 ref 持有最新闭包,避免陈旧) ----
  const onKeyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  onKeyRef.current = (e: KeyboardEvent) => {
    if (!quiz) return;
    if (quiz.mode === "batch") return; // batch 不需要翻题快捷键

    const target = e.target as HTMLElement | null;
    const tag = target?.tagName;
    const inField = tag === "INPUT" || tag === "TEXTAREA";

    // 输入框聚焦时只保留 Enter / Shift+Enter
    if (inField) {
      if (e.key === "Enter" && e.shiftKey) {
        e.preventDefault();
        peekAnswer();
      } else if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        submitCurrent();
      }
      return;
    }

    // 选项快捷键(choice)
    if (currentQ?.type === "choice") {
      const options = (currentQ.options as string[]) ?? [];
      const digit = Number(e.key);
      if (!Number.isNaN(digit) && digit >= 1 && digit <= options.length) {
        setUserAnswer(currentQ.id, digit - 1);
        e.preventDefault();
        return;
      }
      if (e.key.length === 1) {
        const idx = e.key.toLowerCase().charCodeAt(0) - "a".charCodeAt(0);
        if (idx >= 0 && idx < options.length) {
          setUserAnswer(currentQ.id, idx);
          e.preventDefault();
          return;
        }
      }
    }

    if (e.key === "Enter" && e.shiftKey) {
      e.preventDefault();
      peekAnswer();
    } else if (e.key === "Enter") {
      e.preventDefault();
      submitCurrent();
    } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      goToNext();
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      goToPrev();
    }
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => onKeyRef.current(e);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // 提交后(choice/fill)2 秒自动进入下一题
  useEffect(() => {
    if (!submitted || feedback === null) return;
    const timer = setTimeout(() => {
      if (isLast) {
        finishAll();
      } else {
        setDeliveryNotice({ tone: "saved", text: "本题答案已保存，完成全部题目后会统一提交给 Agent。" });
        nextQuestion();
      }
    }, 2000);
    return () => clearTimeout(timer);
  }, [submitted, feedback, isLast, nextQuestion, finishAll]);

  if (!quiz || questions.length === 0 || !currentQ) return null;

  // ---- 渲染单题 ----
  const renderQuestionBody = (q: QuizQuestion, disabled: boolean) => {
    const ua = userAnswers[q.id];
    switch (q.type) {
      case "choice":
        return (
          <ChoiceQuestion
            question={q}
            selectedValue={(typeof ua === "number" ? ua : null)}
            onSelect={(i) => setUserAnswer(q.id, i)}
            disabled={disabled}
          />
        );
      case "fill":
        return (
          <FillQuestion
            question={q}
            value={typeof ua === "string" ? ua : ""}
            onChange={(v) => setUserAnswer(q.id, v)}
            disabled={disabled}
          />
        );
      case "short_answer":
        return (
          <ShortAnswerQuestion
            question={q}
            value={typeof ua === "string" ? ua : ""}
            onChange={(v) => setUserAnswer(q.id, v)}
            disabled={disabled}
          />
        );
      case "code":
        return (
          <CodeQuestion
            question={q}
            value={typeof ua === "string" ? ua : ""}
            onChange={(v) => setUserAnswer(q.id, v)}
            disabled={disabled}
          />
        );
      default:
        return null;
    }
  };

  /** 展示正确答案(灰色) */
  const renderAnswerReveal = (q: QuizQuestion) => {
    if (q.answer === undefined || q.answer === null) return null;
    const text = formatAnswer(q.type, q.answer, q.options);
    if (!text) return null;
    return (
      <div className="q-answer-reveal">
        <span className="q-answer-label">正确答案</span>
        <code className="q-answer-code">{text}</code>
      </div>
    );
  };

  // ===================== sequential 模式 =====================
  if (quiz.mode === "sequential") {
    const submittedWithFeedback =
      submitted && feedback !== null && currentQ.type !== "short_answer" && currentQ.type !== "code";
    return (
      <div className="quiz-view">
        <div className="quiz-progress">
          第 {currentQuestionIndex + 1} / {questions.length} 题
        </div>

        <div className="q-card" key={currentQuestionIndex}>
          {renderQuestionTools(currentQ)}
          {renderQuestionBody(currentQ, submittedWithFeedback)}
          {submittedWithFeedback && (
            <div className={`q-feedback ${feedback ? "ok" : "fail"}`}>
              {feedback ? "✓ 回答正确" : "✗ 回答错误"}
            </div>
          )}
          {peeking && renderAnswerReveal(currentQ)}
          {deliveryNotice && (
            <div className={`q-delivery q-delivery-${deliveryNotice.tone}`} role="status" aria-live="polite">
              {deliveryNotice.text}
            </div>
          )}

          <div className="q-actions">
            <button
              type="button"
              className="q-btn q-btn-ghost"
              onClick={goToPrev}
              disabled={currentQuestionIndex === 0}
            >
              上一题
            </button>
            <button type="button" className="q-btn q-btn-ghost" onClick={peekAnswer}>
              {peeking ? "隐藏答案" : "查看答案"}
            </button>
            <button type="button" className="q-btn q-btn-warn" onClick={giveUp}>
              不会,直接看解析
            </button>
            <button
              type="button"
              className="q-btn q-btn-primary"
              onClick={submitCurrent}
              disabled={submittedWithFeedback && feedback === null}
            >
              {submittedWithFeedback ? (isLast ? "完成" : "下一题") : "提交"}
            </button>
          </div>
        </div>

        <p className="quiz-hint">
          快捷键:数字/字母选选项 · Enter 提交 · Shift+Enter 查看答案 · ←/→ 翻题
        </p>
      </div>
    );
  }

  // ===================== batch 模式 =====================
  const togglePeekBatch = (id: string) => {
    setPeekIds((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      if (next[id]) {
        sendEvent({ event: "quiz_action", action: "peek_answer", id });
      }
      return next;
    });
  };

  return (
    <div className="quiz-view quiz-batch">
      <div className="quiz-progress">共 {questions.length} 题(批量作答)</div>

      <div className="quiz-batch-list">
        {questions.map((q, i) => (
          <div className="q-card" key={q.id} style={{ "--i": i } as CSSProperties}>
            {renderQuestionTools(q)}
            <div className="q-card-no">第 {i + 1} 题</div>
            {renderQuestionBody(q, false)}
            {peekIds[q.id] && renderAnswerReveal(q)}
            <div className="q-actions">
              <button
                type="button"
                className="q-btn q-btn-ghost"
                onClick={() => togglePeekBatch(q.id)}
              >
                {peekIds[q.id] ? "隐藏答案" : "查看答案"}
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="quiz-batch-footer">
        <button
          type="button"
          className="q-btn q-btn-primary"
          onClick={finishAll}
        >
          提交全部
        </button>
      </div>
      {deliveryNotice && (
        <div className={`q-delivery q-delivery-${deliveryNotice.tone}`} role="status" aria-live="polite">
          {deliveryNotice.text}
        </div>
      )}
    </div>
  );
}
