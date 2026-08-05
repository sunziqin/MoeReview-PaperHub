import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const EXAMFORGE_DIR = join(homedir(), ".examforge");
const BINDINGS_FILE = join(EXAMFORGE_DIR, "conversation-bindings.json");
const CLAIM_CODES_FILE = join(EXAMFORGE_DIR, "session-claim-codes.json");
const CLAIM_CODE_TTL_MS = 5 * 60 * 1000;

export type ConversationBindingStatus = "active" | "disconnected" | "replaced" | "deleted";

export interface ConversationBinding {
  conversationKey: string;
  sessionId: string;
  title: string;
  status: ConversationBindingStatus;
  agentId?: string;
  clientName?: string;
  createdAt: number;
  updatedAt: number;
  lastSeenAt?: number;
  replacedAt?: number;
  deletedAt?: number;
}

export interface SessionClaimCode {
  code: string;
  sessionId: string;
  createdAt: number;
  expiresAt: number;
  usedAt?: number;
  force?: boolean;
}

function makeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function makeClaimCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const part = () =>
    Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
  return `MR-${part()}-${part()}`;
}

async function ensureDir(): Promise<void> {
  await fs.mkdir(EXAMFORGE_DIR, { recursive: true });
}

async function readJsonFile<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

async function writeJsonFile<T>(file: string, data: T): Promise<void> {
  await ensureDir();
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf-8");
  await fs.rename(tmp, file);
}

async function readBindingsMap(): Promise<Record<string, ConversationBinding>> {
  return readJsonFile<Record<string, ConversationBinding>>(BINDINGS_FILE, {});
}

async function writeBindingsMap(bindings: Record<string, ConversationBinding>): Promise<void> {
  await writeJsonFile(BINDINGS_FILE, bindings);
}

