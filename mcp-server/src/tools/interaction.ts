/**
 * Interaction-class tools (frontend -> Agent).
 *
 * Task 1/2/3 scope: `wait_for_response` is the SPIKE core — fully implemented
 * with long-blocking Promise semantics. `ask_choice` is a shell for now.
 */

import { z } from "zod";
import { waitForResponseResult } from "../state/store.js";
import { broadcast } from "../ws/server.js";
import type { ToolHandler } from "./types.js";

export const interactionTools: Record<string, { schema: z.ZodTypeAny; handler: ToolHandler }> = {
  wait_for_response: {
    schema: z.object({
      timeout: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Max wait in seconds. Clamped to 280 to stay below Codex tool-call timeout."),
    }),
    handler: async (args) => {
      const timeout = (args.timeout as number | undefined) ?? 280;
      const result = await waitForResponseResult(timeout);
      return {
        messages: result.messages,
        count: result.messages.length,
        reason: result.messages.length > 0 ? "message" : "timeout",
        timedOut: result.timedOut,
        timeoutSeconds: result.timeoutSeconds,
        shouldContinueWaiting: result.timedOut,
        instruction: result.timedOut
          ? "If the task still requires live frontend input, call wait_for_response or enter_standby again immediately."
          : "Handle the returned frontend messages now.",
      };
    },
  },

  ask_choice: {
    schema: z.object({
      question: z.string(),
      options: z.array(z.string()),
    }),
    handler: async (args) => {
      // 向前端广播 ask_choice,触发 ChoiceModal 弹出;然后阻塞等待用户选择。
      broadcast({ tool: "ask_choice", question: args.question, options: args.options });
      const result = await waitForResponseResult(280);
      const messages = result.messages;
      // 在返回的消息里找 choice 事件,提取用户选择的索引与文本
      const choice = messages.find((m) => m.event === "choice");
      if (choice) {
        return { selected: choice.index, text: choice.text, ok: true };
      }
      // 未找到(超时、取消或其他消息):返回空选择
      return {
        selected: null,
        text: null,
        ok: false,
        reason: "timeout",
        timedOut: result.timedOut,
        shouldContinueWaiting: result.timedOut,
        instruction: "If the user still needs to choose, call ask_choice again or enter_standby again immediately.",
      };
    },
  },
};
