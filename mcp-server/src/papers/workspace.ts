import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { callApiAgent } from "../services/apiAgent.js";
import { getApiAgentPublicConfig, getAppPreferences } from "../state/appConfig.js";
import { searchPapers } from "./service.js";
import type {
  PaperFeedItem,
  PaperInteraction,
  PaperInteractionType,
  PaperLibraryEntry,
  PaperRecord,
  PaperReadingGuide,
  PaperSearchResult,
  PaperSummary,
} from "./types.js";

const ROOT = join(homedir(), ".examforge", "papers");
const LIBRARY_PATH = join(ROOT, "library.json");
const INTERACTIONS_PATH = join(ROOT, "interactions.json");
const SUMMARIES_PATH = join(ROOT, "summaries.json");
const READING_GUIDES_PATH = join(ROOT, "reading-guides.json");
const CACHE_PATH = join(ROOT, "feed-cache.json");
const PROVIDER_CACHE_PATH = join(ROOT, "provider-feed-cache.json");
const PROVIDER_CACHE_TTL_MS = 3 * 60 * 1000;
const MAX_PROVIDER_CACHE_ENTRIES = 240;
interface ProviderFeedCacheEntry {
  result: PaperSearchResult;
  fetchedAt: number;
}
let interactionQueue: Promise<void> = Promise.resolve();
let providerCacheWriteQueue: Promise<void> = Promise.resolve();
let paperCacheWriteQueue: Promise<void> = Promise.resolve();

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try { return JSON.parse(await fs.readFile(path, "utf-8")) as T; } catch { return fallback; }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await fs.mkdir(ROOT, { recursive: true });
  const tmp = `${path}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), "utf-8");
  await fs.rename(tmp, path);
}

function providerFeedCacheKey(query: string, limit: number, offset: number, providers: string[], sort: string): string {
  return createHash("sha256").update(JSON.stringify({ query, limit, offset, providers: [...providers].sort(), sort })).digest("hex");
}

async function saveProviderFeedCache(entries: Record<string, ProviderFeedCacheEntry>): Promise<void> {
  if (!Object.keys(entries).length) return;
  const write = providerCacheWriteQueue.then(async () => {
    const current = await readJson<Record<string, ProviderFeedCacheEntry>>(PROVIDER_CACHE_PATH, {});
    const merged = { ...current, ...entries };
    const trimmed = Object.entries(merged)
      .sort((a, b) => b[1].fetchedAt - a[1].fetchedAt)
      .slice(0, MAX_PROVIDER_CACHE_ENTRIES);
    await writeJson(PROVIDER_CACHE_PATH, Object.fromEntries(trimmed));
  });
  providerCacheWriteQueue = write.catch(() => { });
  await write;
}

export async function rememberPapers(papers: PaperRecord[]): Promise<void> {
  if (!papers.length) return;
  const write = paperCacheWriteQueue.then(async () => {
    const cached = await readJson<Record<string, PaperRecord>>(CACHE_PATH, {});
    for (const paper of papers) cached[paper.id] = { ...cached[paper.id], ...paper };
    // Paper metadata is durable local library data. It is only removed by an explicit user data clear.
    await writeJson(CACHE_PATH, cached);
  });
  paperCacheWriteQueue = write.catch(() => { });
  await write;
}

export async function listCachedPapers(): Promise<PaperRecord[]> {
  const [cached, library] = await Promise.all([
    readJson<Record<string, PaperRecord>>(CACHE_PATH, {}),
    readJson<PaperLibraryEntry[]>(LIBRARY_PATH, []),
  ]);
  const papers = new Map<string, PaperRecord>(Object.entries(cached));
  for (const entry of library) papers.set(entry.paperId, { ...papers.get(entry.paperId), ...entry.paper });
  return Array.from(papers.values()).sort((a, b) => b.fetchedAt.localeCompare(a.fetchedAt));
}

export async function getPaper(paperId: string): Promise<PaperRecord> {
  const cached = await readJson<Record<string, PaperRecord>>(CACHE_PATH, {});
  const library = await readJson<PaperLibraryEntry[]>(LIBRARY_PATH, []);
  const paper = cached[paperId] ?? library.find((item) => item.paperId === paperId)?.paper;
  if (!paper) throw new Error("Paper is not available in the local cache. Search for it again first.");
  return paper;
}

function sourceFingerprint(paper: PaperRecord, model: string, prompt = ""): string {
  return createHash("sha256").update(`${paper.id}\n${paper.title}\n${paper.abstract ?? ""}\n${model}\n${prompt}`).digest("hex");
}

function extractJson(text: string): Record<string, unknown> {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced ?? text.match(/\{[\s\S]*\}/)?.[0];
  if (!candidate) throw new Error("AI summary did not return structured JSON.");
  try { return JSON.parse(candidate) as Record<string, unknown>; } catch { throw new Error("AI summary returned invalid JSON."); }
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];
}

function terms(value: unknown): PaperSummary["terms"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const chinese = typeof record.chinese === "string" ? record.chinese.trim() : "";
    const english = typeof record.english === "string" ? record.english.trim() : "";
    return chinese && english ? [{ chinese, english }] : [];
  });
}

export async function summarizePaper(paperId: string): Promise<{ summary: PaperSummary; cached: boolean }> {
  const paper = await getPaper(paperId);
  if (!paper.abstract) throw new Error("This paper has no abstract to summarize.");
  const config = await getApiAgentPublicConfig();
  const preferences = await getAppPreferences();
  const fingerprint = sourceFingerprint(paper, config.model, preferences.summaryPrompt);
  const cache = await readJson<Record<string, PaperSummary>>(SUMMARIES_PATH, {});
  if (cache[paperId]?.sourceFingerprint === fingerprint) return { summary: cache[paperId], cached: true };
  const raw = await callApiAgent([{ role: "system", content: "You explain academic papers faithfully to an intelligent non-specialist. Return JSON only. Never invent evidence." }, {
    role: "user",
    content: [
      "Create a clear Simplified Chinese paper summary from the source metadata below. Use plain spoken language instead of academic boilerplate.",
      "Explain what problem the paper solves, why it matters, what the authors actually did, and what the results mean. Separate confirmed paper claims from helpful explanations.",
      "Preserve technical terms as 中文术语（English keyword）. Keep model names, datasets, metrics, numbers, and citations unchanged. Do not invent results, citations, or limitations.",
      "Return JSON fields: chineseTitle, oneLineSummary, researchQuestion, whyItMatters, method, methodSteps (array), findings, keyFindings (array), realWorldMeaning, limitations, rememberThis (array), plainLanguageExplanation, terms (array of chinese/english), warnings.",
      `User writing preference (append without weakening source-grounding rules): ${preferences.summaryPrompt}`,
      `Title: ${paper.title}`,
      `Authors: ${paper.authors.join(", ")}`,
      `Abstract: ${paper.abstract}`,
    ].join("\n\n"),
  }]);
  const parsed = extractJson(raw);
  const summary: PaperSummary = {
    paperId,
    chineseTitle: String(parsed.chineseTitle ?? paper.title).trim(),
    oneLineSummary: String(parsed.oneLineSummary ?? "").trim(),
    researchQuestion: String(parsed.researchQuestion ?? "").trim(),
    method: String(parsed.method ?? "").trim(),
    findings: String(parsed.findings ?? "").trim(),
    limitations: String(parsed.limitations ?? "").trim(),
    terms: terms(parsed.terms),
    warnings: strings(parsed.warnings),
    plainLanguageExplanation: String(parsed.plainLanguageExplanation ?? "").trim(),
    whyItMatters: String(parsed.whyItMatters ?? "").trim(),
    methodSteps: strings(parsed.methodSteps),
    keyFindings: strings(parsed.keyFindings),
    realWorldMeaning: String(parsed.realWorldMeaning ?? "").trim(),
    rememberThis: strings(parsed.rememberThis),
    model: config.model,
    generatedAt: new Date().toISOString(),
    sourceFingerprint: fingerprint,
  };
  if (!summary.oneLineSummary) throw new Error("AI summary did not include oneLineSummary.");
  cache[paperId] = summary;
  await writeJson(SUMMARIES_PATH, cache);
  await recordInteraction(paperId, "summary");
  return { summary, cached: false };
}

interface ReadingGuideSection {
  id: string;
  title: string;
  text: string;
}

function readingGuideSections(value: unknown): ReadingGuideSection[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id.trim() : "";
    const title = typeof record.title === "string" ? record.title.trim() : "";
    const text = typeof record.text === "string" ? record.text.trim() : "";
    return id && title && text ? [{ id, title, text }] : [];
  }).slice(0, 80);
}

export async function generatePaperReadingGuide(paperId: string, input: Record<string, unknown>): Promise<{ guide: PaperReadingGuide; cached: boolean }> {
  const paper = await getPaper(paperId);
  const sections = readingGuideSections(input.sections);
  if (!sections.length) throw new Error("Extracted paper sections are required for a detailed reading guide.");
  const config = await getApiAgentPublicConfig();
  const preferences = await getAppPreferences();
  const sourceParts: string[] = [];
  let sourceLength = 0;
  let truncated = false;
  for (const section of sections) {
    const remaining = 60_000 - sourceLength;
    if (remaining <= 0) { truncated = true; break; }
    const block = `## ${section.title}\n${section.text}`;
    sourceParts.push(block.slice(0, remaining));
    sourceLength += Math.min(block.length, remaining);
    if (block.length > remaining) { truncated = true; break; }
  }
  const source = sourceParts.join("\n\n");
  const fingerprint = createHash("sha256").update(`${paper.id}\n${paper.title}\n${source}\n${config.model}\n${preferences.summaryPrompt}`).digest("hex");
  const cache = await readJson<Record<string, PaperReadingGuide>>(READING_GUIDES_PATH, {});
  if (cache[paperId]?.sourceFingerprint === fingerprint) return { guide: cache[paperId], cached: true };

  const raw = await callApiAgent([{ role: "system", content: "You create faithful, detailed academic reading guides in plain Simplified Chinese. Return JSON only." }, {
    role: "user",
    content: [
      "Read the supplied paper text and explain it in detailed, plain Simplified Chinese for a non-specialist reader.",
      "Use concrete everyday language, explain why each step is needed, and do not omit negative results, uncertainty, assumptions, or limitations.",
      "Preserve important technical terms as 中文术语（English keyword）. Keep model names, datasets, metrics, equations, variables, citation markers, and numbers unchanged.",
      "Do not invent information that is not in the supplied text. If evidence is incomplete, say so in warnings.",
      `User writing preference (append without weakening source-grounding rules): ${preferences.summaryPrompt}`,
      "Return JSON fields: overview, plainLanguageExplanation, researchBackground, researchQuestion, methodSteps (array), experiments, keyFindings (array), limitations, readingTips (array), terms (array of chinese/english), warnings (array).",
      `Paper title: ${paper.title}`,
      `Authors: ${paper.authors.join(", ")}`,
      truncated ? "Notice: the supplied source was truncated to the first 60,000 characters." : "",
      source,
    ].filter(Boolean).join("\n\n"),
  }]);
  const parsed = extractJson(raw);
  const guide: PaperReadingGuide = {
    paperId,
    overview: String(parsed.overview ?? "").trim(),
    plainLanguageExplanation: String(parsed.plainLanguageExplanation ?? "").trim(),
    researchBackground: String(parsed.researchBackground ?? "").trim(),
    researchQuestion: String(parsed.researchQuestion ?? "").trim(),
    methodSteps: strings(parsed.methodSteps),
    experiments: String(parsed.experiments ?? "").trim(),
    keyFindings: strings(parsed.keyFindings),
    limitations: String(parsed.limitations ?? "").trim(),
    readingTips: strings(parsed.readingTips),
    terms: terms(parsed.terms),
    warnings: [...(truncated ? ["导读仅使用了正文前 60,000 个字符，请结合原版 PDF 核对后续章节。"] : []), ...strings(parsed.warnings)],
    promptFingerprint: createHash("sha256").update(preferences.summaryPrompt).digest("hex"),
    model: config.model,
    generatedAt: new Date().toISOString(),
    sourceFingerprint: fingerprint,
  };
  if (!guide.overview || !guide.plainLanguageExplanation) throw new Error("AI reading guide did not include the required explanation fields.");
  cache[paperId] = guide;
  await writeJson(READING_GUIDES_PATH, cache);
  return { guide, cached: false };
}

