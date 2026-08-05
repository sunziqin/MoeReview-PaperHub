/**
 * 扩展 Markdown 渲染器(ExamForge 知识画板)。
 *
 * 支持的语法:
 * 1. 标准 Markdown(react-markdown + remark-gfm):标题、列表、表格、链接、粗体斜体、引用
 * 2. 数学公式(rehype-katex):行内 $...$、块级 $$...$$
 * 3. 代码块(rehype-highlight):围栏代码块 + 复制按钮
 * 4. 图片:点击放大(modal)
 * 5. PDF 预览:自定义语法 !pdf(path, pages=12-13)
 * 6. 折叠区域:自定义语法 !!! 标题 \n 内容 \n !!!
 * 7. 提示框:blockquote 首字符为 emoji 时渲染成带色提示框
 * 8. HTML 交互预览:```html-preview,在隔离 iframe 中运行完整 HTML/CSS/JS
 */

import {
  createContext,
  isValidElement,
  memo,
  useContext,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import ReactMarkdown from "react-markdown";
import type { Components, ExtraProps } from "react-markdown";
import remarkDirective from "remark-directive";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import { visit } from "unist-util-visit";
import {
  BellRing,
  BookOpenText,
  Brain,
  CircleCheck,
  FlaskConical,
  GitCompareArrows,
  Link2,
  ListOrdered,
  Network,
  Sigma,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import type { MarkdownRenderMode } from "../types/htmlPreview";
import { rehypeHtmlPreview, remarkHtmlPreviewMeta } from "../markdown/rehypeHtmlPreview";
import { rehypeMermaid, remarkMermaidMeta } from "../markdown/rehypeMermaid";
import { HtmlPreview } from "./HtmlPreview";
import { MermaidDiagram } from "./MermaidDiagram";

const LEARNING_BLOCKS = new Set([
  "concept",
  "callout",
  "compare",
  "steps",
  "example",
  "formula",
  "checkpoint",
  "mistake",
  "memory-card",
  "memory",
  "diagram",
  "source",
]);

const BLOCK_ALIASES: Record<string, string> = {
  memory: "memory-card",
};

const CALLOUT_VARIANTS = new Set(["key", "tip", "note", "warning", "trap"]);

const BLOCK_PRESENTATION: Record<string, { label: string; icon: LucideIcon }> = {
  concept: { label: "概念", icon: BookOpenText },
  callout: { label: "重点", icon: BellRing },
  compare: { label: "对比", icon: GitCompareArrows },
  steps: { label: "步骤", icon: ListOrdered },
  example: { label: "示例", icon: FlaskConical },
  formula: { label: "公式", icon: Sigma },
  checkpoint: { label: "自测", icon: CircleCheck },
  mistake: { label: "易错", icon: TriangleAlert },
  "memory-card": { label: "记忆", icon: Brain },
  diagram: { label: "图解", icon: Network },
  source: { label: "来源", icon: Link2 },
};

const CALLOUT_LABELS: Record<string, string> = {
  key: "重点",
  tip: "提示",
  note: "说明",
  warning: "警告",
  trap: "陷阱",
};

interface DirectiveNode {
  type: string;
  name?: string;
  attributes?: Record<string, string | null | undefined>;
  data?: {
    hName?: string;
    hProperties?: Record<string, unknown>;
  };
}

function remarkLearningBlocks() {
  return (tree: unknown) => {
    visit(tree as never, ["containerDirective", "leafDirective"] as never, (node: DirectiveNode) => {
      const kind = node.name ?? "";
      if (!LEARNING_BLOCKS.has(kind)) return;
      const canonicalKind = BLOCK_ALIASES[kind] ?? kind;
      const requestedVariant = node.attributes?.type ?? "note";
      const variant = canonicalKind === "callout" && CALLOUT_VARIANTS.has(requestedVariant)
        ? requestedVariant
        : "";
      node.data ??= {};
      node.data.hName = "div";
      node.data.hProperties = {
        className: ["learning-block", `learning-block-${canonicalKind}`],
        dataKind: canonicalKind,
        dataTitle: node.attributes?.title ?? "",
        dataVariant: variant,
        dataPrompt: node.attributes?.prompt ?? "",
      };
    });
  };
}

const SANITIZE_SCHEMA = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), "html-preview", "mermaid-diagram"],
  attributes: {
    ...defaultSchema.attributes,
    div: [
      ...(defaultSchema.attributes?.div ?? []),
      ["className", "learning-block", /^learning-block-[a-z-]+$/],
      "dataKind",
      "dataTitle",
      "dataVariant",
      "dataPrompt",
    ],
    code: [...(defaultSchema.attributes?.code ?? []), ["className", /^language-[a-z0-9-]+$/]],
    "html-preview": ["dataTitle", "dataHeight"],
    "mermaid-diagram": ["dataTitle"],
  },
};

