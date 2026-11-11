/**
 * Whether a newer WoWDeck release exists on GitHub — for the plugin
 * itself, not addons: the plugin is not in the official Decky store, so
 * nothing else tells the user an update exists. The check answers with one
 * ready offer (version, every surface's wording, plain-text notes, whether
 * it is installable); the packaged zip's URL stays in the engine, for
 * system.updateStage (UpdateStager, through forStaging) to stage for
 * Decky's own installer.
 *
 * Asks the channel's build source **at most once a day**, following the
 * same cadence rule as the addon check behind the SteamOS toast
 * (CheckCadence, own timestamp and interval): an engine session on a Deck
 * that sleeps can last weeks, so "once per session" would mean "possibly
 * never". The answer and the time it ran are persisted, which also lets a
 * restart inside the interval answer without a call — and lets the status be
 * recomputed against the running version, so a plugin that was just updated
 * reads "current" immediately instead of waiting out the day.
 *
 * The interval only advances on an answer. A failed check (offline, HTTP
 * 404, rate limited, a rejected token) is not a timestamp: it never
 * advances the daily stamp, and — since the check runs on natural triggers
 * only (plugin load, opening Options → Updates, waking the Deck) — the
 * retries back off instead, spaced 1h after the first failure, 2h after
 * the second, 4h after the third and every later one (capped), so an
 * unreachable GitHub is not re-asked by every trigger while still hearing
 * from the Deck several times a day. Any success resets the backoff and
 * re-arms the daily cadence. Failed checks stay completely silent: no
 * toast, no error, one structured stderr line (below).
 *
 * Check again (system.updateCheck's `force`) asks at once, past both
 * gates; so does system.updateStage (forStaging's `refresh`) when
 * the stored answer's zip is gone, so Update stages the release that
 * replaced it instead of failing until the next day's check.
 *
 * The builds come from the update channel's build source (BuildSource):
 * Stable asks GitHub's `releases/latest`, Beta lists the releases. Of the
 * candidates it returns, the newest is the answer. The stored answer
 * remembers its channel and serves only that channel, so a beta answered
 * yesterday is never offered on Stable today. Switching channel
 * (setChannel) checks at once, past the daily interval and any backoff.
 *
 * A running PR build is on its PR channel (GLOSSARY: PR channel) from its
 * first start until the owner picks Stable or Beta (setChannel). The PR
 * channel's source is the PR builds list (PrBuildFollow), under the same
 * cadence, backoff and toast rule: a newer listed build of the same PR is
 * offered as `prUpdate`; a listed PR with nothing newer is "current". A
 * merged PR waits for a beta containing its merge, then persists Beta
 * and offers that release as an update. Closed or unlisted PRs offer the
 * stored channel as the way back.
 *
 * Each ask of GitHub also calls onGitHubAsk, which refreshes Options ›
 * About's fetched files (ADR-0005). That refresh keeps no part of this
 * check's stamp or backoff, and neither side's failure fails the other.
 *
 * "unknown", never an error: the repo can be private beyond the token's
 * reach (the API answers 404), the Deck can be offline, GitHub can
 * rate-limit, the configured token can be rejected — none of that may
 * surface as a user-facing failure.
 */

import type { NetworkClient } from "../net/network";
import {
  type MethodMap,
  type PluginUpdateBackoff,
  type PluginUpdateOffer,
  type PluginUpdateSnapshot,
  PR_CHANNEL_OFFER_KINDS,
  type ServedChannel,
  type UpdateChannel,
} from "../../api/contracts";
import {
  type BuildSource,
  buildSources,
  type CandidateBuild,
  RELEASES_PAGE,
} from "../plugin/BuildSource";
import {
  compareVersions,
  isBetaVersion,
  isPrVersion,
  isTestVersion,
  prNumber,
} from "../plugin/PluginVersion";
import type { PrBuildFollow } from "../plugin/PrBuildFollow";
import { releaseNotesText } from "../plugin/ReleaseNotesText";
import { backoffIntervalMs, DAY_MS, HOUR_MS, isDue, SingleFlight } from "./CheckCadence";

export { compareVersions };

