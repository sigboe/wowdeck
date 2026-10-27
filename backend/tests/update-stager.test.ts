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
import { NetworkError } from "../src/wow/net/network";
import { UpdateStager } from "../src/wow/plugin/UpdateStager";
import type { PluginUpdateOffer } from "../src/api/contracts";
import type { StagingAnswer } from "../src/wow/notifications/PluginUpdateCheck";

const ROOT = "/tmp/opencode/wowdeck-tests/update-stager";

function pluginZip(version: string, omit?: string): Uint8Array {
  const entries: Record<string, Uint8Array> = {
    "wowdeck/plugin.json": new TextEncoder().encode(JSON.stringify({ name: "WoWDeck", version, api_version: 1 })),
    "wowdeck/package.json": new TextEncoder().encode(JSON.stringify({ name: "wowdeck", version })),
    "wowdeck/main.py": new TextEncoder().encode("# entry"),
    "wowdeck/dist/index.js": new TextEncoder().encode("// bundle"),
    "wowdeck/bin/wowdeck": new TextEncoder().encode("#!/bin/bun"),
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
    stager: new UpdateStager(net, { forStaging: async () => answerOf(answer) }, token ? () => token : undefined, ROOT),
    auths: () => auths,
  };
}

const sha256 = (data: Uint8Array) => new Bun.CryptoHasher("sha256").update(data).digest("hex");

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

describe("UpdateStager.stage", () => {
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

  test("stages an older stable offered as a switch from a beta build", async () => {
    mkdirSync(ROOT, { recursive: true });
    const zip = pluginZip("0.3.0");
    const { stager } = makeStager(() => zip, { version: "0.3.0", kind: "switchToStable" });
    const outcome = await stager.stage();
    expect(outcome.error).toBeNull();
    expect(outcome.result?.version).toBe("0.3.0");
    rmSync(join(ROOT, "wowdeck-update-0.3.0.zip"), { force: true });
  });

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
    const { stager, auths } = makeStager(() => new NetworkError("GET … failed: HTTP 404", 404), {}, "ghp_limited");
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
