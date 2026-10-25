import { createStore, type Store } from "./store";
import { appendPage, LOAD_MORE_PAGE_SIZE } from "./loadMore";
import { friendlySearchError, searchOutcome } from "./search";
import { friendlyUrlImportError } from "./urlImportErrors";
import { errorText } from "./errors";
import { resetFileImport } from "./fileImportState";
import { defaultDiscoverSource, validDiscoverSources } from "./sourceAccess";
import type { ProviderCategory, ProviderInfo, SearchResult } from "./types";
import { providerDisplayName } from "../backend/src/api/providers";

/**
 * The Get Addons destinations' results and requests, kept in module scope so
 * they survive the panel's remounts (every modal and menu, guide G4) and
 * leaving the pane, the way Steam's Store remembers where you were. Each
 * destination owns its requests: only the latest one's answer is applied,
 * also when it lands after a remount, and a reset (another installation, see
 * resetBrowseSessionState) drops the answers still on the way, which belong
 * to the old one. The tabs (components/browseTabs.tsx) only render and call
 * the actions here.
 */
export interface Destination<S> extends Pick<Store<S>, "get" | "subscribe" | "patch"> {
  /** Back to the initial state; answers still on the way are dropped. */
  reset(): void;
  /** Drop the answers still on the way: what they answer has changed. */
  cancel(): void;
  /**
   * One request: `start` applies now; `done` or `failed` once it ends, unless
   * a newer request, a cancel or a reset came first.
   */
  request<T>(
    work: () => Promise<T>,
    start: Partial<S>,
    done: (value: T) => Partial<S>,
    failed: (err: unknown) => Partial<S>,
  ): Promise<void>;
}

export function createDestination<S extends object>(initial: () => S): Destination<S> {
  const store = createStore(initial());
  let current = 0;
  return {
    get: store.get,
    subscribe: store.subscribe,
    patch: store.patch,
    reset() {
      current++;
      store.set(initial());
    },
    cancel() {
      current++;
    },
    async request(work, start, done, failed) {
      const id = ++current;
      store.patch(start);
      let changes;
      try {
        changes = done(await work());
      } catch (err) {
        changes = failed(err);
      }
      if (id === current) {
        store.patch(changes);
      }
    },
  };
}

// ---- Search ----

export type SearchOutcome = ReturnType<typeof searchOutcome>;

export interface SearchView {
  query: string;
  /** Null until the first search: the box shows its helper text. */
  results: SearchResult[] | null;
  searching: boolean;
  outcome: SearchOutcome;
}

const SEARCH_TIMEOUT_MS = 20_000;

export const searchDestination = createDestination<SearchView>(() => ({
  query: "",
  results: null,
  searching: false,
  outcome: { kind: "none", text: "" },
}));

/** Search for the current query (ignored while one runs, or when it is blank). */
export function runSearch(
  search: (query: string) => Promise<{
    results: SearchResult[];
    providerErrors: Array<{ providerId: string; error: string }>;
  }>,
): Promise<void> {
  const { query, searching } = searchDestination.get();
  const trimmed = query.trim();
  if (!trimmed || searching) {
    return Promise.resolve();
  }
  return searchDestination.request(
    () => withTimeout(search(trimmed), SEARCH_TIMEOUT_MS, "search timed out"),
    { searching: true, outcome: { kind: "none", text: "" } },
    ({ results, providerErrors }) => ({
      searching: false,
      results,
      outcome: searchOutcome(trimmed, results.length, providerErrors),
    }),
    (e) => ({
      searching: false,
      outcome: { kind: "error", text: `Search ${friendlySearchError(String(e))}.` },
    }),
  );
}

// ---- Latest and Popular ----

/** A list that loads LOAD_MORE_PAGE_SIZE at a time, from one source. */
export interface ListView {
  /** The source picked in the Source menu; null until the sources have loaded. */
  sourceId: string | null;
  results: SearchResult[];
  totalCount: number;
  lastPageSize: number;
  /** A first page has come in. */
  loaded: boolean;
  loading: boolean;
  error: string | null;
}

export interface PopularView extends ListView {
  /** Null: All categories. */
  categoryId: string | null;
}

const emptyList = (): ListView => ({
  sourceId: null,
  results: [],
  totalCount: 0,
  lastPageSize: 0,
  loaded: false,
  loading: false,
  error: null,
});

export const latestDestination = createDestination<ListView>(emptyList);
export const popularDestination = createDestination<PopularView>(() => ({
  ...emptyList(),
  categoryId: null,
}));

