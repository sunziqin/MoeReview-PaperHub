/**
 * Render-class tools (Agent -> frontend).
 *
 * Task 1/2/3 scope: `show_toast` is fully implemented end-to-end.
 * The rest are registered as no-op shells so the Agent sees all 14 tools and
 * never fails on "tool not found". They return a clear "not implemented" note;
 * later tasks fill them in.
 *
 * Each tool pushes a `{ tool, ...params }` command over WebSocket to the browser.
 */

import { z } from "zod";
import { broadcast, broadcastSessionsUpdate, getConnectionDiagnostics } from "../ws/server.js";
import { setSessionTitle } from "../state/store.js";
import {
  appendCardCache,
  appendHistory,
  appendLearningPage,
  persistWrongAnswersFromResult,
  reviseLearningPage,
  supersedeLearningPage,
  writeData,
  type LearningPage,
} from "../state/persistence.js";
import {
  updateSessionTitle,
  listSessions,
  getActiveSessionId,
} from "../state/sessions.js";
import type { ToolHandler } from "./types.js";

function makeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function summarizeText(text: string, maxLength = 120): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, maxLength - 1)}…`;
}

function createPagePayload(page: LearningPage): { tool: "page_created"; page: LearningPage } {
  return { tool: "page_created", page };
}

const resultVerdictSchema = z.enum(["correct", "partial", "wrong", "skipped"]);

const resultItemSchema = z
  .object({
    id: z.string().min(1),
    correct: z.boolean().optional(),
    verdict: resultVerdictSchema.optional(),
    score: z.number().min(0).optional(),
    maxScore: z.number().positive().optional(),
    question: z.string().optional(),
    user_answer: z.unknown().optional(),
    userAnswer: z.unknown().optional(),
    correct_answer: z.unknown().optional(),
    correctAnswer: z.unknown().optional(),
    explanation: z.string().optional(),
    code_output: z.string().optional(),
    chapter: z.string().optional(),
  })
  .passthrough()
  .superRefine((item, ctx) => {
    const hasVerdict = item.correct !== undefined || item.verdict !== undefined;
    const hasScore = item.score !== undefined && item.maxScore !== undefined;
    if (!hasVerdict && !hasScore) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Each result item must include correct, verdict, or score/maxScore.",
      });
    }
    if (item.score !== undefined && item.maxScore !== undefined && item.score > item.maxScore) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "score cannot be greater than maxScore.",
      });
    }
  });

const resultSummarySchema = z
  .object({
    accuracy: z.number().min(0).max(1).optional(),
    time_spent: z.number().min(0).optional(),
    feedback: z.string().optional(),
    grading_notes: z.string().optional(),
  })
  .passthrough();

const guidanceSchema = z.object({
  title: z.string().optional(),
  content: z.string(),
  tone: z.enum(["info", "tip", "warning", "next_step"]).optional(),
  nextActions: z.array(z.string()).optional(),
  persist: z.boolean().optional(),
});

const workspacePageSchema = z.object({
  title: z.string(),
  summary: z.string().optional(),
  kind: z.enum(["card", "mixed", "system"]).optional(),
  content: z.string().describe("Extended Markdown body only. Supports semantic directives (callout, compare, steps, formula, memory-card, concept, example, checkpoint, mistake, source), KaTeX, Mermaid, and isolated html-preview fences. Do not pass a JSON object or a stringified {title, content} wrapper."),
});

const progressSchema = z.object({
  percent: z.number().min(0).max(100),
  label: z.string().optional(),
});

const toastSchema = z.object({
  text: z.string(),
  toastType: z.enum(["info", "success", "warning", "error"]).optional(),
});

type ResultVerdict = z.infer<typeof resultVerdictSchema>;
type ResultInputItem = z.infer<typeof resultItemSchema>;
type ResultInputSummary = z.infer<typeof resultSummarySchema>;

interface NormalizedResultItem extends ResultInputItem {
  correct: boolean;
  verdict: ResultVerdict;
  score: number;
  maxScore: number;
}

function normalizeResultItem(item: ResultInputItem): NormalizedResultItem {
  const maxScore = item.maxScore ?? 1;
  let score = item.score;
  let verdict = item.verdict;

  if (!verdict && item.correct !== undefined) verdict = item.correct ? "correct" : "wrong";
  if (!verdict && score !== undefined) verdict = score >= maxScore ? "correct" : score > 0 ? "partial" : "wrong";
  if (!verdict) throw new Error(`result item ${item.id} is missing verdict`);

  if (score === undefined) {
    score = verdict === "correct" ? maxScore : verdict === "partial" ? maxScore / 2 : 0;
  }

  return {
    ...item,
    user_answer: item.user_answer ?? item.userAnswer,
    correct_answer: item.correct_answer ?? item.correctAnswer,
    verdict,
    score,
    maxScore,
    correct: verdict === "correct",
  };
}

function normalizeResultPayload(
  results: ResultInputItem[],
  summary?: ResultInputSummary,
): { results: NormalizedResultItem[]; summary: Record<string, unknown> } {
  const normalized = results.map(normalizeResultItem);
  const total = normalized.reduce((sum, item) => sum + item.maxScore, 0);
  const earned = normalized.reduce((sum, item) => sum + item.score, 0);
  const accuracy = total > 0 ? earned / total : 0;
  return {
    results: normalized,
    summary: {
      ...(summary ?? {}),
      accuracy,
      time_spent: summary?.time_spent ?? 0,
    },
  };
}

function assertMarkdownBody(content: string, toolName: string): void {
  const trimmed = content.trim();
  if (!trimmed) throw new Error(`${toolName}: page content must be a non-empty Markdown string.`);
  if (!trimmed.startsWith("{")) return;

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      ("content" in parsed || "markdown" in parsed || "body" in parsed || "text" in parsed)
    ) {
      throw new Error(
        `${toolName}: content must be Markdown text directly, not a JSON wrapper. Pass pages[].title separately and put only the readable Markdown body in pages[].content.`,
      );
    }
  } catch (error) {
    if (error instanceof SyntaxError) return;
    throw error;
  }
}

/** Schema + handler factory set for render tools. */
export const renderTools: Record<string, { schema: z.ZodTypeAny; handler: ToolHandler }> = {
  show_card: {
    schema: z.object({
      title: z.string().describe("Card title shown in the header."),
      content: z.string().describe("Extended Markdown card body. Choose ordinary Markdown first; use semantic directives, KaTeX, Mermaid, or an isolated html-preview only when they materially improve understanding or recall."),
    }),
    handler: async (args) => {
      assertMarkdownBody(args.content, "show_card");
      const page = await appendLearningPage({
        id: makeId("page_card"),
        title: args.title,
        summary: summarizeText(args.content),
        kind: "card",
        content: { title: args.title, content: args.content },
        createdAt: new Date().toISOString(),
        source: "agent",
        status: "published",
        revision: 1,
      });
      broadcast(createPagePayload(page));
      // 自动追加到历史记录
      await appendHistory({ type: "card", title: args.title, timestamp: Date.now() });
      await appendCardCache({ title: args.title, content: args.content, timestamp: Date.now() });
      return { ok: true, message: "card rendered" };
    },
  },

  clear_board: {
    schema: z.object({}).describe("No parameters."),
    handler: async () => {
      const page = await appendLearningPage({
        id: makeId("page_system"),
        title: "新阶段",
        summary: "Agent 开始了一个新的学习阶段。",
        kind: "system",
        content: { text: "新阶段已开始。" },
        createdAt: new Date().toISOString(),
        source: "system",
        status: "published",
        revision: 1,
      });
      broadcast(createPagePayload(page));
      return { ok: true, message: "stage marker appended" };
    },
  },

  show_quiz: {
    schema: z.object({
      mode: z.enum(["sequential", "batch"]).optional().describe("Quiz mode. Defaults to sequential."),
      questions: z
        .array(
          z.object({
            id: z.string(),
            type: z.enum(["choice", "fill", "short_answer", "code"]),
            question: z.string(),
            answer: z.any(),
            options: z.array(z.any()).optional(),
            language: z.string().optional(),
            test_cases: z.array(z.any()).optional(),
          }),
        )
        .describe("Quiz questions."),
    }),
    handler: async (args) => {
      const mode = args.mode ?? "sequential";
      const page = await appendLearningPage({
        id: makeId("page_quiz"),
        title: `练习 ${args.questions.length} 题`,
        summary: `${mode === "batch" ? "批量" : "逐题"}练习,共 ${args.questions.length} 题。`,
        kind: "quiz",
        content: { mode, questions: args.questions },
        createdAt: new Date().toISOString(),
        source: "agent",
        status: "published",
        revision: 1,
      });
      broadcast(createPagePayload(page));
      // 自动追加到历史记录
      await appendHistory({
        type: "quiz",
        title: `做题 ${args.questions.length}题`,
        timestamp: Date.now(),
      });
      return { ok: true, count: args.questions.length };
    },
  },

  show_result: {
    schema: z.object({
      results: z.array(resultItemSchema).min(1),
      summary: resultSummarySchema.optional(),
    }),
    handler: async (args) => {
      const payload = normalizeResultPayload(args.results, args.summary);
      const accuracy = Number(payload.summary.accuracy);
      const page = await appendLearningPage({
        id: makeId("page_result"),
        title: "练习结果",
        summary: Number.isFinite(accuracy) ? `正确率 ${Math.round((accuracy ?? 0) * 100)}%` : "练习结果与解析。",
        kind: "result",
        content: payload,
        createdAt: new Date().toISOString(),
        source: "agent",
        status: "published",
        revision: 1,
      });
      broadcast(createPagePayload(page));
      await persistWrongAnswersFromResult(payload.results, payload.summary);
      return { ok: true, pageId: page.id, summary: payload.summary };
    },
  },

  correct_result: {
    schema: z.object({
      pageId: z.string().min(1),
      reason: z.string().min(12).describe("Required audit reason for changing a published result page."),
      results: z.array(resultItemSchema).min(1),
      summary: resultSummarySchema.optional(),
    }),
    handler: async (args) => {
      const payload = normalizeResultPayload(args.results, args.summary);
      const accuracy = Number(payload.summary.accuracy);
      const page = await reviseLearningPage(args.pageId, {
        id: makeId("page_result"),
        title: "练习结果修正",
        summary: Number.isFinite(accuracy) ? `修正正确率 ${Math.round(accuracy * 100)}%` : "练习结果修正",
        kind: "result",
        content: {
          ...payload,
          correction: {
            reason: args.reason,
            correctedAt: new Date().toISOString(),
          },
        },
        createdAt: new Date().toISOString(),
        source: "agent",
        status: "published",
      });
      broadcast({ tool: "page_revised", page, supersedesPageId: args.pageId });
      await persistWrongAnswersFromResult(payload.results, payload.summary);
      return { ok: true, pageId: page.id, supersedesPageId: args.pageId, summary: payload.summary };
    },
  },

  supersede_page: {
    schema: z.object({
      pageId: z.string().min(1),
      reason: z.string().min(12).describe("Required audit reason. Use only when the page is materially wrong or harmful."),
    }),
    handler: async (args) => {
      const page = await supersedeLearningPage(args.pageId);
      broadcast({ tool: "page_superseded", pageId: page.id, reason: args.reason });
      return { ok: true, supersededPageId: page.id };
    },
  },

  create_pages: {
    schema: z.object({
      pages: z
        .array(
          z.object({
            title: z.string(),
            summary: z.string().optional(),
            kind: z.enum(["card", "mixed", "system"]).optional(),
            content: z.string().describe("Extended Markdown body only. Supports semantic directives, KaTeX, Mermaid, and isolated html-preview fences. Do not pass JSON, objects, quiz payloads, or result payloads."),
          }),
        )
        .min(1)
        .describe("一次追加多个学习分页。"),
    }),
    handler: async (args) => {
      const created: LearningPage[] = [];
      for (const raw of args.pages as Array<{ title: string; summary?: string; kind?: LearningPage["kind"]; content: string }>) {
        assertMarkdownBody(raw.content, "create_pages");
        const page = await appendLearningPage({
          id: makeId("page"),
          title: raw.title,
          summary: raw.summary ?? summarizeText(raw.content),
          kind: raw.kind ?? "mixed",
          content: raw.content,
          createdAt: new Date().toISOString(),
          source: "agent",
          status: "published",
          revision: 1,
        });
        created.push(page);
      }
      broadcast({ tool: "pages_created", pages: created });
      return { ok: true, count: created.length, pages: created };
    },
  },

  update_workspace: {
    schema: z.object({
      pages: z.array(workspacePageSchema).optional().describe("Optional durable non-quiz pages. Content is plain extended Markdown with optional semantic blocks, KaTeX, Mermaid, or isolated HTML previews, never JSON or an object."),
      guidance: guidanceSchema.optional().describe("Optional side guidance update."),
      progress: progressSchema.optional().describe("Optional transient progress update."),
      toast: toastSchema.optional().describe("Optional toast notification."),
      dashboardWidgets: z.array(z.any()).optional().describe("Optional dashboard widget replacement."),
    }),
    handler: async (args) => {
      const created: LearningPage[] = [];
      for (const raw of (args.pages ?? []) as Array<z.infer<typeof workspacePageSchema>>) {
        const content = raw.content;
        assertMarkdownBody(content, "update_workspace");
        const summary = raw.summary ?? summarizeText(content);
        const page = await appendLearningPage({
          id: makeId("page"),
          title: raw.title,
          summary,
          kind: raw.kind ?? "mixed",
          content,
          createdAt: new Date().toISOString(),
          source: "agent",
          status: "published",
          revision: 1,
        });
        created.push(page);
      }

      if (created.length === 1) {
        broadcast(createPagePayload(created[0]));
      } else if (created.length > 1) {
        broadcast({ tool: "pages_created", pages: created });
      }

      if (args.guidance) {
        const guidance = {
          title: args.guidance.title ?? "Agent guidance",
          content: args.guidance.content,
          tone: args.guidance.tone ?? "info",
          nextActions: args.guidance.nextActions ?? [],
          updatedAt: Date.now(),
        };
        if (args.guidance.persist !== false) await writeData("guidance.json", guidance);
        broadcast({ tool: "guidance_update", guidance });
      }

      if (args.progress) {
        broadcast({ tool: "set_progress", percent: args.progress.percent, label: args.progress.label });
      }

      if (args.dashboardWidgets) {
        broadcast({ tool: "update_dashboard", widgets: args.dashboardWidgets });
      }

      if (args.toast) {
        broadcast({
          tool: "show_toast",
          text: args.toast.text,
          toastType: args.toast.toastType ?? "info",
        });
      }

      const diag = getConnectionDiagnostics();
      return {
        ok: true,
        pagesCreated: created.length,
        pageIds: created.map((page) => page.id),
        updated: {
          guidance: Boolean(args.guidance),
          progress: Boolean(args.progress),
          dashboard: Boolean(args.dashboardWidgets),
          toast: Boolean(args.toast),
        },
        delivered: diag.clientConnected && diag.readyState === 1,
        diagnostics: diag,
      };
    },
  },

  update_dashboard: {
    schema: z.object({
      widgets: z.array(z.any()),
    }),
    handler: async (args) => {
      broadcast({ tool: "update_dashboard", widgets: args.widgets });
      return { ok: true };
    },
  },

  set_progress: {
    schema: z.object({
      percent: z.number().min(0).max(100),
      label: z.string().optional(),
    }),
    handler: async (args) => {
      broadcast({ tool: "set_progress", percent: args.percent, label: args.label });
      return { ok: true };
    },
  },

  set_session_title: {
    schema: z.object({
      title: z.string(),
    }),
    handler: async (args) => {
      // 同步内存标题(保持 store.ts 内部状态一致)
      setSessionTitle(args.title);
      // 更新当前会话的 meta.json title 字段
      const sessionId = getActiveSessionId();
      await updateSessionTitle(sessionId, args.title);
      broadcast({ tool: "set_session_title", title: args.title });
      // 推送 sessions_update 刷新前端侧边栏
      const sessions = await listSessions();
      broadcast({ tool: "sessions_update", sessions, currentId: sessionId });
      return { ok: true };
    },
  },

  show_toast: {
    schema: z.object({
      text: z.string().describe("Toast message text."),
      toastType: z
        .enum(["info", "success", "warning", "error"])
        .optional()
        .describe("Toast style. Defaults to info."),
    }),
    handler: async (args) => {
      // NOTE: the wire field is `toastType` (not `type`) to avoid clashing with
      // the outer `tool` discriminator. The frontend maps it back.
      broadcast({
        tool: "show_toast",
        text: args.text,
        toastType: args.toastType ?? "info",
      });
      // 附带连接诊断:让 Agent/用户能判断"调用成功但前端无变化"的根因。
      // clientConnected=false 或 readyState≠1(OPEN) 说明前端没连上,消息进了 buffer。
      const diag = getConnectionDiagnostics();
      return {
        ok: true,
        text: args.text,
        toastType: args.toastType ?? "info",
        delivered: diag.clientConnected && diag.readyState === 1,
        diagnostics: diag,
      };
    },
  },

  set_guidance_panel: {
    schema: z.object({
      title: z.string().optional().describe("Short heading for the side guidance panel."),
      content: z.string().describe("Transient guidance, status, or next-step text. Markdown is allowed."),
      tone: z
        .enum(["info", "tip", "warning", "next_step"])
        .optional()
        .describe("Visual tone. Defaults to info."),
      nextActions: z.array(z.string()).optional().describe("Optional short next actions for the learner."),
      persist: z.boolean().optional().describe("Persist as the latest session guidance. Defaults to true."),
    }),
    handler: async (args) => {
      const guidance = {
        title: args.title ?? "Agent guidance",
        content: args.content,
        tone: args.tone ?? "info",
        nextActions: args.nextActions ?? [],
        updatedAt: Date.now(),
      };
      if (args.persist !== false) {
        await writeData("guidance.json", guidance);
      }
      broadcast({ tool: "guidance_update", guidance });
      return { ok: true, guidance };
    },
  },
};
