import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { callApiAgent, type ApiAgentMessage } from "./apiAgent.js";
import { getApiAgentPublicConfig, getAppPreferences } from "../state/appConfig.js";

const PAPER_ROOT = join(homedir(), ".examforge", "papers");
const SEGMENT_CACHE_PATH = join(PAPER_ROOT, "translation-segment-cache.json");

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

interface StoredTranslationCacheEntry extends Omit<TranslationResult, "cached"> {
  cacheKey: string;
  sourceFingerprint: string;
  model: string;
  promptFingerprint: string;
  generatedAt: string;
}

let cacheWriteQueue: Promise<void> = Promise.resolve();
const inFlightTranslations = new Map<string, Promise<TranslationResult>>();

async function readCache(): Promise<Record<string, StoredTranslationCacheEntry>> {
  try {
    return JSON.parse(await fs.readFile(SEGMENT_CACHE_PATH, "utf-8")) as Record<string, StoredTranslationCacheEntry>;
  } catch {
    return {};
  }
}

async function writeCacheEntry(key: string, entry: StoredTranslationCacheEntry): Promise<void> {
  const write = cacheWriteQueue.then(async () => {
    const cache = await readCache();
    cache[key] = entry;
    await fs.mkdir(PAPER_ROOT, { recursive: true });
    const temporaryPath = `${SEGMENT_CACHE_PATH}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temporaryPath, JSON.stringify(cache, null, 2), "utf-8");
    await fs.rename(temporaryPath, SEGMENT_CACHE_PATH);
  });
  cacheWriteQueue = write.catch(() => { });
  await write;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function cacheKey(input: {
  paperId?: string;
  sourceSegmentId?: string;
  sourceText: string;
  model: string;
  prompt: string;
  keywords: string[];
  glossary: TranslationResult["glossary"];
}): string {
  return hash(JSON.stringify({
    paperId: input.paperId ?? "",
    sourceSegmentId: input.sourceSegmentId ?? "",
    sourceText: input.sourceText,
    model: input.model,
    prompt: input.prompt,
    keywords: [...input.keywords].sort(),
    glossary: [...input.glossary].sort((a, b) => a.english.localeCompare(b.english)),
  }));
}

async function readCachedTranslation(key: string, model: string, promptFingerprint: string): Promise<TranslationResult | undefined> {
  const cached = (await readCache())[key];
  if (!cached || cached.model !== model || cached.promptFingerprint !== promptFingerprint) return undefined;
  const { cacheKey: _cacheKey, sourceFingerprint: _sourceFingerprint, model: _model, promptFingerprint: _promptFingerprint, generatedAt: _generatedAt, ...result } = cached;
  return { ...result, cached: true, modelNote: "persistent-cache" };
}

async function persistTranslation(key: string, result: TranslationResult, model: string, promptFingerprint: string, sourceText: string): Promise<void> {
  const { cached: _cached, ...resultWithoutCache } = result;
  const stored: StoredTranslationCacheEntry = {
    ...resultWithoutCache,
    cacheKey: key,
    sourceFingerprint: hash(sourceText),
    model,
    promptFingerprint,
    generatedAt: new Date().toISOString(),
  };
  await writeCacheEntry(key, stored);
}

interface ParsedTranslation {
  translatedText?: string;
  termsUsed?: Array<{ chinese?: string; english?: string }>;
  warnings?: string[];
}

function extractJsonObject(text: string): ParsedTranslation | null {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const candidate = fenced || trimmed.match(/\{[\s\S]*\}/)?.[0];
  if (!candidate) return null;
  try {
    return JSON.parse(candidate) as ParsedTranslation;
  } catch {
    return null;
  }
}

function normalizeKeywords(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => typeof item === "string" ? item.trim() : "")
    .filter(Boolean)
    .slice(0, 30);
}

function normalizeGlossary(value: unknown): TranslationResult["glossary"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const chinese = typeof record.chinese === "string" ? record.chinese.trim() : "";
    const english = typeof record.english === "string" ? record.english.trim() : "";
    return chinese && english ? [{ chinese, english }] : [];
  }).slice(0, 100);
}

function basicWarnings(source: string, translated: string, keywords: string[]): string[] {
  const warnings: string[] = [];
  for (const keyword of keywords) {
    if (keyword && !translated.toLowerCase().includes(keyword.toLowerCase())) {
      warnings.push(`keyword not found in translation: ${keyword}`);
    }
  }

  const sourceNumbers = source.match(/\b\d+(?:\.\d+)?%?\b/g) ?? [];
  const missingNumbers = sourceNumbers.filter((item) => !translated.includes(item));
  if (missingNumbers.length > 0) {
    warnings.push(`possible missing numbers: ${Array.from(new Set(missingNumbers)).slice(0, 8).join(", ")}`);
  }

  const hasEnglishParentheses = /（[^）]*[A-Za-z][^）]*）|\([^)]*[A-Za-z][^)]*\)/.test(translated);
  const likelyEnglishPaperText = /[A-Za-z]{4,}/.test(source);
  if (likelyEnglishPaperText && !hasEnglishParentheses) {
    warnings.push("no English keyword parentheses detected; review technical term preservation");
  }
  return warnings;
}

function normalizeTerms(value: ParsedTranslation["termsUsed"]): TranslationResult["termsUsed"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const chinese = item.chinese?.trim();
    const english = item.english?.trim();
    if (!chinese || !english) return [];
    return [{ chinese, english }];
  });
}

export async function translateSegment(input: Record<string, unknown>): Promise<TranslationResult> {
  const sourceText = typeof input.sourceText === "string" ? input.sourceText.trim() : "";
  if (!sourceText) throw new Error("sourceText is required.");
  if (sourceText.length > 12_000) throw new Error("sourceText is too long; translate a smaller segment first.");

  const paperTitle = typeof input.paperTitle === "string" ? input.paperTitle.trim() : "";
  const paperId = typeof input.paperId === "string" ? input.paperId.trim() : undefined;
  const sourceSegmentId = typeof input.sourceSegmentId === "string" ? input.sourceSegmentId.trim() : undefined;
  const keywords = normalizeKeywords(input.keywords);
  const glossary = normalizeGlossary(input.glossary);
  const apiConfig = await getApiAgentPublicConfig();
  const preferences = await getAppPreferences();
  const customPrompt = typeof input.prompt === "string" && input.prompt.trim()
    ? input.prompt.trim().slice(0, 4_000)
    : preferences.translationPrompt;
  const promptFingerprint = hash(customPrompt);
  const key = cacheKey({ paperId, sourceSegmentId, sourceText, model: apiConfig.model, prompt: customPrompt, keywords, glossary });
  const cached = await readCachedTranslation(key, apiConfig.model, promptFingerprint);
  if (cached) return cached;

  const running = inFlightTranslations.get(key);
  if (running) return { ...(await running), cached: true, modelNote: "inflight-cache" };

  const request = (async (): Promise<TranslationResult> => {
    const messages: ApiAgentMessage[] = [
      {
        role: "system",
        content:
          "You are a careful academic paper translator. Translate faithfully into Simplified Chinese. " +
          "Preserve important technical terms as 中文术语（English keyword）. " +
          "Use the supplied glossary consistently. Do not add claims not present in the source. " +
          "Keep source numbers, equations, citation markers, model names, dataset names, and metric names unchanged. " +
          "Return only JSON with fields: translatedText, termsUsed, warnings.\n\n" +
          `User translation preference (append without weakening the rules above): ${customPrompt}`,
      },
      {
        role: "user",
        content: [
          paperTitle ? `Paper title: ${paperTitle}` : "",
          keywords.length ? `Required English keywords to preserve when relevant: ${keywords.join(", ")}` : "",
          glossary.length ? `Existing glossary (keep these mappings): ${glossary.map((term) => `${term.chinese} (${term.english})`).join("; ")}` : "",
          "Translate this source segment into Simplified Chinese. Keep equations, citations, model names, metric names, dataset names, and variables unchanged.",
          sourceText,
        ].filter(Boolean).join("\n\n"),
      },
    ];

    const raw = await callApiAgent(messages);
    const parsed = extractJsonObject(raw);
    const translatedText = parsed?.translatedText?.trim() || raw.trim();
    const combinedWarnings = [
      ...basicWarnings(sourceText, translatedText, keywords),
      ...(parsed?.warnings ?? []).map((item) => String(item)).filter(Boolean),
    ];
    const termsUsed = normalizeTerms(parsed?.termsUsed);
    for (const term of termsUsed) {
      const existing = glossary.find((item) => item.english.toLowerCase() === term.english.toLowerCase());
      if (existing && existing.chinese !== term.chinese) {
        combinedWarnings.push(`术语译法不一致：${term.english} 已使用“${existing.chinese}”，本次为“${term.chinese}”`);
      }
    }
    const mergedGlossary = [...glossary];
    for (const term of termsUsed) {
      if (!mergedGlossary.some((item) => item.english.toLowerCase() === term.english.toLowerCase())) mergedGlossary.push(term);
    }

    const result: TranslationResult = {
      ok: true,
      paperId,
      sourceSegmentId,
      sourceText,
      translatedText,
      termsUsed,
      warnings: Array.from(new Set(combinedWarnings)),
      modelNote: parsed ? "json" : "raw-text-fallback",
      glossary: mergedGlossary,
      cached: false,
    };
    await persistTranslation(key, result, apiConfig.model, promptFingerprint, sourceText);
    return result;
  })();

  inFlightTranslations.set(key, request);
  try {
    return await request;
  } finally {
    if (inFlightTranslations.get(key) === request) inFlightTranslations.delete(key);
  }
}