const MarkdownModeContext = createContext<MarkdownRenderMode>("document");

/* ============================================================
 * 提示框:blockquote 首字符为 emoji
 * ============================================================ */

/** emoji -> 样式 class / 中文标签 映射 */
const ADMONITIONS: Record<string, { cls: string; label: string }> = {
  "💡": { cls: "admonition-tip", label: "提示" },
  "⚠️": { cls: "admonition-warn", label: "警告" },
  "📌": { cls: "admonition-pin", label: "重点" },
  "❌": { cls: "admonition-error", label: "错误" },
};

/** 从 React 子节点树中递归提取纯文本,用于判断 emoji 前缀 */
function extractText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (isValidElement(node)) {
    const props = node.props as { children?: ReactNode };
    return extractText(props.children);
  }
  return "";
}

/**
 * 去掉 React 子节点树中第一个出现的 emoji 前缀。
 * 递归到包含该 emoji 的文本节点,把 emoji 去掉。
 * 仅处理顶层结构,不保证复杂嵌套场景完美,留 TODO。
 */
function stripEmojiPrefix(node: ReactNode, emoji: string): ReactNode {
  if (typeof node === "string") {
    if (node.startsWith(emoji)) return node.slice(emoji.length).replace(/^\s+/, "");
    return node;
  }
  if (Array.isArray(node)) {
    let stripped = false;
    return node.map((child) => {
      if (stripped) return child;
      const childText = extractText(child);
      if (childText.startsWith(emoji)) {
        stripped = true;
        return stripEmojiPrefix(child, emoji);
      }
      return child;
    });
  }
  if (isValidElement(node)) {
    const props = node.props as { children?: ReactNode };
    const newChildren = stripEmojiPrefix(props.children, emoji);
    return { ...node, props: { ...props, children: newChildren } };
  }
  return node;
}

/** blockquote 拦截器:检测 emoji 前缀,渲染成提示框 */
function Blockquote({ children }: ComponentProps<"blockquote"> & ExtraProps) {
  const text = extractText(children);
  const emoji = Object.keys(ADMONITIONS).find((e) => text.startsWith(e));
  if (emoji) {
    const cfg = ADMONITIONS[emoji];
    const cleaned = stripEmojiPrefix(children, emoji);
    return (
      <div className={`admonition ${cfg.cls}`}>
        <div className="admonition-label">{cfg.label}</div>
        <div className="admonition-content">{cleaned}</div>
      </div>
    );
  }
  return <blockquote className="md-blockquote">{children}</blockquote>;
}

/* ============================================================
 * 代码块:复制按钮
 * ============================================================ */

/** 复制按钮:点击复制代码,显示"已复制"反馈 */
function CopyButton({ getText }: { getText: () => string }) {
  const [copied, setCopied] = useState(false);
  const onClick = async () => {
    try {
      await navigator.clipboard.writeText(getText());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 剪贴板权限失败时静默忽略
    }
  };
  return (
    <button type="button" className="code-copy-btn" onClick={onClick}>
      {copied ? "已复制" : "复制"}
    </button>
  );
}

/** pre 拦截器:外层包 div,放复制按钮 */
function PreWithCopy({ children, ...props }: ComponentProps<"pre"> & ExtraProps) {
  const preRef = useRef<HTMLPreElement>(null);
  return (
    <div className="code-block">
      <CopyButton getText={() => preRef.current?.textContent ?? ""} />
      <pre ref={preRef} className="md-pre" {...props}>
        {children}
      </pre>
    </div>
  );
}

/* ============================================================
 * 图片:点击放大(modal)
 * ============================================================ */

/** 图片查看器:点击图片弹出 modal 放大显示 */
function ImageViewer({ src, alt }: { src?: string; alt?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <img
        className="md-img"
        src={src}
        alt={alt ?? ""}
        onClick={() => setOpen(true)}
        loading="lazy"
      />
      {open && (
        <div className="img-modal" onClick={() => setOpen(false)}>
          <img className="img-modal-content" src={src} alt={alt ?? ""} />
        </div>
      )}
    </>
  );
}

/* ============================================================
 * PDF 预览:!pdf(path, pages=12-13)
 * ============================================================ */

