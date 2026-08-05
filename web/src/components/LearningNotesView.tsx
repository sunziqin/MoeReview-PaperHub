import { BookOpenText, MessageCircle, ScrollText, Trash2 } from "lucide-react";
import { useExamForgeStore } from "../store";
import { useWorkspaceStore } from "../workspaceStore";

export function LearningNotesView({ onNavigate }: { onNavigate?: () => void }) {
  const notes = useWorkspaceStore((state) => state.notes);
  const removeNote = useWorkspaceStore((state) => state.removeNote);
  const setReadingMode = useWorkspaceStore((state) => state.setReadingMode);
  const openQaAtMessage = useWorkspaceStore((state) => state.openQaAtMessage);
  const openQaAtAnswer = useWorkspaceStore((state) => state.openQaAtAnswer);
  const pages = useExamForgeStore((state) => state.pages);
  const goToPage = useExamForgeStore((state) => state.goToPage);
  const currentSessionId = useExamForgeStore((state) => state.currentSessionId);
  const sessionNotes = notes.filter((note) => note.sessionId === currentSessionId);

  const returnToSource = (pageId?: string) => {
    if (!pageId) return;
    const index = pages.findIndex((page) => page.id === pageId);
    if (index < 0) return;
    setReadingMode("focus");
    goToPage(index);
    onNavigate?.();
  };

  if (sessionNotes.length === 0) {
    return (
      <div className="library-empty">
        <BookOpenText size={20} />
        <strong>还没有固定笔记</strong>
        <p>在即时回答中固定真正值得保留的内容。</p>
      </div>
    );
  }

  return (
    <div className="learning-notes-list">
      {sessionNotes.map((note) => (
        <article className="learning-note-item" key={note.id}>
          <div className="learning-note-meta">
            <span>{note.pageTitle || "即时问答"}</span>
            <button type="button" onClick={() => removeNote(note.id)} aria-label="删除笔记" title="删除笔记">
              <Trash2 size={15} />
            </button>
          </div>
          {note.quote && <blockquote>{note.quote}</blockquote>}
          {note.question && <strong>{note.question}</strong>}
          <p>{note.answer}</p>
          <div className="note-source-actions">
            {note.pageId && (
              <button type="button" className="note-source-link" onClick={() => returnToSource(note.pageId)}>
                <ScrollText size={14} /> 回到学习页
              </button>
            )}
            {note.answer && (
              <button type="button" className="note-source-link" onClick={() => { onNavigate?.(); if (note.qaMessageId) openQaAtMessage(note.qaMessageId); else openQaAtAnswer(note.answer); }}>
                <MessageCircle size={14} /> 回到问答
              </button>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}
