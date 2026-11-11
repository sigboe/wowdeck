import { useEffect, useSyncExternalStore } from "react";
import { DialogButton, Field, PanelSection, ToggleField } from "@decky/ui";
import { FaChevronRight, FaEllipsisH } from "react-icons/fa";
import * as api from "../../services/backend";
import { descriptionStyle } from "../../steamTheme";
import { lastAutoUpdateLine } from "../../text";
import { previousVersionsSummary } from "../../previousVersions";
import { settingsStore } from "../../settings";
import {
  isOffChannel,
  panelOffer,
  pluginUpdateRow,
  releaseNotesAction,
  updateChannelChoice,
} from "../../pluginUpdate";
import { selfUpdateStore } from "../../selfUpdate";
import { openReleaseNotesModal } from "../ReleaseNotesModal";
import { openUpdateChannelModal } from "../UpdateChannelModal";
import { openPrBuildsModal } from "../PrBuildsModal";
import {
  loadPreviousVersionsUsage,
  openPreviousVersionsModal,
  previousVersionsStore,
} from "../PreviousVersionsModal";
import { rememberFocus } from "../../focusMemory";
import { SettingsRow, VIEW } from "./common";

/**
 * Automatic updates (WF-02) and rollback (BEYOND-02; owner: a way to turn it
 * off, the space it uses, clear). Rollback is one "Previous versions" row
 * summing up both, whose modal holds the toggle and Clear (#207). The last row is WoWDeck's own version —
 * the plugin, never an addon — read from the shared self-update store, so
 * plugin load's answer shows here without a second fetch. Its ⋯ opens the
 * update channel modal (A), checks again (X) and, while the panel offers
 * an update with notes, opens its release notes (Y), as on the panel's
 * button; the Update button itself lives in the Options update panel.
 */
export function UpdatesSection() {
  const { settings } = useSyncExternalStore(settingsStore.subscribe, settingsStore.get);
  const { info: pluginUpdate, checking } = useSyncExternalStore(
    selfUpdateStore.subscribe,
    selfUpdateStore.get,
  );
  const { usage: previousUsage } = useSyncExternalStore(
    previousVersionsStore.subscribe,
    previousVersionsStore.get,
  );

  // The checkmark is the engine's stored channel, read on each open, or
  // the PR channel the last answer served; the switch's answer lands in the
  // self-update store (panel, dot, row). Off any channel, or on a PR
  // channel, Stable and Beta are unchecked: picking either is the way out,
  // so the pick goes through even when it matches the stored channel.
  const test = isOffChannel(pluginUpdate);
  const openChannelModal = async () => {
    const channel = await selfUpdateStore.getChannel();
    if (channel !== null) {
      const { checked, pr } = updateChannelChoice(selfUpdateStore.get().info, channel);
      openUpdateChannelModal(
        checked,
        pr,
        (next) => void selfUpdateStore.setChannel(next),
        () => openPrBuildsModal(api.rpc, selfUpdateStore),
        settingsStore.get().settings.pluginMoveToStableAfterRelease,
        (on) => void settingsStore.save({ pluginMoveToStableAfterRelease: on }),
      );
    }
  };

  // Shown before the first answer too: the ⋯ is the way to the channel.
  const wowdeckRow = pluginUpdate
    ? pluginUpdateRow(pluginUpdate)
    : { label: "WoWDeck", description: "" };
  const offer = panelOffer(pluginUpdate);
  const releaseNotes = releaseNotesAction(offer);

  useEffect(() => {
    void loadPreviousVersionsUsage();
    // The shared self-update store: load or wake has usually answered
    // already, and this re-asks only when the held answer is stale — no
    // fetch on every Options visit.
    void selfUpdateStore.refresh();
  }, []);

  return (
    <PanelSection title="Updates">
      <SettingsRow id="autoUpdate">
        <ToggleField
          label="Update automatically"
          description={
            <span style={descriptionStyle}>
              {settings.lastAutoUpdate
                ? lastAutoUpdateLine(settings.lastAutoUpdate, Date.now())
                : "Installs updates when they're found: at startup, on wake, or from WoW's page in Steam. Never while WoW is running."}
            </span>
          }
          checked={settings.autoUpdate}
          onChange={(on) => void settingsStore.save({ autoUpdate: on })}
        />
      </SettingsRow>
      <SettingsRow id="previousVersions">
        <Field
          focusable
          label="Previous versions"
          description={
            <span style={descriptionStyle}>
              {previousVersionsSummary(settings.keepPreviousVersions, previousUsage)}
            </span>
          }
          onClick={() => {
            rememberFocus(VIEW, "previousVersions");
            openPreviousVersionsModal();
          }}
          onOKActionDescription="Open"
        >
          <FaChevronRight />
        </Field>
      </SettingsRow>
      <SettingsRow id="wowdeckUpdate">
        <Field
          label={wowdeckRow.label}
          description={
            checking || wowdeckRow.description ? (
              <span style={descriptionStyle}>
                {checking ? "Checking…" : wowdeckRow.description}
              </span>
            ) : undefined
          }
        >
          <DialogButton
            style={{ minWidth: 0, width: "auto", padding: "8px 16px" }}
            onClick={() => void openChannelModal()}
            // Off any channel there is no Check again: the stored answer always
            // offers the channel's newest build, so a forced re-ask can
            // only say the same. The channel modal is the way forward.
            {...(!test && {
              onSecondaryActionDescription: "Check again",
              onSecondaryButton: () => void selfUpdateStore.checkAgain(),
            })}
            onOptionsActionDescription={releaseNotes?.label}
            onOptionsButton={
              releaseNotes && offer
                ? () => openReleaseNotesModal(releaseNotes, offer.buttonLabel)
                : undefined
            }
          >
            <FaEllipsisH aria-hidden="true" />
            <span className="wowdeck-visually-hidden">Update channel</span>
          </DialogButton>
        </Field>
      </SettingsRow>
    </PanelSection>
  );
}
