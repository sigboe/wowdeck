/**
 * Full-stack integration test: spawns the compiled engine binary and drives
 * the JSONL protocol end-to-end against a local mock provider hub.
 * Deterministic: no external network access.
 *
 * Flow: getStatus -> detect installations -> select -> list -> search ->
 * install -> list (update detection after new release) -> updateAll ->
 * remove.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";
import { zipSync } from "fflate";

const BIN = join(import.meta.dir, "..", "..", "out", "wowdeck");
const ROOT = "/tmp/opencode/wowdeck-tests/integration";

interface Release {
  version: string;
  releaseId: string;
}

const catalog: Record<string, { name: string; folders: string[]; releases: Release[] }> = {
  "2791": {
    name: "MockAddon",
    folders: ["MockAddon", "MockLib"],
    releases: [
      { version: "1.0.0", releaseId: "r1" },
      { version: "1.1.0", releaseId: "r2" },
    ],
  },
};

function hubResponseFor(pathname: string, _search: URLSearchParams): unknown {
  if (pathname === "/addons/search/retail") {
    return {
      addons: Object.entries(catalog).map(([id, a]) => representation(id, a)),
      count: 1,
    };
  }
  const idMatch = pathname.match(/^\/addons\/(\d+)$/);
  if (idMatch) {
    const id = idMatch[1]!;
    return { addon: representation(id, catalog[id]!) };
  }
  if (pathname === "/addons/batch/retail") {
    return { addons: Object.entries(catalog).map(([id, a]) => representation(id, a)) };
  }
  if (pathname === "/addons/fingerprint") {
    return { exactMatches: [] };
  }
  return {};
}

function representation(id: string, entry: { name: string; folders: string[]; releases: Release[] }) {
  return {
    id: Number(id),
    repository: `https://github.com/mock/${entry.name}`,
    repository_name: entry.name,
    source: "GitHub",
    owner_name: "MockOwner",
    description: "A mock addon",
    total_download_count: 42,
    releases: entry.releases.map((r) => ({
      id: Number(r.releaseId.slice(1)),
      url: `https://github.com/mock/${entry.name}/releases/v${r.version}`,
      name: `v${r.version}`,
      tag_name: `v${r.version}`,
      external_id: r.releaseId,
      prerelease: false,
      body: "changelog text",
      game_versions: [
        {
          interface: "110005",
          title: entry.name,
          game_type: "retail",
          version: r.version,
          authors: "MockOwner",
        },
      ],
      toc_title: entry.name,
      download_url: `http://127.0.0.1:${port}/download/${id}/${r.releaseId}`,
      published_at: "2026-01-01T00:00:00Z",
      addonFolders: entry.folders.map((f, i) => ({ id: i, folder_name: f, fingerprint: `fp-${id}-${r.releaseId}-${f}` })),
    })),
  };
}

let port = 0;
let cfPort = 0;
let hubServer: ReturnType<typeof Bun.serve> | undefined;
let cfServer: ReturnType<typeof Bun.serve> | undefined;
let engine: Bun.Subprocess<"pipe"> | undefined;
let nextId = 0;
const pending = new Map<number, (value: any) => void>();
const events: any[] = [];
let cfSeenAuth: string[] = [];
/** What the mock /releases/latest answers, and the Authorization headers it saw. */
let releasesLatest: { body?: unknown; status?: number } = {};
let releasesSeenAuth: (string | null)[] = [];
/** What the mock releases list (the Beta channel's source) answers. */
let releasesList: unknown[] = [];
/** What the mock /wowdeck-asset route serves (the staged-update zip). */
let releasesAsset: Uint8Array = new Uint8Array();

const cfCatalog: Record<string, { id: number; name: string; folders: string[]; versions: string[] }> = {
  "7777": { id: 7777, name: "CfMockAddon", folders: ["CfMockAddon"], versions: ["2.0.0", "2.1.0"] },
};

function cfAddonJson(id: string, version: string) {
  const entry = cfCatalog[id]!;
  const fileId = 1000 + entry.versions.indexOf(version);
  return {
    id: entry.id,
    name: entry.name,
    slug: "cfmockaddon",
    summary: "A curseforge mock",
    downloadCount: 5000,
    links: { websiteUrl: "https://www.curseforge.com/wow/addons/cfmockaddon" },
    logo: { thumbnailUrl: "https://img.example/cf.png" },
    authors: [{ id: 1, name: "CfAuthor" }],
    latestFiles: [
      {
        id: fileId,
        displayName: version,
        downloadUrl: `http://127.0.0.1:${cfPort}/cf-download/${id}/${version}`,
        fileDate: "2026-09-02T00:00:00.000Z",
        releaseType: 1,
        gameVersions: ["11.0.2"],
        sortableGameVersions: [{ gameVersionTypeId: 517, name: "Retail" }],
        modules: entry.folders.map((f) => ({ foldername: f, name: f })),
      },
    ],
  };
}

function send(method: string, params: Record<string, unknown> = {}): Promise<any> {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    pending.set(id, resolve);
    const line = JSON.stringify({ id, method, params }) + "\n";
    engine!.stdin.write(line);
    setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), 15_000);
  });
}

