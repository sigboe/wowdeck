/**
 * Every registered provider, what it declares it can do, and the requests
 * the contract suite (provider-contract.test.ts) makes of it. record.ts makes
 * the same requests against the real services to record the cassettes, so
 * the two never drift apart.
 */

import { realpathSync } from "node:fs";
import type { NetworkClient } from "../../src/wow/net/network";
import type { WowInstallation } from "../../src/wow/models";
import { WowClientType } from "../../src/wow/types";
import { AddonProvider, type DiscoverList } from "../../src/wow/providers/addon-provider";
import { CurseForgeProvider } from "../../src/wow/providers/curseforge/CurseForgeProvider";
import { FileProvider } from "../../src/wow/providers/file/FileProvider";
import { GitHubProvider } from "../../src/wow/providers/github/GitHubProvider";
import { TukUiAddonProvider } from "../../src/wow/providers/tukui/TukUiAddonProvider";
import { WowInterfaceProvider } from "../../src/wow/providers/wowinterface/WowInterfaceProvider";
import { WowUpHubProvider } from "../../src/wow/providers/wowup-hub/WowUpHubProvider";
import { ZipProvider } from "../../src/wow/providers/zip/ZipProvider";

export type Capability =
  | "search"
  | "urlImport"
  | "getById"
  | "getAll"
  | "discover"
  | "description"
  | "changelog"
  | "categories";

/** Credentials for recording only; replay never needs them, since cassettes keep no headers. */
export interface Credentials {
  curseForgeKey?: string;
  githubToken?: string;
}

export interface ProviderScenario {
  /** Directory under fixtures/providers/ holding the cassette; none for a provider that never asks the network. */
  fixture?: string;
  make(network: NetworkClient, credentials: Credentials): AddonProvider;
  capabilities: Capability[];
  /** The catalog search text, or the link for a URL import. */
  query?: string;
  addonId: string;
  /** An id the source does not have, for getAll's error. */
  missingId?: string;
}

export const installation: WowInstallation = {
  id: "retail",
  clientType: WowClientType.Retail,
  location: "/wow/_retail_",
  label: "_retail_",
  displayName: "Retail",
  selected: false,
  defaultAddonChannelType: 0,
  source: "detected",
};

const HUB_URL = "https://hub.wowup.io";
const ARCHIVE = realpathSync(`${import.meta.dir}/../fixtures/archives/addon.7z`);

export const scenarios: ProviderScenario[] = [
  {
    fixture: "curseforge",
    // A placeholder key on replay: the provider refuses to ask without one.
    make: (network, { curseForgeKey }) => new CurseForgeProvider(network, () => curseForgeKey ?? "replay"),
    capabilities: ["search", "getById", "getAll", "discover", "description", "changelog", "categories"],
    query: "details",
    addonId: "61284", // Details! Damage Meter
    missingId: "999999999",
  },
  {
    fixture: "github",
    make: (network, { githubToken }) => new GitHubProvider(network, () => githubToken),
    capabilities: ["urlImport", "getById", "getAll", "description", "changelog"],
    query: "https://github.com/BigWigsMods/BigWigs",
    addonId: "BigWigsMods/BigWigs",
    missingId: "BigWigsMods/no-such-addon-wowdeck-fixture",
  },
  {
    fixture: "wowinterface",
    make: (network) => new WowInterfaceProvider(network),
    capabilities: ["urlImport", "getById", "getAll", "description", "changelog"],
    query: "https://www.wowinterface.com/downloads/info24449-JWRepBar.html",
    addonId: "24449", // JWRepBar
    missingId: "999999999",
  },
  {
    fixture: "tukui",
    make: (network) => new TukUiAddonProvider(network),
    capabilities: ["search", "getById", "getAll"],
    query: "elvui",
    addonId: "-2", // ElvUI
    missingId: "999999999",
  },
  {
    fixture: "wowup-hub",
    make: (network) => new WowUpHubProvider(HUB_URL, HUB_URL, network),
    capabilities: ["search", "getById", "getAll", "discover"],
    query: "elvui",
    addonId: "2797823", // ElvUI_MerathilisUI
    missingId: "999999999",
  },
  {
    make: () => new ZipProvider(),
    capabilities: ["urlImport", "getById"],
    query: "https://example.org/files/SomeAddon-1.2.zip",
    addonId: "https://example.org/files/SomeAddon-1.2.zip",
  },
  {
    make: () => new FileProvider(),
    capabilities: ["getById"],
    addonId: ARCHIVE,
  },
];

export const DISCOVER_COUNT = 5;
export const DISCOVER_LISTS: DiscoverList[] = ["latest", "popular"];

/** The provider's own word on what it can do: its flags, and which optional methods it overrides. */
export function declaredCapabilities(provider: AddonProvider): Capability[] {
  const overrides = (method: keyof AddonProvider) => provider[method] !== AddonProvider.prototype[method];
  const all: Array<[Capability, boolean]> = [
    ["search", provider.catalogSearch && overrides("searchByQuery")],
    ["urlImport", !provider.catalogSearch && overrides("searchByQuery")],
    ["getById", overrides("getById")],
    ["getAll", provider.checksForUpdates && overrides("getAll")],
    ["discover", provider.discovers && overrides("getDiscoverPage")],
    ["description", overrides("getDescription")],
    ["changelog", overrides("getChangelog")],
    ["categories", overrides("getCategories")],
  ];
  return all.filter(([, has]) => has).map(([capability]) => capability);
}

/** What each capability asks of the provider; the suite checks the answers. */
export const exercise: Record<Capability, (provider: AddonProvider, scenario: ProviderScenario) => Promise<unknown>> = {
  search: (p, s) => p.searchByQuery(s.query!, installation),
  urlImport: (p, s) => p.searchByQuery(s.query!, installation),
  getById: (p, s) => p.getById(s.addonId, installation),
  getAll: (p, s) => p.getAll(installation, [s.addonId, ...(s.missingId ? [s.missingId] : [])]),
  discover: (p) => Promise.all(DISCOVER_LISTS.map((list) => p.getDiscoverPage(list, installation, 0, DISCOVER_COUNT))),
  description: (p, s) => p.getDescription(s.addonId),
  changelog: (p, s) => p.getChangelog(s.addonId, installation),
  categories: (p) => p.getCategories(installation),
};
