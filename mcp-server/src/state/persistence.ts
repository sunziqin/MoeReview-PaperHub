/**
 * 本地文件持久化模块。
 *
 * 数据目录结构(~/.examforge/):
 *   config.json              全局配置(主题等)
 *   sessions/
 *     <sessionId>/           当前会话目录,id 由 sessions.ts 的 getCurrentSessionId() 提供
 *       meta.json            { id, title, created, last_access }(由 sessions.ts 管理)
 *       wrong_answers.json   错题本数组
 *       favorites.json       收藏数组
 *       highlights.json      高亮标注(先建空文件)
 *       dashboard.json       仪表盘数据缓存
 *       qa_memory.json       自定义模型问答记忆(先建空文件)
 *       quiz_history.json    做题/卡片历史
 *       card_cache.json      已展示的知识卡片缓存(用于本地匹配)
 *       pages.json           追加式学习分页时间线
 *       activity_log.json    纯前端交互日志(翻页/查看答案等,默认不唤醒 Agent)
 *       message_queue.json   跨进程用户事件队列(Web 进程写,Agent 进程读)
 *
 * 所有写操作用原子写:先写临时文件再 rename,避免半写状态。
 * 读取文件不存在时返回默认值(空数组或空对象),不抛错。
 *
 * 注意:meta.json 的元数据由 sessions.ts 统一管理,本模块不再读写它;
 * 切换会话时,getDataPath() 会自动指向新会话目录。
 */

import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ensureSession, getActiveSessionId } from "./sessions.js";

/** 根数据目录:~/.examforge */
const EXAMFORGE_DIR = join(homedir(), ".examforge");

/** 会话级数据文件及其默认内容(不存在时创建)。meta.json 由 sessions.ts 管理,不在此列。 */
const SESSION_FILES: Record<string, unknown> = {
  "wrong_answers.json": [],
  "favorites.json": [],
  "highlights.json": {},
  "dashboard.json": {},
  "guidance.json": {},
  "qa_memory.json": [],
  "quiz_history.json": [],
  "card_cache.json": [],
  "pages.json": [],
  "activity_log.json": [],
  "message_queue.json": [],
};

/** 全局配置默认值。 */
const CONFIG_DEFAULT = { theme: "light" };

/** 错题本条目。 */
export interface WrongAnswerItem {
  question: string;
  user_answer: unknown;
  correct_answer: unknown;
  explanation?: string;
  chapter?: string;
  timestamp: number;
  reason: string;
}

/** 历史记录条目。 */
export interface HistoryItem {
  type: "card" | "quiz";
  title: string;
  timestamp: number;
  detail?: string;
}

/** 自定义模型问答记忆条目。 */
export interface QaItem {
  question: string;
  answer: string;
  model: string;
  timestamp: number;
}

/** 收藏条目。 */
export interface FavoriteItem {
  id: string;
  question: string;
  answer: unknown;
  timestamp: number;
}

/** 卡片缓存条目(用于本地匹配)。 */
export interface CardCacheItem {
  title: string;
  content: string;
  timestamp: number;
}

/** 追加式学习分页。正文默认不可原地修改,纠错时新增修订页。 */
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

/** 前端本地交互日志。记录但默认不进入 Agent 消息队列。 */
export interface ActivityLogItem {
  id: string;
  event: string;
  pageId?: string;
  payload?: unknown;
  timestamp: number;
}

/** 跨进程消息队列条目。 */
export type QueuedUserEvent = Record<string, unknown> & { event: string };

/**
 * 返回当前会话级数据文件的完整路径。
 * 会话 id 来自 sessions.ts 的 getCurrentSessionId(),切换会话后自动指向新目录。
 * @param file 文件名,如 "wrong_answers.json"
 */
export function getDataPath(file: string, sessionId = getActiveSessionId()): string {
  return join(EXAMFORGE_DIR, "sessions", sessionId, file);
}

/**
 * 读取会话级 JSON 数据文件。文件不存在或解析失败时返回默认值,不抛错。
 * 数组型文件默认返回空数组,对象型文件默认返回空对象。
 * @param file 文件名
 */
export async function readData<T>(file: string, sessionId = getActiveSessionId()): Promise<T> {
  const filePath = getDataPath(file, sessionId);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    // 文件不存在或解析失败:返回默认值(数组 → [],对象 → {})
    const fallback = Array.isArray(SESSION_FILES[file]) ? [] : {};
    return fallback as T;
  }
}

