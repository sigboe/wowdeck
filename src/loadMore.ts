import type { SearchResult } from "./types";

/** Results fetched per "Load more" press on the Latest and Popular pages. */
export const LOAD_MORE_PAGE_SIZE = 10;
/** Stop offering more after this many results (CurseForge caps broad totals at 10000). */
export const LOAD_MORE_MAX = 200;

const keyOf = (r: SearchResult) => `${r.providerId}:${r.externalId}`;

/** Append a page, dropping results already shown (lists can shift between requests). */
export function appendPage(shown: SearchResult[], page: SearchResult[]): SearchResult[] {
  const seen = new Set(shown.map(keyOf));
  return [...shown, ...page.filter((r) => !seen.has(keyOf(r)))];
}

/** Whether a "Load more" row should be offered. */
export function hasMore(
  shown: number,
  totalCount: number,
  lastPageSize: number,
  pageSize = LOAD_MORE_PAGE_SIZE,
  max = LOAD_MORE_MAX,
): boolean {
  return lastPageSize >= pageSize && shown < totalCount && shown < max;
}
