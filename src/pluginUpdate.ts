/**
 * WoWDeck's own update notice (the plugin, not addons): the text behind
 * the update toast, the Options update panel and its update dot, and the
 * Options → Updates row (each reading "Switch to stable X" when a beta
 * build on Stable is offered an older stable), plus the adapter that hands an engine-staged
 * update to Decky's own installer. The engine's system.updateCheck owns the check, its once-a-day cap, the failure
 * backoff that spaces unreachable checks (1h/2h/4h, silent) and the
 * once-per-release-version toast gate (toastPending);
 * system.updateStage owns the download and verification.
 */

import type { MethodMap } from "../backend/src/api/contracts";
import type { DotColor } from "./updateDot";

export type PluginUpdateInfo = MethodMap["system.updateCheck"]["result"];

const RELEASES_PAGE = "https://github.com/sigboe/wowdeck/releases";

/** The wording for the stable release offered to a beta build whose owner left Beta. */
const switchLabel = (version: string) => `Switch to stable ${version}`;

/** The toast's and the panel's headline for an offered release. */
const offerTitle = (info: PluginUpdateInfo, version: string) =>
  info.switchToStable ? switchLabel(version) : `WoWDeck ${version} available`;

/**
 * The update toast, gated engine-side: system.updateCheck's toastPending is
 * true only for the first answer (fresh or cached) that offers a release
 * whose toast has not fired yet — one toast per release version, surviving
 * restarts and QAM churn. Informative only: it names the version and says
 * where to go (the QAM toast has no action surface).
 */
export function pluginUpdateToast(info: PluginUpdateInfo): { title: string; body: string } | null {
  if (!info.toastPending || info.status !== "available" || !info.latestVersion) {
    return null;
  }
  return {
    title: offerTitle(info, info.latestVersion),
    body: info.switchToStable ? "Install it in Options" : "Update in Options",
  };
}

/**
 * The Options update panel, attached under the nav bar: present only while
 * a release is available with its WoWDeck.zip (never for "current" or
 * "unknown"; without the zip Update could only fail, and the engine
 * re-asks hourly until it is attached). It carries the plugin's only
 * Update button. The Updates row still names such a release.
 */
export function pluginUpdatePanel(info: PluginUpdateInfo | null): { text: string } | null {
  if (info?.status !== "available" || !info.latestVersion || !info.downloadUrl) {
    return null;
  }
  return { text: offerTitle(info, info.latestVersion) };
}

/**
 * The update dot on the Options tab and the panel's Update button: orange
 * while the update panel shows, off otherwise — so it clears once the
 * update installs and the reloaded plugin reads itself up to date.
 */
export function pluginUpdateDot(info: PluginUpdateInfo | null): DotColor | null {
  return pluginUpdatePanel(info) ? "update" : null;
}

/**
 * The panel's Update button ("Switch to stable X" for a switch): disabled
 * while the release is being staged.
 */
export function pluginUpdateButton(
  staging: boolean,
  info: PluginUpdateInfo | null,
): { label: string; disabled: boolean } {
  if (staging) {
    return { label: "Preparing…", disabled: true };
  }
  const label =
    info?.switchToStable && info.latestVersion ? switchLabel(info.latestVersion) : "Update";
  return { label, disabled: false };
}

/**
 * The Options → Updates row, informational only (the panel holds the
 * button): WoWDeck's own version state. "unknown"
 * (repo unreachable — private beyond the token's reach, offline, rate
 * limited) reads as "couldn't check", never as a failure.
 */
export function pluginUpdateRow(info: PluginUpdateInfo): { label: string; description: string } {
  if (info.status === "available" && info.latestVersion) {
    const target = `${info.currentVersion} → ${info.latestVersion} · ${info.releaseUrl ?? RELEASES_PAGE}`;
    if (info.switchToStable) {
      return { label: switchLabel(info.latestVersion), description: target };
    }
    return {
      label: "WoWDeck update available",
      description: target,
    };
  }
  if (info.status === "current") {
    return { label: `WoWDeck ${info.currentVersion}`, description: "Up to date" };
  }
  return {
    label: `WoWDeck ${info.currentVersion}`,
    description: "Couldn't check for a newer release",
  };
}

export interface StagedUpdate {
  /** The engine-staged zip's file:// URL (system.updateStage). */
  artifact: string;
  version: string;
  sha256: string;
}

export type UpdateRequestResult = { success: boolean; error?: string };
type Loader = { call?: (...args: unknown[]) => Promise<unknown> };

const LOADER_UNAVAILABLE =
  "Decky's plugin installer is not available in this version. Update manually from the releases page.";

/**
 * Hand a staged update to Decky's own installer
 * (utilities/install_plugin, install type UPDATE): the loader shows its
 * native confirmation, installs from the local file and reloads the
 * plugin. Guarded like Decktation's adapter — window.DeckyBackend is a
 * loader internal, not @decky/api — and the artifact must be the
 * engine-staged file:// zip: the loader's remote path counts a store
 * install (decky-loader #984), and only an already-verified hash may
 * reach it (#985). The prompt owns the outcome; there is no accept or
 * cancel callback back to the plugin.
 */
export async function requestPluginUpdate(staged: StagedUpdate): Promise<UpdateRequestResult> {
  try {
    const loader =
      typeof window === "undefined"
        ? undefined
        : (window as unknown as { DeckyBackend?: Loader }).DeckyBackend;
    if (typeof loader?.call !== "function") {
      return { success: false, error: LOADER_UNAVAILABLE };
    }
    if (!/^file:\/\/\/(?:[^/]+\/)*wowdeck-update-[0-9.]+\.zip$/.test(staged.artifact)) {
      return {
        success: false,
        error: "The update could not be verified, so it was not installed.",
      };
    }
    const result = await loader.call(
      "utilities/install_plugin",
      staged.artifact,
      "WoWDeck",
      staged.version,
      staged.sha256,
      2,
    );
    if (
      result === false ||
      (result &&
        typeof result === "object" &&
        "success" in result &&
        (result as { success: unknown }).success === false)
    ) {
      return { success: false, error: LOADER_UNAVAILABLE };
    }
    // decky-loader #976: an open plugin panel keeps rendering the old
    // bundle after the install; leaving it now makes reopening resolve
    // the new one. Optional and best effort only.
    closeStalePanel();
    return { success: true };
  } catch {
    return { success: false, error: LOADER_UNAVAILABLE };
  }
}

/** Optional navigation workaround for decky-loader #976; no Steam patches or reloads. */
export function closeStalePanel(): boolean {
  try {
    const state =
      typeof window === "undefined"
        ? undefined
        : (
            window as unknown as {
              DeckyPluginLoader?: {
                deckyState?: {
                  publicState?: () => { activePlugin?: { name?: string } | null };
                  closeActivePlugin?: () => void;
                };
              };
            }
          ).DeckyPluginLoader?.deckyState;
    if (
      typeof state?.publicState !== "function" ||
      typeof state.closeActivePlugin !== "function" ||
      state.publicState().activePlugin?.name !== "WoWDeck"
    ) {
      return false;
    }
    state.closeActivePlugin();
    return true;
  } catch {
    return false;
  }
}