beforeAll(async () => {
  rmSync(ROOT, { recursive: true, force: true });

  // mock hub
  hubServer = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const dl = url.pathname.match(/^\/download\/(\d+)\/(r\d+)$/);
      if (dl) {
        const entry = catalog[dl[1]!]!;
        const release = entry.releases.find((r) => r.releaseId === dl[2])!;
        const files: Record<string, Uint8Array> = {};
        for (const folder of entry.folders) {
          files[`${folder}/${folder}.toc`] = new TextEncoder().encode(
            `## Title: ${entry.name}\n## Version: ${release.version}\n## Interface: 110005\n## Author: MockOwner\n`,
          );
          files[`${folder}/init.lua`] = new TextEncoder().encode(`-- ${release.version}\n`);
        }
        return new Response(Buffer.from(zipSync(files)));
      }
      if (url.pathname === "/releases/latest") {
        releasesSeenAuth.push(req.headers.get("authorization"));
        if (releasesLatest.status !== undefined) {
          return new Response(null, { status: releasesLatest.status });
        }
        return Response.json(releasesLatest.body);
      }
      if (url.pathname === "/releases") {
        releasesSeenAuth.push(req.headers.get("authorization"));
        return Response.json(releasesList);
      }
      if (url.pathname === "/wowdeck-asset") {
        return new Response(releasesAsset);
      }
      if (req.method === "POST" && req.body) {
        await req.json(); // consume
      }
      return Response.json(hubResponseFor(url.pathname, url.searchParams));
    },
  });
  port = hubServer!.port!;

  // mock CurseForge Core API
  cfSeenAuth = [];
  releasesSeenAuth = [];
  // The default answers the engine's own version, so the every-method
  // probe's system.updateCheck stays a harmless "current" (and stores that
  // answer for the day).
  const pkgVersion = JSON.parse(readFileSync(join(import.meta.dir, "..", "..", "package.json"), "utf-8")).version;
  releasesLatest = {
    body: { tag_name: `v${pkgVersion}`, html_url: `https://github.com/sigboe/wowdeck/releases/tag/v${pkgVersion}` },
  };
  cfServer = Bun.serve({
    port: 0,
    async fetch(req) {
      cfSeenAuth.push(req.headers.get("x-api-key") ?? "");
      const url = new URL(req.url);
      const dl = url.pathname.match(/^\/cf-download\/(\d+)\/([\d.]+)$/);
      if (dl) {
        const entry = cfCatalog[dl[1]!]!;
        const files: Record<string, Uint8Array> = {};
        for (const folder of entry.folders) {
          files[`${folder}/${folder}.toc`] = new TextEncoder().encode(
            `## Title: ${entry.name}\n## Version: ${dl[2]}\n## Interface: 110005\n## X-Curse-Project-ID: ${dl[1]}\n`,
          );
        }
        return new Response(Buffer.from(zipSync(files)));
      }
      if (url.pathname === "/v1/games") {
        const key = req.headers.get("x-api-key") ?? "";
        const uuidShaped = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key);
        if (uuidShaped) {
          return new Response(null, { status: 403 });
        }
        return Response.json({ data: [] });
      }
      if (url.pathname === "/v1/mods/search") {
        return Response.json({ data: [cfAddonJson("7777", "2.1.0")] });
      }
      if (url.pathname === "/v1/mods/7777") {
        return Response.json({ data: cfAddonJson("7777", "2.1.0") });
      }
      if (url.pathname === "/v1/mods" && req.method === "POST") {
        return Response.json({ data: [cfAddonJson("7777", "2.1.0")] });
      }
      return Response.json({ data: [] });
    },
  });
  cfPort = cfServer!.port!;

  // fake WoW install under fake home. Real layout: `.build.info` is
  // shared, pipe-delimited, in the WoW root (not the flavor dir), and
  // matched by Product via the flavor's own `.flavor.info`. See
  // docs/wow-client-identity.md.
  const wowRoot = join(ROOT, "home/Applications/World of Warcraft");
  const addonsPath = join(wowRoot, "_retail_/Interface/AddOns");
  mkdirSync(addonsPath, { recursive: true });
  writeFileSync(join(wowRoot, "_retail_", ".flavor.info"), "Product Flavor!STRING:0\nwow\n");
  writeFileSync(join(wowRoot, ".build.info"), "Product!STRING:0|Version!STRING:0\nwow|11.0.2\n");

  engine = Bun.spawn([BIN], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      HOME: join(ROOT, "home"),
      WOWDECK_DATA_DIR: join(ROOT, "data"),
      WOWDECK_HUB_URL: `http://127.0.0.1:${port}`,
      WOWDECK_RELEASES_URL: `http://127.0.0.1:${port}/releases/latest`,
      WOWDECK_CF_URL: `http://127.0.0.1:${cfPort}/v1`,
    },
  });

  // reader loop
  (async () => {
    const reader = (engine!.stdout as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value);
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        const msg = JSON.parse(line);
        if (msg.id !== undefined && pending.has(msg.id)) {
          pending.get(msg.id)!(msg);
          pending.delete(msg.id);
        } else if (msg.event) {
          events.push(msg);
        }
      }
    }
  })();
});

afterAll(() => {
  engine?.kill();
  hubServer?.stop(true);
  cfServer?.stop(true);
  if (!process.env.WOWDECK_TEST_KEEP) {
    rmSync(ROOT, { recursive: true, force: true });
  }
});

