/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { JSDOM } from "jsdom";

// DOMPurify needs a real `window`/`document` to bind to — present at
// runtime in the actual Decky webview, absent in Bun's bare test
// environment. jsdom specifically (not happy-dom — tried first, but
// DOMPurify silently no-ops against it: a <script> tag and a
// javascript: URL both passed straight through unsanitized, which is
// worse than not testing at all since it would hide a real regression)
// is DOMPurify's own documented, actually-supported test environment.
// Registered here, scoped to this one test file, rather than
// project-wide — no other module in this codebase needs a DOM.
const dom = new JSDOM("");
(globalThis as Record<string, unknown>).window = dom.window;
(globalThis as Record<string, unknown>).document = dom.window.document;

const { renderMarkdownToSafeHtml, extractMarkdownLinks, canonicalYouTubeEmbedUrl } =
  await import("./markdown");

describe("renderMarkdownToSafeHtml", () => {
  test("renders common Markdown constructs as HTML", () => {
    const html = renderMarkdownToSafeHtml(
      "# Title\n\nSome **bold** and _italic_ text.\n\n- one\n- two",
    );
    expect(html).toContain("<h1");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
    expect(html).toContain("<li>one</li>");
  });

  test("renders a link as a real anchor", () => {
    const html = renderMarkdownToSafeHtml("[WowUp](https://wowup.io/)");
    expect(html).toContain('href="https://wowup.io/"');
    expect(html).toContain(">WowUp</a>");
  });

  test("strips a raw <script> tag embedded in the source", () => {
    const html = renderMarkdownToSafeHtml("Hello <script>alert('xss')</script> world");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("alert(");
  });

  test("strips an inline event-handler attribute", () => {
    const html = renderMarkdownToSafeHtml('<img src="x.png" onerror="alert(1)">');
    expect(html).not.toContain("onerror");
  });

  test("strips a javascript: link", () => {
    const html = renderMarkdownToSafeHtml("[click me](javascript:alert(1))");
    expect(html.toLowerCase()).not.toContain("javascript:");
  });

  test("plain text with no Markdown syntax still renders as a readable paragraph", () => {
    const html = renderMarkdownToSafeHtml("Just a plain description, no markdown here.");
    expect(html).toContain("Just a plain description, no markdown here.");
  });

  test("empty input renders to empty output without throwing", () => {
    expect(renderMarkdownToSafeHtml("")).toBe("");
  });
});

