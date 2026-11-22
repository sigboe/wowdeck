import { useEffect, useState, useSyncExternalStore } from "react";
import {
  DialogBody,
  DialogButton,
  DialogControlsSection,
  DialogControlsSectionHeader,
  DialogFooter,
  DialogHeader,
  Field,
  ModalRoot,
  ToggleField,
  showModal,
} from "@decky/ui";
import type { LinkedGame, PluginSettings } from "../../backend/src/api/contracts";
import { settingsStore } from "../settings";
import { LOAD_FAILED, linkedGamesStore } from "../linkedGames";
import { requestFocus } from "../focusMemory";
import { QAM_VIEW } from "../qamState";
import { descriptionStyle } from "../steamTheme";
import { wowupModalStyleCss } from "../sharedStyles";
import { ScrollBuffer } from "./ScrollBuffer";
import { FocusSlot, focusTarget } from "./FocusSlot";
import { RowChevron, RowSpinner } from "./RowGlyph";
import { openSteamGamePicker } from "./SteamGamePicker";

const TITLE = "Steam library";
/** Focus-memory view of the modal's rows. */
const VIEW = "modal.steamLibrary";
/** The Options row that opens this modal, where focus goes back on close. */
export const STEAM_LIBRARY_ROW = "steamLibrary";
/** The "No games linked" row: where focus goes when the last game is removed. */
const NO_GAMES = "games:none";
/** The Add a game row: where focus goes back when the picker closes (S36). */
const ADD_GAME = "addGame";
const FIND_GAMES = "findGames";
const gameKey = (game: LinkedGame) => `game:${game.appId}`;

const SOURCE: Record<LinkedGame["source"], string> = {
  found: "Found automatically",
  added: "Added by you",
};

/** The toggles for Steam's pages: they act only while Show in Steam is on. */
const PAGE_TOGGLES: Array<{
  key: "steamAutoCheck" | "steamBadge" | "steamLaunchMenu";
  label: string;
  description: string;
}> = [
  {
    key: "steamAutoCheck",
    label: "Check for updates",
    description: "When the page or tile appears, at most every 15 minutes",
  },
  { key: "steamBadge", label: "Tile badge", description: "Green when updates are waiting" },
  {
    key: "steamLaunchMenu",
    label: "Play starts WoW",
    description: "Pick the version with the arrow beside it",
  },
];

/** Play starts WoW on DroidDeck: DroidDeck starts each game itself (#296). */
const DROIDDECK_PLAY = "Not available on DroidDeck. DroidDeck launches game directly";

/**
 * Options › Steam library (#287): Show in Steam, the linked games (A
 * removes one, no confirmation: the picker brings it back), Add a game
 * (the picker, stacked on this modal), Find games, and what WoWDeck does
 * on their pages. Reads the settings and linked-games stores
 * and changes them through the engine (G4): the panel behind it is gone
 * while it is open.
 */
