import { useSyncExternalStore } from "react";
import { Field, PanelSection, ToggleField } from "@decky/ui";
import { FaChevronRight } from "react-icons/fa";
import { descriptionStyle } from "../../steamTheme";
import { settingsStore } from "../../settings";
import type { SteamGame } from "../../steamLibrary";
import { openSteamGamePicker } from "../SteamGamePicker";
import { SettingsRow } from "./common";

/** BEYOND-05: the WoW entry in Steam's library gets an addons section on its game page. */
export function SteamLibrarySection() {
  const { settings } = useSyncExternalStore(settingsStore.subscribe, settingsStore.get);
  const linkedSteamGame = settings.steamGame;
  const linkSteamGame = (game: SteamGame | null) =>
    settingsStore.save(
      { steamGame: game },
      game
        ? ["Linked to Steam", `${game.name}'s game page and tile show addon updates`]
        : ["Unlinked from Steam", "No game page shows addon updates"],
    );

  return (
    <PanelSection title="Steam library">
      <SettingsRow id="steamGame">
        <Field
          focusable
          label="World of Warcraft in Steam"
          description={
            <span style={descriptionStyle}>
              {linkedSteamGame
                ? `${linkedSteamGame.name}: its game page and tile show addon updates`
                : "Pick its library entry (WoW or Battle.net) to show addon updates there"}
            </span>
          }
          onClick={() => openSteamGamePicker(linkedSteamGame, (g) => void linkSteamGame(g))}
        >
          <FaChevronRight />
        </Field>
      </SettingsRow>
      {linkedSteamGame && (
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
        </>
      )}
    </PanelSection>
  );
}
