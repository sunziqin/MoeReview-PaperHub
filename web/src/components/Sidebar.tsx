import { useEffect, useMemo, useState } from "react";
import {
  BookOpenText,
  Bookmark,
  ChevronDown,
  Library,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Sparkles,
  X,
  XCircle,
} from "lucide-react";
import { useExamForgeStore } from "../store";
import type { ClientEvent } from "../types";
import { FavoritesView } from "./FavoritesView";
import { LearningNotesView } from "./LearningNotesView";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { PaperSearchView } from "./PaperSearchView";
import { SessionList } from "./SessionList";
import { WidgetRenderer } from "./WidgetRenderer";
import { WrongAnswersView } from "./WrongAnswersView";

type SidebarTab = "dashboard" | "papers" | "wrong" | "favorites" | "notes";

interface SidebarProps {
  sendEvent: (event: ClientEvent) => void;
}

const TABS = [
  { key: "dashboard" as const, label: "学习概览", icon: Sparkles },
  { key: "papers" as const, label: "论文", icon: Search },
  { key: "wrong" as const, label: "错题", icon: XCircle },
  { key: "favorites" as const, label: "收藏", icon: Bookmark },
  { key: "notes" as const, label: "笔记", icon: BookOpenText },
];

export function Sidebar({ sendEvent }: SidebarProps) {
  const [activeTab, setActiveTab] = useState<SidebarTab>("dashboard");
  const [panelOpen, setPanelOpen] = useState(false);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const dashboardWidgets = useExamForgeStore((s) => s.dashboardWidgets);
  const guidance = useExamForgeStore((s) => s.guidance);
  const wrongCount = useExamForgeStore((s) => s.wrongAnswers.length);
  const favoritesCount = useExamForgeStore((s) => s.favorites.length);
  const sessions = useExamForgeStore((s) => s.sessions);
  const currentSessionId = useExamForgeStore((s) => s.currentSessionId);
  const sessionTitle = useExamForgeStore((s) => s.sessionTitle);

  const currentSessionTitle = useMemo(() => {
    const current = sessions.find((session) => session.id === currentSessionId);
    return current?.title?.trim() || sessionTitle || "未命名学习空间";
  }, [currentSessionId, sessionTitle, sessions]);

  useEffect(() => {
    document.documentElement.dataset.library = panelOpen ? "open" : "closed";
    return () => {
      delete document.documentElement.dataset.library;
    };
  }, [panelOpen]);

  const selectTab = (tab: SidebarTab) => {
    setActiveTab(tab);
    setPanelOpen(true);
    if (tab === "favorites") sendEvent({ event: "get_favorites" });
  };

  const badgeFor = (tab: SidebarTab) => {
    if (tab === "wrong") return wrongCount;
    if (tab === "favorites") return favoritesCount;
    return 0;
  };

  return (
    <aside className={`workspace-nav${panelOpen ? " is-open" : ""}`}>
      <nav className="context-rail" aria-label="学习工具">
        <button
          type="button"
          className="rail-brand"
          onClick={() => setPanelOpen((value) => !value)}
          aria-label={panelOpen ? "收起资料库" : "展开资料库"}
          title={panelOpen ? "收起资料库" : "展开资料库"}
        >
          <PanelLeftOpen size={20} />
        </button>

        <div className="rail-primary">
          {TABS.map((tab) => {
            const badge = badgeFor(tab.key);
            return (
              <button
                type="button"
                key={tab.key}
                className={`rail-action${activeTab === tab.key && panelOpen ? " active" : ""}`}
                onClick={() => selectTab(tab.key)}
                aria-label={tab.label}
                title={tab.label}
              >
                <tab.icon size={19} strokeWidth={1.75} />
                {badge > 0 && <span className="rail-badge">{badge > 99 ? "99+" : badge}</span>}
                <span className="rail-mobile-label">{tab.label}</span>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          className="rail-action rail-library-toggle"
          onClick={() => setPanelOpen((value) => !value)}
          aria-label={panelOpen ? "收起资料库" : "展开资料库"}
          title={panelOpen ? "收起资料库" : "展开资料库"}
        >
          {panelOpen ? <PanelLeftClose size={19} /> : <PanelLeftOpen size={19} />}
        </button>
      </nav>

      <section className="library-panel" aria-hidden={!panelOpen}>
        <header className="library-head">
          <div>
            <span className="library-eyebrow">MoeReview</span>
            <h2>{TABS.find((tab) => tab.key === activeTab)?.label}</h2>
          </div>
          <button type="button" className="library-close" onClick={() => setPanelOpen(false)} aria-label="关闭资料库">
            <X size={18} />
          </button>
        </header>

        <div className={`library-session${sessionsOpen ? " is-open" : ""}`}>
          <button type="button" className="library-session-trigger" onClick={() => setSessionsOpen((value) => !value)} aria-expanded={sessionsOpen}>
            <Library size={16} />
            <span>{currentSessionTitle}</span>
            <ChevronDown size={15} className={sessionsOpen ? "rotated" : ""} />
          </button>
          {sessionsOpen && <SessionList sendEvent={sendEvent} />}
        </div>

        <div className="library-content">
          {activeTab === "dashboard" && (
            <div className="sidebar-dashboard">
              {guidance?.content && (
                <section className={`guidance-panel guidance-${guidance.tone ?? "info"}`}>
                  <div className="guidance-panel-head">
                    <Sparkles size={16} />
                    <strong>{guidance.title?.trim() || "Agent guidance"}</strong>
                  </div>
                  <div className="guidance-panel-body">
                    <MarkdownRenderer content={guidance.content} mode="compact" />
                  </div>
                  {guidance.nextActions && guidance.nextActions.length > 0 && (
                    <ul className="guidance-actions">
                      {guidance.nextActions.map((action, index) => (
                        <li key={`${action}-${index}`}>{action}</li>
                      ))}
                    </ul>
                  )}
                </section>
              )}
              {dashboardWidgets.length > 0 ? dashboardWidgets.map((widget, index) => (
                <WidgetRenderer widget={widget} key={index} index={index} />
              )) : (
                <div className="library-empty">
                  <Sparkles size={20} />
                  <strong>学习概览会在这里生长</strong>
                  <p>开始学习后，进度与重点会逐步出现。</p>
                </div>
              )}
            </div>
          )}
          {activeTab === "papers" && <PaperSearchView sendEvent={sendEvent} />}
          {activeTab === "wrong" && <WrongAnswersView sendEvent={sendEvent} />}
          {activeTab === "favorites" && <FavoritesView sendEvent={sendEvent} onNavigate={() => setPanelOpen(false)} />}
          {activeTab === "notes" && <LearningNotesView onNavigate={() => setPanelOpen(false)} />}
        </div>
      </section>

      {panelOpen && <button type="button" className="library-scrim" onClick={() => setPanelOpen(false)} aria-label="关闭资料库" />}
    </aside>
  );
}
