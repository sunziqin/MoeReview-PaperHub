import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Code2, Maximize2, Minimize2, RotateCcw } from "lucide-react";
import { buildHtmlPreviewDocument } from "../services/htmlPreviewDocument";
import { useTheme } from "../hooks/useTheme";
import type {
  HostToHtmlPreviewMessage,
  HtmlPreviewToHostMessage,
  MarkdownRenderMode,
} from "../types/htmlPreview";

const DEFAULT_HEIGHT = 320;
const MIN_HEIGHT = 120;
const MAX_AUTO_HEIGHT = 4000;

interface HtmlPreviewProps {
  source: string;
  title?: string;
  height?: string;
  mode: MarkdownRenderMode;
}

function parseInitialHeight(value: string | undefined): number {
  if (!value || value === "auto") return DEFAULT_HEIGHT;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(MIN_HEIGHT, parsed) : DEFAULT_HEIGHT;
}

function HtmlPreviewFallback({ source, mode }: Pick<HtmlPreviewProps, "source" | "mode">) {
  return (
    <div className={`code-block html-preview-fallback is-${mode}`}>
      <pre className="md-pre"><code>{source}</code></pre>
    </div>
  );
}

function HtmlPreviewBase({ source, title, height: requestedHeight, mode }: HtmlPreviewProps) {
  const { resolvedTheme } = useTheme();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const latestThemeRef = useRef(resolvedTheme);
  const [revision, setRevision] = useState(0);
  const [height, setHeight] = useState(() => parseInitialHeight(requestedHeight));
  const [manualHeight, setManualHeight] = useState(requestedHeight !== "auto" && Boolean(requestedHeight));
  const [showSource, setShowSource] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [runtimeError, setRuntimeError] = useState("");
  latestThemeRef.current = resolvedTheme;
  const documentSource = useMemo(
    () => buildHtmlPreviewDocument(source, latestThemeRef.current),
    [source],
  );

  useEffect(() => {
    const onMessage = (event: MessageEvent<HtmlPreviewToHostMessage>) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      if (event.data?.type === "html-preview:resize" && !manualHeight) {
        const nextHeight = Math.min(MAX_AUTO_HEIGHT, Math.max(MIN_HEIGHT, event.data.height));
        setHeight(nextHeight);
        return;
      }
      if (event.data?.type === "html-preview:error") {
        setRuntimeError(event.data.message);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [manualHeight]);

  useEffect(() => {
    const message: HostToHtmlPreviewMessage = {
      type: "html-preview:theme",
      theme: resolvedTheme,
    };
    iframeRef.current?.contentWindow?.postMessage(message, "*");
  }, [resolvedTheme]);

  useEffect(() => {
    const onFullscreenChange = () => setFullscreen(document.fullscreenElement === containerRef.current);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  useEffect(() => {
    const onPointerUp = () => {
      const viewport = containerRef.current?.querySelector<HTMLElement>(".html-preview-viewport");
      if (!viewport || Math.abs(viewport.clientHeight - height) < 2) return;
      setManualHeight(true);
      setHeight(Math.max(MIN_HEIGHT, viewport.clientHeight));
    };
    window.addEventListener("pointerup", onPointerUp);
    return () => window.removeEventListener("pointerup", onPointerUp);
  }, [height]);

  if (mode === "compact" || mode === "streaming") {
    return <HtmlPreviewFallback source={source} mode={mode} />;
  }

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await containerRef.current?.requestFullscreen();
    } catch (error) {
      console.error("切换 HTML 预览全屏失败", error);
    }
  };

  const reload = () => {
    setRuntimeError("");
    setRevision((value) => value + 1);
  };

  return (
    <section
      ref={containerRef}
      className={`html-preview is-${mode}${fullscreen ? " is-fullscreen" : ""}`}
      aria-label={title || "HTML 交互预览"}
    >
      <div className="html-preview-toolbar">
        <span className="html-preview-title">{title || "HTML Preview"}</span>
        {runtimeError && <span className="html-preview-error" title={runtimeError}>运行异常</span>}
        <div className="html-preview-actions">
          <button type="button" onClick={reload} aria-label="重新运行" title="重新运行"><RotateCcw size={15} /></button>
          <button type="button" onClick={() => setShowSource((value) => !value)} aria-label="查看源码" title="查看源码"><Code2 size={15} /></button>
          <button type="button" onClick={toggleFullscreen} aria-label={fullscreen ? "退出全屏" : "全屏查看"} title={fullscreen ? "退出全屏" : "全屏查看"}>
            {fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>
        </div>
      </div>
      <div
        className="html-preview-viewport"
        style={{ "--html-preview-height": `${height}px` } as CSSProperties}
      >
        <iframe
          key={revision}
          ref={iframeRef}
          className="html-preview-frame"
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          loading={mode === "review" ? "lazy" : "eager"}
          srcDoc={documentSource}
          title={title || "HTML 交互预览"}
          onLoad={() => {
            const frameWindow = iframeRef.current?.contentWindow;
            const themeMessage: HostToHtmlPreviewMessage = { type: "html-preview:theme", theme: resolvedTheme };
            const measureMessage: HostToHtmlPreviewMessage = { type: "html-preview:measure" };
            frameWindow?.postMessage(themeMessage, "*");
            frameWindow?.postMessage(measureMessage, "*");
          }}
        />
      </div>
      {showSource && (
        <div className="html-preview-source">
          <pre className="md-pre"><code>{source}</code></pre>
        </div>
      )}
    </section>
  );
}

export const HtmlPreview = memo(HtmlPreviewBase);
