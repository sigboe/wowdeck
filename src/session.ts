import { engine } from "./engineLink";
import { pluginToast, toastError } from "./toast";
import { settingsStore } from "./settings";
import { createAddonSession } from "./addonSession";

/** The one addon session (addonSession.ts), wired to the engine. */
export const addonSession = createAddonSession({
  rpc: engine.rpc,
  toast: pluginToast,
  toastError,
  autoUpdateOn: () => settingsStore.get().settings.autoUpdate,
});

// The list follows the engine's changes while no panel is mounted, so a
// change made from a modal or by an automatic update is already there.
engine.events.on("addons.changed", ({ addonIds }) => addonSession.addonsChanged(addonIds));
// Update all's progress, so a QAM closed and reopened mid-run still shows it.
engine.events.on("addons.updateAllProgress", (progress) =>
  addonSession.updateAllProgress(progress),
);

/**
 * The active installation's id, for a call made on its behalf (Get Addons,
 * Details), read when the call is made. Empty with none: the engine refuses
 * the call rather than guess one.
 */
export function activeInstallationId(): string {
  return addonSession.get().selectedId ?? "";
}
