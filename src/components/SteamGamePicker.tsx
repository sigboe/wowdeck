import { useMemo, useState } from "react";
import {
  DialogBody,
  DialogButton,
  DialogControlsSection,
  DialogFooter,
  DialogHeader,
  Field,
  Focusable,
  ModalRoot,
  TextField,
  showModal,
} from "@decky/ui";
import { TextRow } from "./TextRow";
import { ScrollBuffer } from "./ScrollBuffer";
import { wowupModalStyleCss } from "../sharedStyles";
import { descriptionStyle } from "../steamTheme";
import {
  filterSteamGames,
  likelyWowFirst,
  listSteamShortcuts,
  type SteamGame,
} from "../steamLibrary";

/** Rows shown at once; libraries with 800+ shortcuts narrow down by typing. */
const MAX_ROWS = 40;

/**
 * Pick the Steam library entry that launches WoW (BEYOND-05): one text row
 * to narrow down (S28), then the non-Steam shortcuts as rows, likely WoW
 * entries first (WoW itself, or the Battle.net launcher people add); A links one. "Unlink" when one is linked; B leaves it as
 * it was. The panel is unmounted while this is open (G4): the choice goes
 * through `onPick`, which saves it to settings and module state.
 */
function SteamGamePicker({
  current,
  onPick,
  closeModal,
}: {
  current: SteamGame | null;
  onPick: (game: SteamGame | null) => void;
  closeModal?: () => void;
}) {
  const [query, setQuery] = useState("");
  const all = useMemo(() => likelyWowFirst(listSteamShortcuts()), []);
  const matches = filterSteamGames(all, query);
  const pick = (game: SteamGame | null) => {
    onPick(game);
    closeModal?.();
  };
  return (
    <ModalRoot onCancel={closeModal} closeModal={closeModal}>
      <DialogHeader>World of Warcraft in Steam</DialogHeader>
      <DialogBody>
        <style>{wowupModalStyleCss()}</style>
        <ScrollBuffer>
          <DialogControlsSection>
            <TextRow label="Search your non-Steam games" layout="inline">
              <TextField value={query} onChange={(e) => setQuery(e.target.value)} />
            </TextRow>
            {all.length === 0 && (
              <Field
                label="No non-Steam games found"
                description={
                  <span style={descriptionStyle}>
                    Add the WoW launcher (Lutris, Battle.net or Wow.exe) to Steam as a non-Steam
                    game first
                  </span>
                }
              />
            )}
            {all.length > 0 && matches.length === 0 && (
              <Field label={`Nothing matches “${query}”`} />
            )}
            {matches.slice(0, MAX_ROWS).map((g) => (
              <Field
                key={g.appId}
                focusable
                label={g.name}
                description={
                  g.appId === current?.appId ? (
                    <span style={descriptionStyle}>Currently linked</span>
                  ) : undefined
                }
                onClick={() => pick(g)}
                onOKActionDescription="Link"
              />
            ))}
            {matches.length > MAX_ROWS && (
              <Field
                label={`${matches.length - MAX_ROWS} more`}
                description={<span style={descriptionStyle}>Type to narrow down the list</span>}
              />
            )}
          </DialogControlsSection>
        </ScrollBuffer>
      </DialogBody>
      {current && (
        <DialogFooter>
          <Focusable flow-children="row" className="DialogTwoColLayout _DialogColLayout">
            <DialogButton onClick={() => pick(null)}>Unlink {current.name}</DialogButton>
            <DialogButton onClick={closeModal}>Cancel</DialogButton>
          </Focusable>
        </DialogFooter>
      )}
    </ModalRoot>
  );
}

export function openSteamGamePicker(
  current: SteamGame | null,
  onPick: (game: SteamGame | null) => void,
): void {
  const close = () => modalResult.Close();
  const modalResult = showModal(
    <SteamGamePicker current={current} onPick={onPick} closeModal={close} />,
    window,
    { strTitle: "World of Warcraft in Steam", bHideMainWindowForPopouts: false },
  );
}
