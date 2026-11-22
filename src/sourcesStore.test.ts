/// <reference types="bun-types" />
import { beforeEach, describe, expect, test } from "bun:test";
import { createSourcesStore, type SourcesStore } from "./sourcesStore";
import { createFakeEngine, engineFailure, type FakeEngine } from "./testSupport/fakeEngine";
import type { ProviderInfo } from "./types";

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
    discovers: true,
    ...overrides,
  };
}

let fake: FakeEngine;
let sources: SourcesStore;
beforeEach(() => {
  fake = createFakeEngine();
  sources = createSourcesStore({ rpc: fake.rpc });
});

describe("the sources", () => {
  test("nothing loaded yet: no list, and the decision is not final", () => {
    expect(sources.get()).toMatchObject({ providers: null, loaded: false });
  });

  test("a load keeps the engine's list", async () => {
    const providers = [provider("Curse")];
    fake.answers["providers.list"] = { providers };
    await sources.load();
    expect(fake.log).toEqual(["providers.list"]);
    expect(sources.get()).toMatchObject({ providers, loaded: true });
  });

  test("a failed load keeps the last list, and the decision is final", async () => {
    const providers = [provider("Curse")];
    fake.answers["providers.list"] = { providers };
    await sources.load();
    fake.answers["providers.list"] = engineFailure("not_ready");
    await sources.load();
    expect(sources.get()).toMatchObject({ providers, loaded: true });
  });

  test("a first load that fails leaves no list (Options offers Try again)", async () => {
    fake.answers["providers.list"] = engineFailure("not_ready");
    await sources.load();
    expect(sources.get()).toMatchObject({ providers: null, loaded: true });
  });

  test("turning a source off shows at once, then takes the engine's answer", async () => {
    fake.answers["providers.list"] = { providers: [provider("Curse")] };
    await sources.load();
    const done = sources.setEnabled("Curse", false);
    expect(sources.get().providers?.[0].enabled).toBe(false);
    const call = fake.next("providers.setEnabled");
    expect(call.params).toEqual({ providerId: "Curse", enabled: false });
    await call.resolve({ providers: [provider("Curse", { enabled: false, available: false })] });
    await done;
    expect(sources.get().providers?.[0]).toMatchObject({ enabled: false, available: false });
  });

  test("a refused toggle reads the list again and rethrows", async () => {
    fake.answers["providers.list"] = { providers: [provider("Curse")] };
    await sources.load();
    fake.answers["providers.setEnabled"] = engineFailure("refused", "nope");
    await expect(sources.setEnabled("Curse", false)).rejects.toThrow("nope");
    expect(sources.get().providers?.[0].enabled).toBe(true);
  });
});

describe("a source's categories", () => {
  test("asked once per source", async () => {
    fake.answers["addons.getCategories"] = { categories: [{ id: "1019", name: "Combat" }] };
    await sources.loadCategories("i1", "Curse");
    await sources.loadCategories("i1", "Curse");
    expect(fake.log).toEqual(['addons.getCategories {"installationId":"i1","providerId":"Curse"}']);
    expect(sources.get().categories).toEqual({ Curse: [{ id: "1019", name: "Combat" }] });
  });

  test("a second ask while the first is on its way asks nothing", async () => {
    fake.answers["addons.getCategories"] = { categories: [] };
    await Promise.all([
      sources.loadCategories("i1", "Curse"),
      sources.loadCategories("i1", "Curse"),
    ]);
    expect(fake.log).toHaveLength(1);
  });

  test("a source without categories is kept as none", async () => {
    fake.answers["addons.getCategories"] = { categories: null };
    await sources.loadCategories("i1", "WowUpHub");
    expect(sources.get().categories).toEqual({ WowUpHub: [] });
  });

  test("a failed ask is not kept, so the next one asks again", async () => {
    fake.answers["addons.getCategories"] = engineFailure("offline");
    await sources.loadCategories("i1", "Curse");
    expect(sources.get().categories).toEqual({});
    fake.answers["addons.getCategories"] = { categories: [] };
    await sources.loadCategories("i1", "Curse");
    expect(fake.log).toHaveLength(2);
  });
});
