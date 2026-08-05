/**
 * 即时问答 Hub 客户端。
 *
 * Quick QA 与摘要、翻译、学习共用 Hub 的 API Agent 配置。浏览器不再
 * 保存或直连 provider API Key，发布版也不会留下第二套配置入口。
 */

import { loadApiAgentConfig, saveApiAgentConfig, type ApiAgentConfig } from "./apiAgent";
import { getHubOrigin } from "./hub";
import type { QuickQaConfig } from "../types";

export const DEFAULT_QUICK_QA_CONFIG: QuickQaConfig = {
  baseUrl: "https://api.deepseek.com/v1",
  model: "deepseek-chat",
  systemPrompt: "",
  configured: false,
  memory: true,
};

function withMemory(config: ApiAgentConfig, memory = true): QuickQaConfig {
  return { ...config, memory };
}

/** 同步默认值仅用于首帧，真实状态由 fetchQuickQaConfig 从 Hub 读取。 */
export function loadQuickQaConfig(): QuickQaConfig {
  return { ...DEFAULT_QUICK_QA_CONFIG };
}

export async function fetchQuickQaConfig(): Promise<QuickQaConfig> {
  return withMemory(await loadApiAgentConfig());
}

export async function saveQuickQaConfig(config: QuickQaConfig): Promise<QuickQaConfig> {
  return withMemory(await saveApiAgentConfig({
    baseUrl: config.baseUrl,
    model: config.model,
    systemPrompt: config.systemPrompt ?? "",
  }), config.memory !== false);
}

export async function clearQuickQaConfig(): Promise<QuickQaConfig> {
  return withMemory(await saveApiAgentConfig({
    baseUrl: DEFAULT_QUICK_QA_CONFIG.baseUrl,
    model: DEFAULT_QUICK_QA_CONFIG.model,
    systemPrompt: DEFAULT_QUICK_QA_CONFIG.systemPrompt ?? "",
    clearApiKey: true,
  }));
}

export function isQuickQaConfigured(config: QuickQaConfig): boolean {
  return config.configured;
}

export async function testQuickQaConnection(): Promise<void> {
  const response = await fetch(`${getHubOrigin()}/api/config/api-agent/test`, { method: "POST" });
  if (response.ok) return;
  const data = await response.json().catch(() => ({})) as { error?: string };
  throw new Error(data.error ?? `HTTP ${response.status}`);
}

/**
 * 保留旧的 AsyncGenerator 调用形状，让问答抽屉无需改动交互；Hub 当前
 * 返回完整答案，未来可以在此处无缝切换为 SSE。
 */
export async function* streamChat(
  _config: QuickQaConfig,
  messages: ChatMessage[],
  signal?: AbortSignal,
): AsyncGenerator<string, void, unknown> {
  const response = await fetch(`${getHubOrigin()}/api/ai-agent/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
    signal,
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(data.error ?? `HTTP ${response.status}`);
  }
  const data = await response.json() as { answer?: string };
  if (!data.answer?.trim()) throw new Error("API Agent 返回了空答案。");
  yield data.answer;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}
