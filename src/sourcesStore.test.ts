/// <reference types="bun-types" />
import { beforeEach, describe, expect, test } from "bun:test";
import {
  loadCategories,
  loadSources,
  resetSourcesStore,
  setSourceEnabled,
  sourcesStore,
} from "./sourcesStore";
import type { Rpc } from "./services/envelope";
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

/** A fake engine: answers by method, and records what was asked. */
function fakeRpc(answers: Record<string, (params: unknown) => unknown>) {
  const calls: Array<{ method: string; params: unknown }> = [];
  const rpc = (async (method: string, params?: unknown) => {
    calls.push({ method, params });
    const answer = answers[method];
    if (!answer) {
      throw new Error(`unexpected ${method}`);
    }
    return answer(params);
  }) as Rpc;
  return { rpc, calls };
}

beforeEach(resetSourcesStore);

describe("the sources", () => {
  test("nothing loaded yet: no list, and the decision is not final", () => {
    expect(sourcesStore.get()).toMatchObject({ providers: null, loaded: false });
  });

  test("a load keeps the engine's list", async () => {
    const providers = [provider("Curse")];
    const { rpc, calls } = fakeRpc({ "providers.list": () => ({ providers }) });
    await loadSources(rpc);
    expect(calls).toEqual([{ method: "providers.list", params: undefined }]);
    expect(sourcesStore.get()).toMatchObject({ providers, loaded: true });
  });

  test("a failed load keeps the last list, and the decision is final", async () => {
    const providers = [provider("Curse")];
    await loadSources(fakeRpc({ "providers.list": () => ({ providers }) }).rpc);
    await loadSources(fakeRpc({}).rpc);
    expect(sourcesStore.get()).toMatchObject({ providers, loaded: true });
  });

  test("a first load that fails leaves no list (Options offers Try again)", async () => {
    await loadSources(fakeRpc({}).rpc);
    expect(sourcesStore.get()).toMatchObject({ providers: null, loaded: true });
  });

  test("turning a source off shows at once, then takes the engine's answer", async () => {
    await loadSources(
      fakeRpc({ "providers.list": () => ({ providers: [provider("Curse")] }) }).rpc,
    );
    let answer!: (v: unknown) => void;
    const { rpc, calls } = fakeRpc({
      "providers.setEnabled": () => new Promise((resolve) => (answer = resolve)),
    });
    const done = setSourceEnabled(rpc, "Curse", false);
    expect(sourcesStore.get().providers?.[0].enabled).toBe(false);
    answer({ providers: [provider("Curse", { enabled: false, available: false })] });
    await done;
    expect(calls).toEqual([
      { method: "providers.setEnabled", params: { providerId: "Curse", enabled: false } },
    ]);
    expect(sourcesStore.get().providers?.[0]).toMatchObject({ enabled: false, available: false });
  });

  test("a refused toggle reads the list again and rethrows", async () => {
    await loadSources(
      fakeRpc({ "providers.list": () => ({ providers: [provider("Curse")] }) }).rpc,
    );
    const { rpc } = fakeRpc({
      "providers.setEnabled": () => Promise.reject(new Error("nope")),
      "providers.list": () => ({ providers: [provider("Curse")] }),
    });
    await expect(setSourceEnabled(rpc, "Curse", false)).rejects.toThrow("nope");
    expect(sourcesStore.get().providers?.[0].enabled).toBe(true);
  });
});

describe("a source's categories", () => {
  test("asked once per source", async () => {
    const { rpc, calls } = fakeRpc({
      "addons.getCategories": () => ({ categories: [{ id: "1019", name: "Combat" }] }),
    });
    await loadCategories(rpc, "Curse");
    await loadCategories(rpc, "Curse");
    expect(calls).toEqual([{ method: "addons.getCategories", params: { providerId: "Curse" } }]);
    expect(sourcesStore.get().categories).toEqual({ Curse: [{ id: "1019", name: "Combat" }] });
  });

  test("a second ask while the first is on its way asks nothing", async () => {
    const { rpc, calls } = fakeRpc({ "addons.getCategories": () => ({ categories: [] }) });
    await Promise.all([loadCategories(rpc, "Curse"), loadCategories(rpc, "Curse")]);
    expect(calls).toHaveLength(1);
  });

  test("a source without categories is kept as none", async () => {
    await loadCategories(
      fakeRpc({ "addons.getCategories": () => ({ categories: null }) }).rpc,
      "WowUpHub",
    );
    expect(sourcesStore.get().categories).toEqual({ WowUpHub: [] });
  });

  test("a failed ask is not kept, so the next one asks again", async () => {
    await loadCategories(fakeRpc({}).rpc, "Curse");
    expect(sourcesStore.get().categories).toEqual({});
    const { rpc, calls } = fakeRpc({ "addons.getCategories": () => ({ categories: [] }) });
    await loadCategories(rpc, "Curse");
    expect(calls).toHaveLength(1);
  });
});
