/**
 * GitHub Releases provider tests (deterministic, network-free).
 * Fixture shapes follow the real GitHub REST API (repos/releases) and
 * the real "release.json" asset convention.
 */

import { describe, expect, test } from "bun:test";
import {
  GitHubProvider,
  parseGitHubRepoQuery,
  pickAssetForRelease,
} from "../src/wow/providers/github/GitHubProvider";
import type { GhRelease, GhReleaseAsset, GhReleaseJson, GhRepo } from "../src/wow/providers/github/github-models";
import { NetworkClient, NetworkError } from "../src/wow/net/network";
import { WowClientType } from "../src/wow/types";
import type { WowInstallation } from "../src/wow/models";
import { ProviderError } from "../src/wow/errors";

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
const mists: WowInstallation = { ...retail, id: "mists", clientType: WowClientType.Classic };

function ghAsset(over: Partial<GhReleaseAsset> & Pick<GhReleaseAsset, "id" | "name">): GhReleaseAsset {
  return {
    content_type: "application/zip",
    size: 1000,
    browser_download_url: `https://github.com/mock/mock/releases/download/v1/${over.name}`,
    ...over,
  };
}

function ghRelease(over: Partial<GhRelease> & Pick<GhRelease, "id">): GhRelease {
  return {
    tag_name: `v${over.id}`,
    name: null,
    body: null,
    draft: false,
    prerelease: false,
    published_at: "2026-01-01T00:00:00Z",
    assets: [],
    ...over,
  };
}

function ghRepo(over: Partial<GhRepo> = {}): GhRepo {
  return {
    id: 1,
    name: "MockAddon",
    full_name: "mockauthor/MockAddon",
    html_url: "https://github.com/mockauthor/MockAddon",
    description: "a mock addon",
    owner: { login: "mockauthor", avatar_url: "https://avatars.example/mockauthor.png" },
    ...over,
  };
}

interface FakeResponses {
  repo?: GhRepo | null;
  repoStatus?: number;
  repoHeaders?: Record<string, string>;
  releases?: GhRelease[];
  releasesStatus?: number;
  /** keyed by browser_download_url */
  textByUrl?: Record<string, string>;
}

function fakeNet(responses: FakeResponses): { net: NetworkClient; gets: string[] } {
  const gets: string[] = [];
  const net = {
    getJson: async <T>(url: string): Promise<T> => {
      gets.push(url);
      if (url.includes("/releases")) {
        if (responses.releasesStatus) {
          throw new NetworkError(`GET ${url} failed: HTTP ${responses.releasesStatus}`, responses.releasesStatus, url);
        }
        return (responses.releases ?? []) as unknown as T;
      }
      if (url.startsWith("https://api.github.com/repos/")) {
        if (responses.repoStatus) {
          throw new NetworkError(`GET ${url} failed: HTTP ${responses.repoStatus}`, responses.repoStatus, url, responses.repoHeaders);
        }
        if (responses.repo === null) {
          throw new NetworkError(`GET ${url} failed: HTTP 404`, 404, url);
        }
        return (responses.repo ?? ghRepo()) as unknown as T;
      }
      throw new Error(`unexpected GET ${url}`);
    },
    getText: async (url: string): Promise<string> => {
      gets.push(url);
      const text = responses.textByUrl?.[url];
      if (text === undefined) {
        throw new Error(`unexpected getText ${url}`);
      }
      return text;
    },
  } as unknown as NetworkClient;
  return { net, gets };
}

