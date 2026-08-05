import type { PaperDocument, PaperRecord, PaperSection } from "./papers";
import { getHubOrigin } from "./hub";

export function paperPdfUrl(id: string): string {
  return `${getHubOrigin()}/api/papers/${encodeURIComponent(id)}/pdf`;
}

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
  translationTier: "low" | "medium" | "high" | "max";
  translationConcurrency: number;
  translationScope: "current" | "favorites" | "read-later" | "queue" | "all";
  translationPrompt: string;
  summaryPrompt: string;
}

export interface PaperSummary {
  paperId: string;
  chineseTitle: string;
  oneLineSummary: string;
  researchQuestion: string;
  method: string;
  findings: string;
  limitations: string;
  terms: Array<{ chinese: string; english: string }>;
  warnings: string[];
  plainLanguageExplanation?: string;
  whyItMatters?: string;
  methodSteps?: string[];
  keyFindings?: string[];
  realWorldMeaning?: string;
  rememberThis?: string[];
  model: string;
  generatedAt: string;
}

export interface PaperReadingGuide {
  paperId: string;
  overview: string;
  plainLanguageExplanation: string;
  researchBackground: string;
  researchQuestion: string;
  methodSteps: string[];
  experiments: string;
  keyFindings: string[];
  limitations: string;
  readingTips: string[];
  terms: Array<{ chinese: string; english: string }>;
  warnings: string[];
  promptFingerprint?: string;
  model: string;
  generatedAt: string;
}

export interface PaperLibraryEntry {
  paperId: string;
  paper: PaperRecord;
  favorite: boolean;
  readLater: boolean;
  openedAt?: string;
  lastSectionId?: string;
  progress?: number;
  learningSessionId?: string;
  updatedAt: string;
}

export interface PaperFeedItem {
  paper: PaperRecord;
  summary?: PaperSummary;
  library?: PaperLibraryEntry;
  reason: string;
  score: number;
  topics: string[];
  scoreBreakdown?: Record<string, number>;
}

export interface PaperTranslationSegment {
  paperId: string;
  sectionId: string;
  sectionTitle: string;
  sourceText: string;
  translatedText: string;
  termsUsed: Array<{ chinese: string; english: string }>;
  warnings: string[];
  sourceFingerprint: string;
  model: string;
  promptFingerprint: string;
  generatedAt: string;
}

