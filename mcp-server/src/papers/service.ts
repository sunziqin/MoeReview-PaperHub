import type { PaperRecord, PaperSearchResult } from "./types.js";
import { appendLearningPage } from "../state/persistence.js";
import { callApiAgent, type ApiAgentMessage, type ApiAgentPaperContext } from "../services/apiAgent.js";

const DEFAULT_TIMEOUT_MS = 12_000;

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function firstTag(xml: string, tag: string): string | undefined {
  const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i"));
  return match ? decodeXml(match[1]) : undefined;
}

function allTags(xml: string, tag: string): string[] {
  return Array.from(xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "gi")))
    .map((match) => decodeXml(match[1]))
    .filter(Boolean);
}

async function fetchText(url: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { "User-Agent": "MoeReview/0.1" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson<T>(url: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { "User-Agent": "MoeReview/0.1" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json() as T;
  } finally {
    clearTimeout(timer);
  }
}

function yearFromDate(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const year = Number(value.slice(0, 4));
  return Number.isFinite(year) ? year : undefined;
}

function arxivIdFromUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = value.match(/abs\/([^/?#]+)/);
  return match?.[1];
}

async function searchArxiv(query: string, limit: number, offset: number, newest: boolean): Promise<PaperRecord[]> {
  const url =
    `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}` +
    `&start=${encodeURIComponent(String(offset))}&max_results=${encodeURIComponent(String(limit))}` +
    (newest ? "&sortBy=submittedDate&sortOrder=descending" : "");
  const xml = await fetchText(url);
  const entries = Array.from(xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)).map((match) => match[1]);
  const fetchedAt = new Date().toISOString();
  return entries.flatMap((entry): PaperRecord[] => {
    const title = firstTag(entry, "title");
    const abstract = firstTag(entry, "summary");
    const link = firstTag(entry, "id");
    if (!title || !link) return [];
    const arxivId = arxivIdFromUrl(link);
    const authors = Array.from(entry.matchAll(/<author>([\s\S]*?)<\/author>/gi))
      .map((match) => firstTag(match[1], "name"))
      .filter((name): name is string => Boolean(name));
    return [{
      id: arxivId ? `arxiv:${arxivId}` : `arxiv:${link}`,
      source: "arxiv",
      title,
      authors,
      year: yearFromDate(firstTag(entry, "published")),
      abstract,
      arxivId,
      url: link,
      pdfUrl: arxivId ? `https://arxiv.org/pdf/${arxivId}` : undefined,
      sourceConfidence: abstract ? "abstract" : "metadata",
      fetchedAt,
    }];
  });
}

interface SemanticScholarResponse {
  data?: Array<{
    paperId?: string;
    title?: string;
    abstract?: string;
    year?: number;
    venue?: string;
    url?: string;
    authors?: Array<{ name?: string }>;
    externalIds?: { DOI?: string; ArXiv?: string };
    openAccessPdf?: { url?: string };
  }>;
}

async function searchSemanticScholar(query: string, limit: number, offset: number): Promise<PaperRecord[]> {
  const fields = "title,authors,year,venue,abstract,url,externalIds,openAccessPdf";
  const url =
    "https://api.semanticscholar.org/graph/v1/paper/search" +
    `?query=${encodeURIComponent(query)}&limit=${encodeURIComponent(String(limit))}&offset=${encodeURIComponent(String(offset))}&fields=${encodeURIComponent(fields)}`;
  const data = await fetchJson<SemanticScholarResponse>(url);
  const fetchedAt = new Date().toISOString();
  return (data.data ?? []).flatMap((item): PaperRecord[] => {
    if (!item.title || !item.paperId) return [];
    return [{
      id: `semantic-scholar:${item.paperId}`,
      source: "semantic-scholar",
      title: item.title.trim(),
      authors: (item.authors ?? []).map((author) => author.name ?? "").filter(Boolean),
      year: item.year,
      venue: item.venue,
      abstract: item.abstract,
      doi: item.externalIds?.DOI,
      arxivId: item.externalIds?.ArXiv,
      url: item.url,
      pdfUrl: item.openAccessPdf?.url,
      sourceConfidence: item.abstract ? "abstract" : "metadata",
      fetchedAt,
    }];
  });
}

function dedupe(records: PaperRecord[]): PaperRecord[] {
  const seen = new Map<string, PaperRecord>();
  for (const record of records) {
    const key = (record.doi && `doi:${record.doi.toLowerCase()}`) ||
      (record.arxivId && `arxiv:${record.arxivId.toLowerCase()}`) ||
      `title:${record.title.toLowerCase().replace(/\W+/g, " ").trim()}`;
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, record);
      continue;
    }
    seen.set(key, {
      ...existing,
      authors: existing.authors.length >= record.authors.length ? existing.authors : record.authors,
      abstract: existing.abstract ?? record.abstract,
      doi: existing.doi ?? record.doi,
      arxivId: existing.arxivId ?? record.arxivId,
      pdfUrl: existing.pdfUrl ?? record.pdfUrl,
      venue: existing.venue ?? record.venue,
      url: existing.url ?? record.url,
      sourceConfidence: existing.sourceConfidence === "pdf" || record.pdfUrl ? "pdf" : existing.sourceConfidence,
    });
  }
  return Array.from(seen.values());
}

export async function searchPapers(input: Record<string, unknown>): Promise<PaperSearchResult> {
  const query = typeof input.query === "string" ? input.query.trim() : "";
  if (!query) throw new Error("query is required.");
  const limitInput = typeof input.limit === "number" ? input.limit : Number(input.limit ?? 8);
  const limit = Math.min(Math.max(Number.isFinite(limitInput) ? Math.floor(limitInput) : 8, 1), 20);
  const offsetInput = typeof input.offset === "number" ? input.offset : Number(input.offset ?? 0);
  const offset = Math.min(Math.max(Number.isFinite(offsetInput) ? Math.floor(offsetInput) : 0, 0), 1000);
  const requestedProviders = Array.isArray(input.providers) ? input.providers.map(String) : ["arxiv", "semantic-scholar"];
  const newest = input.sort === "newest";

  const providers = [
    { name: "arxiv", run: () => searchArxiv(query, limit, offset, newest) },
    { name: "semantic-scholar", run: () => searchSemanticScholar(query, limit, offset) },
  ].filter((provider) => requestedProviders.includes(provider.name));
  const settled = await Promise.allSettled(providers.map((provider) => provider.run()));
  const diagnostics: PaperSearchResult["diagnostics"] = [];
  const records: PaperRecord[] = [];

  settled.forEach((result, index) => {
    const provider = providers[index];
    if (result.status === "fulfilled") {
      diagnostics.push({ provider: provider.name, ok: true, count: result.value.length });
      records.push(...result.value);
    } else {
      diagnostics.push({
        provider: provider.name,
        ok: false,
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      });
    }
  });

  return { ok: true, query, results: dedupe(records).slice(0, limit), diagnostics };
}

function paperMarkdown(paper: PaperRecord): string {
  const authors = paper.authors.length ? paper.authors.join(", ") : "Unknown authors";
  const links = [
    paper.url ? `- Source: ${paper.url}` : "",
    paper.pdfUrl ? `- PDF: ${paper.pdfUrl}` : "",
    paper.doi ? `- DOI: ${paper.doi}` : "",
    paper.arxivId ? `- arXiv: ${paper.arxivId}` : "",
  ].filter(Boolean).join("\n");
  return [
    `# ${paper.title}`,
    "",
    `- Authors: ${authors}`,
    paper.year ? `- Year: ${paper.year}` : "",
    paper.venue ? `- Venue: ${paper.venue}` : "",
    `- Provider: ${paper.source}`,
    links,
    "",
    "## Abstract",
    "",
    paper.abstract?.trim() || "No abstract was available from the selected provider.",
    "",
    "## Reading Notes",
    "",
    "- Add questions, translated passages, and key terms here as you read.",
  ].filter((line) => line !== "").join("\n");
}

function isPaperRecord(value: unknown): value is PaperRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<PaperRecord>;
  return typeof record.id === "string" && typeof record.title === "string" && typeof record.source === "string";
}

