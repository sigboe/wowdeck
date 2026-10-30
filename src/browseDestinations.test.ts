/// <reference types="bun-types" />
import { beforeEach, describe, expect, test } from "bun:test";
import {
  latestDestination,
  loadMore,
  popularDestination,
  resetDestinations,
  resolveUrl,
  runSearch,
  searchDestination,
  setCategory,
  setSource,
  setUrl,
  urlDestination,
} from "./browseDestinations";
import { resetSourcesStore, sourcesStore } from "./sourcesStore";
import type { Rpc } from "./services/envelope";
import type { ProviderInfo, SearchResult } from "./types";

const result = (externalId: string) => ({ providerId: "Curse", externalId }) as SearchResult;

/** A request the test answers by hand. */
function pending<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** A fake engine answering every call with `answer`, recording what was asked. */
function fakeRpc(answer: (method: string, params: unknown) => Promise<unknown>) {
  const calls: Array<{ method: string; params: unknown }> = [];
  const rpc = ((method: string, params?: unknown) => {
    calls.push({ method, params });
    return answer(method, params);
  }) as Rpc;
  return { rpc, calls };
}

const page =
  (...ids: string[]) =>
  async () => ({ results: ids.map(result), totalCount: 20 });

/** The sources as Get Addons and Options last loaded them. */
const applySources = (providers: ProviderInfo[]) => sourcesStore.patch({ providers });

beforeEach(() => {
  resetSourcesStore();
  resetDestinations();
});

describe("the lists' requests", () => {
  test("Latest asks its source for the next page", async () => {
    latestDestination.patch({ sourceId: "WowUpHub", results: [result("1")], loaded: true });
    const { rpc, calls } = fakeRpc(page("2"));
    await loadMore("latest", rpc);
    expect(calls).toEqual([
      { method: "discover.latest", params: { providerId: "WowUpHub", index: 1, pageSize: 10 } },
    ]);
  });

  test("Popular in All categories names no category", async () => {
    popularDestination.patch({ sourceId: "Curse" });
    const { rpc, calls } = fakeRpc(page("1"));
    await loadMore("popular", rpc);
    expect(calls).toEqual([
      {
        method: "discover.popular",
        params: { providerId: "Curse", index: 0, pageSize: 10, categoryId: undefined },
      },
    ]);
  });

  test("Popular in a category asks for that category", async () => {
    popularDestination.patch({ sourceId: "Curse" });
    setCategory("1019");
    const { rpc, calls } = fakeRpc(page("1"));
    await loadMore("popular", rpc);
    expect(calls[0].params).toMatchObject({ providerId: "Curse", categoryId: "1019" });
  });

  test("another source asks that source, without the old source's category", async () => {
    popularDestination.patch({ sourceId: "Curse", categoryId: "1019" });
    setSource("popular", "WowUpHub");
    const { rpc, calls } = fakeRpc(page("1"));
    await loadMore("popular", rpc);
    expect(calls[0].params).toEqual({
      providerId: "WowUpHub",
      index: 0,
      pageSize: 10,
      categoryId: undefined,
    });
  });

  test("before the sources have picked one, the source id is empty", async () => {
    const { rpc, calls } = fakeRpc(page());
    await loadMore("latest", rpc);
    await loadMore("popular", rpc);
    expect(calls.map((c) => c.params)).toEqual([
      { providerId: "", index: 0, pageSize: 10 },
      { providerId: "", index: 0, pageSize: 10, categoryId: undefined },
    ]);
  });

  test("a list follows the sources' default pick", async () => {
    applySources([provider("WowUpHub", { discovers: true })]);
    const { rpc, calls } = fakeRpc(page("1"));
    await loadMore("latest", rpc);
    expect(calls[0].params).toMatchObject({ providerId: "WowUpHub" });
  });
});

