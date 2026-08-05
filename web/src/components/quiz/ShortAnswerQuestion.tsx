/**
 * 简答题渲染组件:多行文本输入。
 */
import type { QuizQuestion } from "../../types";

interface ShortAnswerQuestionProps {
  question: QuizQuestion;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export function ShortAnswerQuestion({
  question,
  value,
  onChange,
  disabled = false,
}: ShortAnswerQuestionProps) {
  return (
    <div className="q-short">
      <p className="q-text">{question.question}</p>
      <textarea
        className="q-textarea"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="输入你的回答..."
        rows={6}
        disabled={disabled}
        aria-label="简答题答案"
      />
    </div>
  );
}
