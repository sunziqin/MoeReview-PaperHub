import { appendLearningPage } from "../state/persistence.js";
import { getApiAgentRuntimeConfig } from "../state/appConfig.js";

export interface ApiAgentMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ApiAgentPaperContext {
  paperId?: string;
  title?: string;
  source?: string;
  url?: string;
  doi?: string;
  arxivId?: string;
  segmentId?: string;
  sectionTitle?: string;
  passage?: string;
  abstract?: string;
  maxChars?: number;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

function normalizeMessages(messages: unknown): ApiAgentMessage[] {
  if (!Array.isArray(messages)) return [];
  return messages.flatMap((item): ApiAgentMessage[] => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const role = record.role;
    const content = record.content;
    if ((role !== "system" && role !== "user" && role !== "assistant") || typeof content !== "string") return [];
    return [{ role, content }];
  });
}

function paperContextBlock(context: ApiAgentPaperContext | undefined): string {
  if (!context) return "";
  const maxChars = Math.min(Math.max(context.maxChars ?? 10_000, 500), 20_000);
  const passage = context.passage?.slice(0, maxChars);
  const parts = [
    context.paperId ? `Paper ID: ${context.paperId}` : "",
    context.title ? `Title: ${context.title}` : "",
    context.source ? `Provider: ${context.source}` : "",
    context.url ? `URL: ${context.url}` : "",
    context.doi ? `DOI: ${context.doi}` : "",
    context.arxivId ? `arXiv: ${context.arxivId}` : "",
    context.segmentId ? `Segment ID: ${context.segmentId}` : "",
    context.sectionTitle ? `Section: ${context.sectionTitle}` : "",
    passage ? `Selected source passage:\n${passage}` : "",
    context.abstract ? `Abstract:\n${context.abstract}` : "",
  ].filter(Boolean);
  return parts.length ? `\n\nPaper context (quoted source material; cite the paper and segment in the answer):\n${parts.join("\n")}` : "";
}

export async function callApiAgent(messages: ApiAgentMessage[]): Promise<string> {
  const config = await getApiAgentRuntimeConfig();
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      messages: [{ role: "system", content: config.systemPrompt }, ...messages],
      stream: false,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`API Agent request failed: HTTP ${response.status}${detail ? ` - ${detail.slice(0, 240)}` : ""}`);
  }

  const data = (await response.json()) as ChatCompletionResponse;
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("API Agent returned an empty response.");
  return content;
}

export async function chatWithApiAgent(input: Record<string, unknown>): Promise<{ answer: string }> {
  const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
  const messages = normalizeMessages(input.messages);
  const paperContext = input.paperContext && typeof input.paperContext === "object"
    ? input.paperContext as ApiAgentPaperContext
    : undefined;
  if (!prompt && messages.length === 0) throw new Error("prompt or messages is required.");

  const finalMessages = messages.length > 0
    ? messages
    : [{ role: "user" as const, content: `${prompt}${paperContextBlock(paperContext)}` }];
  return { answer: await callApiAgent(finalMessages) };
}

export async function createApiAgentPage(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
  if (!prompt) throw new Error("prompt is required.");
  const title = typeof input.title === "string" && input.title.trim() ? input.title.trim() : "API Agent 学习页";
  const paperContext = input.paperContext && typeof input.paperContext === "object"
    ? input.paperContext as ApiAgentPaperContext
    : undefined;
  const answer = await callApiAgent([
    {
      role: "user",
      content:
        "Create a durable MoeReview learning page in Markdown. Use Chinese when appropriate. Keep paper claims source-grounded, and preserve important English keywords in parentheses.\n\n" +
        `${prompt}${paperContextBlock(paperContext)}`,
    },
  ]);
  const page = await appendLearningPage({
    id: `page_api_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    title,
    summary: answer.replace(/\s+/g, " ").slice(0, 160),
    kind: "mixed",
    content: answer,
    createdAt: new Date().toISOString(),
    source: "agent",
    status: "published",
    revision: 1,
  });
  return { ok: true, page, answer };
}
