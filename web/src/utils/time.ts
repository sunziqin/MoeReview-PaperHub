/**
 * 相对时间格式化工具。
 * 用于在会话列表中显示"刚刚 / X分钟前 / X小时前 / X天前 / X月X日"。
 */

/** 一分钟、一小时、一天的毫秒数 */
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
/** 7 天阈值,超过则回退到日期格式 */
const SEVEN_DAYS_MS = 7 * DAY_MS;

/**
 * 把时间戳格式化为相对时间字符串。
 * - < 60 秒:"刚刚"
 * - < 60 分钟:"X分钟前"
 * - < 24 小时:"X小时前"
 * - < 7 天:"X天前"
 * - 否则:"X月X日"(用 toLocaleDateString)
 *
 * @param timestamp 毫秒时间戳
 */
export function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  // 时间戳在未来或非数字,回退到日期
  if (!Number.isFinite(diff) || diff < 0) {
    return formatDate(timestamp);
  }

  if (diff < MINUTE_MS) {
    return "刚刚";
  }
  if (diff < HOUR_MS) {
    const minutes = Math.floor(diff / MINUTE_MS);
    return `${minutes}分钟前`;
  }
  if (diff < DAY_MS) {
    const hours = Math.floor(diff / HOUR_MS);
    return `${hours}小时前`;
  }
  if (diff < SEVEN_DAYS_MS) {
    const days = Math.floor(diff / DAY_MS);
    return `${days}天前`;
  }
  return formatDate(timestamp);
}

/** 把时间戳格式化为"X月X日" */
function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleDateString("zh-CN", {
    month: "long",
    day: "numeric",
  });
}
