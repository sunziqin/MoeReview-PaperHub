/** Shared types for tool registration. */

import type { z } from "zod";

/**
 * A tool handler receives validated args and returns a JSON-serialisable result object.
 *
 * args 类型用 `any` 而非 `Record<string, unknown>`:MCP SDK 在调用 handler 前
 * 已用 zod schema 做了运行时校验,编译期无法精确推断每个工具的字段类型,
 * 用 any 避免每个 handler 都要写类型断言。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ToolHandler = (args: any) => Promise<Record<string, unknown>>;

/** Bundle of schema + handler used by the registry. */
export interface ToolDefinition {
  schema: z.ZodTypeAny;
  handler: ToolHandler;
}
