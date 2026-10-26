/**
 * WoWDeck's own update notice, engine side: system.updateCheck /
 * PluginUpdateCheck. The fake net stands in for NetworkClient.getJson, so
 * no test touches the network (deterministic tests, AGENTS.md). The clock and
 * the persisted stamp are injected too, so the once-a-day cap is tested
 * without sleeping or reading the real settings file.
 */

import { describe, expect, test } from "bun:test";
import type { PluginUpdateBackoff, PluginUpdateSnapshot } from "../src/api/contracts";
import { NetworkError } from "../src/wow/net/network";
import { DAY_MS, HOUR_MS } from "../src/wow/notifications/CheckCadence";
import { compareVersions, PluginUpdateCheck } from "../src/wow/notifications/PluginUpdateCheck";

const NOW = 1_800_000_000_000;
const RELEASES = "https://github.com/sigboe/wowdeck/releases";
/** A toast trigger (plugin load, wake): the only caller that may spend the toast. */
const NOTIFY = { notify: true };
const ZIP = "https://api.github.com/repos/sigboe/wowdeck/releases/assets/7";
const withZip = (tag: string) => ({ tag_name: tag, html_url: "https://x", assets: [{ name: "WoWDeck.zip", url: ZIP }] });

function stampOf(over: Partial<PluginUpdateSnapshot> = {}): PluginUpdateSnapshot {
  return {
    checkedAt: NOW - 60 * 60 * 1000,
    latestVersion: "0.2.0",
    releaseUrl: "https://github.com/sigboe/wowdeck/releases/tag/v0.2.0",
    downloadUrl: "https://api.github.com/repos/sigboe/wowdeck/releases/assets/7",
    ...over,
  };
}

interface Harness {
  check: PluginUpdateCheck;
  calls: () => number;
  askedUrl: () => string;
  authHeaders: () => (string | undefined)[];
  stamp: () => PluginUpdateSnapshot | null;
  /** The persisted failure backoff: consecutive failures and their last time. */
  backoff: () => PluginUpdateBackoff | null;
  /** The version the toast gate marked as shown, when it already has. */
  toastShown: () => string | null;
  /** A new engine session over the same persisted state (a restart). */
  restart: (over?: { currentVersion?: string; now?: number; respond?: () => unknown }) => void;
}