/**
 * PDF 预览组件。
 * 本地路径可能无法直接加载,先用 iframe 尝试 + "在 PDF 查看器中打开"按钮兜底。
 * 不引入 pdfjs-dist(太重)。
 */
function PdfPreview({ url, pages }: { url: string; pages?: string }) {
  return (
    <div className="pdf-preview">
      <div className="pdf-preview-header">
        <span className="pdf-preview-icon" aria-hidden>
          📄
        </span>
        <span className="pdf-preview-name">{url}</span>
        {pages && <span className="pdf-preview-pages">页码:{pages}</span>}
      </div>
      <div className="pdf-preview-actions">
        <a className="pdf-preview-link" href={url} target="_blank" rel="noreferrer">
          在 PDF 查看器中打开 ↗
        </a>
      </div>
      <iframe
        className="pdf-preview-frame"
        src={url}
        title="PDF 预览"
        sandbox="allow-same-origin allow-scripts allow-popups"
      />
    </div>
  );
}

/** img 拦截器:alt="pdf" 时渲染 PDF 预览,否则渲染图片查看器 */
function Img({ src, alt }: ComponentProps<"img"> & ExtraProps) {
  if (alt === "pdf") {
    let pages: string | undefined;
    let pdfUrl = src ?? "";
    try {
      const u = new URL(src ?? "", window.location.origin);
      pages = u.searchParams.get("pages") ?? undefined;
      pdfUrl = u.origin + u.pathname;
    } catch {
      // 相对路径解析失败时用简单 split
      const idx = (src ?? "").indexOf("?pages=");
      if (idx >= 0) {
        pages = decodeURIComponent(src!.slice(idx + "?pages=".length));
        pdfUrl = src!.slice(0, idx);
      }
    }
    return <PdfPreview url={pdfUrl} pages={pages} />;
  }
  return <ImageViewer src={src} alt={alt} />;
}

function SemanticBlock({ children, className, ...props }: ComponentProps<"div"> & ExtraProps) {
  const attributes = props as Record<string, unknown>;
  const kind = String(attributes.dataKind ?? attributes["data-kind"] ?? "");
  const title = String(attributes.dataTitle ?? attributes["data-title"] ?? "").trim();
  const variant = String(attributes.dataVariant ?? attributes["data-variant"] ?? "").trim();
  const prompt = String(attributes.dataPrompt ?? attributes["data-prompt"] ?? "").trim();
  if (!kind || !LEARNING_BLOCKS.has(kind)) {
    return <div className={className} {...props}>{children}</div>;
  }

  const presentation = BLOCK_PRESENTATION[kind] ?? BLOCK_PRESENTATION.concept;
  const Icon = presentation.icon;
  const label = kind === "callout" ? CALLOUT_LABELS[variant] ?? presentation.label : presentation.label;

  if (kind === "memory-card") {
    return (
      <details className={`${className ?? ""} memory-card`} data-kind={kind}>
        <summary className="memory-card-summary">
          <span><Icon size={15} />{presentation.label}</span>
          <strong>{prompt || title || "点击回忆"}</strong>
        </summary>
        <div className="learning-block-body memory-card-answer">
          {title && prompt && <div className="memory-card-topic">{title}</div>}
          {children}
        </div>
      </details>
    );
  }

  return (
    <section className={className} data-kind={kind} data-variant={variant || undefined}>
      <header className="learning-block-head">
        <span><Icon size={14} />{label}</span>
        {title && <strong>{title}</strong>}
      </header>
      <div className="learning-block-body">{children}</div>
    </section>
  );
}

interface HtmlPreviewElementProps extends ExtraProps {
  children?: ReactNode;
  dataTitle?: string;
  dataHeight?: string;
  "data-title"?: string;
  "data-height"?: string;
}

function HtmlPreviewElement({ children, ...props }: HtmlPreviewElementProps) {
  const mode = useContext(MarkdownModeContext);
  const title = props.dataTitle ?? props["data-title"];
  const height = props.dataHeight ?? props["data-height"];
  return (
    <HtmlPreview
      source={extractText(children)}
      title={title?.trim() || undefined}
      height={height ?? "auto"}
      mode={mode}
    />
  );
}

interface MermaidElementProps extends ExtraProps {
  children?: ReactNode;
  dataTitle?: string;
  "data-title"?: string;
}

function MermaidElement({ children, ...props }: MermaidElementProps) {
  const mode = useContext(MarkdownModeContext);
  const title = props.dataTitle ?? props["data-title"];
  return <MermaidDiagram source={extractText(children)} title={title?.trim() || undefined} mode={mode} />;
}

