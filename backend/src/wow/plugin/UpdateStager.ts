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
 * The staged file intentionally outlives the RPC — the native prompt
 * may sit unanswered, and cancelling leaves the file — so stage()
 * first removes our staging files older than a day (SteamOS clears
 * /tmp on boot anyway; this is belt and braces).
 */

import { chmodSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unzip } from "fflate";
import type { NetworkClient } from "../net/network";
import type { PluginUpdateCheck, StagingAnswer } from "../notifications/PluginUpdateCheck";
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

/** The staged zip's file name for a release version; the stale sweep matches the same prefix. */
export function stagedFileName(version: string): string {
  return `wowdeck-update-${version}.zip`;
}

/** The offered zip answered 404: the stored answer is stale. */
const GONE = Symbol("gone");
const DOWNLOAD_FAILED = outcome("download_failed", "Couldn't download the update. Try again");

export class UpdateStager {
  constructor(
    private net: Pick<NetworkClient, "downloadToFile">,
    /**
     * The update check's answer with the zip's URL; `refresh` forces a
     * fresh check. Never spends the toast.
     */
    private check: Pick<PluginUpdateCheck, "forStaging">,
    private tokenProvider: () => string | undefined = () => undefined,
    private tempDir: string = tmpdir(),
  ) {}

  async stage(): Promise<StageOutcome> {
    const first = await this.#stageFrom(await this.check.forStaging());
    if (first !== GONE) {
      return first;
    }
    // One forced check and one retry, never a loop: a forced answer that
    // still names the gone zip (or a failed check serving it) fails as is.
    const retry = await this.#stageFrom(await this.check.forStaging({ refresh: true }));
    return retry === GONE ? DOWNLOAD_FAILED : retry;
  }

  async #stageFrom({ status, offer, downloadUrl }: StagingAnswer): Promise<StageOutcome | typeof GONE> {
    if (offer === null) {
      return status === "current"
        ? outcome("up_to_date", "WoWDeck is already up to date")
        : outcome("check_unavailable", "Couldn't check for a newer release");
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
          await this.net.downloadToFile(downloadUrl, zipPath, { headers: header, trustedHostsForHeaders });
          downloaded = true;
          break;
        } catch (err) {
          failure = err;
        }
      }
      if (!downloaded) {
        console.error(
          `[self-update] download failed: ${failure instanceof Error ? failure.message : String(failure)}`,
        );
        return failure instanceof NetworkError && failure.status === 404 ? GONE : DOWNLOAD_FAILED;
      }
      const sha256 = sha256OfFile(zipPath);
      await this.#verifyPackage(zipPath, version);
      chmodSync(zipPath, 0o600);
      console.error(
        `[self-update] staged WoWDeck ${version} for Decky's installer (sha256 ${sha256.slice(0, 8)}…)`,
      );
      return { result: { artifact: `file://${zipPath}`, version, sha256 }, error: null };
    } catch (err) {
      // Nothing is staged on any failure.
      rmSync(zipPath, { force: true });
      if (!(err instanceof InstallError)) {
        console.error(`[self-update] staging failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      return outcome(
        "archive_invalid",
        err instanceof InstallError ? err.message : "The update couldn't be prepared. Try again",
      );
    }
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
      "wowdeck/bin/wowdeck",
    ]) {
      if (!entries.has(required)) {
        throw new InstallError("The downloaded update isn't a complete WoWDeck package");
      }
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

function outcome(code: string, message: string): StageOutcome {
  return { result: null, error: { code, message } };
}

function sha256OfFile(path: string): string {
  return new Bun.CryptoHasher("sha256").update(readFileSync(path)).digest("hex");
}