describe("parseGitHubRepoQuery", () => {
  test("accepts a plain https://github.com/owner/repo URL", () => {
    expect(parseGitHubRepoQuery("https://github.com/Stanzilla/WeakAuras2")).toEqual({
      owner: "Stanzilla",
      repo: "WeakAuras2",
    });
  });

  test("accepts a bare owner/repo shorthand", () => {
    expect(parseGitHubRepoQuery("Stanzilla/WeakAuras2")).toEqual({ owner: "Stanzilla", repo: "WeakAuras2" });
  });

  test("strips a trailing .git and extra path segments (e.g. a releases page link)", () => {
    expect(parseGitHubRepoQuery("https://github.com/owner/repo.git")).toEqual({ owner: "owner", repo: "repo" });
    expect(parseGitHubRepoQuery("https://github.com/owner/repo/releases/tag/v1.0")).toEqual({
      owner: "owner",
      repo: "repo",
    });
  });

  // Investigation finding #1: upstream's `host.endsWith("com")` check would
  // wrongly accept "notgithub.com" or "evilgithub.com". This must not.
  test("rejects a host that merely ends in .com, unlike upstream's loose check", () => {
    expect(parseGitHubRepoQuery("https://notgithub.com/owner/repo")).toBeNull();
    expect(parseGitHubRepoQuery("https://evil-github.com/owner/repo")).toBeNull();
  });

  test("rejects a github.com URL with fewer than two path segments", () => {
    expect(parseGitHubRepoQuery("https://github.com/owner")).toBeNull();
    expect(parseGitHubRepoQuery("https://github.com/")).toBeNull();
  });

  test("rejects plain text that isn't a URL or owner/repo shorthand (ordinary search query)", () => {
    expect(parseGitHubRepoQuery("questie")).toBeNull();
    expect(parseGitHubRepoQuery("weak auras")).toBeNull();
  });

  // Most people don't type https:// when pasting a URL they copied
  // from their browser's address bar or the site itself.
  test("accepts github.com/owner/repo with no scheme at all", () => {
    expect(parseGitHubRepoQuery("github.com/owner/repo")).toEqual({ owner: "owner", repo: "repo" });
  });

  test("still rejects a schemeless non-github host", () => {
    expect(parseGitHubRepoQuery("notgithub.com/owner/repo")).toBeNull();
  });

  // Nix flake-ref shorthand, grammar from Nix's src/nix/flake.md:
  // github:<owner>/<repo>(/<rev-or-ref>)?(\?<params>)?. The rev-or-ref
  // and params name a branch/tag/commit an addon installer can't pin
  // (addons come from releases), so — like a pasted releases-page URL
  // above — they identify the repository and nothing more.
  test("accepts the Nix-style github:owner/repo shorthand", () => {
    expect(parseGitHubRepoQuery("github:wowup/wowup.addon")).toEqual({
      owner: "wowup",
      repo: "wowup.addon",
    });
  });

  test("accepts the github: shorthand with any scheme casing and a trailing .git", () => {
    expect(parseGitHubRepoQuery("GitHub:owner/repo")).toEqual({ owner: "owner", repo: "repo" });
    expect(parseGitHubRepoQuery("github:owner/repo.git")).toEqual({ owner: "owner", repo: "repo" });
  });

  test("accepts the github: shorthand's optional rev-or-ref segment and params, resolving just owner/repo", () => {
    expect(parseGitHubRepoQuery("github:owner/repo/unstable")).toEqual({ owner: "owner", repo: "repo" });
    expect(parseGitHubRepoQuery("github:owner/repo/d3f2baba8f425779026c6ec04021b2e927f61e31")).toEqual({
      owner: "owner",
      repo: "repo",
    });
    expect(parseGitHubRepoQuery("github:owner/repo?ref=branch")).toEqual({ owner: "owner", repo: "repo" });
  });

  test("rejects the github: shorthand with fewer than two segments", () => {
    expect(parseGitHubRepoQuery("github:owner")).toBeNull();
    expect(parseGitHubRepoQuery("github:owner/")).toBeNull();
    expect(parseGitHubRepoQuery("github:")).toBeNull();
  });

  // Only github: is the shorthand — another forger's scheme must never
  // resolve here (gitlab:owner/repo looks the same shape). The git+https
  // form is the one exception that predates the shorthand: it carries a
  // real github.com authority, so the strict host check accepts it as
  // the same repository.
  test("rejects every other scheme's owner/repo form", () => {
    expect(parseGitHubRepoQuery("gitlab:owner/repo")).toBeNull();
    expect(parseGitHubRepoQuery("gist:owner/abc123")).toBeNull();
    expect(parseGitHubRepoQuery("git+https://github.com/owner/repo")).toEqual({
      owner: "owner",
      repo: "repo",
    });
    expect(parseGitHubRepoQuery("git+https://notgithub.com/owner/repo")).toBeNull();
  });
});

