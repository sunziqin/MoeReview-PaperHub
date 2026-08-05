/**
 * MoeReview Hub: long-lived HTTP + WebSocket service.
 *
 * The Hub owns the browser connection, local session data, and Agent routing.
 * MCP Agent adapter processes are temporary clients that register here and
 * proxy tool calls through `/api/agent-connections/:agentId/tools`.
 */

import http from "node:http";
import { existsSync, readFile, stat } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import {
  appendActivityLog,
  appendQaHistory,
  readData,
  toggleFavorite,
} from "../state/persistence.js";
import { clearSessionRuntimeState, pushEvent } from "../state/store.js";
import {
  assertSessionBindable,
  assertAgentOwnsActiveBinding,
  consumeSessionClaimCode,
  createConversationBinding,
  createSessionClaimCode,
  getConversationBinding,
  listConversationBindings,
  markBindingConnected,
  markBindingDisconnected,
  replaceActiveBindingForSession,
  replaceBindingsForSession,
  type ConversationBinding,
} from "../state/bindings.js";
import {
  clearAgentConnection,
  createSession,
  deleteSession,
  ensureSession,
  initSessions,
  listSessions,
  readMeta,
  touchSession,
  updateAgentConnection,
  updateSessionTitle,
  withSessionContext,
  bindPaperToSession,
  getActiveSessionId,
  type AgentConnectionStatus,
  type SessionMeta,
} from "../state/sessions.js";
import { withAgentContext } from "../state/agentContext.js";
import { allTools } from "../tools/registry.js";
import { getApiAgentPublicConfig, getAppPreferences, saveApiAgentConfig, saveAppPreferences } from "../state/appConfig.js";
import { callApiAgent, chatWithApiAgent, createApiAgentPage } from "../services/apiAgent.js";
import { createLearningTurnPlan, type LearningIntent, type LearningTurnPlan } from "../services/learningAgent.js";
import { translateSegment } from "../services/translation.js";
import { answerPaperQuestion, createPaperAnswerPage, createPaperSessionPage, searchPapers } from "../papers/service.js";
import { extractPaperPdf, readCachedPaperPdf } from "../papers/pdf.js";
import {
  clearRecommendationHistory,
  dismissPaper,
  exportPaperData,
  generatePaperReadingGuide,
  getPaper,
  getPaperDetail,
  getPaperFeed,
  listPaperLibrary,
  recordInteractionFromInput,
  rememberPapers,
  summarizePaper,
  updatePaperLibrary,
} from "../papers/workspace.js";
import {
  controlTranslationJob,
  createTranslationJobs,
  getPaperTranslations,
  listTranslationJobs,
} from "../papers/translationJobs.js";

const PORT = Number(process.env.MOEREVIEW_HUB_PORT ?? 3456);
const AGENT_STALE_MS = 30_000;

const LEARNING_INTENTS = new Set<LearningIntent>(["overview", "chapter", "cards", "quiz-choice", "quiz-short", "ask"]);

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_DIST = join(__dirname, "..", "..", "..", "web", "dist");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

interface WebClient {
  id: string;
  ws: WebSocket;
  openSessionId?: string;
}

interface AgentClient {
  agentId: string;
  conversationKey?: string;
  boundSessionId?: string;
  clientName: string;
  connectedAt: number;
  lastSeenAt: number;
}

const webClients = new Map<string, WebClient>();
const agents = new Map<string, AgentClient>();
const serverStartedAt = Date.now();

function makeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

async function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf-8")) as Record<string, unknown>;
  } catch {
    throw new Error("invalid JSON body");
  }
}

function send(client: WebClient, message: unknown): void {
  if (client.ws.readyState !== WebSocket.OPEN) return;
  client.ws.send(JSON.stringify(message));
}

export function broadcast(command: Record<string, unknown>): void {
  let sessionId = "";
  if (typeof command.sessionId === "string") {
    sessionId = command.sessionId;
  } else {
    try {
      sessionId = getActiveSessionId();
    } catch {
      sessionId = "";
    }
  }
  const payload = { ...command, sessionId };
  for (const client of webClients.values()) {
    if (!sessionId || !client.openSessionId || client.openSessionId === sessionId) {
      send(client, payload);
    }
  }
}

function isLiveStatus(status: string | undefined): boolean {
  return status === "idle" || status === "waiting" || status === "working";
}

function statusForBinding(binding: ConversationBinding | undefined): AgentConnectionStatus {
  if (!binding) return "offline";
  if (binding.status === "deleted" || binding.status === "replaced") return "offline";
  if (binding.status === "disconnected") return "disconnected";
  if (!binding.agentId) return "disconnected";
  const agent = agents.get(binding.agentId);
  if (!agent) return "disconnected";
  if (Date.now() - agent.lastSeenAt > AGENT_STALE_MS) return "disconnected";
  return "idle";
}

