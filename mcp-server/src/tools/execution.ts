/**
 * Execution-class tools.
 *
 * `run_code` 在后端沙箱执行 C/C++/Java/Python/JavaScript 代码用于编程题判题。
 * Python 前端有 Pyodide 可选执行,但 Agent 也可直接调 run_code(后端用 python3)。
 */

import { z } from "zod";
import type { ToolHandler } from "./types.js";
import { runCode, type SupportedLanguage } from "../sandbox/runner.js";

export const executionTools: Record<string, { schema: z.ZodTypeAny; handler: ToolHandler }> = {
  run_code: {
    schema: z.object({
      language: z.enum(["python", "javascript", "java", "c", "cpp"]),
      code: z.string(),
      test_cases: z.array(
        z.object({
          input: z.string(),
          expected: z.string(),
        }),
      ),
    }),
    handler: async (args) => {
      const result = await runCode(
        args.language as SupportedLanguage,
        args.code as string,
        args.test_cases as Array<{ input: string; expected: string }>,
      );
      return result as unknown as Record<string, unknown>;
    },
  },
};
