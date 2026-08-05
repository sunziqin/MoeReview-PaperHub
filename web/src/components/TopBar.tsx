import { useEffect, useRef, useState } from "react";
import { ChevronDown, Focus, Home, Maximize2, Pause, Play, RotateCcw } from "lucide-react";
import { useExamForgeStore } from "../store";
import type { ClientEvent } from "../types";
import { useWorkspaceStore } from "../workspaceStore";

function formatTime(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const rest = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

interface StatusMeta {
  text: string;
  className: string;
}

const TIMER_STORAGE_KEY = "examforge-study-timer";

interface TimerState {
  running: boolean;
  accumulated: number;
  startTime: number | null;
}

function loadTimerState(): TimerState {
  if (typeof window === "undefined") return { running: false, accumulated: 0, startTime: null };
  try {
    const raw = window.localStorage.getItem(TIMER_STORAGE_KEY);
    if (!raw) return { running: false, accumulated: 0, startTime: null };
    const parsed = JSON.parse(raw) as Partial<TimerState>;
    return {
      running: Boolean(parsed.running),
      accumulated: Number(parsed.accumulated) || 0,
      startTime: parsed.startTime ?? null,
    };
  } catch {
    return { running: false, accumulated: 0, startTime: null };
  }
}

function StudyTimer() {
  const initial = useRef<TimerState>(loadTimerState());
  const [running, setRunning] = useState(initial.current.running);
  const [accumulated, setAccumulated] = useState(initial.current.accumulated);
  const [startTime, setStartTime] = useState<number | null>(initial.current.startTime);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!running) return undefined;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [running]);

  useEffect(() => {
    window.localStorage.setItem(TIMER_STORAGE_KEY, JSON.stringify({ running, accumulated, startTime }));
  }, [running, accumulated, startTime]);

  const elapsed = accumulated + (running && startTime ? (Date.now() - startTime) / 1000 : 0);

  function toggle(): void {
    if (running) {
      if (startTime !== null) setAccumulated((value) => value + (Date.now() - startTime) / 1000);
      setStartTime(null);
      setRunning(false);
      return;
    }
    setStartTime(Date.now());
    setRunning(true);
  }

  function reset(): void {
    setRunning(false);
    setStartTime(null);
    setAccumulated(0);
  }

  return (
    <span className="study-timer" title="学习时长">
      <button
        type="button"
        className="study-timer-btn"
        onClick={toggle}
        aria-label={running ? "暂停" : "开始"}
      >
        {running ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
      </button>
      <span className="study-timer-time">{formatTime(elapsed)}</span>
      <button
        type="button"
        className="study-timer-btn study-timer-reset"
        onClick={reset}
        aria-label="重置"
        title="重置"
      >
        <RotateCcw size={14} />
      </button>
    </span>
  );
}

interface TopBarProps {
  sendEvent: (event: ClientEvent) => void;
  apiLearning?: boolean;
}

