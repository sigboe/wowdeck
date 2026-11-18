import { settingsStore } from "../settings";
import { addonSession } from "../session";
import { linkedSteamGames, type SteamGame } from "../steamLibrary";
import { openSteamGamePicker } from "./SteamGamePicker";

/**
 * Save the hand-set link (settings `steamGame`), or remove it with null,
 * toasting what changed. Resolves true when it was saved.
 */
export function linkSteamGame(game: SteamGame | null): Promise<boolean> {
  const { settings } = settingsStore.get();
  return settingsStore.save(
    { steamGame: game },
    game
      ? ["Linked to Steam", `${game.name}'s game page and tile show addon updates`]
      : [
          "Manual Steam link removed",
          settings.steamAutoLink
            ? "Detected games remain linked"
            : "No game page shows addon updates",
        ],
  );
}

/**
 * Open the Options Steam game picker and save its pick as the hand-set link
 * (`linkSteamGame`). The panel is unmounted while it is open (G4), so the
 * picker finishes the work itself (P7); `then` runs after a save, for
 * module-scoped follow-ups such as the layout target and focus memory.
 */
export function openSteamGameLinkPicker(
  then?: (game: SteamGame | null, saved: boolean) => void,
): void {
  const { settings } = settingsStore.get();
  const { installations } = addonSession.get();
  openSteamGamePicker(
    {
      manual: settings.steamGame,
      detected: linkedSteamGames(installations, null),
      autoLinkOn: settings.steamAutoLink,
    },
    (game) => void linkSteamGame(game).then((saved) => then?.(game, saved)),
  );
}
