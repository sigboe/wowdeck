import type { Addon, ReleaseChannel, SearchResult } from "./types";
import {
  catalogueResult,
  recoveryNeededFor,
  resultInstallLabel,
  type AddonSessionState,
} from "./addonSession";
import type { AddonActions } from "./addonActions";
import { installedDetailOffers } from "./addonRow";
import { followChannelChoices, installChannelChoices, type ChannelChoice } from "./releaseChannel";

/**
 * What a Details view's X action, tag line and channel menu show, read live
 * from the addon session while the modal is open: `resultActions` builds it
 * for a provider result, `installedActions` for an installed addon.
 */
export interface DetailsActions {
  /** Label of the X action ("Install", "Update", …); null = no X action. */
  installLabel: string | null;
  /** Status tags under the name (Get Addons: Installed, Update available, Updated). */
  tags: string[];
  /** The X action is running: X shows "…" and the channel menu is off. */
  pending: boolean;
  onInstall: () => Promise<void>;
  /**
   * Opens the Release channel menu (WF-03; Menu button in the footer);
   * absent for providers without channels. `afterPick` closes the modal,
   * like every other action there.
   */
  channelMenu?: (afterPick?: () => void) => void;
}

export interface ResultActionsDeps {
  actions: Pick<AddonActions, "install" | "update" | "reinstall">;
  requireInstallation?: () => boolean;
  /** Shows the Release channel menu; `pick` runs with the chosen channel. */
  showChannelMenu(choices: ChannelChoice[], pick: (channel: ReleaseChannel) => void): void;
}

export interface InstalledActionsDeps {
  actions: Pick<AddonActions, "update" | "setChannel">;
  /** Shows the Release channel menu with the followed channel marked. */
  showChannelMenu(
    choices: ChannelChoice[],
    current: ReleaseChannel,
    pick: (channel: ReleaseChannel) => void,
  ): void;
}

/**
 * An installed addon's Details actions (My Addons), read live from the addon
 * session: X updates when an update is on offer, Menu follows another release
 * channel; neither while the installation is locked, and X shows its work
 * while the addon is busy.
 */
export function installedActions(
  state: AddonSessionState,
  addon: Addon,
  deps: InstalledActionsDeps,
): DetailsActions {
  const offers = installedDetailOffers(addon, recoveryNeededFor(state) !== null);
  return {
    installLabel: offers.installLabel,
    tags: [],
    pending: !!state.busy[addon.id],
    onInstall: () => (offers.installLabel ? deps.actions.update(addon) : Promise.resolve()),
    channelMenu: offers.channelMenu
      ? (afterPick?: () => void) => {
          const current = addon.channel ?? "stable";
          deps.showChannelMenu(followChannelChoices(addon.allowedChannels), current, (channel) => {
            afterPick?.();
            // The marked channel is already followed: nothing to install.
            if (channel !== current) {
              void deps.actions.setChannel(addon, channel);
            }
          });
        }
      : undefined,
  };
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
