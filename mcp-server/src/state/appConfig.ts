import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const ROOT_DIR = join(homedir(), ".examforge");
const CONFIG_PATH = join(ROOT_DIR, "config.json");
const SECRETS_PATH = join(ROOT_DIR, "secrets.json");

export interface ApiAgentPublicConfig {
  baseUrl: string;
  model: string;
  systemPrompt: string;
  configured: boolean;
}

export interface ApiAgentRuntimeConfig extends ApiAgentPublicConfig {
  apiKey: string;
}

export type TranslationTier = "low" | "medium" | "high" | "max";
export type TranslationScope = "current" | "favorites" | "read-later" | "queue" | "all";

export interface AppPreferences {
  colorMode: "light" | "dark" | "system";
  themePreset: "minimal" | "dark" | "anime" | "gradient";
  accentColor: string;
  density: "comfortable" | "compact";
  fontScale: number;
  navPosition: "left" | "right" | "bottom";
  navDisplay: "labelled" | "icons" | "auto";
  readingLanguage: "source" | "chinese" | "bilingual";
  contentWidth: "narrow" | "standard" | "wide";
  providerArxiv: boolean;
  providerSemanticScholar: boolean;
  searchLimit: number;
  personalizationEnabled: boolean;
  onboardingComplete: boolean;
  interests: string[];
  translationTier: TranslationTier;
  translationConcurrency: number;
  translationScope: TranslationScope;
  translationPrompt: string;
  summaryPrompt: string;
}

interface StoredConfig {
  theme?: string;
  app?: Partial<AppPreferences>;
  apiAgent?: {
    baseUrl?: string;
    model?: string;
    systemPrompt?: string;
  };
}

interface StoredSecrets {
  apiAgentApiKey?: string;
}

const DEFAULT_API_AGENT = {
  baseUrl: "https://api.deepseek.com/v1",
  model: "deepseek-chat",
  systemPrompt:
    "You are MoeReview's study assistant. Answer in clear Chinese when the user asks in Chinese. Keep paper claims source-grounded and avoid inventing citations.",
};

const DEFAULT_APP: AppPreferences = {
  colorMode: "system",
  themePreset: "minimal",
  accentColor: "#2f67d8",
  density: "comfortable",
  fontScale: 1,
  navPosition: "left",
  navDisplay: "labelled",
  readingLanguage: "chinese",
  contentWidth: "standard",
  providerArxiv: true,
  providerSemanticScholar: true,
  searchLimit: 12,
  personalizationEnabled: true,
  onboardingComplete: false,
  interests: [],
  translationTier: "medium",
  translationConcurrency: 3,
  translationScope: "current",
  translationPrompt:
    "优先使用自然、易懂的简体中文。第一次出现的专业术语必须写成中文术语（English keyword）。保留模型名、数据集、指标、数字、公式、变量、引用编号和不确定性，不添加原文没有的结论。",
  summaryPrompt:
    "用大白话解释论文，先说它想解决什么，再说作者怎么做、结果意味着什么。不要堆砌学术套话；第一次出现的专业术语必须写成中文术语（English keyword）。",
};

async function readJson<T extends object>(path: string): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(path, "utf-8")) as T;
  } catch {
    return {} as T;
  }
}

