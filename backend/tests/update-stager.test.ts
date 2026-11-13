/**
 * system.updateStage / UpdateStager: download the staged release with
 * the token, verify the package before anything is staged, and leave a
 * 0600 temp file for Decky's installer. The fake net stands in for
 * NetworkClient.downloadToFile (deterministic tests, AGENTS.md).
 */

import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { zipSync } from "fflate";
import { NetworkError, type DownloadOptions } from "../src/wow/net/network";
import { stagedFileName, UpdateStager, type DownloadProgress } from "../src/wow/plugin/UpdateStager";
import { normalizeVersion } from "../src/wow/plugin/PluginVersion";
import type { PluginUpdateOffer, PluginUpdateSnapshot, UpdateChannel } from "../src/api/contracts";
import { PluginUpdateCheck, type StagingAnswer } from "../src/wow/notifications/PluginUpdateCheck";

const ROOT = "/tmp/opencode/wowdeck-tests/update-stager";

/** `engine` is where the zip carries the engine: bin/wowdeck up to 1.0.1, bin/wowdeck-<uname -m> after. */
function pluginZip(version: string, omit?: string, engine = "wowdeck/bin/wowdeck"): Uint8Array {
  const entries: Record<string, Uint8Array> = {
    "wowdeck/plugin.json": new TextEncoder().encode(JSON.stringify({ name: "WoWDeck", version, api_version: 1 })),
    "wowdeck/package.json": new TextEncoder().encode(JSON.stringify({ name: "wowdeck", version })),
    "wowdeck/main.py": new TextEncoder().encode("# entry"),
    "wowdeck/dist/index.js": new TextEncoder().encode("// bundle"),
    [engine]: new TextEncoder().encode("#!/bin/bun"),
  };
  if (omit) {
    delete entries[omit];
  }
  return zipSync(entries);
}

/** An offered 0.2.0 with its zip; `version` and `kind` reshape the offer, `offer: null` drops it. */
function answerOf(
  over: Partial<StagingAnswer> & { version?: string; kind?: PluginUpdateOffer["kind"] } = {},
): StagingAnswer {
  const { version = "0.2.0", kind = "update", ...rest } = over;
  return {
    status: "available",
    offer: {
      kind,
      version,
      headline: `WoWDeck ${version} available`,
      buttonLabel: "Update",
      toastBody: "Update in Options",
      rowLabel: "WoWDeck update available",
      releaseNotes: null,
      releaseUrl: "https://x",
      installable: true,
    },
    downloadUrl: "https://mock/WoWDeck.zip",
    ...rest,
  };
}

function makeStager(
  respond: () => Uint8Array | Error,
  answer: Parameters<typeof answerOf>[0] = {},
  token?: string,
): { stager: UpdateStager; auths: () => (string | undefined)[] } {
  const auths: (string | undefined)[] = [];
  const net = {
    async downloadToFile(
      url: string,
      destination: string,
      options?: { headers?: Record<string, string>; trustedHostsForHeaders?: string[] },
    ): Promise<number> {
      auths.push(options?.headers?.Authorization);
      // The API asset URL answers with the file only to this Accept; the
      // headers never leave its host across GitHub's storage redirect.
      expect(options?.headers?.Accept).toBe("application/octet-stream");
      expect(options?.trustedHostsForHeaders).toEqual(["mock"]);
      expect(url).toBe("https://mock/WoWDeck.zip");
      const value = respond();
      if (value instanceof Error) throw value;
      writeFileSync(destination, value);
      return value.length;
    },
  };
  return {
    stager: new UpdateStager(net, { forStaging: async () => answerOf(answer), recordStagedVersion: () => {} }, token ? () => token : undefined, ROOT),
    auths: () => auths,
  };
}

const sha256 = (data: Uint8Array) => new Bun.CryptoHasher("sha256").update(data).digest("hex");

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