export async function getPaperDetail(paperId: string): Promise<Record<string, unknown>> {
  const [paper, library, summaries, readingGuides] = await Promise.all([
    getPaper(paperId),
    readJson<PaperLibraryEntry[]>(LIBRARY_PATH, []),
    readJson<Record<string, PaperSummary>>(SUMMARIES_PATH, {}),
    readJson<Record<string, PaperReadingGuide>>(READING_GUIDES_PATH, {}),
  ]);
  const [config, preferences] = await Promise.all([getApiAgentPublicConfig(), getAppPreferences()]);
  const summary = summaries[paperId]?.sourceFingerprint === sourceFingerprint(paper, config.model, preferences.summaryPrompt) ? summaries[paperId] : undefined;
  const promptFingerprint = createHash("sha256").update(preferences.summaryPrompt).digest("hex");
  const readingGuide = readingGuides[paperId]?.model === config.model && readingGuides[paperId]?.promptFingerprint === promptFingerprint ? readingGuides[paperId] : undefined;
  return { ok: true, paper, library: library.find((item) => item.paperId === paperId), summary, readingGuide };
}

export async function updatePaperLibrary(paperId: string, input: Record<string, unknown>): Promise<PaperLibraryEntry> {
  const paper = await getPaper(paperId);
  const library = await readJson<PaperLibraryEntry[]>(LIBRARY_PATH, []);
  const index = library.findIndex((item) => item.paperId === paperId);
  if (input.remove === true && index >= 0) {
    const [removed] = library.splice(index, 1);
    await writeJson(LIBRARY_PATH, library);
    return removed;
  }
  const current = index >= 0 ? library[index] : { paperId, paper, favorite: false, readLater: false, updatedAt: new Date().toISOString() };
  const next: PaperLibraryEntry = {
    ...current,
    paper,
    favorite: typeof input.favorite === "boolean" ? input.favorite : current.favorite,
    readLater: typeof input.readLater === "boolean" ? input.readLater : current.readLater,
    openedAt: input.openedAt === true ? new Date().toISOString() : current.openedAt,
    lastSectionId: typeof input.lastSectionId === "string" ? input.lastSectionId : current.lastSectionId,
    progress: typeof input.progress === "number" ? Math.min(1, Math.max(0, input.progress)) : current.progress,
    learningSessionId: input.clearLearningSession === true ? undefined : typeof input.learningSessionId === "string" ? input.learningSessionId : current.learningSessionId,
    updatedAt: new Date().toISOString(),
  };
  if (index >= 0) library[index] = next; else library.push(next);
  await writeJson(LIBRARY_PATH, library);
  if (typeof input.favorite === "boolean") await recordInteraction(paperId, "favorite", { value: input.favorite });
  if (typeof input.readLater === "boolean") await recordInteraction(paperId, "read-later", { value: input.readLater });
  return next;
}

