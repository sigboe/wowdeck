import { useEffect, useState, useSyncExternalStore } from "react";
import { DialogButton, Field, PanelSection, ToggleField } from "@decky/ui";
import { FaEllipsisH } from "react-icons/fa";
import * as api from "../../services/backend";
import { descriptionStyle } from "../../steamTheme";
import { pluginToast, toastError } from "../../toast";
import { lastAutoUpdateLine } from "../../text";
import { formatBytes } from "../../wtfFormat";
import { settingsStore } from "../../settings";
import { pluginUpdateRow } from "../../pluginUpdate";
import { selfUpdateStore } from "../../selfUpdate";
import { openUpdateChannelModal } from "../UpdateChannelModal";
import { SettingsRow } from "./common";

/**
 * Automatic updates (WF-02) and rollback (BEYOND-02; owner: a way to turn it
 * off, the space it uses, clear). The last row is WoWDeck's own version —
 * the plugin, never an addon — read from the shared self-update store, so
 * plugin load's answer shows here without a second fetch. Its ⋯ opens the
 * update channel modal; the Update button lives in the Options update panel.
 */
export function UpdatesSection() {
  const { settings } = useSyncExternalStore(settingsStore.subscribe, settingsStore.get);
  const { info: pluginUpdate } = useSyncExternalStore(
    selfUpdateStore.subscribe,
    selfUpdateStore.get,
  );
  const [previousUsage, setPreviousUsage] = useState<{ bytes: number; count: number } | null>(null);
  const [clearingPrevious, setClearingPrevious] = useState(false);
  const loadPreviousUsage = () =>
    api
      .rpc("rollback.status")
      .then(setPreviousUsage)
      .catch(() => setPreviousUsage(null));
  const clearPrevious = async () => {
    setClearingPrevious(true);
    try {
      const before = previousUsage;
      setPreviousUsage(await api.rpc("rollback.clear"));
      pluginToast(
        "Previous versions cleared",
        before
          ? `${formatBytes(before.bytes)} freed`
          : "Rollback is no longer possible for earlier updates",
      );
    } catch (e) {
      toastError("Couldn't clear", e);
    } finally {
      setClearingPrevious(false);
    }
  };

  // The checkmark is the engine's stored channel, read on each open; the
  // switch's answer lands in the self-update store (panel, dot, row).
  const openChannelModal = async () => {
    const channel = await selfUpdateStore.getChannel();
    if (channel !== null) {
      openUpdateChannelModal(channel, (next) => void selfUpdateStore.setChannel(next));
    }
  };

  // Shown before the first answer too: the ⋯ is the way to the channel.
  const wowdeckRow = pluginUpdate
    ? pluginUpdateRow(pluginUpdate)
    : { label: "WoWDeck", description: "" };

  useEffect(() => {
    void loadPreviousUsage();
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
      <SettingsRow id="keepPrevious">
        <ToggleField
          label="Keep previous versions"
          description={
            <span style={descriptionStyle}>
              After an update, an addon's Options menu can roll it back
            </span>
          }
          checked={settings.keepPreviousVersions}
          onChange={(on) => void settingsStore.save({ keepPreviousVersions: on })}
        />
      </SettingsRow>
      <SettingsRow id="previousUsage">
        <Field
          label="Previous versions kept"
          description={
            <span style={descriptionStyle}>
              {previousUsage
                ? previousUsage.count
                  ? `${formatBytes(previousUsage.bytes)} for ${previousUsage.count} addon${previousUsage.count === 1 ? "" : "s"}`
                  : "None kept"
                : "…"}
            </span>
          }
        >
          <DialogButton
            style={{ minWidth: 0, width: "auto", padding: "8px 16px" }}
            disabled={clearingPrevious || !previousUsage?.count}
            onClick={() => void clearPrevious()}
          >
            Clear
          </DialogButton>
        </Field>
      </SettingsRow>
      <SettingsRow id="wowdeckUpdate">
        <Field
          label={wowdeckRow.label}
          description={
            wowdeckRow.description ? (
              <span style={descriptionStyle}>{wowdeckRow.description}</span>
            ) : undefined
          }
        >
          <DialogButton
            style={{ minWidth: 0, width: "auto", padding: "8px 16px" }}
            onClick={() => void openChannelModal()}
          >
            <FaEllipsisH />
          </DialogButton>
        </Field>
      </SettingsRow>
    </PanelSection>
  );
}
