import type { ReleaseChannel, SearchResult } from "./types";
import {
  catalogueResult,
  recoveryNeededFor,
  resultInstallLabel,
  type AddonSessionState,
} from "./addonSession";
import type { AddonActions } from "./addonActions";
import { installChannelChoices, type ChannelChoice } from "./releaseChannel";

export interface ResultActionsDeps {
  actions: Pick<AddonActions, "install" | "update" | "reinstall">;
  requireInstallation?: () => boolean;
  /** Shows the Release channel menu; `pick` runs with the chosen channel. */
  showChannelMenu(choices: ChannelChoice[], pick: (channel: ReleaseChannel) => void): void;
}

/**
 * A Get Addons result's status and its X and Menu actions, built from the
 * addon session's current state. Results and Details both use it, so an
 * install started in one shows pending in the other, and Details acts on the
 * state now rather than the state it opened with. While `pending`, views
 * offer neither action; the session refuses a repeat install anyway. During
 * an installation switch the session refuses every install, so a new install
 * has no X (`installLabel` null) and the channel menu is gone; an installed
 * addon keeps its update and reinstall.
 */
export function resultActions(
  state: AddonSessionState,
  result: SearchResult,
  deps: ResultActionsDeps,
) {
  const shown = catalogueResult(state, result);
  const { installed } = shown;
  const locked = recoveryNeededFor(state) !== null;
  const installLabel =
    locked || (state.switching && !installed)
      ? null
      : deps.requireInstallation
        ? resultInstallLabel(installed, state.installations.length)
        : shown.installLabel;
  const view = { ...shown, installLabel };
  // An installed addon takes My Addons' update or reinstall path.
  const onInstall = () => {
    if (locked || (deps.requireInstallation && !deps.requireInstallation()))
      return Promise.resolve();
    return !installed
      ? deps.actions.install(result)
      : installLabel === "Update"
        ? deps.actions.update(installed)
        : deps.actions.reinstall(installed);
  };
  // Release channel menu (WF-03, Menu button): install from a channel.
  const choices = locked || state.switching ? undefined : installChannelChoices(result);
  const channelMenu = choices
    ? (afterPick?: () => void) =>
        deps.showChannelMenu(choices, (channel) => {
          afterPick?.();
          if (!deps.requireInstallation || deps.requireInstallation())
            void deps.actions.install(result, channel);
        })
    : undefined;
  return { ...view, onInstall, channelMenu };
}

export type ResultActions = ReturnType<typeof resultActions>;
