const DEFAULT_HUB_ORIGIN = "http://127.0.0.1:3456";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function getHubOrigin(): string {
  if (typeof window !== "undefined") {
    const current = new URL(window.location.href);
    if ((current.protocol === "http:" || current.protocol === "https:") && LOOPBACK_HOSTS.has(current.hostname)) {
      return current.origin;
    }
  }
  return DEFAULT_HUB_ORIGIN;
}

export function getHubWebSocketUrl(path = "/ws"): string {
  const current = new URL(getHubOrigin());
  current.protocol = current.protocol === "https:" ? "wss:" : "ws:";
  current.pathname = path;
  current.search = "";
  current.hash = "";
  return current.toString();
}