describe("YouTube embeds", () => {
  const NOCOOKIE = "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ";

  test("keeps a youtube-nocookie embed", () => {
    const html = renderMarkdownToSafeHtml(`<iframe src="${NOCOOKIE}"></iframe>`);
    expect(html).toContain(`<iframe src="${NOCOOKIE}"`);
  });

  test("rewrites a youtube.com embed onto the nocookie host and drops the query string", () => {
    const html = renderMarkdownToSafeHtml(
      '<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0"></iframe>',
    );
    expect(html).toContain(`src="${NOCOOKIE}"`);
    expect(html).not.toContain("autoplay");
  });

  test("discards every other attribute on the embed", () => {
    const html = renderMarkdownToSafeHtml(
      `<iframe src="${NOCOOKIE}" style="position:fixed" srcdoc="<script>1</script>" onload="alert(1)" sandbox=""></iframe>`,
    );
    expect(html).not.toContain("style=");
    expect(html).not.toContain("srcdoc");
    expect(html).not.toContain("onload");
    expect(html).not.toContain("sandbox");
  });

  test("removes an iframe from any other host", () => {
    expect(
      renderMarkdownToSafeHtml('<iframe src="https://evil.example/embed/dQw4w9WgXcQ"></iframe>'),
    ).not.toContain("<iframe");
    expect(
      renderMarkdownToSafeHtml(
        '<iframe src="https://www.youtube.com.evil.example/embed/dQw4w9WgXcQ"></iframe>',
      ),
    ).not.toContain("<iframe");
  });

  test("removes an iframe with a non-https, protocol-relative, javascript or missing src", () => {
    for (const src of [
      "http://www.youtube.com/embed/dQw4w9WgXcQ",
      "//www.youtube.com/embed/dQw4w9WgXcQ",
      "javascript:alert(1)",
      "data:text/html,<script>1</script>",
    ]) {
      expect(renderMarkdownToSafeHtml(`<iframe src="${src}"></iframe>`)).not.toContain("<iframe");
    }
    expect(renderMarkdownToSafeHtml("<iframe></iframe>")).not.toContain("<iframe");
  });

  test("removes a YouTube iframe that is not a single video embed", () => {
    expect(
      renderMarkdownToSafeHtml(
        '<iframe src="https://www.youtube.com/embed/videoseries?list=PL123"></iframe>',
      ),
    ).not.toContain("<iframe");
    expect(
      renderMarkdownToSafeHtml('<iframe src="https://www.youtube.com/embed/short"></iframe>'),
    ).not.toContain("<iframe");
  });

  test("canonicalYouTubeEmbedUrl accepts only an 11-character video id", () => {
    expect(canonicalYouTubeEmbedUrl(`${NOCOOKIE}?start=5`)).toBe(NOCOOKIE);
    expect(canonicalYouTubeEmbedUrl("https://youtube.com/embed/dQw4w9WgXcQ")).toBe(NOCOOKIE);
    expect(canonicalYouTubeEmbedUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(canonicalYouTubeEmbedUrl(null)).toBeNull();
  });
});

describe("extractMarkdownLinks", () => {
  test("extracts a top-level link's text and url", () => {
    expect(extractMarkdownLinks("Check out [WowUp](https://wowup.io/) for more.")).toEqual([
      { text: "WowUp", url: "https://wowup.io/" },
    ]);
  });

  test("finds links nested inside a list item", () => {
    expect(
      extractMarkdownLinks("- See [the docs](https://example.com/docs)\n- Another item"),
    ).toEqual([{ text: "the docs", url: "https://example.com/docs" }]);
  });

  test("dedupes a url linked more than once, keeping the first occurrence's text", () => {
    const links = extractMarkdownLinks(
      "[first](https://example.com) and [second](https://example.com)",
    );
    expect(links).toEqual([{ text: "first", url: "https://example.com" }]);
  });

  test("excludes a mailto: link — not something 'open in browser' can act on", () => {
    expect(extractMarkdownLinks("[email me](mailto:a@example.com)")).toEqual([]);
  });

  test("excludes a javascript: link", () => {
    expect(extractMarkdownLinks("[click](javascript:alert(1))")).toEqual([]);
  });

  test("returns an empty array for text with no links", () => {
    expect(extractMarkdownLinks("Just plain text, no links here.")).toEqual([]);
  });

  test("returns an empty array for empty input", () => {
    expect(extractMarkdownLinks("")).toEqual([]);
  });

  // CurseForge descriptions are real HTML, not Markdown link syntax —
  // marked tokenizes a whole <p>...</p> as one opaque "html" block, so
  // this needs its own path (walking the raw markup), not just the
  // marked "link" token case covered above.
  test("finds a link embedded in a raw HTML block (e.g. a CurseForge description)", () => {
    expect(
      extractMarkdownLinks('<p>See <a href="https://example.com/docs">the docs</a> for more.</p>'),
    ).toEqual([{ text: "the docs", url: "https://example.com/docs" }]);
  });

  test("falls back to the href as display text for an image-only HTML link (e.g. a badge)", () => {
    const links = extractMarkdownLinks(
      '<p><a href="https://discord.gg/example"><img src="https://img.shields.io/badge.svg" alt="Discord"></a></p>',
    );
    expect(links).toEqual([
      { text: "https://discord.gg/example", url: "https://discord.gg/example" },
    ]);
  });

  test("dedupes a link appearing in both Markdown syntax and raw HTML", () => {
    const links = extractMarkdownLinks(
      '[first](https://example.com)\n\n<p>Also see <a href="https://example.com">here</a></p>',
    );
    expect(links).toHaveLength(1);
    expect(links[0]!.url).toBe("https://example.com");
  });
});
