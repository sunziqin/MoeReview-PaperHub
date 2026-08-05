/**
 * Session metadata and per-request session context.
 *
 * Hub owns the authoritative session list. MCP agent processes only hold a
 * bound session id for their own connection; they never mutate global web state.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { markBindingDeletedForSession } from "./bindings.js";

export type AgentConnectionStatus =
  | "offline"
  | "idle"
  | "waiting"
  | "working"
  | "disconnected";

export interface AgentConnectionMeta {
  status: AgentConnectionStatus;
  agentId?: string;
  conversationKey?: string;
  clientName?: string;
  connectedAt?: number;
  lastSeenAt?: number;
}

export interface SessionMeta {
  id: string;
  title: string;
  created: number;
  last_access: number;
  lastOpenedAt?: number;
  lastAgentBoundAt?: number;
  sessionKind?: "general" | "paper";
  paperId?: string;
  agentConnection?: AgentConnectionMeta;
}

const EXAMFORGE_DIR = join(homedir(), ".examforge");
export const SESSIONS_DIR = join(EXAMFORGE_DIR, "sessions");
const DELETED_SESSIONS_FILE = join(EXAMFORGE_DIR, "deleted-sessions.json");
const AGENT_STALE_MS = 30_000;
const sessionContext = new AsyncLocalStorage<string>();

export function getActiveSessionId(): string {
  const sessionId = sessionContext.getStore();
  if (!sessionId) throw new Error("no active MoeReview session context");
  return sessionId;
}

export async function withSessionContext<T>(
  sessionId: string,
  fn: () => Promise<T> | T,
): Promise<T> {
  await ensureSession(sessionId);
  return sessionContext.run(sessionId, fn);
}

function normalizeMeta(id: string, parsed: Partial<SessionMeta>): SessionMeta {
  const now = Date.now();
  const rawConnection = parsed.agentConnection;
  const rawStatus = rawConnection?.status as string | undefined;
  const normalizedStatus =
    rawStatus === "connected" ? "idle" : rawConnection?.status ?? "offline";
  return {
    id,
    title: parsed.title?.trim() || "Untitled session",
    created: Number(parsed.created) || now,
    last_access: Number(parsed.last_access) || Number(parsed.created) || now,
    lastOpenedAt: parsed.lastOpenedAt,
    lastAgentBoundAt: parsed.lastAgentBoundAt,
    sessionKind: parsed.sessionKind === "paper" ? "paper" : "general",
    paperId: typeof parsed.paperId === "string" && parsed.paperId.trim() ? parsed.paperId.trim() : undefined,
    agentConnection: rawConnection ? { ...rawConnection, status: normalizedStatus } : { status: "offline" },
  };
}

function isLiveAgentStatus(status: AgentConnectionStatus | undefined): boolean {
  return status === "idle" || status === "waiting" || status === "working";
}

function markStaleAgentDisconnected(meta: SessionMeta, now = Date.now()): SessionMeta {
  const connection = meta.agentConnection;
  if (!connection || !isLiveAgentStatus(connection.status)) return meta;
  if (!connection.lastSeenAt || now - connection.lastSeenAt <= AGENT_STALE_MS) return meta;
  return {
    ...meta,
    agentConnection: {
      ...connection,
      status: "disconnected",
      lastSeenAt: now,
    },
  };
}

export async function readMeta(id: string): Promise<SessionMeta | null> {
  try {
    const raw = await fs.readFile(join(SESSIONS_DIR, id, "meta.json"), "utf-8");
    return markStaleAgentDisconnected(normalizeMeta(id, JSON.parse(raw) as Partial<SessionMeta>));
  } catch {
    return null;
  }
}

async function readDeletedSessions(): Promise<Record<string, { id: string; deletedAt: number }>> {
  try {
    return JSON.parse(await fs.readFile(DELETED_SESSIONS_FILE, "utf-8")) as Record<string, { id: string; deletedAt: number }>;
  } catch {
    return {};
  }
}

async function writeDeletedSessions(deleted: Record<string, { id: string; deletedAt: number }>): Promise<void> {
  await fs.mkdir(EXAMFORGE_DIR, { recursive: true });
  const tmpPath = `${DELETED_SESSIONS_FILE}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(deleted, null, 2), "utf-8");
  await fs.rename(tmpPath, DELETED_SESSIONS_FILE);
}

export async function isSessionDeleted(id: string): Promise<boolean> {
  const deleted = await readDeletedSessions();
  return Boolean(deleted[id]);
}

export async function assertSessionNotDeleted(id: string): Promise<void> {
  if (await isSessionDeleted(id)) {
    throw new Error("session has been deleted");
  }
}

export async function writeMeta(meta: SessionMeta): Promise<void> {
  const dir = join(SESSIONS_DIR, meta.id);
  await fs.mkdir(dir, { recursive: true });
  const filePath = join(dir, "meta.json");
  const tmpPath = `${filePath}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(meta, null, 2), "utf-8");
  await fs.rename(tmpPath, filePath);
}

export async function ensureSession(id: string): Promise<SessionMeta> {
  if (!id) throw new Error("sessionId is required");
  await assertSessionNotDeleted(id);
  await fs.mkdir(SESSIONS_DIR, { recursive: true });
  const existing = await readMeta(id);
  if (existing) return existing;

  const now = Date.now();
  const meta: SessionMeta = {
    id,
    title: "Untitled session",
    created: now,
    last_access: now,
    agentConnection: { status: "offline" },
  };
  await writeMeta(meta);
  return meta;
}

export async function initSessions(): Promise<void> {
  await fs.mkdir(SESSIONS_DIR, { recursive: true });
}

export async function createSession(title?: string): Promise<SessionMeta> {
  const now = Date.now();
  const id = `${now}-${Math.random().toString(36).slice(2, 8)}`;
  const meta: SessionMeta = {
    id,
    title: title?.trim() || "Untitled session",
    created: now,
    last_access: now,
    lastOpenedAt: now,
    agentConnection: { status: "offline" },
  };
  await writeMeta(meta);
  return meta;
}

export async function listSessions(): Promise<SessionMeta[]> {
  await initSessions();
  let entries: string[] = [];
  try {
    entries = await fs.readdir(SESSIONS_DIR);
  } catch {
    return [];
  }

  const metas: SessionMeta[] = [];
  for (const entry of entries) {
    const stat = await fs.stat(join(SESSIONS_DIR, entry)).catch(() => null);
    if (!stat?.isDirectory()) continue;
    const meta = await readMeta(entry);
    if (!meta) continue;
    if (meta.agentConnection?.status === "disconnected") {
      const raw = await fs.readFile(join(SESSIONS_DIR, entry, "meta.json"), "utf-8").catch(() => "");
      if (raw) {
        try {
          const persisted = normalizeMeta(entry, JSON.parse(raw) as Partial<SessionMeta>);
          if (isLiveAgentStatus(persisted.agentConnection?.status)) await writeMeta(meta);
        } catch {
          // Ignore malformed metadata here; readMeta already skipped unrecoverable sessions.
        }
      }
    }
    metas.push(meta);
  }
  metas.sort((a, b) => b.last_access - a.last_access);
  return metas;
}

export async function touchSession(id: string, field: "last_access" | "lastOpenedAt" = "last_access"): Promise<void> {
  const meta = await ensureSession(id);
  const now = Date.now();
  meta[field] = now;
  if (field === "last_access") meta.last_access = now;
  await writeMeta(meta);
}

export async function deleteSession(id: string): Promise<void> {
  const meta = await readMeta(id);
  if (meta?.agentConnection?.status === "idle" || meta?.agentConnection?.status === "waiting" || meta?.agentConnection?.status === "working") {
    throw new Error("cannot delete a session with an active Agent connection");
  }
  await markBindingDeletedForSession(id);
  await fs.rm(join(SESSIONS_DIR, id), { recursive: true, force: true });
  const deleted = await readDeletedSessions();
  deleted[id] = { id, deletedAt: Date.now() };
  await writeDeletedSessions(deleted);
}

export async function updateSessionTitle(id: string, title: string): Promise<void> {
  const meta = await ensureSession(id);
  meta.title = title.trim() || "Untitled session";
  meta.last_access = Date.now();
  await writeMeta(meta);
}

export async function bindPaperToSession(id: string, paperId: string): Promise<SessionMeta> {
  const meta = await ensureSession(id);
  meta.sessionKind = "paper";
  meta.paperId = paperId.trim();
  meta.last_access = Date.now();
  await writeMeta(meta);
  return meta;
}

export async function updateAgentConnection(
  sessionId: string,
  connection: AgentConnectionMeta,
): Promise<SessionMeta> {
  const meta = await ensureSession(sessionId);
  meta.agentConnection = connection;
  meta.lastAgentBoundAt = Date.now();
  meta.last_access = Date.now();
  await writeMeta(meta);
  return meta;
}

export async function clearAgentConnection(agentId: string): Promise<void> {
  const sessions = await listSessions();
  for (const session of sessions) {
    if (session.agentConnection?.agentId !== agentId) continue;
    session.agentConnection = {
      ...session.agentConnection,
      status: "disconnected",
      lastSeenAt: Date.now(),
    };
    await writeMeta(session);
  }
}
