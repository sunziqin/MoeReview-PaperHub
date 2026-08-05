/**
 * useGlobalHotkeys —— 全局键盘快捷键 hook。
 *
 * - 输入框聚焦时(document.activeElement 是 input/textarea/contentEditable),
 *   除 Esc 外全部失效(Ctrl+Enter 由 InputBar 自己处理)
 * - F → 切换专注模式;D → 切换深/浅主题;? → 弹出快捷键帮助面板
 * - Esc → 关闭帮助面板(ChoiceModal 的 Esc 由其自己处理,二者不冲突)
 * - 做题视图的快捷键(数字/字母/方向键)在 QuizView 里实现,这里不重复
 *
 * 返回 { showHelp, setShowHelp },由 App 用来渲染 HotkeysHelp 组件。
 */
import { useCallback, useEffect, useState } from "react";
import { useExamForgeStore } from "../store";
import { useTheme } from "./useTheme";
import { useWorkspaceStore } from "../workspaceStore";

export function useGlobalHotkeys() {
  const toggleFocusMode = useExamForgeStore((s) => s.toggleFocusMode);
  const { toggleTheme } = useTheme();
  const [showHelp, setShowHelp] = useState(false);

  const closeHelp = useCallback(() => setShowHelp(false), []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Esc:总生效(关闭帮助面板)
      if (e.key === "Escape") {
        if (showHelp) {
          e.preventDefault();
          closeHelp();
        }
        return;
      }

      // 输入框聚焦时,其余快捷键全部失效
      const target = e.target as HTMLElement | null;
      const active = document.activeElement as HTMLElement | null;
      const el = target ?? active;
      const tag = el?.tagName;
      const inField =
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        (el?.isContentEditable ?? false);
      if (inField) return;

      // 忽略带修饰键的组合(留给浏览器/其他快捷键)
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        if (!useExamForgeStore.getState().focusMode) useWorkspaceStore.getState().closeQa();
        toggleFocusMode();
      } else if (e.key === "d" || e.key === "D") {
        e.preventDefault();
        toggleTheme();
      } else if (e.key === "?") {
        e.preventDefault();
        setShowHelp(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [showHelp, closeHelp, toggleFocusMode, toggleTheme]);

  return { showHelp, setShowHelp };
}
