import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type ReadingMode = "focus" | "review";

export interface QuoteContext {
  text: string;
  pageId?: string;
  pageTitle?: string;
}

export interface LearningNote {
  id: string;
  sessionId: string;
  pageId?: string;
  pageTitle?: string;
  quote?: string;
  question?: string;
  answer: string;
  qaMessageId?: string;
  createdAt: number;
}

export interface QuickQaRequest {
  id: number;
  text: string;
  quotes?: QuoteContext[];
}

interface WorkspaceState {
  readingMode: ReadingMode;
  quotes: QuoteContext[];
  qaOpen: boolean;
  qaWidth: number;
  qaRequest: QuickQaRequest | null;
  dockFocusNonce: number;
  notes: LearningNote[];
  setReadingMode: (mode: ReadingMode) => void;
  addQuote: (quote: QuoteContext) => void;
  removeQuote: (index: number) => void;
  clearQuotes: () => void;
  openQa: () => void;
  closeQa: () => void;
  setQaWidth: (width: number) => void;
  requestQa: (text: string, quotes?: QuoteContext[]) => void;
  qaTargetMessageId: string | null;
  qaTargetAnswer: string | null;
  openQaAtMessage: (messageId: string) => void;
  openQaAtAnswer: (answer: string) => void;
  clearQaTarget: () => void;
  focusDock: () => void;
  addNote: (note: Omit<LearningNote, "id" | "createdAt">) => void;
  removeNote: (id: string) => void;
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set) => ({
      readingMode: "focus",
      quotes: [],
      qaOpen: false,
      qaWidth: 400,
      qaRequest: null,
      qaTargetMessageId: null,
      qaTargetAnswer: null,
      dockFocusNonce: 0,
      notes: [],
      setReadingMode: (readingMode) => set({ readingMode }),
      addQuote: (quote) => set((state) => ({
        quotes: state.quotes.some((item) => item.text === quote.text && item.pageId === quote.pageId)
          ? state.quotes
          : [...state.quotes, quote].slice(-5),
      })),
      removeQuote: (index) => set((state) => ({ quotes: state.quotes.filter((_, itemIndex) => itemIndex !== index) })),
      clearQuotes: () => set({ quotes: [] }),
      openQa: () => set({ qaOpen: true }),
      closeQa: () => set({ qaOpen: false }),
      setQaWidth: (qaWidth) => set({ qaWidth: Math.min(720, Math.max(320, qaWidth)) }),
      requestQa: (text, quotes) =>
        set({
          qaOpen: true,
          qaRequest: { id: Date.now(), text, quotes },
        }),
      openQaAtMessage: (qaTargetMessageId) => set({ qaOpen: true, qaTargetMessageId, qaTargetAnswer: null }),
      openQaAtAnswer: (qaTargetAnswer) => set({ qaOpen: true, qaTargetMessageId: null, qaTargetAnswer }),
      clearQaTarget: () => set({ qaTargetMessageId: null, qaTargetAnswer: null }),
      focusDock: () => set((state) => ({ dockFocusNonce: state.dockFocusNonce + 1 })),
      addNote: (note) =>
        set((state) => ({
          notes: note.qaMessageId && state.notes.some((item) => item.qaMessageId === note.qaMessageId) ? state.notes : [
            {
              ...note,
              id: crypto.randomUUID(),
              createdAt: Date.now(),
            },
            ...state.notes,
          ],
        })),
      removeNote: (id) =>
        set((state) => ({ notes: state.notes.filter((note) => note.id !== id) })),
    }),
    {
      name: "moereview-workspace",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        readingMode: state.readingMode,
        notes: state.notes,
        qaWidth: state.qaWidth,
      }),
    },
  ),
);
