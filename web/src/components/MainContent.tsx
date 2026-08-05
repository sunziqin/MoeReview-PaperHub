import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, MessageCircle, Quote } from "lucide-react";
import { toast } from "sonner";
import { getRememberedScrollTop, rememberReadingScroll, useExamForgeStore } from "../store";
import type { ClientEvent } from "../types";
import { useWorkspaceStore } from "../workspaceStore";
import { CardView } from "./CardView";
import { EmptyView } from "./EmptyView";
import { PageFallbackView } from "./PageFallbackView";
import { PageNavigator } from "./PageNavigator";
import { QuizView } from "./QuizView";
import { ResultView } from "./ResultView";
import { ReviewTimeline } from "./ReviewTimeline";

interface MainContentProps {
  sendEvent: (event: ClientEvent) => void;
}

interface SelectionState {
  text: string;
  x: number;
  y: number;
}

const BOUNDARY_CUE_DISTANCE = 96;
const BOUNDARY_ACTIVATE_DISTANCE = 4;
const BOUNDARY_RESET_DISTANCE = 180;
const BOUNDARY_GESTURE_GAP_MS = 180;

function isEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(
    target.closest(
      "input, textarea, [contenteditable='true'], .code-editor, .qa-drawer, .collapsible",
    ),
  );
}

function SelectionTools() {
  const [selection, setSelection] = useState<SelectionState | null>(null);
  const [copied, setCopied] = useState(false);
  const currentPage = useExamForgeStore((state) => state.pages[state.currentPageIndex] ?? null);
  const addQuoteToDock = useWorkspaceStore((state) => state.addQuote);
  const focusDock = useWorkspaceStore((state) => state.focusDock);
  const requestQa = useWorkspaceStore((state) => state.requestQa);

  const clear = useCallback(() => {
    setSelection(null);
    setCopied(false);
  }, []);

  useEffect(() => {
    const update = () => {
      const activeSelection = window.getSelection();
      const text = activeSelection?.toString().trim() ?? "";
      if (!activeSelection || !text || activeSelection.rangeCount === 0) {
        clear();
        return;
      }

      const anchor = activeSelection.anchorNode?.parentElement;
      if (!anchor?.closest(".document-body, .review-page-body, .quiz-view, .q-card, .result-view")) {
        clear();
        return;
      }

      const rect = activeSelection.getRangeAt(0).getBoundingClientRect();
      if (!rect.width && !rect.height) {
        clear();
        return;
      }

      setSelection({
        text,
        x: Math.min(window.innerWidth - 112, Math.max(112, rect.left + rect.width / 2)),
        y: Math.max(64, rect.top - 12),
      });
    };

    document.addEventListener("mouseup", update);
    document.addEventListener("keyup", update);
    window.addEventListener("scroll", clear, true);
    return () => {
      document.removeEventListener("mouseup", update);
      document.removeEventListener("keyup", update);
      window.removeEventListener("scroll", clear, true);
    };
  }, [clear]);

  if (!selection) return null;

  const quote = {
    text: selection.text,
    pageId: currentPage?.id,
    pageTitle: currentPage?.title,
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(selection.text);
      setCopied(true);
      window.setTimeout(clear, 700);
    } catch (error) {
      console.error("复制选中文本失败", error);
      toast.error("复制失败，请检查剪贴板权限");
    }
  };

  const addQuote = () => {
    addQuoteToDock(quote);
    focusDock();
    clear();
  };

  const explain = () => {
    requestQa("解释这段内容，并指出理解它时最容易混淆的地方。", [quote]);
    clear();
  };

  return (
    <div className="selection-tools" style={{ left: selection.x, top: selection.y }} onMouseDown={(event) => event.preventDefault()}>
      <button type="button" onClick={copy} aria-label="复制选中内容" title="复制">
        {copied ? <Check size={15} /> : <Copy size={15} />}
      </button>
      <button type="button" onClick={addQuote} aria-label="引用到指令坞" title="引用到指令坞">
        <Quote size={15} />
      </button>
      <button type="button" onClick={explain} aria-label="即时解释选中内容" title="即时解释">
        <MessageCircle size={15} />
      </button>
    </div>
  );
}

