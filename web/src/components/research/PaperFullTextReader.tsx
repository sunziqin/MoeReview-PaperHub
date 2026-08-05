import { BookOpenText, ExternalLink, FileText, Languages, WandSparkles } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { translateSegment, type TranslationResult } from "../../services/apiAgent";
import {
  extractPaper,
  createTranslationJobs,
  loadPaperDetail,
  loadPaperTranslations,
  loadTranslationJobs,
  paperPdfUrl,
  updateLibrary,
  type AppPreferences,
  type PaperDocument,
  type PaperReadingGuide,
  type PaperRecord,
  type PaperSection,
  type PaperTranslationSegment,
} from "../../services/paperWorkspace";

type ReadingMode = AppPreferences["readingLanguage"];

interface Props {
  paper: PaperRecord;
  paperId: string;
  defaultMode: ReadingMode;
  initialGuide?: PaperReadingGuide;
  translationTier: AppPreferences["translationTier"];
  translationConcurrency: number;
}

function translationChunks(text: string): string[] {
  const chunks: string[] = [];
  let remaining = text.trim();
  while (remaining.length > 10_000) {
    const paragraphBreak = remaining.lastIndexOf("\n\n", 10_000);
    const sentenceBreak = remaining.lastIndexOf(". ", 10_000);
    const splitAt = Math.max(paragraphBreak, sentenceBreak, 6_000);
    chunks.push(remaining.slice(0, splitAt + (splitAt === sentenceBreak ? 1 : 0)).trim());
    remaining = remaining.slice(splitAt + (splitAt === sentenceBreak ? 1 : 0)).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

function mergeTranslationParts(parts: TranslationResult[]): TranslationResult {
  const last = parts[parts.length - 1];
  return {
    ...last,
    sourceText: parts.map((part) => part.sourceText).join("\n\n"),
    translatedText: parts.map((part) => part.translatedText).join("\n\n"),
    termsUsed: Array.from(new Map(parts.flatMap((part) => part.termsUsed).map((term) => [term.english.toLowerCase(), term])).values()),
    warnings: Array.from(new Set(parts.flatMap((part) => part.warnings))),
  };
}

function cachedTranslation(segment: PaperTranslationSegment): TranslationResult {
  return {
    ok: true,
    paperId: segment.paperId,
    sourceSegmentId: segment.sectionId,
    sourceText: segment.sourceText,
    translatedText: segment.translatedText,
    termsUsed: segment.termsUsed,
    warnings: segment.warnings,
    modelNote: "cached-job",
    glossary: segment.termsUsed,
    cached: true,
  };
}

function ReadingGuide({ guide }: { guide: PaperReadingGuide }) {
  return <div className="paper-reading-guide">
    <header><span>DEEP READING GUIDE</span><h3>大白话深度导读</h3><small>AI 生成内容，请结合原版 PDF 核对图表、数字和结论。</small></header>
    <p className="reading-guide-overview">{guide.overview}</p>
    <section><h4>一句一句讲明白</h4><p>{guide.plainLanguageExplanation}</p></section>
    <div className="reading-guide-grid">
      <section><h4>为什么要研究</h4><p>{guide.researchBackground}</p></section>
      <section><h4>真正要解决的问题</h4><p>{guide.researchQuestion}</p></section>
      <section><h4>实验怎么做</h4><p>{guide.experiments}</p></section>
      <section><h4>局限和注意事项</h4><p>{guide.limitations}</p></section>
    </div>
    <section><h4>方法步骤</h4><ol>{guide.methodSteps.map((item) => <li key={item}>{item}</li>)}</ol></section>
    <section><h4>关键发现</h4><ul>{guide.keyFindings.map((item) => <li key={item}>{item}</li>)}</ul></section>
    {guide.terms.length > 0 && <section><h4>关键术语</h4><div className="reading-guide-terms">{guide.terms.map((term) => <span key={term.english}>{term.chinese}（{term.english}）</span>)}</div></section>}
    {guide.readingTips.length > 0 && <section><h4>接下来重点看什么</h4><ul>{guide.readingTips.map((item) => <li key={item}>{item}</li>)}</ul></section>}
    {guide.warnings.length > 0 && <div className="reading-guide-warnings">{guide.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div>}
  </div>;
}

export function PaperFullTextReader({ paper, paperId, defaultMode, initialGuide, translationTier, translationConcurrency }: Props) {
  const [view, setView] = useState<"pdf" | "text">("text");
  const [document, setDocument] = useState<PaperDocument>();
  const [translations, setTranslations] = useState<Record<string, TranslationResult>>({});
  const [guide, setGuide] = useState<PaperReadingGuide | undefined>(initialGuide);
  const [glossary, setGlossary] = useState<Array<{ chinese: string; english: string }>>([]);
  const [mode, setMode] = useState<ReadingMode>(defaultMode);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState("");

  useEffect(() => {
    void Promise.all([
      initialGuide ? Promise.resolve(undefined) : loadPaperDetail(paperId).then((detail) => detail.readingGuide),
      loadPaperTranslations(paperId),
    ]).then(([loadedGuide, translationDocument]) => {
      if (loadedGuide) setGuide(loadedGuide);
      const loadedSegments = Object.entries(translationDocument.segments);
      setTranslations(Object.fromEntries(loadedSegments.map(([sectionId, segment]) => [sectionId, cachedTranslation(segment)])));
      setGlossary(Array.from(new Map(loadedSegments.flatMap(([, segment]) => segment.termsUsed).map((term) => [term.english.toLowerCase(), term])).values()));
    }).catch(() => undefined);
  }, [initialGuide, paperId]);

  const ensureDocument = useCallback(async (): Promise<PaperDocument> => {
    if (document) return document;
    const extracted = await extractPaper(paper);
    setDocument(extracted);
    return extracted;
  }, [document, paper]);

  useEffect(() => {
    if (!paper.pdfUrl) return;
    let disposed = false;
    const timer = window.setTimeout(() => {
      void ensureDocument().then(() => {
        if (!disposed) setView("text");
      }).catch(() => undefined);
    }, 140);
    return () => { disposed = true; window.clearTimeout(timer); };
  }, [ensureDocument, paper.pdfUrl]);

  const translateSection = async (section: PaperSection, currentGlossary = glossary): Promise<TranslationResult> => {
    const parts: TranslationResult[] = [];
    let nextGlossary = currentGlossary;
    const chunks = translationChunks(section.text);
    for (let index = 0; index < chunks.length; index += 1) {
      const part = await translateSegment({
        paperId,
        paperTitle: paper.title,
        sourceSegmentId: chunks.length === 1 ? section.id : `${section.id}-part-${index + 1}`,
        sourceText: chunks[index],
        keywords: paper.keywords,
        glossary: nextGlossary,
      });
      parts.push(part);
      nextGlossary = part.glossary;
    }
    setGlossary(nextGlossary);
    return mergeTranslationParts(parts);
  };

  const translateOne = async (section: PaperSection) => {
    if (translations[section.id]) {
      setMode("bilingual");
      setView("text");
      return;
    }
    setBusy(`section:${section.id}`);
    try {
      const result = await translateSection(section);
      setTranslations((old) => ({ ...old, [section.id]: result }));
      setMode("bilingual");
      setView("text");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "章节翻译失败");
    } finally {
      setBusy(null);
    }
  };

  const extract = async () => {
    setBusy("extract");
    try {
      await ensureDocument();
      setView("text");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "PDF 提取失败");
    } finally {
      setBusy(null);
    }
  };

  const translateAndSummarize = async () => {
    setBusy("all");
    setProgress("正在加入翻译队列");
    try {
      await ensureDocument();
      const created = await createTranslationJobs({ paperId, scope: "current", tier: translationTier, concurrency: translationConcurrency, generateGuide: true });
      const jobId = created[0]?.id;
      if (!jobId) throw new Error("翻译任务创建失败。");
      let latest = created[0];
      while (["queued", "running"].includes(latest.status)) {
        await new Promise((resolve) => window.setTimeout(resolve, 900));
        const jobs = await loadTranslationJobs();
        latest = jobs.find((job) => job.id === jobId) ?? latest;
        setProgress(latest.total ? `正在翻译 ${latest.completed}/${latest.total} 个章节` : "正在提取 PDF 正文");
      }
      const translationDocument = await loadPaperTranslations(paperId);
      setTranslations(Object.fromEntries(Object.entries(translationDocument.segments).map(([sectionId, segment]) => [sectionId, cachedTranslation(segment)])));
      const detail = await loadPaperDetail(paperId);
      setGuide(detail.readingGuide);
      setMode("chinese");
      setView("text");
      toast.success(latest.failed ? `处理完成，${latest.failed} 个章节翻译失败，可单独重试` : "全文翻译和深度导读已完成");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "全文翻译和总结失败");
    } finally {
      setBusy(null);
      setProgress("");
    }
  };

  return <section className="detail-section full-text-reader">
      <div className="section-title full-text-title">
       <div><span>FULL TEXT READING</span><h2>中文正文阅读</h2><p className="full-text-subtitle">先看中文理解内容，需要核对图表、公式和版式时切回原版 PDF。</p></div>
      <div className="full-text-actions">
        <button className="primary" onClick={() => void translateAndSummarize()} disabled={!paper.pdfUrl || busy !== null}><WandSparkles size={16} />{busy === "all" ? progress || "处理中" : Object.keys(translations).length > 0 ? "已缓存 · 检查更新" : "一键翻译并总结"}</button>
        {!document && <button onClick={() => void extract()} disabled={!paper.pdfUrl || busy !== null}><BookOpenText size={16} />{busy === "extract" ? "提取中" : "提取文本"}</button>}
      </div>
    </div>
    <div className="full-text-view-tabs">
      <button className={view === "pdf" ? "active" : ""} onClick={() => setView("pdf")} disabled={!paper.pdfUrl}><FileText size={15} />原版 PDF</button>
       <button className={view === "text" ? "active" : ""} onClick={() => document ? setView("text") : void extract()}><Languages size={15} />中文阅读</button>
    </div>
    {view === "pdf" && paper.pdfUrl && <div className="native-pdf-reader">
        <div><span>中文正文适合连续阅读；图片、表格、公式和统计图请以原版 PDF 为准。{document?.cachedPdf ? " PDF 已缓存到本机。" : "首次打开后会缓存到本机。"}</span><a href={paperPdfUrl(paper.id)} target="_blank" rel="noreferrer"><ExternalLink size={15} />新窗口打开</a></div>
      <iframe src={`${paperPdfUrl(paper.id)}#view=FitH`} title={`${paper.title} PDF`} loading="lazy" />
    </div>}
     {view === "text" && !document && <p className="detail-placeholder">正在准备中文正文；也可以点击“一键翻译并总结”开始处理。扫描件和加密 PDF 暂不支持 OCR。</p>}
    {view === "text" && document && <>
      {guide && <ReadingGuide guide={guide} />}
      <div className="reading-mode-tabs full-text-modes"><button className={mode === "source" ? "active" : ""} onClick={() => setMode("source")}>原文</button><button className={mode === "chinese" ? "active" : ""} onClick={() => setMode("chinese")}>中文</button><button className={mode === "bilingual" ? "active" : ""} onClick={() => setMode("bilingual")}>双语</button></div>
      <div className="detail-document">
        <nav>{document.sections.map((section) => <button type="button" key={section.id} onClick={() => { globalThis.document.getElementById(section.id)?.scrollIntoView({ behavior: "smooth" }); void updateLibrary(paperId, { lastSectionId: section.id }); }}>{section.title}</button>)}</nav>
        <div>{document.sections.map((section) => {
          const translated = translations[section.id];
          return <section id={section.id} key={section.id} className="translated-paper-section">
            <header><h3>{section.title}</h3><button onClick={() => void translateOne(section)} disabled={busy !== null}><Languages size={14} />{busy === `section:${section.id}` ? "翻译中" : translated ? "已缓存" : "翻译本节"}</button></header>
            {(mode === "source" || mode === "bilingual") && <p className="paper-section-source">{section.text}</p>}
            {(mode === "chinese" || mode === "bilingual") && <div className="paper-section-translation">{translated ? <><p>{translated.translatedText}</p>{translated.warnings.length > 0 && <small>{translated.warnings.join("；")}</small>}</> : <p className="translation-missing">本节尚未翻译。</p>}</div>}
          </section>;
        })}</div>
      </div>
    </>}
  </section>;
}
