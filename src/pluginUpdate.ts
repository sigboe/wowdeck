/**
 * WoWDeck's own update notice (the plugin, not addons): the text behind
 * the once-per-session toast and the Options → Updates row, plus the
 * adapter that hands an engine-staged update to Decky's own installer.
 * The engine's system.updateCheck owns the check; system.updateStage
 * owns the download and verification.
 */

import type { MethodMap } from "../backend/src/api/contracts";

export type PluginUpdateInfo = MethodMap["system.updateCheck"]["result"];

const RELEASES_PAGE = "https://github.com/sigboe/wowdeck/releases";

/** The session toast: only when a newer release actually exists. */
export function pluginUpdateToast(info: PluginUpdateInfo): { title: string; body: string } | null {
  if (info.status !== "available" || !info.latestVersion) {
    return null;
  }
  return {
    title: `WoWDeck ${info.latestVersion} available`,
    body: "Link in Options → Updates",
  };
}

/**
 * The Options → Updates row: WoWDeck's own version state. "unknown"
 * (repo unreachable — private beyond the token's reach, offline, rate
 * limited) reads as "couldn't check", never as a failure.
 */
export function pluginUpdateRow(info: PluginUpdateInfo): { label: string; description: string } {
  if (info.status === "available" && info.latestVersion) {
    return {
      label: "WoWDeck update available",
      description: `${info.currentVersion} → ${info.latestVersion} · ${info.releaseUrl ?? RELEASES_PAGE}`,
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
