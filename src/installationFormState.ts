/**
 * Draft of Options → "Add Installation Manually", kept at module scope.
 *
 * The folder picker (`openFilePicker`) is shown as a modal; any modal
 * unmounts the plugin panel (guide G4), so component state would be lost
 * and the picked path would be written to an unmounted component. A tiny
 * subscribable store survives that and lets the remounted form pick the
 * result up whether it arrives before or after the remount.
 */

import { createStore } from "./store";
export interface InstallationDraft {
  path: string;
  name: string;
  clientType: string;
  /** The name last filled in automatically; replaced on the next pick unless the user changed it. */
  autoName: string;
}

const EMPTY: InstallationDraft = { path: "", name: "", clientType: "auto", autoName: "" };
const store = createStore<InstallationDraft>(EMPTY);

export const getInstallationDraft = store.get;
export const updateInstallationDraft = store.patch;
export const subscribeInstallationDraft = store.subscribe;

export function resetInstallationDraft(): void {
  store.set(EMPTY);
}

/**
 * What a picked folder fills in (owner, 2026-10-17): the display name the
 * installation would get, and the game version while it is still on Auto,
 * so the user sees the result at once and can change it. Only when the
 * folder holds exactly one installation; a name the user typed is kept.
 */
export function applyInspection(
  draft: InstallationDraft,
  found: { gameType: string; displayName: string }[],
  knownGameTypes: string[],
): Partial<InstallationDraft> {
  if (found.length !== 1) {
    return {};
  }
  const [one] = found as [{ gameType: string; displayName: string }];
  const patch: Partial<InstallationDraft> = {};
  if (draft.name.trim() === "" || draft.name === draft.autoName) {
    patch.name = one.displayName;
    patch.autoName = one.displayName;
  }
  if (draft.clientType === "auto" && knownGameTypes.includes(one.gameType)) {
    patch.clientType = one.gameType;
  }
  return patch;
}
