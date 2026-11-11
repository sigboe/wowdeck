/**
 * Stages a newer WoWDeck release for Decky's own installer
 * (system.updateStage): download the release's WoWDeck.zip — with the
 * same optional GitHub token the update check uses, so a still-private
 * repo answers — verify it end to end, and leave it as a 0600 file in
 * the OS temp dir. The UI hands the returned file:// artifact, version
 * and sha256 to Decky's utilities/install_plugin, whose native prompt
 * installs and reloads the plugin. This module never extracts or
 * replaces installed plugin files; decky-loader does the installing.
 *
 * Verifying before the prompt is load-bearing, not politeness: the
 * loader replaces the running plugin's files before its own hash check
 * (decky-loader #985), so a wrong or corrupt zip must be rejected here
 * with nothing staged, and the loader only ever receives an
 * already-verified hash. The file:// artifact (never a remote URL) is
 * deliberate for the same reason — the loader's remote path counts
 * store installs (decky-loader #984). Modelled on Decktation's updater
 * (silverfoxy/decktation), which stages the same way for the same
 * reasons; verified against decky-loader 3.3.0 source.
 *
 * The stored update answer can outlive its zip: CI prunes older betas
 * whenever a new one publishes, so the offered asset may answer 404. Only
 * that 404 asks the update check for a forced answer and stages from it,
 * once — which may be a different release. Every other failure (offline,
 * 5xx, rate limited, a damaged or wrong package) is reported as is.
 *
 * Both paths report the download's bytes through `progress`
 * (system.downloadProgress) and can be cancelled (system.cancelDownload):
 * a cancelled download deletes its partial file, stages nothing and
 * answers "cancelled". One download runs at a time per stager; the panel
 * and the PR builds modal both disable their buttons while one runs.
 *
 * The staged file intentionally outlives the RPC — the native prompt
 * may sit unanswered, and cancelling leaves the file — so stage()
 * first removes our staging files older than a day (SteamOS clears
 * /tmp on boot anyway; this is belt and braces).
 */

import { chmodSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unzip } from "fflate";
import type { EventMap } from "../../api/contracts";
import type { DownloadOptions, NetworkClient } from "../net/network";
import type { PluginUpdateCheck, StagingAnswer } from "../notifications/PluginUpdateCheck";
import type { PrBuildList, PublishedPrBuild } from "./PrBuildList";
import { prNumber } from "./PluginVersion";
import { NetworkError } from "../net/network";
import { InstallError } from "../errors";

export interface StagedUpdate {
  /** The file:// URL of the staged zip — what utilities/install_plugin takes. */
  artifact: string;
  version: string;
  sha256: string;
}

export type StageOutcome = {
  result: StagedUpdate | null;
  error: { code: string; message: string } | null;
};