/** system.updateCheck's answer: the check's status and the one release on offer. */
export type PluginUpdateStatus = MethodMap["system.updateCheck"]["result"];

/** An answer before the per-caller toast gate. */
type GatelessStatus = Omit<PluginUpdateStatus, "toastPending">;

/** One run's answer: the wire answer plus the offered WoWDeck.zip's URL, which stays in the engine. */
type Answer = GatelessStatus & { downloadUrl: string | null };

/** What system.updateStage stages from. */
export type StagingAnswer = Pick<Answer, "status" | "offer" | "downloadUrl">;

/** Where the last answer is persisted: the engine's settings, an object in tests. */
export interface PluginUpdateStore {
  read(): PluginUpdateSnapshot | null;
  write(snapshot: PluginUpdateSnapshot): void;
  /** The failure backoff: consecutive failures and when the last one ran. */
  readBackoff(): PluginUpdateBackoff | null;
  /** Record the n-th consecutive failure, or clear the backoff on a success. */
  writeBackoff(backoff: PluginUpdateBackoff | null): void;
  /** The release version the toast was already shown for, when it was. */
  readToastShown(): string | null;
  /** Marks the version shown — called the moment a check reports it pending. */
  writeToastShown(version: string): void;
  /** The owner's update channel; Stable when none was ever picked. */
  readChannel(): UpdateChannel;
  writeChannel(channel: UpdateChannel): void;
  /** The PR whose PR channel the owner is on; null when on none. */
  readPrChannel(): number | null;
  writePrChannel(pr: number | null): void;
  /** Move to Stable after release (GLOSSARY: Update channel): off unless the owner turned it on. */
  readMoveToStableAfterRelease(): boolean;
  readLastRunVersion(): string | null;
  writeLastRunVersion(version: string): void;
  readStagedVersion(): string | null;
  writeStagedVersion(version: string): void;
}

function memoryStore(): PluginUpdateStore {
  let stamp: PluginUpdateSnapshot | null = null;
  let backoff: PluginUpdateBackoff | null = null;
  let toastShownFor: string | null = null;
  let channel: UpdateChannel = "stable";
  let prChannel: number | null = null;
  let lastRunVersion: string | null = null;
  let stagedVersion: string | null = null;
  return {
    read: () => stamp,
    write: (snapshot) => {
      stamp = snapshot;
    },
    readBackoff: () => backoff,
    writeBackoff: (value) => {
      backoff = value;
    },
    readToastShown: () => toastShownFor,
    writeToastShown: (version) => {
      toastShownFor = version;
    },
    readLastRunVersion: () => lastRunVersion,
    writeLastRunVersion: (version) => {
      lastRunVersion = version;
    },
    readStagedVersion: () => stagedVersion,
    writeStagedVersion: (version) => {
      stagedVersion = version;
    },
    readChannel: () => channel,
    writeChannel: (value) => {
      channel = value;
    },
    readPrChannel: () => prChannel,
    writePrChannel: (value) => {
      prChannel = value;
    },
    readMoveToStableAfterRelease: () => false,
  };
}

export interface PluginUpdateCheckOptions {
  /** The clock; tests pass their own. */
  now?: () => number;
  /**
   * Called each time this check is about to ask GitHub (a due check,
   * Check again, a channel switch, a staging refresh), never when the
   * stored answer or the backoff answers. Options › About refreshes its
   * fetched files here (ADR-0005). Fire and forget: the check neither
   * waits for it nor lets it fail the check.
   */
  onGitHubAsk?: () => void;
  /** The PR channel's source; without one a PR channel's check always fails. */
  prChannel?: Pick<PrBuildFollow, "standing">;
}

/** Where a check answers from: the stored Stable or Beta, or a PR's channel. */
type Source = { kind: "channel"; channel: UpdateChannel } | { kind: "pr"; number: number };

export class PluginUpdateCheck {
  #flight = new SingleFlight<Answer>();
  readonly #sources: Record<UpdateChannel, BuildSource>;
  readonly #now: () => number;
  readonly #onGitHubAsk: () => void;
  readonly #prChannel: Pick<PrBuildFollow, "standing">;

