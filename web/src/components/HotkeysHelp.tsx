/**
 * 快捷键帮助面板。
 * - open 为 true 时显示半透明遮罩 + 居中卡片,列出所有快捷键
 * - 点遮罩或按 Esc 关闭(onClose)
 * - 快捷键分两组:全局、做题视图(sequential)
 */

import { X } from "lucide-react";

interface HotkeysHelpProps {
  /** 是否显示 */
  open: boolean;
  /** 关闭回调 */
  onClose: () => void;
}

interface HotkeyItem {
  keys: string;
  desc: string;
}

const globalHotkeys: HotkeyItem[] = [
  { keys: "F", desc: "切换专注模式(隐藏/显示侧边栏)" },
  { keys: "D", desc: "切换深色/浅色主题" },
  { keys: "?", desc: "打开快捷键帮助" },
  { keys: "Esc", desc: "关闭弹层 / 模态框" },
  { keys: "Ctrl+Enter", desc: "发送消息(输入框聚焦时)" },
];

const quizHotkeys: HotkeyItem[] = [
  { keys: "1-9", desc: "选择对应选项(choice 题)" },
  { keys: "a-d", desc: "选择对应选项(choice 题)" },
  { keys: "Enter", desc: "提交当前题" },
  { keys: "Shift+Enter", desc: "查看答案" },
  { keys: "→ / ↓", desc: "下一题" },
  { keys: "← / ↑", desc: "上一题" },
];

export function HotkeysHelp({ open, onClose }: HotkeysHelpProps) {
  if (!open) return null;

  const renderGroup = (title: string, items: HotkeyItem[]) => (
    <section className="hotkeys-group">
      <h3 className="hotkeys-group-title">{title}</h3>
      <ul className="hotkeys-list">
        {items.map((item) => (
          <li className="hotkeys-row" key={item.keys}>
            <kbd className="hotkeys-key">{item.keys}</kbd>
            <span className="hotkeys-desc">{item.desc}</span>
          </li>
        ))}
      </ul>
    </section>
  );

  return (
    <div
      className="hotkeys-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="快捷键帮助"
      onClick={onClose}
    >
      <div
        className="hotkeys-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="hotkeys-head">
          <h2 className="hotkeys-title">快捷键</h2>
          <button
            type="button"
            className="hotkeys-close"
            onClick={onClose}
            aria-label="关闭"
          >
            <X size={18} />
          </button>
        </div>
        {renderGroup("全局", globalHotkeys)}
        {renderGroup("做题视图(sequential)", quizHotkeys)}
        <p className="hotkeys-foot">输入框聚焦时,除 Esc 外的全局快捷键失效</p>
      </div>
    </div>
  );
}
