/**
 * The offered build's release notes as plain text. Per ADR-0004 the notes
 * are trusted CHANGELOG text (tools/release-notes.ts publishes them), so
 * the engine strips the Markdown and the update panel shows the result as
 * is, in a text node.
 */

/** Marks where markup was removed, so a line left holding only markup is dropped. */
const REMOVED = "\u0001";

const HEADING = /^\s{0,3}#{1,6}\s+/;
const LIST_ITEM = /^\s*(?:[*+-]|\d+[.)])\s+/;
/** Wrapped nested bullets keep their lines, as before joining existed. */
const NESTED_ITEM = /^\s+(?:[*+-]|\d+[.)])\s+/;
/** A thematic break or a setext heading's underline. */
const RULE = /^\s{0,3}(?:([-*_])(?:\s*\1){2,}|=+|-+)\s*$/;
const TABLE_ROW = /^\s*\|/;
const HARD_BREAK = /(?: {2}|\\)$/;

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
};

/**
 * A release body (Markdown) as plain text for a text node, never HTML:
 * heading marks, emphasis, code ticks, images, HTML tags and comments go;
 * links keep their text, autolinks their URL;
 * bullets read "•"; code fences keep their lines verbatim; a bullet's or
 * paragraph's wrapped lines join with one space, so the reader wraps them,
 * while bullets, headings, rules, table rows and hard breaks keep their
 * lines; runs of blank lines collapse to one. Text that only looks like
 * markup (`x < y`, `Vec<T>`, `2 * 3`, a URL's underscores) stays as
 * written. Null when nothing readable is left.
 */
export function releaseNotesText(markdown: string): string | null {
  const lines: string[] = [];
  let fenced = false;
  /** The last kept line is a bullet's or paragraph's text, so a continuation joins it. */
  let joinable = false;
  const source = markdown
    .replace(/\r\n?/g, "\n")
    .split(REMOVED)
    .join("")
    .replace(/<!--[\s\S]*?-->/g, REMOVED);
  for (const line of source.split("\n")) {
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      joinable = false;
      continue;
    }
    if (fenced) {
      lines.push(line.trimEnd());
      continue;
    }
    const text = plainLine(line);
    const kept = text.split(REMOVED).join("").trimEnd();
    if (kept === "" && text.includes(REMOVED)) {
      joinable = false;
      continue;
    }
    const ownLine = HEADING.test(line) || RULE.test(line) || TABLE_ROW.test(line);
    if (joinable && kept !== "" && !ownLine && !LIST_ITEM.test(line)) {
      lines[lines.length - 1] += ` ${kept.trimStart()}`;
      joinable = !HARD_BREAK.test(line);
      continue;
    }
    lines.push(kept);
    joinable = kept !== "" && !ownLine && !NESTED_ITEM.test(line) && !HARD_BREAK.test(line);
  }
  const text = lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/&amp;|&lt;|&gt;|&quot;|&#39;|&nbsp;/g, (m) => ENTITIES[m] ?? m)
    .trim();
  return text === "" ? null : text;
}

/**
 * One Markdown line outside a code fence as plain text. HTML tags count only
 * when tag-shaped: an opening tag not glued to a word (so `Vec<T>` stays),
 * a closing tag anywhere. Emphasis and code ticks are stripped outside URLs
 * only, and emphasis needs its marks against the text (so `2 * 3` stays).
 */
function plainLine(line: string): string {
  const text = line
    .replace(/<(https?:\/\/[^>\s]+)>/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, REMOVED)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(^|[^\w])<[A-Za-z][\w-]*(\s[^>]*)?\/?>/g, `$1${REMOVED}`)
    .replace(/<\/[A-Za-z][\w-]*\s*>/g, REMOVED)
    .replace(HEADING, "")
    .replace(/^(\s*)[*+-]\s+/, "$1• ");
  return text
    .split(/(https?:\/\/\S+)/)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part
            .replace(/(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g, "$2")
            .replace(/(^|[^\w*])([*_])(?=\S)([^*_]*?\S)\2(?=[^\w*]|$)/g, "$1$3")
            .replace(/`([^`]+)`/g, "$1"),
    )
    .join("");
}
