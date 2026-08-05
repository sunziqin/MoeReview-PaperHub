import { ArrowLeft, BrainCircuit, Files, Layers3, ListChecks, MessagesSquare, Send, Settings2 } from "lucide-react";
import { useEffect, useState, type KeyboardEvent } from "react";
import { toast } from "sonner";
import { loadApiAgentConfig } from "../../services/apiAgent";
import { runLearningTurn, type LearningIntent } from "../../services/learningAgent";
import { loadPaperDetail } from "../../services/paperWorkspace";
import { useExamForgeStore } from "../../store";
import type { ClientEvent } from "../../types";
import { useWorkspaceStore } from "../../workspaceStore";
import { MainContent } from "../MainContent";
import { ProgressBar } from "../ProgressBar";
import { TopBar } from "../TopBar";

interface Props {
  sendEvent: (event: ClientEvent) => boolean;
  navigate: (path: string) => void;
}

const ACTIONS: Array<{ intent: LearningIntent; label: string; icon: typeof BrainCircuit }> = [
  { intent: "overview", label: "整体解析", icon: BrainCircuit },
  { intent: "chapter", label: "章节讲解", icon: Layers3 },
  { intent: "cards", label: "知识卡片", icon: Files },
  { intent: "quiz-choice", label: "选择题", icon: ListChecks },
  { intent: "quiz-short", label: "简答题", icon: MessagesSquare },
];

export function LearningWorkspace({ sendEvent, navigate }: Props) {
  const currentSessionId = useExamForgeStore((state) => state.currentSessionId);
  const currentSession = useExamForgeStore((state) => state.sessions.find((session) => session.id === state.currentSessionId));
  const queryPaperId = new URLSearchParams(window.location.search).get("paper") ?? undefined;
  const paperId = queryPaperId ?? currentSession?.paperId;
  const [paperTitle, setPaperTitle] = useState("");
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<LearningIntent | null>(null);

  useEffect(() => { void loadApiAgentConfig().then((config) => setConfigured(config.configured)).catch(() => setConfigured(false)); }, []);
  useEffect(() => {
    if (!paperId) { setPaperTitle(""); return; }
    void loadPaperDetail(paperId).then((detail) => setPaperTitle(detail.paper.title)).catch(() => setPaperTitle("当前论文"));
  }, [paperId]);

  const run = async (intent: LearningIntent, prompt = "", selectedPassage?: string) => {
    if (!currentSessionId) { toast.error("学习会话尚未加载完成"); return; }
    if (!configured) { navigate("/settings#ai"); return; }
    setBusy(intent);
    try {
      await runLearningTurn({ sessionId: currentSessionId, paperId, intent, prompt, selectedPassage });
      toast.success(intent.startsWith("quiz-") ? "练习已生成" : "学习内容已生成");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "学习内容生成失败");
    } finally {
      setBusy(null);
    }
  };

  return <div className="learning-workspace api-learning-workspace">
    <TopBar sendEvent={sendEvent} apiLearning />
    <ProgressBar />
    <div className="paper-learning-context">
      <div className="paper-learning-identity">
        {paperId ? <button type="button" onClick={() => navigate(`/paper/${encodeURIComponent(paperId)}`)} title="返回原论文"><ArrowLeft size={15} /></button> : null}
        <span><small>{paperId ? "论文学习空间" : "学习空间"}</small><strong>{paperTitle || currentSession?.title || "学习会话"}</strong></span>
      </div>
      <div className="paper-learning-actions">{ACTIONS.map((action) => <button type="button" key={action.intent} disabled={busy !== null || configured === null} onClick={() => void run(action.intent)}><action.icon size={15} />{busy === action.intent ? "生成中" : action.label}</button>)}</div>
      {configured === false && <button className="learning-config-link" type="button" onClick={() => navigate("/settings#ai")}><Settings2 size={14} />配置统一 AI 服务</button>}
    </div>
    <MainContent sendEvent={sendEvent} />
    <LearningTutorBar busy={busy !== null} configured={configured !== false} onSend={(prompt, passage) => run("ask", prompt, passage)} onSettings={() => navigate("/settings#ai")} />
  </div>;
}

function LearningTutorBar({ busy, configured, onSend, onSettings }: { busy: boolean; configured: boolean; onSend: (prompt: string, passage?: string) => Promise<void>; onSettings: () => void }) {
  const [text, setText] = useState("");
  const quotes = useWorkspaceStore((state) => state.quotes);
  const clearQuotes = useWorkspaceStore((state) => state.clearQuotes);
  const send = async () => {
    const prompt = text.trim();
    if (!prompt || busy) return;
    const passage = quotes.length ? quotes.map((quote) => `${quote.pageTitle ?? "引用"}\n${quote.text}`).join("\n\n") : undefined;
    await onSend(prompt, passage);
    setText("");
    clearQuotes();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); }
  };
  return <footer className="learning-tutor-bar">
    {quotes.length > 0 && <div className="learning-tutor-quotes">已引用 {quotes.length} 段学习内容</div>}
    <div><BrainCircuit size={18} /><textarea rows={1} value={text} onChange={(event) => setText(event.target.value)} onKeyDown={onKeyDown} placeholder={configured ? "向论文导师提问，或引用页面中的内容继续追问" : "请先在设置中配置 AI 服务"} disabled={!configured || busy} /><button type="button" onClick={onSettings} title="AI 设置"><Settings2 size={16} /></button><button className="primary" type="button" onClick={() => void send()} disabled={!configured || busy || !text.trim()} title="发送"><Send size={17} /></button></div>
  </footer>;
}