export function TopBar({ sendEvent, apiLearning = false }: TopBarProps) {
  const connectionStatus = useExamForgeStore((s) => s.connectionStatus);
  const agentPendingSessions = useExamForgeStore((s) => s.agentPendingSessions);
  const sessionTitle = useExamForgeStore((s) => s.sessionTitle);
  const currentSessionId = useExamForgeStore((s) => s.currentSessionId);
  const sessions = useExamForgeStore((s) => s.sessions);
  const currentSession = useExamForgeStore((s) =>
    s.sessions.find((session) => session.id === s.currentSessionId),
  );
  const focusMode = useExamForgeStore((s) => s.focusMode);
  const toggleFocusMode = useExamForgeStore((s) => s.toggleFocusMode);
  const returnToWelcome = useExamForgeStore((s) => s.returnToWelcome);
  const closeQa = useWorkspaceStore((s) => s.closeQa);
  const [menuOpen, setMenuOpen] = useState(false);
  const switcherRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return undefined;

    function handlePointerDown(event: PointerEvent): void {
      if (!switcherRef.current?.contains(event.target as Node)) setMenuOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") setMenuOpen(false);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  function handleSessionSelect(sessionId: string): void {
    setMenuOpen(false);
    if (!sessionId) {
      returnToWelcome();
      return;
    }
    sendEvent({ event: "open_session", sessionId });
  }

  const agentStatus = currentSession?.agentConnection?.status ?? "offline";
  const currentAgentPending = Boolean(currentSessionId && agentPendingSessions[currentSessionId]);
  const status: StatusMeta =
    connectionStatus === "connecting"
      ? { text: "连接 Hub 中...", className: "status connecting" }
      : connectionStatus === "disconnected"
        ? { text: "Hub 未连接", className: "status disconnected" }
        : !currentSessionId
          ? { text: "Hub 已连接 · 欢迎页", className: "status connected" }
          : apiLearning
            ? { text: "论文导师 · 统一 API", className: "status connected" }
          : agentStatus === "waiting"
            ? { text: "Agent 等待回复", className: "status thinking" }
            : agentStatus === "working" || currentAgentPending
              ? { text: "Agent 生成中", className: "status thinking" }
              : agentStatus === "idle"
                ? { text: "Agent 空闲 · 可留言", className: "status connected" }
                : { text: "历史回看 · 未连接 Agent", className: "status disconnected" };

  return (
    <header className="topbar">
      <div className="topbar-title-group">
        <button
          type="button"
          className="topbar-home-btn"
          onClick={returnToWelcome}
          title="返回欢迎页"
          aria-label="返回欢迎页"
        >
          <Home size={15} />
        </button>
        <div className="session-switcher" ref={switcherRef}>
          <button
            type="button"
            className="session-title-button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-haspopup="listbox"
            aria-expanded={menuOpen}
            title={sessionTitle || "MoeReview"}
          >
            <span className="session-title-text">{sessionTitle || "MoeReview"}</span>
            <ChevronDown className="session-title-chevron" size={14} aria-hidden="true" />
          </button>
          {menuOpen && (
            <div className="session-menu" role="listbox" aria-label="切换会话">
              <button
                type="button"
                className={`session-menu-item${!currentSessionId ? " active" : ""}`}
                onClick={() => handleSessionSelect("")}
                role="option"
                aria-selected={!currentSessionId}
              >
                <span className="session-menu-title">MoeReview</span>
                <span className="session-menu-meta">欢迎页</span>
              </button>
              {sessions.map((session) => {
                const active = session.id === currentSessionId;
                const title = session.title?.trim() || "未命名会话";
                const statusText = session.agentConnection?.status === "working"
                  ? "生成中"
                  : session.agentConnection?.status === "waiting"
                    ? "等待回复"
                    : session.agentConnection?.status === "idle"
                      ? "Agent 在线"
                      : "历史会话";
                return (
                  <button
                    type="button"
                    className={`session-menu-item${active ? " active" : ""}`}
                    key={session.id}
                    onClick={() => handleSessionSelect(session.id)}
                    role="option"
                    aria-selected={active}
                  >
                    <span className="session-menu-title">{title}</span>
                    <span className="session-menu-meta">{statusText}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <span className={status.className}>
          <i className="dot" aria-hidden="true" />
          {status.text}
        </span>
      </div>
      <div className="topbar-tools">
        <StudyTimer />
        <button
          type="button"
          className={`topbar-icon-btn${focusMode ? " active" : ""}`}
          onClick={() => {
            if (!focusMode) closeQa();
            toggleFocusMode();
          }}
          title={focusMode ? "退出专注模式 (F)" : "进入专注模式 (F)"}
          aria-label="切换专注模式"
          aria-pressed={focusMode}
        >
          {focusMode ? <Focus size={18} /> : <Maximize2 size={18} />}
        </button>
      </div>
    </header>
  );
}
