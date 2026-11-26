/**
 * Get Addons search for an addon's exact CurseForge name, punctuation
 * included, through the catalogue the `addons.search` RPC calls.
 *
 * CurseForge's searchFilter answers nothing for some names as written:
 * "LibSharedMedia-3.0" finds no project, while "LibSharedMedia 3 0" (its
 * punctuation as spaces) finds project 14320 first (DEVICE 2026-11-25,
 * Classic Era). The cassette holds CurseForge's real answers, recorded
 * 2026-11-25 for Classic Era (gameVersionTypeId 67408), each list cut to
 * its first five entries.
 */

import { describe, expect, test } from "bun:test";
import { Catalogue } from "../src/wow/catalogue/Catalogue";
import { CurseForgeProvider } from "../src/wow/providers/curseforge/CurseForgeProvider";
import { ProviderRegistry } from "../src/wow/providers/provider-registry";
import type { WowInstallation } from "../src/wow/models";
import { WowClientType } from "../src/wow/types";
import { loadCassette, ReplayNetwork } from "./providers/cassette";

const era: WowInstallation = {
  id: "era",
  clientType: WowClientType.ClassicEra,
  location: "/wow/_classic_era_",
  label: "_classic_era_",
  displayName: "Classic Era",
  selected: true,
  defaultAddonChannelType: 0,
  source: "detected",
};

async function search(query: string) {
  const network = new ReplayNetwork(await loadCassette("curseforge-search-punctuation"));
  const provider = new CurseForgeProvider(network, () => "replay");
  provider.enabled = true;
  const registry = new ProviderRegistry();
  registry.register(provider);
  const answer = await new Catalogue(registry).search(query, era);
  expect(network.misses).toEqual([]);
  expect(answer.providerErrors).toEqual([]);
  return answer.results.map((r) => r.externalId);
}

describe("CurseForge search by an addon's exact name", () => {
  test("LibSharedMedia-3.0 finds project 14320", async () => {
    expect(await search("LibSharedMedia-3.0")).toContain("14320");
  });

  test("DBM-Core finds Deadly Boss Mods", async () => {
    expect(await search("DBM-Core")).toContain("3358");
  });

  test("Details! finds Details! Damage Meter", async () => {
    expect(await search("Details!")).toContain("61284");
  });

  test("a name without punctuation is asked as written, once", async () => {
    // Ace3 has no recorded second form: another request would be a cassette miss.
    expect(await search("Ace3")).toContain("13376");
  });
});
