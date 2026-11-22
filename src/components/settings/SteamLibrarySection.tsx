import { RowChevron } from "../RowGlyph";
import { useSyncExternalStore } from "react";
import { Field, PanelSection } from "@decky/ui";

import { descriptionStyle } from "../../steamTheme";
import { linkedGamesStore, steamLibraryStatus } from "../../linkedGames";
import { STEAM_LIBRARY_ROW, openSteamLibraryModal } from "../SteamLibraryModal";
import { SettingsRow } from "./common";

/**
 * BEYOND-05: linked games get an addons section on their game page. One
 * row (S39: › opens a modal) whose status line says where things stand;
 * the Steam library modal holds the settings.
 */
export function SteamLibrarySection() {
  const linked = useSyncExternalStore(linkedGamesStore.subscribe, linkedGamesStore.get);
  return (
    <PanelSection title="Steam library">
      <SettingsRow id={STEAM_LIBRARY_ROW}>
        <Field
          focusable
          label="Steam library"
          description={<span style={descriptionStyle}>{steamLibraryStatus(linked)}</span>}
          onClick={openSteamLibraryModal}
        >
          <RowChevron />
        </Field>
      </SettingsRow>
    </PanelSection>
  );
}