export async function listPaperLibrary(filter?: string): Promise<{ entries: PaperLibraryEntry[] }> {
  const library = await readJson<PaperLibraryEntry[]>(LIBRARY_PATH, []);
  const entries = filter === "favorite" ? library.filter((item) => item.favorite)
    : filter === "read-later" ? library.filter((item) => item.readLater)
      : filter === "history" ? library.filter((item) => item.openedAt)
        : library;
  return { entries: entries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) };
}

const INTERACTION_TYPES: PaperInteractionType[] = ["impression", "open", "summary", "favorite", "read-later", "dismiss", "learn", "dwell"];

export async function recordInteraction(paperId: string, type: PaperInteractionType, metadata?: Record<string, unknown>, dwellMs?: number): Promise<void> {
  if (!INTERACTION_TYPES.includes(type)) throw new Error("Unsupported paper interaction.");
  const preferences = await getAppPreferences();
  if (!preferences.personalizationEnabled && ["impression", "open", "dwell"].includes(type)) return;
  const nextItem: PaperInteraction = { id: randomUUID(), paperId, type, metadata, dwellMs, timestamp: new Date().toISOString() };
  interactionQueue = interactionQueue.then(async () => {
    const list = await readJson<PaperInteraction[]>(INTERACTIONS_PATH, []);
    list.push(nextItem);
    await writeJson(INTERACTIONS_PATH, list.slice(-5000));
  });
  await interactionQueue;
}

