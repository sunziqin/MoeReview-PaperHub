/**
 * ExamForge 全局状态(zustand)。
 * 管理 WebSocket 连接状态、当前视图、卡片/测验/结果/进度等渲染数据,
 * 以及做题过程状态(当前题号、用户答案、错题本)。
 */

import { create } from "zustand";
import type {
  Card,
  ChoicePrompt,
  ConnectionStatus,
  CurrentView,
  FavoriteItem,
  GuidancePanel,
  LearningPage,
  Progress,
  Quiz,
  Result,
  ResultItem,
  ResultSummary,
  ServerMessage,
  SessionMeta,
  Widget,
  WrongAnswer,
} from "./types";

interface QuizDraft {
  currentQuestionIndex: number;
  userAnswers: Record<string, unknown>;
}

interface ReadingLocation {
  lastPageId?: string;
  scrollTops: Record<string, number>;
}

const QUIZ_DRAFTS_KEY = "moereview-quiz-drafts";
const READING_LOCATIONS_KEY = "moereview-reading-locations";

function loadQuizDrafts(): Record<string, QuizDraft> {
  try {
    return JSON.parse(localStorage.getItem(QUIZ_DRAFTS_KEY) || "{}") as Record<string, QuizDraft>;
  } catch (error) {
    console.error("读取答题草稿失败", error);
    return {};
  }
}

function quizDraftKey(sessionId: string, pageId: string): string {
  return `${sessionId}::${pageId}`;
}

function saveQuizDraft(sessionId: string, pageId: string, draft: QuizDraft): void {
  try {
    const drafts = loadQuizDrafts();
    drafts[quizDraftKey(sessionId, pageId)] = draft;
    localStorage.setItem(QUIZ_DRAFTS_KEY, JSON.stringify(drafts));
  } catch (error) {
    console.error("保存答题草稿失败", error);
  }
}

function getQuizDraft(sessionId: string, pageId: string): QuizDraft | undefined {
  return loadQuizDrafts()[quizDraftKey(sessionId, pageId)];
}

function loadReadingLocations(): Record<string, ReadingLocation> {
  try {
    return JSON.parse(localStorage.getItem(READING_LOCATIONS_KEY) || "{}") as Record<string, ReadingLocation>;
  } catch (error) {
    console.error("读取阅读位置失败", error);
    return {};
  }
}

function saveReadingLocation(sessionId: string, location: ReadingLocation): void {
  try {
    const locations = loadReadingLocations();
    locations[sessionId] = location;
    localStorage.setItem(READING_LOCATIONS_KEY, JSON.stringify(locations));
  } catch (error) {
    console.error("保存阅读位置失败", error);
  }
}

function resolvePageIndex(pages: LearningPage[], sessionId: string, preferredPageId?: string): number {
  if (pages.length === 0) return -1;
  const targetPageId = preferredPageId ?? loadReadingLocations()[sessionId]?.lastPageId;
  if (targetPageId) {
    const savedIndex = pages.findIndex((page) => page.id === targetPageId);
    if (savedIndex >= 0) return savedIndex;
  }
  return 0;
}

function visiblePages(pages: LearningPage[]): LearningPage[] {
  return pages.filter((page) => page.status !== "superseded");
}

export function rememberReadingPage(sessionId: string, pageId: string): void {
  const current = loadReadingLocations()[sessionId] ?? { scrollTops: {} };
  saveReadingLocation(sessionId, { ...current, lastPageId: pageId });
}

export function rememberReadingScroll(sessionId: string, pageId: string, scrollTop: number): void {
  const current = loadReadingLocations()[sessionId] ?? { scrollTops: {} };
  saveReadingLocation(sessionId, {
    ...current,
    lastPageId: pageId,
    scrollTops: {
      ...(current.scrollTops ?? {}),
      [pageId]: Math.max(0, Math.round(scrollTop)),
    },
  });
}

export function getRememberedScrollTop(sessionId: string, pageId: string): number {
  return loadReadingLocations()[sessionId]?.scrollTops?.[pageId] ?? 0;
}

