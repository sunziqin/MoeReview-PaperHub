/**
 * 前端判题工具。
 * choice/fill 在前端即时判题;short_answer/code 不前端判题(交由后端)。
 */

/**
 * 判断选择题是否正确(直接比较索引)。
 * @param userAnswer 用户选择的选项索引
 * @param correctAnswer 正确选项索引
 */
export function judgeChoice(userAnswer: unknown, correctAnswer: unknown): boolean {
  return userAnswer === correctAnswer;
}

/**
 * 判断填空题是否正确(忽略大小写和首尾空格)。
 */
export function judgeFill(userAnswer: unknown, correctAnswer: unknown): boolean {
  if (typeof userAnswer !== "string" || typeof correctAnswer !== "string") {
    return false;
  }
  return userAnswer.trim().toLowerCase() === correctAnswer.trim().toLowerCase();
}

/**
 * 将题目的正确答案格式化为可展示的字符串。
 * choice 显示对应选项文本,其余直接转字符串。
 */
export function formatAnswer(
  type: "choice" | "fill" | "short_answer" | "code",
  answer: unknown,
  options?: unknown[],
): string {
  if (answer === undefined || answer === null) return "";
  if (type === "choice") {
    const idx = typeof answer === "number" ? answer : Number(answer);
    const opts = (options as string[]) ?? [];
    const label = Number.isInteger(idx) && idx >= 0 ? String.fromCharCode(65 + idx) : String(answer);
    return opts[idx] !== undefined ? `${label}. ${String(opts[idx])}` : `选项 ${label}`;
  }
  return String(answer);
}

export function formatQuestionContext(question: {
  type: "choice" | "fill" | "short_answer" | "code";
  question: string;
  options?: unknown[];
  language?: string;
}): string {
  const labels = {
    choice: "选择题",
    fill: "填空题",
    short_answer: "简答题",
    code: "编程题",
  } as const;
  const lines = [`题型：${labels[question.type]}`, `题目：${question.question}`];
  if (question.type === "choice" && question.options?.length) {
    lines.push("选项：");
    question.options.forEach((option, index) => lines.push(`${String.fromCharCode(65 + index)}. ${String(option)}`));
  }
  if (question.type === "code" && question.language) lines.push(`语言：${question.language}`);
  return lines.join("\n");
}
