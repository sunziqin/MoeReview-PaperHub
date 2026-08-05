/**
 * ask_choice 模态框。
 * - 当 store.choicePrompt 不为 null 时,显示居中模态框(半透明遮罩 + 居中卡片)
 * - 用户点击选项后,发 { event: "choice", index, text } 唤醒后端并带回选择结果
 * - Esc 关闭并发"用户取消选择"(message 事件,后端据此返回 ok: false)
 * - 数字键 1-9 快速选择
 */
import { useEffect } from "react";
import type { CSSProperties } from "react";
import { useExamForgeStore } from "../store";
import type { ClientEvent } from "../types";

interface ChoiceModalProps {
  /** 发送事件到后端的回调 */
  sendEvent: (event: ClientEvent) => void;
}

export function ChoiceModal({ sendEvent }: ChoiceModalProps) {
  const choicePrompt = useExamForgeStore((s) => s.choicePrompt);
  const clearChoice = useExamForgeStore((s) => s.clearChoice);

  const options = choicePrompt?.options ?? [];

  /** 选择某个选项:发 choice 事件回去唤醒后端,再关闭模态框 */
  const choose = (index: number) => {
    if (!choicePrompt) return;
    const opt = choicePrompt.options[index];
    if (opt === undefined) return;
    sendEvent({ event: "choice", index, text: opt });
    clearChoice();
  };

  /** 取消:发取消消息并关闭 */
  const cancel = () => {
    sendEvent({ event: "message", text: "用户取消选择" });
    clearChoice();
  };

  // 键盘:Esc 取消,数字键 1-9 快速选择
  useEffect(() => {
    if (!choicePrompt) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        cancel();
        return;
      }
      const digit = Number(e.key);
      if (!Number.isNaN(digit) && digit >= 1 && digit <= choicePrompt.options.length) {
        e.preventDefault();
        choose(digit - 1);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choicePrompt]);

  if (!choicePrompt) return null;

  return (
    <div
      className="choice-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={choicePrompt.question}
      onClick={cancel}
    >
      <div className="choice-modal-card" onClick={(e) => e.stopPropagation()}>
        <h3 className="choice-modal-question">{choicePrompt.question}</h3>
        <ul className="choice-modal-options">
          {options.map((opt, i) => (
            <li key={i} style={{ "--i": i } as CSSProperties}>
              <button
                type="button"
                className="choice-modal-option"
                onClick={() => choose(i)}
              >
                <span className="choice-modal-option-key">{i + 1}</span>
                <span className="choice-modal-option-text">{opt}</span>
              </button>
            </li>
          ))}
        </ul>
        <p className="choice-modal-hint">数字键快速选择 · Esc 取消</p>
      </div>
    </div>
  );
}