export async function listConversationBindings(): Promise<ConversationBinding[]> {
  const bindings = await readBindingsMap();
  return Object.values(bindings).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getConversationBinding(conversationKey: string): Promise<ConversationBinding | null> {
  const bindings = await readBindingsMap();
  return bindings[conversationKey] ?? null;
}

export async function getActiveBindingBySession(sessionId: string): Promise<ConversationBinding | null> {
  const bindings = await listConversationBindings();
  return bindings.find((binding) => binding.sessionId === sessionId && ["active", "disconnected"].includes(binding.status)) ?? null;
}

export async function assertSessionBindable(sessionId: string, conversationKey?: string): Promise<void> {
  const existing = await getActiveBindingBySession(sessionId);
  if (!existing) return;
  if (conversationKey && existing.conversationKey === conversationKey) return;
  if (existing.status === "disconnected") return;
  throw new Error("session already has an active conversation binding");
}

export async function createConversationBinding(input: {
  sessionId: string;
  title?: string;
  conversationKey?: string;
  clientName?: string;
}): Promise<ConversationBinding> {
  const now = Date.now();
  const conversationKey = input.conversationKey?.trim() || makeId("mrconv");
  const bindings = await readBindingsMap();
  const existing = bindings[conversationKey];
  if (existing && existing.status !== "deleted") return existing;

  if (!input.conversationKey) {
    for (const [key, binding] of Object.entries(bindings)) {
      if (binding.sessionId !== input.sessionId || binding.status !== "disconnected") continue;
      bindings[key] = {
        ...binding,
        status: "replaced",
        agentId: undefined,
        updatedAt: now,
        replacedAt: now,
      };
    }
  }

  await assertSessionBindable(input.sessionId, conversationKey);
  const binding: ConversationBinding = {
    conversationKey,
    sessionId: input.sessionId,
    title: input.title?.trim() || "MoeReview conversation",
    status: "disconnected",
    clientName: input.clientName,
    createdAt: now,
    updatedAt: now,
  };
  bindings[conversationKey] = binding;
  await writeBindingsMap(bindings);
  return binding;
}

export async function markBindingConnected(
  conversationKey: string,
  agentId: string,
  clientName: string,
): Promise<ConversationBinding> {
  const bindings = await readBindingsMap();
  const binding = bindings[conversationKey];
  if (!binding || binding.status === "deleted" || binding.status === "replaced") {
    throw new Error("conversation binding not found");
  }
  const now = Date.now();
  bindings[conversationKey] = {
    ...binding,
    status: "active",
    agentId,
    clientName,
    updatedAt: now,
    lastSeenAt: now,
  };
  await writeBindingsMap(bindings);
  return bindings[conversationKey];
}

export async function markBindingDisconnected(agentId: string): Promise<void> {
  const bindings = await readBindingsMap();
  let changed = false;
  for (const [key, binding] of Object.entries(bindings)) {
    if (binding.agentId !== agentId) continue;
    bindings[key] = {
      ...binding,
      status: "disconnected",
      agentId: undefined,
      updatedAt: Date.now(),
      lastSeenAt: Date.now(),
    };
    changed = true;
  }
  if (changed) await writeBindingsMap(bindings);
}

export async function markBindingDeletedForSession(sessionId: string): Promise<void> {
  const bindings = await readBindingsMap();
  let changed = false;
  for (const [key, binding] of Object.entries(bindings)) {
    if (binding.sessionId !== sessionId || binding.status === "deleted") continue;
    bindings[key] = {
      ...binding,
      status: "deleted",
      agentId: undefined,
      updatedAt: Date.now(),
      deletedAt: Date.now(),
    };
    changed = true;
  }
  if (changed) await writeBindingsMap(bindings);
}

export async function replaceBindingsForSession(sessionId: string, statuses: ConversationBindingStatus[]): Promise<void> {
  const bindings = await readBindingsMap();
  let changed = false;
  const now = Date.now();
  for (const [key, binding] of Object.entries(bindings)) {
    if (binding.sessionId !== sessionId || !statuses.includes(binding.status)) continue;
    bindings[key] = {
      ...binding,
      status: "replaced",
      agentId: undefined,
      updatedAt: now,
      replacedAt: now,
    };
    changed = true;
  }
  if (changed) await writeBindingsMap(bindings);
}

export async function replaceActiveBindingForSession(sessionId: string): Promise<void> {
  await replaceBindingsForSession(sessionId, ["active"]);
}

export async function assertAgentOwnsActiveBinding(
  agentId: string,
  conversationKey?: string,
  sessionId?: string,
): Promise<void> {
  if (!conversationKey || !sessionId) throw new Error("MoeReview Agent is not bound");
  const binding = await getConversationBinding(conversationKey);
  if (!binding) throw new Error("conversation binding not found");
  if (binding.status === "deleted") {
    throw new Error("bound MoeReview session has been deleted, please create or claim another session");
  }
  if (binding.status === "replaced") {
    throw new Error("this conversation has been replaced");
  }
  if (binding.sessionId !== sessionId) {
    throw new Error("conversation binding session mismatch");
  }
  if (binding.agentId && binding.agentId !== agentId) {
    throw new Error("this conversation is connected from another Agent instance");
  }
}

async function readClaimCodes(): Promise<Record<string, SessionClaimCode>> {
  return readJsonFile<Record<string, SessionClaimCode>>(CLAIM_CODES_FILE, {});
}

async function writeClaimCodes(codes: Record<string, SessionClaimCode>): Promise<void> {
  await writeJsonFile(CLAIM_CODES_FILE, codes);
}

export async function createSessionClaimCode(sessionId: string, force = false): Promise<SessionClaimCode> {
  const codes = await readClaimCodes();
  let code = makeClaimCode();
  while (codes[code]) code = makeClaimCode();

  const now = Date.now();
  const claim: SessionClaimCode = {
    code,
    sessionId,
    createdAt: now,
    expiresAt: now + CLAIM_CODE_TTL_MS,
    force,
  };
  codes[code] = claim;
  await writeClaimCodes(codes);
  return claim;
}

export async function consumeSessionClaimCode(code: string): Promise<SessionClaimCode> {
  const normalized = code.trim().toUpperCase();
  const codes = await readClaimCodes();
  const claim = codes[normalized];
  if (!claim) throw new Error("claim code not found");
  if (claim.usedAt) throw new Error("claim code already used");
  if (claim.expiresAt < Date.now()) throw new Error("claim code expired");

  codes[normalized] = { ...claim, usedAt: Date.now() };
  await writeClaimCodes(codes);
  return codes[normalized];
}
