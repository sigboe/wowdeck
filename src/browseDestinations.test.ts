/// <reference types="bun-types" />
import { beforeEach, describe, expect, test } from "bun:test";
import {
  createBrowseRequests,
  latestDestination,
  popularDestination,
  resetDestinations,
  searchDestination,
  setCategory,
  setSource,
  setUrl,
  urlDestination,
} from "./browseDestinations";
import { sourcesStore } from "./sourcesStore";
import { connectEngine } from "./engineLink";
import {
  createFakeEngine,
  type Answer,
  type Answers,
  type FakeEngine,
} from "./testSupport/fakeEngine";
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

/** The requests over a fake engine answering with `answers`, and what was asked. */
function engineWith(answers: Answers) {
  const fake = createFakeEngine(answers);
  return { requests: createBrowseRequests({ rpc: fake.rpc }), calls: fake.calls };
}
/** Latest and Popular both answered with `answer`. */
const lists = (answer: Answer<"discover.latest"> & Answer<"discover.popular">) =>
  engineWith({ "discover.latest": answer, "discover.popular": answer });
const search = (answer: Answer<"addons.search">) => engineWith({ "addons.search": answer });
const lookup = (answer: Answer<"addons.resolveUrlImport">) =>
  engineWith({ "addons.resolveUrlImport": answer });

const page =
  (...ids: string[]) =>
  async () => ({ results: ids.map(result), totalCount: 20 });

/** The sources as Get Addons and Options last loaded them. */
let sources: FakeEngine;
const applySources = async (providers: ProviderInfo[]) => {
  sources.answers["providers.list"] = { providers };
  await sourcesStore.load();
};

beforeEach(() => {
  sources = createFakeEngine();
  connectEngine(sources);
  sourcesStore.reset();
  resetDestinations();
});

describe("the lists' requests", () => {
  test("Latest asks its source for the next page", async () => {
    latestDestination.patch({ sourceId: "WowUpHub", results: [result("1")], loaded: true });
    const { requests, calls } = lists(page("2"));
    await requests.loadMore("i1", "latest");
    expect(calls).toEqual([
      {
        method: "discover.latest",
        params: { installationId: "i1", providerId: "WowUpHub", index: 1, pageSize: 10 },
      },
    ]);
  });

  test("Popular in All categories names no category", async () => {
    popularDestination.patch({ sourceId: "Curse" });
    const { requests, calls } = lists(page("1"));
    await requests.loadMore("i1", "popular");
    expect(calls).toEqual([
      {
        method: "discover.popular",
        params: {
          installationId: "i1",
          providerId: "Curse",
          index: 0,
          pageSize: 10,
          categoryId: undefined,
        },
      },
    ]);
  });

  test("Popular in a category asks for that category", async () => {
    popularDestination.patch({ sourceId: "Curse" });
    setCategory("1019");
    const { requests, calls } = lists(page("1"));
    await requests.loadMore("i1", "popular");
    expect(calls[0].params).toMatchObject({ providerId: "Curse", categoryId: "1019" });
  });

  test("another source asks that source, without the old source's category", async () => {
    popularDestination.patch({ sourceId: "Curse", categoryId: "1019" });
    setSource("popular", "WowUpHub");
    const { requests, calls } = lists(page("1"));
    await requests.loadMore("i1", "popular");
    expect(calls[0].params).toEqual({
      installationId: "i1",
      providerId: "WowUpHub",
      index: 0,
      pageSize: 10,
      categoryId: undefined,
    });
  });

  test("before the sources have picked one, the source id is empty", async () => {
    const { requests, calls } = lists(page());
    await requests.loadMore("i1", "latest");
    await requests.loadMore("i1", "popular");
    expect(calls.map((c) => c.params)).toEqual([
      { installationId: "i1", providerId: "", index: 0, pageSize: 10 },
      { installationId: "i1", providerId: "", index: 0, pageSize: 10, categoryId: undefined },
    ]);
  });

  test("a list follows the sources' default pick", async () => {
    await applySources([provider("WowUpHub", { discovers: true })]);
    const { requests, calls } = lists(page("1"));
    await requests.loadMore("i1", "latest");
    expect(calls[0].params).toMatchObject({ providerId: "WowUpHub" });
  });
});

