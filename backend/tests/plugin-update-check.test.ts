/**
 * WoWDeck's own update notice, engine side: system.updateCheck /
 * PluginUpdateCheck. The fake net stands in for NetworkClient.getJson, so
 * no test touches the network (deterministic tests, AGENTS.md).
 */

import { describe, expect, test } from "bun:test";
import { NetworkError } from "../src/wow/net/network";
import { compareVersions, PluginUpdateCheck } from "../src/wow/notifications/PluginUpdateCheck";

function makeCheck(
  respond: () => unknown,
  currentVersion = "0.1.1",
  releasesUrl?: string,
  token?: string,
): {
  check: PluginUpdateCheck;
  calls: () => number;
  askedUrl: () => string;
  authHeaders: () => (string | undefined)[];
} {
  let calls = 0;
  let askedUrl = "";
  const authHeaders: (string | undefined)[] = [];
  const net = {
    async getJson<T>(url: string, options?: { headers?: Record<string, string> }): Promise<T> {
      calls += 1;
      askedUrl = url;
      authHeaders.push(options?.headers?.Authorization);
      const value = respond();
      if (value instanceof Error) throw value;
      return value as T;
    },
  };
  return {
    check: new PluginUpdateCheck(net, currentVersion, releasesUrl, token ? () => token : undefined),
    calls: () => calls,
    askedUrl: () => askedUrl,
    authHeaders: () => authHeaders,
  };
}

describe("compareVersions", () => {
  test("orders dotted numbers", () => {
    expect(compareVersions("0.2.0", "0.1.1")).toBe(1);
    expect(compareVersions("0.1.1", "0.1.1")).toBe(0);
    expect(compareVersions("1.0.0", "0.1.1")).toBe(1);
    expect(compareVersions("0.1.1", "0.10.0")).toBe(-1);
    expect(compareVersions("0.9.0", "0.10.0")).toBe(-1);
  });

  test("tolerates a leading v and short versions", () => {
    expect(compareVersions("v1.0.0", "0.1.1")).toBe(1);
    expect(compareVersions("v0.1", "0.1.0")).toBe(0);
  });

  test("null when either side is not a dotted number", () => {
    expect(compareVersions("banana", "0.1.1")).toBeNull();
    expect(compareVersions("1.2.3.4", "0.1.1")).toBeNull();
    expect(compareVersions("", "0.1.1")).toBeNull();
  });
});

