import { useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ListTree,
  PanelsTopLeft,
  Radio,
  Rows3,
  X,
} from "lucide-react";
import { useExamForgeStore } from "../store";
import type { ClientEvent } from "../types";
import { useWorkspaceStore } from "../workspaceStore";

interface PageNavigatorProps {
  sendEvent: (event: ClientEvent) => void;
}

const KIND_LABELS: Record<string, string> = {
  card: "讲解",
  quiz: "练习",
  result: "反馈",
  system: "阶段",
  mixed: "综合",
};

export function PageNavigator({ sendEvent }: PageNavigatorProps) {
  const pages = useExamForgeStore((state) => state.pages);
  const currentPageIndex = useExamForgeStore((state) => state.currentPageIndex);
  const goToPage = useExamForgeStore((state) => state.goToPage);
  const readingMode = useWorkspaceStore((state) => state.readingMode);
  const setReadingMode = useWorkspaceStore((state) => state.setReadingMode);
  const [open, setOpen] = useState(false);
  const current = pages[currentPageIndex] ?? null;
  const orderedPages = useMemo(
    () => pages.slice().sort((a, b) => a.index - b.index),
    [pages],
  );

  if (!current || pages.length === 0) return null;

  const navigate = (arrayIndex: number) => {
    const target = pages[arrayIndex];
    if (!target) return;
    goToPage(arrayIndex);
    setOpen(false);
    sendEvent({
      event: "activity_log",
      activity: "page_navigate",
      pageId: target.id,
      payload: { index: target.index, title: target.title },
    });
  };

  const canPrev = currentPageIndex > 0;
  const canNext = currentPageIndex < pages.length - 1;
  const progress = ((currentPageIndex + 1) / pages.length) * 100;

  return (
    <>
      <nav className="learning-margin" aria-label="页边学习脉络">
        <button
          type="button"
          className="margin-summary"
          onClick={() => setOpen(true)}
          aria-label="打开学习脉络"
          title="学习脉络"
        >
          <ListTree size={17} />
          <span>{currentPageIndex + 1}</span>
          <i>/</i>
          <span>{pages.length}</span>
        </button>

        <div className="margin-track" aria-hidden="true">
          <span style={{ height: `${progress}%` }} />
        </div>

        <div className="margin-nodes">
          {orderedPages.map((page) => {
            const arrayIndex = pages.findIndex((item) => item.id === page.id);
            const active = page.id === current.id;
            return (
              <button
                type="button"
                key={page.id}
                className={`margin-node margin-node-${page.kind}${active ? " active" : ""}`}
                onClick={() => navigate(arrayIndex)}
                aria-label={`${KIND_LABELS[page.kind] ?? "学习页"}：${page.title}`}
                aria-current={active ? "page" : undefined}
                title={page.title}
              >
                <span>{active ? <Radio size={11} /> : page.index + 1}</span>
              </button>
            );
          })}
        </div>

        <div className="margin-actions">
          <button type="button" onClick={() => navigate(currentPageIndex - 1)} disabled={!canPrev} aria-label="上一学习页" title="上一学习页">
            <ArrowUp size={17} />
          </button>
          <button type="button" onClick={() => navigate(currentPageIndex + 1)} disabled={!canNext} aria-label="下一学习页" title="下一学习页">
            <ArrowDown size={17} />
          </button>
          <button
            type="button"
            onClick={() => setReadingMode(readingMode === "focus" ? "review" : "focus")}
            aria-label={readingMode === "focus" ? "切换到连续回顾" : "切换到分页专注"}
            title={readingMode === "focus" ? "连续回顾" : "分页专注"}
          >
            {readingMode === "focus" ? <Rows3 size={17} /> : <PanelsTopLeft size={17} />}
          </button>
        </div>
      </nav>

      {open && (
        <div className="trail-overlay" role="presentation" onClick={() => setOpen(false)}>
          <section className="trail-drawer" role="dialog" aria-modal="true" aria-label="学习脉络" onClick={(event) => event.stopPropagation()}>
            <header className="trail-drawer-head">
              <div>
                <span>学习脉络</span>
                <h2>沿着理解继续</h2>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="关闭学习脉络">
                <X size={18} />
              </button>
            </header>
            <div className="trail-list">
              {orderedPages.map((page) => {
                const arrayIndex = pages.findIndex((item) => item.id === page.id);
                const active = page.id === current.id;
                return (
                  <button type="button" key={page.id} className={`trail-item${active ? " active" : ""}`} onClick={() => navigate(arrayIndex)}>
                    <span className="trail-node">{active ? <Radio size={14} /> : page.index + 1}</span>
                    <span className="trail-item-copy">
                      <small>{KIND_LABELS[page.kind] ?? page.kind}</small>
                      <strong>{page.title}</strong>
                      {page.summary && <span>{page.summary}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
