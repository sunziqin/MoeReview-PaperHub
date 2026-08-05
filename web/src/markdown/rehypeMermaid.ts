import { visit } from "unist-util-visit";
import { parseFenceMeta } from "./rehypeHtmlPreview";

interface TreeText {
  type: "text";
  value: string;
}

interface TreeElement {
  type: "element";
  tagName: string;
  properties?: Record<string, unknown>;
  children: Array<TreeElement | TreeText>;
  data?: { meta?: string };
}

interface TreeParent {
  children: Array<TreeElement | TreeText>;
}

interface CodeNode {
  type: "code";
  lang?: string;
  meta?: string;
  data?: { hProperties?: Record<string, unknown> };
}

function textContent(node: TreeElement | TreeText): string {
  if (node.type === "text") return node.value;
  return node.children.map(textContent).join("");
}

export function remarkMermaidMeta() {
  return (tree: unknown) => {
    visit(tree as never, "code", (node: CodeNode) => {
      if (node.lang !== "mermaid") return;
      const meta = parseFenceMeta(node.meta);
      node.data ??= {};
      node.data.hProperties = {
        ...(node.data.hProperties ?? {}),
        dataDiagramTitle: meta.title ?? "",
      };
    });
  };
}

export function rehypeMermaid() {
  return (tree: unknown) => {
    visit(tree as never, "element", (node: TreeElement, index: number | undefined, parent: TreeParent | undefined) => {
      if (node.tagName !== "pre" || index === undefined || !parent) return;
      const code = node.children[0];
      if (!code || code.type !== "element" || code.tagName !== "code") return;
      const classNames = Array.isArray(code.properties?.className) ? code.properties.className : [];
      if (!classNames.includes("language-mermaid")) return;

      const meta = parseFenceMeta(code.data?.meta);
      parent.children[index] = {
        type: "element",
        tagName: "mermaid-diagram",
        properties: {
          dataTitle: String(code.properties?.dataDiagramTitle ?? meta.title ?? ""),
        },
        children: [{ type: "text", value: textContent(code) }],
      };
    });
  };
}
