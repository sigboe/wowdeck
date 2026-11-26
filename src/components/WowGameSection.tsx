import { useEffect, useRef, useSyncExternalStore } from "react";
import { settingsStore, steamLaunchMenuOn } from "../settings";
import { openPanel } from "../openPanel";
import { addonSession } from "../session";
import { steamUpdates } from "../steamUpdates";
import { steamLaunchState } from "../steamLaunchActions";
import { useResource } from "../useResource";
import { gamePageBoxView, type BoxText } from "../gamePageBox";
import { STEAM_PAGE_BOX_CSS } from "../sharedStyles";
import { SteamPageBox } from "./SteamPageBox";
import type { AttachLaunch } from "../steamLaunchPatch";

function Line({ parts }: { parts: BoxText[] }) {
  return (
    <>
      {parts.map((p, i) =>
        p.tone === "strong" ? (
          <b key={i}>{p.text}</b>
        ) : p.tone === "count" ? (
          <span key={i} className="wowdeck-page-box-count">
            {p.text}
          </span>
        ) : (
          p.text
        ),
      )}
    </>
  );
}

/**
 * WoWDeck's boxes on the linked WoW entry's game page in Steam's library
 * (BEYOND-05, #252), right under Steam's Play bar where Steam puts its own
 * feedback box (steamGamePage.tsx). The addons box shows the updates
 * waiting across every installation (gamePageBox.ts) with one action, Update
 * all or Check for updates, and My Addons (our QAM panel). A second box
 * shows only when the launch status can't be read, with Retry.
 *
 * It renders while our QAM panel is closed, so its state lives in module
 * scope: the summary in steamUpdates.ts (shared with the home badge), the
 * Update all run in the addon session (shared with My Addons, so either
 * surface shows its progress and neither starts a second run). Appearing
 * shows the last counts at once and, when the option is on, checks in the
 * background at most every 15 minutes.
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

  // "Choose the WoW version from Play" off: no launch read, no launch box.
  const launchMenu = useSyncExternalStore(settingsStore.subscribe, () =>
    steamLaunchMenuOn(settingsStore.get()),
  );
  const launch = useResource(steamLaunchState, launchMenu ? String(appId) : null);
  const { summary, checking, checkedAt } = useSyncExternalStore(
    steamUpdates.subscribe,
    steamUpdates.get,
  );
  const run = useSyncExternalStore(addonSession.subscribe, () => addonSession.get().updatingAll);

  useEffect(() => {
    steamUpdates.onSurfaceShown();
  }, []);

  const view = gamePageBoxView({ summary, checking, checkedAt, now: Date.now(), run });
  const act =
    view.action.label === "Update all"
      ? () => void addonSession.actions.updateAll("all")
      : () => void steamUpdates.checkNow({ toast: true });

  return (
    <div ref={anchor} className="wowdeck-game-section">
      <style>{STEAM_PAGE_BOX_CSS}</style>
      <SteamPageBox
        spinner={view.spinner}
        line1={<Line parts={view.line1} />}
        line2={view.line2}
        percent={view.percent}
        buttons={[
          { ...view.action, onActivate: act },
          { label: "My Addons", onActivate: () => openPanel("installed") },
        ]}
      />
      {launch.error && (
        <SteamPageBox
          line1={<span className="wowdeck-page-box-error">{launch.error}</span>}
          line2="Choosing the WoW version from Play needs it"
          buttons={[
            {
              label: "Retry",
              primary: true,
              inert: launch.loading,
              onActivate: () => void launch.refresh(),
            },
          ]}
        />
      )}
    </div>
  );
}