export async function recordInteractionFromInput(paperId: string, input: Record<string, unknown>): Promise<void> {
  const type = String(input.type ?? "") as PaperInteractionType;
  const metadata = input.metadata && typeof input.metadata === "object" ? input.metadata as Record<string, unknown> : undefined;
  await recordInteraction(paperId, type, metadata, typeof input.dwellMs === "number" ? input.dwellMs : undefined);
}

const GENERAL_AI_QUERY = "artificial intelligence";
const INTEREST_QUERY_MAP: Record<string, string> = {
  "大语言模型": "large language model",
  "检索增强生成": "retrieval augmented generation",
  "计算机视觉": "computer vision",
  "多模态": "multimodal learning",
  "强化学习": "reinforcement learning",
  "AI Agent": "AI agent",
  "语音识别": "speech recognition",
  "生成模型": "generative model",
  "推荐系统": "recommender system",
  "机器人": "robotics",
};

interface FeedSearch {
  query: string;
  topic: string;
  reason: string;
}

function interestSearch(interest: string): FeedSearch {
  const mapped = INTEREST_QUERY_MAP[interest];
  if (mapped) return { query: mapped, topic: interest, reason: `与你关注的“${interest}”相关` };
  if (!/[\u3400-\u9fff]/u.test(interest)) {
    return { query: interest, topic: interest, reason: `与你关注的“${interest}”相关` };
  }
  return {
    query: GENERAL_AI_QUERY,
    topic: "人工智能",
    reason: `暂未识别“${interest}”的英文检索词，已补充综合 AI 论文`,
  };
}

