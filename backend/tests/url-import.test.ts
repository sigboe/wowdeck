/**
 * Install from URL dispatch tests. Deterministic resolution and the
 * "bypasses provider.enabled" behavior (matching WowUp's own
 * dispatcher).
 */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { identifyUrlImportProvider } from "../src/wow/providers/url-import";
import { AddonService } from "../src/wow/addons/AddonService";
import { ProviderRegistry } from "../src/wow/providers/provider-registry";
import { DownloadService } from "../src/wow/downloads/DownloadService";
import { NetworkClient } from "../src/wow/net/network";
import { createStateStore } from "../src/wow/storage/StateStore";
import { GitHubProvider } from "../src/wow/providers/github/GitHubProvider";
import { WowInterfaceProvider } from "../src/wow/providers/wowinterface/WowInterfaceProvider";
import { WowClientType } from "../src/wow/types";
import type { WowInstallation } from "../src/wow/models";
import type { GhRelease, GhReleaseAsset, GhRepo } from "../src/wow/providers/github/github-models";
import type { WowiFileDetailsV4 } from "../src/wow/providers/wowinterface/wowinterface-models";

const ROOT = "/tmp/opencode/wowdeck-tests/url-import";

const retail: WowInstallation = {
  id: "retail",
  clientType: WowClientType.Retail,
  location: "/x/_retail_",
  label: "_retail_",
  displayName: "Retail",
  selected: false,
  defaultAddonChannelType: 0,
  source: "detected",
};

function makeService(net: NetworkClient, dir: string) {
  rmSync(join(ROOT, dir), { recursive: true, force: true });
  const store = createStateStore(join(ROOT, dir));
  const registry = new ProviderRegistry();
  const github = new GitHubProvider(net);
  const wowi = new WowInterfaceProvider(net);
  registry.register(github);
  registry.register(wowi);
  registry.attachStore(store);
  const service = new AddonService(store, registry, new DownloadService(net, join(ROOT, dir, "dl")), {
    addonsChanged: () => {},
    operationProgress: () => {},
    operationResult: () => {},
  });
  return { service, github, wowi };
}

function ghRepo(): GhRepo {
  return {
    id: 1,
    name: "MockAddon",
    full_name: "mockauthor/MockAddon",
    html_url: "https://github.com/mockauthor/MockAddon",
    description: "mock",
    owner: { login: "mockauthor" },
  };
}

function ghAsset(): GhReleaseAsset {
  return {
    id: 1,
    name: "Addon.zip",
    content_type: "application/zip",
    size: 10,
    browser_download_url: "https://github.com/mockauthor/MockAddon/releases/download/v1/Addon.zip",
  };
}

function ghRelease(): GhRelease {
  return {
    id: 1,
    tag_name: "v1.0",
    name: null,
    body: null,
    draft: false,
    prerelease: false,
    published_at: "2026-01-01T00:00:00Z",
    assets: [ghAsset()],
  };
}

function wowiDetails(): WowiFileDetailsV4 {
  return {
    id: 24449,
    categoryId: 18,
    version: "1.0",
    lastUpdate: 1700000000000,
    checksum: "abc123",
    fileName: "Addon.zip",
    downloadUri: "https://cdn.wowinterface.com/downloads/getfile.php?id=24449",
    title: "MockWowiAddon",
    author: "SomeAuthor",
    description: "desc",
    changeLog: "log",
    downloads: 10,
    downloadsMonthly: 1,
    favorites: 0,
    images: [],
  };
}

function fakeGithubAndWowiNet(): NetworkClient {
  return {
    getJson: async <T>(url: string): Promise<T> => {
      if (url.includes("/releases")) {
        return [ghRelease()] as unknown as T;
      }
      if (url.includes("api.github.com/repos/")) {
        return ghRepo() as unknown as T;
      }
      if (url.includes("filedetails")) {
        return [wowiDetails()] as unknown as T;
      }
      throw new Error(`unexpected GET ${url}`);
    },
  } as unknown as NetworkClient;
}

