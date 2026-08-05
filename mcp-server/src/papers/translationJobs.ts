import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getApiAgentPublicConfig, getAppPreferences, type TranslationScope, type TranslationTier } from "../state/appConfig.js";
import { extractPaperPdf } from "./pdf.js";
import { getPaper, listCachedPapers, listPaperLibrary } from "./workspace.js";
import { translateSegment, type TranslationResult } from "../services/translation.js";
import type { PaperRecord, PaperSection, PaperTranslationJob, PaperTranslationSegment, TranslationJobStatus } from "./types.js";

const ROOT = join(homedir(), ".examforge", "papers");
const JOBS_PATH = join(ROOT, "translation-jobs.json");
const TRANSLATIONS_PATH = join(ROOT, "translations.json");
const MAX_CONCURRENCY = 16;
const MAX_ACTIVE_JOBS = 4;
const MAX_SECTION_CHARS = 80_000;

interface StoredTranslationDocument {
  paperId: string;
  paperTitle: string;
  model: string;
  promptFingerprint: string;
  glossary: Array<{ chinese: string; english: string }>;
  segments: Record<string, PaperTranslationSegment>;
  updatedAt: string;
}

interface TranslationJobInput {
  paperIds?: unknown;
  paperId?: unknown;
  scope?: unknown;
  tier?: unknown;
  concurrency?: unknown;
  generateGuide?: unknown;
}

let queuedJobIds: string[] = [];
let activeJobCount = 0;
let activeTranslationCalls = 0;
const waitingTranslationCalls: Array<() => void> = [];
let translationWriteQueue: Promise<void> = Promise.resolve();

async function acquireTranslationSlot(): Promise<void> {
  if (activeTranslationCalls < MAX_CONCURRENCY) {
    activeTranslationCalls += 1;
    return;
  }
  await new Promise<void>((resolve) => waitingTranslationCalls.push(resolve));
  activeTranslationCalls += 1;
}

function releaseTranslationSlot(): void {
  activeTranslationCalls = Math.max(0, activeTranslationCalls - 1);
  waitingTranslationCalls.shift()?.();
}