function channelSearches(channel: string, interests: string[]): FeedSearch[] {
  const fixed: Record<string, FeedSearch> = {
    latest: { query: "machine learning", topic: "机器学习", reason: "近期机器学习论文" },
    llm: { query: "large language model", topic: "大语言模型", reason: "大语言模型" },
    vision: { query: "computer vision", topic: "计算机视觉", reason: "计算机视觉" },
    rl: { query: "reinforcement learning", topic: "强化学习", reason: "强化学习" },
  };
  if (fixed[channel]) return [fixed[channel]];
  if (channel.startsWith("interest:") && channel.slice(9).trim()) {
    return [interestSearch(channel.slice(9).trim())];
  }
  const selected = [...new Set(interests.map((item) => item.trim()).filter(Boolean))].slice(0, 3);
  if (!selected.length) return [{ query: GENERAL_AI_QUERY, topic: "人工智能", reason: "综合热门论文" }];
  const searches = selected.map(interestSearch);
  return searches.filter((search, index) => searches.findIndex((item) => item.query === search.query) === index);
}

function paperIdentity(paper: PaperRecord): string {
  if (paper.doi) return `doi:${paper.doi.toLowerCase()}`;
  if (paper.arxivId) return `arxiv:${paper.arxivId.toLowerCase()}`;
  return `title:${paper.title.toLowerCase().replace(/\W+/g, " ").trim()}`;
}

