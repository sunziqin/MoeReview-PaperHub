import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Bot, ChevronDown, History, MessageCircle, Send, Settings2, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { useExamForgeStore } from "../store";
import type { ClientEvent, QuickQaConfig } from "../types";
import { useWorkspaceStore } from "../workspaceStore";
import { fetchQuickQaConfig, isQuickQaConfigured, loadQuickQaConfig } from "../services/quickQa";
import { QuickQaDrawer } from "./QuickQaDrawer";
import { QuickQaSettings } from "./QuickQaSettings";

type InputMode = "agent" | "quick";

interface InputBarProps {
  sendEvent: (event: ClientEvent) => void;
}

function buildQuotedPayload(value: string, quotes: { pageTitle?: string; text: string }[]): string {
  if (quotes.length === 0) return value;
  const quoteText = quotes
    .map((quote, index) => {
      const title = quote.pageTitle ? `《${quote.pageTitle}》` : "";
      return `引用 ${index + 1}${title}：\n> ${quote.text.replace(/\n/g, "\n> ")}`;
    })
    .join("\n\n");
  return `${value}\n\n${quoteText}`;
}

export function InputBar({ sendEvent }: InputBarProps) {
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [mode, setMode] = useState<InputMode>("agent");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [config, setConfig] = useState<QuickQaConfig>(() => loadQuickQaConfig());
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    let disposed = false;
    void fetchQuickQaConfig().then((next) => {
      if (!disposed) setConfig(next);
    }).catch(() => undefined);
    return () => { disposed = true; };
  }, []);

  const connectionStatus = useExamForgeStore((state) => state.connectionStatus);
  const currentSessionId = useExamForgeStore((state) => state.currentSessionId);
  const currentSession = useExamForgeStore((state) =>
    state.sessions.find((session) => session.id === state.currentSessionId),
  );
  const quotes = useWorkspaceStore((state) => state.quotes);
  const removeQuote = useWorkspaceStore((state) => state.removeQuote);
  const clearQuotes = useWorkspaceStore((state) => state.clearQuotes);
  const qaOpen = useWorkspaceStore((state) => state.qaOpen);
  const openQa = useWorkspaceStore((state) => state.openQa);
  const closeQa = useWorkspaceStore((state) => state.closeQa);
  const qaRequest = useWorkspaceStore((state) => state.qaRequest);
  const requestQa = useWorkspaceStore((state) => state.requestQa);
  const dockFocusNonce = useWorkspaceStore((state) => state.dockFocusNonce);

  const quickReady = isQuickQaConfigured(config);
  const agentStatus = currentSession?.agentConnection?.status ?? "offline";
  const canQueueForAgent =
    connectionStatus === "connected" &&
    Boolean(currentSessionId) &&
    ["idle", "waiting", "working"].includes(agentStatus);
  const canSend = text.trim().length > 0 && (mode === "quick" || canQueueForAgent);

  useEffect(() => {
    if (dockFocusNonce === 0) return;
    setCollapsed(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [dockFocusNonce]);

  const send = () => {
    const value = text.trim();
    if (!value) return;

    if (mode === "quick") {
      if (!quickReady) {
        setSettingsOpen(true);
        return;
      }
      requestQa(value, quotes);
      setText("");
      clearQuotes();
      return;
    }

    if (!canQueueForAgent) {
      toast.error(!currentSessionId ? "请先选择一个会话" : "当前会话没有可接收消息的 Agent");
      return;
    }

    sendEvent({
      event: "message",
      text: buildQuotedPayload(value, quotes),
      sessionId: currentSessionId,
    });
    setText("");
    clearQuotes();

    if (agentStatus === "waiting") {
      toast.success("已发送，Agent 正在处理");
    } else if (agentStatus === "working") {
      toast.success("已加入待处理，Agent 本轮结束后可读取");
    } else {
      toast.success("已留给 Agent，下次工作时会读取");
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send();
    }
    if (event.key === "Escape" && !text) {
      inputRef.current?.blur();
      setCollapsed(true);
    }
  };

  const switchMode = (next: InputMode) => {
    if (next === "quick" && !quickReady) {
      setSettingsOpen(true);
      return;
    }
    setMode(next);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const handleConfigChange = useCallback((nextConfig: QuickQaConfig) => {
    setConfig(nextConfig);
    if (!isQuickQaConfigured(nextConfig) && mode === "quick") setMode("agent");
  }, [mode]);

  const placeholder =
    mode === "quick"
      ? "追问当前内容"
      : agentStatus === "waiting"
        ? "发送给正在等待的 Agent"
        : canQueueForAgent
          ? "留给 Agent，下次处理"
          : "选择已绑定 Agent 的会话后可发送";

  return (
    <>
      <footer className={`input-bar${focused || text || quotes.length ? " is-active" : ""}${collapsed ? " is-collapsed" : ""}`}>
        {collapsed ? (
          <button
            type="button"
            className="command-dock-restore"
            onClick={() => {
              setCollapsed(false);
              requestAnimationFrame(() => inputRef.current?.focus());
            }}
          >
            <MessageCircle size={18} />
            <span>提问</span>
          </button>
        ) : (
          <div className="composer-shell">
            {quotes.length > 0 && (
              <div className="composer-quotes" aria-label="已引用内容">
                {quotes.map((quote, index) => (
                  <div className="composer-quote" title={quote.text} key={`${quote.pageId || "quote"}-${index}`}>
                    <span>{quote.pageTitle || `引用 ${index + 1}`}</span>
                    <p>{quote.text}</p>
                    <button type="button" onClick={() => removeQuote(index)} aria-label={`移除引用 ${index + 1}`}>
                      <X size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="composer-input-row">
              <div className="composer-leading">
                <div className="mode-switch" role="group" aria-label="输入模式">
                  <button
                    type="button"
                    className={`mode-switch-btn${mode === "agent" ? " active" : ""}`}
                    onClick={() => switchMode("agent")}
                    aria-pressed={mode === "agent"}
                  >
                    <Bot size={14} />
                    <span>Agent</span>
                  </button>
                  <button
                    type="button"
                    className={`mode-switch-btn${mode === "quick" ? " active" : ""}${!quickReady ? " disabled" : ""}`}
                    onClick={() => switchMode("quick")}
                    aria-pressed={mode === "quick"}
                    title={quickReady ? "即时问答" : "配置即时问答"}
                  >
                    <Sparkles size={14} />
                    <span>即时</span>
                  </button>
                </div>
              </div>

              <textarea
                ref={inputRef}
                className="input-field"
                placeholder={placeholder}
                value={text}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={onKeyDown}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                aria-label="学习指令输入"
                rows={1}
              />

              <div className="composer-actions">
                <button type="button" className="composer-icon-btn" onClick={openQa} title="打开最近问答" aria-label="打开最近问答">
                  <History size={15} />
                </button>
                <button type="button" className="composer-icon-btn" onClick={() => setSettingsOpen(true)} title="即时问答配置" aria-label="即时问答配置">
                  <Settings2 size={15} />
                </button>
                <button type="button" className="composer-icon-btn" onClick={() => setCollapsed(true)} aria-label="收起提问栏" title="收起">
                  <ChevronDown size={16} />
                </button>
                <button className="send-button" type="button" onClick={send} disabled={!canSend} aria-label="发送">
                  <Send size={17} />
                </button>
              </div>
            </div>
          </div>
        )}
      </footer>

      <QuickQaSettings open={settingsOpen} onClose={() => setSettingsOpen(false)} onConfigChange={handleConfigChange} />
      <QuickQaDrawer
        open={qaOpen}
        onClose={closeQa}
        pendingQuestion={qaRequest}
        config={config}
        sendEvent={sendEvent}
        onOpenSettings={() => setSettingsOpen(true)}
      />
    </>
  );
}