describe("lists", () => {
  test("a page appends, and a second press while loading asks nothing", async () => {
    const answer = pending<{ results: SearchResult[]; totalCount: number }>();
    const { rpc, calls } = fakeRpc(() => answer.promise);
    const first = loadMore("latest", rpc);
    void loadMore("latest", rpc); // e.g. the panel remounting mid-load
    expect(latestDestination.get().loading).toBe(true);
    answer.resolve({ results: [result("1"), result("2")], totalCount: 20 });
    await first;
    expect(calls).toHaveLength(1);
    expect(latestDestination.get()).toMatchObject({
      loading: false,
      loaded: true,
      totalCount: 20,
      lastPageSize: 2,
    });
    expect(latestDestination.get().results.map((r) => r.externalId)).toEqual(["1", "2"]);
  });

  test("a page for the previous installation is dropped after a reset", async () => {
    const answer = pending<{ results: SearchResult[]; totalCount: number }>();
    const done = loadMore("latest", fakeRpc(() => answer.promise).rpc);
    resetDestinations();
    answer.resolve({ results: [result("old")], totalCount: 1 });
    await done;
    expect(latestDestination.get()).toMatchObject({ results: [], loaded: false, loading: false });
  });

  test("a failure keeps what was shown and names the list's source", async () => {
    latestDestination.patch({ sourceId: "WowUpHub", results: [result("1")], loaded: true });
    await loadMore("latest", fakeRpc(() => Promise.reject(new Error("HTTP 500"))).rpc);
    expect(latestDestination.get().results).toHaveLength(1);
    expect(latestDestination.get().error).toStartWith("Couldn't load addons. WowUp Hub");
  });

  test("another category starts the list over, on the same source", () => {
    popularDestination.patch({ sourceId: "Curse", results: [result("1")], loaded: true });
    setCategory("1019");
    expect(popularDestination.get()).toMatchObject({
      sourceId: "Curse",
      categoryId: "1019",
      results: [],
      loaded: false,
    });
  });

  test("another source starts the list over, without the old source's category", () => {
    popularDestination.patch({ sourceId: "Curse", categoryId: "1019", results: [result("1")] });
    setSource("popular", "WowUpHub");
    expect(popularDestination.get()).toMatchObject({
      sourceId: "WowUpHub",
      categoryId: null,
      results: [],
    });
  });
});

// Fake sources for the pick rules (the sourceAccess tests' house style).
function provider(id: string, overrides: Partial<ProviderInfo> = {}): ProviderInfo {
  return {
    id,
    name: id,
    enabled: true,
    available: true,
    requiresApiKey: false,
    configured: true,
    allowEdit: true,
    catalogSearch: true,
    discovers: false,
    ...overrides,
  };
}

const curse = (o: Partial<ProviderInfo> = {}) => provider("Curse", { discovers: true, ...o });
const hub = (o: Partial<ProviderInfo> = {}) => provider("WowUpHub", { discovers: true, ...o });

