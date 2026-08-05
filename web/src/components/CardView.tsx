import { useExamForgeStore } from "../store";
import { MarkdownRenderer } from "./MarkdownRenderer";

export function CardView() {
  const card = useExamForgeStore((s) => s.card);
  if (!card) return null;

  return (
    <article className="learning-document">
      <header className="document-head">
        <span className="document-kicker">知识讲解</span>
        <h2>{card.title}</h2>
      </header>
      <div className="document-body">
        <MarkdownRenderer content={card.content} />
      </div>
    </article>
  );
}
