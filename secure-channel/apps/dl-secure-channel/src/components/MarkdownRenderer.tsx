/**
 * MarkdownRenderer — Renders message content with Discord-style formatting:
 *   **bold**, *italic*, __underline__, ~~strikethrough~~,
 *   `inline code`, ```code blocks```, ||spoilers||, > blockquotes,
 *   URLs auto-linked.
 */
import { useState } from "react";
import clsx from "clsx";

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

interface MarkdownNode {
  type: "text" | "bold" | "italic" | "underline" | "strikethrough" | "code" | "codeblock" | "spoiler" | "blockquote" | "link" | "br";
  content?: string;
  children?: MarkdownNode[];
  language?: string;
  url?: string;
}

// The renderer uses a simple regex-based approach for Discord markdown.
export default function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  const nodes = parseMarkdown(content);
  return (
    <span className={clsx("markdown-renderer", className)}>
      {nodes.map((node, i) => (
        <RenderNode key={i} node={node} />
      ))}
    </span>
  );
}

function RenderNode({ node }: { node: MarkdownNode }) {
  switch (node.type) {
    case "text":
      return <>{node.content}</>;

    case "bold":
      return (
        <strong className="font-semibold text-white/95">
          {node.children?.map((c, i) => <RenderNode key={i} node={c} />)}
        </strong>
      );

    case "italic":
      return (
        <em className="italic">
          {node.children?.map((c, i) => <RenderNode key={i} node={c} />)}
        </em>
      );

    case "underline":
      return (
        <span className="underline decoration-white/40">
          {node.children?.map((c, i) => <RenderNode key={i} node={c} />)}
        </span>
      );

    case "strikethrough":
      return (
        <span className="line-through text-white/40">
          {node.children?.map((c, i) => <RenderNode key={i} node={c} />)}
        </span>
      );

    case "code":
      return (
        <code className="markdown-code-inline">{node.content}</code>
      );

    case "codeblock":
      return (
        <div className="markdown-codeblock">
          {node.language && (
            <div className="markdown-codeblock__lang">{node.language}</div>
          )}
          <pre className="markdown-codeblock__pre">
            <code>{node.content}</code>
          </pre>
        </div>
      );

    case "spoiler":
      return <SpoilerTag>{node.content ?? ""}</SpoilerTag>;

    case "blockquote":
      return (
        <div className="markdown-blockquote">
          <div className="markdown-blockquote__bar" />
          <div className="markdown-blockquote__text">
            {node.children?.map((c, i) => <RenderNode key={i} node={c} />)}
          </div>
        </div>
      );

    case "link":
      return (
        <a
          href={node.url}
          target="_blank"
          rel="noopener noreferrer"
          className="markdown-link"
        >
          {node.content ?? node.url}
        </a>
      );

    case "br":
      return <br />;

    default:
      return <>{node.content}</>;
  }
}

function SpoilerTag({ children }: { children: string }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <span
      className={clsx(
        "markdown-spoiler",
        !revealed && "markdown-spoiler--hidden"
      )}
      onClick={() => setRevealed(true)}
      role="button"
      tabIndex={0}
      title={revealed ? "" : "Click to reveal spoiler"}
    >
      {children}
    </span>
  );
}

// ── Simple Markdown Parser ──────────────────────────────────────────────────

function parseMarkdown(input: string): MarkdownNode[] {
  const nodes: MarkdownNode[] = [];
  let remaining = input;

  while (remaining.length > 0) {
    // Code block: ```lang\ncode```
    const cbMatch = remaining.match(/^```(\w*)\n?([\s\S]*?)```/);
    if (cbMatch) {
      nodes.push({ type: "codeblock", content: cbMatch[2], language: cbMatch[1] || undefined });
      remaining = remaining.slice(cbMatch[0].length);
      continue;
    }

    // Inline code: `code`
    const icMatch = remaining.match(/^`([^`]+)`/);
    if (icMatch) {
      nodes.push({ type: "code", content: icMatch[1] });
      remaining = remaining.slice(icMatch[0].length);
      continue;
    }

    // Spoiler: ||text||
    const spMatch = remaining.match(/^\|\|([^|]+)\|\|/);
    if (spMatch) {
      nodes.push({ type: "spoiler", content: spMatch[1] });
      remaining = remaining.slice(spMatch[0].length);
      continue;
    }

    // Bold: **text**
    const bMatch = remaining.match(/^\*\*(.+?)\*\*/);
    if (bMatch) {
      nodes.push({ type: "bold", children: parseMarkdown(bMatch[1]) });
      remaining = remaining.slice(bMatch[0].length);
      continue;
    }

    // Underline: __text__
    const uMatch = remaining.match(/^__(.+?)__/);
    if (uMatch) {
      nodes.push({ type: "underline", children: parseMarkdown(uMatch[1]) });
      remaining = remaining.slice(uMatch[0].length);
      continue;
    }

    // Italic: *text*
    const iMatch = remaining.match(/^\*(.+?)\*/);
    if (iMatch) {
      nodes.push({ type: "italic", children: parseMarkdown(iMatch[1]) });
      remaining = remaining.slice(iMatch[0].length);
      continue;
    }

    // Strikethrough: ~~text~~
    const sMatch = remaining.match(/^~~(.+?)~~/);
    if (sMatch) {
      nodes.push({ type: "strikethrough", children: parseMarkdown(sMatch[1]) });
      remaining = remaining.slice(sMatch[0].length);
      continue;
    }

    // Blockquote: > text (at start of line)
    const bqMatch = remaining.match(/^> (.+)/);
    if (bqMatch && (nodes.length === 0 || nodes[nodes.length - 1]?.type === "br")) {
      nodes.push({ type: "blockquote", children: parseMarkdown(bqMatch[1]) });
      remaining = remaining.slice(bqMatch[0].length);
      continue;
    }

    // URL: https://... or http://...
    const urlMatch = remaining.match(/^(https?:\/\/[^\s<]+)/);
    if (urlMatch) {
      nodes.push({ type: "link", url: urlMatch[1], content: urlMatch[1] });
      remaining = remaining.slice(urlMatch[0].length);
      continue;
    }

    // Newline
    if (remaining.startsWith("\n")) {
      nodes.push({ type: "br" });
      remaining = remaining.slice(1);
      continue;
    }

    // Plain text: consume up to next special char
    const nextSpecial = remaining.search(/[`*_~|>\n]|https?:\/\//);
    if (nextSpecial === -1) {
      nodes.push({ type: "text", content: remaining });
      break;
    } else if (nextSpecial === 0) {
      // Consume one char as text if no pattern matched
      nodes.push({ type: "text", content: remaining[0] });
      remaining = remaining.slice(1);
    } else {
      nodes.push({ type: "text", content: remaining.slice(0, nextSpecial) });
      remaining = remaining.slice(nextSpecial);
    }
  }

  return nodes;
}
