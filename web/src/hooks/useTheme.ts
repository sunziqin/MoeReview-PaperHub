/**
 * useTheme —— 浅色/深色/跟随系统 主题切换(全应用单例)。
 *
 * 早期版本每个组件各持一份 useState,导致 TopBar 按钮与 D 快捷键图标不同步。
 * 现改为模块级单例 + useSyncExternalStore,所有调用方共享同一份状态,
 * DOM 应用与 localStorage 持久化集中管理,确保按钮与快捷键始终一致。
 *
 * - theme:"light" | "dark" | "system" 是用户偏好;resolvedTheme 是实际生效的浅/深
 * - setTheme(theme):持久化到 localStorage,并写到 document.documentElement.dataset.theme
 * - toggleTheme():在 light/dark 间切换(忽略 system)
 * - system 模式:监听 matchMedia('(prefers-color-scheme: dark)') 变化
 */
import { useCallback, useSyncExternalStore } from "react";

export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "examforge-theme";

interface ThemeSnapshot {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
}

function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined" || !window.matchMedia) return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function resolve(theme: Theme): ResolvedTheme {
  return theme === "system" ? getSystemTheme() : theme;
}

function apply(r: ResolvedTheme): void {
  if (typeof document !== "undefined") {
    document.documentElement.dataset.theme = r;
  }
}

/* ---------- 模块级单例状态 ---------- */

let theme: Theme =
  typeof window === "undefined"
    ? "system"
    : (window.localStorage.getItem(STORAGE_KEY) as Theme | null) ?? "system";
let resolvedTheme: ResolvedTheme = resolve(theme);
apply(resolvedTheme);

let snapshot: ThemeSnapshot = { theme, resolvedTheme };
const listeners = new Set<() => void>();

function emit(): void {
  snapshot = { theme, resolvedTheme };
  listeners.forEach((l) => l());
}

// system 模式下监听系统主题变化(全局只注册一次)
if (typeof window !== "undefined" && window.matchMedia) {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", () => {
    if (theme !== "system") return;
    resolvedTheme = getSystemTheme();
    apply(resolvedTheme);
    emit();
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): ThemeSnapshot {
  return snapshot;
}

function setThemeInternal(next: Theme): void {
  theme = next;
  resolvedTheme = resolve(next);
  apply(resolvedTheme);
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* localStorage 不可用时静默忽略 */
  }
  emit();
}

/* ---------- 对外 hook(API 与旧版保持一致) ---------- */

export function useTheme() {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const setTheme = useCallback((next: Theme) => setThemeInternal(next), []);
  // resolvedTheme 是模块级变量,回调在调用时读取其最新值
  const toggleTheme = useCallback(() => {
    const next: Theme = resolvedTheme === "dark" ? "light" : "dark";
    setThemeInternal(next);
  }, []);
  return {
    theme: snap.theme,
    resolvedTheme: snap.resolvedTheme,
    setTheme,
    toggleTheme,
  };
}