export async function createPaperSessionPage(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const paper = input.paper;
  if (!isPaperRecord(paper)) throw new Error("paper is required.");
  const page = await appendLearningPage({
    id: `page_paper_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    title: paper.title,
    summary: [
      paper.year ? String(paper.year) : "",
      paper.venue,
      paper.abstract?.replace(/\s+/g, " ").slice(0, 120),
    ].filter(Boolean).join(" · ") || "Paper metadata page",
    kind: "mixed",
    content: paperMarkdown(paper),
    createdAt: new Date().toISOString(),
    source: "user",
    status: "published",
    revision: 1,
  });
  return { ok: true, page };
}

function paperContextFromInput(input: Record<string, unknown>): ApiAgentPaperContext {
  const paper = input.paper;
  if (!isPaperRecord(paper)) throw new Error("paper is required.");
  const passage = typeof input.passage === "string" ? input.passage.trim() : "";
  if (!passage) throw new Error("passage is required.");
  if (passage.length > 20_000) throw new Error("passage is too long; select a smaller section.");
  return {
    paperId: paper.id,
    title: paper.title,
    source: paper.source,
    url: paper.url ?? paper.pdfUrl,
    doi: paper.doi,
    arxivId: paper.arxivId,
    segmentId: typeof input.segmentId === "string" ? input.segmentId.trim() : undefined,
    sectionTitle: typeof input.sectionTitle === "string" ? input.sectionTitle.trim() : undefined,
    passage,
    maxChars: 20_000,
  };
}

function contextText(context: ApiAgentPaperContext): string {
  return [
    `Paper ID: ${context.paperId}`,
    `Title: ${context.title}`,
    `Provider: ${context.source}`,
    context.url ? `URL: ${context.url}` : "",
    context.doi ? `DOI: ${context.doi}` : "",
    context.arxivId ? `arXiv: ${context.arxivId}` : "",
    context.segmentId ? `Segment: ${context.segmentId}` : "",
    context.sectionTitle ? `Section: ${context.sectionTitle}` : "",
    "",
    "Selected source passage:",
    context.passage ?? "",
  ].filter((line) => line !== "").join("\n");
}

export async function answerPaperQuestion(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const question = typeof input.question === "string" ? input.question.trim() : "";
  if (!question) throw new Error("question is required.");
  const context = paperContextFromInput(input);
  const messages: ApiAgentMessage[] = [{
    role: "user",
    content: [
      "Answer the question in Simplified Chinese using the selected paper passage as the primary source.",
      "Separate direct paper claims from your interpretation. Preserve important technical terms as 中文术语（English keyword）.",
      "End with a short source line naming the paper and segment. If the passage is insufficient, say so explicitly.",
      `Question: ${question}`,
      contextText(context),
    ].join("\n\n"),
  }];
  return { ok: true, answer: await callApiAgent(messages), context };
}

export async function createPaperAnswerPage(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const answer = typeof input.answer === "string" ? input.answer.trim() : "";
  const question = typeof input.question === "string" ? input.question.trim() : "";
  if (!answer || !question) throw new Error("question and answer are required.");
  const context = paperContextFromInput(input);
  const page = await appendLearningPage({
    id: `page_paper_answer_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    title: `${context.title ?? "论文"}：${question.slice(0, 50)}`,
    summary: answer.replace(/\s+/g, " ").slice(0, 160),
    kind: "mixed",
    content: [
      `# ${question}`,
      "",
      answer,
      "",
      "## 来源片段",
      "",
      contextText(context),
    ].join("\n"),
    createdAt: new Date().toISOString(),
    source: "agent",
    status: "published",
    revision: 1,
  });
  return { ok: true, page };
}