function pageToState(page: LearningPage | null, draft?: QuizDraft): Partial<ExamForgeState> {
  if (!page) {
    return { currentView: "empty", card: null, quiz: null, result: null };
  }

  if (page.kind === "card") {
    if (typeof page.content === "string") {
      return {
        currentView: "card",
        card: {
          title: page.title,
          content: page.content,
        },
        quiz: null,
        result: null,
      };
    }

    const content = page.content as Partial<Card> & {
      markdown?: string;
      body?: string;
      text?: string;
    };
    return {
      currentView: "card",
      card: {
        title: String(content.title ?? page.title),
        content: String(content.content ?? content.markdown ?? content.body ?? content.text ?? ""),
      },
      quiz: null,
      result: null,
    };
  }

  if (page.kind === "quiz") {
    const content = page.content as Partial<Quiz>;
    return {
      currentView: "quiz",
      card: null,
      quiz: {
        mode: content.mode ?? "sequential",
        questions: content.questions ?? [],
      },
      result: null,
      currentQuestionIndex: draft?.currentQuestionIndex ?? 0,
      userAnswers: draft?.userAnswers ?? {},
    };
  }

  if (page.kind === "result") {
    const content = page.content as Partial<Result>;
    return {
      currentView: "result",
      card: null,
      result: {
        results: (content.results ?? []) as ResultItem[],
        summary: content.summary as ResultSummary | undefined,
      },
    };
  }

  return { currentView: page.kind, card: null, quiz: null, result: null };
}

interface ExamForgeState {
  /** 连接状态 */
  connectionStatus: ConnectionStatus;
  /** 当前主视图 */
  currentView: CurrentView;
  /** 知识卡片 */
  card: Card | null;
  /** 测验 */
  quiz: Quiz | null;
  /** 结果 */
  result: Result | null;
  /** 进度 */
  progress: Progress | null;
  /** 会话标题 */
  sessionTitle: string;
  /** 仪表盘 widgets */
  dashboardWidgets: Widget[];
  /** 右侧栏临时引导，不进入学习分页历史 */
  guidance: GuidancePanel | null;
  /** Agent 是否在处理中(收到工具消息后置 true,用户发送事件后置 false) */
  agentThinking: boolean;
  agentPendingSessions: Record<string, number>;
  /** ask_choice 模态框的当前提示(null 表示不显示) */
  choicePrompt: ChoicePrompt | null;
  /** 专注模式(隐藏侧边栏,主内容区全宽) */
  focusMode: boolean;
  /** 追加式学习分页时间线 */
  pages: LearningPage[];
  /** 当前正在查看的页面索引 */
  currentPageIndex: number;

  /** 做题状态:sequential 模式当前题号(从 0 起) */
  currentQuestionIndex: number;
  /** 用户各题答案 { q1: 1, q2: "wait()" } */
  userAnswers: Record<string, unknown>;
  /** 内存错题本(做错/跳过的题) */
  wrongAnswers: WrongAnswer[];

  /** 会话列表(sessions_update 推送) */
  sessions: SessionMeta[];
  /** 当前激活会话 id */
  currentSessionId: string;

  /** 收藏列表(favorites_update 推送) */
  favorites: FavoriteItem[];

  /** 更新连接状态 */
  setConnectionStatus: (status: ConnectionStatus) => void;
  /** 按 tool 字段分发后端消息,更新对应状态 */
  dispatch: (msg: ServerMessage) => void;
  /** 清空主内容区 */
  clearBoard: () => void;
  /** 设置会话列表与当前激活会话(sessions_update 时调用) */
  setSessions: (sessions: SessionMeta[], currentId: string) => void;
  returnToWelcome: () => void;
  /** 跳转到指定页 */
  goToPage: (index: number) => void;
  /** 上一页 */
  prevPage: () => void;
  /** 下一页 */
  nextPage: () => void;

  /** 设置 Agent 思考状态 */
  setAgentThinking: (thinking: boolean) => void;
  setAgentPending: (sessionId: string, pending: boolean) => void;
  /** 切换专注模式 */
  toggleFocusMode: () => void;
  /** 下一题(sequential) */
  nextQuestion: () => void;
  /** 上一题(sequential) */
  prevQuestion: () => void;
  /** 设置某题答案 */
  setUserAnswer: (id: string, value: unknown) => void;
  goToQuestion: (index: number) => void;
  /** 加入错题本 */
  addWrongAnswer: (item: WrongAnswer) => void;
  /** 从错题本移除指定索引的条目 */
  removeWrongAnswer: (index: number) => void;
  /** 收到新 quiz 时重置做题状态(index=0, answers={},不清错题本) */
  resetQuiz: (quiz: Quiz) => void;
  /** 关闭 ask_choice 模态框 */
  clearChoice: () => void;
}

