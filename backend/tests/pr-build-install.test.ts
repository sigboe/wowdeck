/**
 * Installing a PR build, engine side: system.installPrBuild. The engine
 * reads the list again, downloads the PR's zip, checks it against the
 * published sha256 and stages it for Decky's installer like Switch to beta
 * (UpdateStager). One fake net stands in for NetworkClient.getJson (the
 * list) and downloadToFile (the zip), so no test touches the network
 * (deterministic tests, AGENTS.md).
 */

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { zipSync } from "fflate";
import type { HandlerDeps } from "../src/api/handlers/deps";
import type { EventMap, MethodMap, PluginUpdateOffer } from "../src/api/contracts";
import { register } from "../src/api/handlers/system";
import { JsonlServer } from "../src/bridge/jsonl";
import { NetworkError, type DownloadOptions } from "../src/wow/net/network";
import { PrBuildList } from "../src/wow/plugin/PrBuildList";
import { UpdateStager } from "../src/wow/plugin/UpdateStager";

const ROOT = "/tmp/opencode/wowdeck-tests/pr-build-install";
const INDEX_URL = "https://sigboe.github.io/wowdeck/index.json";
const ZIP_URL = "https://sigboe.github.io/wowdeck/pr/117/WoWDeck.zip";

function pluginZip(version: string): Uint8Array {
  const text = (s: string) => new TextEncoder().encode(s);
  return zipSync({
    "wowdeck/plugin.json": text(JSON.stringify({ name: "WoWDeck", version, api_version: 1 })),
    "wowdeck/package.json": text(JSON.stringify({ name: "wowdeck", version })),
    "wowdeck/main.py": text("# entry"),
    "wowdeck/dist/index.js": text("// bundle"),
    "wowdeck/bin/wowdeck-x86_64": text("#!/bin/bun"),
  });
}

const sha256 = (data: Uint8Array) => new Bun.CryptoHasher("sha256").update(data).digest("hex");

/** The list's #117 entry, as tools/pr-build.ts publishes it. */
function entry117(over: Record<string, unknown> = {}) {
  return {
    number: 117,
    title: "Add PR builds to the channel picker",
    author: "sigboe",
    version: "1.1.2-pr.117.2",
    headSha: "0123456789abcdef0123456789abcdef01234567",
    builtAt: "2026-11-08T09:15:00Z",
    zipSize: 72998400,
    sha256: sha256(pluginZip("1.1.2-pr.117.2")),
    zipUrl: ZIP_URL,
    ...over,
  };
}

type Progress = EventMap["system.downloadProgress"];

interface Engine {
  install(params: MethodMap["system.installPrBuild"]["params"]): Promise<{ result?: unknown; error?: unknown }>;
  /** system.cancelDownload's answer. */
  cancel(): Promise<{ result?: unknown; error?: unknown }>;
  /** Resolves once the zip's download has started (its first bytes reported). */
  downloading: Promise<void>;
  /** The system.downloadProgress events the engine sent, in order. */
  progress: Progress[];
  /** Update on the update panel (system.updateStage). */
  update(): Promise<{ result?: unknown; error?: unknown }>;
  /** Every URL the engine asked, list and zip alike, with the zip's request headers. */
  asked: { url: string; headers?: Record<string, string> }[];
  /** Versions the engine recorded as staged for Decky. */
  recorded: string[];
  /** The update channel the engine was asked to store, if any. */
  channelWrites: string[];
}

/**
 * The fake download hands the zip over in `chunks` pieces, reporting each
 * like NetworkClient.downloadToFile (`total` is what Content-Length says).
 * `failAfter` fails it after that many chunks; `hold` keeps it waiting
 * after the first chunk until it is aborted. Either way a partial file is
 * left where the real one would be.
 */
