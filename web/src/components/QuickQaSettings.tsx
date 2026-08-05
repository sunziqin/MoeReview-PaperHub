/**
 * 即时问答的配置提示。
 *
 * 具体配置统一放在 /settings，避免在输入栏、论文页和问答抽屉之间
 * 复制 API Base URL、模型和 API Key 表单。
 */

import { useEffect, useState } from "react";
import { CheckCircle2, ExternalLink, LoaderCircle, X } from "lucide-react";
import type { QuickQaConfig } from "../types";
import { fetchQuickQaConfig, testQuickQaConnection } from "../services/quickQa";

interface QuickQaSettingsProps {
  open: boolean;
  onClose: () => void;
  onConfigChange?: (config: QuickQaConfig) => void;
}

function openSettings(): void {
  window.history.pushState(null, "", "/settings#ai");
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function QuickQaSettings({ open, onClose, onConfigChange }: QuickQaSettingsProps) {
  const [config, setConfig] = useState<QuickQaConfig | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setTestResult(null);
    void fetchQuickQaConfig().then((next) => {
      setConfig(next);
      onConfigChange?.(next);
    }).catch(() => setConfig(null));
  }, [onConfigChange, open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, open]);

  if (!open) return null;

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      await testQuickQaConnection();
      setTestResult({ ok: true, message: "连接成功，模型可以正常响应。" });
    } catch (error) {
      setTestResult({ ok: false, message: error instanceof Error ? error.message : String(error) });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="qa-settings-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="即时问答配置">
      <div className="qa-settings-modal" onClick={(event) => event.stopPropagation()}>
        <header className="qa-settings-head">
          <div>
            <span className="qa-settings-eyebrow">UNIFIED SETTINGS</span>
            <h2>即时问答使用统一 AI 配置</h2>
          </div>
          <button type="button" className="qa-settings-close" onClick={onClose} aria-label="关闭"><X size={18} /></button>
        </header>
        <p className="qa-settings-note">API 地址、模型、提示词和 API Key 只在设置中心管理。API Key 保存在本机 Hub，不会进入浏览器存储。</p>
        <div className={`qa-settings-status${config?.configured ? " is-ready" : " is-missing"}`}>
          <CheckCircle2 size={18} />
          <span>{config?.configured ? `已配置：${config.model}` : "尚未配置 API Key"}</span>
        </div>
        <div className="qa-settings-actions">
          <button type="button" className="qa-settings-btn qa-settings-btn-primary" onClick={() => { onClose(); openSettings(); }}>
            前往设置中心 <ExternalLink size={15} />
          </button>
          <button type="button" className="qa-settings-btn qa-settings-btn-ghost" onClick={() => void handleTest()} disabled={testing || !config?.configured}>
            {testing ? <LoaderCircle size={15} className="spin" /> : <CheckCircle2 size={15} />}
            测试连接
          </button>
        </div>
        {testResult && <p className={`qa-connection-result${testResult.ok ? " is-ok" : " is-error"}`} role="status">{testResult.message}</p>}
      </div>
    </div>
  );
}
