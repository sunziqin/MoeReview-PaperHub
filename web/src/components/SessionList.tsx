import type { CSSProperties } from "react";
import { KeyRound, Power, Trash2, Unplug } from "lucide-react";
import { toast } from "sonner";
import { useExamForgeStore } from "../store";
import type { ClientEvent, SessionMeta } from "../types";
import { formatRelativeTime } from "../utils/time";

interface SessionListProps {
  sendEvent: (event: ClientEvent) => void;
}

const HUB_ORIGIN = "http://localhost:3456";

function isActiveAgent(session: SessionMeta): boolean {
  return ["idle", "waiting", "working"].includes(session.agentConnection?.status ?? "");
}

function getAgentStatus(session: SessionMeta): { text: string; online: boolean } | null {
  const status = session.agentConnection?.status ?? "offline";
  if (status === "idle") return { text: "Agent 在线", online: true };
  if (status === "waiting") return { text: "等待回复", online: true };
  if (status === "working") return { text: "生成中", online: true };
  if (status === "disconnected") return { text: "已断开", online: false };
  return null;
}

function buildClaimInstruction(code: string): string {
  return [
    `接管 MoeReview 会话：${code}。`,
    "接管后请先调用 get_session_snapshot，读取历史页面、错题、收藏和问答记录，再继续复习。",
  ].join("\n");
}

export function SessionList({ sendEvent }: SessionListProps) {
  const sessions = useExamForgeStore((s) => s.sessions);
  const currentSessionId = useExamForgeStore((s) => s.currentSessionId);

  function handleSwitch(id: string): void {
    sendEvent({ event: "open_session", sessionId: id });
  }

  function handleDelete(id: string, isCurrent: boolean, hasActiveAgent: boolean): void {
    if (isCurrent) {
      toast.error("不能删除当前正在查看的会话");
      return;
    }
    if (hasActiveAgent) {
      toast.error("这个会话有 Agent 在线，不能删除");
      return;
    }
    sendEvent({ event: "delete_session", id });
  }

  async function handleClaim(session: SessionMeta, force = false): Promise<void> {
    if (!force && isActiveAgent(session)) {
      toast.error("这个会话已经有 Agent 在线。如需替换，请使用强制接管。");
      return;
    }

    try {
      const response = await fetch(`${HUB_ORIGIN}/api/sessions/${encodeURIComponent(session.id)}/claim-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force }),
      });
      const data = (await response.json().catch(() => ({}))) as { code?: string; error?: string; force?: boolean };
      if (!response.ok || !data.code) throw new Error(data.error ?? "生成接管码失败");

      const instruction = buildClaimInstruction(data.code);
      await navigator.clipboard?.writeText(instruction).catch(() => undefined);
      toast.success(data.force ? `已断开当前 Agent，接管码已复制：${data.code}` : `接管码已复制：${data.code}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "生成接管码失败");
    }
  }

  async function handleDisconnect(session: SessionMeta): Promise<void> {
    if (!isActiveAgent(session)) {
      toast.info("这个会话当前没有在线 Agent");
      return;
    }

    try {
      const response = await fetch(`${HUB_ORIGIN}/api/sessions/${encodeURIComponent(session.id)}/disconnect-agent`, {
        method: "POST",
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "断开 Agent 失败");
      toast.success("已断开当前 Agent");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "断开 Agent 失败");
    }
  }

  return (
    <div className="session-list">
      {sessions.length === 0 ? (
        <p className="session-list-empty">暂无历史会话。Agent 创建或接管后会出现在这里。</p>
      ) : (
        <ul className="session-list-items">
          {sessions.map((session, i) => {
            const isCurrent = session.id === currentSessionId;
            const title = session.title?.trim() || "未命名会话";
            const agent = getAgentStatus(session);
            const hasActiveAgent = isActiveAgent(session);

            return (
              <li
                key={session.id}
                className={`session-item${isCurrent ? " active" : ""}`}
                style={{ "--i": i } as CSSProperties}
              >
                <button type="button" className="session-item-main" onClick={() => handleSwitch(session.id)}>
                  <span className="session-item-title">{title}</span>
                  {agent && (
                    <span className={`session-agent-badge ${agent.online ? "online" : "offline"}`}>
                      {agent.text}
                    </span>
                  )}
                  <span className="session-item-time">{formatRelativeTime(session.last_access)}</span>
                </button>
                <button
                  type="button"
                  className="session-item-claim"
                  title={hasActiveAgent ? "已有 Agent 在线" : "生成 Agent 接管码"}
                  aria-label={hasActiveAgent ? "已有 Agent 在线" : "生成 Agent 接管码"}
                  disabled={hasActiveAgent}
                  onClick={() => void handleClaim(session)}
                >
                  <KeyRound size={14} />
                </button>
                <button
                  type="button"
                  className="session-item-claim danger"
                  title="断开当前 Agent 并生成接管码"
                  aria-label="断开当前 Agent 并生成接管码"
                  disabled={!hasActiveAgent}
                  onClick={() => void handleClaim(session, true)}
                >
                  <Unplug size={14} />
                </button>
                <button
                  type="button"
                  className="session-item-claim danger"
                  title="仅断开当前 Agent"
                  aria-label="仅断开当前 Agent"
                  disabled={!hasActiveAgent}
                  onClick={() => void handleDisconnect(session)}
                >
                  <Power size={14} />
                </button>
                <button
                  type="button"
                  className="session-item-delete"
                  title="删除会话"
                  aria-label="删除会话"
                  disabled={hasActiveAgent}
                  onClick={() => handleDelete(session.id, isCurrent, hasActiveAgent)}
                >
                  <Trash2 size={14} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