describe("UpdateStager.stage", () => {
  test("a partial authenticated download fails without restarting progress", async () => {
    mkdirSync(ROOT, { recursive: true });
    let attempts = 0;
    const progress: DownloadProgress[] = [];
    const stager = new UpdateStager({
      async downloadToFile(_url: string, path: string, options?: DownloadOptions) {
        attempts++;
        writeFileSync(path, new Uint8Array([1, 2]));
        options?.onProgress?.(2, 100);
        throw new NetworkError("body interrupted");
      },
    }, { forStaging: async () => answerOf(), recordStagedVersion: () => {} }, () => "test-token", ROOT, (event) => progress.push(event));
    expect((await stager.stage()).error?.code).toBe("download_failed");
    expect(attempts).toBe(1);
    expect(progress.map((event) => event.received)).toEqual([0, 2]);
    expect(existsSync(join(ROOT, stagedFileName("0.2.0")))).toBe(false);
  });
  test.each(["release", "pr"])("cancel during %s metadata lookup stages nothing", async (path) => {
    let release!: () => void;
    const metadata = new Promise<void>((resolve) => { release = resolve; });
    let downloads = 0;
    let recorded = false;
    const stager = new UpdateStager({ downloadToFile: async () => { downloads++; return 0; } }, {
      forStaging: async () => { await metadata; return answerOf(); },
      recordStagedVersion: () => { recorded = true; },
    }, undefined, ROOT, undefined, { list: async () => { await metadata; return []; } });
    const pending = path === "release" ? stager.stage() : stager.stageListedPrBuild(117, "1.1.2-pr.117");
    expect(stager.cancel()).toBe(true);
    release();
    expect((await pending).error?.code).toBe("cancelled");
    expect(downloads).toBe(0);
    expect(recorded).toBe(false);
    expect(stager.cancel()).toBe(false);
  });

  test("downloads with the token, verifies, stages 0600, reports file:// and sha256", async () => {
    mkdirSync(ROOT, { recursive: true });
    const zip = pluginZip("0.2.0");
    const { stager, auths } = makeStager(() => zip, {}, "ghp_test");
    const outcome = await stager.stage();
    expect(outcome.error).toBeNull();
    expect(outcome.result).toEqual({
      artifact: `file://${join(ROOT, "wowdeck-update-0.2.0.zip")}`,
      version: "0.2.0",
      sha256: sha256(zip),
    });
    expect(auths()).toEqual(["Bearer ghp_test"]);
    const staged = join(ROOT, "wowdeck-update-0.2.0.zip");
    expect(existsSync(staged)).toBe(true);
    expect(statSync(staged).mode & 0o777).toBe(0o600);
    rmSync(staged, { force: true });
  });

  test("stages a release that names its engine per architecture, with no bin/wowdeck", async () => {
    mkdirSync(ROOT, { recursive: true });
    const { stager } = makeStager(() => pluginZip("0.2.0", undefined, "wowdeck/bin/wowdeck-x86_64"));
    const outcome = await stager.stage();
    expect(outcome.error).toBeNull();
    expect(outcome.result?.version).toBe("0.2.0");
    rmSync(join(ROOT, "wowdeck-update-0.2.0.zip"), { force: true });
  });

  test("stages an older stable offered as a switch from a beta build", async () => {
    mkdirSync(ROOT, { recursive: true });
    const zip = pluginZip("0.3.0");
    const { stager } = makeStager(() => zip, { version: "0.3.0", kind: "switchToStable" });
    const outcome = await stager.stage();
    expect(outcome.error).toBeNull();
    expect(outcome.result?.version).toBe("0.3.0");
    rmSync(join(ROOT, "wowdeck-update-0.3.0.zip"), { force: true });
  });

  test.each(["1.2.3", "1.3.0-beta.2"])(
    "%s stages under stagedFileName(version), a canonical WoWDeck version",
    async (version) => {
      mkdirSync(ROOT, { recursive: true });
      const { stager } = makeStager(() => pluginZip(version), { version });
      const outcome = await stager.stage();
      expect(outcome.error).toBeNull();
      const result = outcome.result!;
      expect(result.version).toBe(version);
      expect(normalizeVersion(result.version)).toBe(result.version);
      expect(result.artifact).toBe(`file://${join(ROOT, stagedFileName(version))}`);
      rmSync(join(ROOT, stagedFileName(version)), { force: true });
    },
  );

  test("a rejected token falls back to one unauthenticated attempt", async () => {
    mkdirSync(ROOT, { recursive: true });
    let n = 0;
    const zip = pluginZip("0.2.0");
    const { stager, auths } = makeStager(
      () => (++n === 1 ? new NetworkError("GET … failed: HTTP 401", 401) : zip),
      {},
      "ghp_expired",
    );
    const outcome = await stager.stage();
    expect(outcome.error).toBeNull();
    expect(auths()).toEqual(["Bearer ghp_expired", undefined]);
    rmSync(join(ROOT, "wowdeck-update-0.2.0.zip"), { force: true });
  });

  test("already current / couldn't check / no zip asset: nothing downloaded", async () => {
    const current = makeStager(() => pluginZip("0.2.0"), { status: "current", offer: null, downloadUrl: null });
    expect((await current.stager.stage()).error).toEqual({
      code: "up_to_date",
      message: "WoWDeck is already up to date",
    });
    const unknown = makeStager(() => pluginZip("0.2.0"), { status: "unknown", offer: null, downloadUrl: null });
    expect((await unknown.stager.stage()).error?.code).toBe("check_unavailable");
    const noAsset = makeStager(() => pluginZip("0.2.0"), { downloadUrl: null });
    expect((await noAsset.stager.stage()).error?.code).toBe("no_download");
    expect(current.auths()).toEqual([]);
  });

  test("a failed download stages nothing", async () => {
    mkdirSync(ROOT, { recursive: true });
    const { stager, auths } = makeStager(() => new NetworkError("GET … failed: HTTP 403", 403), {}, "ghp_limited");
    const outcome = await stager.stage();
    expect(outcome.result).toBeNull();
    expect(outcome.error?.code).toBe("download_failed");
    expect(auths()).toEqual(["Bearer ghp_limited", undefined]);
    expect(existsSync(join(ROOT, "wowdeck-update-0.2.0.zip"))).toBe(false);
  });

  test("a corrupt zip, or one that is not the packaged WoWDeck, is rejected unstaged", async () => {
    mkdirSync(ROOT, { recursive: true });
    const corrupt = makeStager(() => new TextEncoder().encode("this is not a zip"));
    expect((await corrupt.stager.stage()).error?.code).toBe("archive_invalid");

    const badName = zipSync({
      "wowdeck/plugin.json": new TextEncoder().encode(JSON.stringify({ name: "NotWoWDeck", version: "0.2.0" })),
      "wowdeck/package.json": new TextEncoder().encode("{}"),
      "wowdeck/main.py": new TextEncoder().encode("#"),
      "wowdeck/dist/index.js": new TextEncoder().encode("//"),
      "wowdeck/bin/wowdeck": new TextEncoder().encode("#"),
    });
    const nameStage = makeStager(() => badName);
    expect((await nameStage.stager.stage()).error?.code).toBe("archive_invalid");

    const wrongVersion = makeStager(() => pluginZip("0.3.0"));
    expect((await wrongVersion.stager.stage()).error?.code).toBe("archive_invalid");

    const incomplete = makeStager(() => pluginZip("0.2.0", "wowdeck/bin/wowdeck"));
    expect((await incomplete.stager.stage()).error?.code).toBe("archive_invalid");

    expect(existsSync(join(ROOT, "wowdeck-update-0.2.0.zip"))).toBe(false);
  });

  test("staging files older than a day are swept; fresher ones stay", async () => {
    mkdirSync(ROOT, { recursive: true });
    const stale = join(ROOT, "wowdeck-update-0.1.0.zip");
    writeFileSync(stale, pluginZip("0.1.0"));
    utimesSync(stale, new Date(Date.now() - 25 * 60 * 60 * 1000), new Date(Date.now() - 25 * 60 * 60 * 1000));
    const fresh = join(ROOT, "wowdeck-update-0.1.5.zip");
    writeFileSync(fresh, pluginZip("0.1.5"));

    const zip = pluginZip("0.2.0");
    const { stager } = makeStager(() => zip);
    await stager.stage();
    expect(existsSync(stale)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
    rmSync(fresh, { force: true });
    rmSync(join(ROOT, "wowdeck-update-0.2.0.zip"), { force: true });
  });
});

/**
 * A 404 on the stored answer's zip (CI prunes older betas whenever a new one
 * publishes): one forced check, one retry with its answer. A real
 * PluginUpdateCheck on one fake net that serves both the releases listing
 * and the downloads.
 */
describe("UpdateStager.stage after the offered zip is gone", () => {
  const NOW = 1_800_000_000_000;
  const ASSET_A = "https://api.github.com/repos/sigboe/wowdeck/releases/assets/682923259";
  const ASSET_B = "https://api.github.com/repos/sigboe/wowdeck/releases/assets/684438832";
  const release = (tag: string, zip: string) => ({
    tag_name: tag,
    prerelease: tag.includes("-beta."),
    html_url: `https://github.com/sigboe/wowdeck/releases/tag/${tag}`,
    assets: [{ name: "WoWDeck.zip", url: zip }],
  });
  const gone = () => new NetworkError(`GET ${ASSET_A} failed: HTTP 404`, 404);

  function harness(opts: {
    /** The releases listing a forced check gets, or the error it fails with. */
    listing: unknown[] | Error;
    /** What each asset URL answers. */
    assets: Record<string, () => Uint8Array | Error>;
  }) {
    const persisted = {
      // Yesterday's beta answer, inside the daily interval: beta.1 with asset A.
      stamp: {
        checkedAt: NOW - 60 * 60 * 1000,
        channel: "beta",
        latestVersion: "0.2.1-beta.1",
        releaseUrl: "https://github.com/sigboe/wowdeck/releases/tag/v0.2.1-beta.1",
        downloadUrl: ASSET_A,
      } as PluginUpdateSnapshot,
      toastShownFor: null as string | null,
      stagedVersion: "0.1.0" as string | null,
    };
    const checks: string[] = [];
    const downloads: string[] = [];
    const net = {
      async getJson<T>(url: string): Promise<T> {
        checks.push(url);
        if (opts.listing instanceof Error) throw opts.listing;
        return opts.listing as T;
      },
      async downloadToFile(url: string, destination: string): Promise<number> {
        downloads.push(url);
        const value = opts.assets[url]?.() ?? new NetworkError(`GET ${url} failed: HTTP 404`, 404);
        if (value instanceof Error) throw value;
        writeFileSync(destination, value);
        return value.length;
      },
    };
    const check = new PluginUpdateCheck(
      net,
      "0.2.0",
      undefined,
      undefined,
      {
        read: () => persisted.stamp,
        write: (snapshot) => {
          persisted.stamp = snapshot;
        },
        readBackoff: () => null,
        writeBackoff: () => {},
        readToastShown: () => persisted.toastShownFor,
        writeToastShown: (version) => {
          persisted.toastShownFor = version;
        },
        readLastRunVersion: () => "0.2.0",
        writeLastRunVersion: () => {},
        readStagedVersion: () => persisted.stagedVersion,
        writeStagedVersion: (version) => {
          persisted.stagedVersion = version;
        },
        readChannel: () => "beta",
        writeChannel: () => {},
        readPrChannel: () => null,
        writePrChannel: () => {},
        readMoveToStableAfterRelease: () => false,
      },
      { now: () => NOW },
    );
    return { stager: new UpdateStager(net, check, undefined, ROOT), persisted, checks, downloads };
  }

  test("a successful stage records the verified version", async () => {
    mkdirSync(ROOT, { recursive: true });
    const h = harness({ listing: [], assets: { [ASSET_A]: () => pluginZip("0.2.1-beta.1") } });
    expect((await h.stager.stage()).result?.version).toBe("0.2.1-beta.1");
    expect(h.persisted.stagedVersion).toBe("0.2.1-beta.1");
    rmSync(join(ROOT, "wowdeck-update-0.2.1-beta.1.zip"), { force: true });
  });

  test("a newer release from the forced check is staged, and its answer is stored", async () => {
    mkdirSync(ROOT, { recursive: true });
    const zip = pluginZip("0.2.1-beta.4");
    const h = harness({
      listing: [release("v0.2.1-beta.4", ASSET_B), release("v0.2.1-beta.3", "https://x/3")],
      assets: { [ASSET_A]: gone, [ASSET_B]: () => zip },
    });
    const outcome = await h.stager.stage();
    expect(outcome.error).toBeNull();
    expect(outcome.result).toEqual({
      artifact: `file://${join(ROOT, "wowdeck-update-0.2.1-beta.4.zip")}`,
      version: "0.2.1-beta.4",
      sha256: sha256(zip),
    });
    expect(h.downloads).toEqual([ASSET_A, ASSET_B]);
    expect(h.checks).toHaveLength(1);
    expect(h.persisted.stamp).toMatchObject({ latestVersion: "0.2.1-beta.4", downloadUrl: ASSET_B, checkedAt: NOW });
    // Staging shows the panel already: the forced check never spends the toast.
    expect(h.persisted.toastShownFor).toBeNull();
    expect(h.persisted.stagedVersion).toBe("0.2.1-beta.4");
    rmSync(join(ROOT, "wowdeck-update-0.2.1-beta.4.zip"), { force: true });
  });

  test("the forced check offering the same gone zip, or failing: download_failed after one retry", async () => {
    mkdirSync(ROOT, { recursive: true });
    for (const listing of [[release("v0.2.1-beta.1", ASSET_A)], new NetworkError("offline")]) {
      const h = harness({ listing, assets: { [ASSET_A]: gone } });
      const outcome = await h.stager.stage();
      expect(outcome).toEqual({
        result: null,
        error: { code: "download_failed", message: "Couldn't download the update. Try again" },
      });
      expect(h.downloads).toEqual([ASSET_A, ASSET_A]);
      expect(h.checks).toHaveLength(1);
    }
  });

  test("the forced check finding the running version current: up_to_date", async () => {
    const h = harness({ listing: [release("v0.2.0", "https://x/0.2.0")], assets: { [ASSET_A]: gone } });
    expect((await h.stager.stage()).error?.code).toBe("up_to_date");
    expect(h.downloads).toEqual([ASSET_A]);
  });

  test("the forced check's release without a zip: no_download", async () => {
    const h = harness({
      listing: [{ ...release("v0.2.1-beta.4", ASSET_B), assets: [] }],
      assets: { [ASSET_A]: gone },
    });
    expect((await h.stager.stage()).error?.code).toBe("no_download");
    expect(h.downloads).toEqual([ASSET_A]);
  });

  test("other download failures and a damaged zip: today's outcome, no forced check", async () => {
    mkdirSync(ROOT, { recursive: true });
    const cases: [() => Uint8Array | Error, string][] = [
      [() => new NetworkError("GET … failed: connection reset"), "download_failed"],
      [() => new NetworkError("GET … failed: HTTP 500", 500), "download_failed"],
      [() => new NetworkError("GET … failed: HTTP 429", 429), "download_failed"],
      [() => new TextEncoder().encode("this is not a zip"), "archive_invalid"],
      [() => pluginZip("0.2.1-beta.4"), "archive_invalid"],
    ];
    for (const [respond, code] of cases) {
      const h = harness({ listing: [release("v0.2.1-beta.4", ASSET_B)], assets: { [ASSET_A]: respond } });
      expect((await h.stager.stage()).error?.code).toBe(code);
      expect(h.downloads).toEqual([ASSET_A]);
      expect(h.checks).toEqual([]);
      expect(h.persisted.stamp.downloadUrl).toBe(ASSET_A);
      expect(h.persisted.stagedVersion).toBe("0.1.0");
    }
  });

  test("with a token, a 404 on both attempts is one round; the retry round tries both again", async () => {
    mkdirSync(ROOT, { recursive: true });
    const auths: (string | undefined)[] = [];
    const answers = [answerOf({ downloadUrl: ASSET_A }), answerOf({ version: "0.2.1", downloadUrl: ASSET_B })];
    const refreshes: (boolean | undefined)[] = [];
    const zip = pluginZip("0.2.1");
    const net = {
      async downloadToFile(url: string, destination: string, options?: { headers?: Record<string, string> }) {
        auths.push(options?.headers?.Authorization);
        if (url === ASSET_A) throw gone();
        writeFileSync(destination, zip);
        return zip.length;
      },
    };
    const check = {
      recordStagedVersion: () => {},
      async forStaging(opts?: { refresh?: boolean }) {
        refreshes.push(opts?.refresh);
        return answers.shift()!;
      },
    };
    const outcome = await new UpdateStager(net, check, () => "ghp_test", ROOT).stage();
    expect(outcome.result?.version).toBe("0.2.1");
    expect(refreshes).toEqual([undefined, true]);
    expect(auths).toEqual(["Bearer ghp_test", undefined, "Bearer ghp_test"]);
    rmSync(join(ROOT, "wowdeck-update-0.2.1.zip"), { force: true });
  });
});

describe("UpdateStager.stage: progress and cancel", () => {
  /**
   * A fake download that hands `zip` over in four chunks, reporting each
   * against `contentLength` like NetworkClient.downloadToFile. `hold`
   * waits after the first chunk until aborted; `failAfter` fails then.
   * Either leaves a partial file behind, as an interrupted write could.
   */
  function chunkedStager(
    zip: Uint8Array,
    { contentLength = zip.length as number | null, hold = false, failAfter }: {
      contentLength?: number | null;
      hold?: boolean;
      failAfter?: number;
    } = {},
  ) {
    const progress: DownloadProgress[] = [];
    let started!: () => void;
    const downloading = new Promise<void>((resolve) => {
      started = resolve;
    });
    const net = {
      async downloadToFile(_url: string, destination: string, options?: DownloadOptions): Promise<number> {
        const size = Math.ceil(zip.length / 4);
        for (let i = 0, received = 0; i < 4; i++) {
          if (failAfter === i) throw new NetworkError("connection reset");
          received = Math.min(zip.length, received + size);
          writeFileSync(destination, zip.subarray(0, received));
          options?.onProgress?.(received, contentLength);
          started();
          if (hold) {
            await new Promise<void>((resolve) => options?.signal?.addEventListener("abort", () => resolve()));
            throw new NetworkError("request aborted");
          }
        }
        return zip.length;
      },
    };
    const stager = new UpdateStager(
      net,
      { forStaging: async () => answerOf(), recordStagedVersion: () => {} },
      undefined,
      ROOT,
      (event) => progress.push(event),
    );
    return { stager, progress, downloading };
  }

  const stagedFile = join(ROOT, "wowdeck-update-0.2.0.zip");

  test("reports the download's bytes in order, against its Content-Length", async () => {
    mkdirSync(ROOT, { recursive: true });
    const zip = pluginZip("0.2.0");
    const { stager, progress } = chunkedStager(zip);

    const outcome = await stager.stage();

    expect(outcome.error).toBeNull();
    expect(progress[0]).toEqual({ version: "0.2.0", received: 0, total: zip.length });
    expect(progress.at(-1)).toEqual({ version: "0.2.0", received: zip.length, total: zip.length });
    const received = progress.map((p) => p.received);
    expect(received).toEqual([...received].sort((a, b) => a - b));
    expect(new Set(received).size).toBe(received.length);
    rmSync(stagedFile, { force: true });
  });

  test("without a Content-Length the total is null, and the last event still lands", async () => {
    mkdirSync(ROOT, { recursive: true });
    const zip = pluginZip("0.2.0");
    const { stager, progress } = chunkedStager(zip, { contentLength: null });

    await stager.stage();

    expect(progress.every((p) => p.total === null)).toBe(true);
    expect(progress.at(-1)?.received).toBe(zip.length);
    rmSync(stagedFile, { force: true });
  });

  test("cancel aborts the download: no partial file, nothing staged, answers cancelled", async () => {
    mkdirSync(ROOT, { recursive: true });
    const { stager, downloading } = chunkedStager(pluginZip("0.2.0"), { hold: true });

    const staging = stager.stage();
    await downloading;
    expect(existsSync(stagedFile)).toBe(true);
    expect(stager.cancel()).toBe(true);
    const outcome = await staging;

    expect(outcome).toEqual({
      result: null,
      error: { code: "cancelled", message: "The download was cancelled" },
    });
    expect(existsSync(stagedFile)).toBe(false);
    expect(stager.cancel()).toBe(false);
  });

  test("a download that fails partway answers download_failed and leaves no partial file", async () => {
    mkdirSync(ROOT, { recursive: true });
    const { stager } = chunkedStager(pluginZip("0.2.0"), { failAfter: 2 });

    const outcome = await stager.stage();

    expect(outcome.error?.code).toBe("download_failed");
    expect(existsSync(stagedFile)).toBe(false);
  });
});

/**
 * Move to Stable after release (GLOSSARY: Update channel): an in-app stable
 * update staged from Beta, then that stable's first run, both on one
 * persisted store like the engine's settings.
 */
describe("staging a stable release from Beta, then running it", () => {
  const NOW = 1_800_000_000_000;
  const ZIP_URL = "https://api.github.com/repos/sigboe/wowdeck/releases/assets/700000001";

  function session(running: string, persisted: { channel: UpdateChannel; lastRun: string | null; staged: string | null; moveToStable: boolean }, prepare: () => Promise<Uint8Array> = async () => pluginZip("0.3.0")) {
    const net = {
      async getJson<T>(): Promise<T> {
        throw new NetworkError("no check expected");
      },
      async downloadToFile(_url: string, destination: string): Promise<number> {
        const zip = await prepare();
        writeFileSync(destination, zip);
        return zip.length;
      },
    };
    const check = new PluginUpdateCheck(
      net,
      running,
      undefined,
      undefined,
      {
        // Beta's answer from an hour ago: stable 0.3.0, newer than the beta.
        read: () => ({
          checkedAt: NOW - 60 * 60 * 1000,
          channel: "beta",
          latestVersion: "0.3.0",
          releaseUrl: "https://github.com/sigboe/wowdeck/releases/tag/v0.3.0",
          downloadUrl: ZIP_URL,
        }),
        write: () => {},
        readBackoff: () => null,
        writeBackoff: () => {},
        readToastShown: () => null,
        writeToastShown: () => {},
        readLastRunVersion: () => persisted.lastRun,
        writeLastRunVersion: (version) => {
          persisted.lastRun = version;
        },
        readStagedVersion: () => persisted.staged,
        writeStagedVersion: (version) => {
          persisted.staged = version;
        },
        readChannel: () => persisted.channel,
        writeChannel: (channel) => {
          persisted.channel = channel;
        },
        readMoveToStableAfterRelease: () => persisted.moveToStable,
        readPrChannel: () => null,
        writePrChannel: () => {},
      },
      { now: () => NOW },
    );
    return { check, stager: new UpdateStager(net, check, undefined, ROOT) };
  }

  test.each(["failed", "cancelled"])("%s staging leaves Beta selected with Move to Stable on", async (mode) => {
    mkdirSync(ROOT, { recursive: true });
    const persisted = { channel: "beta" as UpdateChannel, lastRun: "0.3.0-beta.2" as string | null, staged: null as string | null, moveToStable: true };
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const held = new Promise<void>((resolve) => { release = resolve; });
    const before = session("0.3.0-beta.2", persisted, async () => {
      entered();
      await held;
      return mode === "failed" ? new Uint8Array([1, 2, 3]) : pluginZip("0.3.0");
    });
    const pending = before.stager.stage();
    await started;
    if (mode === "cancelled") expect(before.stager.cancel()).toBe(true);
    release();
    expect((await pending).result).toBeNull();
    expect(persisted.channel).toBe("beta");
    expect(persisted.staged).toBeNull();
    expect(existsSync(join(ROOT, stagedFileName("0.3.0")))).toBe(false);
  });

  test.each([
    { moveToStable: true, expected: "stable" },
    { moveToStable: false, expected: "beta" },
  ] as const)("Move to Stable after release $moveToStable: successful staging immediately selects $expected", async ({ moveToStable, expected }) => {
    mkdirSync(ROOT, { recursive: true });
    const persisted = { channel: "beta" as UpdateChannel, lastRun: "0.3.0-beta.2" as string | null, staged: null as string | null, moveToStable };
    const before = session("0.3.0-beta.2", persisted);
    expect((await before.stager.stage()).result?.version).toBe("0.3.0");
    expect(before.check.channel()).toBe(expected);
    expect(persisted.channel).toBe(expected);
    const after = session("0.3.0", persisted);
    expect(after.check.channel()).toBe(expected);
    rmSync(join(ROOT, "wowdeck-update-0.3.0.zip"), { force: true });
  });
});
