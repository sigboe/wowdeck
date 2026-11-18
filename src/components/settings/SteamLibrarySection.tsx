import { RowChevron } from "../RowGlyph";
import { useSyncExternalStore } from "react";
import { Field, PanelSection, ToggleField } from "@decky/ui";

import { descriptionStyle } from "../../steamTheme";
import { settingsStore } from "../../settings";
import { openSteamGameLinkPicker } from "../steamGameLink";
import { SettingsRow } from "./common";
import { addonSession } from "../../session";
import { linkedSteamGames } from "../../steamLibrary";

/** BEYOND-05: the WoW entry in Steam's library gets an addons section on its game page. */
export function SteamLibrarySection() {
  const { settings } = useSyncExternalStore(settingsStore.subscribe, settingsStore.get);
  const { installations } = useSyncExternalStore(addonSession.subscribe, addonSession.get);
  const linked = linkedSteamGames(installations, settings.steamGame, settings.steamAutoLink);
  const linkedSteamGame = settings.steamGame;

  return (
    <PanelSection title="Steam library">
      <SettingsRow id="steamAutoLink">
        <ToggleField
          label="Link detected Steam games"
          description={
            <span style={descriptionStyle}>
              Show addon updates on detected WoW and Battle.net game pages and home tiles
            </span>
          }
          checked={settings.steamAutoLink}
          onChange={(on) => void settingsStore.save({ steamAutoLink: on })}
        />
      </SettingsRow>
      <SettingsRow id="steamGame">
        <Field
          focusable
          label="World of Warcraft in Steam"
          description={
            <span style={descriptionStyle}>
              {linkedSteamGame
                ? `${linkedSteamGame.name}: its game page and tile show addon updates`
                : linked.length > 0
                  ? `${linked.length} detected Steam entries linked. Pick another entry to link manually`
                  : "Pick its library entry (WoW or Battle.net) to show addon updates there"}
            </span>
          }
          onClick={() => openSteamGameLinkPicker()}
        >
          <RowChevron />
        </Field>
      </SettingsRow>
      {linked.length > 0 && (
        <>
          <SettingsRow id="steamAutoCheck">
            <ToggleField
              label="Check for updates when shown"
              description={
                <span style={descriptionStyle}>
                  When its game page or tile appears; at most every 15 minutes
                </span>
              }
              checked={settings.steamAutoCheck}
              onChange={(on) => void settingsStore.save({ steamAutoCheck: on })}
            />
          </SettingsRow>
          <SettingsRow id="steamBadge">
            <ToggleField
              label="Show a badge on its tile"
              description={
                <span style={descriptionStyle}>
                  Green when updates are waiting, on the home screen and in the library
                </span>
              }
              checked={settings.steamBadge}
              onChange={(on) => void settingsStore.save({ steamBadge: on })}
            />
          </SettingsRow>
          <SettingsRow id="steamLaunchMenu">
            <ToggleField
              label="Choose the WoW version from Play"
              description={
                <span style={descriptionStyle}>
                  Play's menu lists your WoW versions, and Play starts the one you pick through
                  Battle.net. Off: Steam's own Play button.
                </span>
              }
              checked={settings.steamLaunchMenu}
              onChange={(on) => void settingsStore.save({ steamLaunchMenu: on })}
            />
          </SettingsRow>
        </>
      )}
    </PanelSection>
  );
}