async function listSessionsWithConnection(): Promise<SessionMeta[]> {
  const library = await listPaperLibrary();
  for (const entry of library.entries) {
    if (!entry.learningSessionId) continue;
    const meta = await readMeta(entry.learningSessionId);
    if (meta && !meta.paperId) await bindPaperToSession(meta.id, entry.paperId);
  }
  const [sessions, bindings] = await Promise.all([listSessions(), listConversationBindings()]);
  return sessions.map((session) => {
    const binding = bindings.find(
      (item) => item.sessionId === session.id && item.status !== "deleted" && item.status !== "replaced",
    );
    const status = statusForBinding(binding);
    return {
      ...session,
      agentConnection: binding
        ? {
            ...(session.agentConnection ?? { status }),
            status: isLiveStatus(session.agentConnection?.status) && status === "idle"
              ? session.agentConnection?.status ?? status
              : status,
            agentId: binding.agentId,
            conversationKey: binding.conversationKey,
            clientName: binding.clientName,
            lastSeenAt: binding.lastSeenAt,
          }
        : { status: "offline" },
    };
  });
}

export async function broadcastSessionsUpdate(_reasonSessionId?: string): Promise<void> {
  const sessions = await listSessionsWithConnection();
  for (const client of webClients.values()) {
    send(client, {
      tool: "sessions_update",
      sessions,
      currentId: client.openSessionId ?? "",
    });
  }
}

async function broadcastPagesUpdate(sessionId: string): Promise<void> {
  const pages = await readData<unknown[]>("pages.json", sessionId);
  broadcast({ tool: "session_pages_update", sessionId, pages });
}

async function broadcastFavorites(sessionId: string): Promise<void> {
  const favorites = await readData<unknown[]>("favorites.json", sessionId);
  broadcast({ tool: "favorites_update", sessionId, favorites });
}

async function broadcastGuidance(sessionId: string): Promise<void> {
  const guidance = await readData<Record<string, unknown>>("guidance.json", sessionId);
  broadcast({ tool: "guidance_update", sessionId, guidance });
}

export async function broadcastAgentStatus(sessionId: string): Promise<void> {
  const meta = await readMeta(sessionId);
  broadcast({
    tool: "agent_status_update",
    sessionId,
    status: meta?.agentConnection?.status ?? "offline",
    agentId: meta?.agentConnection?.agentId,
    conversationKey: meta?.agentConnection?.conversationKey,
    lastSeenAt: meta?.agentConnection?.lastSeenAt,
  });
  await broadcastSessionsUpdate(sessionId);
}

export function getConnectionDiagnostics(): {
  clientConnected: boolean;
  readyState: number | null;
  bufferedCommands: number;
  webClients: number;
} {
  const first = webClients.values().next().value as WebClient | undefined;
  return {
    clientConnected: webClients.size > 0,
    readyState: first?.ws.readyState ?? null,
    bufferedCommands: 0,
    webClients: webClients.size,
  };
}

export function getHubDiagnostics(): Record<string, unknown> {
  return {
    webClients: webClients.size,
    agents: Array.from(agents.values()).map((agent) => ({
      agentId: agent.agentId,
      conversationKey: agent.conversationKey,
      boundSessionId: agent.boundSessionId,
      clientName: agent.clientName,
      connectedAt: agent.connectedAt,
      lastSeenAt: agent.lastSeenAt,
    })),
    uptimeMs: Date.now() - serverStartedAt,
  };
}

export async function bindAgentToSession(agentId: string, sessionId: string): Promise<void> {
  const agent = agents.get(agentId);
  if (!agent) throw new Error(`agent not found: ${agentId}`);
  await ensureSession(sessionId);
  await assertSessionBindable(sessionId, agent.conversationKey);
  const binding = await createConversationBinding({
    sessionId,
    title: (await readMeta(sessionId))?.title,
    conversationKey: agent.conversationKey,
    clientName: agent.clientName,
  });
  await markBindingConnected(binding.conversationKey, agentId, agent.clientName);
  agent.conversationKey = binding.conversationKey;
  agent.boundSessionId = sessionId;
  agent.lastSeenAt = Date.now();
  await updateAgentConnection(sessionId, {
    status: "idle",
    agentId,
    conversationKey: agent.conversationKey,
    clientName: agent.clientName,
    connectedAt: agent.connectedAt,
    lastSeenAt: agent.lastSeenAt,
  });
  await broadcastAgentStatus(sessionId);
}

async function disconnectSessionAgent(sessionId: string): Promise<void> {
  const meta = await readMeta(sessionId);
  const oldAgentId = meta?.agentConnection?.agentId;
  if (oldAgentId) {
    const oldAgent = agents.get(oldAgentId);
    if (oldAgent) {
      oldAgent.conversationKey = undefined;
      oldAgent.boundSessionId = undefined;
    }
  }
  await updateAgentConnection(sessionId, {
    status: "disconnected",
    lastSeenAt: Date.now(),
  });
  await broadcastAgentStatus(sessionId);
}

