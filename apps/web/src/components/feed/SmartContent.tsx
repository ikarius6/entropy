import { useState, useMemo, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChevronDown, ChevronRight, Code2, ExternalLink } from "lucide-react";
import { classifyContent, escapeHashtags, extractUrls, type ParsedUrl } from "../../lib/content-utils";

/* ── Collapsible JSON viewer ──────────────────────────────────────────────── */

function CollapsibleJSON({ raw }: { raw: string }) {
  const [expanded, setExpanded] = useState(false);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.trim());
  } catch {
    parsed = null;
  }

  const preview = useMemo(() => {
    if (!parsed) return raw.slice(0, 80);
    if (typeof parsed === "object" && parsed !== null) {
      const keys = Object.keys(parsed as Record<string, unknown>);
      if (Array.isArray(parsed)) return `Array[${parsed.length}]`;
      return `{ ${keys.slice(0, 3).join(", ")}${keys.length > 3 ? ", …" : ""} }`;
    }
    return String(parsed).slice(0, 80);
  }, [parsed, raw]);

  return (
    <div className="rounded-lg border border-border bg-white/[0.03] overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white/[0.03] transition-colors"
      >
        {expanded ? <ChevronDown size={14} className="text-muted shrink-0" /> : <ChevronRight size={14} className="text-muted shrink-0" />}
        <Code2 size={14} className="text-accent shrink-0" />
        <span className="text-xs text-muted font-mono truncate">{preview}</span>
        <span className="ml-auto text-[10px] text-muted/60 shrink-0">JSON</span>
      </button>
      {expanded && (
        <pre className="px-3 pb-3 text-xs font-mono text-white/80 leading-relaxed overflow-x-auto max-h-[400px] overflow-y-auto border-t border-border bg-black/20">
          {parsed ? JSON.stringify(parsed, null, 2) : raw.trim()}
        </pre>
      )}
    </div>
  );
}

/* ── Inline media embeds (images / videos found in URLs) ─────────────────── */

function MediaEmbeds({ urls }: { urls: ParsedUrl[] }) {
  const media = urls.filter((u) => u.type === "image" || u.type === "video");
  if (media.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 mt-2">
      {media.map((m) =>
        m.type === "image" ? (
          <a key={m.url} href={m.url} target="_blank" rel="noopener noreferrer" className="block">
            <img
              src={m.url}
              alt=""
              loading="lazy"
              className="rounded-lg max-h-[400px] object-contain border border-border bg-black/30"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          </a>
        ) : (
          <video
            key={m.url}
            src={m.url}
            controls
            preload="metadata"
            className="rounded-lg max-h-[400px] w-full border border-border bg-black/30"
          />
        )
      )}
    </div>
  );
}

/* ── Link previews (non-media URLs shown as chips) ───────────────────────── */

function LinkChips({ urls }: { urls: ParsedUrl[] }) {
  const links = urls.filter((u) => u.type === "link");
  if (links.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {links.map((l) => {
        let hostname: string;
        try { hostname = new URL(l.url).hostname; } catch { hostname = l.url.slice(0, 30); }
        return (
          <a
            key={l.url}
            href={l.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-primary/80 hover:text-primary bg-primary/5 hover:bg-primary/10 border border-primary/10 rounded-md px-2 py-1 transition-colors truncate max-w-[280px]"
          >
            <ExternalLink size={11} className="shrink-0" />
            {hostname}
          </a>
        );
      })}
    </div>
  );
}

/* ── Markdown renderer with hashtag-safe preprocessing ───────────────────── */

/** Custom Markdown components for styling inside the feed */
const mdComponents: Record<string, (props: Record<string, unknown>) => ReactNode> = {
  // Links open in new tab
  a: ({ href, children }: Record<string, unknown>) => (
    <a
      href={href as string}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary hover:underline break-all"
    >
      {children as ReactNode}
    </a>
  ),
  // Prevent giant headings from random markdown — cap at a reasonable style
  h1: ({ children }: Record<string, unknown>) => <span className="font-bold text-white">{children as ReactNode}</span>,
  h2: ({ children }: Record<string, unknown>) => <span className="font-bold text-white">{children as ReactNode}</span>,
  h3: ({ children }: Record<string, unknown>) => <span className="font-semibold text-white">{children as ReactNode}</span>,
  h4: ({ children }: Record<string, unknown>) => <span className="font-semibold text-white/90">{children as ReactNode}</span>,
  h5: ({ children }: Record<string, unknown>) => <span className="font-medium text-white/90">{children as ReactNode}</span>,
  h6: ({ children }: Record<string, unknown>) => <span className="font-medium text-white/80">{children as ReactNode}</span>,
  // Code blocks
  code: ({ children, className }: Record<string, unknown>) => {
    const isInline = !className;
    if (isInline) {
      return <code className="bg-white/10 text-accent px-1 py-0.5 rounded text-[0.85em] font-mono break-all">{children as ReactNode}</code>;
    }
    return (
      <pre className="bg-black/30 border border-border rounded-lg p-3 overflow-x-auto my-1 max-w-full">
        <code className={`text-xs font-mono whitespace-pre-wrap break-words ${className}`}>{children as ReactNode}</code>
      </pre>
    );
  },
  // Blockquote
  blockquote: ({ children }: Record<string, unknown>) => (
    <blockquote className="border-l-2 border-primary/40 pl-3 text-white/70 italic my-1">{children as ReactNode}</blockquote>
  ),
  // Lists
  ul: ({ children }: Record<string, unknown>) => <ul className="list-disc list-inside space-y-0.5 my-1">{children as ReactNode}</ul>,
  ol: ({ children }: Record<string, unknown>) => <ol className="list-decimal list-inside space-y-0.5 my-1">{children as ReactNode}</ol>,
  // Paragraphs — no extra margin inside feed cards
  p: ({ children }: Record<string, unknown>) => <p className="mb-1 last:mb-0">{children as ReactNode}</p>,
  // Images in markdown
  img: ({ src, alt }: Record<string, unknown>) => (
    <img
      src={src as string}
      alt={(alt as string) || ""}
      loading="lazy"
      className="rounded-lg max-h-[400px] object-contain border border-border bg-black/30 my-1"
      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
    />
  ),
};

function MarkdownBody({ text }: { text: string }) {
  const processed = useMemo(() => escapeHashtags(text), [text]);
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
      {processed}
    </ReactMarkdown>
  );
}

/* ── SmartContent — the main export ──────────────────────────────────────── */

interface SmartContentProps {
  content: string;
  /** Compact mode for replies — skips media embeds */
  compact?: boolean;
}

export function SmartContent({ content, compact = false }: SmartContentProps) {
  const contentType = useMemo(() => classifyContent(content), [content]);
  const urls = useMemo(() => extractUrls(content), [content]);

  if (contentType === "json") {
    return <CollapsibleJSON raw={content} />;
  }

  // For rich/text, strip media URLs from the displayed markdown text so we
  // don't show raw URLs AND the rendered media embed.
  const textForMd = useMemo(() => {
    if (compact) return content;
    let cleaned = content;
    for (const u of urls) {
      if (u.type === "image" || u.type === "video") {
        cleaned = cleaned.replace(u.url, "").trim();
      }
    }
    return cleaned;
  }, [content, urls, compact]);

  return (
    <div className="text-white/90 break-words leading-relaxed smart-content">
      {textForMd && <MarkdownBody text={textForMd} />}
      {!compact && <MediaEmbeds urls={urls} />}
      {!compact && <LinkChips urls={urls} />}
    </div>
  );
}
