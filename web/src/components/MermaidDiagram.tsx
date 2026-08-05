import { memo, useEffect, useId, useRef, useState } from "react";
import { AlertTriangle, Network } from "lucide-react";
import { useTheme } from "../hooks/useTheme";
import type { MarkdownRenderMode } from "../types/htmlPreview";

interface MermaidDiagramProps {
  source: string;
  title?: string;
  mode: MarkdownRenderMode;
}

let renderQueue: Promise<unknown> = Promise.resolve();
let renderSequence = 0;

async function renderDiagram(id: string, source: string, theme: "light" | "dark") {
  const task = renderQueue.then(async () => {
    const { default: mermaid } = await import("mermaid");
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "base",
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif',
      themeVariables: theme === "dark"
        ? {
            background: "#17181a",
            primaryColor: "#222326",
            primaryTextColor: "#f1f1ef",
            primaryBorderColor: "#70747c",
            lineColor: "#aaaeb5",
            secondaryColor: "#1d3150",
            tertiaryColor: "#202124",
          }
        : {
            background: "#ffffff",
            primaryColor: "#f7f7f5",
            primaryTextColor: "#1b1c1f",
            primaryBorderColor: "#92969e",
            lineColor: "#5f636b",
            secondaryColor: "#e8f1ff",
            tertiaryColor: "#fbfbfa",
          },
    });
    return mermaid.render(id, source);
  });
  renderQueue = task.then(() => undefined, () => undefined);
  return task;
}

function MermaidSource({ source, mode }: { source: string; mode: MarkdownRenderMode }) {
  return (
    <div className={`code-block mermaid-fallback is-${mode}`}>
      <pre className="md-pre"><code>{source}</code></pre>
    </div>
  );
}

function MermaidDiagramBase({ source, title, mode }: MermaidDiagramProps) {
  const { resolvedTheme } = useTheme();
  const reactId = useId();
  const rootRef = useRef<HTMLElement>(null);
  const [active, setActive] = useState(mode !== "review");
  const [svg, setSvg] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (mode !== "review" || active) return;
    const root = rootRef.current;
    if (!root || !window.IntersectionObserver) {
      setActive(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setActive(true);
        observer.disconnect();
      },
      { rootMargin: "240px" },
    );
    observer.observe(root);
    return () => observer.disconnect();
  }, [active, mode]);

  useEffect(() => {
    if (!active || mode === "compact" || mode === "streaming") return;
    let cancelled = false;
    renderSequence += 1;
    const id = `mermaid-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}-${renderSequence}`;
    setError("");
    void renderDiagram(id, source, resolvedTheme)
      .then((result) => {
        if (!cancelled) setSvg(result.svg);
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setSvg("");
        setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [active, mode, reactId, resolvedTheme, source]);

  if (mode === "compact" || mode === "streaming") {
    return <MermaidSource source={source} mode={mode} />;
  }

  return (
    <section ref={rootRef} className={`mermaid-diagram is-${mode}`} aria-label={title || "Mermaid 图表"}>
      <header className="mermaid-diagram-head">
        <Network size={15} />
        <strong>{title || "关系图"}</strong>
      </header>
      <div className="mermaid-diagram-body">
        {!active && <div className="mermaid-diagram-loading">图表进入视口后加载</div>}
        {active && !svg && !error && <div className="mermaid-diagram-loading">正在绘制</div>}
        {svg && <div className="mermaid-diagram-svg" dangerouslySetInnerHTML={{ __html: svg }} />}
        {error && (
          <div className="mermaid-diagram-error">
            <AlertTriangle size={16} />
            <span>{error}</span>
          </div>
        )}
      </div>
      {error && <MermaidSource source={source} mode={mode} />}
    </section>
  );
}

export const MermaidDiagram = memo(MermaidDiagramBase);