describe("engine JSONL integration", () => {
  test("system.getStatus", async () => {
    const res = await send("system.getStatus");
    expect(res.result.protocolVersion).toBe(1);
    expect(res.result.pid).toBeGreaterThan(0);
  });

  test("installations.detect finds the fake WoW", async () => {
    const res = await send("installations.detect");
    const installs = res.result.installations;
    expect(installs).toHaveLength(1);
    expect(installs[0].gameType).toBe("retail");
    expect(installs[0].version).toBe("11.0.2");
  });

  test("installations.select and addons.list (empty)", async () => {
    const sel = await send("installations.select", { installationId: (await send("installations.list")).result.installations[0].id });
    expect(sel.result.installation).not.toBeNull();

    const res = await send("addons.list");
    expect(res.result.addons).toEqual([]);
  });

  test("addons.search returns mock hub results", async () => {
    const res = await send("addons.search", { query: "mock" });
    expect(res.result.results.length).toBeGreaterThan(0);
    expect(res.result.results[0].providerId).toBe("WowUpHub");
    expect(res.result.results[0].latestVersion).toBe("1.1.0");
  });

  test("addons.install downloads and installs folders", async () => {
    const res = await send("addons.install", { providerId: "WowUpHub", externalId: "2791" });
    expect(res.result.operation.status).toBe("installed");
    expect(res.result.addon.version).toBe("1.1.0");

    const addonsPath = join(ROOT, "home/Applications/World of Warcraft/_retail_/Interface/AddOns");
    expect(existsSync(join(addonsPath, "MockAddon", "MockAddon.toc"))).toBe(true);
    expect(existsSync(join(addonsPath, "MockLib", "MockLib.toc"))).toBe(true);
    expect(readFileSync(join(addonsPath, "MockAddon", "init.lua"), "utf-8")).toContain("1.1.0");

    // progress events were emitted
    const progressEvents = events.filter((e) => e.event === "operation.progress");
    expect(progressEvents.length).toBeGreaterThan(0);
    expect(progressEvents.some((e) => e.params.progress.phase === "download")).toBe(true);
    expect(events.some((e) => e.event === "operation.completed")).toBe(true);
  });

  test("installed addon listed as managed, no update", async () => {
    const res = await send("addons.list");
    const addon = res.result.addons.find((a: any) => a.name === "MockAddon");
    expect(addon).toBeDefined();
    expect(addon.providerId).toBe("WowUpHub");
    expect(addon.updateAvailable).toBe(false);
  });

  test("new release triggers update flow via updateAll", async () => {
    // provider publishes r3
    catalog["2791"]!.releases.push({ version: "1.2.0", releaseId: "r3" });

    await send("addons.refresh");
    let res = await send("addons.list");
    const addon = res.result.addons.find((a: any) => a.name === "MockAddon");
    expect(addon.updateAvailable).toBe(true);
    expect(addon.availableVersion).toBe("1.2.0");

    const upd = await send("addons.updateAll");
    expect(upd.result.operations).toHaveLength(1);
    expect(upd.result.operations[0].status).toBe("updated");

    res = await send("addons.list");
    const updated = res.result.addons.find((a: any) => a.name === "MockAddon");
    expect(updated.updateAvailable).toBe(false);
    expect(updated.version).toBe("1.2.0");
  });

  test("addons.remove deletes folders and record", async () => {
    const list = await send("addons.list");
    const addon = list.result.addons.find((a: any) => a.name === "MockAddon");

    const res = await send("addons.remove", { addonId: addon.id });
    expect(res.result.operation.status).toBe("removed");

    const addonsPath = join(ROOT, "home/Applications/World of Warcraft/_retail_/Interface/AddOns");
    expect(existsSync(join(addonsPath, "MockAddon"))).toBe(false);
    expect(existsSync(join(addonsPath, "MockLib"))).toBe(false);
  });

  test("addons.removeUnmanaged deletes a loose folder without a managed record", async () => {
    const addonsPath = join(ROOT, "home/Applications/World of Warcraft/_retail_/Interface/AddOns");
    mkdirSync(join(addonsPath, "LooseUnmanaged"), { recursive: true });
    writeFileSync(
      join(addonsPath, "LooseUnmanaged", "LooseUnmanaged.toc"),
      "## Title: Loose\n## Version: 0.1\n",
    );

    const before = await send("addons.list");
    expect(before.result.addons.some((a: any) => a.folderName === "LooseUnmanaged")).toBe(true);

    const res = await send("addons.removeUnmanaged", { folderName: "LooseUnmanaged" });
    expect(res.result.operation.status).toBe("removed");
    expect(existsSync(join(addonsPath, "LooseUnmanaged"))).toBe(false);

    const after = await send("addons.list");
    expect(after.result.addons.some((a: any) => a.folderName === "LooseUnmanaged")).toBe(false);
  });

  test("addons.removeUnmanaged refuses a path-traversal-shaped name", async () => {
    const res = await send("addons.removeUnmanaged", { folderName: "../escape" });
    expect(res.error.code).toBe("invalid_request");
  });

  test("unknown method returns structured error", async () => {
    const res = await send("nope.nothing");
    expect(res.error.code).toBe("method_not_found");
  });
});