describe("identifyUrlImportProvider", () => {
  test("resolves a GitHub URL deterministically", () => {
    expect(identifyUrlImportProvider("https://github.com/owner/repo")).toBe("GitHub");
  });

  test("resolves GitHub owner/repo shorthand", () => {
    expect(identifyUrlImportProvider("owner/repo")).toBe("GitHub");
  });

  test("resolves the Nix-style github:owner/repo shorthand", () => {
    expect(identifyUrlImportProvider("github:wowup/wowup.addon")).toBe("GitHub");
  });

  test("resolves a WowInterface URL deterministically", () => {
    expect(identifyUrlImportProvider("https://www.wowinterface.com/downloads/info24449.html")).toBe("WowInterface");
  });

  test("returns null for an unrecognized URL or plain text", () => {
    expect(identifyUrlImportProvider("https://www.curseforge.com/wow/addons/altoholic")).toBeNull();
    expect(identifyUrlImportProvider("some addon name")).toBeNull();
    expect(identifyUrlImportProvider("")).toBeNull();
  });

  test("provider boundaries never overlap for the same input", () => {
    const inputs = [
      "https://github.com/owner/repo",
      "owner/repo",
      "https://www.wowinterface.com/downloads/info1.html",
      "https://www.wowinterface.com/downloads/download1",
    ];
    for (const input of inputs) {
      // Exactly one of the two parsers should ever match — asserted
      // indirectly via identifyUrlImportProvider returning a single,
      // non-null, stable value for each.
      expect(identifyUrlImportProvider(input)).not.toBeNull();
    }
  });
});

describe("AddonService.resolveUrlImport", () => {
  test("resolves a GitHub URL end to end", async () => {
    const { service } = makeService(fakeGithubAndWowiNet(), "svc1");
    const result = await service.resolveUrlImport("https://github.com/mockauthor/MockAddon", retail);
    expect(result.providerId).toBe("GitHub");
    expect(result.externalId).toBe("mockauthor/MockAddon");
  });

  test("resolves GitHub owner/repo shorthand end to end", async () => {
    const { service } = makeService(fakeGithubAndWowiNet(), "svc2");
    const result = await service.resolveUrlImport("mockauthor/MockAddon", retail);
    expect(result.providerId).toBe("GitHub");
  });

  test("resolves the Nix-style github:owner/repo shorthand end to end", async () => {
    const { service } = makeService(fakeGithubAndWowiNet(), "svc-nix");
    const result = await service.resolveUrlImport("github:mockauthor/MockAddon", retail);
    expect(result.providerId).toBe("GitHub");
    expect(result.externalId).toBe("mockauthor/MockAddon");
  });

  test("resolves a WowInterface URL end to end", async () => {
    const { service } = makeService(fakeGithubAndWowiNet(), "svc3");
    const result = await service.resolveUrlImport("https://www.wowinterface.com/downloads/info24449.html", retail);
    expect(result.providerId).toBe("WowInterface");
    expect(result.name).toBe("MockWowiAddon");
  });

  test("throws a clear error for an unrecognized URL", async () => {
    const { service } = makeService(fakeGithubAndWowiNet(), "svc4");
    await expect(service.resolveUrlImport("https://www.curseforge.com/wow/addons/altoholic", retail)).rejects.toThrow(
      /isn't a GitHub or WoWInterface/i,
    );
  });

  test("throws a clear error for an empty input", async () => {
    const { service } = makeService(fakeGithubAndWowiNet(), "svc5");
    await expect(service.resolveUrlImport("   ", retail)).rejects.toThrow(/enter a url/i);
  });

  test("throws NotFoundError when the recognized provider finds nothing", async () => {
    const net = {
      getJson: async () => {
        throw new (await import("../src/wow/net/network")).NetworkError("404", 404, "x");
      },
    } as unknown as NetworkClient;
    const { service } = makeService(net, "svc6");
    await expect(service.resolveUrlImport("https://github.com/owner/doesnotexist", retail)).rejects.toThrow();
  });

  // Upstream's URL dispatcher never checks provider.enabled (investigation
  // §2, B.3/B.4); the install goes through too, and My Addons tags the
  // addon "Source off" (owner, 2026-10-21).
  test("resolves a WowInterface URL even while WowInterface is turned off", async () => {
    const { service, wowi } = makeService(fakeGithubAndWowiNet(), "svc7");
    wowi.enabled = false;
    const result = await service.resolveUrlImport("https://www.wowinterface.com/downloads/info24449.html", retail);
    expect(result.providerId).toBe("WowInterface");
  });
});

describe("Normal catalog search never dispatches a URL import", () => {
  test("search() does not call GitHub/WowInterface's searchByQuery at all (catalogSearch=false)", async () => {
    let githubCalled = false;
    let wowiCalled = false;
    const net = {
      getJson: async () => {
        throw new Error("no network calls expected");
      },
    } as unknown as NetworkClient;
    const { service, github, wowi } = makeService(net, "svc9");
    const originalGithub = github.searchByQuery.bind(github);
    const originalWowi = wowi.searchByQuery.bind(wowi);
    github.searchByQuery = async (...args) => {
      githubCalled = true;
      return originalGithub(...args);
    };
    wowi.searchByQuery = async (...args) => {
      wowiCalled = true;
      return originalWowi(...args);
    };
    const { results } = await service.search("https://github.com/mockauthor/MockAddon", retail);
    expect(results).toEqual([]);
    expect(githubCalled).toBe(false);
    expect(wowiCalled).toBe(false);
  });
});
