import { useEffect, useState, useSyncExternalStore } from "react";
import { DialogButton, Field, PanelSection, ToggleField } from "@decky/ui";
import * as api from "../../services/backend";
import { descriptionStyle } from "../../steamTheme";
import { pluginToast, toastError } from "../../toast";
import { lastAutoUpdateLine } from "../../text";
import { formatBytes } from "../../wtfFormat";
import { settingsStore } from "../../settings";
import { pluginUpdateRow, requestPluginUpdate, type PluginUpdateInfo } from "../../pluginUpdate";
import { SettingsRow } from "./common";

/**
 * Automatic updates (WF-02) and rollback (BEYOND-02; owner: a way to turn it
 * off, the space it uses, clear). The last row is WoWDeck's own version
 * (system.updateCheck) — the plugin, never an addon.
 */
export function UpdatesSection() {
  const { settings } = useSyncExternalStore(settingsStore.subscribe, settingsStore.get);
  const [previousUsage, setPreviousUsage] = useState<{ bytes: number; count: number } | null>(null);
  const [clearingPrevious, setClearingPrevious] = useState(false);
  const [pluginUpdate, setPluginUpdate] = useState<PluginUpdateInfo | null>(null);
  const [staging, setStaging] = useState(false);
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

  useEffect(() => {
    void loadPreviousUsage();
    // The engine memoizes its single releases/latest call per session, so
    // every Options visit after the first is answered locally.
    api
      .rpc("system.updateCheck")
      .then(setPluginUpdate)
      .catch(() => setPluginUpdate(null));
  }, []);

  /**
   * Stage the new release in the engine (download + verify), then hand it
   * to Decky's own installer: the loader's native prompt installs from
   * the local file and reloads the plugin. Declining the prompt changes
   * nothing; the button stays usable.
   */
  const runUpdate = async () => {
    setStaging(true);
    try {
      const staged = await api.rpc("system.updateStage");
      if (!staged.result) {
        pluginToast("Couldn't update WoWDeck", staged.error?.message ?? "Try again later");
        return;
      }
      const requested = await requestPluginUpdate(staged.result);
      if (!requested.success) {
        pluginToast("Couldn't update WoWDeck", requested.error ?? "Try again later");
      }
    } catch (e) {
      toastError("Couldn't update WoWDeck", e);
    } finally {
      setStaging(false);
    }
  };

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
      {pluginUpdate ? (
        <SettingsRow id="wowdeckUpdate">
          <Field
            label={pluginUpdateRow(pluginUpdate).label}
            description={
              <span style={descriptionStyle}>{pluginUpdateRow(pluginUpdate).description}</span>
            }
          >
            {pluginUpdate.status === "available" && pluginUpdate.downloadUrl ? (
              <DialogButton
                style={{ minWidth: 0, width: "auto", padding: "8px 16px" }}
                disabled={staging}
                onClick={() => void runUpdate()}
              >
                {staging ? "Preparing…" : "Update"}
              </DialogButton>
            ) : null}
          </Field>
        </SettingsRow>
      ) : null}
    </PanelSection>
  );
}
