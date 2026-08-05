import { useExamForgeStore } from "../store";
import { MarkdownRenderer } from "./MarkdownRenderer";

export function PageFallbackView() {
  const page = useExamForgeStore((s) => s.pages[s.currentPageIndex] ?? null);
  if (!page) return null;

  if (page.kind === "system") {
    const content = page.content as { text?: string };
    return (
      <section className="page-system">
        <h2>{page.title}</h2>
        <p>{content.text ?? page.summary}</p>
      </section>
    );
  }

  if (typeof page.content === "string") {
    return (
      <article className="card">
        <h2 className="card-title">{page.title}</h2>
        <div className="card-content">
          <MarkdownRenderer content={page.content} />
        </div>
      </article>
    );
  }

  return (
    <article className="card">
      <h2 className="card-title">{page.title}</h2>
      <p className="page-summary-text">{page.summary}</p>
      <pre className="page-json">{JSON.stringify(page.content, null, 2)}</pre>
    </article>
  );
}