async function withTranslationSlot<T>(work: () => Promise<T>): Promise<T> {
  await acquireTranslationSlot();
  try { return await work(); } finally { releaseTranslationSlot(); }
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try { return JSON.parse(await fs.readFile(path, "utf-8")) as T; } catch { return fallback; }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await fs.mkdir(ROOT, { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  await fs.writeFile(temp, JSON.stringify(value, null, 2), "utf-8");
  await fs.rename(temp, path);
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sectionFingerprint(paper: PaperRecord, section: PaperSection): string {
  return hash(`${paper.id}\n${section.id}\n${section.title}\n${section.text}`);
}

function normalizeTier(value: unknown, fallback: TranslationTier): TranslationTier {
  return value === "low" || value === "medium" || value === "high" || value === "max" ? value : fallback;
}

function normalizeScope(value: unknown, fallback: TranslationScope): TranslationScope {
  return value === "current" || value === "favorites" || value === "read-later" || value === "queue" || value === "all" ? value : fallback;
}

function resolveConcurrency(tier: TranslationTier, value: unknown, configured: number): number {
  const requested = Number(value);
  const base = Number.isFinite(requested) ? Math.floor(requested) : configured;
  if (tier === "low") return 1;
  if (tier === "medium") return Math.min(4, Math.max(1, base));
  return Math.min(MAX_CONCURRENCY, Math.max(1, base));
}

function splitText(text: string): string[] {
  const chunks: string[] = [];
  let remaining = text.trim();
  while (remaining.length > 8_000) {
    const paragraph = remaining.lastIndexOf("\n\n", 8_000);
    const sentence = remaining.lastIndexOf(". ", 8_000);
    const splitAt = Math.max(paragraph, sentence, 4_500);
    const end = splitAt + (splitAt === sentence ? 1 : 0);
    chunks.push(remaining.slice(0, end).trim());
    remaining = remaining.slice(end).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

function relevantSections(sections: PaperSection[]): PaperSection[] {
  return sections
    .filter((section) => !/^(references|acknowledg)/i.test(section.title))
    .map((section) => ({ ...section, text: section.text.slice(0, MAX_SECTION_CHARS) }))
    .filter((section) => section.text.trim())
    .slice(0, 80);
}

function mergeParts(paper: PaperRecord, section: PaperSection, parts: TranslationResult[], sourceFingerprint: string, model: string, promptFingerprint: string): PaperTranslationSegment {
  return {
    paperId: paper.id,
    sectionId: section.id,
    sectionTitle: section.title,
    sourceText: parts.map((part) => part.sourceText).join("\n\n"),
    translatedText: parts.map((part) => part.translatedText).join("\n\n"),
    termsUsed: Array.from(new Map(parts.flatMap((part) => part.termsUsed).map((term) => [term.english.toLowerCase(), term])).values()),
    warnings: Array.from(new Set(parts.flatMap((part) => part.warnings))),
    sourceFingerprint,
    model,
    promptFingerprint,
    generatedAt: new Date().toISOString(),
  };
}

async function updateJob(jobId: string, patch: Partial<PaperTranslationJob>): Promise<PaperTranslationJob> {
  const jobs = await readJson<Record<string, PaperTranslationJob>>(JOBS_PATH, {});
  const current = jobs[jobId];
  if (!current) throw new Error("Translation job was not found.");
  const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
  jobs[jobId] = next;
  await writeJson(JOBS_PATH, jobs);
  return next;
}

async function currentJob(jobId: string): Promise<PaperTranslationJob | undefined> {
  const jobs = await readJson<Record<string, PaperTranslationJob>>(JOBS_PATH, {});
  return jobs[jobId];
}

async function saveTranslationDocument(document: StoredTranslationDocument): Promise<void> {
  const write = translationWriteQueue.then(async () => {
    const translations = await readJson<Record<string, StoredTranslationDocument>>(TRANSLATIONS_PATH, {});
    const current = translations[document.paperId];
    const sameVersion = current?.model === document.model && current.promptFingerprint === document.promptFingerprint;
    translations[document.paperId] = current && sameVersion ? {
      ...current,
      ...document,
      glossary: document.glossary,
      segments: { ...current.segments, ...document.segments },
    } : document;
    await writeJson(TRANSLATIONS_PATH, translations);
  });
  translationWriteQueue = write.catch(() => { });
  await write;
}

async function translateSection(paper: PaperRecord, section: PaperSection, existing: StoredTranslationDocument, prompt: string): Promise<PaperTranslationSegment> {
  const config = await getApiAgentPublicConfig();
  const sourceFingerprint = sectionFingerprint(paper, section);
  const promptFingerprint = hash(prompt);
  const cached = existing.segments[section.id];
  if (cached && cached.sourceFingerprint === sourceFingerprint && cached.model === config.model && cached.promptFingerprint === promptFingerprint) return cached;

  const parts: TranslationResult[] = [];
  let glossary = existing.glossary;
  const chunks = splitText(section.text);
  for (const [index, sourceText] of chunks.entries()) {
    const result = await withTranslationSlot(() => translateSegment({
      paperId: paper.id,
      paperTitle: paper.title,
      sourceSegmentId: chunks.length === 1 ? section.id : `${section.id}-part-${index + 1}`,
      sourceText,
      keywords: paper.keywords,
      glossary,
      prompt,
    }));
    parts.push(result);
    glossary = result.glossary;
  }
  existing.glossary = glossary;
  return mergeParts(paper, section, parts, sourceFingerprint, config.model, promptFingerprint);
}

async function runWithConcurrency<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const run = async () => {
    while (cursor < items.length) {
      const item = items[cursor];
      cursor += 1;
      await worker(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, items.length)) }, () => run()));
}

async function runTranslationJob(jobId: string): Promise<void> {
  const job = await currentJob(jobId);
  if (!job || job.status === "cancelled" || job.status === "paused") return;
  try {
    await updateJob(jobId, { status: "running", error: undefined });
    const paper = await getPaper(job.paperId);
    if (!paper.pdfUrl) throw new Error("这篇论文没有可用 PDF，无法进行全文翻译。");
    const extracted = await extractPaperPdf({ paper });
    const sections = relevantSections(extracted.document.sections);
    if (!sections.length) throw new Error("PDF 没有可翻译的正文段落。");
    const preferences = await getAppPreferences();
    const prompt = preferences.translationPrompt;
    const config = await getApiAgentPublicConfig();
    const promptFingerprint = hash(prompt);
    const translations = await readJson<Record<string, StoredTranslationDocument>>(TRANSLATIONS_PATH, {});
    const stored = translations[paper.id];
    const document = stored && stored.model === config.model && stored.promptFingerprint === promptFingerprint ? stored : {
      paperId: paper.id,
      paperTitle: paper.title,
      model: config.model,
      promptFingerprint,
      glossary: [],
      segments: {},
      updatedAt: new Date().toISOString(),
    } satisfies StoredTranslationDocument;
    const pendingSections = sections.filter((section) => {
      const cached = document.segments[section.id];
      return !cached || cached.sourceFingerprint !== sectionFingerprint(paper, section) || cached.model !== config.model || cached.promptFingerprint !== promptFingerprint;
    });
    let completed = sections.length - pendingSections.length;
    let failed = 0;
    await updateJob(jobId, { total: sections.length, completed, failed });
    await runWithConcurrency(pendingSections, job.concurrency, async (section) => {
      const latest = await currentJob(jobId);
      if (!latest || latest.status === "cancelled" || latest.status === "paused") return;
      try {
        document.segments[section.id] = await translateSection(paper, section, document, prompt);
        document.updatedAt = new Date().toISOString();
        await saveTranslationDocument(document);
        completed += 1;
        await updateJob(jobId, { completed, failed });
      } catch (error) {
        failed += 1;
        await updateJob(jobId, { completed, failed, error: error instanceof Error ? error.message : String(error) });
      }
    });
    const latest = await currentJob(jobId);
    if (!latest || latest.status === "cancelled" || latest.status === "paused") return;
    let guideError = "";
    if (job.generateGuide && sections.length > 0) {
      try {
        const { generatePaperReadingGuide } = await import("./workspace.js");
        await generatePaperReadingGuide(paper.id, { sections });
      } catch (error) {
        guideError = error instanceof Error ? error.message : String(error);
      }
    }
    const finalStatus: TranslationJobStatus = completed === 0 && failed > 0 ? "failed" : "completed";
    const errors = [failed ? `${failed} 个章节翻译失败，可重试。` : "", guideError ? `详细导读生成失败：${guideError}` : ""].filter(Boolean);
    await updateJob(jobId, { status: finalStatus, completed, failed, error: errors.length ? errors.join(" ") : undefined });
  } catch (error) {
    await updateJob(jobId, { status: "failed", error: error instanceof Error ? error.message : String(error) });
  }
}

function schedule(jobId: string): void {
  if (queuedJobIds.includes(jobId)) return;
  queuedJobIds.push(jobId);
  pumpQueue();
}

function pumpQueue(): void {
  while (activeJobCount < MAX_ACTIVE_JOBS && queuedJobIds.length > 0) {
    const jobId = queuedJobIds.shift();
    if (!jobId) return;
    activeJobCount += 1;
    void runTranslationJob(jobId)
      .catch(async (error) => {
        await updateJob(jobId, { status: "failed", error: error instanceof Error ? error.message : String(error) });
      })
      .finally(() => {
        activeJobCount = Math.max(0, activeJobCount - 1);
        pumpQueue();
      });
  }
}

export async function createTranslationJobs(input: TranslationJobInput): Promise<{ jobs: PaperTranslationJob[] }> {
  const preferences = await getAppPreferences();
  const tier = normalizeTier(input.tier, preferences.translationTier);
  const scope = normalizeScope(input.scope, preferences.translationScope);
  const ids = Array.isArray(input.paperIds) ? input.paperIds.map(String).filter(Boolean) : [];
  if (typeof input.paperId === "string" && input.paperId.trim()) ids.push(input.paperId.trim());
  if (scope === "favorites" || scope === "read-later") {
    const entries = await listPaperLibrary(scope);
    ids.push(...entries.entries.map((entry) => entry.paperId));
  }
  if (scope === "all") ids.push(...(await listCachedPapers()).map((paper) => paper.id));
  const uniqueIds = Array.from(new Set(ids));
  if (!uniqueIds.length) throw new Error("请选择至少一篇论文或一个翻译范围。");
  if (uniqueIds.length > (scope === "all" ? 500 : 100)) throw new Error(scope === "all" ? "本地论文过多，请先分批处理；单次最多自动加入 500 篇。" : "单次最多加入 100 篇论文翻译队列。");
  const stored = await readJson<Record<string, PaperTranslationJob>>(JOBS_PATH, {});
  const activePaperIds = new Set(Object.values(stored)
    .filter((job) => ["queued", "running", "paused"].includes(job.status))
    .map((job) => job.paperId));
  const jobs: PaperTranslationJob[] = [];
  for (const paperId of uniqueIds) {
    if (activePaperIds.has(paperId)) continue;
    const paper = await getPaper(paperId);
    const job: PaperTranslationJob = {
      id: randomUUID(),
      paperId,
      paperTitle: paper.title,
      tier,
      scope,
      concurrency: resolveConcurrency(tier, input.concurrency, preferences.translationConcurrency),
      status: "queued",
      total: 0,
      completed: 0,
      failed: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      generateGuide: input.generateGuide !== false,
    };
    stored[job.id] = job;
    activePaperIds.add(paperId);
    jobs.push(job);
  }
  const entries = Object.entries(stored).sort((a, b) => b[1].updatedAt.localeCompare(a[1].updatedAt)).slice(0, 200);
  await writeJson(JOBS_PATH, Object.fromEntries(entries));
  jobs.forEach((job) => schedule(job.id));
  return { jobs };
}

export async function listTranslationJobs(): Promise<{ jobs: PaperTranslationJob[] }> {
  const jobs = await readJson<Record<string, PaperTranslationJob>>(JOBS_PATH, {});
  return { jobs: Object.values(jobs).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 100) };
}

export async function controlTranslationJob(jobId: string, action: "pause" | "resume" | "cancel"): Promise<PaperTranslationJob> {
  const job = await currentJob(jobId);
  if (!job) throw new Error("Translation job was not found.");
  if (action === "pause" && ["queued", "running"].includes(job.status)) return updateJob(jobId, { status: "paused" });
  if (action === "cancel" && !["completed", "failed", "cancelled"].includes(job.status)) return updateJob(jobId, { status: "cancelled" });
  if (action === "resume" && ["paused", "failed"].includes(job.status)) {
    const next = await updateJob(jobId, { status: "queued", error: undefined });
    schedule(jobId);
    return next;
  }
  return job;
}

export async function getPaperTranslations(paperId: string): Promise<{ paperId: string; segments: Record<string, PaperTranslationSegment>; updatedAt?: string }> {
  const translations = await readJson<Record<string, StoredTranslationDocument>>(TRANSLATIONS_PATH, {});
  const document = translations[paperId];
  if (!document) return { paperId, segments: {} };
  const [config, preferences] = await Promise.all([getApiAgentPublicConfig(), getAppPreferences()]);
  const promptFingerprint = hash(preferences.translationPrompt);
  const segments = Object.fromEntries(Object.entries(document.segments).filter(([, segment]) => segment.model === config.model && segment.promptFingerprint === promptFingerprint));
  return { paperId, segments, updatedAt: document.updatedAt };
}