async function setAgentStatus(agent: AgentClient, status: AgentConnectionStatus): Promise<void> {
  agent.lastSeenAt = Date.now();
  if (!agent.boundSessionId) return;
  await updateAgentConnection(agent.boundSessionId, {
    status,
    agentId: agent.agentId,
    conversationKey: agent.conversationKey,
    clientName: agent.clientName,
    connectedAt: agent.connectedAt,
    lastSeenAt: agent.lastSeenAt,
  });
  await broadcastAgentStatus(agent.boundSessionId);
}

async function touchAgentHeartbeat(agent: AgentClient): Promise<void> {
  agent.lastSeenAt = Date.now();
  if (!agent.boundSessionId) return;
  const meta = await readMeta(agent.boundSessionId);
  await updateAgentConnection(agent.boundSessionId, {
    status: meta?.agentConnection?.status ?? "idle",
    agentId: agent.agentId,
    conversationKey: agent.conversationKey,
    clientName: agent.clientName,
    connectedAt: agent.connectedAt,
    lastSeenAt: agent.lastSeenAt,
  });
  await broadcastAgentStatus(agent.boundSessionId);
}

async function attachAgentToConversation(agent: AgentClient, conversationKey: string): Promise<void> {
  const binding = await getConversationBinding(conversationKey);
  if (!binding || binding.status === "deleted") throw new Error("conversation binding not found");
  await bindAgentToSession(agent.agentId, binding.sessionId);
}

export async function createBindingForAgent(
  agentId: string,
  title?: string,
  sessionId?: string,
): Promise<{ conversationKey: string; sessionId: string }> {
  const agent = agents.get(agentId);
  if (!agent) throw new Error(`agent not found: ${agentId}`);
  const session = sessionId ? await ensureSession(sessionId) : await createSession(title);
  const binding = await createConversationBinding({
    sessionId: session.id,
    title: title ?? session.title,
    conversationKey: agent.conversationKey,
    clientName: agent.clientName,
  });
  await attachAgentToConversation(agent, binding.conversationKey);
  return { conversationKey: binding.conversationKey, sessionId: binding.sessionId };
}

export async function bindAgentToConversation(
  agentId: string,
  conversationKey: string,
): Promise<{ conversationKey: string; sessionId: string }> {
  const agent = agents.get(agentId);
  if (!agent) throw new Error(`agent not found: ${agentId}`);
  await attachAgentToConversation(agent, conversationKey);
  if (!agent.conversationKey || !agent.boundSessionId) throw new Error("failed to bind conversation");
  return { conversationKey: agent.conversationKey, sessionId: agent.boundSessionId };
}

export async function claimSessionForAgent(
  agentId: string,
  code: string,
  title?: string,
): Promise<{ conversationKey: string; sessionId: string }> {
  const agent = agents.get(agentId);
  if (!agent) throw new Error(`agent not found: ${agentId}`);
  const claim = await consumeSessionClaimCode(code);
  const session = await ensureSession(claim.sessionId);
  const meta = await readMeta(session.id);
  const hasLiveAgent = ["idle", "waiting", "working"].includes(meta?.agentConnection?.status ?? "");
  if (!hasLiveAgent) {
    await replaceBindingsForSession(session.id, ["active", "disconnected"]);
  }
  const binding = await createConversationBinding({
    sessionId: session.id,
    title: title ?? session.title,
    clientName: agent.clientName,
  });
  await attachAgentToConversation(agent, binding.conversationKey);
  return { conversationKey: binding.conversationKey, sessionId: binding.sessionId };
}

async function registerAgent(body: Record<string, unknown>): Promise<AgentClient> {
  const agentId = makeId("agent");
  const now = Date.now();
  const agent: AgentClient = {
    agentId,
    conversationKey: typeof body.conversationKey === "string" ? body.conversationKey : undefined,
    clientName: String(body.clientName ?? "MCP Agent"),
    connectedAt: now,
    lastSeenAt: now,
  };
  agents.set(agentId, agent);
  if (agent.conversationKey) {
    await attachAgentToConversation(agent, agent.conversationKey).catch((error) => {
      console.error(`[moereview] conversation auto-bind failed: ${error instanceof Error ? error.message : String(error)}`);
      agent.conversationKey = undefined;
      agent.boundSessionId = undefined;
    });
  }
  return agent;
}

