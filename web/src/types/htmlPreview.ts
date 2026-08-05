export type HtmlPreviewTheme = "light" | "dark";

export type HtmlPreviewToHostMessage =
  | { type: "html-preview:ready" }
  | { type: "html-preview:resize"; height: number }
  | { type: "html-preview:error"; message: string };

export type HostToHtmlPreviewMessage =
  | { type: "html-preview:theme"; theme: HtmlPreviewTheme }
  | { type: "html-preview:measure" };

export type MarkdownRenderMode = "document" | "review" | "compact" | "streaming";
