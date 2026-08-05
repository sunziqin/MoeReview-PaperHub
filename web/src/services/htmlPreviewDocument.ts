import type { HtmlPreviewTheme } from "../types/htmlPreview";

const PREVIEW_BASE_STYLES = `
:root {
  color-scheme: light;
  --preview-bg: #ffffff;
  --preview-text: #1b1c1f;
  --preview-muted: #5f636b;
  --preview-border: rgba(22, 24, 28, 0.14);
  --preview-accent: #1769e0;
}

:root[data-theme="dark"] {
  color-scheme: dark;
  --preview-bg: #17181a;
  --preview-text: #f1f1ef;
  --preview-muted: #aaaeb5;
  --preview-border: rgba(255, 255, 255, 0.14);
  --preview-accent: #69a5ff;
}

html, body {
  min-width: 0;
  margin: 0;
  color: var(--preview-text);
  background: transparent;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  letter-spacing: 0;
}

*, *::before, *::after { box-sizing: border-box; }
img, video, canvas, svg { max-width: 100%; }
`;

const PREVIEW_BOOTSTRAP = `
(() => {
  const send = (message) => window.parent.postMessage(message, "*");
  let lastHeight = 0;
  let frame = 0;

  const measure = () => {
    frame = 0;
    const body = document.body;
    const root = document.documentElement;
    const height = Math.ceil(Math.max(
      body ? body.scrollHeight : 0,
      body ? body.offsetHeight : 0,
      root.offsetHeight
    ));
    if (!Number.isFinite(height) || height <= 0 || height === lastHeight) return;
    lastHeight = height;
    send({ type: "html-preview:resize", height });
  };

  const scheduleMeasure = () => {
    if (frame) return;
    frame = requestAnimationFrame(measure);
  };

  const start = () => {
    const observer = new ResizeObserver(scheduleMeasure);
    observer.observe(document.documentElement);
    if (document.body) observer.observe(document.body);
    new MutationObserver(scheduleMeasure).observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true
    });
    document.fonts?.ready.then(scheduleMeasure).catch(() => undefined);
    scheduleMeasure();
    send({ type: "html-preview:ready" });
  };

  window.addEventListener("message", (event) => {
    if (event.source !== window.parent) return;
    if (event.data?.type === "html-preview:theme") {
      const theme = event.data.theme === "dark" ? "dark" : "light";
      document.documentElement.dataset.theme = theme;
      scheduleMeasure();
      return;
    }
    if (event.data?.type === "html-preview:measure") scheduleMeasure();
  });

  window.addEventListener("error", (event) => {
    send({ type: "html-preview:error", message: event.message || "Preview script failed" });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason instanceof Error ? event.reason.message : String(event.reason ?? "Unhandled rejection");
    send({ type: "html-preview:error", message: reason });
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
`;

function createMeta(document: Document, name: string, content: string): HTMLMetaElement {
  const element = document.createElement("meta");
  element.setAttribute("name", name);
  element.setAttribute("content", content);
  return element;
}

export function buildHtmlPreviewDocument(source: string, theme: HtmlPreviewTheme): string {
  const parser = new DOMParser();
  const document = parser.parseFromString(source, "text/html");
  const head = document.head;
  const platformNodes = document.createDocumentFragment();

  if (!document.querySelector('meta[charset]')) {
    const charset = document.createElement("meta");
    charset.setAttribute("charset", "utf-8");
    platformNodes.append(charset);
  }
  if (!document.querySelector('meta[name="viewport"]')) {
    platformNodes.append(createMeta(document, "viewport", "width=device-width, initial-scale=1"));
  }

  const style = document.createElement("style");
  style.dataset.moereview = "preview-base";
  style.textContent = PREVIEW_BASE_STYLES;
  platformNodes.append(style);

  const bootstrap = document.createElement("script");
  bootstrap.dataset.moereview = "preview-bootstrap";
  bootstrap.textContent = PREVIEW_BOOTSTRAP;
  platformNodes.append(bootstrap);

  head.prepend(platformNodes);
  document.documentElement.dataset.theme = theme;
  return `<!doctype html>\n${document.documentElement.outerHTML}`;
}
