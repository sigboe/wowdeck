import { marked } from "marked";
import DOMPurify from "dompurify";

/**
 * Renders Markdown to sanitized HTML. GitHub READMEs/release notes and
 * WowInterface descriptions arrive as real Markdown, and showing the
 * raw `#`/`[text](url)` syntax as plain text would be unreadable.
 *
 * `marked` parses Markdown into HTML; by itself it passes raw inline
 * HTML straight through (a README can embed arbitrary HTML), so the
 * result is always run through DOMPurify before being handed to a
 * caller that will use it with `dangerouslySetInnerHTML` — this is
 * third-party content (an arbitrary GitHub repo's or WowInterface
 * addon's own text), not something this project authored, so it must
 * be treated as untrusted regardless of how unlikely a real attack
 * seems in this context.
 *
 * `marked.parse` can return a Promise if an async extension is
 * registered; none is here, so the cast to `string` is safe — asserted
 * via `as string`, not a runtime check, because this module never
 * registers one.
 */
export interface MarkdownLink {
  text: string;
  url: string;
}

/**
 * Every link in a Markdown document, for surfacing as a real,
 * controller-focusable list alongside the rendered text. Links inside
 * the rendered HTML aren't reachable by D-pad/stick navigation at all,
 * since Steam's gamepad focus system has no awareness of plain anchor
 * tags injected via `dangerouslySetInnerHTML`; making every such
 * anchor individually focusable would mean replacing the whole render
 * pipeline with a custom React-element renderer. Surfacing the same
 * destinations through real `ButtonItem`/`Focusable` elements — which
 * Steam's input system already knows how to navigate — is far less
 * invasive.
 *
 * Uses `marked`'s own token walker rather than a regex over the
 * rendered HTML — correctly finds links nested inside list items,
 * blockquotes, etc., the same structures `renderMarkdownToSafeHtml`
 * itself already understands.
 */
export function extractMarkdownLinks(markdown: string): MarkdownLink[] {
  const links: MarkdownLink[] = [];
  const seen = new Set<string>();
  // Restricted to http(s) — a mailto:/anchor link wouldn't be a useful
  // "open in browser" action, and this list's destinations go straight
  // to Navigation.NavigateToExternalWeb, not through DOMPurify's own
  // (separately enforced) URI allowlist.
  const add = (text: string, url: string) => {
    if (/^https?:\/\//i.test(url) && !seen.has(url)) {
      seen.add(url);
      links.push({ text: text.trim() || url, url });
    }
  };
  try {
    const tokens = marked.lexer(markdown);
    marked.walkTokens(tokens, (token) => {
      if (token.type === "link") {
        add(token.text, token.href);
      } else if (token.type === "html" || token.type === "text") {
        // CurseForge (and anything else that's already real HTML, not
        // Markdown) gets tokenized by marked as one opaque block — any
        // <a> tags inside are never decomposed into their own "link"
        // tokens the way Markdown link syntax is, so they'd otherwise be
        // invisible to this function entirely despite rendering as real,
        // mouse-clickable links. Walk the actual markup for those too.
        for (const { text, url } of extractAnchorsFromHtml(token.raw ?? "")) {
          add(text, url);
        }
      }
    });
  } catch {
    // malformed input just yields no links, never an error — this is a
    // presentation nicety, not something that should block rendering.
  }
  return links;
}

/**
 * `document` is always present at runtime (a real browser webview) and
 * in tests (jsdom registered globally, see markdown.test.ts) — guarded
 * anyway as a defensive no-op rather than a hard dependency. Building a
 * detached element and reading it back never executes embedded
 * scripts/handlers (never inserted into the live document, and
 * `innerHTML` assignment doesn't run `<script>` content per the HTML
 * spec either way) — safe for untrusted third-party markup.
 */
function extractAnchorsFromHtml(html: string): { text: string; url: string }[] {
  if (typeof document === "undefined" || !/<a[\s>]/i.test(html)) {
    return [];
  }
  const container = document.createElement("div");
  container.innerHTML = html;
  return Array.from(container.querySelectorAll("a")).map((a) => {
    const href = a.getAttribute("href") ?? "";
    return { text: a.textContent ?? href, url: href };
  });
}

const YOUTUBE_EMBED_RE =
  /^https:\/\/(?:www\.)?youtube(?:-nocookie)?\.com\/embed\/([A-Za-z0-9_-]{11})(?:[/?#].*)?$/i;

/**
 * The only iframe the sanitizer lets through: a YouTube video embed.
 * Every other iframe (any other host, a playlist, a `javascript:` or
 * protocol-relative src) is removed. The surviving element is rebuilt from
 * the 11-character video id alone, on the privacy-enhanced nocookie host,
 * so no attribute from the third-party markup (style, sandbox, srcdoc,
 * event handlers, query string) ever reaches the live document.
 */
export function canonicalYouTubeEmbedUrl(src: string | null | undefined): string | null {
  const match = YOUTUBE_EMBED_RE.exec((src ?? "").trim());
  const id = match?.[1];
  // "videoseries" is the playlist embed path and happens to be 11 characters.
  return id && id !== "videoseries" ? `https://www.youtube-nocookie.com/embed/${id}` : null;
}

if (DOMPurify.isSupported) {
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.nodeName !== "IFRAME") {
      return;
    }
    const element = node as Element;
    const canonical = canonicalYouTubeEmbedUrl(element.getAttribute("src"));
    if (!canonical) {
      element.parentNode?.removeChild(element);
      return;
    }
    for (const name of element.getAttributeNames()) {
      element.removeAttribute(name);
    }
    element.setAttribute("src", canonical);
    element.setAttribute("allow", "encrypted-media; picture-in-picture");
    element.setAttribute("allowfullscreen", "");
    element.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
  });
}

/**
 * `breaks`: a single newline is a line break. On for third-party text
 * (READMEs and WoWInterface descriptions often rely on it); off for
 * Markdown the project wrote with wrapped lines (the third-party notices).
 */
export function renderMarkdownToSafeHtml(
  markdown: string,
  { breaks = true }: { breaks?: boolean } = {},
): string {
  const html = marked.parse(markdown, { async: false, gfm: true, breaks }) as string;
  return DOMPurify.sanitize(html, {
    ADD_TAGS: ["iframe"],
    ADD_ATTR: ["allow", "allowfullscreen", "referrerpolicy"],
    // Images and links are the only "live" content a README/changelog
    // legitimately needs; scripts, forms, and event-handler attributes
    // are never allowed regardless of what DOMPurify's own defaults do.
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|#)/i,
  });
}