/** plugin.json's name; also the packaged zip's inner folder (tools/package.py). */
const PLUGIN_NAME = "WoWDeck";
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * Where a release carries its engine: bin/wowdeck up to 1.0.1, then one
 * binary per architecture named after `uname -m` (#54). Accepting the new
 * name is what lets this version update to those releases.
 */
const ENGINE_ENTRIES = ["wowdeck/bin/wowdeck", "wowdeck/bin/wowdeck-x86_64"];

/** The staged zip's file name for a release version; the stale sweep matches the same prefix. */
export function stagedFileName(version: string): string {
  return `wowdeck-update-${version}.zip`;
}

/** Where a stage logs: a release or beta, or a PR build. */
type LogTag = "[self-update]" | "[pr-builds]";

/** The offered zip answered 404: the stored answer is stale. */
const GONE = Symbol("gone");
const DOWNLOAD_FAILED = outcome("download_failed", "Couldn't download the update. Try again");
const CANCELLED = outcome("cancelled", "The download was cancelled");

/** At most this many progress events per download, past the first and the last. */
const PROGRESS_STEPS = 100;

export type DownloadProgress = EventMap["system.downloadProgress"];

export class UpdateStager {
  constructor(
    private net: Pick<NetworkClient, "downloadToFile">,
    /**
     * The update check's answer with the zip's URL; `refresh` forces a
     * fresh check. Never spends the toast.
     */
    private check: Pick<PluginUpdateCheck, "forStaging" | "recordStagedVersion">,
    private tokenProvider: () => string | undefined = () => undefined,
    private tempDir: string = tmpdir(),
    /** system.downloadProgress: the download's bytes, in order. */
    private progress: (event: DownloadProgress) => void = () => {},
    /** The published PR builds: a PR build's zip and checksum come only from here. */
    private prBuilds: Pick<PrBuildList, "list"> = { list: async () => null },
  ) {}

  /** The staging operation, including metadata lookup and verification. */
  #inFlight: AbortController | null = null;
  #received = 0;

  /**
   * Cancel the download in flight (system.cancelDownload): its stage
   * answers "cancelled". False, and nothing changes, when none runs.
   */
  cancel(): boolean {
    if (this.#inFlight === null || this.#inFlight.signal.aborted) {
      return false;
    }
    this.#inFlight.abort();
    return true;
  }

  async #operation(run: () => Promise<StageOutcome>): Promise<StageOutcome> {
    if (this.#inFlight !== null) {
      return outcome("download_in_progress", "An update is already being prepared");
    }
    this.#inFlight = new AbortController();
    this.#received = 0;
    try {
      return await run();
    } finally {
      this.#inFlight = null;
    }
  }

  stage(): Promise<StageOutcome> {
    return this.#operation(() => this.#stage());
  }

  async #stage(): Promise<StageOutcome> {
    const first = await this.#stageFrom(await this.check.forStaging());
    if (first !== GONE) {
      return first;
    }
    // One forced check and one retry, never a loop: a forced answer that
    // still names the gone zip (or a failed check serving it) fails as is.
    const retry = await this.#stageFrom(await this.check.forStaging({ refresh: true }));
    return retry === GONE ? DOWNLOAD_FAILED : retry;
  }

  /**
   * Download `url` to `zipPath` under the staging operation's abort signal, reporting its
   * bytes against `knownTotal` (else the response's Content-Length). The
   * controller stays in #inFlight until staging finishes, so
   * a cancel that lands with the last byte still counts.
   */
  async #download(
    url: string,
    zipPath: string,
    version: string,
    options: Omit<DownloadOptions, "signal" | "onProgress">,
    knownTotal: number | null = null,
  ): Promise<void> {
    const controller = this.#inFlight!;
    if (controller.signal.aborted) throw new NetworkError("download aborted");
    let sent = -1;
    let step = 1;
    const report = (received: number, total: number | null, last = false) => {
      if (received === sent || (!last && sent >= 0 && received - sent < step)) {
        return;
      }
      sent = received;
      this.#received = received;
      this.progress({ version, received, total });
    };
    // The start goes out once the total is known: at once from the list,
    // else with the response's headers (the first chunk).
    let total = knownTotal;
    if (knownTotal !== null) {
      report(0, total);
    }
    const bytes = await this.net.downloadToFile(url, zipPath, {
      ...options,
      signal: controller.signal,
      onProgress: (received, length) => {
        total = knownTotal ?? length;
        report(0, total);
        step = total === null ? 1024 * 1024 : Math.max(1, Math.floor(total / PROGRESS_STEPS));
        report(received, total, total !== null && received >= total);
      },
    });
    if (controller.signal.aborted) {
      throw new NetworkError("download aborted");
    }
    report(bytes, total, true);
  }

  /** True when the staging operation was cancelled. */
  #cancelled(): boolean {
    const cancelled = this.#inFlight?.signal.aborted === true;
    return cancelled;
  }

  async #stageFrom({ status, offer, downloadUrl }: StagingAnswer): Promise<StageOutcome | typeof GONE> {
    if (this.#cancelled()) return CANCELLED;
    if (offer === null) {
      return status === "current"
        ? outcome("up_to_date", "WoWDeck is already up to date")
        : outcome("check_unavailable", "Couldn't check for a newer release");
    }
    // The PR channel's offer stages through the PR build path (GLOSSARY:
    // PR channel), never from the stored answer's URL.
    const pr = offer.kind === "prUpdate" ? prNumber(offer.version) : null;
    if (pr !== null) {
      return this.#stageListedPrBuild(pr, offer.version);
    }
    if (!downloadUrl) {
      return outcome("no_download", "The release has no WoWDeck.zip to install");
    }
    const { version } = offer;
    const zipPath = join(this.tempDir, stagedFileName(version));
    this.#sweepStale(zipPath);
    try {
      const token = this.tokenProvider()?.trim();
      // Token first, one unauthenticated retry — the check's own
      // never-worse rule (the token may be expired, or lack the repo).
      // The API asset URL needs the octet-stream Accept to answer with
      // the file; both headers stay on its own host, so GitHub's
      // redirect to its storage host never carries the token.
      const accept = { Accept: "application/octet-stream" };
      const headers: Record<string, string>[] = token
        ? [{ ...accept, Authorization: `Bearer ${token}` }, accept]
        : [accept];
      const trustedHostsForHeaders = [new URL(downloadUrl).hostname];
      let failure: unknown;
      let downloaded = false;
      for (const header of headers) {
        try {
          await this.#download(downloadUrl, zipPath, version, { headers: header, trustedHostsForHeaders });
          downloaded = true;
          break;
        } catch (err) {
          failure = err;
          if (this.#inFlight?.signal.aborted || this.#received > 0) {
            break;
          }
        }
      }
      if (this.#cancelled()) {
        rmSync(zipPath, { force: true });
        console.error({ operation: "self-update", version, outcome: "cancelled" });
        return CANCELLED;
      }
      if (!downloaded) {
        rmSync(zipPath, { force: true });
        console.error(
          `[self-update] download failed: ${failure instanceof Error ? failure.message : String(failure)}`,
        );
        return failure instanceof NetworkError && failure.status === 404 ? GONE : DOWNLOAD_FAILED;
      }
      return await this.#verifyAndRecord(zipPath, version, "[self-update]");
    } catch (err) {
      return this.#removeAndRefuse(zipPath, err, "[self-update]");
    }
  }

  /**
   * Stage PR `number`'s build at exactly `version` (system.installPrBuild,
   * and Update on the PR channel): the list is read again, so the zip's
   * URL and checksum never come from the caller, and the build must still
   * be the one confirmed or offered.
   */
  stageListedPrBuild(number: number, version: string): Promise<StageOutcome> {
    return this.#operation(() => this.#stageListedPrBuild(number, version));
  }

  async #stageListedPrBuild(number: number, version: string): Promise<StageOutcome> {
    const builds = await this.prBuilds.list();
    if (this.#cancelled()) return CANCELLED;
    if (builds === null) {
      return outcome("list_unavailable", "Couldn't load PR builds. Check the connection and try again");
    }
    const build = builds.find((b) => b.number === number);
    if (build === undefined || build.version !== version) {
      return outcome("not_listed", `PR #${number} has changed since the list opened. Open PR builds again`);
    }
    return this.#stagePrBuild(build);
  }

  /**
   * Stage a listed PR build: its zip from Pages,
   * refused unless it matches the sha256 the list publishes, then verified
   * like a release. Pages is public, so no token is sent; the stored
   * update channel is never touched.
   */
  stagePrBuild(
    build: Pick<PublishedPrBuild, "number" | "version" | "sha256" | "zipUrl" | "zipSize">,
  ): Promise<StageOutcome> {
    return this.#operation(() => this.#stagePrBuild(build));
  }

  async #stagePrBuild(
    build: Pick<PublishedPrBuild, "number" | "version" | "sha256" | "zipUrl" | "zipSize">,
  ): Promise<StageOutcome> {
    const { version } = build;
    const zipPath = join(this.tempDir, stagedFileName(version));
    this.#sweepStale(zipPath);
    try {
      let failure: unknown = null;
      try {
        await this.#download(build.zipUrl, zipPath, version, {}, build.zipSize);
      } catch (err) {
        failure = err;
      }
      if (this.#cancelled()) {
        rmSync(zipPath, { force: true });
        console.error({ operation: "pr-builds", pr: build.number, version, outcome: "cancelled" });
        return CANCELLED;
      }
      if (failure !== null) {
        const err = failure;
        rmSync(zipPath, { force: true });
        console.error(
          `[pr-builds] download of PR #${build.number} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        return outcome("download_failed", "Couldn't download the PR build. Try again");
      }
      if (sha256OfFile(zipPath) !== build.sha256) {
        rmSync(zipPath, { force: true });
        console.error(`[pr-builds] PR #${build.number}'s zip does not match its published sha256; refused`);
        return outcome(
          "checksum_mismatch",
          "The download doesn't match the published PR build, so it wasn't installed",
        );
      }
      return await this.#verifyAndRecord(zipPath, version, "[pr-builds]");
    } catch (err) {
      return this.#removeAndRefuse(zipPath, err, "[pr-builds]");
    }
  }

  /**
   * Verify the downloaded package, make it 0600 and record it as staged,
   * logging under `log`. Throws when it isn't WoWDeck `version`.
   */
  async #verifyAndRecord(zipPath: string, version: string, log: LogTag): Promise<StageOutcome> {
    const sha256 = sha256OfFile(zipPath);
    await this.#verifyPackage(zipPath, version);
    if (this.#cancelled()) {
      rmSync(zipPath, { force: true });
      return CANCELLED;
    }
    chmodSync(zipPath, 0o600);
    console.error(`${log} staged WoWDeck ${version} for Decky's installer (sha256 ${sha256.slice(0, 8)}…)`);
    this.check.recordStagedVersion(version);
    return { result: { artifact: `file://${zipPath}`, version, sha256 }, error: null };
  }

  /** Delete the download and say why it was refused: nothing is staged on any failure. */
  #removeAndRefuse(zipPath: string, err: unknown, log: LogTag): StageOutcome {
    rmSync(zipPath, { force: true });
    if (this.#cancelled()) return CANCELLED;
    if (!(err instanceof InstallError)) {
      console.error(`${log} staging failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    return outcome(
      "archive_invalid",
      err instanceof InstallError ? err.message : "The update couldn't be prepared. Try again",
    );
  }

  /** Remove our staging files older than a day; a cancelled prompt leaves one behind. */
  #sweepStale(current: string): void {
    try {
      for (const name of readdirSync(this.tempDir)) {
        if (!/^wowdeck-update-.*\.zip$/.test(name)) {
          continue;
        }
        const path = join(this.tempDir, name);
        if (path === current) {
          continue;
        }
        try {
          if (Date.now() - statSync(path).mtimeMs > STALE_AFTER_MS) {
            rmSync(path, { force: true });
          }
        } catch {
          // unreadable or already gone: not worth failing a stage over
        }
      }
    } catch {
      // the temp dir itself is unreadable; the download will say so
    }
  }

  /**
   * The package check the loader never does (#985): a readable zip in
   * the packaged layout — the wowdeck/ folder with both manifests, the
   * Python entry, the frontend bundle and the engine — whose
   * plugin.json names WoWDeck at exactly the release's version.
   */
  async #verifyPackage(zipPath: string, version: string): Promise<void> {
    const entries = await new Promise<Map<string, Uint8Array>>((resolve, reject) => {
      unzip(readFileSync(zipPath), (err, unzipped) => {
        if (err) {
          reject(new InstallError("The downloaded update is damaged"));
          return;
        }
        const map = new Map<string, Uint8Array>();
        for (const [path, content] of Object.entries(unzipped)) {
          map.set(path.replace(/\\/g, "/"), content);
        }
        resolve(map);
      });
    });
    if ([...entries.keys()].some((p) => p.includes(".."))) {
      throw new InstallError("The downloaded update was rejected");
    }
    for (const required of [
      "wowdeck/plugin.json",
      "wowdeck/package.json",
      "wowdeck/main.py",
      "wowdeck/dist/index.js",
    ]) {
      if (!entries.has(required)) {
        throw new InstallError("The downloaded update isn't a complete WoWDeck package");
      }
    }
    if (!ENGINE_ENTRIES.some((engine) => entries.has(engine))) {
      throw new InstallError("The downloaded update isn't a complete WoWDeck package");
    }
    let manifest: { name?: string; version?: string };
    try {
      manifest = JSON.parse(new TextDecoder().decode(entries.get("wowdeck/plugin.json")!));
    } catch {
      throw new InstallError("The downloaded update isn't a complete WoWDeck package");
    }
    if (manifest.name !== PLUGIN_NAME || manifest.version !== version) {
      throw new InstallError(`The downloaded update isn't WoWDeck ${version}`);
    }
  }
}

/** A failed stage: nothing staged, and why. */
export function outcome(code: string, message: string): StageOutcome {
  return { result: null, error: { code, message } };
}

function sha256OfFile(path: string): string {
  return new Bun.CryptoHasher("sha256").update(readFileSync(path)).digest("hex");
}
