/**
 * Data-read-class tools (Agent queries local persisted data).
 *
 * 实现三个数据读取工具:
 * - get_wrong_answers: 读取错题本,支持 chapter / since 筛选
 * - get_history: 读取历史记录(quiz_history + card_cache 合并,按时间倒序)
 * - get_qa_history: 读取自定义模型问答记忆
 */

import { z } from "zod";
import type { ToolHandler } from "./types.js";
import {
  readData,
  type WrongAnswerItem,
  type HistoryItem,
  type QaItem,
  type CardCacheItem,
  type LearningPage,
  type ActivityLogItem,
} from "../state/persistence.js";
import { getAgentContext } from "../state/agentContext.js";
import { readMeta } from "../state/sessions.js";

function latest<T>(items: T[], limit: number): T[] {
  return items.slice(Math.max(0, items.length - limit));
}

export async function buildSessionSnapshot(sessionId: string, limit = 5): Promise<Record<string, unknown>> {
  const safeLimit = Math.min(Math.max(1, limit), 50);
  const [session, pages, wrongAnswers, favorites, qaHistory, activityLog, guidance] = await Promise.all([
    readMeta(sessionId),
    readData<LearningPage[]>("pages.json", sessionId),
    readData<WrongAnswerItem[]>("wrong_answers.json", sessionId),
    readData<unknown[]>("favorites.json", sessionId),
    readData<QaItem[]>("qa_memory.json", sessionId),
    readData<ActivityLogItem[]>("activity_log.json", sessionId),
    readData<Record<string, unknown>>("guidance.json", sessionId),
  ]);

  const latestPage = pages.at(-1);
  const lastActivity = activityLog.at(-1);
  return {
    session: session
      ? {
          id: session.id,
          title: session.title,
          created: session.created,
          last_access: session.last_access,
          agentStatus: session.agentConnection?.status ?? "offline",
        }
      : null,
    pages: {
      count: pages.length,
      latest: latestPage ?? null,
      outline: latest(pages, safeLimit).map((page) => ({
        id: page.id,
        title: page.title,
        summary: page.summary,
        kind: page.kind,
        createdAt: page.createdAt,
      })),
    },
    wrongAnswers: { count: wrongAnswers.length, latest: latest(wrongAnswers, safeLimit) },
    favorites: { count: favorites.length, latest: latest(favorites, safeLimit) },
    qaHistory: { count: qaHistory.length, latest: latest(qaHistory, safeLimit) },
    activityLog: { count: activityLog.length, latest: latest(activityLog, safeLimit) },
    guidance: { current: Object.keys(guidance ?? {}).length > 0 ? guidance : null },
    suggestedNextStep: lastActivity
      ? "Review the latest activity and continue from the user's current context."
      : "Call get_pages or create the first learning page before continuing.",
  };
}

export const dataTools: Record<string, { schema: z.ZodTypeAny; handler: ToolHandler }> = {
  get_session_snapshot: {
    schema: z.object({
      includePages: z.boolean().optional(),
      includeWrongAnswers: z.boolean().optional(),
      includeFavorites: z.boolean().optional(),
      includeQaHistory: z.boolean().optional(),
      includeActivityLog: z.boolean().optional(),
      limit: z.number().int().positive().max(50).optional(),
    }),
    handler: async (args) => {
      const ctx = getAgentContext();
      if (!ctx?.boundSessionId) return { ok: false, error: "no bound MoeReview session" };
      const snapshot = await buildSessionSnapshot(ctx.boundSessionId, (args.limit as number | undefined) ?? 5);
      return { ok: true, sessionId: ctx.boundSessionId, snapshot };
    },
  },

  get_wrong_answers: {
    schema: z.object({
      chapter: z.string().optional().describe("按章节筛选错题。"),
      since: z.string().optional().describe("只返回此时间之后的错题(ISO 日期字符串或时间戳字符串)。"),
    }),
    handler: async (args) => {
      const all = await readData<WrongAnswerItem[]>("wrong_answers.json");
      let filtered = all;

      // 按 chapter 筛选
      if (args.chapter) {
        filtered = filtered.filter((w) => w.chapter === args.chapter);
      }

      // 按 since 筛选:支持 ISO 日期字符串或数字时间戳字符串
      if (args.since) {
        const sinceStr = args.since as string;
        const sinceTime = /^\d+$/.test(sinceStr)
          ? parseInt(sinceStr, 10)
          : new Date(sinceStr).getTime();
        if (!isNaN(sinceTime)) {
          filtered = filtered.filter((w) => w.timestamp >= sinceTime);
        }
      }

      return { wrong_answers: filtered, count: filtered.length };
    },
  },

  get_history: {
    schema: z.object({
      limit: z.number().int().positive().optional().describe("返回最近多少条,默认 20。"),
    }),
    handler: async (args) => {
      const limit = (args.limit as number | undefined) ?? 20;
      const quizHistory = await readData<HistoryItem[]>("quiz_history.json");
      const cardCache = await readData<CardCacheItem[]>("card_cache.json");

      // 合并 quiz_history 和 card_cache:card_cache 项转换为 HistoryItem 格式
      const cardHistory: HistoryItem[] = cardCache.map((c) => ({
        type: "card" as const,
        title: c.title,
        timestamp: c.timestamp,
        detail: c.content,
      }));

      const merged = [...quizHistory, ...cardHistory];
      // 按时间倒序
      merged.sort((a, b) => b.timestamp - a.timestamp);
      // 取最近 limit 条
      const history = merged.slice(0, limit);

      return { history, count: history.length };
    },
  },

  get_qa_history: {
    schema: z.object({}).describe("无参数。"),
    handler: async () => {
      const qaHistory = await readData<QaItem[]>("qa_memory.json");
      return { qa_history: qaHistory, count: qaHistory.length };
    },
  },

  get_pages: {
    schema: z.object({
      limit: z.number().int().positive().optional().describe("返回最近多少页,默认 50。"),
    }),
    handler: async (args) => {
      const limit = (args.limit as number | undefined) ?? 50;
      const pages = await readData<LearningPage[]>("pages.json");
      return { pages: pages.slice(-limit), count: pages.length };
    },
  },

  get_activity_log: {
    schema: z.object({
      limit: z.number().int().positive().optional().describe("返回最近多少条活动,默认 100。"),
    }),
    handler: async (args) => {
      const limit = (args.limit as number | undefined) ?? 100;
      const activities = await readData<ActivityLogItem[]>("activity_log.json");
      return { activities: activities.slice(-limit), count: activities.length };
    },
  },
};