describe("CurseForge end-to-end", () => {
  test("unconfigured Curse is disabled; setting the key enables it", async () => {
    let providers = (await send("providers.list")).result.providers;
    const curse = providers.find((p: any) => p.id === "Curse");
    expect(curse.enabled).toBe(false);
    expect(curse.configured).toBe(false);

    const setResult = await send("settings.set", { settings: { curseApiKey: "int-test-key" } });
    providers = (await send("providers.list")).result.providers;
    const enabled = providers.find((p: any) => p.id === "Curse");
    expect(enabled.enabled).toBe(true);
    expect(enabled.configured).toBe(true);

    // The key is write-only over the wire — neither settings.set's own
    // response nor a follow-up settings.get ever echoes the raw value.
    expect(setResult.result.settings.curseApiKey).not.toBe("int-test-key");
    const getResult = await send("settings.get");
    expect(getResult.result.settings.curseApiKey).not.toBe("int-test-key");
    expect(getResult.result.settings.curseApiKey).not.toBeNull();
  });

  test("providers.testApiKey validates keys with feedback", async () => {
    const uuid = await send("providers.testApiKey", { providerId: "Curse", apiKey: "c7b31234-5678-4abc-9def-0123456789ab" });
    expect(uuid.result.ok).toBe(false);
    expect(uuid.result.message).toMatch(/key/i);

    const good = await send("providers.testApiKey", { providerId: "Curse", apiKey: "valid-shape-key" });
    expect(good.result.ok).toBe(true);

    const empty = await send("providers.testApiKey", { providerId: "Curse", apiKey: "" });
    expect(empty.result.ok).toBe(false);
    expect(empty.result.message).toMatch(/no API key/i);
  });

  test("search and install via CurseForge carry the API key", async () => {
    cfSeenAuth = []; // only requests from this test
    const res = await send("addons.search", { query: "cfmock" });
    const cf = res.result.results.find((r: any) => r.providerId === "Curse");
    expect(cf).toBeDefined();
    expect(cf.name).toBe("CfMockAddon");

    const install = await send("addons.install", { providerId: "Curse", externalId: "7777" });
    expect(install.result.operation.status).toBe("installed");
    expect(install.result.addon.version).toBe("2.1.0");

    const addonsPath = join(ROOT, "home/Applications/World of Warcraft/_retail_/Interface/AddOns");
    expect(existsSync(join(addonsPath, "CfMockAddon", "CfMockAddon.toc"))).toBe(true);

    // every CurseForge request (metadata + download) carried the key
    expect(cfSeenAuth.length).toBeGreaterThan(0);
    expect(cfSeenAuth.every((k) => k === "int-test-key")).toBe(true);
  });

  // End-to-end through the real compiled binary, not just the
  // provider unit tests.
  test("discover.latest and discover.popular return results with pagination", async () => {
    const latest = await send("discover.latest", { providerId: "Curse", index: 0, pageSize: 5 });
    expect(latest.result.results.length).toBeGreaterThan(0);
    expect(typeof latest.result.totalCount).toBe("number");

    const popular = await send("discover.popular", { providerId: "Curse", index: 0, pageSize: 5 });
    expect(popular.result.results.length).toBeGreaterThan(0);
  });
});

describe("Discover unavailable without CurseForge", () => {
  test("discover.* fails clearly once the CurseForge key is cleared", async () => {
    // an earlier test in this file configured a key; clear it to exercise
    // the "not available" path rather than relying on fresh-engine state.
    await send("settings.set", { settings: { curseApiKey: null } });
    const res = await send("discover.latest", { providerId: "Curse", index: 0, pageSize: 5 });
    expect(res.error).toBeDefined();
  });
});

