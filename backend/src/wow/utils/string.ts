/**
 * String helpers.
 *
 * similarity() is a re-implementation of the Dice bigram coefficient used
 * by the `string-similarity` package that WowUp's TukUI provider depends
 * on (compareTwoStrings). Semantics preserved; dependency dropped.
 */

export function compareTwoStrings(first: string, second: string): number {
  if (first === second) {
    return 1;
  }
  if (first.length < 2 || second.length < 2) {
    return 0;
  }

  const firstBigrams = new Map<string, number>();
  for (let i = 0; i < first.length - 1; i++) {
    const bigram = first.slice(i, i + 2);
    firstBigrams.set(bigram, (firstBigrams.get(bigram) ?? 0) + 1);
  }

  let intersectionSize = 0;
  for (let i = 0; i < second.length - 1; i++) {
    const bigram = second.slice(i, i + 2);
    const count = firstBigrams.get(bigram) ?? 0;
    if (count > 0) {
      firstBigrams.set(bigram, count - 1);
      intersectionSize++;
    }
  }

  return (2 * intersectionSize) / (first.length - 1 + second.length - 1);
}

/** Case-insensitive contains check. */
export function containsIgnoreCase(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

const HTML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
};

/**
 * Reduce a provider description (possibly containing HTML or markdown) to
 * a plain, single-line summary for search results. Strips tags, markdown
 * links/images, decodes common entities, collapses whitespace and clamps
 * the length.
 */
export function plainTextSummary(text: string | undefined, maxLength = 200): string | undefined {
  if (!text) {
    return undefined;
  }
  const stripped = text
    // markdown images then links: keep the link text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    // (a link around an image, a README badge, is left with no text)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    // markdown heading marks
    .replace(/^\s*#{1,6}\s+/gm, "")
    // html tags
    .replace(/<[^>]+>/g, " ")
    // urls left bare after stripping
    .replace(/https?:\/\/\S+/g, "")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(parseInt(code, 10)));
  const decoded = stripped.replace(/&amp;|&lt;|&gt;|&quot;|&#39;|&nbsp;/g, (m) => HTML_ENTITIES[m] ?? m);
  const collapsed = decoded.replace(/\s+/g, " ").trim();
  if (!collapsed) {
    return undefined;
  }
  return collapsed.length > maxLength ? `${collapsed.slice(0, maxLength - 1).trimEnd()}…` : collapsed;
}