/* ============================================================
 * 折叠区域:!!! 标题 \n 内容 \n !!!
 * ============================================================ */

/** 折叠区域:用原生 details/summary,内容递归渲染 markdown */
function Collapsible({ title, content }: { title: string; content: string }) {
  const mode = useContext(MarkdownModeContext);
  return (
    <details className="collapsible">
      <summary className="collapsible-summary">{title}</summary>
      <div className="collapsible-content">
        <MarkdownRendererBase content={content} mode={mode} />
      </div>
    </details>
  );
}

/* ============================================================
 * 内容预处理与分段
 * ============================================================ */

type Segment =
  | { type: "md"; content: string }
  | { type: "collapse"; title: string; content: string };

/**
 * 把 !pdf(path, pages=xx-yy) 转成标准图片 ![pdf](path?pages=xx-yy)。
 * 这样 react-markdown 会解析成图片,alt="pdf",再被 Img 组件拦截。
 */
function preprocessPdf(content: string): string {
  return content.replace(/!pdf\(([^)]+)\)/g, (_m, args: string) => {
    const parts = args.split(",").map((s: string) => s.trim());
    const path = parts[0];
    const pagesParam = parts.slice(1).find((p: string) => p.startsWith("pages="));
    const pages = pagesParam ? pagesParam.slice("pages=".length) : undefined;
    const query = pages ? `?pages=${encodeURIComponent(pages)}` : "";
    return `![pdf](${path}${query})`;
  });
}

/**
 * 把 content 按折叠区域语法 !!! 标题 \n 内容 \n !!! 拆成段。
 * 简单版:不支持嵌套,遇到第一个 \n!!! 就结束当前块。
 */
function splitSegments(content: string): Segment[] {
  const segments: Segment[] = [];
  // 匹配 `!!! 标题\n...\n!!!`,标题可为空
  const re = /^!!![ \t]*(.*?)\n([\s\S]*?)\n!!![ \t]*$/gm;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    if (match.index > lastIndex) {
      const before = content.slice(lastIndex, match.index);
      if (before.trim()) segments.push({ type: "md", content: before });
    }
    const title = match[1].trim() || "详情";
    segments.push({ type: "collapse", title, content: match[2].trim() });
    lastIndex = re.lastIndex;
  }
  if (lastIndex < content.length) {
    const rest = content.slice(lastIndex);
    if (rest.trim()) segments.push({ type: "md", content: rest });
  }
  return segments.length > 0 ? segments : [{ type: "md", content }];
}

/* ============================================================
 * 主组件
 * ============================================================ */

/** react-markdown 的 components 配置(模块级常量,避免每次渲染创建新实例) */
const MD_COMPONENTS = {
  blockquote: Blockquote,
  div: SemanticBlock,
  pre: PreWithCopy,
  img: Img,
  "html-preview": HtmlPreviewElement,
  "mermaid-diagram": MermaidElement,
} as Components;

/** 单个 markdown 块渲染 */
function MarkdownBlock({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[
        remarkGfm,
        remarkMath,
        remarkDirective,
        remarkLearningBlocks,
        remarkHtmlPreviewMeta,
        remarkMermaidMeta,
      ]}
      rehypePlugins={[
        rehypeHtmlPreview,
        rehypeMermaid,
        rehypeRaw,
        [rehypeSanitize, SANITIZE_SCHEMA],
        rehypeKatex,
        rehypeHighlight,
      ]}
      components={MD_COMPONENTS}
    >
      {content}
    </ReactMarkdown>
  );
}

/** MarkdownRenderer 主实现(内部递归用) */
interface MarkdownRendererProps {
  content: string;
  mode?: MarkdownRenderMode;
}

function MarkdownRendererBase({ content, mode = "document" }: MarkdownRendererProps) {
  // 预处理 PDF 语法
  const preprocessed = useMemo(() => preprocessPdf(content), [content]);
  // 按折叠区域拆段
  const segments = useMemo(() => splitSegments(preprocessed), [preprocessed]);
  return (
    <MarkdownModeContext.Provider value={mode}>
      <div className="md-body">
        {segments.map((seg, i) =>
          seg.type === "collapse" ? (
            <Collapsible key={i} title={seg.title} content={seg.content} />
          ) : (
            <MarkdownBlock key={i} content={seg.content} />
          )
        )}
      </div>
    </MarkdownModeContext.Provider>
  );
}

/** 导出:memo 包装,避免 content 不变时重复渲染 */
export const MarkdownRenderer = memo(MarkdownRendererBase);