function makeCheck(options: {
  respond: () => unknown;
  currentVersion?: string;
  releasesUrl?: string;
  token?: string;
  stored?: PluginUpdateSnapshot | null;
  toastShownFor?: string | null;
  now?: number;
}): Harness {
  let calls = 0;
  let askedUrl = "";
  const authHeaders: (string | undefined)[] = [];
  let respond = options.respond;
  let currentVersion = options.currentVersion ?? "0.1.1";
  let nowMs = options.now ?? NOW;
  const net = {
    async getJson<T>(url: string, opts?: { headers?: Record<string, string> }): Promise<T> {
      calls += 1;
      askedUrl = url;
      authHeaders.push(opts?.headers?.Authorization);
      const value = respond();
      if (value instanceof Error) throw value;
      return value as T;
    },
  };
  // The persisted state both engine sessions share (settings, in production).
  const persisted = {
    stamp: options.stored ?? null,
    toastShownFor: options.toastShownFor ?? null,
    backoff: null as PluginUpdateBackoff | null,
  };
  let check = build();
  function build() {
    return new PluginUpdateCheck(
      net,
      currentVersion,
      options.releasesUrl,
      options.token ? () => options.token : undefined,
      {
        read: () => persisted.stamp,
        write: (snapshot) => {
          persisted.stamp = snapshot;
        },
        readBackoff: () => persisted.backoff,
        writeBackoff: (backoff) => {
          persisted.backoff = backoff;
        },
        readToastShown: () => persisted.toastShownFor,
        writeToastShown: (version) => {
          persisted.toastShownFor = version;
        },
      },
      () => nowMs,
    );
  }
  return {
    get check() {
      return check;
    },
    calls: () => calls,
    askedUrl: () => askedUrl,
    authHeaders: () => authHeaders,
    stamp: () => persisted.stamp,
    backoff: () => persisted.backoff,
    toastShown: () => persisted.toastShownFor,
    restart(over = {}) {
      if (over.respond) respond = over.respond;
      if (over.currentVersion) currentVersion = over.currentVersion;
      if (over.now) nowMs = over.now;
      check = build();
    },
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
    const { check } = makeCheck({
      respond: () => ({
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
      }),
    });
    expect(await check.check(NOTIFY)).toEqual({
      status: "available",
      currentVersion: "0.1.1",
      latestVersion: "0.2.0",
      releaseUrl: "https://github.com/sigboe/wowdeck/releases/tag/v0.2.0",
      downloadUrl: "https://api.github.com/repos/sigboe/wowdeck/releases/assets/7",
      checked: true,
      toastPending: true,
    });
  });

  test("an asset without an API url falls back to its browser_download_url", async () => {
    const { check } = makeCheck({
      respond: () => ({
        tag_name: "v0.2.0",
        assets: [{ name: "WoWDeck.zip", browser_download_url: "https://x/WoWDeck.zip" }],
      }),
    });
    expect((await check.check()).downloadUrl).toBe("https://x/WoWDeck.zip");
  });

  test("available without the packaged zip: link only, downloadUrl null", async () => {
    const { check } = makeCheck({ respond: () => ({ tag_name: "v0.2.0", html_url: "https://x" }) });
    const result = await check.check();
    expect(result.status).toBe("available");
    expect(result.downloadUrl).toBeNull();
  });

  test("not newer: available-ness never carries a download", async () => {
    const { check } = makeCheck({
      respond: () => ({
        tag_name: "v0.1.1",
        assets: [{ name: "WoWDeck.zip", browser_download_url: "https://x/WoWDeck.zip" }],
      }),
    });
    expect((await check.check()).downloadUrl).toBeNull();
  });

  test("same release: current", async () => {
    const { check } = makeCheck({ respond: () => ({ tag_name: "v0.1.1", html_url: "https://x" }) });
    expect((await check.check()).status).toBe("current");
  });

  test("older tag: current, never a downgrade offer", async () => {
    const { check } = makeCheck({ respond: () => ({ tag_name: "0.1.0", html_url: "https://x" }) });
    expect((await check.check()).status).toBe("current");
  });

  test("private repo (HTTP 404): unknown, not an error", async () => {
    const { check } = makeCheck({ respond: () => new NetworkError("GET … failed: HTTP 404", 404) });
    const result = await check.check();
    expect(result.status).toBe("unknown");
    expect(result.latestVersion).toBeNull();
  });

  test("offline / rate limited: unknown, not an error", async () => {
    const { check } = makeCheck({ respond: () => new NetworkError("request to … failed: timeout") });
    expect((await check.check()).status).toBe("unknown");
  });

  test("a release without a parseable tag: unknown", async () => {
    const { check } = makeCheck({ respond: () => ({ tag_name: "banana-weekly", html_url: "https://x" }) });
    expect((await check.check()).status).toBe("unknown");
  });

  test("missing html_url falls back to the releases page", async () => {
    const { check } = makeCheck({ respond: () => ({ tag_name: "v0.2.0" }) });
    expect((await check.check()).releaseUrl).toBe(RELEASES);
  });

  test("concurrent and later callers share one request", async () => {
    const { check, calls } = makeCheck({ respond: () => ({ tag_name: "v0.2.0", html_url: "https://x" }) });
    const [a, b] = await Promise.all([check.check(), check.check()]);
    expect(a).toEqual(b);
    await check.check();
    expect(calls()).toBe(1);
  });

  test("no token: one unauthenticated call, no Authorization header", async () => {
    const { check, calls, authHeaders } = makeCheck({ respond: () => ({ tag_name: "v0.1.1" }) });
    await check.check();
    expect(calls()).toBe(1);
    expect(authHeaders()).toEqual([undefined]);
  });

  test("token configured: sent as Bearer, single call when it works", async () => {
    const { check, calls, authHeaders } = makeCheck({
      respond: () => ({ tag_name: "v0.1.1" }),
      currentVersion: "0.1.1",
      token: "ghp_test",
    });
    expect((await check.check()).status).toBe("current");
    expect(calls()).toBe(1);
    expect(authHeaders()).toEqual(["Bearer ghp_test"]);
  });

  test("token rejected: one unauthenticated retry answers for a public repo", async () => {
    let n = 0;
    const { check, calls, authHeaders } = makeCheck({
      respond: () => (++n === 1 ? new NetworkError("GET … failed: HTTP 401", 401) : { tag_name: "v0.1.1" }),
      currentVersion: "0.1.1",
      token: "ghp_expired",
    });
    expect((await check.check()).status).toBe("current");
    expect(calls()).toBe(2);
    expect(authHeaders()).toEqual(["Bearer ghp_expired", undefined]);
  });

  test("token without access to the private repo: both attempts fail, unknown", async () => {
    const { check, calls, authHeaders } = makeCheck({
      respond: () => new NetworkError("GET … failed: HTTP 404", 404),
      currentVersion: "0.1.1",
      token: "ghp_limited",
    });
    expect((await check.check()).status).toBe("unknown");
    expect(calls()).toBe(2);
    expect(authHeaders()).toEqual(["Bearer ghp_limited", undefined]);
  });

  test("a failing check logs the redacted error and never the token", async () => {
    const { check } = makeCheck({
      respond: () => new NetworkError("request to … failed: timeout"),
      currentVersion: "0.1.1",
      token: "ghp_secret",
    });
    const lines: string[] = [];
    const orig = console.error;
    console.error = (m: unknown) => lines.push(String(m));
    try {
      await check.check();
    } finally {
      console.error = orig;
    }
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("check unavailable");
    expect(lines[0]).not.toContain("ghp_secret");
  });

  test("the releases URL is injectable (the integration mock relies on it)", async () => {
    const { check, askedUrl } = makeCheck({
      respond: () => ({ tag_name: "v0.1.1" }),
      currentVersion: "0.1.1",
      releasesUrl: "http://127.0.0.1:7/releases/latest",
    });
    await check.check();
    expect(askedUrl()).toBe("http://127.0.0.1:7/releases/latest");
  });
});

