import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PluginUpdateBackoff, PluginUpdateSnapshot, UpdateChannel } from "../backend/src/api/contracts";
import { NetworkError } from "../backend/src/wow/net/network";
import { DAY_MS, HOUR_MS } from "../backend/src/wow/notifications/CheckCadence";
import { compareVersions, PluginUpdateCheck } from "../backend/src/wow/notifications/PluginUpdateCheck";
import { PrBuildFollow } from "../backend/src/wow/plugin/PrBuildFollow";
import { PrBuildList } from "../backend/src/wow/plugin/PrBuildList";

const NOW = 1_800_000_000_000;
const RELEASES = "https://github.com/sigboe/wowdeck/releases";
/** A toast trigger (plugin load, wake): the only caller that may spend the toast. */
const NOTIFY = { notify: true };
const ZIP = "https://api.github.com/repos/sigboe/wowdeck/releases/assets/7";
const PR_INDEX = "https://sigboe.github.io/wowdeck/index.json";
const REPO_API = "https://api.github.com/repos/sigboe/wowdeck";
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
  /** The persisted update channel. */
  channel: () => UpdateChannel;
  /** The persisted PR channel: the PR whose channel the owner is on. */
  prChannel: () => number | null;
  lastRunVersion: () => string | null;
  /** A new engine session over the same persisted state (a restart). */
  restart: (over?: { currentVersion?: string; now?: number; respond?: (url: string) => unknown }) => void;
}

function makeCheck(options: {
  /** The fake GitHub API's answer; `url` tells releases/latest from the releases list. */
  respond: (url: string) => unknown;
  currentVersion?: string;
  releasesUrl?: string;
  token?: string;
  stored?: PluginUpdateSnapshot | null;
  toastShownFor?: string | null;
  channel?: UpdateChannel;
  /** The stored PR channel; a running PR build joined it on its first start. */
  prChannel?: number | null;
  lastRunVersion?: string | null;
  stagedVersion?: string | null;
  /** Move to Stable after release (GLOSSARY: Update channel); off when unset. */
  moveToStableAfterRelease?: boolean;
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
      const value = respond(url);
      if (value instanceof Error) throw value;
      return value as T;
    },
  };
  // The persisted state both engine sessions share (settings, in production).
  const persisted = {
    stamp: options.stored ?? null,
    toastShownFor: options.toastShownFor ?? null,
    backoff: null as PluginUpdateBackoff | null,
    channel: options.channel ?? null,
    lastRunVersion: options.lastRunVersion === undefined ? currentVersion : options.lastRunVersion,
    stagedVersion: options.stagedVersion ?? null,
    prChannel: options.prChannel ?? null,
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
        readLastRunVersion: () => persisted.lastRunVersion,
        writeLastRunVersion: (version) => {
          persisted.lastRunVersion = version;
        },
        readStagedVersion: () => persisted.stagedVersion,
        writeStagedVersion: (version) => {
          persisted.stagedVersion = version;
        },
        // Null until the owner picks one: the setting a pre-channel install has.
        readChannel: () => persisted.channel ?? "stable",
        writeChannel: (channel) => {
          persisted.channel = channel;
        },
        readPrChannel: () => persisted.prChannel,
        writePrChannel: (pr) => {
          persisted.prChannel = pr;
        },
        readMoveToStableAfterRelease: () => options.moveToStableAfterRelease ?? false,
      },
      {
        now: () => nowMs,
        // The PR channel's source asks the same fake net: the PR builds list
        // and, for a PR that left it, GitHub's API.
        prChannel: new PrBuildFollow(new PrBuildList(net, PR_INDEX), net, REPO_API),
      },
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
    channel: () => persisted.channel ?? "stable",
    prChannel: () => persisted.prChannel,
    lastRunVersion: () => persisted.lastRunVersion,
    restart(over = {}) {
      if (over.respond) respond = over.respond;
      if (over.currentVersion) currentVersion = over.currentVersion;
      if (over.now) nowMs = over.now;
      check = build();
    },
  };
}


import assert from 'node:assert/strict';
for(const on of [true,false]) {const h=makeCheck({currentVersion:'0.3.0',lastRunVersion:'0.3.0-beta.2',stagedVersion:'0.3.0',channel:'beta',moveToStableAfterRelease:on,respond:url=>url.includes('/releases?')?[withZip('v0.3.1-beta.1')]:withZip('v0.3.0')});h.check.recordStagedVersion('0.3.0');await h.check.check({force:true});assert.equal(h.check.channel(),on?'stable':'beta');h.restart();assert.equal(h.check.channel(),on?'stable':'beta');console.log(JSON.stringify({method:'DEVICE isolated engine fixture',case:'stable-after-beta preference '+on,result:'passed'}));}
