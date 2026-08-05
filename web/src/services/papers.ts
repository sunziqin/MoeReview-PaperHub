const HUB_ORIGIN = "http://localhost:3456";

export interface PaperRecord {
  id: string;
  source: "arxiv" | "semantic-scholar" | "crossref" | "openalex" | "manual";
  title: string;
  authors: string[];
  year?: number;
  venue?: string;
  abstract?: string;
  doi?: string;
  arxivId?: string;
  url?: string;
  pdfUrl?: string;
  keywords?: string[];
  sourceConfidence: "metadata" | "abstract" | "pdf" | "manual";
  fetchedAt: string;
}

export interface PaperSearchResponse {
  ok: true;
  query: string;
  results: PaperRecord[];
  diagnostics: Array<{ provider: string; ok: boolean; count?: number; error?: string }>;
}

export interface PaperSection {
  id: string;
  title: string;
  text: string;
  charStart: number;
  charEnd: number;
}

export interface PaperDocument {
  paperId: string;
  title: string;
  pdfUrl: string;
  sourceFingerprint?: string;
  cachedPdf?: boolean;
  pageCount?: number;
  textLength: number;
  truncated: boolean;
  sections: PaperSection[];
  extractedAt: string;
}

export async function searchPapers(query: string, limit = 8): Promise<PaperSearchResponse> {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  const response = await fetch(`${HUB_ORIGIN}/api/papers/search?${params.toString()}`, { cache: "no-store" });
  const data = await response.json().catch(() => ({})) as Partial<PaperSearchResponse> & { error?: string };
  if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
  return data as PaperSearchResponse;
}

export async function createSession(title: string): Promise<{ id: string; title: string }> {
  const response = await fetch(`${HUB_ORIGIN}/api/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  const data = await response.json().catch(() => ({})) as { session?: { id: string; title: string }; error?: string };
  if (!response.ok || !data.session) throw new Error(data.error ?? `HTTP ${response.status}`);
  return data.session;
}

export async function savePaperPage(sessionId: string, paper: PaperRecord): Promise<void> {
  const response = await fetch(`${HUB_ORIGIN}/api/papers/session-page`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, paper }),
  });
  const data = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
}

async function postPaper<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${HUB_ORIGIN}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
  return data;
}

export async function extractPaper(paper: PaperRecord): Promise<PaperDocument> {
  const data = await postPaper<{ document: PaperDocument }>("/api/papers/extract", { paper });
  return data.document;
}

export async function askPaper(input: {
  paper: PaperRecord;
  question: string;
  passage: string;
  segmentId: string;
  sectionTitle: string;
}): Promise<string> {
  const data = await postPaper<{ answer: string }>("/api/papers/ask", input);
  return data.answer;
}

export async function savePaperAnswer(input: {
  sessionId: string;
  paper: PaperRecord;
  question: string;
  answer: string;
  passage: string;
  segmentId: string;
  sectionTitle: string;
}): Promise<void> {
  await postPaper("/api/papers/answer-page", input);
}
