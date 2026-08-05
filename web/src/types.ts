/**
 * ExamForge 前端共享类型定义。
 * 对应后端 WebSocket 协议(mcp-server/src/ws/server.ts)。
 */

/** WebSocket 连接状态 */
export type ConnectionStatus = "connecting" | "connected" | "disconnected";

/** 主内容区当前视图 */
export type CurrentView = "card" | "quiz" | "result" | "system" | "mixed" | "empty";

/** 知识卡片(show_card 的载荷) */
export interface Card {
  title: string;
  content: string;
}

/** 测验模式 */
export type QuizMode = "sequential" | "batch";

/** 单道测验题目(对齐后端 show_quiz schema) */
export interface QuizQuestion {
  id: string;
  type: "choice" | "fill" | "short_answer" | "code";
  question: string;
  answer?: unknown;
  options?: unknown[];
  language?: string;
  test_cases?: unknown[];
}

/** 测验(show_quiz 的载荷) */
export interface Quiz {
  mode: QuizMode;
  questions: QuizQuestion[];
}

/** 内存错题本条目 */
export interface WrongAnswer {
  /** 题干 */
  question: string;
  /** 用户答案 */
  userAnswer: unknown;
  /** 正确答案 */
  correctAnswer: unknown;
  /** 解析 */
  explanation?: string;
  /** 章节(预留) */
  chapter?: string;
  /** 时间戳 */
  timestamp: number;
  /** 原因:做错 / 跳过 */
  reason: "wrong" | "skip";
}

/** 单题判题结果(show_result 中的一项) */
export interface ResultItem {
  id: string;
  correct: boolean;
  verdict?: "correct" | "partial" | "wrong" | "skipped";
  score?: number;
  maxScore?: number;
  user_answer?: string;
  correct_answer?: unknown;
  explanation?: string;
  code_output?: string;
}

/** 结果汇总 */
export interface ResultSummary {
  /** 正确率 0-1 */
  accuracy: number;
  /** 用时(秒) */
  time_spent: number;
  /** Agent 反馈 */
  feedback?: string;
  grading_notes?: string;
}

/** 结果(show_result 的载荷) */
export interface Result {
  results: ResultItem[];
  summary?: ResultSummary;
}

/** 追加式学习分页。 */
export interface LearningPage {
  id: string;
  index: number;
  title: string;
  summary: string;
  kind: "card" | "quiz" | "result" | "mixed" | "system";
  content: unknown;
  createdAt: string;
  source: "agent" | "system" | "user";
  status: "published" | "draft" | "superseded";
  revision: number;
  previousPageId?: string;
  supersedesPageId?: string;
}

/** 进度(set_progress 的载荷) */
export interface Progress {
  percent: number;
  label?: string | null;
}

/** Toast 风格 */
export type ToastType = "info" | "success" | "warning" | "error";

/** 仪表盘 widget(后端 update_dashboard 推送的判别联合) */
export type Widget =
  | {
      type: "stat";
      label: string;
      value: string;
      trend?: "up" | "down" | "flat";
    }
  | {
      type: "list";
      title: string;
      items: {
        label: string;
        status?: "done" | "current" | "pending";
        detail?: string;
      }[];
    }
  | { type: "text"; content: string }
  | { type: "progress"; label: string; percent: number };

export interface GuidancePanel {
  title?: string;
  content?: string;
  tone?: "info" | "tip" | "warning" | "next_step";
  nextActions?: string[];
  updatedAt?: number;
}

/** ask_choice 模态框的载荷 */
export interface ChoicePrompt {
  question: string;
  options: string[];
}

/** 会话元信息(sessions_update 中的单项) */
export interface SessionMeta {
  id: string;
  title: string;
  /** 创建时间戳(毫秒) */
  created: number;
  /** 最后访问时间戳(毫秒) */
  last_access: number;
  lastOpenedAt?: number;
  lastAgentBoundAt?: number;
  sessionKind?: "general" | "paper";
  paperId?: string;
  agentConnection?: {
    status: "offline" | "idle" | "waiting" | "working" | "disconnected";
    agentId?: string;
    conversationKey?: string;
    clientName?: string;
    connectedAt?: number;
    lastSeenAt?: number;
  };
}

/**
 * Server -> Client 消息:按 `tool` 字段区分的判别联合。
 * 与后端 render.ts / interaction.ts 中 broadcast 的载荷一一对应。
 */
export type ServerMessage =
  | { tool: "show_toast"; text: string; toastType?: ToastType }
  | { tool: "show_card"; title: string; content: string }
  | { tool: "page_created"; sessionId?: string; page: LearningPage }
  | { tool: "page_revised"; sessionId?: string; page: LearningPage; supersedesPageId?: string }
  | { tool: "page_superseded"; sessionId?: string; pageId: string; reason?: string }
  | { tool: "pages_created"; sessionId?: string; pages: LearningPage[] }
  | { tool: "pages_update"; pages: LearningPage[] }
  | { tool: "session_pages_update"; sessionId: string; pages: LearningPage[] }
  | { tool: "set_progress"; percent: number; label?: string | null }
  | { tool: "set_session_title"; title: string }
  | { tool: "show_quiz"; mode: QuizMode; questions: QuizQuestion[] }
  | { tool: "show_result"; results: unknown[]; summary?: unknown }
  | { tool: "update_dashboard"; widgets: Widget[] }
  | { tool: "guidance_update"; sessionId?: string; guidance: GuidancePanel }
  | { tool: "clear_board" }
  | { tool: "ask_choice"; question: string; options: string[] }
  | {
      tool: "sessions_update";
      sessions: SessionMeta[];
      currentId: string;
    }
  | { tool: "favorites_update"; sessionId?: string; favorites: FavoriteItem[] }
  | {
      tool: "agent_status_update";
      sessionId: string;
      status: "offline" | "idle" | "waiting" | "working" | "disconnected";
      agentId?: string;
      conversationKey?: string;
      lastSeenAt?: number;
    }
  | { tool: "claim_code_created"; sessionId: string; code: string; expiresAt: number; force?: boolean };

/** Client -> Server 事件 */
export type ClientEvent = { event: string } & Record<string, unknown>;

/** 即时问答运行时配置。敏感配置只由 Hub 持有，前端只收到公开状态。 */
export interface QuickQaConfig {
  /** API Base URL,如 https://api.deepseek.com/v1 */
  baseUrl: string;
  /** 模型名,如 deepseek-chat / gpt-4o-mini */
  model: string;
  /** 可选系统提示 */
  systemPrompt?: string;
  /** Hub 是否已经配置 API Key */
  configured: boolean;
  /** 多轮记忆开关:ON 维护上下文窗口,OFF 每次独立问答(默认 true) */
  memory?: boolean;
}

/** 收藏条目(对齐后端 favorites.json) */
export interface FavoriteItem {
  id: string;
  question: string;
  answer: unknown;
  timestamp: number;
}

/** 即时问答对话中的一条消息 */
export interface QuickQaMessage {
  id?: string;
  /** 角色:user / assistant */
  role: "user" | "assistant";
  /** 文本内容 */
  content: string;
  /** 是否正在 streaming(用于显示打字光标) */
  streaming?: boolean;
  /** 是否出错(出错时 content 显示错误信息) */
  error?: boolean;
}
