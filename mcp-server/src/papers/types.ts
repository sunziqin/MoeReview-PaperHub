export type PaperSource = "arxiv" | "semantic-scholar" | "crossref" | "openalex" | "manual";

export interface PaperRecord {
  id: string;
  source: PaperSource;
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

export interface PaperSearchResult {
  ok: true;
  query: string;
  results: PaperRecord[];
  diagnostics: Array<{ provider: string; ok: boolean; count?: number; error?: string }>;
}

export interface PaperSection {
  id: string;
  title: string;
  text: string;
  pageStart?: number;
  pageEnd?: number;
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

export type PaperInteractionType = "impression" | "open" | "summary" | "favorite" | "read-later" | "dismiss" | "learn" | "dwell";

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
  sourceFingerprint: string;
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
  sourceFingerprint: string;
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

export interface PaperInteraction {
  id: string;
  paperId: string;
  type: PaperInteractionType;
  timestamp: string;
  dwellMs?: number;
  metadata?: Record<string, unknown>;
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

export type TranslationJobStatus = "queued" | "running" | "paused" | "completed" | "cancelled" | "failed";

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
  status: TranslationJobStatus;
  total: number;
  completed: number;
  failed: number;
  createdAt: string;
  updatedAt: string;
  error?: string;
  generateGuide?: boolean;
}