function mergePaper(existing: PaperRecord, incoming: PaperRecord): PaperRecord {
  return {
    ...existing,
    authors: existing.authors.length >= incoming.authors.length ? existing.authors : incoming.authors,
    abstract: existing.abstract ?? incoming.abstract,
    doi: existing.doi ?? incoming.doi,
    arxivId: existing.arxivId ?? incoming.arxivId,
    pdfUrl: existing.pdfUrl ?? incoming.pdfUrl,
    venue: existing.venue ?? incoming.venue,
    url: existing.url ?? incoming.url,
  };
}

function paperTokens(paper: PaperRecord): Set<string> {
  const text = [paper.title, paper.abstract ?? "", ...(paper.keywords ?? [])].join(" ").toLowerCase();
  return new Set(text.match(/[a-z][a-z0-9+#.-]{2,}/g) ?? []);
}

function addPaperProfile(target: Map<string, number>, paper: PaperRecord, weight: number): void {
  for (const token of paperTokens(paper)) target.set(token, (target.get(token) ?? 0) + weight);
}

function weightedOverlap(profile: Map<string, number>, tokens: Set<string>): number {
  let total = 0;
  let matched = 0;
  for (const [token, weight] of profile) {
    const positiveWeight = Math.max(0, weight);
    total += positiveWeight;
    if (tokens.has(token)) matched += positiveWeight;
  }
  return total > 0 ? Math.min(1, matched / total) : 0;
}

function interestProfile(interests: string[]): Map<string, number> {
  const profile = new Map<string, number>();
  for (const interest of interests) {
    const search = interestSearch(interest);
    for (const token of search.query.toLowerCase().match(/[a-z][a-z0-9+#.-]{2,}/g) ?? []) {
      profile.set(token, (profile.get(token) ?? 0) + 1);
    }
  }
  return profile;
}

export async function getPaperFeed(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const preferences = await getAppPreferences();
  const channel = typeof input.channel === "string" ? input.channel : "for-you";
  const cursor = Math.max(0, Number(input.cursor) || 0);
  const limit = Math.min(20, Math.max(6, Number(input.limit) || preferences.searchLimit));
  const searches = channelSearches(channel, preferences.interests);
  const providers = [preferences.providerArxiv ? "arxiv" : "", preferences.providerSemanticScholar ? "semantic-scholar" : ""].filter(Boolean);
  if (!providers.length) throw new Error("Enable at least one paper provider in Settings.");
  const perSearchLimit = Math.max(1, Math.ceil(limit / searches.length));
  const perSearchOffset = Math.floor(cursor / searches.length);
  const providerCache = await readJson<Record<string, ProviderFeedCacheEntry>>(PROVIDER_CACHE_PATH, {});
  const cacheWrites: Record<string, ProviderFeedCacheEntry> = {};
  const feedSort = channel === "latest" ? "newest" : "relevance";
  const loadProviderResults = async (search: FeedSearch, resultLimit: number, resultOffset: number) => {
    const key = providerFeedCacheKey(search.query, resultLimit, resultOffset, providers, feedSort);
    const cached = providerCache[key];
    if (cached && Date.now() - cached.fetchedAt < PROVIDER_CACHE_TTL_MS) return cached.result;
    const result = await searchPapers({ query: search.query, limit: resultLimit, offset: resultOffset, providers, sort: feedSort });
    cacheWrites[key] = { result, fetchedAt: Date.now() };
    return result;
  };
  const results = await Promise.all(searches.map(async (search) => ({
    search,
    result: await loadProviderResults(search, perSearchLimit, perSearchOffset),
  })));
  await saveProviderFeedCache(cacheWrites);

  type Candidate = { paper: PaperRecord; reasons: Set<string>; topics: Set<string>; bestRank: number };
  const candidates = new Map<string, Candidate>();
  const diagnosticRuns: PaperSearchResult["diagnostics"] = [];
  const addResults = (runs: typeof results) => {
    for (const { search, result } of runs) {
      diagnosticRuns.push(...result.diagnostics);
      result.results.forEach((paper, index) => {
        const key = paperIdentity(paper);
        const existing = candidates.get(key);
        if (existing) {
          existing.paper = mergePaper(existing.paper, paper);
          existing.reasons.add(search.reason);
          existing.topics.add(search.topic);
          existing.bestRank = Math.min(existing.bestRank, index);
        } else {
          candidates.set(key, { paper, reasons: new Set([search.reason]), topics: new Set([search.topic]), bestRank: index });
        }
      });
    }
  };
  addResults(results);

  if (channel === "for-you" && candidates.size === 0 && searches.some((search) => search.query !== GENERAL_AI_QUERY)) {
    const fallbackSearch: FeedSearch = {
      query: GENERAL_AI_QUERY,
      topic: "人工智能",
      reason: "兴趣候选暂时不可用，已补充综合 AI 论文",
    };
    const fallbackResult = await loadProviderResults(fallbackSearch, limit, cursor);
    await saveProviderFeedCache(cacheWrites);
    addResults([{ search: fallbackSearch, result: fallbackResult }]);
  }

  const papers = Array.from(candidates.values()).map((candidate) => candidate.paper);
  await rememberPapers(papers);
  const [library, summaries, interactions] = await Promise.all([
    readJson<PaperLibraryEntry[]>(LIBRARY_PATH, []),
    readJson<Record<string, PaperSummary>>(SUMMARIES_PATH, {}),
    readJson<PaperInteraction[]>(INTERACTIONS_PATH, []),
  ]);
  const currentModel = (await getApiAgentPublicConfig()).model;
  const dismissed = new Set(interactions.filter((item) => item.type === "dismiss").map((item) => item.paperId));
  const opened = new Set(interactions.filter((item) => item.type === "open").map((item) => item.paperId));
  const knownPapers = new Map<string, PaperRecord>();
  for (const entry of library) knownPapers.set(entry.paperId, entry.paper);
  for (const paper of papers) knownPapers.set(paper.id, paper);
  const explicitProfile = interestProfile(preferences.interests);
  const behaviorProfile = new Map<string, number>();
  const negativeProfile = new Map<string, number>();
  const behaviorWeights: Partial<Record<PaperInteractionType, number>> = {
    favorite: 8,
    "read-later": 5,
    open: 2,
    summary: 3,
    learn: 5,
    dwell: 2,
  };
  for (const interaction of interactions) {
    const paper = knownPapers.get(interaction.paperId);
    if (!paper) continue;
    if (interaction.type === "dismiss") addPaperProfile(negativeProfile, paper, 7);
    const weight = behaviorWeights[interaction.type];
    if (weight) addPaperProfile(behaviorProfile, paper, interaction.type === "dwell" && (interaction.dwellMs ?? 0) < 45_000 ? 0.5 : weight);
  }
  for (const entry of library) {
    if (entry.favorite) addPaperProfile(behaviorProfile, entry.paper, 8);
    else if (entry.readLater) addPaperProfile(behaviorProfile, entry.paper, 5);
  }
  const items: PaperFeedItem[] = Array.from(candidates.values())
    .filter((candidate) => !dismissed.has(candidate.paper.id))
    .map((candidate) => {
      const paper = candidate.paper;
      const tokens = paperTokens(paper);
      const explicitFit = weightedOverlap(explicitProfile, tokens);
      const behaviorFit = weightedOverlap(behaviorProfile, tokens);
      const negativeFit = weightedOverlap(negativeProfile, tokens);
      const ageYears = paper.year ? Math.max(0, new Date().getFullYear() - paper.year) : 8;
      const freshness = Math.max(0, 1 - ageYears / 8);
      const sourceQuality = paper.abstract ? 1 : 0.35;
      const providerRank = Math.max(0, 1 - candidate.bestRank / Math.max(1, limit));
      const novelty = opened.has(paper.id) ? 0.15 : 1;
      const score = explicitFit * 42 + behaviorFit * 28 + freshness * 12 + sourceQuality * 8 + providerRank * 10 - negativeFit * 22 - (opened.has(paper.id) ? 8 : 0);
      const topic = Array.from(candidate.topics)[0] ?? "这个方向";
      const reason = explicitFit > 0.08
        ? `与你关注的“${topic}”相关`
        : behaviorFit > 0.08
          ? "与你最近阅读和收藏的论文相近"
          : Array.from(candidate.reasons).slice(0, 2).join("；");
      return {
        paper,
        summary: summaries[paper.id]?.sourceFingerprint === sourceFingerprint(paper, currentModel, preferences.summaryPrompt) ? summaries[paper.id] : undefined,
        library: library.find((item) => item.paperId === paper.id),
        reason,
        score,
        topics: Array.from(candidate.topics),
        scoreBreakdown: {
          explicitFit: Math.round(explicitFit * 100),
          behaviorFit: Math.round(behaviorFit * 100),
          freshness: Math.round(freshness * 100),
          providerRank: Math.round(providerRank * 100),
          novelty: Math.round(novelty * 100),
          negativeFit: Math.round(negativeFit * 100),
        },
      };
    }).sort((a, b) => b.score - a.score);

  const selected: PaperFeedItem[] = [];
  const topicCounts = new Map<string, number>();
  const authorCounts = new Map<string, number>();
  for (const item of items) {
    if (selected.length >= limit) break;
    const topic = item.topics[0] ?? "";
    const author = item.paper.authors[0] ?? "";
    if (topic && (topicCounts.get(topic) ?? 0) >= 3 && items.length - selected.length > limit) continue;
    if (author && (authorCounts.get(author) ?? 0) >= 2 && items.length - selected.length > limit) continue;
    selected.push(item);
    if (topic) topicCounts.set(topic, (topicCounts.get(topic) ?? 0) + 1);
    if (author) authorCounts.set(author, (authorCounts.get(author) ?? 0) + 1);
  }
  if (selected.length < limit) {
    for (const item of items) {
      if (selected.length >= limit || selected.some((selectedItem) => selectedItem.paper.id === item.paper.id)) continue;
      selected.push(item);
    }
  }

  const diagnostics = providers.map((provider) => {
    const runs = diagnosticRuns.filter((diagnostic) => diagnostic.provider === provider);
    const failedRuns = runs.filter((run) => !run.ok);
    const errors = [...new Set(failedRuns.map((run) => run.error ?? "Unknown provider error"))];
    const count = runs.reduce((sum, run) => sum + (run.count ?? 0), 0);
    return errors.length
      ? { provider, ok: false, count, error: `${errors.join("; ")} (${failedRuns.length}/${runs.length} requests failed)` }
      : { provider, ok: true, count };
  });
  return { ok: true, channel, items: selected, nextCursor: cursor + limit, diagnostics };
}

export async function dismissPaper(paperId: string): Promise<void> {
  await recordInteraction(paperId, "dismiss");
}

export async function clearRecommendationHistory(): Promise<void> {
  await interactionQueue;
  await writeJson(INTERACTIONS_PATH, []);
}

export async function exportPaperData(): Promise<Record<string, unknown>> {
  const [library, interactions, summaries, readingGuides] = await Promise.all([
    readJson<PaperLibraryEntry[]>(LIBRARY_PATH, []),
    readJson<PaperInteraction[]>(INTERACTIONS_PATH, []),
    readJson<Record<string, PaperSummary>>(SUMMARIES_PATH, {}),
    readJson<Record<string, PaperReadingGuide>>(READING_GUIDES_PATH, {}),
  ]);
  return { exportedAt: new Date().toISOString(), library, interactions, summaries, readingGuides };
}