  constructor(
    net: Pick<NetworkClient, "getJson">,
    private currentVersion: string,
    /** Overridable like HUB_URL, so the integration test points it at its mock. */
    releasesUrl = "https://api.github.com/repos/sigboe/wowdeck/releases/latest",
    /** The addon source's optional GitHub token, reused when it can read this repo. */
    tokenProvider: () => string | undefined = () => undefined,
    /** The persisted answer and timestamp: this is the once-a-day cap. */
    private store: PluginUpdateStore = memoryStore(),
    {
      now = Date.now,
      onGitHubAsk = () => {},
      prChannel = { standing: async () => null },
    }: PluginUpdateCheckOptions = {},
  ) {
    this.#sources = buildSources(net, releasesUrl, tokenProvider);
    this.#now = now;
    this.#onGitHubAsk = onGitHubAsk;
    this.#prChannel = prChannel;
    // An installed build chooses its channel once. A restart keeps the
    // owner's choice; a stable package staged by our updater keeps it too.
    // A test build rides Beta: it is built from a branch past the newest
    // beta, so Beta's answer is the one it can act on. A PR build joins its
    // PR channel and keeps the owner's Stable or Beta (GLOSSARY: PR
    // channel): leaving the PR channel returns them there. Any other build
    // leaves the PR channel. Successful staging applies Move to Stable.
    if (this.store.readLastRunVersion() !== currentVersion) {
      const pr = prNumber(currentVersion);
      this.store.writePrChannel(pr);
      if (pr === null && (isBetaVersion(currentVersion) || isTestVersion(currentVersion))) {
        this.store.writeChannel("beta");
      } else if (
        pr === null &&
        this.store.readStagedVersion() !== currentVersion
      ) {
        this.store.writeChannel("stable");
      }
    }
    this.store.writeLastRunVersion(currentVersion);
  }

  /** Record only a package successfully staged and verified for Decky. */
  recordStagedVersion(version: string): void {
    this.store.writeStagedVersion(version);
    if (!isBetaVersion(version) && !isTestVersion(version) &&
        this.store.readChannel() === "beta" && this.store.readMoveToStableAfterRelease()) {
      this.store.writeChannel("stable");
    }
  }

  channel(): UpdateChannel {
    return this.store.readChannel();
  }

