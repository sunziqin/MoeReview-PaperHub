/**
 * 顶部进度条:仅当 set_progress 有值时显示,3px 高。
 */

import { useExamForgeStore } from "../store";

export function ProgressBar() {
  const progress = useExamForgeStore((s) => s.progress);
  if (!progress) return null;

  const percent = Math.min(100, Math.max(0, progress.percent));
  return (
    <div className="progress" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${percent}%` }} />
      </div>
      {progress.label ? (
        <span className="progress-label">
          {progress.label} · {Math.round(percent)}%
        </span>
      ) : null}
    </div>
  );
}
