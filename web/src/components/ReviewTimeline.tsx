import { useEffect, useRef } from "react";
import { ArrowUpRight } from "lucide-react";
import { useExamForgeStore } from "../store";
import type { LearningPage, Quiz, Result } from "../types";
import { useWorkspaceStore } from "../workspaceStore";
import { MarkdownRenderer } from "./MarkdownRenderer";

const KIND_LABELS: Record<string, string> = {
  card: "讲解",
  quiz: "练习",
  result: "反馈",
  system: "阶段",
  mixed: "综合",
};

function cardContent(page: LearningPage): string {
  if (typeof page.content === "string") return page.content;
  const content = page.content as Record<string, unknown>;
  return String(content.content ?? content.markdown ?? content.body ?? content.text ?? page.summary ?? "");
}

function ReviewPageBody({ page }: { page: LearningPage }) {
  if (page.kind === "card") {
    return <MarkdownRenderer content={cardContent(page)} mode="review" />;
  }

  if (page.kind === "quiz") {
    const quiz = page.content as Partial<Quiz>;
    return (
      <ol className="review-question-list">
        {(quiz.questions ?? []).map((question) => <li key={question.id}>{question.question}</li>)}
      </ol>
    );
  }

  if (page.kind === "result") {
    const result = page.content as Partial<Result>;
    const accuracy = Math.round((result.summary?.accuracy ?? 0) * 100);
    return <p className="review-result-line">本页练习正确率 <strong>{accuracy}%</strong></p>;
  }

  if (typeof page.content === "string") {
    return <MarkdownRenderer content={page.content} mode="review" />;
  }

  return <p>{page.summary || "阶段节点"}</p>;
}

export function ReviewTimeline() {
  const pages = useExamForgeStore((state) => state.pages);
  const currentPageIndex = useExamForgeStore((state) => state.currentPageIndex);
  const goToPage = useExamForgeStore((state) => state.goToPage);
  const setReadingMode = useWorkspaceStore((state) => state.setReadingMode);
  const initialPageIdRef = useRef(pages[currentPageIndex]?.id);

  useEffect(() => {
    const initialPageId = initialPageIdRef.current;
    if (!initialPageId) return;
    requestAnimationFrame(() => {
      document.getElementById(`review-page-${initialPageId}`)?.scrollIntoView({ block: "start" });
    });
  }, []);

  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".learning-canvas");
    if (!root) return;
    const elements = pages
      .map((page) => document.getElementById(`review-page-${page.id}`))
      .filter((element): element is HTMLElement => Boolean(element));
    if (elements.length === 0) return;

    let frame = 0;
    const updateActivePage = () => {
      frame = 0;
      const rootRect = root.getBoundingClientRect();
      const readingLine = rootRect.top + root.clientHeight * 0.32;
      let activeIndex = 0;
      for (let index = 0; index < elements.length; index += 1) {
        if (elements[index].getBoundingClientRect().top <= readingLine) activeIndex = index;
        else break;
      }
      if (activeIndex !== useExamForgeStore.getState().currentPageIndex) goToPage(activeIndex);
    };
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(updateActivePage);
    };

    updateActivePage();
    root.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      root.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [goToPage, pages]);

  const focusPage = (index: number) => {
    goToPage(index);
    setReadingMode("focus");
  };

  return (
    <div className="review-timeline" aria-label="连续回顾">
      <header className="review-head">
        <span>连续回顾</span>
        <h2>把学习过程连成一条思路</h2>
        <p>页面边界、练习和反馈保持清晰，需要深入时再回到分页专注。</p>
      </header>
      {pages.map((page, index) => (
        <article
          className={`review-page review-page-${page.kind}${index === currentPageIndex ? " active" : ""}`}
          key={page.id}
          id={`review-page-${page.id}`}
        >
          <header className="review-page-head">
            <div>
              <span>{String(index + 1).padStart(2, "0")} · {KIND_LABELS[page.kind] ?? page.kind}</span>
              <h3>{page.title}</h3>
              {page.summary && <p>{page.summary}</p>}
            </div>
            <button type="button" onClick={() => focusPage(index)}>
              专注此页 <ArrowUpRight size={15} />
            </button>
          </header>
          <div className="review-page-body">
            <ReviewPageBody page={page} />
          </div>
        </article>
      ))}
    </div>
  );
}
