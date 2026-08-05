import { z } from "zod";
import type { ToolHandler } from "./types.js";
import {
  createSession,
  listSessions,
  readMeta,
  updateAgentConnection,
  withSessionContext,
} from "../state/sessions.js";
import { getAgentContext } from "../state/agentContext.js";
import { appendLearningPage } from "../state/persistence.js";
import { drainPendingMessages, hasPendingWaiter, queueLength, waitForResponseResult } from "../state/store.js";
import { getConversationBinding } from "../state/bindings.js";
import { buildSessionSnapshot } from "./data.js";
import {
  bindAgentToSession,
  bindAgentToConversation,
  broadcastAgentStatus,
  claimSessionForAgent,
  createBindingForAgent,
  getHubDiagnostics,
} from "../ws/server.js";

function makeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export const controlTools: Record<string, { schema: z.ZodTypeAny; handler: ToolHandler }> = {
  prepare_turn: {
    schema: z.object({
      drainPending: z.boolean().optional().describe("Drain queued Web UI messages. Defaults to true when bound."),
      includeSnapshot: z.boolean().optional().describe("Include a compact session snapshot. Defaults to true when bound."),
      snapshotLimit: z.number().int().positive().max(20).optional().describe("Number of recent items in the compact snapshot."),
    }),
    handler: async (args) => {
      const ctx = getAgentContext();
      if (!ctx) return { ok: false, bound: false, error: "prepare_turn must run through MoeReview Hub" };

      const binding = ctx.conversationKey ? await getConversationBinding(ctx.conversationKey) : null;
      const bound = Boolean(ctx.boundSessionId && binding && binding.status === "active");
      if (!bound || !ctx.boundSessionId) {
        return {
          ok: true,
          bound: false,
          agent: ctx,
          binding,
          pending: { messages: [], count: 0 },
          snapshot: null,
          instruction: "Bind first with create_conversation_binding for new work or claim_session when the user provides a claim code.",
        };
      }

      const sessionId = ctx.boundSessionId;
      const [session, messages, snapshot] = await Promise.all([
        readMeta(sessionId),
        args.drainPending === false ? Promise.resolve([]) : drainPendingMessages(sessionId),
        args.includeSnapshot === false
          ? Promise.resolve(null)
          : buildSessionSnapshot(sessionId, (args.snapshotLimit as number | undefined) ?? 3),
      ]);

      return {
        ok: true,
        bound: true,
        agent: ctx,
        binding,
        session,
        pending: { messages, count: messages.length },
        snapshot,
        instruction:
          messages.length > 0
            ? "Handle pending Web UI messages before creating new pages."
            : "Continue the current task. Use update_workspace for batched UI updates when possible.",
      };
    },
  },

  create_conversation_binding: {
    schema: z.object({
      title: z.string().optional(),
      sessionId: z.string().optional(),
    }),
    handler: async (args) => {
      const ctx = getAgentContext();
      if (!ctx) return { ok: false, error: "create_conversation_binding must run through MoeReview Hub" };
      const binding = await createBindingForAgent(
        ctx.agentId,
        args.title as string | undefined,
        args.sessionId as string | undefined,
      );
      const snapshot = await buildSessionSnapshot(binding.sessionId, 3);
      return {
        ok: true,
        ...binding,
        snapshot: {
          pageCount: (snapshot.pages as { count: number }).count,
          latestPageTitle: ((snapshot.pages as { latest?: { title?: string } }).latest?.title) ?? null,
          wrongAnswerCount: (snapshot.wrongAnswers as { count: number }).count,
          favoriteCount: (snapshot.favorites as { count: number }).count,
          suggestedNextStep: "Call get_session_snapshot before continuing if this is not a brand-new session.",
        },
        instruction: "This MCP connection is now bound. Continue using MoeReview tools normally.",
      };
    },
  },

  bind_conversation: {
    schema: z.object({
      conversationKey: z.string(),
    }),
    handler: async (args) => {
      const ctx = getAgentContext();
      if (!ctx) return { ok: false, error: "bind_conversation must run through MoeReview Hub" };
      const binding = await bindAgentToConversation(ctx.agentId, String(args.conversationKey));
      return { ok: true, ...binding };
    },
  },

  claim_session: {
    schema: z.object({
      code: z.string(),
      title: z.string().optional(),
    }),
    handler: async (args) => {
      const ctx = getAgentContext();
      if (!ctx) return { ok: false, error: "claim_session must run through MoeReview Hub" };
      const binding = await claimSessionForAgent(ctx.agentId, String(args.code), args.title as string | undefined);
      const snapshot = await buildSessionSnapshot(binding.sessionId, 3);
      return {
        ok: true,
        ...binding,
        snapshot: {
          pageCount: (snapshot.pages as { count: number }).count,
          latestPageTitle: ((snapshot.pages as { latest?: { title?: string } }).latest?.title) ?? null,
          wrongAnswerCount: (snapshot.wrongAnswers as { count: number }).count,
          favoriteCount: (snapshot.favorites as { count: number }).count,
          suggestedNextStep: "Call get_session_snapshot before continuing.",
        },
        instruction: "The current Agent conversation has claimed the MoeReview session.",
      };
    },
  },

  get_binding_status: {
    schema: z.object({}),
    handler: async () => {
      const ctx = getAgentContext();
      if (!ctx) return { ok: false, bound: false, error: "get_binding_status must run through MoeReview Hub" };
      const binding = ctx.conversationKey ? await getConversationBinding(ctx.conversationKey) : null;
      return {
        ok: true,
        bound: Boolean(ctx.boundSessionId && binding && binding.status === "active"),
        agent: ctx,
        binding,
      };
    },
  },

  bind_session: {
    schema: z.object({
      sessionId: z.string().optional(),
      title: z.string().optional(),
      create: z.boolean().optional(),
    }),
    handler: async (args) => {
      const ctx = getAgentContext();
      if (!ctx) return { ok: false, error: "bind_session must run through MoeReview Hub" };

      const session = args.create
        ? await createSession(args.title as string | undefined)
        : args.sessionId
          ? { id: String(args.sessionId) }
          : ctx.boundSessionId
            ? { id: ctx.boundSessionId }
            : await createSession(args.title as string | undefined);

      await bindAgentToSession(ctx.agentId, session.id);
      return { ok: true, sessionId: session.id };
    },
  },

  list_sessions: {
    schema: z.object({}),
    handler: async () => {
      const sessions = await listSessions();
      return { sessions, count: sessions.length };
    },
  },

  get_connection_status: {
    schema: z.object({}),
    handler: async () => {
      const ctx = getAgentContext();
      const sessionId = ctx?.boundSessionId;
      return {
        ok: true,
        bound: Boolean(sessionId),
        agent: ctx,
        diagnostics: getHubDiagnostics(),
        session: sessionId
          ? {
              id: sessionId,
              pendingWaiter: hasPendingWaiter(sessionId),
              queuedInMemory: queueLength(sessionId),
            }
          : null,
      };
    },
  },

  handoff_session: {
    schema: z.object({
      sessionId: z.string(),
    }),
    handler: async (args) => {
      const ctx = getAgentContext();
      if (!ctx) return { ok: false, error: "handoff_session must run through MoeReview Hub" };
      const sessionId = String(args.sessionId);
      await bindAgentToSession(ctx.agentId, sessionId);
      return { ok: true, sessionId };
    },
  },

  append_system_event: {
    schema: z.object({
      title: z.string(),
      text: z.string(),
    }),
    handler: async (args) => {
      const ctx = getAgentContext();
      if (!ctx?.boundSessionId) return { ok: false, error: "no bound MoeReview session" };
      const sessionId = ctx.boundSessionId;
      const page = await withSessionContext(sessionId, () =>
        appendLearningPage({
          id: makeId("page_system"),
          title: String(args.title),
          summary: String(args.text).slice(0, 140),
          kind: "system",
          content: { text: String(args.text) },
          createdAt: new Date().toISOString(),
          source: "system",
          status: "published",
          revision: 1,
        }),
      );
      if (ctx) {
        await updateAgentConnection(sessionId, {
          status: "idle",
          agentId: ctx.agentId,
          conversationKey: ctx.conversationKey,
          lastSeenAt: Date.now(),
        });
        await broadcastAgentStatus(sessionId);
      }
      return { ok: true, page };
    },
  },

  get_pending_messages: {
    schema: z.object({}),
    handler: async () => {
      const ctx = getAgentContext();
      if (!ctx?.boundSessionId) return { ok: false, error: "no bound MoeReview session", messages: [], count: 0 };
      const sessionId = ctx.boundSessionId;
      const messages = await drainPendingMessages(sessionId);
      return { ok: true, messages, count: messages.length };
    },
  },

  enter_standby: {
    schema: z.object({
      reason: z.string().optional(),
      timeoutSeconds: z.number().int().positive().max(1800).optional(),
      maxMessages: z.number().int().positive().max(50).optional(),
      continueOnTimeout: z.boolean().optional(),
    }),
    handler: async (args) => {
      const startedAt = Date.now();
      const requestedTimeout = (args.timeoutSeconds as number | undefined) ?? 280;
      const maxMessages = (args.maxMessages as number | undefined) ?? 20;
      const result = await waitForResponseResult(requestedTimeout);
      const messages = result.messages;
      const shouldContinueWaiting = messages.length === 0 && result.timedOut && args.continueOnTimeout !== false;
      return {
        ok: true,
        reason: messages.length > 0 ? "message" : "timeout",
        standbyReason: args.reason ?? "waiting for user input",
        messages: messages.slice(0, maxMessages),
        count: messages.length,
        waitedSeconds: Math.round((Date.now() - startedAt) / 1000),
        requestedTimeoutSeconds: requestedTimeout,
        timeoutSeconds: result.timeoutSeconds,
        timedOut: result.timedOut,
        shouldContinueWaiting,
        instruction: shouldContinueWaiting
          ? "Call enter_standby again immediately if the Agent still needs live frontend input. Keep each call at or below 280 seconds."
          : "Handle the returned messages or continue the task.",
      };
    },
  },
};