describe("the lists' source picks", () => {
  test("no pick yet: each list opens on the default source", () => {
    applySources([hub(), curse()]);
    expect(latestDestination.get().sourceId).toBe("Curse");
    expect(popularDestination.get().sourceId).toBe("Curse");
  });

  test("a remembered pick is kept while its source still works", () => {
    applySources([curse(), hub()]);
    setSource("latest", "WowUpHub");
    latestDestination.patch({ results: [result("1")], loaded: true });
    applySources([curse(), hub()]);
    expect(latestDestination.get().sourceId).toBe("WowUpHub");
    expect(latestDestination.get().results.map((r) => r.externalId)).toEqual(["1"]);
    expect(latestDestination.get().loaded).toBe(true);
  });

  test("a pick whose source went off falls back silently, the list starting over", () => {
    applySources([curse(), hub()]);
    setSource("latest", "WowUpHub");
    latestDestination.patch({ results: [result("1")], loaded: true });
    applySources([curse(), hub({ enabled: false, available: false })]);
    expect(latestDestination.get()).toMatchObject({
      sourceId: "Curse",
      results: [],
      loaded: false,
      error: null,
    });
  });

  test("no source in use: the pick falls to the default, which the screen speaks for", () => {
    applySources([curse(), hub()]);
    setSource("latest", "WowUpHub");
    applySources([
      curse({ enabled: false, available: false }),
      hub({ enabled: false, available: false }),
    ]);
    expect(latestDestination.get().sourceId).toBe("Curse");
  });

  test("a pick whose source is gone falls back silently, the list starting over", () => {
    latestDestination.patch({ sourceId: "TukUI", results: [result("1")], loaded: true });
    applySources([curse(), hub()]);
    expect(latestDestination.get()).toMatchObject({
      sourceId: "Curse",
      results: [],
      loaded: false,
      error: null,
    });
  });

  test("the fallback takes Popular's category back to All categories", () => {
    popularDestination.patch({ sourceId: "Curse", categoryId: "1019" });
    applySources([hub()]);
    expect(popularDestination.get()).toMatchObject({ sourceId: "WowUpHub", categoryId: null });
  });

  test("no source to fall back to: every pick is left alone", () => {
    latestDestination.patch({ sourceId: "Curse", results: [result("1")], loaded: true });
    applySources([]);
    expect(latestDestination.get().sourceId).toBe("Curse");
    expect(latestDestination.get().results.map((r) => r.externalId)).toEqual(["1"]);
    expect(latestDestination.get().loaded).toBe(true);
  });

  test("Latest and Popular keep independent picks", () => {
    applySources([curse(), hub()]);
    setSource("latest", "WowUpHub");
    popularDestination.patch({ sourceId: "TukUI" });
    applySources([curse(), hub()]);
    expect(latestDestination.get().sourceId).toBe("WowUpHub");
    expect(popularDestination.get().sourceId).toBe("Curse");
  });

  test("another installation reopens each list on the default source", () => {
    applySources([curse(), hub()]);
    setSource("latest", "WowUpHub");
    resetDestinations();
    expect(latestDestination.get().sourceId).toBe("Curse");
    expect(popularDestination.get().sourceId).toBe("Curse");
  });
});

describe("search", () => {
  test("answers land in module state, whoever is showing them", async () => {
    searchDestination.patch({ query: " details " });
    const { rpc, calls } = fakeRpc(async () => ({
      results: [result("61284")],
      providerErrors: [],
    }));
    await runSearch(rpc);
    expect(calls).toEqual([{ method: "addons.search", params: { query: "details" } }]);
    expect(searchDestination.get()).toMatchObject({ searching: false, outcome: { kind: "none" } });
    expect(searchDestination.get().results).toHaveLength(1);
  });

  test("a blank query asks nothing", async () => {
    const { rpc, calls } = fakeRpc(async () => ({ results: [], providerErrors: [] }));
    await runSearch(rpc);
    expect(calls).toEqual([]);
  });
});

describe("From URL", () => {
  test("the looked-up result is kept (a modal round trip remounts the tab)", async () => {
    setUrl(" owner/repo ");
    const { rpc, calls } = fakeRpc(async () => ({ result: result("gh"), error: null }));
    await resolveUrl(rpc);
    expect(calls).toEqual([{ method: "addons.resolveUrlImport", params: { url: "owner/repo" } }]);
    expect(urlDestination.get()).toMatchObject({ url: " owner/repo ", resolving: false });
    expect(urlDestination.get().resolved?.externalId).toBe("gh");
  });

  test("an answer for an address that has since changed is dropped", async () => {
    setUrl("owner/old");
    const lookup = pending<{ result: SearchResult | null; error: null }>();
    const done = resolveUrl(fakeRpc(() => lookup.promise).rpc);
    setUrl("owner/new");
    lookup.resolve({ result: result("old"), error: null });
    await done;
    expect(urlDestination.get()).toMatchObject({
      url: "owner/new",
      resolved: null,
      resolving: false,
    });
  });

  test("an expected failure shows its sentence", async () => {
    setUrl("owner/repo");
    await resolveUrl(
      fakeRpc(async () => ({ result: null, error: { code: "source_removed", message: "raw" } }))
        .rpc,
    );
    expect(urlDestination.get().error).toBe("This addon is no longer available from its source.");
  });
});
