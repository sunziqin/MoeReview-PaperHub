import {
  BookOpenText,
  ExternalLink,
  FilePlus2,
  FileText,
  Languages,
  Mic,
  Save,
  Search,
  Send,
  Settings2,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { useExamForgeStore } from "../store";
import type { ClientEvent } from "../types";
import {
  loadApiAgentConfig,
  translateSegment,
  type ApiAgentConfig,
  type TranslationResult,
} from "../services/apiAgent";
import {
  askPaper,
  createSession,
  extractPaper,
  savePaperAnswer,
  savePaperPage,
  searchPapers,
  type PaperDocument,
  type PaperRecord,
  type PaperSection,
} from "../services/papers";

interface PaperSearchViewProps {
  sendEvent: (event: ClientEvent) => void;
}

function providerLabel(source: PaperRecord["source"]): string {
  if (source === "semantic-scholar") return "Semantic Scholar";
  if (source === "arxiv") return "arXiv";
  return source;
}

function shortAuthors(authors: string[]): string {
  if (authors.length === 0) return "作者信息缺失";
  if (authors.length <= 3) return authors.join(", ");
  return `${authors.slice(0, 3).join(", ")} 等`;
}

type SpeechRecognitionConstructor = new () => {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: { results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
};

function getSpeechRecognition(): SpeechRecognitionConstructor | null {
  const win = window as typeof window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return win.SpeechRecognition ?? win.webkitSpeechRecognition ?? null;
}

const DEFAULT_CONFIG: ApiAgentConfig = {
  baseUrl: "https://api.deepseek.com/v1",
  model: "deepseek-chat",
  systemPrompt: "",
  configured: false,
};

export function PaperSearchView({ sendEvent }: PaperSearchViewProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PaperRecord[]>([]);
  const [diagnostics, setDiagnostics] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [config, setConfig] = useState<ApiAgentConfig>(DEFAULT_CONFIG);
  const [listening, setListening] = useState(false);
  const [translatingId, setTranslatingId] = useState<string | null>(null);
  const [translations, setTranslations] = useState<Record<string, TranslationResult>>({});
  const [glossary, setGlossary] = useState<Array<{ chinese: string; english: string }>>([]);
  const [documents, setDocuments] = useState<Record<string, PaperDocument>>({});
  const [extractingId, setExtractingId] = useState<string | null>(null);
  const [activePaperId, setActivePaperId] = useState<string | null>(null);
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState("");
  const currentSessionId = useExamForgeStore((state) => state.currentSessionId);

  const activePaper = useMemo(() => results.find((paper) => paper.id === activePaperId), [activePaperId, results]);
  const activeDocument = activePaperId ? documents[activePaperId] : undefined;
  const selectedSection = activeDocument?.sections.find((section) => section.id === selectedSectionId) ?? activeDocument?.sections[0];

  useEffect(() => {
    let disposed = false;
    loadApiAgentConfig().then((next) => !disposed && setConfig(next)).catch((error) => console.error("读取 API Agent 配置失败", error));
    return () => { disposed = true; };
  }, []);

  const ensureSessionId = async (): Promise<string> => {
    if (currentSessionId) return currentSessionId;
    return (await createSession("论文研究")).id;
  };

  const runSearch = async (event?: FormEvent) => {
    event?.preventDefault();
    const value = query.trim();
    if (!value || loading) return;
    setLoading(true);
    setDiagnostics([]);
    try {
      const response = await searchPapers(value, 10);
      setResults(response.results);
      setDiagnostics(response.diagnostics.map((item) => item.ok ? `${item.provider}: ${item.count ?? 0}` : `${item.provider}: ${item.error ?? "failed"}`));
      if (response.results.length === 0) toast.info("没有找到论文，换个关键词试试");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "论文检索失败");
    } finally {
      setLoading(false);
    }
  };

  const addToSession = async (paper: PaperRecord) => {
    if (savingId) return;
    setSavingId(paper.id);
    try {
      const sessionId = await ensureSessionId();
      await savePaperPage(sessionId, paper);
      sendEvent({ event: "open_session", sessionId });
      toast.success("已加入当前学习空间");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存论文失败");
    } finally {
      setSavingId(null);
    }
  };

  const openSettings = () => {
    window.history.pushState(null, "", "/settings#ai");
    window.dispatchEvent(new PopStateEvent("popstate"));
  };

  const startVoiceInput = () => {
    const Recognition = getSpeechRecognition();
    if (!Recognition) return void toast.error("当前浏览器不支持语音识别");
    const recognition = new Recognition();
    recognition.lang = "zh-CN";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript?.trim();
      if (transcript) setQuery(transcript);
    };
    recognition.onerror = (event) => toast.error(event.error ? `语音识别失败：${event.error}` : "语音识别失败");
    recognition.onend = () => setListening(false);
    setListening(true);
    recognition.start();
  };

  const translateText = async (paper: PaperRecord, section?: PaperSection) => {
    const sourceText = section?.text ?? paper.abstract;
    if (!sourceText) return void toast.info("当前内容没有可翻译文本");
    setTranslatingId(paper.id);
    try {
      const result = await translateSegment({
        paperId: paper.id,
        paperTitle: paper.title,
        sourceSegmentId: section?.id ?? "abstract",
        sourceText,
        keywords: paper.keywords,
        glossary,
      });
      setTranslations((previous) => ({ ...previous, [`${paper.id}:${section?.id ?? "abstract"}`]: result }));
      setGlossary(result.glossary);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "翻译失败");
      if (!config.configured) openSettings();
    } finally {
      setTranslatingId(null);
    }
  };

  const openReader = async (paper: PaperRecord) => {
    setActivePaperId(paper.id);
    setAnswer("");
    if (documents[paper.id]) {
      setSelectedSectionId(documents[paper.id].sections[0]?.id ?? null);
      return;
    }
    if (!paper.pdfUrl) return void toast.info("该来源没有提供可读取的 PDF");
    setExtractingId(paper.id);
    try {
      const document = await extractPaper(paper);
      setDocuments((previous) => ({ ...previous, [paper.id]: document }));
      setSelectedSectionId(document.sections[0]?.id ?? null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "PDF 提取失败");
    } finally {
      setExtractingId(null);
    }
  };

  const askSelectedSection = async (event: FormEvent) => {
    event.preventDefault();
    if (!activePaper || !selectedSection || !question.trim() || asking) return;
    setAsking(true);
    setAnswer("");
    try {
      setAnswer(await askPaper({ paper: activePaper, question: question.trim(), passage: selectedSection.text, segmentId: selectedSection.id, sectionTitle: selectedSection.title }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "论文问答失败");
      if (!config.configured) openSettings();
    } finally {
      setAsking(false);
    }
  };

  const saveAnswer = async () => {
    if (!activePaper || !selectedSection || !answer || !question.trim()) return;
    setSavingId(activePaper.id);
    try {
      const sessionId = await ensureSessionId();
      await savePaperAnswer({ sessionId, paper: activePaper, question: question.trim(), answer, passage: selectedSection.text, segmentId: selectedSection.id, sectionTitle: selectedSection.title });
      sendEvent({ event: "open_session", sessionId });
      toast.success("问答与来源片段已保存为学习页");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存问答失败");
    } finally {
      setSavingId(null);
    }
  };

  const currentTranslation = activePaper && selectedSection ? translations[`${activePaper.id}:${selectedSection.id}`] : undefined;

  return (
    <div className="paper-search-view">
      <section className="paper-api-panel">
        <button type="button" className="paper-api-toggle" onClick={openSettings}>
          <Settings2 size={15} />
          <span>{config.configured ? `API Agent · ${config.model}` : "前往设置配置 API Agent"}</span>
        </button>
      </section>

      <form className="paper-search-form" onSubmit={(event) => void runSearch(event)}>
        <div className="paper-search-input-wrap"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="中文或英文关键词" aria-label="论文检索关键词" /></div>
        <button type="button" className="paper-voice-btn" onClick={startVoiceInput} disabled={listening} title="中文语音输入" aria-label="中文语音输入"><Mic size={15} /></button>
        <button type="submit" disabled={loading || !query.trim()}>{loading ? "检索中" : "检索"}</button>
      </form>

      <div className="paper-search-meta">
        <span>检索开放论文元数据</span>
        {results.length > 0 && <strong>{results.length} 条结果</strong>}
      </div>

      {diagnostics.length > 0 && <div className="paper-provider-status" title={diagnostics.join("\n")}><Sparkles size={14} /><span>{diagnostics.join(" · ")}</span></div>}

      {results.length === 0 ? (
        <div className="library-empty paper-empty"><FileText size={20} /><strong>检索论文并加入学习页</strong><p>从 arXiv 和 Semantic Scholar 拉取公开元数据。</p></div>
      ) : (
        <div className="paper-results">
          {results.map((paper) => {
            const abstractTranslation = translations[`${paper.id}:abstract`];
            return (
              <article className="paper-result" key={paper.id}>
                <div className="paper-result-head"><span>{providerLabel(paper.source)}</span>{paper.year && <time>{paper.year}</time>}</div>
                <h3>{paper.title}</h3>
                <p className="paper-authors">{shortAuthors(paper.authors)}</p>
                {paper.venue && <p className="paper-venue">{paper.venue}</p>}
                {paper.abstract && <p className="paper-abstract">{paper.abstract}</p>}
                <div className="paper-actions">
                  <button type="button" onClick={() => void addToSession(paper)} disabled={savingId === paper.id}><FilePlus2 size={14} /><span>{savingId === paper.id ? "保存中" : "加入学习页"}</span></button>
                  {paper.url && <a href={paper.url} target="_blank" rel="noreferrer"><ExternalLink size={14} /><span>来源</span></a>}
                  {paper.abstract && <button type="button" onClick={() => void translateText(paper)} disabled={translatingId === paper.id}><Languages size={14} /><span>{translatingId === paper.id ? "翻译中" : "翻译摘要"}</span></button>}
                  {paper.pdfUrl && <button type="button" onClick={() => void openReader(paper)} disabled={extractingId === paper.id}><BookOpenText size={14} /><span>{extractingId === paper.id ? "提取中" : "阅读全文"}</span></button>}
                </div>
                {abstractTranslation && <TranslationBlock result={abstractTranslation} title="摘要译文" />}
              </article>
            );
          })}
        </div>
      )}

      {activePaper && activeDocument && selectedSection && (
        <section className="paper-reader">
          <header><div><span>论文阅读器</span><h3>{activePaper.title}</h3></div><div className="paper-reader-head-actions"><small>{activeDocument.pageCount ? `${activeDocument.pageCount} 页 · ` : ""}{activeDocument.sections.length} 个片段{activeDocument.truncated ? " · 已截断" : ""}</small><button type="button" className="paper-reader-close" onClick={() => setActivePaperId(null)} aria-label="关闭论文阅读器" title="关闭论文阅读器"><X size={16} /></button></div></header>
          <div className="paper-reader-layout">
            <nav aria-label="论文章节">{activeDocument.sections.map((section) => <button type="button" className={section.id === selectedSection.id ? "active" : ""} key={section.id} onClick={() => { setSelectedSectionId(section.id); setAnswer(""); }}>{section.title}</button>)}</nav>
            <div className="paper-reader-content">
              <div className="paper-section-head"><h4>{selectedSection.title}</h4><button type="button" onClick={() => void translateText(activePaper, selectedSection)} disabled={translatingId === activePaper.id}><Languages size={14} /><span>翻译本节</span></button></div>
              <pre>{selectedSection.text}</pre>
              {currentTranslation && <TranslationBlock result={currentTranslation} title="本节译文" />}
              <form className="paper-question" onSubmit={(event) => void askSelectedSection(event)}><textarea value={question} onChange={(event) => setQuestion(event.target.value)} rows={3} placeholder="针对当前片段提问" /><button type="submit" disabled={asking || !question.trim()} title="发送问题"><Send size={15} /><span>{asking ? "分析中" : "注入并提问"}</span></button></form>
              {answer && <div className="paper-answer"><strong>基于来源片段的回答</strong><p>{answer}</p><button type="button" onClick={() => void saveAnswer()} disabled={savingId === activePaper.id}><Save size={14} /><span>保存为学习页</span></button></div>}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

function TranslationBlock({ result, title }: { result: TranslationResult; title: string }) {
  return (
    <div className="paper-translation">
      <strong>{title}</strong>
      <p>{result.translatedText}</p>
      {result.termsUsed.length > 0 && <div className="paper-terms">{result.termsUsed.map((term, index) => <span key={`${term.english}-${index}`}>{term.chinese}（{term.english}）</span>)}</div>}
      {result.warnings.length > 0 && <ul className="paper-translation-warnings">{result.warnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}</ul>}
    </div>
  );
}
