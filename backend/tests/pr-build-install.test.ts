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
import type { MethodMap } from "../src/api/contracts";
import { register } from "../src/api/handlers/system";
import { JsonlServer } from "../src/bridge/jsonl";
import { NetworkError } from "../src/wow/net/network";
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

interface Engine {
  install(params: MethodMap["system.installPrBuild"]["params"]): Promise<{ result?: unknown; error?: unknown }>;
  /** Every URL the engine asked, list and zip alike, with the zip's request headers. */
  asked: { url: string; headers?: Record<string, string> }[];
  /** Versions the engine recorded as staged for Decky. */
  recorded: string[];
  /** The update channel the engine was asked to store, if any. */
  channelWrites: string[];
}

function engine({
  list = { builds: [entry117()] } as unknown,
  zip = pluginZip("1.1.2-pr.117.2") as Uint8Array | Error,
  token,
}: { list?: unknown; zip?: Uint8Array | Error; token?: string } = {}): Engine {
  const asked: Engine["asked"] = [];
  const recorded: string[] = [];
  const channelWrites: string[] = [];
  const net = {
    async getJson<T>(url: string): Promise<T> {
      asked.push({ url });
      if (list instanceof Error) throw list;
      return structuredClone(list) as T;
    },
    async downloadToFile(
      url: string,
      destination: string,
      options?: { headers?: Record<string, string> },
    ): Promise<number> {
      asked.push({ url, headers: options?.headers });
      if (zip instanceof Error) throw zip;
      writeFileSync(destination, zip);
      return zip.length;
    },
  };
  const check = {
    forStaging: async () => {
      throw new Error("a PR build install never asks the update check");
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
    updateStager: new UpdateStager(net, check, token ? () => token : undefined, ROOT),
    pluginUpdate,
  } as unknown as HandlerDeps;
  return {
    async install(params) {
      let response: { result?: unknown; error?: unknown } = {};
      const rpc = new JsonlServer((line) => {
        response = JSON.parse(line);
      });
      register(rpc, deps);
      await rpc.handleLine(JSON.stringify({ id: 1, method: "system.installPrBuild", params }));
      return response;
    },
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
});
