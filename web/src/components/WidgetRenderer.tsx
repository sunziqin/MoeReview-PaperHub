/**
 * Widget 渲染器:按 widget.type 渲染对应样式。
 * - stat:大号数值 + 标签 + 趋势箭头(↑绿/↓红/→灰)
 * - list:标题 + 列表项,每项有状态标记(✓绿/●蓝进行中/○灰未开始)
 * - text:普通文本段落
 * - progress:标签 + 进度条
 */
import type { CSSProperties } from "react";
import type { Widget } from "../types";

/** 趋势箭头与颜色 */
function renderTrend(trend: "up" | "down" | "flat"): { symbol: string; cls: string } {
  switch (trend) {
    case "up":
      return { symbol: "↑", cls: "trend-up" };
    case "down":
      return { symbol: "↓", cls: "trend-down" };
    default:
      return { symbol: "→", cls: "trend-flat" };
  }
}

/** 列表项状态标记 */
function renderListStatus(status: "done" | "current" | "pending" | undefined): { symbol: string; cls: string } {
  switch (status) {
    case "done":
      return { symbol: "✓", cls: "list-status-done" };
    case "current":
      return { symbol: "●", cls: "list-status-current" };
    case "pending":
      return { symbol: "○", cls: "list-status-pending" };
    default:
      return { symbol: "·", cls: "list-status-default" };
  }
}

interface WidgetRendererProps {
  widget: Widget;
  /** 错峰入场序号(由父组件传入) */
  index?: number;
}

export function WidgetRenderer({ widget, index }: WidgetRendererProps) {
  const staggerStyle = { "--i": index ?? 0 } as CSSProperties;
  switch (widget.type) {
    case "stat": {
      const trend = widget.trend ? renderTrend(widget.trend) : null;
      return (
        <div className="widget widget-stat" style={staggerStyle}>
          <div className="widget-stat-value">
            {widget.value}
            {trend && <span className={`widget-trend ${trend.cls}`}>{trend.symbol}</span>}
          </div>
          <div className="widget-stat-label">{widget.label}</div>
        </div>
      );
    }
    case "list":
      return (
        <div className="widget widget-list" style={staggerStyle}>
          {widget.title && <div className="widget-list-title">{widget.title}</div>}
          <ul className="widget-list-items">
            {widget.items.map((item, i) => {
              const status = renderListStatus(item.status);
              return (
                <li className="widget-list-item" key={i}>
                  <span className={`widget-list-mark ${status.cls}`}>{status.symbol}</span>
                  <span className="widget-list-label">{item.label}</span>
                  {item.detail && <span className="widget-list-detail">{item.detail}</span>}
                </li>
              );
            })}
          </ul>
        </div>
      );
    case "text":
      return (
        <div className="widget widget-text" style={staggerStyle}>
          <p className="widget-text-content">{widget.content}</p>
        </div>
      );
    case "progress": {
      const percent = Math.min(100, Math.max(0, widget.percent));
      return (
        <div className="widget widget-progress" style={staggerStyle}>
          <div className="widget-progress-head">
            <span className="widget-progress-label">{widget.label}</span>
            <span className="widget-progress-percent">{Math.round(percent)}%</span>
          </div>
          <div className="widget-progress-track">
            <div className="widget-progress-fill" style={{ width: `${percent}%` }} />
          </div>
        </div>
      );
    }
    default:
      return null;
  }
}
