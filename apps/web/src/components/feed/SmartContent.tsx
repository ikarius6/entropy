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
    <div className="surface-subtle overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-white/[0.03]"
      >
        {expanded ? <ChevronDown size={14} className="text-muted shrink-0" /> : <ChevronRight size={14} className="text-muted shrink-0" />}
        <Code2 size={14} className="text-primary shrink-0" />
        <span className="truncate font-mono text-xs text-muted">{preview}</span>
        <span className="ml-auto text-[10px] text-muted/60 shrink-0">JSON</span>
      </button>
      {expanded && (
        <pre className="code-block max-h-[400px] overflow-x-auto overflow-y-auto border-x-0 border-b-0 rounded-none border-t px-3 pb-3 pt-3 font-mono text-xs leading-relaxed text-main/80">
          {parsed ? JSON.stringify(parsed, null, 2) : raw.trim()}
        </pre>
      )}
    </div>
  );
}

/* ── Inline media embeds (images / videos found in URLs) ─────────────────── */

// Max images shown in the grid before collapsing behind "+N more"
const GRID_MAX = 4;

function MediaEmbeds({ urls }: { urls: ParsedUrl[] }) {
  const [expanded, setExpanded] = useState(false);

  const images = urls.filter((u) => u.type === "image");
  const videos = urls.filter((u) => u.type === "video");

  if (images.length === 0 && videos.length === 0) return null;

  const visibleImages = expanded ? images : images.slice(0, GRID_MAX);
  const hiddenCount   = images.length - GRID_MAX;
  const showOverlay   = !expanded && hiddenCount > 0;

  // Grid layout class based on visible image count
  const gridClass =
    visibleImages.length === 1 ? "grid-cols-1" :
    visibleImages.length === 2 ? "grid-cols-2" :
    "grid-cols-2";

  return (
    <div className="flex flex-col gap-2 mt-2">
      {/* Image grid */}
      {images.length > 0 && (
        <div className={`grid ${gridClass} gap-1.5`}>
          {visibleImages.map((m, i) => {
            const isLastVisible = i === visibleImages.length - 1;
            const showMore = showOverlay && isLastVisible;
            return (
              <div key={m.url} className="relative overflow-hidden rounded-md border border-border bg-inverted/20">
                <a href={m.url} target="_blank" rel="noopener noreferrer" className="block">
                  <img
                    src={m.url}
                    alt=""
                    loading="lazy"
                    className="h-[200px] w-full object-cover"
                    onError={(e) => {
                      const el = e.target as HTMLImageElement;
                      el.closest<HTMLElement>(".relative")!.style.display = "none";
                    }}
                  />
                </a>
                {/* "+N more" overlay on the last visible cell */}
                {showMore && (
                  <button
                    onClick={() => setExpanded(true)}
                    className="absolute inset-0 flex items-center justify-center bg-inverted/60 backdrop-blur-sm text-main font-semibold text-lg transition-colors hover:bg-inverted/70 cursor-pointer"
                  >
                    +{hiddenCount} more
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Videos always stacked solo — they have their own controls */}
      {videos.map((m) => (
        <video
          key={m.url}
          src={m.url}
          controls
          preload="metadata"
          className="max-h-[360px] w-full rounded-md border border-border bg-inverted/20"
        />
      ))}
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
            className="inline-flex max-w-[280px] items-center gap-1.5 truncate rounded-md border border-border bg-white/[0.02] px-2.5 py-1.5 text-xs text-muted transition-colors hover:bg-white/[0.04] hover:text-main"
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
      className="break-all text-primary hover:underline"
    >
      {children as ReactNode}
    </a>
  ),
  // Prevent giant headings from random markdown — cap at a reasonable style
  h1: ({ children }: Record<string, unknown>) => <span className="font-bold text-main">{children as ReactNode}</span>,
  h2: ({ children }: Record<string, unknown>) => <span className="font-bold text-main">{children as ReactNode}</span>,
  h3: ({ children }: Record<string, unknown>) => <span className="font-semibold text-main">{children as ReactNode}</span>,
  h4: ({ children }: Record<string, unknown>) => <span className="font-semibold text-main/90">{children as ReactNode}</span>,
  h5: ({ children }: Record<string, unknown>) => <span className="font-medium text-main/90">{children as ReactNode}</span>,
  h6: ({ children }: Record<string, unknown>) => <span className="font-medium text-main/80">{children as ReactNode}</span>,
  // Code blocks
  code: ({ children, className }: Record<string, unknown>) => {
    const isInline = !className;
    if (isInline) {
      return <code className="rounded bg-white/[0.06] px-1 py-0.5 font-mono text-[0.85em] text-primary break-all">{children as ReactNode}</code>;
    }
    return (
      <pre className="code-block my-1 max-w-full overflow-x-auto p-3">
        <code className={`text-xs font-mono whitespace-pre-wrap break-words ${className}`}>{children as ReactNode}</code>
      </pre>
    );
  },
  // Blockquote
  blockquote: ({ children }: Record<string, unknown>) => (
    <blockquote className="my-1 border-l-2 border-primary/35 pl-3 text-main/75">{children as ReactNode}</blockquote>
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
      className="my-1 max-h-[400px] rounded-md border border-border bg-inverted/20 object-contain"
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
    <div className="smart-content break-words text-[0.95rem] leading-7 text-main/90">
      {textForMd && <MarkdownBody text={textForMd} />}
      {!compact && <MediaEmbeds urls={urls} />}
      {!compact && <LinkChips urls={urls} />}
    </div>
  );
}