async function callTool(agent: AgentClient, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const tool = String(body.tool ?? "");
  const def = allTools[tool];
  if (!def) throw new Error(`unknown tool: ${tool}`);

  const args = (body.args ?? {}) as Record<string, unknown>;
  const unboundTools = new Set([
    "create_conversation_binding",
    "bind_conversation",
    "claim_session",
    "list_sessions",
    "get_connection_status",
    "get_binding_status",
    "prepare_turn",
    "show_toast",
  ]);
  if (!agent.boundSessionId && !unboundTools.has(tool)) {
    return {
      ok: false,
      error: "MoeReview Agent is not bound. Use create_conversation_binding, bind_conversation, or claim_session first.",
    };
  }
  const status: AgentConnectionStatus =
    tool === "wait_for_response" || tool === "ask_choice" || tool === "enter_standby"
      ? "waiting"
      : "working";
  await setAgentStatus(agent, status);

  try {
    if (agent.boundSessionId) {
      await assertAgentOwnsActiveBinding(agent.agentId, agent.conversationKey, agent.boundSessionId);
    }
    const result = agent.boundSessionId
      ? await withAgentContext(
          { agentId: agent.agentId, conversationKey: agent.conversationKey, boundSessionId: agent.boundSessionId },
          () => withSessionContext(agent.boundSessionId as string, () => def.handler(args)),
        )
      : await withAgentContext(
          { agentId: agent.agentId, conversationKey: agent.conversationKey },
          () => def.handler(args),
        );
    await setAgentStatus(agent, "idle");
    return result;
  } catch (error) {
    await setAgentStatus(agent, "idle");
    throw error;
  }
}

async function dispatchSessionTool(sessionId: string, tool: string, args: unknown): Promise<Record<string, unknown>> {
  const registry = allTools as Record<string, { schema: { parse: (value: unknown) => unknown }; handler: (value: unknown) => Promise<Record<string, unknown>> }>;
  const definition = registry[tool];
  if (!definition) throw new Error(`Unsupported internal learning tool: ${tool}`);
  const parsed = definition.schema.parse(args);
  return await withSessionContext(sessionId, () => definition.handler(parsed));
}

async function applyLearningPlan(sessionId: string, plan: LearningTurnPlan): Promise<void> {
  if (plan.kind === "page") {
    await dispatchSessionTool(sessionId, "create_pages", {
      pages: [{ title: plan.title, summary: plan.markdown.replace(/\s+/g, " ").slice(0, 160), kind: "mixed", content: plan.markdown }],
    });
  } else if (plan.kind === "cards") {
    for (const card of plan.cards) await dispatchSessionTool(sessionId, "show_card", card);
  } else {
    await dispatchSessionTool(sessionId, "show_quiz", { mode: plan.mode, questions: plan.questions });
  }
  if (plan.guidance?.length) {
    await dispatchSessionTool(sessionId, "set_guidance_panel", {
      title: "下一步",
      content: plan.guidance.join("\n"),
      tone: "next_step",
      nextActions: plan.guidance,
    });
  }
}

async function handleWsMessage(client: WebClient, raw: string): Promise<void> {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return;
  }

  const event = String(parsed.event ?? "");
  const sessionId = String(parsed.sessionId ?? client.openSessionId ?? "");

  if (event === "open_session" || event === "switch_session") {
    const id = String(parsed.id ?? parsed.sessionId ?? "");
    if (!id) return;
    await ensureSession(id);
    client.openSessionId = id;
    await touchSession(id, "lastOpenedAt");
    await broadcastSessionsUpdate(id);
    await broadcastPagesUpdate(id);
    await broadcastFavorites(id);
    await broadcastGuidance(id);
    return;
  }

  if (event === "list_sessions") {
    await broadcastSessionsUpdate(client.openSessionId);
    if (client.openSessionId) {
      await broadcastPagesUpdate(client.openSessionId);
      await broadcastFavorites(client.openSessionId);
      await broadcastGuidance(client.openSessionId);
    }
    return;
  }

  if (event === "create_session") {
    const session = await createSession(parsed.title as string | undefined);
    client.openSessionId = session.id;
    await broadcastSessionsUpdate(session.id);
    await broadcastPagesUpdate(session.id);
    return;
  }

  if (event === "delete_session") {
    try {
      const id = String(parsed.id);
      await deleteSession(id);
      clearSessionRuntimeState(id);
      await broadcastSessionsUpdate(client.openSessionId);
    } catch (error) {
      send(client, {
        tool: "show_toast",
        toastType: "error",
        text: error instanceof Error ? error.message : "failed to delete session",
      });
    }
    return;
  }

  if (event === "create_claim_code") {
    try {
      const id = String(parsed.id ?? sessionId);
      const force = parsed.force === true;
      await ensureSession(id);
      const meta = await readMeta(id);
      if (!force && ["idle", "waiting", "working"].includes(meta?.agentConnection?.status ?? "")) {
        throw new Error("session already has an active Agent");
      }
      if (force) {
        await replaceActiveBindingForSession(id);
        await disconnectSessionAgent(id);
      }
      const claim = await createSessionClaimCode(id, force);
      await broadcastSessionsUpdate(id);
      send(client, { tool: "claim_code_created", sessionId: id, code: claim.code, expiresAt: claim.expiresAt, force });
    } catch (error) {
      send(client, {
        tool: "show_toast",
        toastType: "error",
        text: error instanceof Error ? error.message : "failed to create claim code",
      });
    }
    return;
  }

  if (event === "disconnect_agent") {
    try {
      const id = String(parsed.id ?? sessionId);
      if (!id) throw new Error("sessionId is required");
      await ensureSession(id);
      await replaceActiveBindingForSession(id);
      await disconnectSessionAgent(id);
      await broadcastSessionsUpdate(id);
      send(client, { tool: "show_toast", toastType: "success", text: "Agent disconnected." });
    } catch (error) {
      send(client, {
        tool: "show_toast",
        toastType: "error",
        text: error instanceof Error ? error.message : "failed to disconnect Agent",
      });
    }
    return;
  }

  if (!sessionId) {
    send(client, {
      tool: "show_toast",
      toastType: "warning",
      text: "Select a MoeReview session before sending this action.",
    });
    return;
  }

  await withSessionContext(sessionId, async () => {
    if (event === "toggle_favorite") {
      await toggleFavorite(parsed);
      await broadcastFavorites(sessionId);
      return;
    }

    if (event === "activity_log") {
      await appendActivityLog({
        event: String(parsed.activity ?? "unknown"),
        pageId: typeof parsed.pageId === "string" ? parsed.pageId : undefined,
        payload: parsed.payload,
      });
      return;
    }

    if (event === "get_favorites") {
      await broadcastFavorites(sessionId);
      return;
    }

    if (event === "qa_history_append") {
      await appendQaHistory({
        question: String(parsed.question ?? ""),
        answer: String(parsed.answer ?? ""),
        model: String(parsed.model ?? "unknown"),
        timestamp: Date.now(),
      });
      return;
    }

    if (event) {
      await pushEvent(parsed as Record<string, unknown> & { event: string }, sessionId);
    }
  });
}