export interface PaperTranslationJob {
  id: string;
  paperId: string;
  paperTitle: string;
  tier: "low" | "medium" | "high" | "max";
  scope: "current" | "favorites" | "read-later" | "queue" | "all";
  concurrency: number;
  status: "queued" | "running" | "paused" | "completed" | "cancelled" | "failed";
  total: number;
  completed: number;
  failed: number;
  createdAt: string;
  updatedAt: string;
  error?: string;
  generateGuide?: boolean;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${getHubOrigin()}${path}`, { cache: "no-store", ...init, signal: init?.signal ?? controller.signal });
    const data = await response.json().catch(() => ({})) as T & { error?: string };
    if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
    return data;
  } catch (error) {
    if (error instanceof TypeError || (error instanceof DOMException && error.name === "AbortError")) {
      throw new Error("无法连接 MoeReview Hub，请重启应用后重试。", { cause: error });
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

function json(method: string, body?: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) };
}

export async function loadPreferences(): Promise<AppPreferences> {
  return (await request<{ preferences: AppPreferences }>("/api/config/app")).preferences;
}

export async function savePreferences(input: Partial<AppPreferences>): Promise<AppPreferences> {
  return (await request<{ preferences: AppPreferences }>("/api/config/app", json("PUT", input))).preferences;
}

export async function loadFeed(channel: string, cursor = 0, limit = 12) {
  const params = new URLSearchParams({ channel, cursor: String(cursor), limit: String(limit) });
  return await request<{ items: PaperFeedItem[]; nextCursor: number; diagnostics: Array<{ provider: string; ok: boolean; error?: string; count?: number }> }>(`/api/papers/feed?${params}`);
}

export async function loadPaperDetail(id: string) {
  return await request<{ paper: PaperRecord; library?: PaperLibraryEntry; summary?: PaperSummary; readingGuide?: PaperReadingGuide }>(`/api/papers/${encodeURIComponent(id)}`);
}

export async function loadPaperTranslations(id: string): Promise<{ segments: Record<string, PaperTranslationSegment>; updatedAt?: string }> {
  return await request<{ segments: Record<string, PaperTranslationSegment>; updatedAt?: string }>(`/api/papers/${encodeURIComponent(id)}/translations`);
}

export async function createTranslationJobs(input: { paperId?: string; paperIds?: string[]; scope?: AppPreferences["translationScope"]; tier?: AppPreferences["translationTier"]; concurrency?: number; generateGuide?: boolean }): Promise<PaperTranslationJob[]> {
  return (await request<{ jobs: PaperTranslationJob[] }>("/api/papers/translation-jobs", json("POST", input))).jobs;
}

export async function loadTranslationJobs(): Promise<PaperTranslationJob[]> {
  return (await request<{ jobs: PaperTranslationJob[] }>("/api/papers/translation-jobs")).jobs;
}

export async function controlTranslationJob(id: string, action: "pause" | "resume" | "cancel"): Promise<PaperTranslationJob> {
  return (await request<{ job: PaperTranslationJob }>(`/api/papers/translation-jobs/${encodeURIComponent(id)}/${action}`, json("POST"))).job;
}

export async function generateSummary(id: string): Promise<PaperSummary> {
  return (await request<{ summary: PaperSummary }>(`/api/papers/${encodeURIComponent(id)}/summary`, json("POST"))).summary;
}

export async function generateReadingGuide(id: string, sections: PaperSection[]): Promise<PaperReadingGuide> {
  return (await request<{ guide: PaperReadingGuide }>(`/api/papers/${encodeURIComponent(id)}/reading-guide`, json("POST", { sections }))).guide;
}

export async function updateLibrary(id: string, input: Partial<Pick<PaperLibraryEntry, "favorite" | "readLater" | "lastSectionId" | "progress">> & { openedAt?: boolean }) {
  return (await request<{ entry: PaperLibraryEntry }>(`/api/papers/${encodeURIComponent(id)}/library`, json("PATCH", input))).entry;
}

export async function dismissPaper(id: string): Promise<void> {
  await request(`/api/papers/${encodeURIComponent(id)}/dismiss`, json("POST"));
}

export async function recordPaperEvent(id: string, type: string, dwellMs?: number, metadata?: Record<string, unknown>): Promise<void> {
  await request(`/api/papers/${encodeURIComponent(id)}/interactions`, json("POST", { type, dwellMs, metadata }));
}

export async function loadLibrary(filter?: "favorite" | "read-later" | "history") {
  const suffix = filter ? `?filter=${encodeURIComponent(filter)}` : "";
  return (await request<{ entries: PaperLibraryEntry[] }>(`/api/papers/library${suffix}`)).entries;
}

export async function startPaperLearning(id: string): Promise<{ id: string }> {
  return (await request<{ session: { id: string } }>(`/api/papers/${encodeURIComponent(id)}/learning-session`, json("POST"))).session;
}

export async function testApiAgent(): Promise<boolean> {
  return (await request<{ ok: boolean }>("/api/config/api-agent/test", json("POST"))).ok;
}

export async function clearRecommendationHistory(): Promise<void> {
  await request("/api/papers/interactions", { method: "DELETE" });
}

export async function exportPaperData(): Promise<unknown> {
  return (await request<{ data: unknown }>("/api/papers/export")).data;
}

export { extractPaper, searchPapers } from "./papers";
export type { PaperDocument, PaperRecord, PaperSection };
