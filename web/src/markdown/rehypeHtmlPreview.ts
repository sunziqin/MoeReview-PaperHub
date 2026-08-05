import { visit } from "unist-util-visit";

interface HastText {
  type: "text";
  value: string;
}

interface HastElement {
  type: "element";
  tagName: string;
  properties?: Record<string, unknown>;
  children: Array<HastElement | HastText>;
  data?: { meta?: string };
}

interface HastParent {
  children: Array<HastElement | HastText>;
}

interface MdastCode {
  type: "code";
  lang?: string;
  meta?: string;
  data?: {
    hProperties?: Record<string, unknown>;
  };
}

export function parseFenceMeta(meta: string | undefined): Record<string, string> {
  if (!meta) return {};
  const values: Record<string, string> = {};
  let index = 0;

  while (index < meta.length) {
    while (/\s/.test(meta[index] ?? "")) index += 1;
    const keyStart = index;
    while (/[\w-]/.test(meta[index] ?? "")) index += 1;
    const key = meta.slice(keyStart, index);
    if (!key) break;
    while (/\s/.test(meta[index] ?? "")) index += 1;
    if (meta[index] !== "=") {
      values[key] = "true";
      continue;
    }
    index += 1;
    while (/\s/.test(meta[index] ?? "")) index += 1;
    const quote = meta[index] === '"' || meta[index] === "'" ? meta[index++] : "";
    const valueStart = index;
    if (quote) {
      while (index < meta.length && meta[index] !== quote) index += 1;
      values[key] = meta.slice(valueStart, index);
      if (meta[index] === quote) index += 1;
    } else {
      while (index < meta.length && !/\s/.test(meta[index])) index += 1;
      values[key] = meta.slice(valueStart, index);
    }
  }

  return values;
}

function textContent(node: HastElement | HastText): string {
  if (node.type === "text") return node.value;
  return node.children.map(textContent).join("");
}

export function remarkHtmlPreviewMeta() {
  return (tree: unknown) => {
    visit(tree as never, "code", (node: MdastCode) => {
      if (node.lang !== "html-preview") return;
      const meta = parseFenceMeta(node.meta);
      node.data ??= {};
      node.data.hProperties = {
        ...(node.data.hProperties ?? {}),
        dataPreviewTitle: meta.title ?? "",
        dataPreviewHeight: meta.height ?? "auto",
      };
    });
  };
}

export function rehypeHtmlPreview() {
  return (tree: unknown) => {
    visit(tree as never, "element", (node: HastElement, index: number | undefined, parent: HastParent | undefined) => {
      if (node.tagName !== "pre" || index === undefined || !parent) return;
      const code = node.children[0];
      if (!code || code.type !== "element" || code.tagName !== "code") return;
      const classNames = Array.isArray(code.properties?.className) ? code.properties.className : [];
      if (!classNames.includes("language-html-preview")) return;

      const meta = parseFenceMeta(code.data?.meta);
      parent.children[index] = {
        type: "element",
        tagName: "html-preview",
        properties: {
          dataTitle: String(code.properties?.dataPreviewTitle ?? meta.title ?? ""),
          dataHeight: String(code.properties?.dataPreviewHeight ?? meta.height ?? "auto"),
        },
        children: [{ type: "text", value: textContent(code) }],
      };
    });
  };
}