async function handleApi(req: http.IncomingMessage, res: http.ServerResponse, path: string): Promise<boolean> {
  const method = req.method ?? "GET";
  const url = new URL(req.url || "/", `http://localhost:${PORT}`);

  if (path === "/health" || path === "/__health") {
    json(res, 200, { ok: true, port: PORT, uptimeMs: Date.now() - serverStartedAt });
    return true;
  }

  if (path === "/api/sessions" && method === "GET") {
    json(res, 200, { sessions: await listSessionsWithConnection() });
    return true;
  }

  if (path === "/api/sessions" && method === "POST") {
    const body = await readBody(req);
    const session = await createSession(body.title as string | undefined);
    await broadcastSessionsUpdate(session.id);
    json(res, 200, { session });
    return true;
  }

  if (path === "/api/config/api-agent" && method === "GET") {
    json(res, 200, { config: await getApiAgentPublicConfig() });
    return true;
  }

  if (path === "/api/config/api-agent" && method === "PUT") {
    json(res, 200, { config: await saveApiAgentConfig(await readBody(req)) });
    return true;
  }

  if (path === "/api/config/app" && method === "GET") {
    json(res, 200, { preferences: await getAppPreferences() });
    return true;
  }

  if (path === "/api/config/app" && method === "PUT") {
    json(res, 200, { preferences: await saveAppPreferences(await readBody(req)) });
    return true;
  }

  if (path === "/api/config/api-agent/test" && method === "POST") {
    const answer = await callApiAgent([{ role: "user", content: "Reply with exactly: MOEREVIEW_OK" }]);
    json(res, 200, { ok: answer.includes("MOEREVIEW_OK"), answer: answer.slice(0, 80) });
    return true;
  }

  if (path === "/api/ai-agent/chat" && method === "POST") {
    json(res, 200, { ok: true, ...(await chatWithApiAgent(await readBody(req))) });
    return true;
  }

  if (path === "/api/ai-agent/page" && method === "POST") {
    const body = await readBody(req);
    const sessionId = typeof body.sessionId === "string" && body.sessionId.trim()
      ? body.sessionId.trim()
      : getActiveSessionId();
    await ensureSession(sessionId);
    const result = await withSessionContext(sessionId, () => createApiAgentPage(body));
    await broadcastPagesUpdate(sessionId);
    json(res, 200, result);
    return true;
  }

  const learningTurnMatch = path.match(/^\/api\/learning\/sessions\/([^/]+)\/turn$/);
  if (learningTurnMatch && method === "POST") {
    const sessionId = decodeURIComponent(learningTurnMatch[1]);
    const body = await readBody(req);
    const meta = await ensureSession(sessionId);
    const requestedIntent = typeof body.intent === "string" ? body.intent as LearningIntent : "ask";
    const intent: LearningIntent = LEARNING_INTENTS.has(requestedIntent) ? requestedIntent : "ask";
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    if (intent === "ask" && !prompt) throw new Error("prompt is required for a learning question.");
    const paperId = typeof body.paperId === "string" && body.paperId.trim() ? body.paperId.trim() : meta.paperId;
    const paper = paperId ? await getPaper(paperId) : undefined;
    const detail = paperId ? await getPaperDetail(paperId) : undefined;
    const pages = await readData<Array<{ title?: string; summary?: string }>>("pages.json", sessionId);
    const selectedPassage = typeof body.selectedPassage === "string" ? body.selectedPassage.trim().slice(0, 20_000) : undefined;
    await dispatchSessionTool(sessionId, "set_progress", { percent: 8, label: "正在整理论文上下文" });
    try {
      const plan = await createLearningTurnPlan({
        intent,
        prompt,
        context: {
          paperId,
          title: paper?.title,
          authors: paper?.authors,
          sourceUrl: paper?.url ?? paper?.pdfUrl,
          abstract: paper?.abstract,
          readingGuide: detail?.readingGuide && typeof detail.readingGuide === "object" ? detail.readingGuide as Record<string, unknown> : undefined,
          selectedSectionId: typeof body.selectedSectionId === "string" ? body.selectedSectionId : undefined,
          selectedSectionTitle: typeof body.selectedSectionTitle === "string" ? body.selectedSectionTitle : undefined,
          selectedPassage,
          recentPages: pages.slice(-8).map((page) => ({ title: String(page.title ?? ""), summary: String(page.summary ?? "") })),
        },
      });
      await dispatchSessionTool(sessionId, "set_progress", { percent: 78, label: "正在生成学习内容" });
      await applyLearningPlan(sessionId, plan);
      await dispatchSessionTool(sessionId, "set_progress", { percent: 100, label: "学习内容已生成" });
      await touchSession(sessionId);
      await broadcastPagesUpdate(sessionId);
      json(res, 200, { ok: true, planKind: plan.kind, paperId });
    } catch (error) {
      await dispatchSessionTool(sessionId, "set_progress", { percent: 0, label: "生成失败" });
      throw error;
    }
    return true;
  }

  if (path === "/api/translate/segment" && method === "POST") {
    json(res, 200, await translateSegment(await readBody(req)));
    return true;
  }

  if (path === "/api/papers/translation-jobs" && method === "GET") {
    json(res, 200, { ok: true, ...(await listTranslationJobs()) });
    return true;
  }

  if (path === "/api/papers/translation-jobs" && method === "POST") {
    json(res, 200, { ok: true, ...(await createTranslationJobs(await readBody(req))) });
    return true;
  }

  const translationJobMatch = path.match(/^\/api\/papers\/translation-jobs\/([^/]+)\/(pause|resume|cancel)$/);
  if (translationJobMatch && method === "POST") {
    const action = translationJobMatch[2] as "pause" | "resume" | "cancel";
    json(res, 200, { ok: true, job: await controlTranslationJob(decodeURIComponent(translationJobMatch[1]), action) });
    return true;
  }

  if (path === "/api/papers/search" && (method === "GET" || method === "POST")) {
    const input = method === "GET"
      ? {
          query: url.searchParams.get("q") ?? url.searchParams.get("query") ?? "",
          limit: url.searchParams.get("limit") ?? undefined,
        }
      : await readBody(req);
    const result = await searchPapers(input);
    await rememberPapers(result.results);
    json(res, 200, result);
    return true;
  }

  if (path === "/api/papers/feed" && method === "GET") {
    json(res, 200, await getPaperFeed({
      channel: url.searchParams.get("channel") ?? "for-you",
      cursor: url.searchParams.get("cursor") ?? 0,
      limit: url.searchParams.get("limit") ?? undefined,
    }));
    return true;
  }

  if (path === "/api/papers/library" && method === "GET") {
    json(res, 200, { ok: true, ...(await listPaperLibrary(url.searchParams.get("filter") ?? undefined)) });
    return true;
  }

  if (path === "/api/papers/export" && method === "GET") {
    json(res, 200, { ok: true, data: await exportPaperData() });
    return true;
  }

  const translationMatch = path.match(/^\/api\/papers\/([^/]+)\/translations$/);
  if (translationMatch && method === "GET") {
    json(res, 200, { ok: true, ...(await getPaperTranslations(decodeURIComponent(translationMatch[1]))) });
    return true;
  }

  const paperPdfMatch = path.match(/^\/api\/papers\/([^/]+)\/pdf$/);
  if (paperPdfMatch && method === "GET") {
    const paperId = decodeURIComponent(paperPdfMatch[1]);
    const paper = await getPaper(paperId);
    if (!paper.pdfUrl) throw new Error("这篇论文没有可用 PDF。");
    let pdf = await readCachedPaperPdf(paperId, paper.pdfUrl);
    if (!pdf) {
      await extractPaperPdf({ paper });
      pdf = await readCachedPaperPdf(paperId, paper.pdfUrl);
    }
    if (!pdf) throw new Error("PDF 缓存读取失败，请稍后重试或打开原始来源。");
    res.writeHead(200, {
      "Content-Type": "application/pdf",
      "Content-Disposition": "inline",
      "Cache-Control": "no-store",
      "Content-Length": String(pdf.length),
    });
    res.end(pdf);
    return true;
  }

  if (path === "/api/papers/interactions" && method === "DELETE") {
    await clearRecommendationHistory();
    json(res, 200, { ok: true });
    return true;
  }

  if (path === "/api/papers/session-page" && method === "POST") {
    const body = await readBody(req);
    const sessionId = typeof body.sessionId === "string" && body.sessionId.trim()
      ? body.sessionId.trim()
      : getActiveSessionId();
    await ensureSession(sessionId);
    const result = await withSessionContext(sessionId, () => createPaperSessionPage(body));
    await broadcastPagesUpdate(sessionId);
    json(res, 200, result);
    return true;
  }

  if (path === "/api/papers/extract" && method === "POST") {
    json(res, 200, await extractPaperPdf(await readBody(req)));
    return true;
  }

  if (path === "/api/papers/ask" && method === "POST") {
    json(res, 200, await answerPaperQuestion(await readBody(req)));
    return true;
  }

  if (path === "/api/papers/answer-page" && method === "POST") {
    const body = await readBody(req);
    const sessionId = typeof body.sessionId === "string" && body.sessionId.trim()
      ? body.sessionId.trim()
      : getActiveSessionId();
    await ensureSession(sessionId);
    const result = await withSessionContext(sessionId, () => createPaperAnswerPage(body));
    await broadcastPagesUpdate(sessionId);
    json(res, 200, result);
    return true;
  }

  const paperApiMatch = path.match(/^\/api\/papers\/([^/]+)(?:\/(summary|reading-guide|library|interactions|dismiss|learning-session))?$/);
  if (paperApiMatch) {
    const paperId = decodeURIComponent(paperApiMatch[1]);
    const resource = paperApiMatch[2];
    if (!resource && method === "GET") {
      json(res, 200, await getPaperDetail(paperId));
      return true;
    }
    if (resource === "summary" && method === "POST") {
      json(res, 200, { ok: true, ...(await summarizePaper(paperId)) });
      return true;
    }
    if (resource === "reading-guide" && method === "POST") {
      json(res, 200, { ok: true, ...(await generatePaperReadingGuide(paperId, await readBody(req))) });
      return true;
    }
    if (resource === "library" && method === "PATCH") {
      json(res, 200, { ok: true, entry: await updatePaperLibrary(paperId, await readBody(req)) });
      return true;
    }
    if (resource === "interactions" && method === "POST") {
      await recordInteractionFromInput(paperId, await readBody(req));
      json(res, 200, { ok: true });
      return true;
    }
    if (resource === "dismiss" && method === "POST") {
      await dismissPaper(paperId);
      json(res, 200, { ok: true });
      return true;
    }
    if (resource === "learning-session" && method === "POST") {
      const paper = await getPaper(paperId);
      const existing = (await listPaperLibrary()).entries.find((item) => item.paperId === paperId)?.learningSessionId;
      const restored = existing ? await readMeta(existing) : null;
      const session = restored ?? await createSession(`论文学习：${paper.title.slice(0, 48)}`);
      await bindPaperToSession(session.id, paperId);
      if (!restored) {
        await withSessionContext(session.id, () => createPaperSessionPage({ paper }));
        await updatePaperLibrary(paperId, { learningSessionId: session.id });
        await broadcastPagesUpdate(session.id);
      }
      await broadcastSessionsUpdate(session.id);
      json(res, 200, { ok: true, session });
      return true;
    }
  }

  const sessionMatch = path.match(/^\/api\/sessions\/([^/]+)(?:\/([^/]+))?$/);
  if (sessionMatch) {
    const sessionId = decodeURIComponent(sessionMatch[1]);
    const resource = sessionMatch[2];

    if (!resource && method === "GET") {
      await ensureSession(sessionId);
      json(res, 200, { session: await readMeta(sessionId) });
      return true;
    }
    if (!resource && method === "PATCH") {
      await ensureSession(sessionId);
      const body = await readBody(req);
      if (typeof body.title === "string") await updateSessionTitle(sessionId, body.title);
      await broadcastSessionsUpdate(sessionId);
      json(res, 200, { session: await readMeta(sessionId) });
      return true;
    }
    if (!resource && method === "DELETE") {
      await deleteSession(sessionId);
      clearSessionRuntimeState(sessionId);
      await broadcastSessionsUpdate();
      json(res, 200, { ok: true });
      return true;
    }
    if (resource === "pages" && method === "GET") {
      await ensureSession(sessionId);
      json(res, 200, { pages: await readData<unknown[]>("pages.json", sessionId) });
      return true;
    }
    if (resource === "favorites" && method === "GET") {
      await ensureSession(sessionId);
      json(res, 200, { favorites: await readData<unknown[]>("favorites.json", sessionId) });
      return true;
    }
    if (resource === "guidance" && method === "GET") {
      await ensureSession(sessionId);
      json(res, 200, { guidance: await readData<Record<string, unknown>>("guidance.json", sessionId) });
      return true;
    }
    if (resource === "wrong-answers" && method === "GET") {
      await ensureSession(sessionId);
      json(res, 200, { wrong_answers: await readData<unknown[]>("wrong_answers.json", sessionId) });
      return true;
    }
    if (resource === "claim-code" && method === "POST") {
      await ensureSession(sessionId);
      const body = await readBody(req);
      const force = body.force === true;
      const meta = await readMeta(sessionId);
      if (!force && ["idle", "waiting", "working"].includes(meta?.agentConnection?.status ?? "")) {
        json(res, 409, { error: "session already has an active Agent" });
        return true;
      }
      if (force) {
        await replaceActiveBindingForSession(sessionId);
        await disconnectSessionAgent(sessionId);
      }
      const claim = await createSessionClaimCode(sessionId, force);
      await broadcastSessionsUpdate(sessionId);
      json(res, 200, { code: claim.code, sessionId: claim.sessionId, expiresAt: claim.expiresAt, force: claim.force });
      return true;
    }
    if (resource === "disconnect-agent" && method === "POST") {
      await ensureSession(sessionId);
      await replaceActiveBindingForSession(sessionId);
      await disconnectSessionAgent(sessionId);
      await broadcastSessionsUpdate(sessionId);
      json(res, 200, { ok: true });
      return true;
    }
  }

  if (path === "/api/agent-connections" && method === "POST") {
    const agent = await registerAgent(await readBody(req));
    json(res, 200, { agentId: agent.agentId, conversationKey: agent.conversationKey, boundSessionId: agent.boundSessionId ?? "" });
    return true;
  }

  const heartbeatMatch = path.match(/^\/api\/agent-connections\/([^/]+)\/heartbeat$/);
  if (heartbeatMatch && method === "POST") {
    const agentId = decodeURIComponent(heartbeatMatch[1]);
    const agent = agents.get(agentId);
    if (!agent) {
      json(res, 404, { error: "agent not found" });
      return true;
    }
    await touchAgentHeartbeat(agent);
    json(res, 200, { ok: true, boundSessionId: agent.boundSessionId ?? "", conversationKey: agent.conversationKey });
    return true;
  }

  const toolMatch = path.match(/^\/api\/agent-connections\/([^/]+)\/tools$/);
  if (toolMatch && method === "POST") {
    const agentId = decodeURIComponent(toolMatch[1]);
    const agent = agents.get(agentId);
    if (!agent) {
      json(res, 404, { error: "agent not found" });
      return true;
    }
    const result = await callTool(agent, await readBody(req));
    if (agent.boundSessionId) await broadcastPagesUpdate(agent.boundSessionId);
    json(res, 200, result);
    return true;
  }

  return false;
}

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse, path: string): void {
  const safePath = normalize(path).replace(/^(\.\.[/\\])+/, "").replace(/\\/g, "/");
  const root = WEB_DIST;

  if (!existsSync(root)) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(
      "<!doctype html><meta charset='utf-8'><title>MoeReview</title>" +
        "<body style='font-family:-apple-system,sans-serif;padding:2rem'>" +
        "<h2>MoeReview Hub is running.</h2>" +
        "<p>Web frontend not built yet. Run <code>npm run build</code> in <code>web/</code>.</p>" +
        `<p>WebSocket endpoint: <code>ws://localhost:${PORT}/ws</code></p>` +
        "</body>",
    );
    return;
  }

  let filePath = join(root, safePath);
  stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) filePath = join(root, "index.html");
    readFile(filePath, (readErr, data) => {
      if (readErr) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      res.writeHead(200, { "Content-Type": MIME[extname(filePath)] || "application/octet-stream" });
      res.end(data);
    });
  });
}