export function MainContent({ sendEvent }: MainContentProps) {
  const view = useExamForgeStore((state) => state.currentView);
  const pages = useExamForgeStore((state) => state.pages);
  const currentPageIndex = useExamForgeStore((state) => state.currentPageIndex);
  const currentSessionId = useExamForgeStore((state) => state.currentSessionId);
  const nextPage = useExamForgeStore((state) => state.nextPage);
  const prevPage = useExamForgeStore((state) => state.prevPage);
  const readingMode = useWorkspaceStore((state) => state.readingMode);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const previousLocationRef = useRef<{ sessionId: string; pageId: string; readingMode: typeof readingMode } | null>(null);
  const pageEntryRef = useRef<"saved" | "top" | "bottom">("saved");
  const boundaryArmedRef = useRef<"next" | "prev" | null>(null);
  const lastBoundaryWheelRef = useRef(0);
  const [boundaryDirection, setBoundaryDirection] = useState<"next" | "prev" | null>(null);
  const currentPage = pages[currentPageIndex] ?? null;
  const canNext = currentPageIndex >= 0 && currentPageIndex < pages.length - 1;
  const boundaryTargetPage = boundaryDirection
    ? pages[currentPageIndex + (boundaryDirection === "next" ? 1 : -1)]
    : null;

  const resetBoundary = useCallback(() => {
    boundaryArmedRef.current = null;
    lastBoundaryWheelRef.current = 0;
    setBoundaryDirection(null);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const previousLocation = previousLocationRef.current;
    if (canvas && previousLocation?.readingMode === "focus") {
      rememberReadingScroll(previousLocation.sessionId, previousLocation.pageId, canvas.scrollTop);
    }

    previousLocationRef.current = currentPage ? { sessionId: currentSessionId, pageId: currentPage.id, readingMode } : null;
    resetBoundary();
    if (!canvas || readingMode !== "focus") return;
    const entry = pageEntryRef.current;
    pageEntryRef.current = "saved";
    const savedTop = currentPage ? getRememberedScrollTop(currentSessionId, currentPage.id) : 0;
    requestAnimationFrame(() => {
      const top = entry === "bottom"
        ? Math.max(0, canvas.scrollHeight - canvas.clientHeight)
        : entry === "top" ? 0 : savedTop;
      canvas.scrollTo({ top, behavior: "instant" });
    });
  }, [currentPage, currentSessionId, readingMode, resetBoundary]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !currentPage || readingMode !== "focus") return;

    let saveTimer = 0;
    const savePosition = () => {
      window.clearTimeout(saveTimer);
      rememberReadingScroll(currentSessionId, currentPage.id, canvas.scrollTop);
    };
    const scheduleSave = () => {
      window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(savePosition, 220);
    };

    canvas.addEventListener("scroll", scheduleSave, { passive: true });
    window.addEventListener("beforeunload", savePosition);
    return () => {
      canvas.removeEventListener("scroll", scheduleSave);
      window.removeEventListener("beforeunload", savePosition);
      savePosition();
    };
  }, [currentPage, currentSessionId, readingMode]);

  useEffect(() => {
    if (readingMode !== "focus" || view === "quiz") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditingTarget(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
      const canvas = canvasRef.current;
      if (!canvas) return;

      if (event.key.toLowerCase() === "j" && canNext) {
        event.preventDefault();
        pageEntryRef.current = "top";
        nextPage();
        return;
      }
      if (event.key.toLowerCase() === "k" && currentPageIndex > 0) {
        event.preventDefault();
        pageEntryRef.current = "bottom";
        prevPage();
        return;
      }
      if (event.code !== "Space") return;

      event.preventDefault();
      const atBottom = canvas.scrollHeight - canvas.scrollTop - canvas.clientHeight < 6;
      if (!event.shiftKey && atBottom && canNext) {
        pageEntryRef.current = "top";
        nextPage();
        return;
      }
      canvas.scrollBy({
        top: (event.shiftKey ? -1 : 1) * canvas.clientHeight * 0.82,
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      });
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canNext, currentPageIndex, nextPage, prevPage, readingMode, view]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || readingMode !== "focus") return;

    const onWheel = (event: globalThis.WheelEvent) => {
      if (isEditingTarget(event.target) || Math.abs(event.deltaY) < 2) return;
      const remainingBottom = canvas.scrollHeight - canvas.scrollTop - canvas.clientHeight;
      const projectedBottom = remainingBottom - Math.max(0, event.deltaY);
      const projectedTop = canvas.scrollTop + Math.min(0, event.deltaY);
      const atTop = canvas.scrollTop <= BOUNDARY_ACTIVATE_DISTANCE;
      const atBottom = remainingBottom <= BOUNDARY_ACTIVATE_DISTANCE;
      const nearTop = projectedTop <= BOUNDARY_CUE_DISTANCE;
      const nearBottom = projectedBottom <= BOUNDARY_CUE_DISTANCE;
      const direction = event.deltaY > 0 ? "next" : "prev";
      if (boundaryArmedRef.current && boundaryArmedRef.current !== direction) {
        resetBoundary();
      }
      const canMove = direction === "next" ? canNext && nearBottom : currentPageIndex > 0 && nearTop;
      if (!canMove) {
        if (canvas.scrollTop > BOUNDARY_RESET_DISTANCE && remainingBottom > BOUNDARY_RESET_DISTANCE) resetBoundary();
        return;
      }

      const now = Date.now();
      const gestureGap = now - lastBoundaryWheelRef.current;
      lastBoundaryWheelRef.current = now;
      if (boundaryArmedRef.current !== direction) {
        boundaryArmedRef.current = direction;
        setBoundaryDirection(direction);
        return;
      }

      const atActiveEdge = direction === "next" ? atBottom : atTop;
      if (!atActiveEdge || gestureGap < BOUNDARY_GESTURE_GAP_MS) return;

      event.preventDefault();
      if (direction === "next") {
        pageEntryRef.current = "top";
        nextPage();
      } else {
        pageEntryRef.current = "bottom";
        prevPage();
      }
    };

    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [canNext, currentPageIndex, nextPage, prevPage, readingMode, resetBoundary]);

  return (
    <main className={`main-content reading-${readingMode}${view === "empty" ? " view-empty" : ""}`}>
      {pages.length > 0 && <PageNavigator sendEvent={sendEvent} />}
      <div className="learning-canvas" ref={canvasRef}>
        {readingMode === "review" ? (
          <div className="view-stage review-stage"><ReviewTimeline /></div>
        ) : (
          <div className={`view-stage${view === "empty" ? " empty-stage" : ""}`} key={`${currentPageIndex}-${view}`}>
              {view === "empty" && <EmptyView />}
              {view === "card" && <CardView />}
              {view === "quiz" && <QuizView sendEvent={sendEvent} />}
              {view === "result" && <ResultView />}
              {(view === "system" || view === "mixed") && <PageFallbackView />}
          </div>
        )}
        {readingMode === "focus" && pages.length > 1 && (
          <div
            className={`page-boundary-cue${boundaryDirection ? " is-visible" : ""}`}
            role="status"
            aria-live="polite"
            aria-hidden={!boundaryDirection}
          >
            <span>{boundaryDirection === "next" ? "已到本页末尾，再向下滚动进入下一页" : "已到本页开头，再向上滚动返回上一页"}</span>
            <strong>{boundaryTargetPage?.title}</strong>
          </div>
        )}
      </div>
      <SelectionTools />
    </main>
  );
}
