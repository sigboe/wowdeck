/**
 * Options › About, engine side: about.get / About. The plugin directory is a
 * temporary folder standing in for the installed plugin, so no test reads
 * the real install (deterministic tests, AGENTS.md).
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FundingLink } from "../src/api/contracts";
import { About, type AboutOptions } from "../src/about/About";
import { NetworkError, ResponseTooLargeError } from "../src/wow/net/network";
import { DAY_MS } from "../src/wow/notifications/CheckCadence";
import { PluginUpdateCheck } from "../src/wow/notifications/PluginUpdateCheck";

const NOTICES = "# Third-party notices\n\nWoWDeck is built on WowUp.\n";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A fresh temporary folder, removed after the test. */
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "wowdeck-about-"));
  dirs.push(dir);
  return dir;
}

/** A folder holding the given files; a name may include subfolders. */
function folderWith(files: Record<string, string>): string {
  const dir = tempDir();
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(join(dir, name, ".."), { recursive: true });
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

/** An installed plugin folder holding the given files. */
function pluginDir(files: Record<string, string> = {}): string {
  return folderWith(files);
}

/** A recorded SUPPORTERS.md: the snapshot the zip carries, and a later one on `next`. */
const fixture = (name: string) =>
  readFileSync(join(import.meta.dir, "fixtures", "about", name), "utf-8");
const SNAPSHOT = fixture("SUPPORTERS.md");
const NEXT = fixture("SUPPORTERS-next.md");
/** A recorded FUNDING.yml: GitHub's template with one key filled, and a later one on `next`. */
const FUNDING_SNAPSHOT = fixture("FUNDING.yml");
const FUNDING_NEXT = fixture("FUNDING-next.yml");
const RAW = "https://raw.githubusercontent.com/sigboe/wowdeck/next";

/**
 * A fake GitHub raw-file server: `files` maps a repo path to its text, an
 * Error to throw, or nothing (404). Records every request.
 */
function fakeNet(files: Record<string, string | Error> = {}) {
  const requests: { url: string; auth: string | undefined; maxBytes: number | undefined }[] = [];
  return {
    requests,
    files,
    net: {
      async getText(
        url: string,
        opts?: { headers?: Record<string, string>; maxBytes?: number },
      ): Promise<string> {
        requests.push({ url, auth: opts?.headers?.Authorization, maxBytes: opts?.maxBytes });
        const path = url.startsWith(`${RAW}/`) ? url.slice(RAW.length + 1) : url;
        const answer = files[path];
        if (answer instanceof Error) throw answer;
        if (answer === undefined) throw new NetworkError("HTTP 404", 404, url);
        // Like NetworkClient: a body past maxBytes fails, never arrives.
        if (opts?.maxBytes !== undefined && new TextEncoder().encode(answer).byteLength > opts.maxBytes) {
          throw new ResponseTooLargeError(opts.maxBytes, url);
        }
        return answer;
      },
    },
  };
}

/** An About over a plugin folder whose zip carried `snapshot`, with its own data dir. */
function makeAbout(
  over: {
    snapshot?: string | null;
    fundingSnapshot?: string | null;
    net?: ReturnType<typeof fakeNet>;
    dataDir?: string;
  } & Pick<AboutOptions, "tokenProvider" | "rawBaseUrl"> = {},
) {
  const snapshot = over.snapshot === undefined ? SNAPSHOT : over.snapshot;
  const fundingSnapshot =
    over.fundingSnapshot === undefined ? FUNDING_SNAPSHOT : over.fundingSnapshot;
  const net = over.net ?? fakeNet();
  const dataDir = over.dataDir ?? tempDir();
  const about = new About({
    pluginDir: pluginDir({
      ...(snapshot === null ? {} : { "about-snapshot/SUPPORTERS.md": snapshot }),
      ...(fundingSnapshot === null ? {} : { "about-snapshot/FUNDING.yml": fundingSnapshot }),
    }),
    dataDir,
    net: net.net,
    rawBaseUrl: over.rawBaseUrl ?? RAW,
    tokenProvider: over.tokenProvider,
  });
  return { about, net, dataDir };
}

describe("about.get: third-party notices", () => {
  test("answers with the notices text read from the installed plugin", async () => {
    const about = new About({ pluginDir: pluginDir({ "THIRD_PARTY_NOTICES.md": NOTICES }) });
    expect((await about.get()).notices).toBe(NOTICES);
  });

  test("a plugin without the notices file answers null, never an error", async () => {
    const about = new About({ pluginDir: pluginDir() });
    expect(await about.get()).toMatchObject({ notices: null });
  });

  test("outside Decky (no plugin dir) the notices are null", async () => {
    const about = new About({ pluginDir: null });
    expect(await about.get()).toMatchObject({ notices: null });
  });
});

describe("about.get: Supporters", () => {
  test("a first run with no network answers the snapshot bundled in the zip", async () => {
    const { about } = makeAbout({ net: fakeNet({ "SUPPORTERS.md": new NetworkError("offline") }) });
    await about.refresh();
    expect((await about.get()).supporters).toEqual(["Ada Lovelace", "Zed"]);
  });

  test("a fetch replaces the cache, and the copy outlives a restart with no network", async () => {
    const net = fakeNet({ "SUPPORTERS.md": NEXT });
    const { about, dataDir } = makeAbout({ net });
    await about.refresh();
    expect(net.requests.map((r) => r.url)).toContain(`${RAW}/SUPPORTERS.md`);
    const fetched = (await about.get()).supporters;
    expect(fetched).toContain("Brokk the Smith");
    expect(fetched).not.toContain("Zed");

    const restarted = makeAbout({
      dataDir,
      net: fakeNet({ "SUPPORTERS.md": new NetworkError("offline") }),
    });
    await restarted.about.refresh();
    expect((await restarted.about.get()).supporters).toEqual(fetched);
  });

  test("a failed fetch keeps the last good copy, never an error", async () => {
    const net = fakeNet({ "SUPPORTERS.md": NEXT });
    const { about } = makeAbout({ net });
    await about.refresh();
    const good = (await about.get()).supporters;

    for (const failure of [new NetworkError("HTTP 500", 500), undefined /* 404 */]) {
      net.files["SUPPORTERS.md"] = failure as Error;
      await expect(about.refresh()).resolves.toBeUndefined();
      expect((await about.get()).supporters).toEqual(good);
    }
  });

  test("the download itself is capped at 64 KiB", async () => {
    const net = fakeNet({ "SUPPORTERS.md": NEXT });
    const { about } = makeAbout({ net });
    await about.refresh();
    expect(net.requests.map((r) => r.maxBytes)).toEqual([64 * 1024, 64 * 1024]);
  });

  test("a download stopped past the cap is not retried without the token", async () => {
    const net = fakeNet({ "SUPPORTERS.md": new ResponseTooLargeError(64 * 1024, `${RAW}/SUPPORTERS.md`) });
    const { about } = makeAbout({ net, tokenProvider: () => "github_pat_secret" });
    await about.refresh();
    expect(net.requests.filter((r) => r.url.endsWith("/SUPPORTERS.md"))).toHaveLength(1);
    expect((await about.get()).supporters).toEqual(["Ada Lovelace", "Zed"]);
  });

  test("an oversized file is dropped like a failed fetch", async () => {
    const net = fakeNet({ "SUPPORTERS.md": `- Huge\n${"x".repeat(70 * 1024)}\n` });
    const { about } = makeAbout({ net });
    await about.refresh();
    expect((await about.get()).supporters).toEqual(["Ada Lovelace", "Zed"]);
  });

  test("nothing fetched and no snapshot answers no Supporters", async () => {
    const { about } = makeAbout({ snapshot: null });
    await about.refresh();
    expect((await about.get()).supporters).toEqual([]);
  });

  test("the GitHub token goes first, with an unauthenticated retry, and is never logged", async () => {
    const logged: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => logged.push(args.join(" "));
    try {
      const net = fakeNet({
        "SUPPORTERS.md": new NetworkError("HTTP 401", 401),
        ".github/FUNDING.yml": FUNDING_NEXT,
      });
      const { about } = makeAbout({ net, tokenProvider: () => "github_pat_secret" });
      await about.refresh();
      const supporterAsks = net.requests.filter((r) => r.url.endsWith("/SUPPORTERS.md"));
      expect(supporterAsks.map((r) => r.auth)).toEqual(["Bearer github_pat_secret", undefined]);
      expect(logged.join("\n")).not.toContain("github_pat_secret");
      expect(logged.filter((line) => line.startsWith("[about]"))).toHaveLength(1);
    } finally {
      console.error = original;
    }
  });
});

describe("about refresh: the GitHub token stays on GitHub", () => {
  test("a GitHub base URL gets the token", async () => {
    const net = fakeNet();
    const { about } = makeAbout({ net, tokenProvider: () => "github_pat_secret" });
    await about.refresh();
    expect(net.requests[0]?.auth).toBe("Bearer github_pat_secret");
  });

  test("any other WOWDECK_ABOUT_URL is asked without it", async () => {
    for (const rawBaseUrl of [
      "http://127.0.0.1:8080/raw",
      "https://example.com/raw",
      "https://raw.githubusercontent.com.example.com/raw",
      "https://notgithub.com/raw",
      "http://raw.githubusercontent.com/sigboe/wowdeck/next",
    ]) {
      const net = fakeNet();
      const { about } = makeAbout({ net, rawBaseUrl, tokenProvider: () => "github_pat_secret" });
      await about.refresh();
      expect(net.requests.length).toBeGreaterThan(0);
      expect(net.requests.map((r) => r.auth)).toEqual(net.requests.map(() => undefined));
    }
  });
});

describe("about.get: Funding links", () => {
  test("a first run with no network answers the snapshot bundled in the zip", async () => {
    const { about } = makeAbout({
      net: fakeNet({ ".github/FUNDING.yml": new NetworkError("offline") }),
    });
    await about.refresh();
    expect((await about.get()).funding).toEqual([
      { kind: "web", name: "Ko-fi", url: "https://ko-fi.com/snapshot_dev" },
    ]);
  });

  test("a fetch replaces the cache through the same path as SUPPORTERS.md, and outlives a restart", async () => {
    const net = fakeNet({ ".github/FUNDING.yml": FUNDING_NEXT, "SUPPORTERS.md": NEXT });
    const { about, dataDir } = makeAbout({ net });
    await about.refresh();
    expect(net.requests.map((r) => r.url)).toContain(`${RAW}/.github/FUNDING.yml`);
    const expected: FundingLink[] = [
      { kind: "web", name: "Ko-fi", url: "https://ko-fi.com/wowdeck" },
      { kind: "web", name: "Patreon", url: "https://www.patreon.com/wowdeck" },
      { kind: "web", name: "PayPal", url: "https://paypal.me/wowdeck" },
      { kind: "web", name: "Buy Me a Coffee", url: "https://www.buymeacoffee.com/wowdeck" },
    ];
    expect((await about.get()).funding).toEqual(expected);
    expect(readFileSync(join(dataDir, "about", "FUNDING.yml"), "utf-8")).toBe(FUNDING_NEXT);

    const restarted = makeAbout({
      dataDir,
      net: fakeNet({ ".github/FUNDING.yml": new NetworkError("offline") }),
    });
    await restarted.about.refresh();
    expect((await restarted.about.get()).funding).toEqual(expected);
  });

  test("a failed fetch keeps the last good copy, never an error", async () => {
    const net = fakeNet({ ".github/FUNDING.yml": FUNDING_NEXT });
    const { about } = makeAbout({ net });
    await about.refresh();
    const good = (await about.get()).funding;
    net.files[".github/FUNDING.yml"] = new NetworkError("HTTP 500", 500);
    await expect(about.refresh()).resolves.toBeUndefined();
    expect((await about.get()).funding).toEqual(good);
  });

  test("a snapshot with comments only (no account yet) answers no links", async () => {
    const commentsOnly = "# Funding links for WoWDeck\n# ko_fi: someone\n";
    const { about } = makeAbout({ fundingSnapshot: commentsOnly });
    expect((await about.get()).funding).toEqual([]);
  });

  test("nothing fetched and no snapshot answers no links", async () => {
    const { about } = makeAbout({ fundingSnapshot: null });
    await about.refresh();
    expect((await about.get()).funding).toEqual([]);
  });
});

describe("about.get: Funding link parsing", () => {
  /** The links a fetched FUNDING.yml shows. */
  async function linksFrom(yaml: string) {
    const { about } = makeAbout({ net: fakeNet({ ".github/FUNDING.yml": yaml }) });
    await about.refresh();
    return (await about.get()).funding;
  }

  test("ko_fi and patreon usernames become their platform pages", async () => {
    expect(await linksFrom("patreon: dev\nko_fi: dev2\n")).toEqual([
      { kind: "web", name: "Patreon", url: "https://www.patreon.com/dev" },
      { kind: "web", name: "Ko-fi", url: "https://ko-fi.com/dev2" },
    ]);
  });

  test("github, liberapay and buy_me_a_coffee are supported too; github takes a list", async () => {
    expect(await linksFrom("github: [one, two]\nliberapay: lp\nbuy_me_a_coffee: bmc\n")).toEqual([
      { kind: "web", name: "GitHub Sponsors", url: "https://github.com/sponsors/one" },
      { kind: "web", name: "GitHub Sponsors", url: "https://github.com/sponsors/two" },
      { kind: "web", name: "Liberapay", url: "https://liberapay.com/lp" },
      { kind: "web", name: "Buy Me a Coffee", url: "https://buymeacoffee.com/bmc" },
    ]);
  });

  test("a platform value that isn't a username is dropped", async () => {
    expect(await linksFrom('ko_fi: "evil.example/../x"\npatreon: "a b"\n')).toEqual([]);
  });

  test("custom takes one URL as a string", async () => {
    expect(await linksFrom("custom: https://paypal.me/dev\n")).toEqual([
      { kind: "web", name: "PayPal", url: "https://paypal.me/dev" },
    ]);
  });

  test("custom takes a list of URLs", async () => {
    expect(
      await linksFrom(
        "custom:\n  - https://www.paypal.com/donate/?hosted_button_id=X\n  - https://liberapay.com/dev\n",
      ),
    ).toEqual([
      { kind: "web", name: "PayPal", url: "https://www.paypal.com/donate/?hosted_button_id=X" },
      { kind: "web", name: "Liberapay", url: "https://liberapay.com/dev" },
    ]);
  });

  test("only https links are kept", async () => {
    const yaml = [
      "custom:",
      "  - http://paypal.me/plain",
      "  - javascript:alert(1)",
      "  - ftp://files.example.com/x",
      "  - paypal.me/no-scheme",
      "  - https://user:pass@example.com/x",
      "  - https://ko-fi.com/ok",
    ].join("\n");
    expect(await linksFrom(yaml)).toEqual([{ kind: "web", name: "Ko-fi", url: "https://ko-fi.com/ok" }]);
  });

  test("a bitcoin: entry becomes a Bitcoin link: legacy, P2SH, SegWit and Taproot", async () => {
    const yaml = [
      "custom:",
      "  - bitcoin:1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2",
      "  - BITCOIN:3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy",
      "  - bitcoin:BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4",
      "  - bitcoin:bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0",
    ].join("\n");
    expect(await linksFrom(yaml)).toEqual([
      { kind: "bitcoin", name: "Bitcoin", url: "bitcoin:1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2" },
      { kind: "bitcoin", name: "Bitcoin", url: "bitcoin:3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy" },
      { kind: "bitcoin", name: "Bitcoin", url: "bitcoin:bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4" },
      {
        kind: "bitcoin",
        name: "Bitcoin",
        url: "bitcoin:bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0",
      },
    ]);
  });

  test("a bitcoin: entry's parameters are dropped", async () => {
    expect(
      await linksFrom(
        'custom: "bitcoin:1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2?amount=0.01&label=WoWDeck"\n',
      ),
    ).toEqual([
      { kind: "bitcoin", name: "Bitcoin", url: "bitcoin:1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2" },
    ]);
  });

  test("a Bitcoin address that fails its checksum, or isn't mainnet, is dropped", async () => {
    const yaml = [
      "custom:",
      "  - bitcoin:1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN3",
      "  - bitcoin:bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t5",
      "  - bitcoin:bc1qw508d6qejxtdg4y5r3zarvary0C5xw7kv8f3t4",
      "  - bitcoin:tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx",
      "  - bitcoin:mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn",
      "  - bitcoin:",
      "  - bitcoin://1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2",
      "  - https://ko-fi.com/ok",
    ].join("\n");
    expect(await linksFrom(yaml)).toEqual([
      { kind: "web", name: "Ko-fi", url: "https://ko-fi.com/ok" },
    ]);
  });

  test("Bitcoin links count toward the link cap", async () => {
    const urls = Array.from({ length: 6 }, (_, i) => `https://site${i}.example.com/`);
    const links = await linksFrom(
      `custom: [${urls.join(", ")}, "bitcoin:1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2"]\n`,
    );
    expect(links.map((l) => l.kind)).toEqual(Array(6).fill("web"));
  });

  test("an unknown host is named by its bare hostname", async () => {
    expect(
      await linksFrom(
        "custom: [https://www.donate.example.org/wowdeck, https://opencollective.com/x]\n",
      ),
    ).toEqual([
      { kind: "web", name: "donate.example.org", url: "https://www.donate.example.org/wowdeck" },
      { kind: "web", name: "opencollective.com", url: "https://opencollective.com/x" },
    ]);
  });

  test("a link listed twice shows once", async () => {
    expect(await linksFrom("ko_fi: dev\ncustom: https://ko-fi.com/dev\n")).toEqual([
      { kind: "web", name: "Ko-fi", url: "https://ko-fi.com/dev" },
    ]);
  });

  test("at most 6 links, the first 6 in the file's order", async () => {
    const urls = Array.from({ length: 9 }, (_, i) => `https://site${i}.example.com/`);
    const links = await linksFrom(`custom: [${urls.join(", ")}]\n`);
    expect(links.map((l) => l.url)).toEqual(urls.slice(0, 6));
  });

  test("keys named after Object.prototype members are unknown keys, not platforms", async () => {
    expect(
      await linksFrom("constructor: dev\nhasOwnProperty: dev\ntoString: dev\nko_fi: ok\n"),
    ).toEqual([{ kind: "web", name: "Ko-fi", url: "https://ko-fi.com/ok" }]);
  });

  test("a file that isn't valid YAML, or isn't a mapping, has no links", async () => {
    expect(await linksFrom("ko_fi: [unclosed\n")).toEqual([]);
    expect(await linksFrom("- https://ko-fi.com/dev\n")).toEqual([]);
  });
});

describe("about.get: Supporter names", () => {
  /** The names a fetched SUPPORTERS.md shows. */
  async function namesFrom(markdown: string): Promise<string[]> {
    const { about } = makeAbout({ net: fakeNet({ "SUPPORTERS.md": markdown }) });
    await about.refresh();
    return (await about.get()).supporters;
  }

  test("one plain-text name per line, list markers and Markdown stripped, alphabetical, once each", async () => {
    expect(await namesFrom(NEXT)).toEqual([
      "Ada Lovelace",
      "Brokk the Smith",
      "Céline",
      "grace",
      "Linus",
      "Mira Q",
    ]);
  });

  test("headings and HTML comments are the file's own notes, never names", async () => {
    expect(await namesFrom("# Supporters\n\n<!-- add names below -->\n## 2026\n")).toEqual([]);
    expect(
      await namesFrom("<!--\nOne name per line.\nNo links.\n-->\n- Ada <!-- since 2026 -->\n"),
    ).toEqual(["Ada"]);
  });

  test("control and bidi characters are dropped, spaces collapse", async () => {
    expect(await namesFrom("- Ev\u202Eil\u0007  Name\t\n")).toEqual(["Evil Name"]);
  });

  test("at most 200 names, the first 200 in alphabetical order", async () => {
    const lines = Array.from(
      { length: 250 },
      (_, i) => `- Name ${String(250 - i).padStart(3, "0")}`,
    );
    const names = await namesFrom(lines.join("\n"));
    expect(names).toHaveLength(200);
    expect(names[0]).toBe("Name 001");
    expect(names[199]).toBe("Name 200");
  });

  test("a name longer than 48 characters is cut with an ellipsis", async () => {
    expect(await namesFrom(`- ${"a".repeat(60)}\n- ${"b".repeat(48)}`)).toEqual([
      `${"a".repeat(47)}…`,
      "b".repeat(48),
    ]);
  });
});

describe("about refresh follows the WoWDeck update check", () => {
  const NOW = 1_800_000_000_000;
  const RELEASE = {
    tag_name: "v0.2.0",
    html_url: "https://github.com/sigboe/wowdeck/releases/tag/v0.2.0",
    assets: [
      { name: "WoWDeck.zip", url: "https://api.github.com/repos/sigboe/wowdeck/releases/assets/7" },
    ],
  };

  /** About wired to an update check the way main.ts wires them, over one fake clock. */
  function wired(
    options: { release?: unknown; supporters?: string | Error; onAskThrows?: boolean } = {},
  ) {
    let now = NOW;
    let releaseAsks = 0;
    const raw = fakeNet({ "SUPPORTERS.md": options.supporters ?? NEXT });
    const { about } = makeAbout({ net: raw });
    let refreshing: Promise<void> = Promise.resolve();
    const check = new PluginUpdateCheck(
      {
        async getJson<T>(url: string): Promise<T> {
          releaseAsks += 1;
          const release = options.release ?? RELEASE;
          if (release instanceof Error) throw release;
          // The Beta channel asks for the release list.
          return (url.includes("per_page=") ? [release] : release) as T;
        },
      },
      "0.1.1",
      undefined,
      undefined,
      undefined,
      {
        now: () => now,
        onGitHubAsk: () => {
          refreshing = about.refresh();
          if (options.onAskThrows) throw new Error("hook broke");
        },
      },
    );
    return {
      about,
      check,
      /** Requests for raw files, after the refresh in flight settles. */
      fetches: async () => {
        await refreshing;
        return raw.requests.filter((r) => r.url.endsWith("/SUPPORTERS.md")).length;
      },
      releaseAsks: () => releaseAsks,
      advance: (ms: number) => {
        now += ms;
      },
    };
  }

  test("a plain about.get never fetches", async () => {
    const w = wired();
    await w.about.get();
    await w.about.get();
    expect(await w.fetches()).toBe(0);
  });

  test("a due check fetches; a check answered from the stored answer does not; the next day's does", async () => {
    const w = wired();
    await w.check.check();
    expect(await w.fetches()).toBe(1);
    expect((await w.about.get()).supporters).toContain("Brokk the Smith");

    w.advance(60 * 60 * 1000);
    await w.check.check({ notify: true });
    expect(await w.fetches()).toBe(1);

    w.advance(DAY_MS);
    await w.check.check();
    expect(await w.fetches()).toBe(2);
  });

  test("Check again fetches, even inside the day", async () => {
    const w = wired();
    await w.check.check();
    expect(await w.fetches()).toBe(1);
    await w.check.check({ force: true });
    expect(await w.fetches()).toBe(2);
  });

  test("a channel switch fetches, even inside the day", async () => {
    const w = wired();
    await w.check.check();
    expect(await w.fetches()).toBe(1);
    await w.check.setChannel("beta");
    expect(await w.fetches()).toBe(2);
  });

  test("a staging refresh fetches; staging from the stored answer does not", async () => {
    const w = wired();
    await w.check.check();
    expect(await w.fetches()).toBe(1);
    await w.check.forStaging();
    expect(await w.fetches()).toBe(1);
    await w.check.forStaging({ refresh: true });
    expect(await w.fetches()).toBe(2);
  });

  test("inside the update check's failure backoff nothing is fetched", async () => {
    const w = wired({ release: new NetworkError("offline") });
    await w.check.check();
    expect(await w.fetches()).toBe(1);
    w.advance(10 * 60 * 1000);
    await w.check.check();
    expect(w.releaseAsks()).toBe(1);
    expect(await w.fetches()).toBe(1);
  });

  test("a failed update check still refreshes the Supporters", async () => {
    const w = wired({ release: new NetworkError("HTTP 404", 404) });
    expect((await w.check.check()).status).toBe("unknown");
    await w.fetches();
    expect((await w.about.get()).supporters).toContain("Brokk the Smith");
  });

  test("the update check answers the same whether the Supporters fetch works, fails or breaks", async () => {
    const answers = [];
    for (const options of [
      {},
      { supporters: new NetworkError("offline") },
      { onAskThrows: true },
    ]) {
      const w = wired(options);
      answers.push(await w.check.check());
      await w.fetches();
    }
    expect(answers[0]).toMatchObject({ status: "available", checked: true, failed: false });
    expect(answers[1]).toEqual(answers[0]!);
    expect(answers[2]).toEqual(answers[0]!);
  });
});