// RF-07: what settings.set stores for each key, through the real binary.
describe("settings.set, key by key", () => {
  async function set(settings: Record<string, unknown>) {
    const res = await send("settings.set", { settings });
    if (res.error) {
      return { error: res.error.code as string };
    }
    return res.result.settings as Record<string, unknown>;
  }

  test("the toggles store only a real true as true", async () => {
    for (const key of ["steamAutoCheck", "steamBadge", "hideLibraries", "hideUnmanaged", "keepPreviousVersions", "autoUpdate"]) {
      expect((await set({ [key]: true }))[key]).toBe(true);
      expect((await set({ [key]: "false" }))[key]).toBe(false);
      expect((await set({ [key]: 1 }))[key]).toBe(false);
    }
  });

  test("updateToastEnabled is a toggle too", async () => {
    expect((await set({ updateToastEnabled: true })).updateToastEnabled).toBe(true);
    expect((await set({ updateToastEnabled: "false" })).updateToastEnabled).toBe(TOAST_FROM_STRING);
    await set({ updateToastEnabled: true });
  });

  test("safety backups to keep: 1 to 10, anything else is 3", async () => {
    expect((await set({ wtfKeepSnapshots: 5 })).wtfKeepSnapshots).toBe(5);
    expect((await set({ wtfKeepSnapshots: 11 })).wtfKeepSnapshots).toBe(10);
    expect((await set({ wtfKeepSnapshots: 0 })).wtfKeepSnapshots).toBe(3);
    expect((await set({ wtfKeepSnapshots: "x" })).wtfKeepSnapshots).toBe(3);
    expect((await set({ wtfKeepSnapshots: 2.6 })).wtfKeepSnapshots).toBe(3);
  });

  test("backup folder: validated, or back to the plugin's own folder", async () => {
    const dir = join(ROOT, "backups-here");
    mkdirSync(dir, { recursive: true });
    expect((await set({ wtfBackupDir: dir })).wtfBackupDir).toBe(dir);
    expect(await set({ wtfBackupDir: "relative/path" })).toEqual({ error: "backup_dir_invalid" });
    expect(await set({ wtfBackupDir: join(ROOT, "no-such-dir") })).toEqual({ error: "backup_dir_unavailable" });
    expect((await set({ wtfBackupDir: "" })).wtfBackupDir).toBeNull();
  });

  test("the Steam game is normalized", async () => {
    expect((await set({ steamGame: { appId: 42, name: "  World of Warcraft " } })).steamGame).toEqual({
      appId: 42,
      name: "World of Warcraft",
    });
    expect((await set({ steamGame: { appId: "42", name: "x" } })).steamGame).toBeNull();
  });

  test("engine-owned keys are never taken from the UI", async () => {
    const before = await set({});
    const after = await set({
      lastAutoUpdate: { at: 1, updated: ["x"], failed: [], skipped: null },
      newlyUpdatedHours: 1,
      pluginUpdateToastShownFor: "9.9.9",
    });
    expect(after.lastAutoUpdate).toEqual(before.lastAutoUpdate);
    expect(after.newlyUpdatedHours).toEqual(before.newlyUpdatedHours);
    expect(after.pluginUpdateToastShownFor).toEqual(before.pluginUpdateToastShownFor);
  });

  test("keys the UI never writes", async () => {
    const after = await set({ lastUpdateCheckAt: 123 });
    expect(after.lastUpdateCheckAt).toBe(OTHER_KEYS_STORED ? 123 : null);
  });

  test("keys are redacted on the way out", async () => {
    const after = await set({ githubAccessToken: "ghp_secret" });
    expect(after.githubAccessToken).toBe("<configured>");
    expect((await set({ githubAccessToken: null })).githubAccessToken).toBeNull();
  });
});

// RF-07 changed these two: a string "false" was stored as is, and keys Options
// never writes were accepted.
const TOAST_FROM_STRING: unknown = false;
const OTHER_KEYS_STORED = false;

// RF-14: the handler split must keep every declared method served.
describe("every declared method has a handler", () => {
  test("no MethodMap key answers method_not_found", async () => {
    const src = readFileSync(join(import.meta.dir, "..", "..", "src", "api", "contracts.ts"), "utf-8");
    const block = src.slice(src.indexOf("export interface MethodMap {"), src.indexOf("export type MethodName"));
    const methods = [...block.matchAll(/^ {2}"([a-zA-Z]+\.[a-zA-Z]+)": \{/gm)].map((m) => m[1]!);
    expect(methods.length).toBeGreaterThan(40);
    // Methods that would change this run's state are probed with params that
    // fail validation, so only "is there a handler" is asked.
    const unanswered: string[] = [];
    for (const method of methods) {
      const res = await send(method, { installationId: "nope", addonId: "nope", jobId: "nope", fileName: "../x", providerId: "nope" });
      if (res.error?.code === "method_not_found") {
        unanswered.push(method);
      }
    }
    expect(unanswered).toEqual([]);
  });
});

describe("Install from URL error codes", () => {
  test("a bad URL is invalid input; an unknown repository is not found or a provider code", async () => {
    const bad = await send("addons.resolveUrlImport", { url: "not a url" });
    expect(bad.result.result).toBeNull();
    expect(bad.result.error.code).toBe(URL_INVALID_CODE);
  });
});

describe("Manual Install's From a file (addons.inspectArchive)", () => {
  test("previews a picked archive in the envelope, and a missing file is its own code", async () => {
    const dir = join(ROOT, "archives");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "Foo-1.2.zip"),
      zipSync({
        "Foo/Foo.toc": new TextEncoder().encode("## Interface: 110005\n## Title: Foo Addon\n## Version: 1.2\n"),
      }),
    );
    const path = realpathSync(join(dir, "Foo-1.2.zip"));
    const ok = await send("addons.inspectArchive", { path });
    expect(ok.result.error).toBeNull();
    expect(ok.result.result).toMatchObject({
      fileName: "Foo-1.2.zip",
      name: "Foo Addon",
      version: "1.2",
      folders: ["Foo"],
      providerId: "File",
      externalId: path,
    });
    const missing = await send("addons.inspectArchive", { path: join(dir, "gone.zip") });
    expect(missing.result.result).toBeNull();
    expect(missing.result.error.code).toBe("archive_unreadable");
  });
});

// RF-14: the bridge's one errorCodeFor (the handler used its own "invalid_input").
const URL_INVALID_CODE = "invalid_request";

describe("engine version (RF-15)", () => {
  test("system.getStatus reports backend/package.json's version", async () => {
    const { version } = JSON.parse(readFileSync(join(import.meta.dir, "..", "..", "package.json"), "utf-8"));
    const res = await send("system.getStatus", {});
    expect(res.result.backendVersion).toBe(version);
  });
});