/**
 * 原子写会话级 JSON 文件:先写临时文件再 rename,避免半写状态。
 * @param file 文件名
 * @param data 要序列化的数据
 */
export async function writeData<T>(file: string, data: T, sessionId = getActiveSessionId()): Promise<void> {
  await ensureSession(sessionId);
  const filePath = getDataPath(file, sessionId);
  const tmpPath = `${filePath}.tmp`;
  const raw = JSON.stringify(data, null, 2);
  await fs.writeFile(tmpPath, raw, "utf-8");
  await fs.rename(tmpPath, filePath);
}

/**
 * 启动时调用:确保当前会话目录及所有数据文件存在。
 * 已存在的文件不覆盖。meta.json 由 sessions.ts 管理,此处不涉及。
 * 应在 initSessions() 之后调用,以便为当前激活会话创建数据文件。
 */
export async function initStorage(): Promise<void> {
  // 创建当前会话目录(递归创建)
  await fs.mkdir(join(EXAMFORGE_DIR, "sessions"), { recursive: true });

  // 确保 config.json 存在
  const configPath = join(EXAMFORGE_DIR, "config.json");
  try {
    await fs.access(configPath);
  } catch {
    await fs.writeFile(configPath, JSON.stringify(CONFIG_DEFAULT, null, 2), "utf-8");
  }

  // 确保所有会话级数据文件存在(已存在则跳过)
}

/** 追加一条错题到 wrong_answers.json。 */
export async function appendWrongAnswer(item: WrongAnswerItem): Promise<void> {
  const list = await readData<WrongAnswerItem[]>("wrong_answers.json");
  list.push(item);
  await writeData("wrong_answers.json", list);
}

/** 追加一条历史记录到 quiz_history.json。 */
export async function appendHistory(item: HistoryItem): Promise<void> {
  const list = await readData<HistoryItem[]>("quiz_history.json");
  list.push(item);
  await writeData("quiz_history.json", list);
}

/** 追加一条收藏到 favorites.json。 */
export async function appendFavorite(item: FavoriteItem): Promise<void> {
  const list = await readData<FavoriteItem[]>("favorites.json");
  list.push(item);
  await writeData("favorites.json", list);
}

/** 按 id 移除收藏。 */
export async function removeFavorite(id: string): Promise<void> {
  const list = await readData<FavoriteItem[]>("favorites.json");
  const filtered = list.filter((f) => f.id !== id);
  await writeData("favorites.json", filtered);
}

/** 追加一条已展示卡片缓存到 card_cache.json。 */
export async function appendCardCache(card: CardCacheItem): Promise<void> {
  const list = await readData<CardCacheItem[]>("card_cache.json");
  list.push(card);
  await writeData("card_cache.json", list);
}

/** 追加一页到 pages.json,自动分配 index 与 previousPageId。 */
export async function appendLearningPage(
  page: Omit<LearningPage, "index" | "previousPageId">,
): Promise<LearningPage> {
  const pages = await readData<LearningPage[]>("pages.json");
  const previous = pages[pages.length - 1];
  const next: LearningPage = {
    ...page,
    index: pages.length,
    previousPageId: previous?.id,
  };
  pages.push(next);
  await writeData("pages.json", pages);
  return next;
}

/** Replace an existing page with a new revision and mark the old page superseded. */
export async function reviseLearningPage(
  pageId: string,
  page: Omit<LearningPage, "index" | "previousPageId" | "revision" | "supersedesPageId">,
): Promise<LearningPage> {
  const pages = await readData<LearningPage[]>("pages.json");
  const previous = pages.find((item) => item.id === pageId);
  if (!previous) throw new Error(`page not found: ${pageId}`);
  if (previous.status === "superseded") throw new Error(`page already superseded: ${pageId}`);

  previous.status = "superseded";
  const latest = pages[pages.length - 1];
  const next: LearningPage = {
    ...page,
    id: page.id,
    index: pages.length,
    previousPageId: latest?.id,
    supersedesPageId: previous.id,
    revision: (previous.revision ?? 1) + 1,
  };
  pages.push(next);
  await writeData("pages.json", pages);
  return next;
}

