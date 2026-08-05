import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { lookup } from "node:dns/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { isIP } from "node:net";
import { PDFParse } from "pdf-parse";
import type { PaperDocument, PaperRecord, PaperSection } from "./types.js";

const MAX_PDF_BYTES = 25 * 1024 * 1024;
const MAX_TEXT_CHARS = 500_000;
const FETCH_TIMEOUT_MS = 60_000;
const PAPER_ROOT = join(homedir(), ".examforge", "papers");
const DOCUMENTS_PATH = join(PAPER_ROOT, "documents.json");
const PDF_CACHE_ROOT = join(PAPER_ROOT, "pdf-cache");

interface StoredPaperDocument {
  document: PaperDocument;
  sourceFingerprint: string;
  pdfPath?: string;
  pdfFingerprint?: string;
  cachedAt: string;
}

let documentWriteQueue: Promise<void> = Promise.resolve();
const inFlightExtractions = new Map<string, Promise<{ ok: true; document: PaperDocument }>>();

function isPrivateIp(address: string): boolean {
  const normalized = address.replace(/^::ffff:/, "");
  if (normalized === "::1" || normalized === "0.0.0.0") return true;
  if (isIP(normalized) === 4) {
    const [a, b] = normalized.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  return normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:");
}

async function assertPublicPdfUrl(rawUrl: string): Promise<URL> {
  const url = new URL(rawUrl);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("PDF URL must use HTTP or HTTPS.");
  if (url.username || url.password) throw new Error("PDF URL must not contain credentials.");
  const addresses = await lookup(url.hostname, { all: true });
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateIp(address))) {
    throw new Error("PDF URL resolves to a private or unavailable address.");
  }
  return url;
}