describe("PluginUpdateCheck", () => {
  test("newer release: available, tag's v stripped, release page and zip linked", async () => {
    const { check } = makeCheck(() => ({
      tag_name: "v0.2.0",
      html_url: "https://github.com/sigboe/wowdeck/releases/tag/v0.2.0",
      assets: [
        { name: "SHA256SUMS.txt", browser_download_url: "https://x/SHA256SUMS.txt" },
        {
          name: "WoWDeck.zip",
          url: "https://api.github.com/repos/sigboe/wowdeck/releases/assets/7",
          browser_download_url: "https://x/WoWDeck.zip",
        },
      ],
    }));
    expect(await check.checkOnce()).toEqual({
      status: "available",
      currentVersion: "0.1.1",
      latestVersion: "0.2.0",
      releaseUrl: "https://github.com/sigboe/wowdeck/releases/tag/v0.2.0",
      downloadUrl: "https://api.github.com/repos/sigboe/wowdeck/releases/assets/7",
    });
  });

  test("an asset without an API url falls back to its browser_download_url", async () => {
    const { check } = makeCheck(() => ({
      tag_name: "v0.2.0",
      assets: [{ name: "WoWDeck.zip", browser_download_url: "https://x/WoWDeck.zip" }],
    }));
    expect((await check.checkOnce()).downloadUrl).toBe("https://x/WoWDeck.zip");
  });

  test("available without the packaged zip: link only, downloadUrl null", async () => {
    const { check } = makeCheck(() => ({ tag_name: "v0.2.0", html_url: "https://x" }));
    const result = await check.checkOnce();
    expect(result.status).toBe("available");
    expect(result.downloadUrl).toBeNull();
  });

  test("not newer: available-ness never carries a download", async () => {
    const { check } = makeCheck(() => ({
      tag_name: "v0.1.1",
      assets: [{ name: "WoWDeck.zip", browser_download_url: "https://x/WoWDeck.zip" }],
    }));
    expect((await check.checkOnce()).downloadUrl).toBeNull();
  });

  test("same release: current", async () => {
    const { check } = makeCheck(() => ({ tag_name: "v0.1.1", html_url: "https://x" }));
    expect((await check.checkOnce()).status).toBe("current");
  });

  test("older tag: current, never a downgrade offer", async () => {
    const { check } = makeCheck(() => ({ tag_name: "0.1.0", html_url: "https://x" }));
    expect((await check.checkOnce()).status).toBe("current");
  });

  test("private repo (HTTP 404): unknown, not an error", async () => {
    const { check } = makeCheck(() => new NetworkError("GET … failed: HTTP 404", 404));
    const result = await check.checkOnce();
    expect(result.status).toBe("unknown");
    expect(result.latestVersion).toBeNull();
  });

  test("offline / rate limited: unknown, not an error", async () => {
    const { check } = makeCheck(() => new NetworkError("request to … failed: timeout"));
    expect((await check.checkOnce()).status).toBe("unknown");
  });

  test("a release without a parseable tag: unknown", async () => {
    const { check } = makeCheck(() => ({ tag_name: "banana-weekly", html_url: "https://x" }));
    expect((await check.checkOnce()).status).toBe("unknown");
  });

  test("missing html_url falls back to the releases page", async () => {
    const { check } = makeCheck(() => ({ tag_name: "v0.2.0" }));
    expect((await check.checkOnce()).releaseUrl).toBe("https://github.com/sigboe/wowdeck/releases");
  });

  test("once per session: concurrent and later callers share one request", async () => {
    const { check, calls } = makeCheck(() => ({ tag_name: "v0.2.0", html_url: "https://x" }));
    const [a, b] = await Promise.all([check.checkOnce(), check.checkOnce()]);
    expect(a).toEqual(b);
    await check.checkOnce();
    expect(calls()).toBe(1);
  });

  test("no token: one unauthenticated call, no Authorization header", async () => {
    const { check, calls, authHeaders } = makeCheck(() => ({ tag_name: "v0.1.1" }));
    await check.checkOnce();
    expect(calls()).toBe(1);
    expect(authHeaders()).toEqual([undefined]);
  });

  test("token configured: sent as Bearer, single call when it works", async () => {
    const { check, calls, authHeaders } = makeCheck(
      () => ({ tag_name: "v0.1.1" }),
      "0.1.1",
      undefined,
      "ghp_test",
    );
    expect((await check.checkOnce()).status).toBe("current");
    expect(calls()).toBe(1);
    expect(authHeaders()).toEqual(["Bearer ghp_test"]);
  });

  test("token rejected: one unauthenticated retry answers for a public repo", async () => {
    let n = 0;
    const { check, calls, authHeaders } = makeCheck(
      () => (++n === 1 ? new NetworkError("GET … failed: HTTP 401", 401) : { tag_name: "v0.1.1" }),
      "0.1.1",
      undefined,
      "ghp_expired",
    );
    expect((await check.checkOnce()).status).toBe("current");
    expect(calls()).toBe(2);
    expect(authHeaders()).toEqual(["Bearer ghp_expired", undefined]);
  });

  test("token without access to the private repo: both attempts fail, unknown", async () => {
    const { check, calls, authHeaders } = makeCheck(
      () => new NetworkError("GET … failed: HTTP 404", 404),
      "0.1.1",
      undefined,
      "ghp_limited",
    );
    expect((await check.checkOnce()).status).toBe("unknown");
    expect(calls()).toBe(2);
    expect(authHeaders()).toEqual(["Bearer ghp_limited", undefined]);
  });

  test("a failing check logs the redacted error and never the token", async () => {
    const { check } = makeCheck(
      () => new NetworkError("request to … failed: timeout"),
      "0.1.1",
      undefined,
      "ghp_secret",
    );
    const lines: string[] = [];
    const orig = console.error;
    console.error = (m: unknown) => lines.push(String(m));
    try {
      await check.checkOnce();
    } finally {
      console.error = orig;
    }
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("check unavailable");
    expect(lines[0]).not.toContain("ghp_secret");
  });

  test("the releases URL is injectable (the integration mock relies on it)", async () => {
    const { check, askedUrl } = makeCheck(
      () => ({ tag_name: "v0.1.1" }),
      "0.1.1",
      "http://127.0.0.1:7/releases/latest",
    );
    await check.checkOnce();
    expect(askedUrl()).toBe("http://127.0.0.1:7/releases/latest");
  });
});