describe("the once-per-version toast gate", () => {
  test("a fresh check that finds a new version reports the toast pending exactly once, marking it shown", async () => {
    const { check, toastShown } = makeCheck({ respond: () => withZip("v0.2.0") });
    const first = await check.check(NOTIFY);
    expect(first.toastPending).toBe(true);
    // At-most-once: the version is marked the moment it is reported pending,
    // not when the frontend later shows anything.
    expect(toastShown()).toBe("0.2.0");

    // The next check — cached inside the day, or fresh the next day — can
    // never re-toast the same version.
    expect((await check.check(NOTIFY)).toastPending).toBe(false);
    expect(toastShown()).toBe("0.2.0");
  });

  test("an engine restart (new session over the same persisted state) never re-toasts", async () => {
    const h = makeCheck({ respond: () => withZip("v0.2.0") });
    expect((await h.check.check(NOTIFY)).toastPending).toBe(true);

    h.restart(); // plugin reload / Deck reboot: a fresh check object, same store
    expect((await h.check.check(NOTIFY)).toastPending).toBe(false);
    expect(h.calls()).toBe(1); // the cached answer, no network
    expect(h.toastShown()).toBe("0.2.0");

    // Even when the next day's check runs for real, the version is spent.
    h.restart({ now: NOW + DAY_MS + 1 });
    expect((await h.check.check(NOTIFY)).toastPending).toBe(false);
    expect(h.calls()).toBe(2);
  });

  test("a genuinely newer version earns exactly one more toast", async () => {
    const h = makeCheck({ respond: () => withZip("v0.2.0") });
    await h.check.check(NOTIFY); // toast for 0.2.0

    h.restart({ now: NOW + DAY_MS + 1, respond: () => withZip("v0.3.0") });
    expect((await h.check.check(NOTIFY)).toastPending).toBe(true);
    expect(h.toastShown()).toBe("0.3.0");

    h.restart();
    expect((await h.check.check(NOTIFY)).toastPending).toBe(false);
    expect(h.toastShown()).toBe("0.3.0");
  });

  test("a cached answer re-evaluates pending without touching the network", async () => {
    // First deploy of the gate: yesterday's stored answer already says
    // 0.2.0, but no toast was ever shown for it.
    const h = makeCheck({
      respond: () => {
        throw new Error("must not be asked");
      },
      stored: stampOf(),
      toastShownFor: null,
    });
    expect((await h.check.check(NOTIFY)).toastPending).toBe(true);
    expect(h.calls()).toBe(0);
    expect(h.toastShown()).toBe("0.2.0");

    // And never re-arms for the already-shown version.
    expect((await h.check.check(NOTIFY)).toastPending).toBe(false);
    expect(h.calls()).toBe(0);
  });

  test("a cached answer re-evaluated after the running version changed: the version you run never toasts", async () => {
    // The stamp says 0.2.0 (shown for it while 0.1.1 ran); the Deck has
    // since been updated to 0.2.0 by hand.
    const h = makeCheck({
      respond: () => {
        throw new Error("must not be asked");
      },
      currentVersion: "0.2.0",
      stored: stampOf(),
      toastShownFor: "0.2.0",
    });
    expect((await h.check.check(NOTIFY)).toastPending).toBe(false);
    // Even with no toast ever shown, running the newest release is "current".
    const fresh = makeCheck({
      respond: () => {
        throw new Error("must not be asked");
      },
      currentVersion: "0.2.0",
      stored: stampOf(),
      toastShownFor: null,
    });
    expect((await fresh.check.check(NOTIFY)).toastPending).toBe(false);
    expect(fresh.toastShown()).toBeNull();
  });

  test("a check that cannot run toasts nothing and leaves the mark untouched", async () => {
    const h = makeCheck({ respond: () => new NetworkError("request to … failed: timeout") });
    const result = await h.check.check(NOTIFY);
    expect(result.status).toBe("unknown");
    expect(result.toastPending).toBe(false);
    expect(h.toastShown()).toBeNull();

    // The toast is still owed once the check can actually run — after the
    // failure's backoff window has passed.
    h.restart({ now: NOW + HOUR_MS, respond: () => withZip("v0.2.0") });
    expect((await h.check.check(NOTIFY)).toastPending).toBe(true);
  });

  test("an up-to-date answer toasts nothing", async () => {
    const h = makeCheck({ respond: () => ({ tag_name: "0.1.1", html_url: "https://x" }) });
    expect((await h.check.check(NOTIFY)).toastPending).toBe(false);
    expect(h.toastShown()).toBeNull();
  });
  test("a check that does not ask for the toast neither reports nor spends it", async () => {
    // Options' refresh and system.updateStage: they show the panel, not a toast.
    const h = makeCheck({ respond: () => withZip("v0.2.0") });
    expect((await h.check.check()).toastPending).toBe(false);
    expect(h.toastShown()).toBeNull();

    // The next toast trigger (plugin load, wake) still gets it, from the stored answer.
    expect((await h.check.check(NOTIFY)).toastPending).toBe(true);
    expect(h.calls()).toBe(1);
  });

  test("concurrent quiet and toast callers share one request; the toast goes to one toast caller", async () => {
    const h = makeCheck({ respond: () => withZip("v0.2.0") });
    const answers = await Promise.all([h.check.check(), h.check.check(NOTIFY), h.check.check(NOTIFY)]);
    expect(answers.map((a) => a.toastPending)).toEqual([false, true, false]);
    expect(h.calls()).toBe(1);
  });

  test("a release without WoWDeck.zip yet holds the toast until the zip is there", async () => {
    // CI creates the release first and uploads the zip after: a check in
    // between must not spend the toast on a notice that has no Update.
    let zip = false;
    const h = makeCheck({ respond: () => (zip ? withZip("v0.2.0") : { tag_name: "v0.2.0", html_url: "https://x" }) });
    const early = await h.check.check(NOTIFY);
    expect(early.status).toBe("available");
    expect(early.toastPending).toBe(false);
    expect(h.toastShown()).toBeNull();

    zip = true;
    h.restart({ now: NOW + HOUR_MS });
    const later = await h.check.check(NOTIFY);
    expect(later.downloadUrl).toBe(ZIP);
    expect(later.toastPending).toBe(true);
  });
});

