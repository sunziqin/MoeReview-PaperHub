import { getHubOrigin } from "./hub";

export interface ApiAgentConfig {
  baseUrl: string;
  model: string;
  systemPrompt: string;
  configured: boolean;
}

export interface TranslationResult {
  ok: true;
  paperId?: string;
  sourceSegmentId?: string;
  sourceText: string;
  translatedText: string;
  termsUsed: Array<{ chinese: string; english: string }>;
  warnings: string[];
  modelNote: string;
  glossary: Array<{ chinese: string; english: string }>;
  cached?: boolean;
}

async function readError(response: Response): Promise<string> {
  const data = await response.json().catch(() => ({})) as { error?: string };
  return data.error ?? `HTTP ${response.status}`;
}

export async function loadApiAgentConfig(): Promise<ApiAgentConfig> {
  const response = await fetch(`${getHubOrigin()}/api/config/api-agent`, { cache: "no-store" });
  if (!response.ok) throw new Error(await readError(response));
  const data = await response.json() as { config: ApiAgentConfig };
  return data.config;
}

export async function saveApiAgentConfig(input: {
  baseUrl: string;
  model: string;
  systemPrompt: string;
  apiKey?: string;
  clearApiKey?: boolean;
}): Promise<ApiAgentConfig> {
  const response = await fetch(`${getHubOrigin()}/api/config/api-agent`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(await readError(response));
  const data = await response.json() as { config: ApiAgentConfig };
  return data.config;
}

export async function translateSegment(input: {
  paperId?: string;
  paperTitle?: string;
  sourceSegmentId?: string;
  sourceText: string;
  keywords?: string[];
  glossary?: Array<{ chinese: string; english: string }>;
}): Promise<TranslationResult> {
  const response = await fetch(`${getHubOrigin()}/api/translate/segment`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(await readError(response));
  return await response.json() as TranslationResult;
}
