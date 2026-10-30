import { Navigation } from "@decky/ui";
import { renderMarkdownToSafeHtml } from "../markdown";

/**
 * Markdown rendered with the shared sanitizing renderer (marked + DOMPurify,
 * src/markdown.ts). Its links are pointer-only (U-18): a click opens Steam's
 * browser through `onLink` (by default straight there), never the anchor.
 * `breaks`: see renderMarkdownToSafeHtml.
 */
export function SafeMarkdown({
  markdown,
  breaks,
  onLink = (url) => Navigation.NavigateToExternalWeb(url),
}: {
  markdown: string;
  breaks?: boolean;
  onLink?: (url: string) => void;
}) {
  return (
    <div
      className="wowdeck-markdown"
      onClick={(e) => {
        const anchor = (e.target as HTMLElement).closest("a");
        if (anchor?.href) {
          e.preventDefault();
          onLink(anchor.href);
        }
      }}
      dangerouslySetInnerHTML={{ __html: renderMarkdownToSafeHtml(markdown, { breaks }) }}
    />
  );
}
