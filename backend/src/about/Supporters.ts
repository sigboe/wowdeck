/**
 * SUPPORTERS.md → the Supporters (GLOSSARY) About credits. The file is
 * untrusted input fetched from `next` (ADR-0005), so the answer is plain
 * text only, sorted, and capped here so the frontend can trust it.
 */

export const SUPPORTERS_FILE = "SUPPORTERS.md";

/** The most names shown; the rest (alphabetically last) are dropped. */
export const MAX_SUPPORTERS = 200;
/** The longest name shown, in characters; a longer one ends in "…". */
export const MAX_NAME_LENGTH = 48;

const collator = new Intl.Collator("en", { sensitivity: "base" });

/**
 * One name per non-empty line. Headings and HTML comments are the file's own
 * notes. List markers, block quotes, links (their text stays), HTML tags and
 * Markdown punctuation are stripped; a name appears once.
 */
export function parseSupporters(markdown: string): string[] {
  const names = new Set<string>();
  // An unclosed comment hides the rest of the file, as Markdown would.
  const uncommented = markdown.replace(/<!--[\s\S]*?(?:-->|$)/g, "");
  for (const line of uncommented.split(/\r?\n/)) {
    if (/^\s*#/.test(line)) continue;
    const name = normalizeName(line);
    if (name) names.add(name);
  }
  return [...names]
    .sort((a, b) => collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0))
    .slice(0, MAX_SUPPORTERS);
}

function normalizeName(line: string): string {
  const plain = line
    // Control and bidi-override characters: never shown, never reorder text.
    .replace(/[‪-‮⁦-⁩]|(?!\s)\p{Cc}/gu, "")
    .replace(/^\s*(?:>\s*)+/, "")
    .replace(/^\s*(?:[-*+]|\d+[.)])(?:\s+|$)/, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]*>/g, "")
    .replace(/[*_`~#[\]<>|\\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const chars = [...plain];
  return chars.length > MAX_NAME_LENGTH
    ? `${chars
        .slice(0, MAX_NAME_LENGTH - 1)
        .join("")
        .trimEnd()}…`
    : plain;
}
