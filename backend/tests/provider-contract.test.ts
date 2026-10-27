/**
 * The provider contract: every registered provider, over its recorded
 * responses (fixtures/providers/<name>/cassette.json, recorded by
 * `make record-provider-fixtures`), declares exactly the capabilities its
 * scenario lists, and each one returns well-formed results. What a single
 * provider does with odd responses (fallbacks, rate limits, flavor picking)
 * stays in its own test file.
 */

import { describe, expect, test } from "bun:test";
import { AddonChannelType, type AddonProviderType } from "../src/wow/types";
import type { AddonSearchResult, ProviderCategory } from "../src/wow/models";
import type { DiscoverPage, GetAllResult } from "../src/wow/providers/addon-provider";
import { ProviderRegistry } from "../src/wow/providers/provider-registry";
import { type Cassette, loadCassette, ReplayNetwork } from "./providers/cassette";
import {
  type Capability,
  declaredCapabilities,
  DISCOVER_COUNT,
  exercise,
  type ProviderScenario,
  scenarios,
} from "./providers/scenarios";

const NO_RECORDINGS: Cassette = { recordedAt: "", interactions: [] };

async function setUp(scenario: ProviderScenario) {
  const network = new ReplayNetwork(scenario.fixture ? await loadCassette(scenario.fixture) : NO_RECORDINGS);
  return { network, provider: scenario.make(network, {}) };
}

function expectWellFormed(result: AddonSearchResult | undefined, providerName: AddonProviderType) {
  expect(result).toBeDefined();
  const r = result!;
  expect(r.providerName).toBe(providerName);
  expect(r.externalId).toBeString();
  expect(r.externalId).not.toBe("");
  expect(r.name).toBeString();
  expect(r.author).toBeString();
  expect(r.externalUrl).toBeString();
  expect(r.files?.length).toBeGreaterThan(0);
  for (const file of r.files!) {
    expect(file.version).toBeString();
    expect(file.downloadUrl).toBeString();
    expect(file.downloadUrl).not.toBe("");
    expect(Object.values(AddonChannelType)).toContain(file.channelType);
    expect(file.folders).toBeArray();
    if (file.releaseDate) {
      expect(Number.isNaN(Date.parse(file.releaseDate))).toBe(false);
    }
  }
}

function expectText(answer: unknown) {
  expect(answer).toBeString();
  expect(answer).not.toBe("");
}

const check: Record<Capability, (answer: unknown, s: ProviderScenario, providerName: AddonProviderType) => void> = {
  search: (answer, _s, name) => {
    const results = answer as AddonSearchResult[];
    expect(results.length).toBeGreaterThan(0);
    results.forEach((r) => expectWellFormed(r, name));
  },
  urlImport: (answer, s, name) => {
    expectWellFormed(answer as AddonSearchResult, name);
    expect((answer as AddonSearchResult).externalId).toBe(s.addonId);
  },
  getById: (answer, s, name) => {
    expectWellFormed(answer as AddonSearchResult, name);
    expect((answer as AddonSearchResult).externalId).toBe(s.addonId);
  },
  getAll: (answer, s, name) => {
    const { searchResults, errors } = answer as GetAllResult;
    expect(searchResults.map((r) => r.externalId)).toEqual([s.addonId]);
    searchResults.forEach((r) => expectWellFormed(r, name));
    expect(errors).toHaveLength(s.missingId ? 1 : 0);
  },
  discover: (answer, _s, name) => {
    for (const page of answer as DiscoverPage[]) {
      expect(page.results.length).toBeGreaterThan(0);
      expect(page.results.length).toBeLessThanOrEqual(DISCOVER_COUNT);
      expect(page.totalCount).toBeGreaterThanOrEqual(page.results.length);
      page.results.forEach((r) => expectWellFormed(r, name));
    }
  },
  description: expectText,
  changelog: expectText,
  categories: (answer) => {
    const categories = answer as ProviderCategory[];
    expect(categories.length).toBeGreaterThan(0);
    for (const c of categories) {
      expect(c.id).toBeString();
      expect(c.id).not.toBe("");
      expect(c.name).toBeString();
      expect(c.name).not.toBe("");
    }
  },
};

// Reads main.ts's source rather than importing it: importing would start the engine.
test("every registered provider has a scenario", async () => {
  const main = await Bun.file(`${import.meta.dir}/../src/main.ts`).text();
  const registered = [...main.matchAll(/registry\.register\(new (\w+)\(/g)].map((m) => m[1]);
  registered.push(...[...main.matchAll(/const \w+ = new (\w+Provider)\(/g)].map((m) => m[1]));
  const covered = await Promise.all(scenarios.map(async (s) => (await setUp(s)).provider.constructor.name));
  expect(covered.sort()).toEqual(registered.sort() as string[]);
});

for (const scenario of scenarios) {
  describe(`${scenario.fixture ?? "offline"} provider contract`, async () => {
    const { provider } = await setUp(scenario);

    test(`${provider.name} declares exactly its scenario's capabilities`, () => {
      expect(declaredCapabilities(provider)).toEqual(scenario.capabilities);
    });

    // Get Addons builds its browse bar and Search helper from these flags (ADR-0002).
    test(`${provider.name} advertises on the wire exactly what it implements`, () => {
      const registry = new ProviderRegistry();
      registry.register(provider);
      const info = registry.providerInfos()[0]!;
      expect(info.discovers).toBe(scenario.capabilities.includes("discover"));
      expect(info.catalogSearch).toBe(scenario.capabilities.includes("search"));
    });

    for (const capability of scenario.capabilities) {
      test(`${provider.name} ${capability} is well-formed`, async () => {
        const { network, provider: fresh } = await setUp(scenario);
        const answer = await exercise[capability](fresh, scenario);
        expect(network.misses).toEqual([]);
        check[capability](answer, scenario, fresh.name);
      });
    }
  });
}