describe("lists", () => {
  test("a page appends, and a second press while loading asks nothing", async () => {
    const answer = pending<{ results: SearchResult[]; totalCount: number }>();
    const { requests, calls } = lists(() => answer.promise);
    const first = requests.loadMore("i1", "latest");
    void requests.loadMore("i1", "latest"); // e.g. the panel remounting mid-load
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
    const done = lists(() => answer.promise).requests.loadMore("i1", "latest");
    resetDestinations();
    answer.resolve({ results: [result("old")], totalCount: 1 });
    await done;
    expect(latestDestination.get()).toMatchObject({ results: [], loaded: false, loading: false });
  });

  test("a failure keeps what was shown and names the list's source", async () => {
    latestDestination.patch({ sourceId: "WowUpHub", results: [result("1")], loaded: true });
    await lists(() => Promise.reject(new Error("HTTP 500"))).requests.loadMore("i1", "latest");
    expect(latestDestination.get().results).toHaveLength(1);
    expect(latestDestination.get().error).toStartWith("Couldn't load addons. WowUp Hub");
  });

  test("a setup problem says what to fix, not that the source failed", async () => {
    // No WoW installation (DroidDeck, 2026-10-31): the engine's own words
    // name the fix; blaming CurseForge sent the player the wrong way.
    latestDestination.patch({ sourceId: "Curse" });
    const noInstallation = Object.assign(
      new Error("That WoW installation isn't available. Check Options"),
      { code: "not_found" },
    );
    await lists(() => Promise.reject(noInstallation)).requests.loadMore("i1", "latest");
    expect(latestDestination.get().error).toBe(
      "Couldn't load addons. That WoW installation isn't available. Check Options.",
    );
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
  test("no pick yet: each list opens on the default source", async () => {
    await applySources([hub(), curse()]);
    expect(latestDestination.get().sourceId).toBe("Curse");
    expect(popularDestination.get().sourceId).toBe("Curse");
  });

  test("a remembered pick is kept while its source still works", async () => {
    await applySources([curse(), hub()]);
    setSource("latest", "WowUpHub");
    latestDestination.patch({ results: [result("1")], loaded: true });
    await applySources([curse(), hub()]);
    expect(latestDestination.get().sourceId).toBe("WowUpHub");
    expect(latestDestination.get().results.map((r) => r.externalId)).toEqual(["1"]);
    expect(latestDestination.get().loaded).toBe(true);
  });

  test("a pick whose source went off falls back silently, the list starting over", async () => {
    await applySources([curse(), hub()]);
    setSource("latest", "WowUpHub");
    latestDestination.patch({ results: [result("1")], loaded: true });
    await applySources([curse(), hub({ enabled: false, available: false })]);
    expect(latestDestination.get()).toMatchObject({
      sourceId: "Curse",
      results: [],
      loaded: false,
      error: null,
    });
  });

  test("no source in use: the pick falls to the default, which the screen speaks for", async () => {
    await applySources([curse(), hub()]);
    setSource("latest", "WowUpHub");
    await applySources([
      curse({ enabled: false, available: false }),
      hub({ enabled: false, available: false }),
    ]);
    expect(latestDestination.get().sourceId).toBe("Curse");
  });

  test("a pick whose source is gone falls back silently, the list starting over", async () => {
    latestDestination.patch({ sourceId: "TukUI", results: [result("1")], loaded: true });
    await applySources([curse(), hub()]);
    expect(latestDestination.get()).toMatchObject({
      sourceId: "Curse",
      results: [],
      loaded: false,
      error: null,
    });
  });

  test("the fallback takes Popular's category back to All categories", async () => {
    popularDestination.patch({ sourceId: "Curse", categoryId: "1019" });
    await applySources([hub()]);
    expect(popularDestination.get()).toMatchObject({ sourceId: "WowUpHub", categoryId: null });
  });

  test("no source to fall back to: every pick is left alone", async () => {
    latestDestination.patch({ sourceId: "Curse", results: [result("1")], loaded: true });
    await applySources([]);
    expect(latestDestination.get().sourceId).toBe("Curse");
    expect(latestDestination.get().results.map((r) => r.externalId)).toEqual(["1"]);
    expect(latestDestination.get().loaded).toBe(true);
  });

  test("Latest and Popular keep independent picks", async () => {
    await applySources([curse(), hub()]);
    setSource("latest", "WowUpHub");
    popularDestination.patch({ sourceId: "TukUI" });
    await applySources([curse(), hub()]);
    expect(latestDestination.get().sourceId).toBe("WowUpHub");
    expect(popularDestination.get().sourceId).toBe("Curse");
  });

  test("another installation reopens each list on the default source", async () => {
    await applySources([curse(), hub()]);
    setSource("latest", "WowUpHub");
    resetDestinations();
    expect(latestDestination.get().sourceId).toBe("Curse");
    expect(popularDestination.get().sourceId).toBe("Curse");
  });
});

describe("search", () => {
  test("answers land in module state, whoever is showing them", async () => {
    searchDestination.patch({ query: " details " });
    const { requests, calls } = search(async () => ({
      results: [result("61284")],
      providerErrors: [],
    }));
    await requests.runSearch("i1");
    expect(calls).toEqual([
      { method: "addons.search", params: { installationId: "i1", query: "details" } },
    ]);
    expect(searchDestination.get()).toMatchObject({ searching: false, outcome: { kind: "none" } });
    expect(searchDestination.get().results).toHaveLength(1);
  });

  test("a setup problem says what to fix; a network one still names the cause", async () => {
    searchDestination.patch({ query: "dbm" });
    const refused = Object.assign(new Error("Pick an installation first"), {
      code: "invalid_request",
    });
    await search(() => Promise.reject(refused)).requests.runSearch("i1");
    expect(searchDestination.get().outcome).toEqual({
      kind: "error",
      text: "Couldn't search. Pick an installation first.",
    });
    await search(() => Promise.reject(new Error("TypeError: fetch failed"))).requests.runSearch(
      "i1",
    );
    expect(searchDestination.get().outcome.text).toContain("internet connection");
  });

  test("a blank query asks nothing", async () => {
    const { requests, calls } = search(async () => ({ results: [], providerErrors: [] }));
    await requests.runSearch("i1");
    expect(calls).toEqual([]);
  });
});

describe("From URL", () => {
  test("the looked-up result is kept (a modal round trip remounts the tab)", async () => {
    setUrl(" owner/repo ");
    const { requests, calls } = lookup(async () => ({ result: result("gh"), error: null }));
    await requests.resolveUrl("i1");
    expect(calls).toEqual([
      { method: "addons.resolveUrlImport", params: { installationId: "i1", url: "owner/repo" } },
    ]);
    expect(urlDestination.get()).toMatchObject({ url: " owner/repo ", resolving: false });
    expect(urlDestination.get().resolved?.externalId).toBe("gh");
  });

  test("an answer for an address that has since changed is dropped", async () => {
    setUrl("owner/old");
    const answer = pending<{ result: SearchResult | null; error: null }>();
    const done = lookup(() => answer.promise).requests.resolveUrl("i1");
    setUrl("owner/new");
    answer.resolve({ result: result("old"), error: null });
    await done;
    expect(urlDestination.get()).toMatchObject({
      url: "owner/new",
      resolved: null,
      resolving: false,
    });
  });

  test("an expected failure shows its sentence", async () => {
    setUrl("owner/repo");
    await lookup(async () => ({
      result: null,
      error: { code: "source_removed", message: "raw" },
    })).requests.resolveUrl("i1");
    expect(urlDestination.get().error).toBe("This addon is no longer available from its source.");
  });
});