describe("the once-a-day cap", () => {
  test("inside the interval: the stored answer, no request at all", async () => {
    const { check, calls } = makeCheck({
      respond: () => {
        throw new Error("must not be asked");
      },
      stored: stampOf({ checkedAt: NOW - 60 * 60 * 1000 }),
    });
    expect(await check.check(NOTIFY)).toEqual({
      status: "available",
      currentVersion: "0.1.1",
      latestVersion: "0.2.0",
      releaseUrl: "https://github.com/sigboe/wowdeck/releases/tag/v0.2.0",
      downloadUrl: "https://api.github.com/repos/sigboe/wowdeck/releases/assets/7",
      checked: false,
      toastPending: true,
    });
    expect(calls()).toBe(0);
  });

  test("the stored answer is recomputed against the version running now", async () => {
    // The Deck updated to 0.2.0 minutes ago: the stamp still says the newest
    // release is 0.2.0, and that now means "up to date", without a call.
    const { check, calls } = makeCheck({
      respond: () => {
        throw new Error("must not be asked");
      },
      currentVersion: "0.2.0",
      stored: stampOf({ checkedAt: NOW - 60 * 1000 }),
    });
    expect(await check.check()).toEqual({
      status: "current",
      currentVersion: "0.2.0",
      latestVersion: "0.2.0",
      releaseUrl: "https://github.com/sigboe/wowdeck/releases/tag/v0.2.0",
      downloadUrl: null,
      checked: false,
      toastPending: false,
    });
    expect(calls()).toBe(0);
  });

  test("an available stamp without a published zip keeps downloadUrl null", async () => {
    const { check } = makeCheck({
      respond: () => {
        throw new Error("must not be asked");
      },
      stored: stampOf({ downloadUrl: null }),
    });
    expect((await check.check()).downloadUrl).toBeNull();
  });

  test("an available stamp without the zip is re-asked after an hour, not a day", async () => {
    const h = makeCheck({ respond: () => withZip("v0.2.0"), stored: stampOf({ checkedAt: NOW, downloadUrl: null }) });
    h.restart({ now: NOW + HOUR_MS - 1 });
    expect((await h.check.check()).checked).toBe(false);
    h.restart({ now: NOW + HOUR_MS });
    const again = await h.check.check();
    expect(again.checked).toBe(true);
    expect(again.downloadUrl).toBe(ZIP);
  });

  test("the stored zip survives a same-day rollback below the newest release", async () => {
    // Checked while running 0.2.0 ("current"), then rolled back to 0.1.1
    // inside the day: the stored answer offers 0.2.0 with its zip.
    const h = makeCheck({ respond: () => withZip("v0.2.0"), currentVersion: "0.2.0" });
    expect((await h.check.check()).downloadUrl).toBeNull();
    h.restart({ currentVersion: "0.1.1", now: NOW + 60 * 1000 });
    const rolledBack = await h.check.check();
    expect(rolledBack.status).toBe("available");
    expect(rolledBack.downloadUrl).toBe(ZIP);
    expect(h.calls()).toBe(1);
  });

  test("after the interval: one request, and the stamp moves to now", async () => {
    const old = stampOf({ checkedAt: NOW - DAY_MS - 1, latestVersion: "0.1.1" });
    const { check, calls, stamp } = makeCheck({
      respond: () => ({ tag_name: "v0.2.0", html_url: "https://x" }),
      stored: old,
    });
    expect((await check.check()).checked).toBe(true);
    expect(calls()).toBe(1);
    expect(stamp()).toEqual({
      checkedAt: NOW,
      latestVersion: "0.2.0",
      releaseUrl: "https://x",
      downloadUrl: null,
    });
  });

  test("exactly one interval old counts as due", async () => {
    const { check, calls } = makeCheck({
      respond: () => ({ tag_name: "v0.2.0" }),
      stored: stampOf({ checkedAt: NOW - DAY_MS }),
    });
    await check.check();
    expect(calls()).toBe(1);
  });

  test("a failed check does not burn the interval: the retry waits out the backoff, then succeeds", async () => {
    const old = stampOf({ checkedAt: NOW - DAY_MS - 1 });
    let n = 0;
    const h = makeCheck({
      respond: () => (++n === 1 ? new NetworkError("request to … failed: timeout") : { tag_name: "v0.2.0" }),
      stored: old,
    });
    // The day's attempt fails: the stored answer still serves, so the panel
    // does not vanish only to come back on the next trigger.
    const failed = await h.check.check();
    expect(failed.status).toBe("available");
    expect(failed.latestVersion).toBe("0.2.0");
    expect(failed.checked).toBe(true);
    expect(h.stamp()).toEqual(old); // the success stamp is untouched

    // The immediate re-trigger does not hit the network — the failure
    // backed off — but it also did not spend the day: after the window,
    // the retry runs and writes the stamp.
    h.restart({ now: NOW + HOUR_MS });
    expect((await h.check.check()).status).toBe("available");
    expect(h.calls()).toBe(2);
    expect(h.stamp()?.checkedAt).toBe(NOW + HOUR_MS);
    expect(h.backoff()).toBeNull();
  });

  test("no stamp yet (first run): one request", async () => {
    const { check, calls } = makeCheck({ respond: () => ({ tag_name: "v0.1.1" }) });
    await check.check();
    expect(calls()).toBe(1);
  });
});

