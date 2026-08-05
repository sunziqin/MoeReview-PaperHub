/**
 * 填空题渲染组件:单行文本输入。
 */
import type { QuizQuestion } from "../../types";

interface FillQuestionProps {
  question: QuizQuestion;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export function FillQuestion({ question, value, onChange, disabled = false }: FillQuestionProps) {
  return (
    <div className="q-fill">
      <p className="q-text">{question.question}</p>
      <input
        className="q-input"
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="输入答案..."
        disabled={disabled}
        aria-label="填空答案"
      />
    </div>
  );
}
