import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { useExamForgeStore } from "../store";
import type { ClientEvent, ServerMessage, ToastType } from "../types";

const HUB_ORIGIN = "http://localhost:3456";
const WS_URL = "ws://localhost:3456/ws";
const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 5000;

function showToast(text: string, type: ToastType): void {
  switch (type) {
    case "success":
      toast.success(text);
      break;
    case "warning":
      toast.warning(text);
      break;
    case "error":
      toast.error(text);
      break;
    default:
      toast.info(text);
      break;
  }
}

function getUrlSessionId(): string {
  return new URLSearchParams(window.location.search).get("session") ?? "";
}

function buildClaimInstruction(code: string): string {
  return [
    `接管 MoeReview 会话：${code}。`,
    "接管后请先调用 get_session_snapshot，读取历史页面、错题、收藏和问答记录，再继续复习。",
  ].join("\n");
}

export function useExamForge() {
  const wsRef = useRef<WebSocket | null>(null);
  const autoOpenedAgentSessionRef = useRef(false);
  const urlSessionIdRef = useRef(getUrlSessionId());
  const currentSessionId = useExamForgeStore((s) => s.currentSessionId);

  useEffect(() => {
    let disposed = false;
    let manualClose = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let sessionsPoller: ReturnType<typeof setInterval> | null = null;
    let backoff = INITIAL_BACKOFF_MS;

    async function fetchSessions(): Promise<void> {
      try {
        const response = await fetch(`${HUB_ORIGIN}/api/sessions`, { cache: "no-store" });
        if (!response.ok) return;
        const data = (await response.json()) as Pick<Extract<ServerMessage, { tool: "sessions_update" }>, "sessions">;
        useExamForgeStore.getState().dispatch({
          tool: "sessions_update",
          sessions: data.sessions,
          currentId: useExamForgeStore.getState().currentSessionId,
        });
      } catch {
        // Hub may still be starting. WebSocket reconnect covers the next attempt.
      }
    }

    function scheduleReconnect(): void {
      if (disposed || manualClose) return;
      const delay = Math.min(backoff, MAX_BACKOFF_MS);
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
      reconnectTimer = setTimeout(connect, delay);
    }

    function openSession(id: string): void {
      const ws = wsRef.current;
      if (!id || !ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ event: "open_session", sessionId: id }));
      const url = new URL(window.location.href);
      url.searchParams.set("session", id);
      window.history.replaceState(null, "", url);
    }

    function connect(): void {
      if (disposed) return;
      useExamForgeStore.getState().setConnectionStatus("connecting");
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        backoff = INITIAL_BACKOFF_MS;
        useExamForgeStore.getState().setConnectionStatus("connected");
        ws.send(JSON.stringify({ event: "list_sessions" }));
        if (urlSessionIdRef.current) openSession(urlSessionIdRef.current);
        void fetchSessions();
      };

      ws.onclose = () => {
        useExamForgeStore.getState().setConnectionStatus("disconnected");
        scheduleReconnect();
      };

      ws.onerror = () => {
        // onclose schedules reconnect.
      };

      ws.onmessage = (e) => {
        let msg: ServerMessage;
        try {
          msg = JSON.parse(typeof e.data === "string" ? e.data : "") as ServerMessage;
        } catch {
          return;
        }

        if (msg.tool === "show_toast") {
          showToast(msg.text, msg.toastType ?? "info");
          return;
        }

        if (msg.tool === "claim_code_created") {
          void navigator.clipboard?.writeText(buildClaimInstruction(msg.code)).catch(() => undefined);
          showToast(msg.force ? `已断开当前 Agent，接管码已复制：${msg.code}` : `接管码已复制：${msg.code}`, "success");
          return;
        }

        useExamForgeStore.getState().dispatch(msg);

        if (msg.tool === "sessions_update" && !urlSessionIdRef.current && !autoOpenedAgentSessionRef.current) {
          const selected = useExamForgeStore.getState().currentSessionId;
          if (!selected) {
            const active = msg.sessions.find((session) =>
              ["idle", "waiting", "working"].includes(session.agentConnection?.status ?? ""),
            );
            if (active) {
              autoOpenedAgentSessionRef.current = true;
              openSession(active.id);
            }
          }
        }

      };
    }

    void fetchSessions();
    sessionsPoller = setInterval(() => {
      void fetchSessions();
    }, 10_000);
    connect();

    return () => {
      disposed = true;
      manualClose = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (sessionsPoller) clearInterval(sessionsPoller);
      const ws = wsRef.current;
      if (ws) {
        ws.onclose = null;
        ws.close();
      }
      wsRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!currentSessionId) return;
    let disposed = false;

    async function syncSession(): Promise<void> {
      try {
        const [pagesResponse, favoritesResponse, guidanceResponse] = await Promise.all([
          fetch(`${HUB_ORIGIN}/api/sessions/${encodeURIComponent(currentSessionId)}/pages`, { cache: "no-store" }),
          fetch(`${HUB_ORIGIN}/api/sessions/${encodeURIComponent(currentSessionId)}/favorites`, { cache: "no-store" }),
          fetch(`${HUB_ORIGIN}/api/sessions/${encodeURIComponent(currentSessionId)}/guidance`, { cache: "no-store" }),
        ]);
        if (disposed) return;
        if (pagesResponse.ok) {
          const data = (await pagesResponse.json()) as { pages: Extract<ServerMessage, { tool: "session_pages_update" }>["pages"] };
          useExamForgeStore.getState().dispatch({ tool: "session_pages_update", sessionId: currentSessionId, pages: data.pages });
        }
        if (favoritesResponse.ok) {
          const data = (await favoritesResponse.json()) as { favorites: Extract<ServerMessage, { tool: "favorites_update" }>["favorites"] };
          useExamForgeStore.getState().dispatch({ tool: "favorites_update", sessionId: currentSessionId, favorites: data.favorites });
        }
        if (guidanceResponse.ok) {
          const data = (await guidanceResponse.json()) as { guidance: Extract<ServerMessage, { tool: "guidance_update" }>["guidance"] };
          useExamForgeStore.getState().dispatch({ tool: "guidance_update", sessionId: currentSessionId, guidance: data.guidance });
        }
      } catch {
        // Keep current UI; WebSocket reconnect will recover.
      }
    }

    void syncSession();
    return () => {
      disposed = true;
    };
  }, [currentSessionId]);

  const sendEvent = useCallback((event: ClientEvent) => {
    const ws = wsRef.current;
    const sessionId = useExamForgeStore.getState().currentSessionId;
    const payload = sessionId && !event.sessionId ? { ...event, sessionId } : event;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    } else {
      return false;
    }
    if (event.event === "message" && typeof payload.sessionId === "string") {
      const pendingSessionId = payload.sessionId;
      useExamForgeStore.getState().setAgentPending(pendingSessionId, true);
      const pendingSince = useExamForgeStore.getState().agentPendingSessions[pendingSessionId];
      window.setTimeout(() => {
        if (useExamForgeStore.getState().agentPendingSessions[pendingSessionId] === pendingSince) {
          useExamForgeStore.getState().setAgentPending(pendingSessionId, false);
        }
      }, 300_000);
    }
    return true;
  }, []);

  const connectionStatus = useExamForgeStore((s) => s.connectionStatus);
  return { sendEvent, connectionStatus };
}