describe("system.updateCheck (the plugin's own update notice)", () => {
  // Each scenario spawns its own engine process with its own data dir, so
  // the stored daily answer never leaks between them (the shared engine
  // above has its own). The engine's own version comes from
  // backend/package.json, like the RF-15 test above.
  const { version } = JSON.parse(readFileSync(join(import.meta.dir, "..", "..", "package.json"), "utf-8"));
  const releaseUrl = `https://github.com/sigboe/wowdeck/releases/tag/v${version}`;

  function spawnEngine(dataDir: string) {
    return Bun.spawn([BIN], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        HOME: join(ROOT, "home"),
        WOWDECK_DATA_DIR: dataDir,
        WOWDECK_HUB_URL: `http://127.0.0.1:${port}`,
        WOWDECK_RELEASES_URL: `http://127.0.0.1:${port}/releases/latest`,
        WOWDECK_CF_URL: `http://127.0.0.1:${cfPort}/v1`,
      },
    });
  }

  /** Reads a process stream line by line, one long-lived reader (a stream keeps a single reader). */
  function readLines(stream: ReadableStream<Uint8Array>, onLine: (line: string) => void) {
    void (async () => {
      const reader = stream.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value);
        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          onLine(line);
        }
      }
    })();
  }

  /** One long-lived reader per process; sequential calls share it. */
  function link(proc: ReturnType<typeof spawnEngine>) {
    const pendingCalls = new Map<number, (v: any) => void>();
    readLines(proc.stdout as ReadableStream<Uint8Array>, (raw) => {
      const line = raw.trim();
      if (!line) return;
      const msg = JSON.parse(line);
      if (msg.id !== undefined && pendingCalls.has(msg.id)) {
        pendingCalls.get(msg.id)!(msg);
        pendingCalls.delete(msg.id);
      }
    });
    // The engine's structured log (stderr) — the only surface a silent
    // background failure is allowed to have — collected for assertions.
    // `stderr(until)` resolves only once the awaited text has actually been
    // pumped, so no assertion races the reader.
    const stderrLines: string[] = [];
    const stderrWaiters: Array<{ predicate: (text: string) => boolean; resolve: (text: string) => void }> = [];
    readLines(proc.stderr as ReadableStream<Uint8Array>, (line) => {
      stderrLines.push(line);
      const text = stderrLines.join("\n");
      for (let i = stderrWaiters.length - 1; i >= 0; i--) {
        const waiter = stderrWaiters[i]!;
        if (waiter.predicate(text)) {
          stderrWaiters.splice(i, 1);
          waiter.resolve(text);
        }
      }
    });
    const stderr = (until: (text: string) => boolean): Promise<string> => {
      const text = stderrLines.join("\n");
      return until(text)
        ? Promise.resolve(text)
        : new Promise((resolve) => stderrWaiters.push({ predicate: until, resolve }));
    };
    const call = (id: number, method: string, params: Record<string, unknown> = {}) => {
      proc.stdin!.write(JSON.stringify({ id, method, params }) + "\n");
      return new Promise<any>((resolve) => pendingCalls.set(id, resolve));
    };
    return { call, stderr };
  }

  test("a token saved through settings.set is used: Bearer on the wire, current, at most once a day", async () => {
    releasesLatest = { body: { tag_name: `v${version}`, html_url: releaseUrl } };
    const proc = spawnEngine(join(ROOT, "data-token"));
    const { call } = link(proc);
    try {
      const set = await call(1, "settings.set", { settings: { githubAccessToken: "github_pat_integration" } });
      // The token is never echoed back out.
      expect(set.result.settings.githubAccessToken).toBe("<configured>");

      const baseline = releasesSeenAuth.length;
      const res = await call(2, "system.updateCheck");
      expect(res.result).toEqual({
        status: "current",
        currentVersion: version,
        latestVersion: version,
        releaseUrl,
        downloadUrl: null,
        switchToStable: false,
        checked: true,
        toastPending: false,
      });
      expect(releasesSeenAuth.length).toBe(baseline + 1);
      expect(releasesSeenAuth[releasesSeenAuth.length - 1]).toBe("Bearer github_pat_integration");

      // Inside the interval: the stored answer, and no second request.
      const again = await call(3, "system.updateCheck");
      expect(again.result.status).toBe("current");
      expect(again.result.checked).toBe(false);
      expect(releasesSeenAuth.length).toBe(baseline + 1);
    } finally {
      proc.kill();
    }
  });

  test("no token and an unreachable repo (404): unknown, one unauthenticated attempt, then backoff", async () => {
    releasesLatest = { status: 404 };
    const proc = spawnEngine(join(ROOT, "data-notoken"));
    const { call, stderr } = link(proc);
    try {
      const baseline = releasesSeenAuth.length;
      const res = await call(1, "system.updateCheck");
      expect(res.result).toEqual({
        status: "unknown",
        currentVersion: version,
        latestVersion: null,
        releaseUrl: null,
        downloadUrl: null,
        switchToStable: false,
        checked: true,
        toastPending: false,
      });
      expect(releasesSeenAuth.length).toBe(baseline + 1);
      expect(releasesSeenAuth[releasesSeenAuth.length - 1]).toBeNull();

      // Silent: the failure is never an RPC error, never a toast — its
      // only surface is the engine's structured stderr log.
      expect(await stderr((t) => t.includes("[plugin-update] check unavailable"))).toContain(
        "[plugin-update] check unavailable",
      );

      // A failure is not a timestamp, but it backs off: a sequential call
      // inside the hour answers from the stored failure without a second
      // request instead of hammering the unreachable repo on every trigger.
      const again = await call(2, "system.updateCheck");
      expect(again.result.status).toBe("unknown");
      expect(again.result.checked).toBe(false);
      expect(again.result.toastPending).toBe(false);
      expect(releasesSeenAuth.length).toBe(baseline + 1);
    } finally {
      proc.kill();
      releasesLatest = { body: { tag_name: `v${version}`, html_url: releaseUrl } };
    }
  });

  test("a failed check re-arms after its window: the retry runs, succeeds, and the daily cadence returns", async () => {
    const dataDir = join(ROOT, "data-backoff-rearm");
    releasesLatest = { status: 503 };
    const first = spawnEngine(dataDir);
    const { call: call1 } = link(first);
    try {
      await call1(1, "system.updateCheck"); // the day's attempt fails
      // The window is persisted, so the backoff survives engine restarts.
      const state = JSON.parse(readFileSync(join(dataDir, "state.json"), "utf-8"));
      expect(state.settings.pluginUpdateBackoff).toEqual({ failedAt: expect.any(Number), failures: 1 });
    } finally {
      first.kill();
    }

    // The hour passes (age the persisted window to 0, like the toast test
    // ages the daily stamp), and the repo answers again.
    releasesLatest = { body: { tag_name: `v${version}`, html_url: releaseUrl } };
    const statePath = join(dataDir, "state.json");
    const aged = JSON.parse(readFileSync(statePath, "utf-8"));
    aged.settings.pluginUpdateBackoff.failedAt = 0;
    writeFileSync(statePath, JSON.stringify(aged));

    const second = spawnEngine(dataDir);
    const { call: call2 } = link(second);
    try {
      const baseline = releasesSeenAuth.length;
      const res = await call2(1, "system.updateCheck");
      expect(res.result.status).toBe("current");
      expect(res.result.checked).toBe(true);
      expect(releasesSeenAuth.length).toBe(baseline + 1);

      // The success cleared the backoff and re-armed the day: an immediate
      // second call answers from the stored stamp, no request.
      const again = await call2(2, "system.updateCheck");
      expect(again.result.checked).toBe(false);
      expect(releasesSeenAuth.length).toBe(baseline + 1);

      const state = JSON.parse(readFileSync(statePath, "utf-8"));
      expect(state.settings.pluginUpdateBackoff).toBeNull();
      expect(state.settings.lastPluginUpdate.checkedAt).toBeGreaterThan(0);
    } finally {
      second.kill();
      releasesLatest = { body: { tag_name: `v${version}`, html_url: releaseUrl } };
    }
  });

  test("exactly one toast per release version, across a real engine restart", async () => {
    const target = "9998.0.0";
    // The toast waits for the release's WoWDeck.zip: without it there is no Update.
    const zip = [{ name: "WoWDeck.zip", url: `http://127.0.0.1:${port}/assets/1` }];
    releasesLatest = {
      body: { tag_name: `v${target}`, html_url: `https://github.com/sigboe/wowdeck/releases/tag/v${target}`, assets: zip },
    };
    const dataDir = join(ROOT, "data-toast-gate");
    const baseline = releasesSeenAuth.length;

    // First engine session: the release window opens, the day's check runs.
    const first = spawnEngine(dataDir);
    const { call: call1 } = link(first);
    try {
      // Options asks first: it shows the panel, so it must not spend the toast.
      const quiet = await call1(1, "system.updateCheck");
      expect(quiet.result.status).toBe("available");
      expect(quiet.result.latestVersion).toBe(target);
      expect(quiet.result.checked).toBe(true);
      expect(quiet.result.toastPending).toBe(false);
      expect(releasesSeenAuth.length).toBe(baseline + 1);

      // The plugin-load trigger then gets the version's one toast, from the stored answer.
      const res = await call1(3, "system.updateCheck", { notify: true });
      expect(res.result.checked).toBe(false);
      expect(res.result.toastPending).toBe(true);
      expect(releasesSeenAuth.length).toBe(baseline + 1);

      // QAM churn inside the session: the cached answer never re-arms it.
      const again = await call1(2, "system.updateCheck", { notify: true });
      expect(again.result.checked).toBe(false);
      expect(again.result.toastPending).toBe(false);
      expect(releasesSeenAuth.length).toBe(baseline + 1);
    } finally {
      first.kill();
    }

    // The mark persisted: a restarted engine (plugin reload, Deck reboot)
    // holds the same cached answer and never re-toasts the same version.
    const second = spawnEngine(dataDir);
    const { call: call2 } = link(second);
    try {
      const res = await call2(1, "system.updateCheck", { notify: true });
      expect(res.result.status).toBe("available");
      expect(res.result.checked).toBe(false); // inside the interval: no network
      expect(res.result.toastPending).toBe(false);
      expect(releasesSeenAuth.length).toBe(baseline + 1);
      // The engine-written-only mark is what the gate reads.
      expect(JSON.parse(readFileSync(join(dataDir, "state.json"), "utf-8")).settings.pluginUpdateToastShownFor).toBe(target);
    } finally {
      second.kill();
    }

    // A genuinely newer release is a new key and earns its own single
    // toast. The day must pass for a fresh check: age the stored stamp.
    const newer = "9999.0.0";
    releasesLatest = {
      body: { tag_name: `v${newer}`, html_url: `https://github.com/sigboe/wowdeck/releases/tag/v${newer}`, assets: zip },
    };
    const statePath = join(dataDir, "state.json");
    const aged = JSON.parse(readFileSync(statePath, "utf-8"));
    aged.settings.lastPluginUpdate.checkedAt = 0;
    writeFileSync(statePath, JSON.stringify(aged));

    const third = spawnEngine(dataDir);
    const { call: call3 } = link(third);
    try {
      const res = await call3(1, "system.updateCheck", { notify: true });
      expect(res.result.latestVersion).toBe(newer);
      expect(res.result.checked).toBe(true);
      expect(res.result.toastPending).toBe(true); // one more, for the new version
      const again = await call3(2, "system.updateCheck", { notify: true });
      expect(again.result.toastPending).toBe(false);
    } finally {
      third.kill();
      releasesLatest = { body: { tag_name: `v${version}`, html_url: releaseUrl } };
    }
  });

  test("system.updateStage downloads, verifies and stages for Decky's installer", async () => {
    const target = "9999.0.0";
    releasesAsset = zipSync({
      "wowdeck/plugin.json": new TextEncoder().encode(JSON.stringify({ name: "WoWDeck", version: target, api_version: 1 })),
      "wowdeck/package.json": new TextEncoder().encode(JSON.stringify({ name: "wowdeck", version: target })),
      "wowdeck/main.py": new TextEncoder().encode("# entry"),
      "wowdeck/dist/index.js": new TextEncoder().encode("// bundle"),
      "wowdeck/bin/wowdeck": new TextEncoder().encode("#!/bin/bun"),
    });
    releasesLatest = {
      body: {
        tag_name: `v${target}`,
        html_url: `https://github.com/sigboe/wowdeck/releases/tag/v${target}`,
        assets: [{ name: "WoWDeck.zip", browser_download_url: `http://127.0.0.1:${port}/wowdeck-asset` }],
      },
    };
    const proc = spawnEngine(join(ROOT, "data-stage"));
    const { call } = link(proc);
    let staged: string | undefined;
    try {
      const res = await call(1, "system.updateStage");
      const sha256 = new Bun.CryptoHasher("sha256").update(releasesAsset).digest("hex");
      expect(res.result.error).toBeNull();
      expect(res.result.result.version).toBe(target);
      expect(res.result.result.sha256).toBe(sha256);
      staged = String(res.result.result.artifact).replace(/^file:\/\//, "");
      expect(staged.endsWith(`wowdeck-update-${target}.zip`)).toBe(true);
      expect(existsSync(staged)).toBe(true);
      expect(statSync(staged).mode & 0o777).toBe(0o600);
    } finally {
      proc.kill();
      if (staged) {
        rmSync(staged, { force: true });
      }
      releasesLatest = { body: { tag_name: `v${version}`, html_url: releaseUrl } };
    }
  });

  test("the update channel: Stable by default, a switch checks at once, and Beta survives a restart", async () => {
    const beta = "9997.0.0-beta.3";
    releasesList = [
      { tag_name: `v${beta}`, html_url: `https://github.com/sigboe/wowdeck/releases/tag/v${beta}`, prerelease: true },
      { tag_name: "v9998.0.0-beta.1", draft: true },
      { tag_name: `v${version}`, html_url: releaseUrl },
    ];
    const dataDir = join(ROOT, "data-channel");
    const first = spawnEngine(dataDir);
    const { call: call1 } = link(first);
    try {
      expect((await call1(1, "system.getUpdateChannel")).result).toEqual({ channel: "stable" });
      expect((await call1(2, "system.updateCheck")).result.status).toBe("current");

      // Inside the day's interval, yet the switch asks at once.
      const baseline = releasesSeenAuth.length;
      const switched = await call1(3, "system.setUpdateChannel", { channel: "beta" });
      expect(switched.result).toMatchObject({ status: "available", latestVersion: beta, checked: true, toastPending: false });
      expect(releasesSeenAuth.length).toBe(baseline + 1);

      const bad = await call1(4, "system.setUpdateChannel", { channel: "nightly" });
      expect(bad.error.code).toBe("invalid_request");
      // Options cannot set it around the switch's check.
      const set = await call1(5, "settings.set", { settings: { pluginUpdateChannel: "stable" } });
      expect(set.result.settings.pluginUpdateChannel).toBe("beta");
    } finally {
      first.kill();
    }

    const second = spawnEngine(dataDir);
    const { call: call2 } = link(second);
    try {
      expect((await call2(1, "system.getUpdateChannel")).result).toEqual({ channel: "beta" });
      const res = await call2(2, "system.updateCheck");
      expect(res.result).toMatchObject({ status: "available", latestVersion: beta, checked: false });
    } finally {
      second.kill();
      releasesList = [];
    }
  });
});