function normalizePdfText(value: string): string {
  return value
    .replace(/\r/g, "")
    .replace(/([A-Za-z])-\n([a-z])/g, "$1$2")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function looksLikeHeading(line: string): boolean {
  const text = line.trim();
  if (text.length < 3 || text.length > 120) return false;
  if (/^(abstract|introduction|background|related work|method(?:ology)?|approach|experiments?|results?|discussion|limitations?|conclusion|references|acknowledg(?:e)?ments?)$/i.test(text)) return true;
  if (/^\d+(?:\.\d+)*\s+[A-Z][^.!?]{2,100}$/.test(text)) return true;
  return /^[A-Z][A-Z\s:&-]{4,80}$/.test(text) && /[A-Z]/.test(text);
}

function splitSections(text: string): PaperSection[] {
  const lines = text.split("\n");
  const sections: PaperSection[] = [];
  let title = "Document";
  let buffer: string[] = [];
  let cursor = 0;

  const flush = () => {
    const sectionText = buffer.join("\n").trim();
    if (!sectionText) return;
    const charStart = text.indexOf(sectionText, cursor);
    const safeStart = charStart >= 0 ? charStart : cursor;
    sections.push({
      id: `section-${sections.length + 1}`,
      title,
      text: sectionText,
      charStart: safeStart,
      charEnd: safeStart + sectionText.length,
    });
    cursor = safeStart + sectionText.length;
  };

  for (const line of lines) {
    if (looksLikeHeading(line) && buffer.join(" ").trim().length >= 300) {
      flush();
      title = line.trim();
      buffer = [];
    } else {
      buffer.push(line);
    }
  }
  flush();

  if (sections.length === 1 && sections[0].text.length > 12_000) {
    const chunks: PaperSection[] = [];
    for (let start = 0; start < text.length; start += 8_000) {
      const end = Math.min(start + 8_000, text.length);
      chunks.push({ id: `section-${chunks.length + 1}`, title: `Part ${chunks.length + 1}`, text: text.slice(start, end), charStart: start, charEnd: end });
    }
    return chunks;
  }
  return sections.slice(0, 80);
}

function isPaperRecord(value: unknown): value is PaperRecord {
  if (!value || typeof value !== "object") return false;
  const paper = value as Partial<PaperRecord>;
  return typeof paper.id === "string" && typeof paper.title === "string" && typeof paper.pdfUrl === "string";
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sourceFingerprint(paper: PaperRecord): string {
  return hash(`${paper.id}\n${paper.title}\n${paper.abstract ?? ""}\n${paper.pdfUrl ?? ""}`);
}

async function readDocumentCache(): Promise<Record<string, StoredPaperDocument>> {
  try {
    return JSON.parse(await fs.readFile(DOCUMENTS_PATH, "utf-8")) as Record<string, StoredPaperDocument>;
  } catch {
    return {};
  }
}

async function saveDocumentCache(paperId: string, entry: StoredPaperDocument): Promise<void> {
  const write = documentWriteQueue.then(async () => {
    const cache = await readDocumentCache();
    cache[paperId] = entry;
    await fs.mkdir(PAPER_ROOT, { recursive: true });
    const temporaryPath = `${DOCUMENTS_PATH}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temporaryPath, JSON.stringify(cache, null, 2), "utf-8");
    await fs.rename(temporaryPath, DOCUMENTS_PATH);
  });
  documentWriteQueue = write.catch(() => { });
  await write;
}

async function fileExists(path: string | undefined): Promise<boolean> {
  if (!path) return false;
  try { await fs.access(path); return true; } catch { return false; }
}

export async function readCachedPaperPdf(paperId: string, expectedPdfUrl?: string): Promise<Buffer | undefined> {
  const entry = (await readDocumentCache())[paperId];
  if (expectedPdfUrl && entry?.document.pdfUrl !== expectedPdfUrl) return undefined;
  if (!(await fileExists(entry?.pdfPath))) return undefined;
  return fs.readFile(entry!.pdfPath!);
}

async function extractPaperPdfFromNetwork(paper: PaperRecord, fingerprint: string): Promise<{ ok: true; document: PaperDocument }> {
  let url = await assertPublicPdfUrl(paper.pdfUrl!);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    let response: Response | undefined;
    for (let redirects = 0; redirects <= 3; redirects += 1) {
      response = await fetch(url, { signal: controller.signal, redirect: "manual", headers: { "User-Agent": "MoeReview/0.1" } });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get("location");
      if (!location) throw new Error("PDF redirect did not include a destination.");
      if (redirects === 3) throw new Error("PDF request exceeded the redirect limit.");
      url = await assertPublicPdfUrl(new URL(location, url).toString());
    }
    if (!response) throw new Error("PDF request did not return a response.");
    if (!response.ok) throw new Error(`PDF request failed: HTTP ${response.status}`);
    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (contentLength > MAX_PDF_BYTES) throw new Error("PDF is larger than the 25 MB limit.");
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType && !contentType.includes("pdf") && !contentType.includes("octet-stream")) throw new Error(`Unexpected PDF content type: ${contentType}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_PDF_BYTES) throw new Error("PDF is larger than the 25 MB limit.");
    if (buffer.subarray(0, 5).toString("ascii") !== "%PDF-") throw new Error("Downloaded file is not a PDF.");

    const pdfFingerprint = hash(buffer.toString("base64"));
    const pdfPath = join(PDF_CACHE_ROOT, `${hash(paper.id)}-${pdfFingerprint.slice(0, 24)}.pdf`);
    await fs.mkdir(PDF_CACHE_ROOT, { recursive: true });
    if (!(await fileExists(pdfPath))) await fs.writeFile(pdfPath, buffer);

    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    const parsed = await parser.getText().finally(() => parser.destroy());
    const fullText = normalizePdfText(parsed.text ?? "");
    if (!fullText) throw new Error("The PDF contains no extractable text; it may be scanned or encrypted.");
    const truncated = fullText.length > MAX_TEXT_CHARS;
    const text = fullText.slice(0, MAX_TEXT_CHARS);
    const document: PaperDocument = {
      paperId: paper.id,
      title: paper.title,
      pdfUrl: paper.pdfUrl!,
      sourceFingerprint: fingerprint,
      cachedPdf: true,
      pageCount: parsed.total,
      textLength: fullText.length,
      truncated,
      sections: splitSections(text),
      extractedAt: new Date().toISOString(),
    };
    await saveDocumentCache(paper.id, { document, sourceFingerprint: fingerprint, pdfPath, pdfFingerprint, cachedAt: new Date().toISOString() });
    return { ok: true, document };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("PDF download timed out after 60 seconds. Open the original PDF or retry later.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function extractPaperPdf(input: Record<string, unknown>): Promise<{ ok: true; document: PaperDocument }> {
  if (!isPaperRecord(input.paper)) throw new Error("paper with pdfUrl is required.");
  const paper = input.paper;
  const fingerprint = sourceFingerprint(paper);
  const cached = (await readDocumentCache())[paper.id];
  if (cached?.sourceFingerprint === fingerprint) {
    return { ok: true, document: { ...cached.document, sourceFingerprint: fingerprint, cachedPdf: await fileExists(cached.pdfPath) } };
  }
  if (cached?.document.pdfUrl === paper.pdfUrl && await fileExists(cached.pdfPath)) {
    return {
      ok: true,
      document: {
        ...cached.document,
        title: paper.title,
        pdfUrl: paper.pdfUrl,
        sourceFingerprint: fingerprint,
        cachedPdf: true,
      },
    };
  }

  const running = inFlightExtractions.get(paper.id);
  if (running) return running;
  const request = extractPaperPdfFromNetwork(paper, fingerprint);
  inFlightExtractions.set(paper.id, request);
  try {
    return await request;
  } finally {
    if (inFlightExtractions.get(paper.id) === request) inFlightExtractions.delete(paper.id);
  }
}