function engine({
  list = { builds: [entry117()] } as unknown,
  zip = pluginZip("1.1.2-pr.117.2") as Uint8Array | Error,
  token,
  chunks = 4,
  contentLength = null as number | null,
  failAfter,
  hold = false,
  offer = null,
}: {
  list?: unknown;
  zip?: Uint8Array | Error;
  token?: string;
  chunks?: number;
  contentLength?: number | null;
  failAfter?: number;
  hold?: boolean;
  /** The update check's offer, for Update; a PR build install never asks it. */
  offer?: PluginUpdateOffer | null;
} = {}): Engine {
  const asked: Engine["asked"] = [];
  const recorded: string[] = [];
  const channelWrites: string[] = [];
  const progress: Progress[] = [];
  let started!: () => void;
  const downloading = new Promise<void>((resolve) => {
    started = resolve;
  });
  const net = {
    async getJson<T>(url: string): Promise<T> {
      asked.push({ url });
      if (list instanceof Error) throw list;
      return structuredClone(list) as T;
    },
    async downloadToFile(url: string, destination: string, options?: DownloadOptions): Promise<number> {
      asked.push({ url, headers: options?.headers });
      if (zip instanceof Error) throw zip;
      const size = Math.ceil(zip.length / chunks);
      let received = 0;
      for (let i = 0; i < chunks; i++) {
        if (failAfter === i) {
          throw new NetworkError("connection reset");
        }
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
  const check = {
    forStaging: async () => {
      if (offer === null) throw new Error("a PR build install never asks the update check");
      // The stored answer's zip URL is never what a PR channel offer stages.
      return { status: "available" as const, offer, downloadUrl: "https://evil.example/WoWDeck.zip" };
    },
    recordStagedVersion: (version: string) => {
      recorded.push(version);
    },
  };
  const pluginUpdate = {
    setChannel: async (channel: string) => {
      channelWrites.push(channel);
    },
  };
  const deps = {
    prBuilds: new PrBuildList(net, INDEX_URL),
    updateStager: new UpdateStager(net, check, token ? () => token : undefined, ROOT, (p) => progress.push(p), new PrBuildList(net, INDEX_URL)),
    pluginUpdate,
  } as unknown as HandlerDeps;
  const call = async (method: string, params: unknown) => {
    let response: { result?: unknown; error?: unknown } = {};
    const rpc = new JsonlServer((line) => {
      response = JSON.parse(line);
    });
    register(rpc, deps);
    await rpc.handleLine(JSON.stringify({ id: 1, method, params }));
    return response;
  };
  return {
    install: (params) => call("system.installPrBuild", params),
    update: () => call("system.updateStage", {}),
    cancel: () => call("system.cancelDownload", {}),
    downloading,
    progress,
    asked,
    recorded,
    channelWrites,
  };
}

const staged = () => (existsSync(ROOT) ? readdirSync(ROOT) : []);

afterEach(() => {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(ROOT, { recursive: true });
});

describe("installing a PR build (system.installPrBuild)", () => {
  test("downloads the listed zip, checks its sha256 and stages it for Decky's installer", async () => {
    mkdirSync(ROOT, { recursive: true });
    const e = engine();

    const response = await e.install({ number: 117, version: "1.1.2-pr.117.2" });

    const path = join(ROOT, "wowdeck-update-1.1.2-pr.117.2.zip");
    expect(response.result).toEqual({
      result: {
        artifact: `file://${path}`,
        version: "1.1.2-pr.117.2",
        sha256: sha256(pluginZip("1.1.2-pr.117.2")),
      },
      error: null,
    });
    expect(e.asked.map((a) => a.url)).toEqual([INDEX_URL, ZIP_URL]);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(e.recorded).toEqual(["1.1.2-pr.117.2"]);
  });

  test("a zip that doesn't match the published sha256 is refused, and nothing is staged", async () => {
    const e = engine({ zip: pluginZip("1.1.2-pr.117") });

    const response = await e.install({ number: 117, version: "1.1.2-pr.117.2" });

    expect(response.result).toEqual({
      result: null,
      error: {
        code: "checksum_mismatch",
        message: "The download doesn't match the published PR build, so it wasn't installed",
      },
    });
    expect(staged()).toEqual([]);
    expect(e.recorded).toEqual([]);
  });

  test("a package that isn't WoWDeck at the listed version is refused, even with a matching sha256", async () => {
    const other = pluginZip("1.1.2-pr.118");
    const e = engine({ list: { builds: [entry117({ sha256: sha256(other) })] }, zip: other });

    const response = (await e.install({ number: 117, version: "1.1.2-pr.117.2" })) as {
      result: MethodMap["system.installPrBuild"]["result"];
    };

    expect(response.result.result).toBeNull();
    expect(response.result.error?.code).toBe("archive_invalid");
    expect(staged()).toEqual([]);
    expect(e.recorded).toEqual([]);
  });

  test("Pages gets no GitHub token, even when one is set", async () => {
    const e = engine({ token: "ghp_secret" });

    await e.install({ number: 117, version: "1.1.2-pr.117.2" });

    const zipAsk = e.asked.find((a) => a.url === ZIP_URL)!;
    expect(zipAsk.headers?.Authorization).toBeUndefined();
  });

  test("a download that fails stages nothing", async () => {
    const e = engine({ zip: new NetworkError("request to Pages failed", 503) });

    const response = (await e.install({ number: 117, version: "1.1.2-pr.117.2" })) as {
      result: MethodMap["system.installPrBuild"]["result"];
    };

    expect(response.result.error?.code).toBe("download_failed");
    expect(staged()).toEqual([]);
    expect(e.recorded).toEqual([]);
  });

  test.each([
    ["the PR left the list", { builds: [] }],
    ["the PR was rebuilt since the owner confirmed", { builds: [entry117({ version: "1.1.2-pr.117.3" })] }],
  ])("refused when %s: nothing is downloaded", async (_name, list) => {
    const e = engine({ list });

    const response = (await e.install({ number: 117, version: "1.1.2-pr.117.2" })) as {
      result: MethodMap["system.installPrBuild"]["result"];
    };

    expect(response.result.result).toBeNull();
    expect(response.result.error?.code).toBe("not_listed");
    expect(e.asked.map((a) => a.url)).toEqual([INDEX_URL]);
  });

  test("a list that couldn't load is refused, not an RPC error", async () => {
    const e = engine({ list: new NetworkError("offline") });

    const response = (await e.install({ number: 117, version: "1.1.2-pr.117.2" })) as {
      error?: unknown;
      result: MethodMap["system.installPrBuild"]["result"];
    };

    expect(response.error).toBeUndefined();
    expect(response.result.error?.code).toBe("list_unavailable");
    expect(staged()).toEqual([]);
  });

  test("installing, or failing to, never stores an update channel", async () => {
    const ok = engine();
    const refused = engine({ zip: pluginZip("1.1.2-pr.117") });

    await ok.install({ number: 117, version: "1.1.2-pr.117.2" });
    await refused.install({ number: 117, version: "1.1.2-pr.117.2" });

    expect(ok.channelWrites).toEqual([]);
    expect(refused.channelWrites).toEqual([]);
  });

  test("reports the download's bytes in order, against the list's zip size", async () => {
    const zip = pluginZip("1.1.2-pr.117.2");
    const e = engine({ list: { builds: [entry117({ zipSize: zip.length })] }, contentLength: 999_999 });

    const response = (await e.install({ number: 117, version: "1.1.2-pr.117.2" })) as {
      result: MethodMap["system.installPrBuild"]["result"];
    };

    expect(response.result.error).toBeNull();
    const version = "1.1.2-pr.117.2";
    expect(e.progress[0]).toEqual({ version, received: 0, total: zip.length });
    expect(e.progress.at(-1)).toEqual({ version, received: zip.length, total: zip.length });
    const received = e.progress.map((p) => p.received);
    expect(received).toEqual([...received].sort((a, b) => a - b));
    expect(e.progress.every((p) => p.total === zip.length)).toBe(true);
  });

  test("Cancel aborts the download: the partial file is deleted, nothing is staged, and it answers cancelled", async () => {
    const e = engine({ hold: true });

    const installing = e.install({ number: 117, version: "1.1.2-pr.117.2" });
    await e.downloading;
    expect(staged()).toEqual(["wowdeck-update-1.1.2-pr.117.2.zip"]);
    const cancel = await e.cancel();
    const response = (await installing) as { result: MethodMap["system.installPrBuild"]["result"] };

    expect(cancel.result).toEqual({ cancelled: true });
    expect(response.result.result).toBeNull();
    expect(response.result.error?.code).toBe("cancelled");
    expect(staged()).toEqual([]);
    expect(e.recorded).toEqual([]);
  });

  test("Cancel with no download in flight changes nothing", async () => {
    const e = engine();

    expect((await e.cancel()).result).toEqual({ cancelled: false });
    const response = (await e.install({ number: 117, version: "1.1.2-pr.117.2" })) as {
      result: MethodMap["system.installPrBuild"]["result"];
    };
    expect((await e.cancel()).result).toEqual({ cancelled: false });

    expect(response.result.error).toBeNull();
    expect(e.recorded).toEqual(["1.1.2-pr.117.2"]);
  });

  test("a download that fails partway answers download_failed and leaves no partial file", async () => {
    const e = engine({ failAfter: 2 });

    const response = (await e.install({ number: 117, version: "1.1.2-pr.117.2" })) as {
      result: MethodMap["system.installPrBuild"]["result"];
    };

    expect(response.result.error?.code).toBe("download_failed");
    expect(staged()).toEqual([]);
  });
});

describe("Update on the PR channel (system.updateStage with a prUpdate offer)", () => {
  const prUpdate = (version: string): PluginUpdateOffer => ({
    kind: "prUpdate",
    version,
    headline: "PR #117 has a newer build",
    buttonLabel: `Update to ${version}`,
    toastBody: "Update in Options",
    rowLabel: "PR #117 has a newer build",
    releaseNotes: null,
    releaseUrl: "https://github.com/sigboe/wowdeck/pull/117",
    installable: true,
  });

  test("stages the newer PR build through the PR build path: list read again, sha256 checked", async () => {
    mkdirSync(ROOT, { recursive: true });
    const e = engine({ offer: prUpdate("1.1.2-pr.117.2") });

    const response = await e.update();

    expect(response.result).toEqual({
      result: {
        artifact: `file://${join(ROOT, "wowdeck-update-1.1.2-pr.117.2.zip")}`,
        version: "1.1.2-pr.117.2",
        sha256: sha256(pluginZip("1.1.2-pr.117.2")),
      },
      error: null,
    });
    expect(e.asked.map((a) => a.url)).toEqual([INDEX_URL, ZIP_URL]);
    expect(e.recorded).toEqual(["1.1.2-pr.117.2"]);
  });

  test("PR channel updates report progress and cancel without staging a partial zip", async () => {
    const zip = pluginZip("1.1.2-pr.117.2");
    const e = engine({
      offer: prUpdate("1.1.2-pr.117.2"),
      list: { builds: [entry117({ zipSize: zip.length })] },
      hold: true,
    });

    const updating = e.update();
    await e.downloading;
    expect(e.progress[0]).toEqual({ version: "1.1.2-pr.117.2", received: 0, total: zip.length });
    expect(e.progress.at(-1)!.received).toBeGreaterThan(0);
    expect((await e.cancel()).result).toEqual({ cancelled: true });
    const response = (await updating) as { result: MethodMap["system.updateStage"]["result"] };
    expect(response.result.error?.code).toBe("cancelled");
    expect(response.result.result).toBeNull();
    expect(staged()).toEqual([]);
    expect(e.recorded).toEqual([]);
  });

  test("a PR rebuilt since the offer stages nothing: the offered version is pinned", async () => {
    const e = engine({ offer: prUpdate("1.1.2-pr.117.2"), list: { builds: [entry117({ version: "1.1.2-pr.117.3" })] } });

    const response = (await e.update()) as { result: MethodMap["system.updateStage"]["result"] };

    expect(response.result.error?.code).toBe("not_listed");
    expect(e.asked.map((a) => a.url)).toEqual([INDEX_URL]);
    expect(staged()).toEqual([]);
  });

  test("a zip that doesn't match the published sha256 is refused", async () => {
    const e = engine({ offer: prUpdate("1.1.2-pr.117.2"), zip: pluginZip("1.1.2-pr.117") });

    const response = (await e.update()) as { result: MethodMap["system.updateStage"]["result"] };

    expect(response.result.error?.code).toBe("checksum_mismatch");
    expect(staged()).toEqual([]);
  });
});
