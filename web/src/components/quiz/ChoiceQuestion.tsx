/**
 * 选择题(单选)渲染组件。
 * 渲染可点击选项卡片,选中高亮。
 * 快捷键(1-9 / a-d)由父组件 QuizView 处理。
 */
import type { CSSProperties } from "react";
import type { QuizQuestion } from "../../types";

interface ChoiceQuestionProps {
  question: QuizQuestion;
  /** 当前选中索引,未选为 null */
  selectedValue: number | null;
  /** 选中回调 */
  onSelect: (index: number) => void;
  /** 是否禁用(提交后不再可改) */
  disabled?: boolean;
}

export function ChoiceQuestion({
  question,
  selectedValue,
  onSelect,
  disabled = false,
}: ChoiceQuestionProps) {
  const options = (question.options as string[]) ?? [];

  return (
    <div className="q-choice">
      <p className="q-text">{question.question}</p>
      <ul className="q-options">
        {options.map((opt, i) => {
          const selected = selectedValue === i;
          const label = String.fromCharCode(65 + i); // A, B, C...
          return (
            <li key={i} style={{ "--i": i } as CSSProperties}>
              <button
                type="button"
                className={`q-option${selected ? " selected" : ""}`}
                onClick={() => onSelect(i)}
                disabled={disabled}
                aria-pressed={selected}
              >
                <span className="q-option-label">{label}</span>
                <span className="q-option-text">{opt}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