describe("pickAssetForRelease flavor mapping", () => {
  test("release.json: mainline flavor maps to Retail/RetailPtr/Beta/RetailXPtr", () => {
    const asset = ghAsset({ id: 1, name: "Addon-Mainline.zip" });
    const release = ghRelease({ id: 1, assets: [asset] });
    const releaseJson: GhReleaseJson = {
      releases: [{ filename: "Addon-Mainline.zip", metadata: [{ flavor: "mainline", interface: 110000 }] }],
    };
    for (const ct of [WowClientType.Retail, WowClientType.RetailPtr, WowClientType.Beta, WowClientType.RetailXPtr]) {
      expect(pickAssetForRelease(release, releaseJson, ct)?.name).toBe("Addon-Mainline.zip");
    }
  });

  test("release.json: classic flavor maps only to ClassicEra/ClassicEraPtr", () => {
    const asset = ghAsset({ id: 1, name: "Addon-Classic.zip" });
    const release = ghRelease({ id: 1, assets: [asset] });
    const releaseJson: GhReleaseJson = {
      releases: [{ filename: "Addon-Classic.zip", metadata: [{ flavor: "classic", interface: 11503 }] }],
    };
    expect(pickAssetForRelease(release, releaseJson, WowClientType.ClassicEra)?.name).toBe("Addon-Classic.zip");
    expect(pickAssetForRelease(release, releaseJson, WowClientType.ClassicEraPtr)?.name).toBe("Addon-Classic.zip");
    expect(pickAssetForRelease(release, releaseJson, WowClientType.Retail)).toBeUndefined();
  });

  // Confirmed against a real release (AdiAddons/AdiBags v1.10.29): one
  // release.json entry's `metadata` commonly lists several flavors for
  // a single universal zip, not one entry per flavor.
  test("release.json: one entry with multiple flavors in metadata matches any of them to the same asset", () => {
    const asset = ghAsset({ id: 1, name: "AdiBags-v1.10.29.zip" });
    const release = ghRelease({ id: 1, assets: [asset] });
    const releaseJson: GhReleaseJson = {
      releases: [
        {
          filename: "AdiBags-v1.10.29.zip",
          nolib: false,
          metadata: [
            { flavor: "mainline", interface: 110002 },
            { flavor: "wrath", interface: 30403 },
            { flavor: "classic", interface: 11503 },
            { flavor: "bcc", interface: 20504 },
          ],
        },
      ],
    };
    expect(pickAssetForRelease(release, releaseJson, WowClientType.Retail)?.name).toBe("AdiBags-v1.10.29.zip");
    expect(pickAssetForRelease(release, releaseJson, WowClientType.ClassicEra)?.name).toBe("AdiBags-v1.10.29.zip");
    expect(pickAssetForRelease(release, releaseJson, WowClientType.Anniversary)?.name).toBe("AdiBags-v1.10.29.zip");
  });

  test("release.json: bcc flavor maps to Anniversary", () => {
    const asset = ghAsset({ id: 1, name: "Addon-BCC.zip" });
    const release = ghRelease({ id: 1, assets: [asset] });
    const releaseJson: GhReleaseJson = {
      releases: [{ filename: "Addon-BCC.zip", metadata: [{ flavor: "bcc", interface: 20504 }] }],
    };
    expect(pickAssetForRelease(release, releaseJson, WowClientType.Anniversary)?.name).toBe("Addon-BCC.zip");
  });

  test("release.json: mists flavor maps to Classic/ClassicPtr but NOT ClassicBeta (diverges from upstream)", () => {
    const asset = ghAsset({ id: 1, name: "Addon-Mists.zip" });
    const release = ghRelease({ id: 1, assets: [asset] });
    const releaseJson: GhReleaseJson = {
      releases: [{ filename: "Addon-Mists.zip", metadata: [{ flavor: "mists", interface: 50400 }] }],
    };
    expect(pickAssetForRelease(release, releaseJson, WowClientType.Classic)?.name).toBe("Addon-Mists.zip");
    expect(pickAssetForRelease(release, releaseJson, WowClientType.ClassicPtr)?.name).toBe("Addon-Mists.zip");
    expect(pickAssetForRelease(release, releaseJson, WowClientType.ClassicBeta)).toBeUndefined();
  });

  test("release.json: wrath/cata flavors map to nothing currently installable (honest, not invented)", () => {
    const wrathAsset = ghAsset({ id: 1, name: "Addon-Wrath.zip" });
    const wrathRelease = ghRelease({ id: 1, assets: [wrathAsset] });
    const wrathJson: GhReleaseJson = {
      releases: [{ filename: "Addon-Wrath.zip", metadata: [{ flavor: "wrath", interface: 30403 }] }],
    };
    for (const ct of Object.values(WowClientType).filter((v): v is WowClientType => typeof v === "number")) {
      expect(pickAssetForRelease(wrathRelease, wrathJson, ct)).toBeUndefined();
    }
  });

  test("release.json: nolib entries are skipped even when flavor matches", () => {
    const asset = ghAsset({ id: 1, name: "Addon-Mainline-nolib.zip" });
    const release = ghRelease({ id: 1, assets: [asset] });
    const releaseJson: GhReleaseJson = {
      releases: [{ filename: "Addon-Mainline-nolib.zip", nolib: true, metadata: [{ flavor: "mainline", interface: 110000 }] }],
    };
    expect(pickAssetForRelease(release, releaseJson, WowClientType.Retail)).toBeUndefined();
  });

  test("release.json present but no matching entry: does NOT fall back to filename heuristics on the same release", () => {
    const mainlineAsset = ghAsset({ id: 1, name: "Addon.zip" }); // no classic suffix -> would match mainline by filename
    const release = ghRelease({ id: 1, assets: [mainlineAsset] });
    const releaseJson: GhReleaseJson = {
      releases: [{ filename: "SomeOtherFile.zip", metadata: [{ flavor: "mainline", interface: 110000 }] }],
    };
    expect(pickAssetForRelease(release, releaseJson, WowClientType.Retail)).toBeUndefined();
  });

  test("filename heuristic (no release.json): classic-suffixed files map correctly", () => {
    const assets = [
      ghAsset({ id: 1, name: "Addon-Classic.zip" }),
      ghAsset({ id: 2, name: "Addon-BCC.zip" }),
      ghAsset({ id: 3, name: "Addon-Mists.zip" }),
      ghAsset({ id: 4, name: "Addon.zip" }), // no suffix -> mainline candidate
    ];
    const release = ghRelease({ id: 1, assets });
    expect(pickAssetForRelease(release, undefined, WowClientType.ClassicEra)?.name).toBe("Addon-Classic.zip");
    expect(pickAssetForRelease(release, undefined, WowClientType.Anniversary)?.name).toBe("Addon-BCC.zip");
    expect(pickAssetForRelease(release, undefined, WowClientType.Classic)?.name).toBe("Addon-Mists.zip");
    expect(pickAssetForRelease(release, undefined, WowClientType.Retail)?.name).toBe("Addon.zip");
  });

  // Investigation finding #6: upstream's mainline/retail filename fallback
  // never excludes a `_mists.zip`-suffixed file. Fixed here: the mainline
  // candidate set only ever contains files matching NO known classic suffix.
  test("filename heuristic: mainline never picks a classic-suffixed file (fixes upstream's gap)", () => {
    const assets = [ghAsset({ id: 1, name: "Addon_mists.zip" }), ghAsset({ id: 2, name: "Addon_classic.zip" })];
    const release = ghRelease({ id: 1, assets });
    expect(pickAssetForRelease(release, undefined, WowClientType.Retail)).toBeUndefined();
  });

  test("filename heuristic: nolib filenames are excluded even for an otherwise-matching flavor", () => {
    const assets = [ghAsset({ id: 1, name: "Addon-nolib.zip" })];
    const release = ghRelease({ id: 1, assets });
    expect(pickAssetForRelease(release, undefined, WowClientType.Retail)).toBeUndefined();
  });

  test("non-zip assets (e.g. a changelog .txt) are never selected", () => {
    const assets = [ghAsset({ id: 1, name: "CHANGELOG.txt" }), ghAsset({ id: 2, name: "Addon.zip" })];
    const release = ghRelease({ id: 1, assets });
    expect(pickAssetForRelease(release, undefined, WowClientType.Retail)?.name).toBe("Addon.zip");
  });
});

