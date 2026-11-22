import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { DialogButton, Focusable } from "@decky/ui";
import { FaBoxOpen } from "react-icons/fa";
import { engine } from "../engineLink";
import { pluginToast, toastError } from "../toast";
import { createAddonActions } from "../addonActions";
import { settingsStore, steamLaunchMenuOn } from "../settings";
import { openPanel } from "../openPanel";
import { activeInstallationId } from "../session";
import { STEAM, descriptionStyle } from "../steamTheme";
import { updateSummaryText } from "../steamLibrary";
import { steamUpdates } from "../steamUpdates";
import { steamLaunchState } from "../steamLaunchActions";
import { useResource } from "../useResource";
import type { AttachLaunch } from "../steamLaunchPatch";

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
export function WowGameSection({
  appId,
  attachLaunch,
}: {
  appId: number;
  attachLaunch: AttachLaunch;
}) {
  const anchor = useRef<HTMLDivElement>(null);
  useEffect(() => {
    return anchor.current ? attachLaunch(anchor.current, appId) : undefined;
  }, [appId, attachLaunch]);

  // "Play starts WoW" off: no launch read, no launch lines.
  const launchMenu = useSyncExternalStore(settingsStore.subscribe, () =>
    steamLaunchMenuOn(settingsStore.get()),
  );
  const launch = useResource(steamLaunchState, launchMenu ? String(appId) : null);
  const checkingLaunch = launch.loading && !launch.data;
  const { summary, checking } = useSyncExternalStore(steamUpdates.subscribe, steamUpdates.get);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    steamUpdates.onSurfaceShown();
  }, []);

  // My Addons' Update all; here the counts on this page are what changed.
  const actions = createAddonActions({
    rpc: engine.rpc,
    toast: pluginToast,
    toastError,
    autoUpdateOn: () => settingsStore.get().settings.autoUpdate,
    installationId: activeInstallationId,
    setUpdatingAll: (scope) => setUpdating(scope !== null),
    begin: () => {},
    // "Updating…" stays until the new counts are in.
    settled: () => steamUpdates.loadSummary(),
  });
  const updateAll = () => actions.updateAll("all");

  const open = () => openPanel("installed");

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
      ref={anchor}
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
        {launch.error && (
          <div style={{ ...descriptionStyle, color: STEAM.danger }}>{launch.error}</div>
        )}
        {checkingLaunch && <div style={descriptionStyle}>Checking WoW launch status…</div>}
      </div>
      <Focusable flow-children="row" style={{ display: "flex", gap: "8px", flexShrink: 0 }}>
        {total > 0 && (
          <DialogButton style={BUTTON} disabled={busy} onClick={() => void updateAll()}>
            Update all
          </DialogButton>
        )}
        <DialogButton
          style={BUTTON}
          disabled={busy}
          onClick={() => void steamUpdates.checkNow({ toast: true })}
        >
          Check for updates
        </DialogButton>
        {launch.error && (
          <DialogButton
            style={BUTTON}
            disabled={launch.loading}
            onClick={() => void launch.refresh()}
          >
            Retry
          </DialogButton>
        )}
        <DialogButton style={BUTTON} onClick={open}>
          Open
        </DialogButton>
      </Focusable>
    </div>
  );
}
