import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { ArrowDown, Clock3, GripVertical, Pin, RotateCcw, Send, Square, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { useExamForgeStore } from "../store";
import type { ClientEvent, QuickQaConfig, QuickQaMessage } from "../types";
import type { QuickQaRequest, QuoteContext } from "../workspaceStore";
import { useWorkspaceStore } from "../workspaceStore";
import { isQuickQaConfigured, streamChat, type ChatMessage } from "../services/quickQa";
import { MarkdownRenderer } from "./MarkdownRenderer";

const THREADS_STORAGE_KEY = "moereview-quick-qa-threads";
const ARCHIVES_STORAGE_KEY = "moereview-quick-qa-archives";
const MAX_CONTEXT_MESSAGES = 16;
const STREAM_FLUSH_MS = 40;

interface QuickQaDrawerProps {
  open: boolean;
  onClose: () => void;
  pendingQuestion: QuickQaRequest | null;
  config: QuickQaConfig;
  sendEvent: (event: ClientEvent) => void;
  onOpenSettings: () => void;
}

function loadThreads(): Record<string, QuickQaMessage[]> {
  try {
    const value = localStorage.getItem(THREADS_STORAGE_KEY);
    const parsed = value ? JSON.parse(value) as Record<string, QuickQaMessage[]> : {};
    return Object.fromEntries(Object.entries(parsed).map(([sessionId, messages]) => [
      sessionId,
      messages.map((message) => ({ ...message, id: message.id || crypto.randomUUID() })),
    ]));
  } catch (error) {
    console.error("读取即时问答记录失败", error);
    return {};
  }
}

interface QaArchive {
  id: string;
  title: string;
  updatedAt: number;
  messages: QuickQaMessage[];
}

function loadArchives(): Record<string, QaArchive[]> {
  try {
    const parsed = JSON.parse(localStorage.getItem(ARCHIVES_STORAGE_KEY) || "{}") as Record<string, QaArchive[]>;
    return Object.fromEntries(Object.entries(parsed).map(([sessionId, items]) => [
      sessionId,
      items.map((item) => ({
        ...item,
        messages: item.messages.map((message) => ({ ...message, id: message.id || crypto.randomUUID() })),
      })),
    ]));
  } catch (error) {
    console.error("读取即时问答历史失败", error);
    return {};
  }
}

export function QuickQaDrawer({
  open,
  onClose,
  pendingQuestion,
  config,
  sendEvent,
  onOpenSettings,
}: QuickQaDrawerProps) {
  const [threads, setThreads] = useState<Record<string, QuickQaMessage[]>>(loadThreads);
  const [archives, setArchives] = useState<Record<string, QaArchive[]>>(loadArchives);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [showJumpToEnd, setShowJumpToEnd] = useState(false);
  const currentSessionId = useExamForgeStore((state) => state.currentSessionId);
  const currentPage = useExamForgeStore((state) => state.pages[state.currentPageIndex] ?? null);
  const addNote = useWorkspaceStore((state) => state.addNote);
  const threadsRef = useRef(threads);
  const configRef = useRef(config);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  const processedRequestIdRef = useRef<number | null>(null);
  const activeQuotesRef = useRef<QuoteContext[]>([]);
  const notes = useWorkspaceStore((state) => state.notes);
  const qaTargetMessageId = useWorkspaceStore((state) => state.qaTargetMessageId);
  const qaTargetAnswer = useWorkspaceStore((state) => state.qaTargetAnswer);
  const clearQaTarget = useWorkspaceStore((state) => state.clearQaTarget);
  const setQaWidth = useWorkspaceStore((state) => state.setQaWidth);
  const messages = threads[currentSessionId] ?? [];
  const configured = isQuickQaConfigured(config);

  threadsRef.current = threads;
  configRef.current = config;

  const setMessages = (
    update: QuickQaMessage[] | ((previous: QuickQaMessage[]) => QuickQaMessage[]),
  ) => {
    setThreads((previousThreads) => {
      const previous = previousThreads[currentSessionId] ?? [];
      const next = typeof update === "function" ? update(previous) : update;
      return { ...previousThreads, [currentSessionId]: next };
    });
  };

  useEffect(() => {
    try {
      localStorage.setItem(THREADS_STORAGE_KEY, JSON.stringify(threads));
    } catch (error) {
      console.error("保存即时问答记录失败", error);
    }
  }, [threads]);

  useEffect(() => {
    try {
      localStorage.setItem(ARCHIVES_STORAGE_KEY, JSON.stringify(archives));
    } catch (error) {
      console.error("保存即时问答历史失败", error);
    }
  }, [archives]);

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container || !open || !stickToBottomRef.current) return;
    container.scrollTop = container.scrollHeight;
    setShowJumpToEnd(false);
  }, [threads, currentSessionId, open]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const buildApiMessages = (history: QuickQaMessage[]): ChatMessage[] => {
    const apiMessages: ChatMessage[] = [];
    const validHistory = history.filter((message) => !message.error && message.content.trim());
    const source = configRef.current.memory === false
      ? validHistory.slice(-1)
      : validHistory.slice(-MAX_CONTEXT_MESSAGES);
    for (const message of source) {
      apiMessages.push({ role: message.role, content: message.content });
    }
    return apiMessages;
  };

  const replaceLastAssistant = (content: string, patch?: Partial<QuickQaMessage>) => {
    setMessages((previous) => {
      if (previous.length === 0) return previous;
      const next = previous.slice();
      next[next.length - 1] = { ...next[next.length - 1], content, ...patch };
      return next;
    });
  };

  const sendQuestion = async (question: string, quotes: QuoteContext[] = []) => {
    const currentConfig = configRef.current;
    const value = question.trim();
    if (!isQuickQaConfigured(currentConfig) || !value || streaming) return;

    const questionWithQuote = quotes.length
      ? `${value}\n\n${quotes.map((quote, index) => `引用 ${index + 1}：\n${quote.text}`).join("\n\n")}`
      : value;
    const userMessage: QuickQaMessage = { id: crypto.randomUUID(), role: "user", content: questionWithQuote };
    const assistantMessage: QuickQaMessage = { id: crypto.randomUUID(), role: "assistant", content: "", streaming: true };
    const existing = threadsRef.current[currentSessionId] ?? [];
    setMessages([...existing, userMessage, assistantMessage]);
    activeQuotesRef.current = quotes;
    stickToBottomRef.current = true;
    setStreaming(true);

    const apiMessages = buildApiMessages([...existing, userMessage]);
    const controller = new AbortController();
    abortRef.current = controller;
    let full = "";
    let flushTimer: number | null = null;

    const flush = () => {
      flushTimer = null;
      replaceLastAssistant(full, { streaming: true });
    };

    try {
      for await (const chunk of streamChat(currentConfig, apiMessages, controller.signal)) {
        full += chunk;
        if (flushTimer === null) flushTimer = window.setTimeout(flush, STREAM_FLUSH_MS);
      }
      if (flushTimer !== null) window.clearTimeout(flushTimer);
      replaceLastAssistant(full, { streaming: false });

      if (full.trim()) {
        sendEvent({
          event: "qa_history_append",
          question: value,
          answer: full,
          model: currentConfig.model,
        });
      }
    } catch (error) {
      if (flushTimer !== null) window.clearTimeout(flushTimer);
      if (controller.signal.aborted) {
        replaceLastAssistant(full || "已停止生成", { streaming: false });
      } else {
        const message = error instanceof Error ? error.message : String(error);
        replaceLastAssistant(`请求失败：${message}`, { streaming: false, error: true });
      }
    } finally {
      abortRef.current = null;
      setStreaming(false);
    }
  };

  useEffect(() => {
    if (!open || !pendingQuestion || !configured) return;
    if (processedRequestIdRef.current === pendingQuestion.id) return;
    processedRequestIdRef.current = pendingQuestion.id;
    void sendQuestion(pendingQuestion.text, pendingQuestion.quotes);
    // pendingQuestion.id intentionally identifies one submission.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configured, open, pendingQuestion?.id]);

  const handleSend = () => {
    const value = input.trim();
    if (!value || streaming) return;
    setInput("");
    void sendQuestion(value, activeQuotesRef.current);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      handleSend();
    }
  };

  const onScroll = () => {
    const container = scrollRef.current;
    if (!container) return;
    const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 56;
    stickToBottomRef.current = nearBottom;
    setShowJumpToEnd(!nearBottom);
  };

  const jumpToEnd = () => {
    const container = scrollRef.current;
    if (!container) return;
    stickToBottomRef.current = true;
    container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
    setShowJumpToEnd(false);
  };

  const latestAssistant = [...messages].reverse().find((message) => message.role === "assistant" && !message.error && message.content.trim());
  const latestUser = [...messages].reverse().find((message) => message.role === "user");
  const latestPinned = Boolean(latestAssistant?.id && notes.some((note) => note.qaMessageId === latestAssistant.id));

  const pinLatest = () => {
    if (!latestAssistant || latestPinned) return;
    const sourceQuote = activeQuotesRef.current[0];
    addNote({
      sessionId: currentSessionId,
      pageId: sourceQuote?.pageId ?? currentPage?.id,
      pageTitle: sourceQuote?.pageTitle ?? currentPage?.title,
      quote: activeQuotesRef.current.map((quote) => quote.text).join("\n\n"),
      question: latestUser?.content,
      answer: latestAssistant.content,
      qaMessageId: latestAssistant.id,
    });
    toast.success("已固定到学习笔记");
  };

  const clearThread = () => {
    if (streaming) return;
    if (messages.length > 0) {
      const firstQuestion = messages.find((message) => message.role === "user")?.content || "未命名问答";
      const archive: QaArchive = {
        id: crypto.randomUUID(),
        title: firstQuestion.replace(/\s+/g, " ").slice(0, 38),
        updatedAt: Date.now(),
        messages: messages.map(({ streaming: _streaming, ...message }) => message),
      };
      setArchives((previous) => ({
        ...previous,
        [currentSessionId]: [archive, ...(previous[currentSessionId] ?? [])].slice(0, 30),
      }));
    }
    setMessages([]);
    activeQuotesRef.current = [];
    setHistoryOpen(false);
  };

  const restoreArchive = (archive: QaArchive) => {
    if (streaming) return;
    if (messages.length > 0) clearThread();
    setMessages(archive.messages);
    setArchives((previous) => ({
      ...previous,
      [currentSessionId]: (previous[currentSessionId] ?? []).filter((item) => item.id !== archive.id),
    }));
    setHistoryOpen(false);
    stickToBottomRef.current = true;
  };

  const deleteArchive = (archiveId: string) => {
    setArchives((previous) => ({
      ...previous,
      [currentSessionId]: (previous[currentSessionId] ?? []).filter((item) => item.id !== archiveId),
    }));
  };

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const onMove = (moveEvent: PointerEvent) => setQaWidth(window.innerWidth - moveEvent.clientX);
    const onUp = () => {
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  useEffect(() => {
    if (!open || (!qaTargetMessageId && !qaTargetAnswer)) return;
    const matchesTarget = (message: QuickQaMessage) => qaTargetMessageId
      ? message.id === qaTargetMessageId
      : message.role === "assistant" && message.content === qaTargetAnswer;
    const currentTarget = messages.find(matchesTarget);
    const currentHasTarget = Boolean(currentTarget);
    let targetId = currentTarget?.id;
    if (!currentHasTarget) {
      const archive = (archives[currentSessionId] ?? []).find((item) => item.messages.some(matchesTarget));
      if (archive) {
        targetId = archive.messages.find(matchesTarget)?.id;
        restoreArchive(archive);
      }
    }
    requestAnimationFrame(() => {
      if (targetId) document.getElementById(`qa-message-${targetId}`)?.scrollIntoView({ block: "center" });
      clearQaTarget();
    });
    // restoreArchive intentionally operates on the current session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, qaTargetMessageId, qaTargetAnswer]);

  return (
    <aside className={`qa-drawer${open ? " open" : ""}`} aria-hidden={!open} aria-label="上下文即时问答">
      <div className="qa-resize-handle" onPointerDown={startResize} title="拖动调整宽度" aria-hidden="true">
        <GripVertical size={14} />
      </div>
      <header className="qa-drawer-head">
        <div>
          <span className="qa-drawer-eyebrow">当前学习上下文</span>
          <strong className="qa-drawer-title">即时解惑</strong>
          <button type="button" className="qa-memory-status" onClick={onOpenSettings}>
            {config.memory === false ? "独立问答" : "记忆中"}
          </button>
        </div>
        <div className="qa-drawer-head-actions">
          <button type="button" className="qa-drawer-icon-btn" onClick={() => setHistoryOpen((value) => !value)} title="历史会话" aria-label="历史会话" aria-expanded={historyOpen}>
            <Clock3 size={16} />
          </button>
          <button type="button" className={`qa-drawer-icon-btn${latestPinned ? " active" : ""}`} onClick={pinLatest} disabled={!latestAssistant || streaming || latestPinned} title={latestPinned ? "已固定为学习笔记" : "固定为学习笔记"} aria-label={latestPinned ? "已固定为学习笔记" : "固定为学习笔记"}>
            <Pin size={16} />
          </button>
          <button type="button" className="qa-drawer-icon-btn" onClick={clearThread} disabled={streaming || messages.length === 0} title="新话题" aria-label="新话题">
            <RotateCcw size={16} />
          </button>
          <button type="button" className="qa-drawer-icon-btn" onClick={onClose} title="关闭" aria-label="关闭即时问答">
            <X size={18} />
          </button>
        </div>
      </header>

      {historyOpen && (
        <div className="qa-history-panel">
          <strong>本次学习的问答历史</strong>
          {(archives[currentSessionId] ?? []).length === 0 ? (
            <p>开始新话题后，上一段问答会保留在这里。</p>
          ) : (
            (archives[currentSessionId] ?? []).map((archive) => (
              <div className="qa-history-item" key={archive.id}>
                <button type="button" className="qa-history-open" onClick={() => restoreArchive(archive)}>
                  <span>{archive.title}</span>
                  <time>{new Date(archive.updatedAt).toLocaleString()}</time>
                </button>
                <button type="button" className="qa-history-delete" onClick={() => deleteArchive(archive.id)} aria-label={`删除会话 ${archive.title}`} title="删除会话">
                  <Trash2 size={14} />
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {!configured ? (
        <div className="qa-drawer-empty">
          <p>配置一个 OpenAI 兼容模型后，即可在当前页面内即时追问。</p>
          <button type="button" className="qa-drawer-config-btn" onClick={onOpenSettings}>配置即时问答</button>
        </div>
      ) : (
        <>
          <div className="qa-drawer-body" ref={scrollRef} onScroll={onScroll}>
            {messages.length === 0 ? (
              <div className="qa-drawer-placeholder">
                <strong>问题留在上下文里</strong>
                <p>选中原文后即时解释，或在下方直接追问。</p>
              </div>
            ) : (
              <div className="qa-drawer-msgs">
                {messages.map((message, index) => (
                  <article id={message.id ? `qa-message-${message.id}` : undefined} className={`qa-message qa-message-${message.role}${message.error ? " is-error" : ""}`} key={message.id || `${message.role}-${index}`}>
                    <span>{message.role === "user" ? "问题" : "回答"}</span>
                    {message.role === "assistant" ? (
                      <div className="qa-answer-content">
                        {message.content ? (
                          <MarkdownRenderer
                            content={message.content}
                            mode={message.streaming ? "streaming" : "document"}
                          />
                        ) : <p>正在梳理...</p>}
                        {message.streaming && <i className="qa-cursor" aria-label="正在生成" />}
                      </div>
                    ) : <p>{message.content}</p>}
                  </article>
                ))}
              </div>
            )}
          </div>

          {showJumpToEnd && (
            <button type="button" className="qa-jump-end" onClick={jumpToEnd}>
              <ArrowDown size={15} /> 回到最新回答
            </button>
          )}

          <footer className="qa-drawer-foot">
            <textarea
              ref={inputRef}
              className="qa-drawer-input"
              placeholder={streaming ? "回答生成中" : "继续追问"}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={onKeyDown}
              rows={1}
              disabled={streaming}
            />
            {streaming ? (
              <button type="button" className="qa-drawer-send" onClick={() => abortRef.current?.abort()} aria-label="停止生成">
                <Square size={14} fill="currentColor" />
              </button>
            ) : (
              <button type="button" className="qa-drawer-send" onClick={handleSend} disabled={!input.trim()} aria-label="发送追问">
                <Send size={16} />
              </button>
            )}
          </footer>
        </>
      )}
    </aside>
  );
}
