import { callApiAgent } from "./apiAgent.js";

export type LearningIntent = "overview" | "chapter" | "cards" | "quiz-choice" | "quiz-short" | "ask";

export interface LearningSourceContext {
  paperId?: string;
  title?: string;
  authors?: string[];
  sourceUrl?: string;
  abstract?: string;
  readingGuide?: Record<string, unknown>;
  selectedSectionId?: string;
  selectedSectionTitle?: string;
  selectedPassage?: string;
  recentPages?: Array<{ title: string; summary: string }>;
}

export type LearningTurnPlan =
  | { kind: "page"; title: string; markdown: string; guidance?: string[] }
  | { kind: "cards"; cards: Array<{ title: string; content: string }>; guidance?: string[] }
  | { kind: "quiz"; mode: "sequential" | "batch"; questions: Array<{ id: string; type: "choice" | "short_answer"; question: string; answer: unknown; options?: string[] }>; guidance?: string[] };

function extractJson(text: string): Record<string, unknown> {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced ?? text.match(/\{[\s\S]*\}/)?.[0];
  if (!candidate) throw new Error("Learning API did not return structured JSON.");
  try { return JSON.parse(candidate) as Record<string, unknown>; } catch { throw new Error("Learning API returned invalid JSON."); }
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(text).filter(Boolean).slice(0, 12) : [];
}

function normalizePlan(intent: LearningIntent, parsed: Record<string, unknown>): LearningTurnPlan {
  const guidance = strings(parsed.guidance);
  if (intent === "cards") {
    const cards = Array.isArray(parsed.cards) ? parsed.cards.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const record = item as Record<string, unknown>;
      const title = text(record.title);
      const content = text(record.content);
      return title && content ? [{ title, content }] : [];
    }).slice(0, 12) : [];
    if (!cards.length) throw new Error("Learning API did not return knowledge cards.");
    return { kind: "cards", cards, guidance };
  }

  if (intent === "quiz-choice" || intent === "quiz-short") {
    const expectedType: "choice" | "short_answer" = intent === "quiz-choice" ? "choice" : "short_answer";
    const questions = Array.isArray(parsed.questions) ? parsed.questions.flatMap((item, index) => {
      if (!item || typeof item !== "object") return [];
      const record = item as Record<string, unknown>;
      const question = text(record.question);
      if (!question || record.answer === undefined) return [];
      const options = expectedType === "choice" && Array.isArray(record.options)
        ? record.options.map(String).map((option) => option.trim()).filter(Boolean)
        : undefined;
      if (expectedType === "choice" && (!options || options.length < 2)) return [];
      return [{ id: text(record.id) || `q${index + 1}`, type: expectedType, question, answer: record.answer, options }];
    }).slice(0, 10) : [];
    if (!questions.length) throw new Error("Learning API did not return valid quiz questions.");
    return { kind: "quiz", mode: "sequential", questions, guidance };
  }

  const title = text(parsed.title);
  const markdown = text(parsed.markdown);
  if (!title || !markdown) throw new Error("Learning API did not return a learning page.");
  return { kind: "page", title, markdown, guidance };
}

function intentInstruction(intent: LearningIntent, prompt: string): string {
  if (intent === "overview") return "Create a detailed whole-paper explanation covering background, research question, method, experiments, findings, limitations, and key terms.";
  if (intent === "chapter") return "Create a chapter learning route, identify the most important method chapter, and explain it step by step in plain language.";
  if (intent === "cards") return "Create 6-10 durable knowledge cards. Return JSON fields cards (array of title/content) and guidance. Each content is readable Markdown.";
  if (intent === "quiz-choice") return "Create exactly 5 source-grounded multiple-choice questions. Return JSON fields questions and guidance. Each question has id, question, options, and answer. The answer must exactly match one option.";
  if (intent === "quiz-short") return "Create exactly 3 progressive short-answer questions. Return JSON fields questions and guidance. Each question has id, question, and a detailed scoring-reference answer.";
  return `Answer the learner's question as a durable detailed learning page: ${prompt}`;
}

export async function createLearningTurnPlan(input: {
  intent: LearningIntent;
  prompt: string;
  context: LearningSourceContext;
}): Promise<LearningTurnPlan> {
  const context = JSON.stringify(input.context, null, 2).slice(0, 70_000);
  const pageShape = "Return JSON only with fields title, markdown, guidance (array).";
  const raw = await callApiAgent([{
    role: "user",
    content: [
      "You are MoeReview's paper learning tutor.",
      "Use only the supplied source context for paper claims. Clearly say when the context is insufficient.",
      "Explain in detailed plain Simplified Chinese. Preserve important technical terms as 中文术语（English keyword）.",
      "Keep paper identifiers, model names, datasets, metrics, equations, variables, citations, and numbers unchanged.",
      input.intent === "cards" || input.intent.startsWith("quiz-") ? "Return JSON only." : pageShape,
      intentInstruction(input.intent, input.prompt),
      input.prompt ? `Learner request: ${input.prompt}` : "",
      `Source context:\n${context}`,
    ].filter(Boolean).join("\n\n"),
  }]);
  try {
    return normalizePlan(input.intent, extractJson(raw));
  } catch (error) {
    if (input.intent === "cards" || input.intent.startsWith("quiz-")) throw error;
    return {
      kind: "page",
      title: input.intent === "overview" ? "论文整体解析" : input.intent === "chapter" ? "章节学习路线" : "论文导师答复",
      markdown: raw.trim(),
      guidance: [],
    };
  }
}