async function writeJson(path: string, data: unknown): Promise<void> {
  await fs.mkdir(ROOT_DIR, { recursive: true });
  const tmp = `${path}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf-8");
  await fs.rename(tmp, path);
}

function normalizeBaseUrl(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  return (raw || DEFAULT_API_AGENT.baseUrl).replace(/\/+$/, "");
}

function normalizeText(value: unknown, fallback: string): string {
  const raw = typeof value === "string" ? value.trim() : "";
  return raw || fallback;
}

function normalizePrompt(value: unknown, fallback: string, maxLength = 4_000): string {
  const raw = typeof value === "string" ? value.trim() : "";
  return (raw || fallback).slice(0, maxLength);
}

export async function getApiAgentPublicConfig(): Promise<ApiAgentPublicConfig> {
  const [config, secrets] = await Promise.all([
    readJson<StoredConfig>(CONFIG_PATH),
    readJson<StoredSecrets>(SECRETS_PATH),
  ]);
  const apiAgent = config.apiAgent ?? {};
  const apiKey = typeof secrets.apiAgentApiKey === "string" ? secrets.apiAgentApiKey.trim() : "";
  return {
    baseUrl: normalizeBaseUrl(apiAgent.baseUrl),
    model: normalizeText(apiAgent.model, DEFAULT_API_AGENT.model),
    systemPrompt: normalizeText(apiAgent.systemPrompt, DEFAULT_API_AGENT.systemPrompt),
    configured: apiKey.length > 0,
  };
}

export async function getApiAgentRuntimeConfig(): Promise<ApiAgentRuntimeConfig> {
  const [publicConfig, secrets] = await Promise.all([
    getApiAgentPublicConfig(),
    readJson<StoredSecrets>(SECRETS_PATH),
  ]);
  const apiKey = typeof secrets.apiAgentApiKey === "string" ? secrets.apiAgentApiKey.trim() : "";
  if (!apiKey) {
    throw new Error("API Agent is not configured. Save an API key first.");
  }
  return { ...publicConfig, apiKey };
}

export async function saveApiAgentConfig(input: Record<string, unknown>): Promise<ApiAgentPublicConfig> {
  const [config, secrets] = await Promise.all([
    readJson<StoredConfig>(CONFIG_PATH),
    readJson<StoredSecrets>(SECRETS_PATH),
  ]);

  const nextConfig: StoredConfig = {
    ...config,
    apiAgent: {
      baseUrl: normalizeBaseUrl(input.baseUrl),
      model: normalizeText(input.model, DEFAULT_API_AGENT.model),
      systemPrompt: normalizeText(input.systemPrompt, DEFAULT_API_AGENT.systemPrompt),
    },
  };

  const nextSecrets: StoredSecrets = { ...secrets };
  if (typeof input.apiKey === "string" && input.apiKey.trim()) {
    nextSecrets.apiAgentApiKey = input.apiKey.trim();
  }
  if (input.clearApiKey === true) {
    delete nextSecrets.apiAgentApiKey;
  }

  await Promise.all([writeJson(CONFIG_PATH, nextConfig), writeJson(SECRETS_PATH, nextSecrets)]);
  return getApiAgentPublicConfig();
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && allowed.includes(value as T) ? value as T : fallback;
}

export async function getAppPreferences(): Promise<AppPreferences> {
  const config = await readJson<StoredConfig>(CONFIG_PATH);
  const app = config.app ?? {};
  const legacyTheme = config.theme === "dark" ? "dark" : config.theme === "light" ? "light" : DEFAULT_APP.colorMode;
  const translationTier = enumValue(app.translationTier, ["low", "medium", "high", "max"] as const, DEFAULT_APP.translationTier);
  const translationScope = enumValue(app.translationScope, ["current", "favorites", "read-later", "queue", "all"] as const, DEFAULT_APP.translationScope);
  return {
    colorMode: enumValue(app.colorMode ?? legacyTheme, ["light", "dark", "system"] as const, DEFAULT_APP.colorMode),
    themePreset: enumValue(app.themePreset, ["minimal", "dark", "anime", "gradient"] as const, DEFAULT_APP.themePreset),
    accentColor: typeof app.accentColor === "string" && /^#[0-9a-f]{6}$/i.test(app.accentColor) ? app.accentColor : DEFAULT_APP.accentColor,
    density: enumValue(app.density, ["comfortable", "compact"] as const, DEFAULT_APP.density),
    fontScale: Math.min(1.2, Math.max(0.9, Number(app.fontScale) || DEFAULT_APP.fontScale)),
    navPosition: enumValue(app.navPosition, ["left", "right", "bottom"] as const, DEFAULT_APP.navPosition),
    navDisplay: enumValue(app.navDisplay, ["labelled", "icons", "auto"] as const, DEFAULT_APP.navDisplay),
    readingLanguage: enumValue(app.readingLanguage, ["source", "chinese", "bilingual"] as const, DEFAULT_APP.readingLanguage),
    contentWidth: enumValue(app.contentWidth, ["narrow", "standard", "wide"] as const, DEFAULT_APP.contentWidth),
    providerArxiv: app.providerArxiv !== false,
    providerSemanticScholar: app.providerSemanticScholar !== false,
    searchLimit: Math.min(20, Math.max(6, Math.floor(Number(app.searchLimit) || DEFAULT_APP.searchLimit))),
    personalizationEnabled: app.personalizationEnabled !== false,
    onboardingComplete: app.onboardingComplete === true,
    interests: Array.isArray(app.interests) ? app.interests.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 12) : [],
    translationTier,
    translationConcurrency: Math.min(16, Math.max(1, Math.floor(Number(app.translationConcurrency) || DEFAULT_APP.translationConcurrency))),
    translationScope: translationTier === "max" ? "all" : translationScope,
    translationPrompt: normalizePrompt(app.translationPrompt, DEFAULT_APP.translationPrompt),
    summaryPrompt: normalizePrompt(app.summaryPrompt, DEFAULT_APP.summaryPrompt),
  };
}

export async function saveAppPreferences(input: Record<string, unknown>): Promise<AppPreferences> {
  const config = await readJson<StoredConfig>(CONFIG_PATH);
  const current = await getAppPreferences();
  const nextTier = input.translationTier === undefined ? current.translationTier : input.translationTier;
  const nextInput = { ...current, ...input, ...(nextTier === "max" ? { translationScope: "all" } : {}) };
  const nextConfig: StoredConfig = { ...config, app: nextInput as Partial<AppPreferences> };
  await writeJson(CONFIG_PATH, nextConfig);
  return getAppPreferences();
}