export async function startHttpWsServer(): Promise<http.Server> {
  await initSessions();

  const httpServer = http.createServer((req, res) => {
    const path = decodeURIComponent((req.url || "/").split("?")[0]);
    void handleApi(req, res, path)
      .then((handled) => {
        if (!handled) serveStatic(req, res, path);
      })
      .catch((error) => {
        json(res, 500, { error: error instanceof Error ? error.message : "failed" });
      });
  });

  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });
  wss.on("connection", (ws) => {
    const client: WebClient = { id: makeId("web"), ws };
    webClients.set(client.id, client);
    void broadcastSessionsUpdate();

    ws.on("message", (data) => {
      void handleWsMessage(client, data.toString()).catch((error) => {
        console.error("[moereview] WS message failed:", error);
      });
    });
    ws.on("close", () => webClients.delete(client.id));
    ws.on("error", () => webClients.delete(client.id));
  });

  setInterval(() => {
    const now = Date.now();
    for (const agent of agents.values()) {
      if (now - agent.lastSeenAt <= AGENT_STALE_MS) continue;
      agents.delete(agent.agentId);
      void markBindingDisconnected(agent.agentId)
        .then(() => clearAgentConnection(agent.agentId))
        .then(() => broadcastSessionsUpdate(agent.boundSessionId))
        .catch((error) => console.error("[moereview] stale agent cleanup failed:", error));
    }
  }, 10_000).unref();

  httpServer.listen(PORT, "127.0.0.1", () => {
    console.error(`[moereview] Hub listening on http://127.0.0.1:${PORT}`);
  });

  httpServer.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(`[moereview] Port ${PORT} is already in use. Stop the existing process or set MOEREVIEW_HUB_PORT.`);
    } else {
      console.error("[moereview] Hub server error:", err.message);
    }
  });

  return httpServer;
}