  /**
   * Store the channel and check it at once, past the daily interval and any
   * failure backoff, so the owner sees what the switch offers. Never spends
   * the toast: the owner is looking at Options already.
   */
  async setChannel(channel: UpdateChannel): Promise<PluginUpdateStatus> {
    // Apply the explicit choice after any old PR check's automatic transition.
    const answer = await this.#flight.runAfterPending(() => {
      this.store.writeChannel(channel);
      this.store.writePrChannel(null);
      const stored = this.store.read();
      if (stored?.mergedFromPr) {
        const { mergedFromPr: _, ...rest } = stored;
        this.store.write(rest);
      }
      return this.#run({ force: true });
    });
    return { ...toWire(answer), toastPending: false };
  }

  /**
   * The stored answer when the last check is inside the interval, otherwise
   * one network check (concurrent callers share it). Never throws.
   *
   * Only a toast trigger (plugin load, wake — `notify`) may report and spend
   * the version's toast; Options' refresh and system.updateStage show the
   * panel instead, so they must not use it up. The gate runs per caller,
   * after the shared run, so a toast caller joining a quiet one still gets it.
   *
   * `force` is Check again: it asks at once, past the daily interval and
   * any failure backoff, and its answer (or failure) counts like any other
   * check's. Like setChannel, it waits out a check in flight instead of
   * joining it, since that one may have been served from the stored answer.
   */
  async check(opts: { notify?: boolean; force?: boolean } = {}): Promise<PluginUpdateStatus> {
    const answer = toWire(
      await (opts.force
        ? this.#flight.runAfterPending(() => this.#run({ force: true }))
        : this.#flight.run(() => this.#run())),
    );
    return opts.notify ? this.#toastGate(answer) : { ...answer, toastPending: false };
  }

  /**
   * check()'s answer for system.updateStage, with the offered WoWDeck.zip's
   * URL. Never spends the toast: staging shows the panel already.
   *
   * `refresh` checks at once, past the daily interval and any failure
   * backoff, and its answer replaces the stored one: the stored zip
   * answered 404 (CI prunes older betas whenever a new one publishes). Like
   * setChannel, it waits out a check in flight instead of joining it, since
   * that one may still hand back the gone zip.
   */
  async forStaging({ refresh = false }: { refresh?: boolean } = {}): Promise<StagingAnswer> {
    const { status, offer, downloadUrl } = refresh
      ? await this.#flight.runAfterPending(() => this.#run({ force: true }))
      : await this.#flight.run(() => this.#run());
    return { status, offer, downloadUrl };
  }

  async #run({ force = false } = {}): Promise<Answer> {
    const source = this.#source();
    const stored = this.store.read();
    // Only this channel's answer serves.
    const stamp = stored !== null && serves(stored, source) ? stored : null;
    const now = this.#now();
    if (!force && !isDue(stamp?.checkedAt ?? null, now, this.#interval(stamp))) {
      return this.#fromStamp(stamp!);
    }
    // The day's check is due, but failures back off: within the window the
    // stored answer serves — no request, `checked` false — exactly like the
    // daily cap's cached answer, so a Deck that cannot reach GitHub is not
    // re-asked by every trigger (plugin load, wake, Options visit).
    const backoff = this.store.readBackoff();
    if (
      !force &&
      backoff !== null &&
      !isDue(backoff.failedAt, now, backoffIntervalMs(backoff.failures))
    ) {
      return stamp !== null ? this.#fromStamp(stamp) : this.#unknown(false);
    }
    try {
      this.#onGitHubAsk();
    } catch (err) {
      console.error(`[plugin-update] onGitHubAsk failed: ${String(err)}`);
    }
    // While the PR build still runs, every replacement beta must pass
    // containment again, including the stager's recovery from a removed zip.
    const mergedPr = source.kind === "channel" && source.channel === "beta" &&
      stored?.mergedFromPr === this.currentVersion ? prNumber(this.currentVersion) : null;
    const fresh = source.kind === "pr"
      ? await this.#fetchPr(source.number, stored)
      : mergedPr !== null
        ? await this.#fetchPr(mergedPr, stored)
        : await this.#fetch(source.channel);
    if (fresh !== null) {
      const snapshot = { ...fresh, checkedAt: this.#now() };
      this.store.write(snapshot);
      // A success re-arms the plain daily cadence.
      this.store.writeBackoff(null);
      return { ...this.#fromStamp(snapshot), checked: true };
    }
    const failures = (backoff?.failures ?? 0) + 1;
    this.store.writeBackoff({ failedAt: this.#now(), failures });
    // A failure keeps serving the stored answer, as inside the backoff
    // window: otherwise the panel would vanish on the failed attempt and
    // come back on the next trigger.
    return stamp !== null
      ? { ...this.#fromStamp(stamp), checked: true, failed: true }
      : this.#unknown(true);
  }

  /**
   * How long the stored answer holds: a day, except an available release
   * whose WoWDeck.zip was not attached yet (CI uploads it after creating the
   * release) — that one is re-asked hourly, so Update does not wait a day.
   */
  #interval(stamp: PluginUpdateSnapshot | null): number {
    if (stamp === null) return DAY_MS;
    const answer = this.#fromStamp(stamp);
    return answer.offer !== null && answer.downloadUrl === null ? HOUR_MS : DAY_MS;
  }

  /**
   * The once-per-release-version toast gate. True only when this answer
   * offers a newer release, with its WoWDeck.zip (the toast says "Update in
   * Options"; without the zip there is no Update), the toast was not yet
   * shown for — and the moment
   * that is reported, the version is marked shown, so no later re-check
   * (cached inside the day, fresh the next day, a restarted engine) can
   * ever re-toast it. A genuinely newer version is a new key and earns its
   * own single toast. Everything else — "current", "unknown" — never toasts.
   *
   * At-most-once by design: marking happens when pending is *reported*, so
   * a caller that drops the answer spends the toast — one lost toast beats
   * a nagging one.
   */
  #toastGate(result: GatelessStatus): PluginUpdateStatus {
    // On a PR build only the PR channel's own offers toast (GLOSSARY: PR
    // channel); its way out waits in Options.
    const toasts =
      result.offer?.installable &&
      (!isPrVersion(this.currentVersion) || isPrChannelOffer(result.offer));
    const candidate = toasts ? result.offer!.version : null;
    if (candidate === null) {
      return { ...result, toastPending: false };
    }
    const pending = this.store.readToastShown() !== candidate;
    if (pending) {
      this.store.writeToastShown(candidate);
    }
    return { ...result, toastPending: pending };
  }

  /** Where this check answers from: the running PR build's PR channel while it is on it. */
  #source(): Source {
    const pr = prNumber(this.currentVersion);
    if (pr !== null && this.store.readPrChannel() === pr) {
      return { kind: "pr", number: pr };
    }
    return { kind: "channel", channel: this.store.readChannel() };
  }

  /** The channel an answer serves (the wire's `channel`): null on a test build off any channel. */
  #served(stamp: PluginUpdateSnapshot | null): ServedChannel | null {
    const source = this.#source();
    if (source.kind === "pr") {
      return { kind: "pr", number: source.number, title: stamp?.pr?.title ?? null };
    }
    return isTestVersion(this.currentVersion) && stamp?.mergedFromPr !== this.currentVersion
      ? null
      : { kind: source.channel };
  }

  /** The stored answer, compared against the version running right now. */
  #fromStamp(stamp: PluginUpdateSnapshot): Answer {
    const cmp = compareVersions(stamp.latestVersion, this.currentVersion);
    if (cmp === null) {
      return this.#unknown(false);
    }
    const channel = this.#served(stamp);
    if (stamp.pr?.state === "listed") {
      return this.#prListed(stamp, cmp, channel);
    }
    if (stamp.pr?.state === "merged") {
      const headline = `PR #${stamp.pr.number} was merged. A beta with it is still building`;
      return {
        status: "available",
        currentVersion: this.currentVersion,
        channel,
        offer: {
          kind: "prMergedBuilding",
          version: this.currentVersion,
          headline,
          buttonLabel: "",
          toastBody: "",
          rowLabel: headline,
          releaseNotes: null,
          releaseUrl: pullPage(stamp.pr.number),
          installable: false,
        },
        downloadUrl: null,
        checked: false,
        failed: false,
      };
    }
    if (stamp.pr?.state === "closed" || stamp.pr?.state === "unlisted") {
      const closed = stamp.pr.state === "closed";
      const headline = closed
        ? `PR #${stamp.pr.number} was closed`
        : `PR #${stamp.pr.number} is no longer listed`;
      const switchLabel = `Switch to ${stampChannel(stamp)} ${stamp.latestVersion}`;
      return {
        status: "available",
        currentVersion: this.currentVersion,
        channel,
        offer: {
          kind: closed ? "prClosed" : "prUnlisted",
          version: stamp.latestVersion,
          headline,
          buttonLabel: switchLabel,
          toastBody: "Switch in Options",
          rowLabel: headline,
          releaseNotes: stamp.releaseNotes ? releaseNotesText(stamp.releaseNotes) : null,
          releaseUrl: stamp.releaseUrl ?? RELEASES_PAGE,
          installable: stamp.downloadUrl !== null,
        },
        downloadUrl: stamp.downloadUrl,
        checked: false,
        failed: false,
      };
    }
    // Stable never offers an older build — except to a running beta, which
    // is on the wrong channel: leaving Beta offers the latest stable.
    const betaOnStable = stampChannel(stamp) === "stable" && isBetaVersion(this.currentVersion);
    // A test build is not on a channel: its owner needs the way back to a
    // published one, so the channel's newest build is offered however it
    // compares (a genuinely newer build took the "update" branch above).
    const mergedBeta = stamp.mergedFromPr === this.currentVersion;
    const leaveTest = cmp <= 0 && isTestVersion(this.currentVersion) && !mergedBeta;
    const switchToStable = cmp < 0 && betaOnStable;
    if (cmp <= 0 && !switchToStable && !leaveTest && !mergedBeta) {
      return {
        status: "current",
        currentVersion: this.currentVersion,
        channel,
        offer: null,
        downloadUrl: null,
        checked: false,
        failed: false,
      };
    }
    const version = stamp.latestVersion;
    if (leaveTest) {
      // The stored answer's channel is the one the owner would land on.
      const channelName = stampChannel(stamp) === "beta" ? "beta" : "stable";
      const switchLabel = `Switch to ${channelName} ${version}`;
      return {
        status: "available",
        currentVersion: this.currentVersion,
        channel,
        offer: {
          kind: "leaveTest",
          version,
          headline: switchLabel,
          buttonLabel: switchLabel,
          toastBody: "Switch in Options",
          rowLabel: switchLabel,
          releaseNotes: stamp.releaseNotes ? releaseNotesText(stamp.releaseNotes) : null,
          releaseUrl: stamp.releaseUrl ?? RELEASES_PAGE,
          installable: stamp.downloadUrl !== null,
        },
        downloadUrl: stamp.downloadUrl,
        checked: false,
        failed: false,
      };
    }
    const switchLabel = `Switch to stable ${version}`;
    return {
      status: "available",
      currentVersion: this.currentVersion,
      channel,
      offer: {
        kind: mergedBeta ? "prMergedBeta" : switchToStable ? "switchToStable" : "update",
        version,
        headline: switchToStable ? switchLabel : `WoWDeck ${version} available`,
        buttonLabel: switchToStable ? switchLabel : "Update",
        toastBody: switchToStable ? "Install it in Options" : "Update in Options",
        rowLabel: switchToStable ? switchLabel : "WoWDeck update available",
        releaseNotes: stamp.releaseNotes ? releaseNotesText(stamp.releaseNotes) : null,
        releaseUrl: stamp.releaseUrl ?? RELEASES_PAGE,
        installable: stamp.downloadUrl !== null,
      },
      downloadUrl: stamp.downloadUrl,
      checked: false,
      failed: false,
    };
  }

  /**
   * "unknown"; `failed` marks a network attempt that just failed. Only a
   * failure reports "unknown" after a network attempt, so `checked` follows it.
   */
  #unknown(failed: boolean): Answer {
    return {
      status: "unknown",
      currentVersion: this.currentVersion,
      channel: this.#served(this.#servingStamp()),
      offer: null,
      downloadUrl: null,
      checked: failed,
      failed,
    };
  }

  /** The stored answer when it serves the current source (its PR's title, for an unknown answer). */
  #servingStamp(): PluginUpdateSnapshot | null {
    const stored = this.store.read();
    return stored !== null && serves(stored, this.#source()) ? stored : null;
  }

  /**
   * A listed PR's stored answer: its newer build as `prUpdate`, otherwise
   * "current". The zip's URL is never what staging uses: Update reads the
   * list again (UpdateStager).
   */
  #prListed(stamp: PluginUpdateSnapshot, cmp: number, channel: ServedChannel | null): Answer {
    if (cmp <= 0) {
      return {
        status: "current",
        currentVersion: this.currentVersion,
        channel,
        offer: null,
        downloadUrl: null,
        checked: false,
        failed: false,
      };
    }
    const headline = `PR #${stamp.pr!.number} has a newer build`;
    const offer: PluginUpdateOffer = {
      kind: "prUpdate",
      version: stamp.latestVersion,
      headline,
      buttonLabel: `Update to ${stamp.latestVersion}`,
      toastBody: "Update in Options",
      rowLabel: headline,
      releaseNotes: null,
      releaseUrl: stamp.releaseUrl ?? RELEASES_PAGE,
      installable: true,
    };
    return {
      status: "available",
      currentVersion: this.currentVersion,
      channel,
      offer,
      downloadUrl: stamp.downloadUrl,
      checked: false,
      failed: false,
    };
  }

  /**
   * One ask of the PR channel's source: the PR's listed build, or, for a
   * PR no longer listed, the stored channel's newest build with where the
   * PR stands. The PR's title is the list's; a PR off the list keeps the
   * title its last stored answer had. Null when the check could not run.
   */
  async #fetchPr(
    number: number,
    stored: PluginUpdateSnapshot | null,
  ): Promise<PluginUpdateSnapshot | null> {
    const standing = await this.#prChannel.standing(number);
    if (standing === null) return null;
    const channel = this.store.readChannel();
    if (standing.state === "listed") {
      const { build } = standing;
      return {
        checkedAt: 0,
        channel,
        latestVersion: build.version,
        releaseUrl: pullPage(number),
        downloadUrl: build.zipUrl,
        pr: { number, title: build.title, state: "listed" },
      };
    }
    if (standing.state === "merged") {
      const title = stored?.pr?.number === number ? stored.pr.title : null;
      if (standing.beta !== null) {
        // Pin the release that passed the merge comparison, rather than a
        // newer candidate which may have appeared between the two reads.
        const builds = await this.#sources.beta.candidates();
        const beta = builds?.find((build) => build.version === standing.beta);
        if (beta?.downloadUrl) {
          this.store.writeChannel("beta");
          this.store.writePrChannel(null);
          return {
            checkedAt: 0,
            channel: "beta",
            latestVersion: beta.version,
            mergedFromPr: this.currentVersion,
            releaseUrl: beta.releaseUrl,
            downloadUrl: beta.downloadUrl,
            ...(beta.releaseNotes !== null && { releaseNotes: beta.releaseNotes }),
          };
        }
      }
      this.store.writePrChannel(number);
      return {
        checkedAt: 0,
        channel,
        latestVersion: this.currentVersion,
        releaseUrl: pullPage(number),
        downloadUrl: null,
        pr: { number, title, state: "merged" },
      };
    }
    const fallback = await this.#fetch(channel);
    if (fallback === null) return null;
    const title = stored?.pr?.number === number ? stored.pr.title : null;
    return { ...fallback, pr: { number, title, state: standing.state } };
  }

  /**
   * One ask of the channel's build source: its newest candidate as a
   * snapshot to store (checkedAt still unset), or null when the check could
   * not run or found no build with a parseable version.
   */
  async #fetch(channel: UpdateChannel): Promise<PluginUpdateSnapshot | null> {
    const builds = await this.#sources[channel].candidates();
    let newest: CandidateBuild | null = null;
    for (const build of builds ?? []) {
      // Sources only return parseable versions, so the comparison never
      // answers "can't tell" here.
      if (newest === null || (compareVersions(build.version, newest.version) ?? 0) > 0)
        newest = build;
    }
    if (newest === null || compareVersions(newest.version, this.currentVersion) === null)
      return null;
    // The zip is stored whatever the running version: a same-day rollback
    // below this release then still finds it (#fromStamp exposes it only
    // while the release is newer, or a switch to stable).
    return {
      checkedAt: 0,
      channel,
      latestVersion: newest.version,
      releaseUrl: newest.releaseUrl,
      downloadUrl: newest.downloadUrl,
      ...(newest.releaseNotes !== null && { releaseNotes: newest.releaseNotes }),
    };
  }
}

/** An answer as system.updateCheck sends it: the zip's URL stays in the engine. */
function toWire({ downloadUrl: _, ...answer }: Answer): GatelessStatus {
  return answer;
}

/** Whether a stored answer serves this source: a PR channel's answers serve only that PR's channel. */
function serves(stamp: PluginUpdateSnapshot, source: Source): boolean {
  if (source.kind === "pr") return stamp.pr?.number === source.number;
  return stamp.pr === undefined && stampChannel(stamp) === source.channel;
}

function isPrChannelOffer(offer: PluginUpdateOffer): boolean {
  return (PR_CHANNEL_OFFER_KINDS as readonly string[]).includes(offer.kind);
}

/** A pull request's page, beside the releases page. */
function pullPage(number: number): string {
  return RELEASES_PAGE.replace(/\/releases$/, `/pull/${number}`);
}

/** The channel a stored answer came from; one from before channels was Stable's. */
function stampChannel(stamp: PluginUpdateSnapshot): UpdateChannel {
  return stamp.channel ?? "stable";
}