export const useExamForgeStore = create<ExamForgeState>()((set, get) => ({
  connectionStatus: "disconnected",
  currentView: "empty",
  card: null,
  quiz: null,
  result: null,
  progress: null,
  sessionTitle: "ExamForge",
  dashboardWidgets: [],
  guidance: null,
  agentThinking: false,
  agentPendingSessions: {},
  choicePrompt: null,
  focusMode: false,
  pages: [],
  currentPageIndex: -1,

  currentQuestionIndex: 0,
  userAnswers: {},
  wrongAnswers: [],

  sessions: [],
  currentSessionId: "",

  favorites: [],

  setConnectionStatus: (status) => set({ connectionStatus: status }),

  dispatch: (msg) => {
    switch (msg.tool) {
      case "page_created": {
        if (msg.sessionId && msg.sessionId !== get().currentSessionId) break;
        if (msg.page.status === "superseded") break;
        get().setAgentPending(msg.sessionId ?? get().currentSessionId, false);
        const pages = [...get().pages, msg.page];
        const state = get();
        const currentPageIndex = state.currentPageIndex >= 0 ? state.currentPageIndex : pages.length - 1;
        const page = pages[currentPageIndex] ?? null;
        const draft = page?.kind === "quiz" ? getQuizDraft(state.currentSessionId, page.id) : undefined;
        if (page) rememberReadingPage(state.currentSessionId, page.id);
        set({
          pages,
          currentPageIndex,
          ...pageToState(page, draft),
        });
        break;
      }
      case "page_revised": {
        if (msg.sessionId && msg.sessionId !== get().currentSessionId) break;
        get().setAgentPending(msg.sessionId ?? get().currentSessionId, false);
        const state = get();
        const pages = visiblePages([
          ...state.pages.map((page) =>
            page.id === msg.supersedesPageId ? { ...page, status: "superseded" as const } : page,
          ),
          msg.page,
        ]);
        const currentPageIndex = pages.length - 1;
        rememberReadingPage(state.currentSessionId, msg.page.id);
        set({
          pages,
          currentPageIndex,
          ...pageToState(msg.page),
        });
        break;
      }
      case "page_superseded": {
        if (msg.sessionId && msg.sessionId !== get().currentSessionId) break;
        const state = get();
        const currentPage = state.pages[state.currentPageIndex];
        const pages = state.pages.filter((page) => page.id !== msg.pageId);
        const currentPageIndex = currentPage?.id === msg.pageId
          ? Math.min(state.currentPageIndex, pages.length - 1)
          : pages.findIndex((page) => page.id === currentPage?.id);
        const page = pages[currentPageIndex] ?? null;
        if (page) rememberReadingPage(state.currentSessionId, page.id);
        set({
          pages,
          currentPageIndex,
          ...pageToState(page),
        });
        break;
      }
      case "pages_created": {
        if (msg.sessionId && msg.sessionId !== get().currentSessionId) break;
        get().setAgentPending(msg.sessionId ?? get().currentSessionId, false);
        const state = get();
        const previousLength = state.pages.length;
        const pages = visiblePages([...state.pages, ...msg.pages]);
        const currentPageIndex = previousLength > 0 && state.currentPageIndex >= 0
          ? Math.min(state.currentPageIndex, pages.length - 1)
          : resolvePageIndex(pages, state.currentSessionId, msg.pages[0]?.id);
        const page = pages[currentPageIndex] ?? null;
        const draft = page?.kind === "quiz" ? getQuizDraft(state.currentSessionId, page.id) : undefined;
        if (page) rememberReadingPage(state.currentSessionId, page.id);
        set({
          pages,
          currentPageIndex,
          ...pageToState(page, draft),
        });
        break;
      }
      case "pages_update": {
        const state = get();
        if (!state.currentSessionId) {
          set({ pages: [], currentPageIndex: -1, currentView: "empty", card: null, quiz: null, result: null });
          break;
        }
        const pages = visiblePages(msg.pages);
        const currentPage = state.pages[state.currentPageIndex];
        const currentPageStillExists = currentPage ? pages.some((page) => page.id === currentPage.id) : false;
        const currentPageIndex = currentPageStillExists
          ? pages.findIndex((page) => page.id === currentPage.id)
          : resolvePageIndex(pages, state.currentSessionId);
        const page = pages[currentPageIndex] ?? null;
        const draft = page?.kind === "quiz" ? getQuizDraft(state.currentSessionId, page.id) : undefined;
        if (page) rememberReadingPage(state.currentSessionId, page.id);
        set({
          pages,
          currentPageIndex,
          ...pageToState(page, draft),
        });
        break;
      }
      case "session_pages_update": {
        const state = get();
        if (msg.sessionId !== state.currentSessionId) break;
        const pages = visiblePages(msg.pages);
        const currentPage = state.pages[state.currentPageIndex];
        const currentPageStillExists = currentPage ? pages.some((page) => page.id === currentPage.id) : false;
        const currentPageIndex = currentPageStillExists
          ? pages.findIndex((page) => page.id === currentPage.id)
          : resolvePageIndex(pages, state.currentSessionId);
        const page = pages[currentPageIndex] ?? null;
        const draft = page?.kind === "quiz" ? getQuizDraft(state.currentSessionId, page.id) : undefined;
        if (page) rememberReadingPage(state.currentSessionId, page.id);
        set({
          pages,
          currentPageIndex,
          ...pageToState(page, draft),
        });
        break;
      }
      case "show_card":
        get().setAgentPending(get().currentSessionId, false);
        set({ card: { title: msg.title, content: msg.content }, currentView: "card" });
        break;
      case "show_quiz": {
        get().setAgentPending(get().currentSessionId, false);
        // 收到新 quiz:重置做题状态(保留错题本)
        const quiz: Quiz = { mode: msg.mode, questions: msg.questions };
        get().resetQuiz(quiz);
        break;
      }
      case "show_result":
        get().setAgentPending(get().currentSessionId, false);
        set({
          result: {
            results: msg.results as ResultItem[],
            summary: msg.summary as ResultSummary | undefined,
          },
          currentView: "result",
        });
        break;
      case "set_progress":
        set({ progress: { percent: msg.percent, label: msg.label ?? null } });
        break;
      case "set_session_title":
        set({ sessionTitle: msg.title });
        break;
      case "update_dashboard":
        get().setAgentPending(get().currentSessionId, false);
        set({ dashboardWidgets: msg.widgets });
        break;
      case "guidance_update":
        if (msg.sessionId && msg.sessionId !== get().currentSessionId) break;
        get().setAgentPending(msg.sessionId ?? get().currentSessionId, false);
        set({ guidance: msg.guidance && Object.keys(msg.guidance).length > 0 ? msg.guidance : null });
        break;
      case "clear_board":
        set({
          progress: null,
          ...pageToState(get().pages[get().currentPageIndex] ?? null),
        });
        break;
      case "ask_choice":
        get().setAgentPending(get().currentSessionId, false);
        // 弹出 ask_choice 模态框,等待用户在 ChoiceModal 中选择
        set({
          choicePrompt: { question: msg.question, options: msg.options },
        });
        break;
      case "sessions_update": {
        // 切换会话时(currentSessionId 变化)清空内存视图,避免显示旧会话数据。
        // 保留 sessions / currentSessionId(刚设置)和 sessionTitle(随会话更新)。
        const oldId = get().currentSessionId;
        const nextId = msg.currentId || oldId;
        const switched = oldId !== nextId;
        const currentSession = msg.sessions.find((session) => session.id === nextId);
        if (switched) {
          set({
            sessions: msg.sessions,
            currentSessionId: nextId,
            sessionTitle: currentSession?.title || (nextId ? "Untitled session" : "MoeReview"),
            wrongAnswers: [],
            dashboardWidgets: [],
            guidance: null,
            quiz: null,
            card: null,
            result: null,
            progress: null,
            currentView: "empty",
            currentQuestionIndex: 0,
            userAnswers: {},
            pages: [],
            currentPageIndex: -1,
          });
        } else {
          set({
            sessions: msg.sessions,
            currentSessionId: nextId,
            sessionTitle: currentSession?.title || (nextId ? get().sessionTitle : "MoeReview"),
          });
        }
        break;
      }
      case "favorites_update":
        if (msg.sessionId && msg.sessionId !== get().currentSessionId) break;
        set({ favorites: msg.favorites });
        break;
      case "agent_status_update":
        if (msg.status === "waiting" || msg.status === "offline" || msg.status === "disconnected") {
          get().setAgentPending(msg.sessionId, false);
        }
        set((state) => ({
          sessions: state.sessions.map((session) =>
            session.id === msg.sessionId
              ? {
                  ...session,
                  agentConnection: {
                    ...(session.agentConnection ?? { status: "offline" as const }),
                    status: msg.status,
                    agentId: msg.agentId,
                    conversationKey: msg.conversationKey,
                    lastSeenAt: msg.lastSeenAt,
                  },
                }
              : session,
          ),
        }));
        break;
      default:
        break;
    }
  },

  clearBoard: () =>
    set({
      progress: null,
      ...pageToState(get().pages[get().currentPageIndex] ?? null),
    }),

  setSessions: (sessions, currentId) =>
    set({ sessions, currentSessionId: currentId }),

  returnToWelcome: () =>
    set({
      currentSessionId: "",
      sessionTitle: "MoeReview",
      wrongAnswers: [],
      dashboardWidgets: [],
      guidance: null,
      quiz: null,
      card: null,
      result: null,
      progress: null,
      currentView: "empty",
      currentQuestionIndex: 0,
      userAnswers: {},
      pages: [],
      currentPageIndex: -1,
      favorites: [],
    }),

  goToPage: (index) => {
    const state = get();
    const pages = state.pages;
    if (pages.length === 0) return;
    const leavingPage = pages[state.currentPageIndex];
    if (leavingPage?.kind === "quiz") {
      saveQuizDraft(state.currentSessionId, leavingPage.id, {
        currentQuestionIndex: state.currentQuestionIndex,
        userAnswers: state.userAnswers,
      });
    }
    const currentPageIndex = Math.min(Math.max(index, 0), pages.length - 1);
    const nextPage = pages[currentPageIndex] ?? null;
    const draft = nextPage?.kind === "quiz"
      ? getQuizDraft(state.currentSessionId, nextPage.id)
      : undefined;
    if (nextPage) rememberReadingPage(state.currentSessionId, nextPage.id);
    set({
      currentPageIndex,
      ...pageToState(nextPage, draft),
    });
  },
  prevPage: () => get().goToPage(get().currentPageIndex - 1),
  nextPage: () => get().goToPage(get().currentPageIndex + 1),

  nextQuestion: () => set((state) => {
    const currentQuestionIndex = state.currentQuestionIndex + 1;
    const page = state.pages[state.currentPageIndex];
    if (page?.kind === "quiz") saveQuizDraft(state.currentSessionId, page.id, { currentQuestionIndex, userAnswers: state.userAnswers });
    return { currentQuestionIndex };
  }),
  prevQuestion: () => set((state) => {
    const currentQuestionIndex = Math.max(0, state.currentQuestionIndex - 1);
    const page = state.pages[state.currentPageIndex];
    if (page?.kind === "quiz") saveQuizDraft(state.currentSessionId, page.id, { currentQuestionIndex, userAnswers: state.userAnswers });
    return { currentQuestionIndex };
  }),
  setUserAnswer: (id, value) => set((state) => {
    const userAnswers = { ...state.userAnswers, [id]: value };
    const page = state.pages[state.currentPageIndex];
    if (page?.kind === "quiz") saveQuizDraft(state.currentSessionId, page.id, { currentQuestionIndex: state.currentQuestionIndex, userAnswers });
    return { userAnswers };
  }),
  goToQuestion: (index) => set((state) => {
    const currentQuestionIndex = Math.min(Math.max(index, 0), Math.max(0, (state.quiz?.questions.length ?? 1) - 1));
    const page = state.pages[state.currentPageIndex];
    if (page?.kind === "quiz") saveQuizDraft(state.currentSessionId, page.id, { currentQuestionIndex, userAnswers: state.userAnswers });
    return { currentQuestionIndex };
  }),
  addWrongAnswer: (item) => set((s) => ({ wrongAnswers: [...s.wrongAnswers, item] })),
  removeWrongAnswer: (index) =>
    set((s) => ({
      wrongAnswers: s.wrongAnswers.filter((_, i) => i !== index),
    })),
  resetQuiz: (quiz) =>
    set({
      quiz,
      currentQuestionIndex: 0,
      userAnswers: {},
      currentView: "quiz",
    }),
  clearChoice: () => set({ choicePrompt: null }),
  setAgentThinking: (thinking) => set({ agentThinking: thinking }),
  setAgentPending: (sessionId, pending) => {
    if (!sessionId) return;
    set((state) => {
      const agentPendingSessions = { ...state.agentPendingSessions };
      if (pending) {
        agentPendingSessions[sessionId] = Date.now();
      } else {
        delete agentPendingSessions[sessionId];
      }
      return {
        agentPendingSessions,
        agentThinking: Object.keys(agentPendingSessions).length > 0,
      };
    });
  },
  toggleFocusMode: () => set((s) => ({ focusMode: !s.focusMode })),
}));