describe("GitHubProvider.getById", () => {
  test("selects the newest stable release over a newer prerelease", async () => {
    const stable = ghRelease({ id: 1, tag_name: "v1.0", published_at: "2026-01-01T00:00:00Z", assets: [ghAsset({ id: 1, name: "Addon.zip" })] });
    const newerPrerelease = ghRelease({ id: 2, tag_name: "v1.1-beta", prerelease: true, published_at: "2026-02-01T00:00:00Z", assets: [ghAsset({ id: 2, name: "Addon.zip" })] });
    const { net } = fakeNet({ releases: [newerPrerelease, stable] });
    const provider = new GitHubProvider(net);
    const result = await provider.getById("mockauthor/MockAddon", retail);
    expect(result!.files![0]!.version).toBe("v1.0");
  });

  test("falls back to the newest prerelease when zero stable releases exist", async () => {
    const prerelease = ghRelease({ id: 1, tag_name: "v1.0-beta", prerelease: true, assets: [ghAsset({ id: 1, name: "Addon.zip" })] });
    const { net } = fakeNet({ releases: [prerelease] });
    const provider = new GitHubProvider(net);
    const result = await provider.getById("mockauthor/MockAddon", retail);
    expect(result!.files![0]!.version).toBe("v1.0-beta");
    expect(result!.files![0]!.channelType).toBe(1); // AddonChannelType.Beta
  });

  test("draft releases are never selected", async () => {
    const draft = ghRelease({ id: 1, tag_name: "v2.0-draft", draft: true, assets: [ghAsset({ id: 1, name: "Addon.zip" })] });
    const stable = ghRelease({ id: 2, tag_name: "v1.0", assets: [ghAsset({ id: 2, name: "Addon.zip" })] });
    const { net } = fakeNet({ releases: [draft, stable] });
    const provider = new GitHubProvider(net);
    const result = await provider.getById("mockauthor/MockAddon", retail);
    expect(result!.files![0]!.version).toBe("v1.0");
  });

  test("checks only the 5 most recent releases, not the whole history", async () => {
    const releases: GhRelease[] = [];
    for (let i = 1; i <= 7; i++) {
      // only release v2 is compatible — with 7 releases newest-first
      // (v7..v1), the 5-release lookback window is v7..v3, so v2 falls
      // just outside it and must never be reached.
      const compatible = i === 2;
      releases.push(
        ghRelease({
          id: i,
          tag_name: `v${i}`,
          published_at: new Date(2026, 0, i).toISOString(),
          assets: [ghAsset({ id: i, name: compatible ? "Addon.zip" : "Addon_classic.zip" })],
        }),
      );
    }
    releases.reverse(); // newest (v7) first
    const { net } = fakeNet({ releases });
    const provider = new GitHubProvider(net);
    await expect(provider.getById("mockauthor/MockAddon", retail)).rejects.toThrow(/no release compatible/);
  });

  // Investigation finding #10 / upstream issue #1283: must NOT silently
  // install a flavor-agnostic fallback asset when nothing matches.
  test("throws a clear error (not a silent wrong-flavor install) when no release has a compatible asset", async () => {
    const classicOnly = ghRelease({ id: 1, assets: [ghAsset({ id: 1, name: "Addon_classic.zip" })] });
    const { net } = fakeNet({ releases: [classicOnly] });
    const provider = new GitHubProvider(net);
    await expect(provider.getById("mockauthor/MockAddon", retail)).rejects.toThrow(ProviderError);
    await expect(provider.getById("mockauthor/MockAddon", retail)).rejects.toThrow(/no release compatible with Retail/);
  });

  test("returns undefined for a repo with releases but all drafts (treated as 'no releases')", async () => {
    const draftOnly = ghRelease({ id: 1, draft: true, assets: [ghAsset({ id: 1, name: "Addon.zip" })] });
    const { net } = fakeNet({ releases: [draftOnly] });
    const provider = new GitHubProvider(net);
    expect(await provider.getById("mockauthor/MockAddon", retail)).toBeUndefined();
  });

  test("returns undefined for a repo that doesn't exist (404)", async () => {
    const { net } = fakeNet({ repo: null });
    const provider = new GitHubProvider(net);
    expect(await provider.getById("mockauthor/NoSuchRepo", retail)).toBeUndefined();
  });

  test("returns undefined for an invalid addon id", async () => {
    const { net } = fakeNet({});
    const provider = new GitHubProvider(net);
    expect(await provider.getById("not-owner-slash-repo", retail)).toBeUndefined();
  });

  // Investigation finding #4: release.json is an uploaded ASSET fetched
  // via its own browser_download_url, never a repo file.
  test("fetches release.json from its browser_download_url when present as an asset", async () => {
    const releaseJsonAsset = ghAsset({ id: 99, name: "release.json" });
    const addonAsset = ghAsset({ id: 1, name: "Addon-Mists.zip" });
    const release = ghRelease({ id: 1, assets: [releaseJsonAsset, addonAsset] });
    const { net, gets } = fakeNet({
      releases: [release],
      textByUrl: {
        [releaseJsonAsset.browser_download_url]: JSON.stringify({
          releases: [{ filename: "Addon-Mists.zip", metadata: [{ flavor: "mists", interface: 50400 }] }],
        }),
      },
    });
    const provider = new GitHubProvider(net);
    const result = await provider.getById("mockauthor/MockAddon", mists);
    expect(result!.files![0]!.downloadUrl).toBe(addonAsset.browser_download_url);
    expect(gets).toContain(releaseJsonAsset.browser_download_url);
  });

  test("malformed release.json falls back to the filename heuristic instead of throwing", async () => {
    const releaseJsonAsset = ghAsset({ id: 99, name: "release.json" });
    const addonAsset = ghAsset({ id: 1, name: "Addon.zip" });
    const release = ghRelease({ id: 1, assets: [releaseJsonAsset, addonAsset] });
    const { net } = fakeNet({
      releases: [release],
      textByUrl: { [releaseJsonAsset.browser_download_url]: "not json" },
    });
    const provider = new GitHubProvider(net);
    const result = await provider.getById("mockauthor/MockAddon", retail);
    expect(result!.files![0]!.downloadUrl).toBe(addonAsset.browser_download_url);
  });

  // Investigation finding #8/#7: persisted identity must be release+asset
  // id-based, not a filename string, so needsUpdate() works correctly.
  test("file externalId is the release id + asset id pair, not a filename or tag", async () => {
    const asset = ghAsset({ id: 555, name: "Addon.zip" });
    const release = ghRelease({ id: 42, tag_name: "v1.0", assets: [asset] });
    const { net } = fakeNet({ releases: [release] });
    const provider = new GitHubProvider(net);
    const result = await provider.getById("mockauthor/MockAddon", retail);
    expect(result!.files![0]!.externalId).toBe("42:555");
  });

  // Investigation finding #9: always browser_download_url, install AND update.
  test("download url is always the public browser_download_url, never an authenticated API asset endpoint", async () => {
    const asset = ghAsset({ id: 1, name: "Addon.zip" });
    const release = ghRelease({ id: 1, assets: [asset] });
    const { net } = fakeNet({ releases: [release] });
    const provider = new GitHubProvider(net);
    const result = await provider.getById("mockauthor/MockAddon", retail);
    expect(result!.files![0]!.downloadUrl).toBe(asset.browser_download_url);
    expect(result!.files![0]!.downloadUrl).not.toContain("api.github.com");
    expect(await provider.getDownloadAuth()).toBeUndefined();
  });

  test("externalId/providerName/externalUrl persist the repo identity for update tracking", async () => {
    const asset = ghAsset({ id: 1, name: "Addon.zip" });
    const release = ghRelease({ id: 1, assets: [asset] });
    const repo = ghRepo({ full_name: "Mockauthor/MockAddon" }); // GitHub-canonical casing
    const { net } = fakeNet({ repo, releases: [release] });
    const provider = new GitHubProvider(net);
    const result = await provider.getById("mockauthor/mockaddon", retail);
    expect(result!.externalId).toBe("Mockauthor/MockAddon");
    expect(result!.providerName).toBe("GitHub");
    expect(result!.externalUrl).toBe(repo.html_url);
  });

  // Investigation finding #12: no manifest-driven folder list — leave
  // `folders` empty and let AddonInstaller's own fallback (every extracted
  // top-level dir) handle multi-folder releases generically.
  test("files[].folders is always empty, relying on the installer's extracted-dirs fallback", async () => {
    const asset = ghAsset({ id: 1, name: "Addon.zip" });
    const release = ghRelease({ id: 1, assets: [asset] });
    const { net } = fakeNet({ releases: [release] });
    const provider = new GitHubProvider(net);
    const result = await provider.getById("mockauthor/MockAddon", retail);
    expect(result!.files![0]!.folders).toEqual([]);
  });
});