/** Mark a page superseded without deleting audit history. */
export async function supersedeLearningPage(pageId: string): Promise<LearningPage> {
  const pages = await readData<LearningPage[]>("pages.json");
  const page = pages.find((item) => item.id === pageId);
  if (!page) throw new Error(`page not found: ${pageId}`);
  if (page.status === "superseded") return page;
  page.status = "superseded";
  await writeData("pages.json", pages);
  return page;
}

/** 追加一条纯前端活动日志。 */
export async function appendActivityLog(
  item: Omit<ActivityLogItem, "id" | "timestamp"> & { id?: string; timestamp?: number },
): Promise<ActivityLogItem> {
  const list = await readData<ActivityLogItem[]>("activity_log.json");
  const next: ActivityLogItem = {
    id: item.id ?? `act_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    event: item.event,
    pageId: item.pageId,
    payload: item.payload,
    timestamp: item.timestamp ?? Date.now(),
  };
  list.push(next);
  await writeData("activity_log.json", list);
  return next;
}

/** 追加一条用户事件到跨进程队列。 */
export async function appendQueuedEvent(event: QueuedUserEvent): Promise<void> {
  const list = await readData<QueuedUserEvent[]>("message_queue.json");
  list.push(event);
  await writeData("message_queue.json", list);
}

/** 读取并清空跨进程队列。 */
export async function drainQueuedEvents(): Promise<QueuedUserEvent[]> {
  const list = await readData<QueuedUserEvent[]>("message_queue.json");
  if (list.length === 0) return [];
  await writeData("message_queue.json", []);
  return list;
}

/**
 * 追加一条即时问答记录到 qa_memory.json。
 * 前端即时问答(直连 LLM)完成后调用,Agent 可通过 get_qa_history 读取,
 * 保证 Agent 不丢失这部分学习信息。
 */
export async function appendQaHistory(item: QaItem): Promise<void> {
  const list = await readData<QaItem[]>("qa_memory.json");
  list.push(item);
  await writeData("qa_memory.json", list);
}

/**
 * 从 show_result 的 results 数组中提取错题并持久化到错题本。
 * 遍历 results,对 correct=false 的项构造 WrongAnswerItem 追加到 wrong_answers.json。
 *
 * @param results show_result 的 results 数组(每项含 correct, id, question? 等字段)
 * @param summary 可选的汇总信息(预留,当前未使用)
 */
export async function persistWrongAnswersFromResult(
  results: unknown[],
  summary?: unknown,
): Promise<void> {
  // summary 预留,当前未使用
  void summary;

  const wrongItems: WrongAnswerItem[] = [];
  for (const r of results) {
    if (typeof r !== "object" || r === null) continue;
    const item = r as Record<string, unknown>;
    if (item.correct !== false) continue;

    // TODO: Agent 可在 results 项里带 question 字段提供题目原文;
    //       当前若没有 question,则用 id 占位。
    const question = (item.question as string) ?? (item.id as string) ?? "";
    wrongItems.push({
      question,
      user_answer: item.user_answer ?? item.userAnswer ?? "",
      correct_answer: item.correct_answer ?? item.correctAnswer ?? "",
      explanation: item.explanation as string | undefined,
      chapter: item.chapter as string | undefined,
      timestamp: Date.now(),
      reason: "wrong",
    });
  }

  if (wrongItems.length === 0) return;
  for (const w of wrongItems) {
    await appendWrongAnswer(w);
  }
}

/**
 * 切换收藏状态:已有相同 question_id 则移除,否则追加。
 * @param item 前端发来的收藏数据,含 question_id / question / answer 等
 */
export async function toggleFavorite(item: Record<string, unknown>): Promise<void> {
  const id = (item.question_id as string) ?? (item.id as string) ?? "";
  const list = await readData<FavoriteItem[]>("favorites.json");
  const existingIdx = list.findIndex((f) => f.id === id);

  if (existingIdx >= 0) {
    // 已收藏 → 移除
    list.splice(existingIdx, 1);
    await writeData("favorites.json", list);
    return;
  }

  // 未收藏 → 追加
  list.push({
    id,
    question: (item.question as string) ?? "",
    answer: item.answer ?? "",
    timestamp: Date.now(),
  });
  await writeData("favorites.json", list);
}
