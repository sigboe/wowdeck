import { useEffect, useState, useSyncExternalStore } from "react";
import { DialogButton, Focusable, Navigation, QuickAccessTab } from "@decky/ui";
import { FaBoxOpen } from "react-icons/fa";
import * as api from "../services/backend";
import { pluginToast, toastError } from "../toast";
import { createAddonActions } from "../addonActions";
import { settingsStore } from "../settings";
// Decky's plugin name (plugin.json); Decky's state identifies the active plugin by it.
import { name as PLUGIN_NAME } from "../../plugin.json";
import { qamState } from "../qamState";
import { STEAM, descriptionStyle } from "../steamTheme";
import { updateSummaryText } from "../steamLibrary";
import {
  afterUpdate,
  checkNow,
  getSteamUpdates,
  onSteamSurfaceShown,
  subscribeSteamUpdates,
} from "../steamUpdates";

const BUTTON = { minWidth: 0, width: "auto", padding: "8px 16px" } as const;

/**
 * The addon-updates section on the linked WoW entry's game page in Steam's
 * library (BEYOND-05), between the hero and the Play row. Shows the updates
 * waiting across every installation, with Update all (every installation,
 * WF-13), Check for updates (asks the providers) and Open (our QAM panel on
 * My Addons). Inserted by steamGamePage.tsx; renders while our QAM panel is
 * closed, so its state lives in steamUpdates.ts (shared with the home
 * badge). Appearing shows the last counts at once and, when the option is
 * on, checks in the background at most every 15 minutes.
 */
export function WowGameSection() {
  const { summary, checking } = useSyncExternalStore(subscribeSteamUpdates, getSteamUpdates);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    onSteamSurfaceShown();
  }, []);

  // My Addons' Update all; here the counts on this page are what changed.
  const actions = createAddonActions({
    rpc: api.rpc,
    toast: pluginToast,
    toastError,
    autoUpdateOn: () => settingsStore.get().settings.autoUpdate,
    setBusy: () => {},
    setUpdatingAll: (scope) => setUpdating(scope !== null),
    onChanged: () => void afterUpdate(),
  });
  const updateAll = () => actions.updateAll("all");

  const open = () => {
    qamState.tab = "installed";
    Navigation.OpenQuickAccessMenu(QuickAccessTab.Decky);
    try {
      // Decky's own state: show our panel rather than the last one used.
      (
        window as { DeckyPluginLoader?: { deckyState?: { setActivePlugin?: (n: string) => void } } }
      ).DeckyPluginLoader?.deckyState?.setActivePlugin?.(PLUGIN_NAME);
    } catch {
      // The QAM still opens on the Decky tab.
    }
  };

  const busy = checking || updating;
  const total = summary?.reduce((n, i) => n + i.updates, 0) ?? 0;
  const status = updating
    ? "Updating…"
    : checking
      ? "Checking for updates…"
      : summary
        ? updateSummaryText(summary)
        : "Loading…";

  return (
    <div
      className="wowdeck-game-section"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "16px",
        padding: "12px 36px",
        background: "rgba(0, 0, 0, 0.35)",
      }}
    >
      <FaBoxOpen style={{ flexShrink: 0, width: "24px", height: "24px", color: STEAM.textMuted }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            ...descriptionStyle,
            fontWeight: "bold",
            letterSpacing: ".5px",
            textTransform: "uppercase",
          }}
        >
          WoW addons
        </div>
        <div
          style={{
            color: total > 0 && !busy ? STEAM.positive : STEAM.text,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {status}
        </div>
      </div>
      <Focusable flow-children="row" style={{ display: "flex", gap: "8px", flexShrink: 0 }}>
        {total > 0 && (
          <DialogButton style={BUTTON} disabled={busy} onClick={() => void updateAll()}>
            Update all
          </DialogButton>
        )}
        <DialogButton style={BUTTON} disabled={busy} onClick={() => void checkNow({ toast: true })}>
          Check for updates
        </DialogButton>
        <DialogButton style={BUTTON} onClick={open}>
          Open
        </DialogButton>
      </Focusable>
    </div>
  );
}
