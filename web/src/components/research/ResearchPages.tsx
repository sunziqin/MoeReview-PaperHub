import {
  ArrowLeft, Bookmark, BookOpenText, Check, Clock3, ExternalLink, FileText, GraduationCap,
  Heart, Languages, Mic, Search, Sparkles, ThumbsDown, WandSparkles,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { useExamForgeStore } from "../../store";
import { loadApiAgentConfig, saveApiAgentConfig, translateSegment, type ApiAgentConfig, type TranslationResult } from "../../services/apiAgent";
import {
  clearRecommendationHistory, controlTranslationJob, createTranslationJobs, dismissPaper, exportPaperData, generateSummary, loadFeed, loadLibrary,
  loadPaperDetail, loadTranslationJobs, recordPaperEvent, savePreferences, searchPapers, startPaperLearning, testApiAgent, updateLibrary,
  type AppPreferences, type PaperFeedItem, type PaperLibraryEntry, type PaperRecord, type PaperSummary, type PaperTranslationJob,
} from "../../services/paperWorkspace";
import { PaperFullTextReader } from "./PaperFullTextReader";

interface PageProps { navigate: (path: string) => void; preferences: AppPreferences; onPreferences: (value: AppPreferences) => void; }

function authors(paper: PaperRecord): string { return paper.authors.length > 3 ? `${paper.authors.slice(0, 3).join(", ")} 等` : paper.authors.join(", ") || "作者信息缺失"; }
function provider(source: PaperRecord["source"]): string { return source === "semantic-scholar" ? "Semantic Scholar" : source === "arxiv" ? "arXiv" : source; }
function preview(paper: PaperRecord): string { return paper.abstract?.trim() || "该来源暂未提供摘要。"; }

export function PaperCard({ item, navigate, featured = false, onRemoved }: { item: PaperFeedItem; navigate: (path: string) => void; featured?: boolean; onRemoved?: () => void }) {
  const [summary, setSummary] = useState(item.summary);
  const [library, setLibrary] = useState(item.library);
  const [busy, setBusy] = useState<string | null>(null);
  const paper = item.paper;
  const patchLibrary = async (input: { favorite?: boolean; readLater?: boolean }) => {
    setBusy(Object.keys(input)[0]);
    try { setLibrary(await updateLibrary(paper.id, input)); } catch (error) { toast.error(error instanceof Error ? error.message : "保存失败"); } finally { setBusy(null); }
  };
  const summarize = async () => {
    setBusy("summary");
    try { setSummary(await generateSummary(paper.id)); } catch (error) { toast.error(error instanceof Error ? error.message : "摘要生成失败"); } finally { setBusy(null); }
  };
  return <article className={`feed-paper-card${featured ? " featured" : ""}`}>
    <div className="paper-card-top"><span>{provider(paper.source)}</span>{paper.year && <time>{paper.year}</time>}</div>
    <button type="button" className="paper-card-title" onClick={() => navigate(`/paper/${encodeURIComponent(paper.id)}`)}><h2>{summary?.chineseTitle || paper.title}</h2>{summary?.chineseTitle && <small>{paper.title}</small>}</button>
    <p className="paper-card-authors">{authors(paper)}</p>
    <small className="paper-card-preview-label">{summary ? "AI 大白话预览" : "原文摘要"}</small>
    <p className="paper-card-preview">{summary?.oneLineSummary || preview(paper)}</p>
    <div className="paper-card-reason"><Sparkles size={13} /><span>{item.reason}</span></div>
    {summary && <div className="paper-card-summary"><div><strong>方法</strong><p>{summary.method || "未从摘要中确认"}</p></div><div><strong>结果</strong><p>{summary.findings || "未从摘要中确认"}</p></div><div><strong>局限</strong><p>{summary.limitations || "原摘要未说明"}</p></div><small>AI 生成摘要 · {summary.model}</small></div>}
    <div className="paper-card-actions">
      <button type="button" className="primary" onClick={() => navigate(`/paper/${encodeURIComponent(paper.id)}`)}><BookOpenText size={15} /><span>查看详情</span></button>
      <button type="button" onClick={() => void summarize()} disabled={busy === "summary"}><WandSparkles size={15} /><span>{busy === "summary" ? "生成中" : summary ? "刷新摘要" : "一键摘要"}</span></button>
      <button type="button" className={library?.favorite ? "active" : ""} onClick={() => void patchLibrary({ favorite: !library?.favorite })} title="收藏"><Heart size={15} fill={library?.favorite ? "currentColor" : "none"} /></button>
      <button type="button" className={library?.readLater ? "active" : ""} onClick={() => void patchLibrary({ readLater: !library?.readLater })} title="稍后阅读"><Bookmark size={15} fill={library?.readLater ? "currentColor" : "none"} /></button>
      <button type="button" onClick={() => void dismissPaper(paper.id).then(onRemoved)} title="不感兴趣"><ThumbsDown size={15} /></button>
    </div>
  </article>;
}

const CHANNELS = [{ id: "for-you", label: "为你推荐" }, { id: "latest", label: "最新论文" }, { id: "llm", label: "大语言模型" }, { id: "vision", label: "计算机视觉" }, { id: "rl", label: "强化学习" }];
const INTERESTS = ["大语言模型", "检索增强生成", "计算机视觉", "多模态", "强化学习", "AI Agent", "语音识别", "生成模型", "推荐系统", "机器人"];
const FEED_CACHE_TTL_MS = 5 * 60 * 1000;
type FeedPage = Awaited<ReturnType<typeof loadFeed>>;
type CachedFeedPage = FeedPage & { fetchedAt: number };

function feedCacheKey(channel: string, interestKey: string, limit: number, cursor: number): string {
  return `${channel}|${interestKey}|${limit}|${cursor}`;
}

const abstractTranslationCache = new Map<string, TranslationResult>();

export function DiscoverPage(props: PageProps) {
  const { navigate, preferences, onPreferences } = props;
  const [channel, setChannel] = useState("for-you");
  const [items, setItems] = useState<PaperFeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [diagnostics, setDiagnostics] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>(preferences.interests);
  const [onboardingBusy, setOnboardingBusy] = useState(false);
  const [onboardingError, setOnboardingError] = useState("");
  const interestKey = preferences.interests.join("|");
  const channelRef = useRef(channel);
  const cursorRef = useRef(0);
  const requestIdRef = useRef(0);
  const feedCacheRef = useRef(new Map<string, CachedFeedPage>());
  const pendingFeedRef = useRef(new Map<string, Promise<FeedPage>>());

  const loadPage = useCallback(async (targetChannel: string, offset: number): Promise<FeedPage> => {
    const key = feedCacheKey(targetChannel, interestKey, preferences.searchLimit, offset);
    const pending = pendingFeedRef.current.get(key);
    if (pending) return pending;
    const promise = loadFeed(targetChannel, offset, preferences.searchLimit).finally(() => pendingFeedRef.current.delete(key));
    pendingFeedRef.current.set(key, promise);
    return promise;
  }, [interestKey, preferences.searchLimit]);

  const applyPage = useCallback((targetChannel: string, page: FeedPage, reset: boolean) => {
    if (targetChannel !== channelRef.current) return;
    setItems((old) => reset ? page.items : [...old, ...page.items.filter((item) => !old.some((oldItem) => oldItem.paper.id === item.paper.id))]);
    cursorRef.current = page.nextCursor;
    setDiagnostics(page.diagnostics.map((diagnostic) => diagnostic.ok ? `${diagnostic.provider} ${diagnostic.count ?? 0}` : `${diagnostic.provider}: ${diagnostic.error}`));
  }, []);

  const fetchFeed = useCallback(async (reset: boolean, targetChannel = channelRef.current) => {
    const offset = reset ? 0 : cursorRef.current;
    const key = feedCacheKey(targetChannel, interestKey, preferences.searchLimit, offset);
    const cached = feedCacheRef.current.get(key);
    const hasCached = Boolean(cached);
    const stale = !cached || Date.now() - cached.fetchedAt >= FEED_CACHE_TTL_MS;
    const requestId = ++requestIdRef.current;
    if (cached) {
      applyPage(targetChannel, cached, reset);
      setLoading(false);
      if (!stale) return;
    } else if (reset && targetChannel === channelRef.current) {
      setItems([]);
      setDiagnostics([]);
      setLoading(true);
    } else if (!hasCached) {
      setLoading(true);
    }
    try {
      const next = await loadPage(targetChannel, offset);
      feedCacheRef.current.set(key, { ...next, fetchedAt: Date.now() });
      if (requestId === requestIdRef.current) applyPage(targetChannel, next, reset);
    } catch (error) {
      if (requestId === requestIdRef.current && !cached) toast.error(error instanceof Error ? error.message : "推荐加载失败");
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [applyPage, interestKey, loadPage, preferences.searchLimit]);

  const prefetchFeed = useCallback((targetChannel: string): Promise<void> => {
    const key = feedCacheKey(targetChannel, interestKey, preferences.searchLimit, 0);
    const cached = feedCacheRef.current.get(key);
    if (cached && Date.now() - cached.fetchedAt < FEED_CACHE_TTL_MS) return Promise.resolve();
    return loadPage(targetChannel, 0).then((page) => {
      feedCacheRef.current.set(key, { ...page, fetchedAt: Date.now() });
    }).catch(() => undefined);
  }, [interestKey, loadPage, preferences.searchLimit]);

  useEffect(() => {
    channelRef.current = channel;
    cursorRef.current = 0;
    void fetchFeed(true, channel);
  }, [channel, fetchFeed, interestKey]);
  useEffect(() => { items.slice(0, 12).forEach((item) => void recordPaperEvent(item.paper.id, "impression")); }, [items]);
  useEffect(() => {
    if (loading || !preferences.onboardingComplete) return;
    let disposed = false;
    let timer = 0;
    const targets = Array.from(new Set([
      ...CHANNELS.map((item) => item.id),
      ...preferences.interests.slice(0, 3).map((interest) => `interest:${interest}`),
    ]));
    const run = async () => {
      for (const target of targets) {
        if (disposed) return;
        await prefetchFeed(target);
        await new Promise<void>((resolve) => { timer = window.setTimeout(resolve, 420); });
      }
    };
    timer = window.setTimeout(() => { void run(); }, 600);
    return () => { disposed = true; window.clearTimeout(timer); };
  }, [loading, preferences.interests, preferences.onboardingComplete, prefetchFeed]);
  const finishOnboarding = async (skip = false) => {
    if (onboardingBusy) return;
    setOnboardingBusy(true);
    setOnboardingError("");
    try {
      const next = await savePreferences({ interests: skip ? [] : selected, onboardingComplete: true });
      onPreferences(next);
    } catch (error) {
      const message = error instanceof Error ? error.message : "保存失败，请重试。";
      setOnboardingError(message);
      toast.error(message);
    } finally {
      setOnboardingBusy(false);
    }
  };
  return <main className="research-page discover-page">
    <header className="discover-head"><div><span className="page-kicker">PERSONAL PAPER FEED</span><h1>发现值得读的论文</h1><p>从开放论文中筛选与你兴趣相关的新工作。</p></div><form onSubmit={(e) => { e.preventDefault(); const value = new FormData(e.currentTarget).get("q"); if (value) navigate(`/search?q=${encodeURIComponent(String(value))}`); }}><Search size={18} /><input name="q" placeholder="搜索主题、作者或关键词" /><button>搜索</button></form></header>
    <div className="channel-tabs">{CHANNELS.map((item) => <button type="button" key={item.id} className={channel === item.id ? "active" : ""} onClick={() => setChannel(item.id)} onPointerEnter={() => prefetchFeed(item.id)} onFocus={() => prefetchFeed(item.id)}>{item.label}</button>)}{preferences.interests.slice(0, 3).map((interest) => <button type="button" key={interest} className={channel === `interest:${interest}` ? "active" : ""} onClick={() => setChannel(`interest:${interest}`)} onPointerEnter={() => prefetchFeed(`interest:${interest}`)} onFocus={() => prefetchFeed(`interest:${interest}`)}>{interest}</button>)}</div>
    {diagnostics.length > 0 && <div className="feed-diagnostics">{diagnostics.join(" · ")}</div>}
    {loading && items.length === 0 ? <FeedSkeleton /> : items.length === 0 ? <EmptyState title="暂时没有匹配的论文" text="换个频道或在设置中调整兴趣。" /> : <div className="paper-feed-grid">{items.map((item, index) => <PaperCard key={item.paper.id} item={item} featured={index === 0} navigate={navigate} onRemoved={() => setItems((old) => old.filter((entry) => entry.paper.id !== item.paper.id))} />)}</div>}
    {items.length > 0 && <button type="button" className="load-more" onClick={() => void fetchFeed(false)} disabled={loading}>{loading ? "加载中" : "加载更多"}</button>}
    {!preferences.onboardingComplete && <div className="onboarding-overlay"><section className="onboarding-panel"><span className="page-kicker">WELCOME TO MOEREVIEW</span><h2>先选几个感兴趣的方向</h2><p>推荐记录只保存在这台电脑上，之后可在设置中关闭或清除。</p><div className="interest-grid">{INTERESTS.map((interest) => <button type="button" className={selected.includes(interest) ? "active" : ""} key={interest} disabled={onboardingBusy} onClick={() => setSelected((old) => old.includes(interest) ? old.filter((item) => item !== interest) : [...old, interest].slice(0, 8))}>{selected.includes(interest) && <Check size={14} />}{interest}</button>)}</div>{onboardingError && <p className="onboarding-error" role="alert">{onboardingError}</p>}<div className="onboarding-actions"><button type="button" disabled={onboardingBusy} onClick={() => void finishOnboarding(true)}>跳过</button><button type="button" className="primary" disabled={onboardingBusy} onClick={() => void finishOnboarding()}>{onboardingBusy ? "保存中..." : onboardingError ? "重试" : "开始发现"}</button></div></section></div>}
  </main>;
}

function FeedSkeleton() { return <div className="paper-feed-grid">{Array.from({ length: 7 }, (_, index) => <div className={`feed-skeleton${index === 0 ? " featured" : ""}`} key={index}><i /><i /><i /><i /></div>)}</div>; }
function EmptyState({ title, text }: { title: string; text: string }) { return <div className="research-empty"><FileText size={24} /><strong>{title}</strong><p>{text}</p></div>; }

type SpeechRecognitionConstructor = new () => { lang: string; interimResults: boolean; onresult: ((event: { results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null; onend: (() => void) | null; start: () => void; };
function speechRecognition(): SpeechRecognitionConstructor | null { const win = window as typeof window & { SpeechRecognition?: SpeechRecognitionConstructor; webkitSpeechRecognition?: SpeechRecognitionConstructor }; return win.SpeechRecognition ?? win.webkitSpeechRecognition ?? null; }

export function SearchPage({ navigate }: PageProps) {
  const initial = new URLSearchParams(location.search).get("q") ?? ""; const [query, setQuery] = useState(initial); const [items, setItems] = useState<PaperFeedItem[]>([]); const [loading, setLoading] = useState(false);
  const search = async (event?: FormEvent) => { event?.preventDefault(); if (!query.trim()) return; setLoading(true); history.replaceState(null, "", `/search?q=${encodeURIComponent(query.trim())}`); try { const result = await searchPapers(query.trim(), 16); setItems(result.results.map((paper, index) => ({ paper, reason: `搜索“${query.trim()}”的结果`, score: 100 - index, topics: [query.trim()] }))); } catch (error) { toast.error(error instanceof Error ? error.message : "搜索失败"); } finally { setLoading(false); } };
  useEffect(() => { if (initial) void search(); }, []);
  const voice = () => { const Recognition = speechRecognition(); if (!Recognition) return toast.error("当前浏览器不支持语音识别"); const recognition = new Recognition(); recognition.lang = "zh-CN"; recognition.interimResults = false; recognition.onresult = (event) => { const text = event.results[0]?.[0]?.transcript; if (text) setQuery(text); }; recognition.onend = () => undefined; recognition.start(); };
  return <main className="research-page"><header className="page-head"><div><span className="page-kicker">SEARCH</span><h1>搜索论文</h1><p>使用中文、英文关键词或语音查找公开论文。</p></div></header><form className="research-search" onSubmit={(event) => void search(event)}><Search size={19} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="关键词、作者、方法或领域" /><button type="button" onClick={voice} title="中文语音输入"><Mic size={17} /></button><button type="submit" disabled={loading || !query.trim()}>{loading ? "检索中" : "检索"}</button></form>{items.length > 0 ? <div className="paper-feed-grid search-grid">{items.map((item) => <PaperCard key={item.paper.id} item={item} navigate={navigate} />)}</div> : <EmptyState title="输入关键词开始检索" text="例如：retrieval augmented generation、视觉提示调优。" />}</main>;
}

export function SavedPage({ navigate }: PageProps) {
  const [tab, setTab] = useState<"favorite" | "read-later">("favorite"); const [entries, setEntries] = useState<PaperLibraryEntry[]>([]); useEffect(() => { void loadLibrary(tab).then(setEntries).catch((error) => toast.error(error.message)); }, [tab]);
  return <main className="research-page"><header className="page-head"><div><span className="page-kicker">LIBRARY</span><h1>你的论文库</h1><p>收藏的论文和准备稍后阅读的内容。</p></div></header><div className="segmented"><button className={tab === "favorite" ? "active" : ""} onClick={() => setTab("favorite")}>已收藏</button><button className={tab === "read-later" ? "active" : ""} onClick={() => setTab("read-later")}>稍后阅读</button></div>{entries.length ? <div className="paper-feed-grid search-grid">{entries.map((entry, index) => <PaperCard key={entry.paperId} item={{ paper: entry.paper, library: entry, reason: tab === "favorite" ? "已收藏" : "稍后阅读", score: 100-index, topics: [] }} navigate={navigate} />)}</div> : <EmptyState title={tab === "favorite" ? "还没有收藏论文" : "稍后阅读列表为空"} text="浏览推荐或搜索结果时，可以随时保存论文。" />}</main>;
}

export function HistoryPage({ navigate }: PageProps) { const [entries, setEntries] = useState<PaperLibraryEntry[]>([]); const sessions = useExamForgeStore((state) => state.sessions); useEffect(() => { void loadLibrary("history").then(setEntries).catch((error) => toast.error(error.message)); }, []); return <main className="research-page"><header className="page-head"><div><span className="page-kicker">HISTORY</span><h1>历史</h1><p>继续阅读论文，或返回之前的学习会话。</p></div></header><section className="history-section"><h2>阅读历史</h2>{entries.length ? <div className="history-list">{entries.map((entry) => <button key={entry.paperId} onClick={() => navigate(`/paper/${encodeURIComponent(entry.paperId)}`)}><Clock3 size={17} /><span><strong>{entry.paper.title}</strong><small>{entry.openedAt ? new Date(entry.openedAt).toLocaleString("zh-CN") : ""}{typeof entry.progress === "number" ? ` · ${Math.round(entry.progress * 100)}%` : ""}</small></span></button>)}</div> : <p className="history-empty-line">打开论文详情后会显示在这里。</p>}</section><section className="history-section"><h2>学习记录</h2>{sessions.length ? <div className="history-list">{sessions.map((session) => <button key={session.id} onClick={() => navigate(`/learning?session=${encodeURIComponent(session.id)}`)}><GraduationCap size={17} /><span><strong>{session.title || "未命名学习会话"}</strong><small>{new Date(session.last_access).toLocaleString("zh-CN")}</small></span></button>)}</div> : <p className="history-empty-line">还没有学习记录。</p>}</section></main>; }

export function LegacyPaperDetailPage({ navigate, preferences }: PageProps) {
  const paperId = decodeURIComponent(location.pathname.slice("/paper/".length)); const [paper, setPaper] = useState<PaperRecord | null>(null); const [library, setLibrary] = useState<PaperLibraryEntry>(); const [summary, setSummary] = useState<PaperSummary>(); const [translation, setTranslation] = useState<TranslationResult>(); const [mode, setMode] = useState(preferences.readingLanguage); const [busy, setBusy] = useState<string | null>(null); const [apiConfigured, setApiConfigured] = useState<boolean | null>(null); const enteredAt = useRef(Date.now());
  useEffect(() => { let disposed = false; const load = async () => { try { const data = await loadPaperDetail(paperId); if (disposed) return; setPaper(data.paper); setLibrary(data.library); setSummary(data.summary); void updateLibrary(paperId, { openedAt: true }).then(setLibrary); void recordPaperEvent(paperId, "open"); const apiConfig = await loadApiAgentConfig().catch(() => undefined); if (disposed) return; setApiConfigured(Boolean(apiConfig?.configured)); if (!data.paper.abstract || !apiConfig?.configured) return; const translationKey = `${data.paper.id}:${data.paper.abstract}`; const cachedTranslation = abstractTranslationCache.get(translationKey); if (cachedTranslation) setTranslation(cachedTranslation); setBusy("auto"); const [summaryResult, translationResult] = await Promise.allSettled([data.summary ? Promise.resolve(data.summary) : generateSummary(paperId), cachedTranslation ? Promise.resolve(cachedTranslation) : translateSegment({ paperId, paperTitle: data.paper.title, sourceSegmentId: "abstract", sourceText: data.paper.abstract })]); if (disposed) return; if (summaryResult.status === "fulfilled" && summaryResult.value) setSummary(summaryResult.value); if (translationResult.status === "fulfilled" && translationResult.value) { abstractTranslationCache.set(translationKey, translationResult.value); setTranslation(translationResult.value); } } catch (error) { if (!disposed) toast.error(error instanceof Error ? error.message : "论文加载失败"); } finally { if (!disposed) setBusy(null); } }; void load(); return () => { disposed = true; void recordPaperEvent(paperId, "dwell", Date.now() - enteredAt.current); }; }, [paperId]);
  useEffect(() => { const container = globalThis.document.querySelector<HTMLElement>(".research-main"); if (!container) return; let timer = 0; const save = () => { window.clearTimeout(timer); timer = window.setTimeout(() => { const max = container.scrollHeight - container.clientHeight; if (max > 0) void updateLibrary(paperId, { progress: container.scrollTop / max }); }, 350); }; container.addEventListener("scroll", save, { passive: true }); return () => { container.removeEventListener("scroll", save); window.clearTimeout(timer); }; }, [paperId]);
  void apiConfigured;
  if (!paper) return <main className="research-page"><FeedSkeleton /></main>;
  const summarize = async () => { setBusy("summary"); try { setSummary(await generateSummary(paperId)); } catch (error) { toast.error(error instanceof Error ? error.message : "摘要失败"); } finally { setBusy(null); } };
  const translate = async () => { if (!paper.abstract) return; setBusy("translate"); try { const result = await translateSegment({ paperId, paperTitle: paper.title, sourceSegmentId: "abstract", sourceText: paper.abstract }); abstractTranslationCache.set(`${paper.id}:${paper.abstract}`, result); setTranslation(result); } catch (error) { toast.error(error instanceof Error ? error.message : "翻译失败"); } finally { setBusy(null); } };
  const learn = async () => { setBusy("learn"); try { const session = await startPaperLearning(paperId); navigate(`/learning?session=${encodeURIComponent(session.id)}&paper=${encodeURIComponent(paperId)}`); } catch (error) { toast.error(error instanceof Error ? error.message : "创建学习空间失败"); } finally { setBusy(null); } };
  const update = async (input: { favorite?: boolean; readLater?: boolean }) => { try { setLibrary(await updateLibrary(paperId, input)); } catch (error) { toast.error(error instanceof Error ? error.message : "保存失败"); } };
  return <main className="paper-detail-page"><button type="button" className="back-link" onClick={() => history.length > 1 ? history.back() : navigate("/discover")}><ArrowLeft size={17} />返回</button><header className="paper-detail-hero"><div className="paper-detail-meta"><span>{provider(paper.source)}</span>{paper.year && <time>{paper.year}</time>}{paper.venue && <span>{paper.venue}</span>}</div><h1>{summary?.chineseTitle || paper.title}</h1>{summary?.chineseTitle && <p className="paper-original-title">{paper.title}</p>}<p className="paper-detail-authors">{authors(paper)}</p><div className="paper-detail-actions"><button className="primary" onClick={() => void learn()} disabled={busy === "learn"}><GraduationCap size={17} />{busy === "learn" ? "准备中" : "开始学习"}</button><button className={library?.favorite ? "active" : ""} onClick={() => void update({ favorite: !library?.favorite })}><Heart size={17} fill={library?.favorite ? "currentColor" : "none"} />收藏</button><button className={library?.readLater ? "active" : ""} onClick={() => void update({ readLater: !library?.readLater })}><Bookmark size={17} />稍后阅读</button>{paper.url && <a href={paper.url} target="_blank" rel="noreferrer"><ExternalLink size={17} />原始来源</a>}{paper.pdfUrl && <a href={paper.pdfUrl} target="_blank" rel="noreferrer"><FileText size={17} />PDF</a>}</div></header><div className={`paper-detail-layout content-${preferences.contentWidth}`}><article className="paper-detail-main"><section className="detail-section summary-section"><div className="section-title"><div><span>AI SUMMARY</span><h2>中文摘要</h2></div><button onClick={() => void summarize()} disabled={busy === "summary"}><WandSparkles size={16} />{busy === "summary" ? "生成中" : summary ? "重新生成" : "一键摘要"}</button></div>{summary ? <div className="structured-summary"><p className="summary-lead">{summary.oneLineSummary}</p>{summary.plainLanguageExplanation && <p className="summary-plain">{summary.plainLanguageExplanation}</p>}<dl><div><dt>研究问题</dt><dd>{summary.researchQuestion}</dd></div><div><dt>为什么重要</dt><dd>{summary.whyItMatters || "原摘要未明确说明"}</dd></div><div><dt>方法</dt><dd>{summary.method}</dd></div><div><dt>主要发现</dt><dd>{summary.findings}</dd></div><div><dt>现实意义</dt><dd>{summary.realWorldMeaning || "原文未明确说明"}</dd></div><div><dt>局限</dt><dd>{summary.limitations || "原摘要未明确说明"}</dd></div></dl>{summary.rememberThis && summary.rememberThis.length > 0 && <div className="summary-remember"><strong>读完只需记住</strong><ul>{summary.rememberThis.map((item) => <li key={item}>{item}</li>)}</ul></div>}<small>AI 生成内容 · 请结合原文核对数字和结论</small></div> : <p className="detail-placeholder">点击“一键摘要”生成大白话中文导读。AI 配置统一在设置页面管理。</p>}</section><section className="detail-section"><div className="section-title"><div><span>ABSTRACT</span><h2>论文摘要</h2></div><button onClick={() => void translate()} disabled={!paper.abstract || busy === "translate"}><Languages size={16} />{busy === "translate" ? "翻译中" : "翻译摘要"}</button></div><div className="reading-mode-tabs"><button className={mode === "source" ? "active" : ""} onClick={() => setMode("source")}>原文</button><button className={mode === "chinese" ? "active" : ""} onClick={() => setMode("chinese")}>中文</button><button className={mode === "bilingual" ? "active" : ""} onClick={() => setMode("bilingual")}>双语</button></div>{(mode === "source" || mode === "bilingual") && <p className="source-abstract">{preview(paper)}</p>}{(mode === "chinese" || mode === "bilingual") && <p className="translated-abstract">{translation?.translatedText || "尚未生成中文译文。点击“翻译摘要”。"}</p>}</section><PaperFullTextReader paper={paper} paperId={paperId} defaultMode={preferences.readingLanguage} translationTier={preferences.translationTier} translationConcurrency={preferences.translationConcurrency} /></article><aside className="paper-detail-aside"><section><span>论文信息</span><dl>{paper.doi && <><dt>DOI</dt><dd>{paper.doi}</dd></>}{paper.arxivId && <><dt>arXiv</dt><dd>{paper.arxivId}</dd></>}<dt>来源</dt><dd>{provider(paper.source)}</dd><dt>获取时间</dt><dd>{new Date(paper.fetchedAt).toLocaleDateString("zh-CN")}</dd></dl></section><section><span>下一步</span><button onClick={() => void learn()}><GraduationCap size={16} />解析、问答与做题</button></section></aside></div></main>;
}

export function PaperDetailPage({ navigate, preferences }: PageProps) {
  const paperId = decodeURIComponent(location.pathname.slice("/paper/".length));
  const [paper, setPaper] = useState<PaperRecord | null>(null);
  const [library, setLibrary] = useState<PaperLibraryEntry>();
  const [summary, setSummary] = useState<PaperSummary>();
  const [translation, setTranslation] = useState<TranslationResult>();
  const [mode, setMode] = useState(preferences.readingLanguage);
  const [busy, setBusy] = useState<string | null>(null);
  const [apiConfigured, setApiConfigured] = useState<boolean | null>(null);
  const enteredAt = useRef(Date.now());

  useEffect(() => {
    let disposed = false;
    const startedAt = enteredAt.current;
    const load = async () => {
      try {
        const data = await loadPaperDetail(paperId);
        if (disposed) return;
        setPaper(data.paper);
        setLibrary(data.library);
        setSummary(data.summary);
        void updateLibrary(paperId, { openedAt: true }).then(setLibrary);
        void recordPaperEvent(paperId, "open");
        const apiConfig = await loadApiAgentConfig().catch(() => undefined);
        if (disposed) return;
        setApiConfigured(Boolean(apiConfig?.configured));
        if (!data.paper.abstract || !apiConfig?.configured) return;
        const translationKey = `${data.paper.id}:${data.paper.abstract}`;
        const cachedTranslation = abstractTranslationCache.get(translationKey);
        if (cachedTranslation) setTranslation(cachedTranslation);
        setBusy("auto");
        const [summaryResult, translationResult] = await Promise.allSettled([
          data.summary ? Promise.resolve(data.summary) : generateSummary(paperId),
          cachedTranslation ? Promise.resolve(cachedTranslation) : translateSegment({ paperId, paperTitle: data.paper.title, sourceSegmentId: "abstract", sourceText: data.paper.abstract }),
        ]);
        if (disposed) return;
        if (summaryResult.status === "fulfilled" && summaryResult.value) setSummary(summaryResult.value);
        if (translationResult.status === "fulfilled" && translationResult.value) {
          abstractTranslationCache.set(translationKey, translationResult.value);
          setTranslation(translationResult.value);
        }
      } catch (error) {
        if (!disposed) toast.error(error instanceof Error ? error.message : "论文加载失败");
      } finally {
        if (!disposed) setBusy(null);
      }
    };
    void load();
    return () => { disposed = true; void recordPaperEvent(paperId, "dwell", Date.now() - startedAt); };
  }, [paperId]);

  useEffect(() => {
    const container = globalThis.document.querySelector<HTMLElement>(".research-main");
    if (!container) return;
    let timer = 0;
    const save = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const max = container.scrollHeight - container.clientHeight;
        if (max > 0) void updateLibrary(paperId, { progress: container.scrollTop / max });
      }, 350);
    };
    container.addEventListener("scroll", save, { passive: true });
    return () => { container.removeEventListener("scroll", save); window.clearTimeout(timer); };
  }, [paperId]);

  if (!paper) return <main className="research-page"><FeedSkeleton /></main>;

  const summarize = async () => {
    setBusy("summary");
    try { setSummary(await generateSummary(paperId)); } catch (error) { toast.error(error instanceof Error ? error.message : "摘要失败"); } finally { setBusy(null); }
  };
  const translate = async () => {
    if (!paper.abstract) return;
    setBusy("translate");
    try {
      const result = await translateSegment({ paperId, paperTitle: paper.title, sourceSegmentId: "abstract", sourceText: paper.abstract });
      abstractTranslationCache.set(`${paper.id}:${paper.abstract}`, result);
      setTranslation(result);
    } catch (error) { toast.error(error instanceof Error ? error.message : "翻译失败"); } finally { setBusy(null); }
  };
  const learn = async () => {
    setBusy("learn");
    try { const session = await startPaperLearning(paperId); navigate(`/learning?session=${encodeURIComponent(session.id)}&paper=${encodeURIComponent(paperId)}`); } catch (error) { toast.error(error instanceof Error ? error.message : "创建学习空间失败"); } finally { setBusy(null); }
  };
  const update = async (input: { favorite?: boolean; readLater?: boolean }) => {
    try { setLibrary(await updateLibrary(paperId, input)); } catch (error) { toast.error(error instanceof Error ? error.message : "保存失败"); }
  };
  const summaryLoading = busy === "auto" && !summary;
  const translationLoading = busy === "auto" && !translation;

  return <main className="paper-detail-page">
    <button type="button" className="back-link" onClick={() => history.length > 1 ? history.back() : navigate("/discover")}><ArrowLeft size={17} />返回发现</button>
    <header className="paper-detail-hero">
      <div className="paper-detail-meta"><span>{provider(paper.source)}</span>{paper.year && <time>{paper.year}</time>}{paper.venue && <span>{paper.venue}</span>}{paper.pdfUrl && <span className="meta-available">可阅读 PDF</span>}</div>
      <h1>{summary?.chineseTitle || paper.title}</h1>
      {summary?.chineseTitle && <p className="paper-original-title">{paper.title}</p>}
      <p className="paper-detail-authors">{authors(paper)}</p>
      <div className="paper-detail-actions"><button className="primary" onClick={() => void learn()} disabled={busy === "learn"}><GraduationCap size={17} />{busy === "learn" ? "准备中" : "开始学习"}</button><button className={library?.favorite ? "active" : ""} onClick={() => void update({ favorite: !library?.favorite })}><Heart size={17} fill={library?.favorite ? "currentColor" : "none"} />收藏</button><button className={library?.readLater ? "active" : ""} onClick={() => void update({ readLater: !library?.readLater })}><Bookmark size={17} fill={library?.readLater ? "currentColor" : "none"} />稍后阅读</button>{paper.url && <a href={paper.url} target="_blank" rel="noreferrer"><ExternalLink size={17} />原始来源</a>}{paper.pdfUrl && <a href={paper.pdfUrl} target="_blank" rel="noreferrer"><FileText size={17} />原版 PDF</a>}</div>
    </header>
    <div className={`paper-detail-layout content-${preferences.contentWidth}`}>
      <article className="paper-detail-main">
        <section className="detail-section summary-section">
          <div className="section-title"><div><span>PLAIN CHINESE OVERVIEW</span><h2>论文概括</h2><p className="section-intro">先用大白话弄清楚这篇论文在做什么，再决定要不要深入读。</p></div><button onClick={() => void summarize()} disabled={busy !== null}><WandSparkles size={16} />{busy === "summary" ? "生成中" : summary ? "重新生成" : "一键摘要"}</button></div>
          {summary ? <div className="structured-summary"><p className="summary-lead">{summary.oneLineSummary}</p>{summary.plainLanguageExplanation && <p className="summary-plain">{summary.plainLanguageExplanation}</p>}<dl><div><dt>它想解决什么</dt><dd>{summary.researchQuestion}</dd></div><div><dt>为什么值得看</dt><dd>{summary.whyItMatters || "原摘要未明确说明"}</dd></div><div><dt>作者怎么做</dt><dd>{summary.method}</dd></div><div><dt>结果说明什么</dt><dd>{summary.findings}</dd></div><div><dt>现实中能做什么</dt><dd>{summary.realWorldMeaning || "原文未明确说明"}</dd></div><div><dt>有哪些局限</dt><dd>{summary.limitations || "原摘要未明确说明"}</dd></div></dl>{summary.methodSteps && summary.methodSteps.length > 0 && <div className="summary-list"><strong>方法拆开看</strong><ol>{summary.methodSteps.map((item) => <li key={item}>{item}</li>)}</ol></div>}{summary.keyFindings && summary.keyFindings.length > 0 && <div className="summary-list"><strong>关键发现</strong><ul>{summary.keyFindings.map((item) => <li key={item}>{item}</li>)}</ul></div>}{summary.rememberThis && summary.rememberThis.length > 0 && <div className="summary-remember"><strong>读完只需记住</strong><ul>{summary.rememberThis.map((item) => <li key={item}>{item}</li>)}</ul></div>}<small>AI 生成内容 · 术语保留 English keyword · 请结合原文核对数字和结论</small></div> : <div className="auto-summary-placeholder"><strong>{summaryLoading ? "正在生成大白话概括" : "还没有中文概括"}</strong><p>{summaryLoading ? "正在把研究问题、方法、结果和局限拆开讲清楚。" : apiConfigured === false ? "请先在设置中配置 API Key；配置完成后，打开论文会自动生成。" : "点击“一键摘要”，生成可直接阅读的中文导读。"}</p><button type="button" onClick={() => void summarize()} disabled={busy !== null}><WandSparkles size={15} />生成论文概括</button></div>}
        </section>
        <section className="detail-section abstract-reading-section">
          <div className="section-title"><div><span>ABSTRACT READING</span><h2>摘要：中文理解与论文原文</h2><p className="section-intro">中文译文用于连续阅读，英文原文用于逐句核对，关键术语保留 English keyword。</p></div><button onClick={() => void translate()} disabled={!paper.abstract || busy !== null}><Languages size={16} />{translationLoading ? "翻译中" : "翻译摘要"}</button></div>
          <div className="reading-mode-tabs"><button className={mode === "source" ? "active" : ""} onClick={() => setMode("source")}>论文原文</button><button className={mode === "chinese" ? "active" : ""} onClick={() => setMode("chinese")}>中文阅读</button><button className={mode === "bilingual" ? "active" : ""} onClick={() => setMode("bilingual")}>双语对照</button></div>
          <div className={`abstract-reading-grid mode-${mode}`}>
            {(mode === "source" || mode === "bilingual") && <article className="abstract-pane abstract-pane-source"><header><span>ORIGINAL ABSTRACT</span><h3>论文原文</h3></header><p>{preview(paper)}</p></article>}
            {(mode === "chinese" || mode === "bilingual") && <article className="abstract-pane abstract-pane-chinese"><header><span>CHINESE READING</span><h3>中文理解</h3></header>{translation?.translatedText ? <p>{translation.translatedText}</p> : <div className="auto-translation-placeholder"><strong>{translationLoading ? "正在生成中文译文" : "中文译文尚未生成"}</strong><p>{translationLoading ? "正在保留术语、数字和原文语气。" : apiConfigured === false ? "请先前往设置配置 API Key，原文仍可在“论文原文”中查看。" : "点击“翻译摘要”即可生成中文阅读稿。"}</p><button type="button" onClick={() => void translate()} disabled={!paper.abstract || busy !== null}><Languages size={15} />生成中文译文</button></div>}</article>}
          </div>
          {translation?.warnings && translation.warnings.length > 0 && <div className="translation-warnings">{translation.warnings.join("；")}</div>}
        </section>
        <PaperFullTextReader paper={paper} paperId={paperId} defaultMode={preferences.readingLanguage} translationTier={preferences.translationTier} translationConcurrency={preferences.translationConcurrency} />
      </article>
      <aside className="paper-detail-aside"><section><span>论文信息</span><dl>{paper.doi && <><dt>DOI</dt><dd>{paper.doi}</dd></>}{paper.arxivId && <><dt>arXiv</dt><dd>{paper.arxivId}</dd></>}<dt>来源</dt><dd>{provider(paper.source)}</dd><dt>获取时间</dt><dd>{new Date(paper.fetchedAt).toLocaleDateString("zh-CN")}</dd></dl></section><section><span>下一步</span><button onClick={() => void learn()}><GraduationCap size={16} />解析、问答与做题</button></section></aside>
    </div>
  </main>;
}

const DEFAULT_AGENT: ApiAgentConfig = { baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat", systemPrompt: "", configured: false };
export function SettingsPage({ preferences, onPreferences }: PageProps) {
  const [draft, setDraft] = useState(preferences); const [agent, setAgent] = useState(DEFAULT_AGENT); const [apiKey, setApiKey] = useState(""); const [busy, setBusy] = useState(false); const [interest, setInterest] = useState(""); const [jobs, setJobs] = useState<PaperTranslationJob[]>([]);
  useEffect(() => { void loadApiAgentConfig().then(setAgent); }, []);
  useEffect(() => { void loadTranslationJobs().then(setJobs).catch(() => undefined); }, []);
  const saveAll = async () => { const autoAll = draft.translationTier === "max"; setBusy(true); try { const next = await savePreferences(draft); onPreferences(next); const nextAgent = await saveApiAgentConfig({ baseUrl: agent.baseUrl, model: agent.model, systemPrompt: agent.systemPrompt, apiKey }); setAgent(nextAgent); setApiKey(""); if (autoAll && nextAgent.configured) { const created = await createTranslationJobs({ scope: "all", tier: "max", concurrency: draft.translationConcurrency }); setJobs((old) => [...created, ...old]); toast[created.length ? "success" : "info"](created.length ? `已开启全自动翻译，加入 ${created.length} 篇本地论文` : "全自动翻译已保持运行，当前没有新的本地论文需要加入"); } else if (autoAll) { toast.info("设置已保存；请配置 API Key 后再次保存，自动处理本机已发现的论文"); } else { toast.success("设置已保存"); } } catch (error) { toast.error(error instanceof Error ? error.message : "保存失败"); } finally { setBusy(false); } };
  const addInterest = () => { const value = interest.trim(); if (!value) return; setDraft((old) => ({ ...old, interests: [...new Set([...old.interests, value])].slice(0, 12) })); setInterest(""); };
  const exportData = async () => { const data = await exportPaperData(); const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })); const link = document.createElement("a"); link.href = url; link.download = `moereview-paper-data-${new Date().toISOString().slice(0, 10)}.json`; link.click(); URL.revokeObjectURL(url); };
  const batchTranslate = async () => { if (draft.translationScope === "current") return toast.error("当前论文请在论文详情页开始翻译"); setBusy(true); try { const created = await createTranslationJobs({ scope: draft.translationScope, tier: draft.translationTier, concurrency: draft.translationConcurrency }); setJobs((old) => [...created, ...old]); toast.success(`已加入 ${created.length} 篇论文`); } catch (error) { toast.error(error instanceof Error ? error.message : "创建翻译任务失败"); } finally { setBusy(false); } };
  const changeJob = async (job: PaperTranslationJob, action: "pause" | "resume" | "cancel") => { try { const next = await controlTranslationJob(job.id, action); setJobs((old) => old.map((item) => item.id === job.id ? next : item)); } catch (error) { toast.error(error instanceof Error ? error.message : "任务操作失败"); } };
  return <main className="research-page settings-page"><header className="page-head"><div><span className="page-kicker">SETTINGS</span><h1>设置</h1><p>AI、论文来源、推荐、阅读和外观配置集中在这里。</p></div><button className="settings-save" onClick={() => void saveAll()} disabled={busy}>{busy ? "保存中" : "保存设置"}</button></header><div className="settings-layout"><nav><a href="#ai">AI 服务</a><a href="#sources">论文来源</a><a href="#reading">阅读与翻译</a><a href="#recommendation">推荐</a><a href="#appearance">外观</a><a href="#data">数据</a></nav><div className="settings-sections"><SettingsSection id="ai" title="AI 服务" description="用于一键摘要、翻译和论文学习。"><div className="settings-grid"><label>Base URL<input value={agent.baseUrl} onChange={(e) => setAgent((old) => ({ ...old, baseUrl: e.target.value }))} /></label><label>模型<input value={agent.model} onChange={(e) => setAgent((old) => ({ ...old, model: e.target.value }))} /></label><label className="full">API Key<input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={agent.configured ? "已配置，留空则不修改" : "输入 API Key"} /></label><label className="full">系统提示<textarea rows={4} value={agent.systemPrompt} onChange={(e) => setAgent((old) => ({ ...old, systemPrompt: e.target.value }))} /></label></div><button onClick={() => void testApiAgent().then((ok) => toast[ok ? "success" : "error"](ok ? "连接测试成功" : "模型响应不符合预期"))}>测试连接</button></SettingsSection><SettingsSection id="sources" title="论文来源" description="控制候选论文来源与每页数量。"><Toggle label="arXiv" checked={draft.providerArxiv} onChange={(value) => setDraft((old) => ({ ...old, providerArxiv: value }))} /><Toggle label="Semantic Scholar" checked={draft.providerSemanticScholar} onChange={(value) => setDraft((old) => ({ ...old, providerSemanticScholar: value }))} /><label>每页结果数量<input type="number" min={6} max={20} value={draft.searchLimit} onChange={(e) => setDraft((old) => ({ ...old, searchLimit: Number(e.target.value) }))} /></label></SettingsSection><SettingsSection id="reading" title="阅读与翻译" description="默认中文阅读，并集中控制翻译任务。"><div className="settings-grid"><label>默认阅读语言<select value={draft.readingLanguage} onChange={(e) => setDraft((old) => ({ ...old, readingLanguage: e.target.value as AppPreferences["readingLanguage"] }))}><option value="source">原文</option><option value="chinese">中文</option><option value="bilingual">双语对照</option></select></label><label>正文宽度<select value={draft.contentWidth} onChange={(e) => setDraft((old) => ({ ...old, contentWidth: e.target.value as AppPreferences["contentWidth"] }))}><option value="narrow">窄</option><option value="standard">标准</option><option value="wide">宽</option></select></label><label>翻译档位<select value={draft.translationTier} onChange={(e) => { const value = e.target.value as AppPreferences["translationTier"]; setDraft((old) => ({ ...old, translationTier: value, translationScope: value === "max" ? "all" : old.translationScope })); }}><option value="low">低档：按需翻译</option><option value="medium">中档：当前论文</option><option value="high">高档：后台批量</option><option value="max">最高档：自动翻译全部本地论文</option></select></label><label>自动翻译范围<select value={draft.translationScope} onChange={(e) => setDraft((old) => ({ ...old, translationScope: e.target.value as AppPreferences["translationScope"] }))}><option value="current">当前论文</option><option value="favorites">全部收藏</option><option value="read-later">稍后阅读</option><option value="queue">自选队列</option><option value="all">全部本地论文</option></select></label><label>最大并发数量<input type="number" min="1" max="16" value={draft.translationConcurrency} onChange={(e) => setDraft((old) => ({ ...old, translationConcurrency: Math.min(16, Math.max(1, Number(e.target.value) || 1)) }))} /></label><label>字号比例<input type="range" min="0.9" max="1.2" step="0.05" value={draft.fontScale} onChange={(e) => setDraft((old) => ({ ...old, fontScale: Number(e.target.value) }))} /></label></div><label className="settings-prompt">翻译提示词<textarea rows={5} value={draft.translationPrompt} onChange={(e) => setDraft((old) => ({ ...old, translationPrompt: e.target.value }))} /></label><label className="settings-prompt">大白话总结提示词<textarea rows={4} value={draft.summaryPrompt} onChange={(e) => setDraft((old) => ({ ...old, summaryPrompt: e.target.value }))} /></label><div className="translation-batch-actions"><button className="primary" onClick={() => void batchTranslate()} disabled={busy || draft.translationScope === "current"}><Languages size={15} />开始批量翻译</button><small>{draft.translationTier === "max" ? "最高档会自动处理本机已发现的论文，不会扫描全网。" : draft.translationScope === "current" ? "当前论文请在详情页开始" : "只处理已明确选择的论文范围，翻译结果保存到本机"}</small></div>{jobs.length > 0 && <div className="translation-job-list"><header><strong>翻译任务</strong><button onClick={() => void loadTranslationJobs().then(setJobs)}>刷新</button></header>{jobs.slice(0, 8).map((job) => <div className="translation-job" key={job.id}><div><strong>{job.paperTitle}</strong><small>{job.status === "completed" ? "已完成" : job.status === "running" ? `翻译中 ${job.completed}/${job.total || ""}` : job.status === "paused" ? "已暂停" : job.status === "failed" ? job.error || "失败" : job.status === "cancelled" ? "已取消" : "排队中"}</small></div><div>{["queued", "running"].includes(job.status) && <button onClick={() => void changeJob(job, "pause")}>暂停</button>}{["paused", "failed"].includes(job.status) && <button onClick={() => void changeJob(job, "resume")}>继续</button>}{!["completed", "cancelled"].includes(job.status) && <button onClick={() => void changeJob(job, "cancel")}>取消</button>}</div></div>)}</div>}</SettingsSection><SettingsSection id="recommendation" title="推荐" description="兴趣和行为只保存在本机。"><Toggle label="使用本地阅读行为改进推荐" checked={draft.personalizationEnabled} onChange={(value) => setDraft((old) => ({ ...old, personalizationEnabled: value }))} /><div className="interest-editor">{draft.interests.map((item) => <button key={item} onClick={() => setDraft((old) => ({ ...old, interests: old.interests.filter((value) => value !== item) }))}>{item} ×</button>)}<div><input value={interest} onChange={(e) => setInterest(e.target.value)} placeholder="添加兴趣关键词" /><button onClick={addInterest}>添加</button></div></div><button className="danger-text" onClick={() => void clearRecommendationHistory().then(() => toast.success("推荐记录已清除"))}>清除推荐行为记录</button></SettingsSection><SettingsSection id="appearance" title="外观" description="主题、导航和信息密度。"><div className="theme-options">{(["minimal", "dark", "anime", "gradient"] as const).map((preset) => <button className={draft.themePreset === preset ? "active" : ""} key={preset} onClick={() => setDraft((old) => ({ ...old, themePreset: preset }))}><i className={`theme-swatch ${preset}`} /><span>{{ minimal: "简约", dark: "深色", anime: "二次元", gradient: "渐变" }[preset]}</span></button>)}</div><div className="settings-grid"><label>明暗模式<select value={draft.colorMode} onChange={(e) => setDraft((old) => ({ ...old, colorMode: e.target.value as AppPreferences["colorMode"] }))}><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></label><label>强调色<input type="color" value={draft.accentColor} onChange={(e) => setDraft((old) => ({ ...old, accentColor: e.target.value }))} /></label><label>导航位置<select value={draft.navPosition} onChange={(e) => setDraft((old) => ({ ...old, navPosition: e.target.value as AppPreferences["navPosition"] }))}><option value="left">左侧</option><option value="right">右侧</option><option value="bottom">底部</option></select></label><label>导航显示<select value={draft.navDisplay} onChange={(e) => setDraft((old) => ({ ...old, navDisplay: e.target.value as AppPreferences["navDisplay"] }))}><option value="labelled">图标和文字</option><option value="icons">仅图标</option><option value="auto">自动</option></select></label><label>内容密度<select value={draft.density} onChange={(e) => setDraft((old) => ({ ...old, density: e.target.value as AppPreferences["density"] }))}><option value="comfortable">舒适</option><option value="compact">紧凑</option></select></label></div></SettingsSection><SettingsSection id="data" title="数据" description="导出论文收藏、摘要和本地行为。"><button onClick={() => void exportData()}>导出论文数据</button></SettingsSection></div></div></main>;
}

function SettingsSection({ id, title, description, children }: { id: string; title: string; description: string; children: React.ReactNode }) { return <section id={id} className="settings-section"><header><h2>{title}</h2><p>{description}</p></header><div>{children}</div></section>; }
function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) { return <label className="setting-toggle"><span>{label}</span><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /></label>; }