describe("the failure backoff", () => {
  test("the first failure spaces the next network attempt by an hour", async () => {
    const h = makeCheck({ respond: () => new NetworkError("request to … failed: timeout") });
    expect((await h.check.check()).status).toBe("unknown"); // failure #1
    expect(h.calls()).toBe(1);

    // Inside the hour, a trigger (plugin load, wake, Options visit) must
    // not touch the network: the failure's answer serves, cached.
    h.restart({ now: NOW + HOUR_MS - 1 });
    const cached = await h.check.check();
    expect(cached.status).toBe("unknown");
    expect(cached.checked).toBe(false);
    expect(cached.toastPending).toBe(false);
    expect(h.calls()).toBe(1);

    // The hour done, the next trigger retries for real (and fails again).
    h.restart({ now: NOW + HOUR_MS });
    expect((await h.check.check()).status).toBe("unknown"); // failure #2
    expect(h.calls()).toBe(2);
  });

  test("within the window, the stored answer serves without a request", async () => {
    // Yesterday's check succeeded and stored "0.2.0"; today's attempt
    // failed. A trigger inside the backoff window gets that stored
    // answer — recomputed against the running version — never a new ask.
    let n = 0;
    const h = makeCheck({
      respond: () => (++n === 1 ? new NetworkError("request to … failed: timeout") : { tag_name: "v0.9.0" }),
      stored: stampOf({ checkedAt: NOW - DAY_MS - 1, latestVersion: "0.2.0" }),
    });
    // The day's attempt fails: the stored answer still serves, so the panel
    // does not vanish only to come back on the next trigger.
    const failed = await h.check.check();
    expect(failed.status).toBe("available");
    expect(failed.latestVersion).toBe("0.2.0");
    expect(failed.checked).toBe(true);

    h.restart({ now: NOW + 30 * 60 * 1000 });
    const cached = await h.check.check();
    expect(cached.status).toBe("available");
    expect(cached.latestVersion).toBe("0.2.0");
    expect(cached.checked).toBe(false);
    expect(h.calls()).toBe(1); // no second request
  });

  test("the ladder: a second failure waits two hours, the third and later four (capped)", async () => {
    const h = makeCheck({ respond: () => new NetworkError("request to … failed: timeout") });
    await h.check.check(); // failure #1 at NOW
    h.restart({ now: NOW + HOUR_MS });
    await h.check.check(); // failure #2 at +1h
    expect(h.calls()).toBe(2);

    // Inside the two-hour window: no ask.
    h.restart({ now: NOW + 3 * HOUR_MS - 1 });
    await h.check.check();
    expect(h.calls()).toBe(2);
    // The window done: failure #3.
    h.restart({ now: NOW + 3 * HOUR_MS });
    await h.check.check();
    expect(h.calls()).toBe(3);

    // The cap: four hours from the third failure on, never more.
    h.restart({ now: NOW + 7 * HOUR_MS - 1 });
    await h.check.check();
    expect(h.calls()).toBe(3);
    h.restart({ now: NOW + 7 * HOUR_MS });
    await h.check.check(); // failure #4
    expect(h.calls()).toBe(4);
    h.restart({ now: NOW + 11 * HOUR_MS - 1 });
    await h.check.check();
    expect(h.calls()).toBe(4);
    h.restart({ now: NOW + 11 * HOUR_MS });
    await h.check.check(); // failure #5 — still four hours
    expect(h.calls()).toBe(5);
  });

  test("a success resets the backoff and re-arms the daily cadence", async () => {
    let n = 0;
    const h = makeCheck({
      respond: () => (++n <= 2 ? new NetworkError("request to … failed: timeout") : { tag_name: "v0.1.1" }),
    });
    await h.check.check(); // failure #1
    h.restart({ now: NOW + HOUR_MS });
    await h.check.check(); // failure #2
    expect(h.backoff()).toEqual({ failedAt: NOW + HOUR_MS, failures: 2 });

    // The next window elapses and the check succeeds: the backoff is gone.
    h.restart({ now: NOW + 3 * HOUR_MS, respond: () => ({ tag_name: "v0.1.1" }) });
    expect((await h.check.check()).status).toBe("current");
    expect(h.backoff()).toBeNull();

    // The daily cadence alone rules again: an hour later — inside what a
    // live two-hour backoff would have refused, and inside the day — no ask.
    h.restart({
      now: NOW + 4 * HOUR_MS,
      respond: () => {
        throw new Error("must not be asked");
      },
    });
    const cached = await h.check.check();
    expect(cached.status).toBe("current");
    expect(cached.checked).toBe(false);
    expect(h.calls()).toBe(3);
  });

  test("a backoff opened before a restart still silences the next session's triggers", async () => {
    const h = makeCheck({ respond: () => new NetworkError("request to … failed: timeout") });
    await h.check.check(); // failure #1

    // Plugin reload / Deck reboot: a fresh engine session over the same
    // persisted state must honour the window, not re-ask.
    h.restart({
      now: NOW + 5 * 60 * 1000,
      respond: () => {
        throw new Error("must not be asked");
      },
    });
    const cached = await h.check.check();
    expect(cached.status).toBe("unknown");
    expect(cached.checked).toBe(false);
    expect(h.calls()).toBe(1);
  });
});