describe("GitHubProvider rate limiting and errors", () => {
  // Investigation finding #11: upstream only checks 403+zero-remaining,
  // never 429. Both must be detected and reported clearly here.
  test("403 with x-ratelimit-remaining: 0 is reported as a clear rate-limit error", async () => {
    const { net } = fakeNet({ repoStatus: 403, repoHeaders: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1999999999" } });
    const provider = new GitHubProvider(net);
    await expect(provider.getById("mockauthor/MockAddon", retail)).rejects.toThrow(ProviderError);
    try {
      await provider.getById("mockauthor/MockAddon", retail);
      throw new Error("expected rejection");
    } catch (err) {
      expect((err as ProviderError).code).toBe("github_rate_limited");
      expect((err as Error).message).toMatch(/limiting requests/i);
    }
  });

  test("429 is reported as a clear rate-limit error, matching 403+zero-remaining semantics", async () => {
    const { net } = fakeNet({ repoStatus: 429 });
    const provider = new GitHubProvider(net);
    try {
      await provider.getById("mockauthor/MockAddon", retail);
      throw new Error("expected rejection");
    } catch (err) {
      expect((err as ProviderError).code).toBe("github_rate_limited");
    }
  });

  test("a plain 403 (quota remaining) is reported as 'not accessible', distinct from rate limiting", async () => {
    const { net } = fakeNet({ repoStatus: 403, repoHeaders: { "x-ratelimit-remaining": "42" } });
    const provider = new GitHubProvider(net);
    try {
      await provider.getById("mockauthor/PrivateRepo", retail);
      throw new Error("expected rejection");
    } catch (err) {
      expect((err as ProviderError).code).toBe("github_forbidden");
      expect((err as Error).message).toMatch(/not accessible/i);
    }
  });
});

describe("GitHubProvider.searchByQuery / isValidAddonId / getAll", () => {
  test("searchByQuery returns [] for a plain-text query (leaves catalog search to other providers)", async () => {
    const { net } = fakeNet({});
    const provider = new GitHubProvider(net);
    expect(await provider.searchByQuery("questie", retail)).toEqual([]);
  });

  test("searchByQuery resolves a pasted GitHub URL to a single result", async () => {
    const asset = ghAsset({ id: 1, name: "Addon.zip" });
    const release = ghRelease({ id: 1, assets: [asset] });
    const { net } = fakeNet({ releases: [release] });
    const provider = new GitHubProvider(net);
    const results = await provider.searchByQuery("https://github.com/mockauthor/MockAddon", retail);
    expect(results).toHaveLength(1);
    expect(results[0]!.name).toBe("MockAddon");
  });

  test("isValidAddonId accepts owner/repo, rejects everything else", () => {
    const provider = new GitHubProvider(fakeNet({}).net);
    expect(provider.isValidAddonId("owner/repo")).toBe(true);
    expect(provider.isValidAddonId("just-a-name")).toBe(false);
    expect(provider.isValidAddonId("owner/repo/extra")).toBe(false);
    expect(provider.isValidAddonId("3194")).toBe(false); // a CurseForge-style numeric id must not validate here
  });

  test("getAll reports a removed repo as an error without aborting the batch", async () => {
    const asset = ghAsset({ id: 1, name: "Addon.zip" });
    const release = ghRelease({ id: 1, assets: [asset] });
    let call = 0;
    const net = {
      getJson: async <T>(url: string): Promise<T> => {
        if (url.includes("/releases")) {
          return [release] as unknown as T;
        }
        call++;
        if (call === 2) {
          throw new NetworkError("404", 404, url);
        }
        return ghRepo() as unknown as T;
      },
      getText: async () => {
        throw new Error("unused");
      },
    } as unknown as NetworkClient;
    const provider = new GitHubProvider(net);
    const { searchResults, errors } = await provider.getAll(retail, ["a/one", "a/two"]);
    expect(searchResults).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect((errors[0] as ProviderError).code).toBe("source_removed");
  });
});

describe("GitHubProvider capability flags", () => {
  test("GitHub is never catalog-searchable, never scan/search-dispatched, never settings-toggleable", () => {
    const provider = new GitHubProvider(fakeNet({}).net);
    expect(provider.catalogSearch).toBe(false);
    expect(provider.allowEdit).toBe(false);
    expect(provider.enabled).toBe(true);
  });
});

describe("GitHubProvider.getDescription — README", () => {
  test("fetches the repo's README using the raw media type (no base64 decoding needed)", async () => {
    let seenUrl = "";
    let seenAccept: string | undefined;
    const net = {
      getJson: async () => {
        throw new Error("unused");
      },
      getText: async (url: string, opts?: { headers?: Record<string, string> }) => {
        seenUrl = url;
        seenAccept = opts?.headers?.Accept;
        return "# Hello\n\nThis is the readme.";
      },
    } as unknown as NetworkClient;
    const provider = new GitHubProvider(net);
    const description = await provider.getDescription("mockauthor/MockAddon");
    expect(seenUrl).toBe("https://api.github.com/repos/mockauthor/MockAddon/readme");
    expect(seenAccept).toBe("application/vnd.github.raw+json");
    expect(description).toBe("# Hello\n\nThis is the readme.");
  });

  test("a repo with no README returns an empty string, not an error", async () => {
    const net = {
      getText: async () => {
        throw new NetworkError("404", 404, "x");
      },
    } as unknown as NetworkClient;
    const provider = new GitHubProvider(net);
    expect(await provider.getDescription("mockauthor/MockAddon")).toBe("");
  });

  test("returns undefined for an invalid addon id, without making any request", async () => {
    let called = false;
    const net = { getText: async () => { called = true; throw new Error("x"); } } as unknown as NetworkClient;
    const provider = new GitHubProvider(net);
    expect(await provider.getDescription("not-owner-slash-repo")).toBeUndefined();
    expect(called).toBe(false);
  });

  test("attaches the token when configured, same as the metadata endpoints", async () => {
    let seenAuth: string | undefined;
    const net = {
      getText: async (_url: string, opts?: { headers?: Record<string, string> }) => {
        seenAuth = opts?.headers?.Authorization;
        return "readme text";
      },
    } as unknown as NetworkClient;
    const provider = new GitHubProvider(net, () => "my-token");
    await provider.getDescription("mockauthor/MockAddon");
    expect(seenAuth).toBe("Bearer my-token");
  });
});

describe("GitHubProvider.getChangelog — matched release's own notes", () => {
  test("returns the body of the same release getById would resolve to, not just 'the latest'", async () => {
    const newerIncompatible = ghRelease({
      id: 2,
      tag_name: "v2.0",
      body: "v2.0 notes (classic-only, incompatible with retail)",
      published_at: "2026-02-01T00:00:00Z",
      assets: [ghAsset({ id: 2, name: "Addon_classic.zip" })],
    });
    const olderCompatible = ghRelease({
      id: 1,
      tag_name: "v1.0",
      body: "v1.0 notes (compatible with retail)",
      published_at: "2026-01-01T00:00:00Z",
      assets: [ghAsset({ id: 1, name: "Addon.zip" })],
    });
    const { net } = fakeNet({ releases: [newerIncompatible, olderCompatible] });
    const provider = new GitHubProvider(net);
    expect(await provider.getChangelog("mockauthor/MockAddon", retail)).toBe(
      "## v1.0\n\n_Release · 2026-01-01_\n\nv1.0 notes (compatible with retail)",
    );
  });

  test("includes the releases just before the matched one, capped at CHANGELOG_ENTRY_COUNT", async () => {
    const releases = [4, 3, 2, 1].map((n) =>
      ghRelease({
        id: n,
        tag_name: `v${n}.0`,
        body: `notes ${n}`,
        published_at: `2026-0${n}-01T00:00:00Z`,
        assets: [ghAsset({ id: n, name: "Addon.zip" })],
      }),
    );
    const { net } = fakeNet({ releases });
    const provider = new GitHubProvider(net);
    const text = (await provider.getChangelog("mockauthor/MockAddon", retail))!;
    expect(text.indexOf("## v4.0")).toBeLessThan(text.indexOf("## v3.0"));
    expect(text.indexOf("## v3.0")).toBeLessThan(text.indexOf("## v2.0"));
    expect(text).not.toContain("## v1.0");
  });

  test("returns an empty string when the matched release has no body", async () => {
    const release = ghRelease({ id: 1, body: null, assets: [ghAsset({ id: 1, name: "Addon.zip" })] });
    const { net } = fakeNet({ releases: [release] });
    const provider = new GitHubProvider(net);
    expect(await provider.getChangelog("mockauthor/MockAddon", retail)).toBe("");
  });

  // Matches getById's own behavior exactly (same resolveCompatible path)
  // — in practice this only gets called for a result Install from URL
  // already successfully resolved moments earlier, so a genuinely
  // incompatible lookup here would mean the repo changed in between.
  test("throws the same 'no compatible release' error as getById when nothing matches", async () => {
    const release = ghRelease({ id: 1, assets: [ghAsset({ id: 1, name: "Addon_classic.zip" })] });
    const { net } = fakeNet({ releases: [release] });
    const provider = new GitHubProvider(net);
    await expect(provider.getChangelog("mockauthor/MockAddon", retail)).rejects.toThrow(/no release compatible/);
  });
});

describe("GitHubProvider personal access token", () => {
  test("attaches Authorization: Bearer <token> to repo/releases metadata calls when configured", async () => {
    const asset = ghAsset({ id: 1, name: "Addon.zip" });
    const release = ghRelease({ id: 1, assets: [asset] });
    const seenHeaders: Array<Record<string, string> | undefined> = [];
    const net = {
      getJson: async <T>(url: string, opts?: { headers?: Record<string, string> }): Promise<T> => {
        seenHeaders.push(opts?.headers);
        if (url.includes("/releases")) {
          return [release] as unknown as T;
        }
        return ghRepo() as unknown as T;
      },
      getText: async () => {
        throw new Error("unused");
      },
    } as unknown as NetworkClient;
    const provider = new GitHubProvider(net, () => "my-token-123");
    await provider.getById("mockauthor/MockAddon", retail);
    expect(seenHeaders.length).toBeGreaterThan(0);
    for (const headers of seenHeaders) {
      expect(headers?.Authorization).toBe("Bearer my-token-123");
    }
  });

  test("no Authorization header is sent when no token is configured", async () => {
    const asset = ghAsset({ id: 1, name: "Addon.zip" });
    const release = ghRelease({ id: 1, assets: [asset] });
    const seenHeaders: Array<Record<string, string> | undefined> = [];
    const net = {
      getJson: async <T>(url: string, opts?: { headers?: Record<string, string> }): Promise<T> => {
        seenHeaders.push(opts?.headers);
        if (url.includes("/releases")) {
          return [release] as unknown as T;
        }
        return ghRepo() as unknown as T;
      },
      getText: async () => {
        throw new Error("unused");
      },
    } as unknown as NetworkClient;
    const provider = new GitHubProvider(net); // no tokenProvider at all
    await provider.getById("mockauthor/MockAddon", retail);
    for (const headers of seenHeaders) {
      expect(headers?.Authorization).toBeUndefined();
    }
  });

  // The core safety property from the investigation: the token must
  // never reach a download request, since this provider deliberately
  // never uses the authenticated asset endpoint (sidesteps upstream's
  // JSON-as-zip bug class entirely rather than replicating its careful-
  // Accept-header handling for the token-configured case).
  test("getDownloadAuth never attaches the token, even when one is configured", async () => {
    const provider = new GitHubProvider(fakeNet({}).net, () => "my-token-123");
    expect(await provider.getDownloadAuth()).toBeUndefined();
  });

  test("getDownloadAuth never attaches anything when no token either", async () => {
    const provider = new GitHubProvider(fakeNet({}).net);
    expect(await provider.getDownloadAuth()).toBeUndefined();
  });

  test("testApiKey: 200 from /rate_limit means the token is accepted", async () => {
    const net = {
      getJson: async () => ({ resources: {}, rate: {} }),
    } as unknown as NetworkClient;
    const provider = new GitHubProvider(net);
    const result = await provider.testApiKey("a-valid-looking-token");
    expect(result.ok).toBe(true);
    expect(result.httpStatus).toBe(200);
  });

  test("testApiKey: 401 means the token is rejected, with a helpful message", async () => {
    const net = {
      getJson: async () => {
        throw new NetworkError("GET x failed: HTTP 401", 401, "x");
      },
    } as unknown as NetworkClient;
    const provider = new GitHubProvider(net);
    const result = await provider.testApiKey("a-bad-token");
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(401);
    expect(result.message).toMatch(/rejected/i);
  });

  test("testApiKey: the token never appears in the resulting message (no leak)", async () => {
    const net = {
      getJson: async () => {
        throw new NetworkError("GET x failed: HTTP 401", 401, "x");
      },
    } as unknown as NetworkClient;
    const provider = new GitHubProvider(net);
    const secret = "ghp_super_secret_token_value_12345";
    const result = await provider.testApiKey(secret);
    expect(result.message).not.toContain(secret);
  });

  // Redirects to non-GitHub hosts must not receive GitHub authorization
  // headers. release.json is fetched from its own browser_download_url
  // (a github.com URL that itself redirects to a different storage
  // host) via getText, which never receives any headers at all — the
  // token is only ever attached inside fetchRepo/fetchReleases' own
  // getJson calls to api.github.com.
  test("release.json fetch (browser_download_url, a different/redirecting host) never receives the token", async () => {
    const releaseJsonAsset = ghAsset({ id: 99, name: "release.json" });
    const addonAsset = ghAsset({ id: 1, name: "Addon.zip" });
    const release = ghRelease({ id: 1, assets: [releaseJsonAsset, addonAsset] });
    let getTextHeaders: unknown = "not called";
    const net = {
      getJson: async <T>(url: string): Promise<T> => {
        if (url.includes("/releases")) return [release] as unknown as T;
        return ghRepo() as unknown as T;
      },
      getText: async (_url: string, opts?: { headers?: Record<string, string> }) => {
        getTextHeaders = opts?.headers;
        return JSON.stringify({ releases: [{ filename: "Addon.zip", metadata: [{ flavor: "mainline", interface: 1 }] }] });
      },
    } as unknown as NetworkClient;
    const provider = new GitHubProvider(net, () => "my-token-123");
    await provider.getById("mockauthor/MockAddon", retail);
    expect(getTextHeaders).not.toBe("not called");
    expect(getTextHeaders).toBeUndefined();
  });

  test("public repository imports work with no token configured at all (not a prerequisite)", async () => {
    const asset = ghAsset({ id: 1, name: "Addon.zip" });
    const release = ghRelease({ id: 1, assets: [asset] });
    const { net } = fakeNet({ releases: [release] });
    const provider = new GitHubProvider(net); // explicitly no token
    const result = await provider.getById("mockauthor/MockAddon", retail);
    expect(result).toBeDefined();
    expect(provider.isConfigured()).toBe(true);
  });
});