export function SteamLibraryModal({ closeModal }: { closeModal?: () => void }) {
  const stored = useSyncExternalStore(settingsStore.subscribe, settingsStore.get);
  const linked = useSyncExternalStore(linkedGamesStore.subscribe, linkedGamesStore.get);
  const games = linked.games;
  // Off: the page rows stay in place, greyed out (S21).
  const pagesOn = stored.loaded && stored.settings.steamEnabled;
  // On DroidDeck, Play starts WoW stays in place, greyed out with
  // DroidDeck's line; its setting is left as it is for other machines.
  const playLeft = linked.playOwner === "droiddeck";
  // Who owns Play is unknown until the linked games load: greyed out
  // until then, and after a failed read, as the page rows are before settings.
  const playOn = pagesOn && linked.loaded && !playLeft;

  useEffect(() => {
    if (!linkedGamesStore.get().loaded) void linkedGamesStore.load();
  }, []);

  const save = (patch: Partial<PluginSettings>) => void settingsStore.save(patch);

  // One search at a time; the row shows Steam's spinner while it runs.
  const [finding, setFinding] = useState(false);
  const find = async () => {
    if (finding) return;
    setFinding(true);
    try {
      await linkedGamesStore.find();
    } finally {
      setFinding(false);
    }
  };

  // A failed first read: read again, and once the list is there, focus
  // goes to its first row (S36: the Retry row is gone).
  const retry = async () => {
    await linkedGamesStore.load();
    const now = linkedGamesStore.get();
    const [first] = now.games;
    if (now.loaded) requestFocus(VIEW, first ? gameKey(first) : NO_GAMES);
  };

  // The removed row is gone: focus moves to the next game, else the one
  // above, else "No games linked" (S36: never left on nothing).
  const remove = async (game: LinkedGame) => {
    const at = games.indexOf(game);
    const neighbour = games[at + 1] ?? games[at - 1];
    if (await linkedGamesStore.remove(game)) {
      requestFocus(VIEW, neighbour ? gameKey(neighbour) : NO_GAMES);
    }
  };

  return (
    <ModalRoot onCancel={closeModal} closeModal={closeModal}>
      <DialogHeader>{TITLE}</DialogHeader>
      <DialogBody>
        <style>{wowupModalStyleCss()}</style>
        <ScrollBuffer>
          <DialogControlsSection>
            <FocusSlot view={VIEW} id="steamEnabled">
              <ToggleField
                label="Show in Steam"
                description={
                  <span style={descriptionStyle}>Addon updates on game pages and tiles</span>
                }
                checked={stored.settings.steamEnabled}
                disabled={!stored.loaded}
                onChange={(on) => save({ steamEnabled: on })}
              />
            </FocusSlot>
          </DialogControlsSection>
          <DialogControlsSection>
            <DialogControlsSectionHeader>Linked games</DialogControlsSectionHeader>
            {/* One row for both, so focus stays on it while Retry reads. */}
            {!linked.loaded && (
              <Field
                focusable
                label={linked.error ? LOAD_FAILED : "Loading…"}
                description={linked.error && <span style={descriptionStyle}>{linked.error}</span>}
                onClick={linked.error ? () => void retry() : undefined}
                onOKActionDescription={linked.error ? "Retry" : undefined}
              />
            )}
            {linked.loaded && games.length === 0 && (
              <Field focusable label="No games linked" {...focusTarget(VIEW, NO_GAMES)} />
            )}
            {games.map((game) => (
              <Field
                key={game.appId}
                focusable
                label={game.name}
                description={<span style={descriptionStyle}>{SOURCE[game.source]}</span>}
                onClick={() => void remove(game)}
                onOKActionDescription="Remove"
                {...focusTarget(VIEW, gameKey(game))}
              />
            ))}
            <Field
              focusable
              label="Add a game"
              description={<span style={descriptionStyle}>Pick one of your non-Steam games</span>}
              onClick={() => openSteamGamePicker(() => requestFocus(VIEW, ADD_GAME))}
              {...focusTarget(VIEW, ADD_GAME)}
            >
              <RowChevron />
            </Field>
            <Field
              focusable
              label="Find games"
              description={
                <span style={descriptionStyle}>Look for WoW and Battle.net in your library</span>
              }
              onClick={() => void find()}
              {...focusTarget(VIEW, FIND_GAMES)}
            >
              {finding && <RowSpinner />}
            </Field>
          </DialogControlsSection>
          <DialogControlsSection>
            <DialogControlsSectionHeader>On these pages</DialogControlsSectionHeader>
            {PAGE_TOGGLES.map(({ key, label, description }) => {
              const play = key === "steamLaunchMenu";
              const left = playLeft && play;
              return (
                <FocusSlot key={key} view={VIEW} id={key}>
                  <ToggleField
                    label={label}
                    description={
                      <span style={descriptionStyle}>{left ? DROIDDECK_PLAY : description}</span>
                    }
                    checked={stored.settings[key]}
                    disabled={play ? !playOn : !pagesOn}
                    onChange={(on) => save({ [key]: on })}
                  />
                </FocusSlot>
              );
            })}
          </DialogControlsSection>
        </ScrollBuffer>
      </DialogBody>
      <DialogFooter>
        <DialogButton onClick={closeModal}>Close</DialogButton>
      </DialogFooter>
    </ModalRoot>
  );
}

/**
 * Open Steam library. Closing it (B or touch) puts focus back on its
 * Options row (S36), now when Options is still mounted, or once it mounts
 * again.
 */
export function openSteamLibraryModal(): void {
  const close = () => {
    modalResult.Close();
    requestFocus(QAM_VIEW.settings, STEAM_LIBRARY_ROW);
  };
  const modalResult = showModal(<SteamLibraryModal closeModal={close} />, window, {
    strTitle: TITLE,
    bHideMainWindowForPopouts: false,
  });
}
