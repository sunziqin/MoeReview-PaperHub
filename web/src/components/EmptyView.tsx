import { BookOpen, LoaderCircle, Radio, Sparkles } from "lucide-react";
import { useExamForgeStore } from "../store";
import { formatRelativeTime } from "../utils/time";

export function EmptyView() {
  const connectionStatus = useExamForgeStore((s) => s.connectionStatus);
  const agentThinking = useExamForgeStore((s) => s.agentThinking);
  const sessions = useExamForgeStore((s) => s.sessions);
  const currentSessionId = useExamForgeStore((s) => s.currentSessionId);
  const currentSession = sessions.find((session) => session.id === currentSessionId);
  const activeAgentSession = sessions.find((session) =>
    ["idle", "waiting", "working"].includes(session.agentConnection?.status ?? ""),
  );
  const ready = connectionStatus === "connected";

  if (!currentSessionId) {
    return (
      <div className="empty-view welcome-view">
        <div className="empty-mark" aria-hidden="true">
          {ready ? <Sparkles /> : <LoaderCircle className="spin" />}
        </div>
        <div className="empty-copy">
          <span className="empty-eyebrow">{ready ? "MoeReview Hub 已就绪" : "正在连接 MoeReview Hub"}</span>
          <h2>打开历史会话回看，或等待 Agent 接入</h2>
          <p className="empty-hint">
            新会话由 Agent 创建或绑定。前端只负责回看历史、切换查看和展示连接状态。
          </p>
        </div>
        <div className="welcome-grid">
          <div className="welcome-card">
            <Radio size={18} />
            <strong>{activeAgentSession ? "Agent 已连接" : "暂无 Agent 连接"}</strong>
            <span>{activeAgentSession ? activeAgentSession.title : "启动 Codex 后会显示绑定会话"}</span>
          </div>
          <div className="welcome-card">
            <BookOpen size={18} />
            <strong>{sessions.length} 个历史会话</strong>
            <span>
              {sessions[0]
                ? `最近：${sessions[0].title} · ${formatRelativeTime(sessions[0].last_access)}`
                : "还没有学习记录。启动 Agent 后会自动创建。"}
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="empty-view">
      <div className="empty-mark" aria-hidden="true">
        {agentThinking || !ready ? <LoaderCircle className="spin" /> : <BookOpen />}
      </div>
      <div className="empty-copy">
        <span className="empty-eyebrow">{ready ? "学习空间已就绪" : "正在连接 MoeReview Hub"}</span>
        <h2>{currentSession?.title ?? "Untitled session"}</h2>
        <p className="empty-hint">
          {agentThinking ? "正在为你整理内容" : "这个会话还没有学习页面。连接 Agent 后即可开始。"}
        </p>
      </div>
    </div>
  );
}
