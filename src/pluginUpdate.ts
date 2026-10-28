/**
 * WoWDeck's own update notice (the plugin, not addons): the update toast,
 * the Options update panel and its update dot, and the Options → Updates
 * row, all rendered from the engine's one ready offer (system.updateCheck's
 * `offer`: version, headline, button label, plain-text notes, installable),
 * plus the adapter that hands an engine-staged update to Decky's own
 * installer. The engine's system.updateCheck owns the check, its
 * once-a-day cap, the failure backoff that spaces unreachable checks
 * (1h/2h/4h, silent), the offer's wording and the once-per-release-version
 * toast gate (toastPending); system.updateStage owns the download and
 * verification.
 */

import type { MethodMap, PluginUpdateOffer } from "../backend/src/api/contracts";
import type { UpdateChannel } from "./types";
import type { DotColor } from "./updateDot";

export type PluginUpdateInfo = MethodMap["system.updateCheck"]["result"];

/**
 * The "WoWDeck Update Channel" modal's rows (GLOSSARY: Update channel),
 * after Valve's Steam Client Update Channel: a name and one line each.
 */
export const UPDATE_CHANNEL_ROWS: ReadonlyArray<{
  channel: UpdateChannel;
  name: string;
  description: string;
}> = [
  { channel: "stable", name: "Stable", description: "Recommended for most users." },
  {
    channel: "beta",
    name: "Beta",
    description: "Built from every merged change. Newer features, may have bugs.",
  },
];

/**
 * The update toast, gated engine-side: system.updateCheck's toastPending is
 * true only for the first answer (fresh or cached) whose offer is
 * installable and not yet toasted — one toast per release version,
 * surviving restarts and QAM churn. Informative only: it names the version
 * and says where to go (the QAM toast has no action surface).
 */
export function pluginUpdateToast(info: PluginUpdateInfo): { title: string; body: string } | null {
  if (!info.toastPending || !info.offer) {
    return null;
  }
  return { title: info.offer.headline, body: info.offer.toastBody };
}

/**
 * The offer the Options update panel shows, and with it the update dot:
 * only an installable one (without the WoWDeck.zip Update could only fail;
 * the engine re-asks hourly until it is attached). The Updates row still
 * names any offer.
 */
export function panelOffer(info: PluginUpdateInfo | null): PluginUpdateOffer | null {
  return info?.offer?.installable ? info.offer : null;
}

/** What Y on the panel's Update button opens (ReleaseNotesModal). */
export interface ReleaseNotesAction {
  /** The footer hint beside Y. */
  label: string;
  /** The modal's title. */
  title: string;
  /** The engine's plain text (ADR-0004). */
  notes: string;
}

/**
 * Y on the panel's Update button (GLOSSARY: Release notes): the footer hint,
 * the modal's title and the notes it shows. Null, so no Y action and no
 * hint, when the offer has no notes.
 */
export function releaseNotesAction(offer: PluginUpdateOffer | null): ReleaseNotesAction | null {
  if (!offer?.releaseNotes?.trim()) {
    return null;
  }
  return {
    label: "Release notes",
    title: `WoWDeck ${offer.version} release notes`,
    notes: offer.releaseNotes,
  };
}

/**
 * The update dot on the Options tab and the panel's Update button: orange
 * while the update panel shows, off otherwise — so it clears once the
 * update installs and the reloaded plugin reads itself up to date.
 */
export function pluginUpdateDot(info: PluginUpdateInfo | null): DotColor | null {
  return panelOffer(info) ? "update" : null;
}

/**
 * The Options → Updates row, informational only (the panel holds the
 * button): WoWDeck's own version state. "unknown" (repo unreachable —
 * private beyond the token's reach, offline, rate limited) reads as
 * "couldn't check", never as a failure.
 */
export function pluginUpdateRow(info: PluginUpdateInfo): { label: string; description: string } {
  const { offer } = info;
  if (offer) {
    return {
      label: offer.rowLabel,
      description: `${info.currentVersion} → ${offer.version} · ${offer.releaseUrl}`,
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

/** The versions the engine stages: X.Y.Z or X.Y.Z-beta.N (PluginVersion, without the v). */
const STAGED_VERSION = /^\d+(?:\.\d+){0,2}(?:-beta\.\d+)?$/;

/**
 * Whether the artifact is the engine's local staging file for this exact
 * version: file:///<dirs>/wowdeck-update-<version>.zip, with no "." or
 * ".." segment in the path.
 * The name must stay in step with UpdateStager.stage().
 */
function isStagedArtifact(staged: StagedUpdate): boolean {
  if (!STAGED_VERSION.test(staged.version)) return false;
  const m = /^file:\/\/\/((?:[^/]+\/)*)([^/]+)$/.exec(staged.artifact);
  if (!m) return false;
  if (m[1]!.split("/").some((s) => s === "." || s === "..")) return false;
  return m[2] === `wowdeck-update-${staged.version}.zip`;
}

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
    if (!isStagedArtifact(staged)) {
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