/**
 * The addon sources as last loaded (applySources keeps this cache), so a
 * remount (every dropdown menu, G4) renders the Source menu and its list at
 * once instead of an empty pane that focus falls out of. Get Addons loads
 * them again on every mount.
 */
export const knownSources: { list: ProviderInfo[] | null } = { list: null };

/**
 * The sources' categories as last fetched (`addons.getCategories`), kept by
 * source id: reference data, kept across resets like knownSources. A source
 * that answered with none — unsupported (null) or an empty list — is kept as
 * `[]`: it is not category-capable, and Popular's Category segment stays
 * away from the browse bar.
 */
export const sourceCategories: { bySource: Record<string, ProviderCategory[]> } = { bySource: {} };

/** Fetch the next page (ignored while one is loading). */
export function loadMore(
  list: Destination<ListView>,
  load: (offset: number, count: number) => Promise<{ results: SearchResult[]; totalCount: number }>,
): Promise<void> {
  const { loading, results: shown } = list.get();
  if (loading) {
    return Promise.resolve();
  }
  return list.request(
    () => load(shown.length, LOAD_MORE_PAGE_SIZE),
    { loading: true, error: null },
    ({ results, totalCount }) => ({
      loading: false,
      loaded: true,
      results: appendPage(list.get().results, results),
      totalCount,
      lastPageSize: results.length,
    }),
    (e) => ({
      loading: false,
      error: `Couldn't load addons. ${providerDisplayName(list.get().sourceId ?? "")} ${friendlySearchError(String(e))}.`,
    }),
  );
}

/** Show another source: the list starts over (and its category, which was the old source's). */
export function setSource(list: Destination<ListView>, sourceId: string): void {
  if (sourceId === list.get().sourceId) {
    return;
  }
  list.reset();
  list.patch({ sourceId });
}

/** Show another category: the list starts over (null is All categories). */
export function setCategory(categoryId: string | null): void {
  const { categoryId: current, sourceId } = popularDestination.get();
  if (categoryId === current) {
    return;
  }
  popularDestination.reset();
  popularDestination.patch({ categoryId, sourceId });
}

/**
 * The sources as last loaded, applied to the lists. Each list keeps its own
 * remembered pick while that source still works, and a pick that no longer
 * does — turned off, not set up, gone — falls back silently to the default
 * discover source: the first one in use, else CurseForge, which the
 * zero-capability screen then speaks for. A fallback starts the list over, so
 * its category (the old source's) is back at "all". With no source to fall
 * back to the picks are left alone. Get Addons calls this on every sources
 * load and with the cached list on every mount, so a reset (another
 * installation) reopens on the default source.
 */
export function applySources(providers: ProviderInfo[]): void {
  knownSources.list = providers;
  const fallback = defaultDiscoverSource(providers);
  const ids = validDiscoverSources(providers).map((p) => p.id);
  for (const list of [latestDestination, popularDestination]) {
    const current = list.get().sourceId;
    if (fallback && (current === null || !ids.includes(current))) {
      setSource(list, fallback);
    }
  }
}

// ---- From URL ----

export interface UrlView {
  url: string;
  resolving: boolean;
  resolved: SearchResult | null;
  error: string | null;
}

export const urlDestination = createDestination<UrlView>(() => ({
  url: "",
  resolving: false,
  resolved: null,
  error: null,
}));

/** The address changed: what was looked up, or is being looked up, no longer applies. */
export function setUrl(url: string): void {
  urlDestination.cancel();
  urlDestination.patch({ url, resolving: false, resolved: null, error: null });
}

/** Look up the current address (ignored while a lookup runs, or when it is blank). */
export function resolveUrl(
  resolve: (
    url: string,
  ) => Promise<{ result: SearchResult | null; error: { code: string; message: string } | null }>,
): Promise<void> {
  const { url, resolving } = urlDestination.get();
  const trimmed = url.trim();
  if (!trimmed || resolving) {
    return Promise.resolve();
  }
  return urlDestination.request(
    () => resolve(trimmed),
    { resolving: true, resolved: null, error: null },
    ({ result, error }) =>
      error
        ? { resolving: false, error: friendlyUrlImportError(error) }
        : { resolving: false, resolved: result },
    (e) => ({ resolving: false, error: errorText(e) }),
  );
}

/** Another installation: every destination's results belonged to the old one. */
export function resetDestinations(): void {
  searchDestination.reset();
  latestDestination.reset();
  popularDestination.reset();
  urlDestination.reset();
  resetFileImport();
}

function withTimeout<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    work,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}
