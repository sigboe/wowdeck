import { Focusable, MenuItem } from "@decky/ui";
import { useState, useSyncExternalStore, type ReactNode } from "react";
import { FaBoxOpen, FaChevronDown } from "react-icons/fa";
import type { LaunchClient, LaunchState } from "../../backend/src/api/contracts";
import { settingsStore, steamLaunchMenuOn } from "../settings";
import { isShownLinkedGame, linkedGamesStore } from "../linkedGames";
import { launchControl, playButtonView } from "../steamLaunch";
import {
  launchIconKey,
  setSteamStreamingClient,
  steamLaunch,
  steamLaunchIcon,
  steamLaunchState,
} from "../steamLaunchActions";
import {
  patchPlayButton,
  replaceLocalPlayRow,
  steamEvent,
  type PlayButtonClasses,
} from "../steamPlayButton";
import { SteamChevronDown, SteamMenuCheck } from "../steamIcons";
import { pluginToast, toastError } from "../toast";
import { steamLookup } from "../steamLookup";
import { useResource } from "../useResource";
import { createWarnOnce } from "../warnOnce";

/**
 * Steam's Play button CSS module, as its source names the classes: found by
 * these keys on the webpack client, from Decky 4's `appActionButtonClasses`
 * on the Vite client (steamLookup.ts). G13: INFERRED on webpack, LIVE on
 * Vite (Steam Deck 2026-11-22, which maps all but `CheckContainer`); missing
 * required keys leave Steam's button (docs/ui/device-notes.md §8.4e).
 */
const CLASS_KEYS = [
  "PlayButtonContainer",
  "PlayButton",
  "ButtonChild",
  "HasRemoteText",
  "ShowingStreaming",
  "ButtonText",
  "ButtonRemoteText",
  "StreamingSelector",
  "StreamingContextMenuItem",
  "StreamingTargetLabel",
] as const;
export type SteamPlayClasses = Record<(typeof CLASS_KEYS)[number], string> & {
  /** The menu check's box; Decky 4's table doesn't name it. */
  CheckContainer?: string;
};

let classes: SteamPlayClasses | null | undefined;
/** Steam's Play button classes, or null when this Steam has no such module. */
export function steamPlayClasses(): SteamPlayClasses | null {
  if (classes === undefined) {
    classes = steamLookup.findClasses(CLASS_KEYS, "appActionButtonClasses") ?? null;
  }
  return classes;
}

export function buttonClasses(css: SteamPlayClasses): PlayButtonClasses {
  return {
    container: css.PlayButtonContainer,
    playButton: css.PlayButton,
    hasRemoteText: css.HasRemoteText,
    showingStreaming: css.ShowingStreaming,
    buttonText: css.ButtonText,
    buttonRemoteText: css.ButtonRemoteText,
  };
}

/** One warning per session: Steam's Play button stays as Steam drew it. */
export const warnPlayButton = createWarnOnce("WoW client choice not shown on Steam's Play button");

/** The selected target's icon; WoWDeck's glyph when it is missing or unreadable. */
function TargetIcon({ appId, targetId }: { appId: number; targetId: string }) {
  const src = useResource(steamLaunchIcon, launchIconKey(appId, targetId)).data;
  return <TargetImage key={src ?? ""} src={src} />;
}

/** One icon source; a fresh mount per source, so a new icon gets its own `onError`. */
function TargetImage({ src }: { src: string | null }) {
  const [failed, setFailed] = useState(false);
  // An <svg>, not an <img>: Steam's Play button sizes and spaces its icon
  // with `.PlayButton svg` (24 px, 16 px before the label; LIVE 2026-11-18).
  return src && !failed ? (
    <svg viewBox="0 0 24 24" aria-hidden>
      <image href={src} width={24} height={24} onError={() => setFailed(true)} />
    </svg>
  ) : (
    <FaBoxOpen aria-hidden />
  );
}

/** The app is a linked game right now: only its Play button is wrapped. */
export function isLinkedApp(appId: number): boolean {
  return isShownLinkedGame(appId);
}

/**
 * This shortcut's launch state, read only on a linked page while Options'
 * "Play starts WoW" is on. Off, a button the patch couldn't
 * remount stops reading and draws Steam's own tree.
 */
function useLaunchState(appId: number) {
  const settings = useSyncExternalStore(settingsStore.subscribe, settingsStore.get);
  const linked = useSyncExternalStore(linkedGamesStore.subscribe, linkedGamesStore.get);
  const read = steamLaunchMenuOn(settings) && isShownLinkedGame(appId, settings, linked);
  return useResource(steamLaunchState, read ? String(appId) : null);
}

/**
 * Steam's Play button (`tree`, its own render output) on a page with
 * launch state: the chevron always shows, and Play names and starts the
 * selected target (patchPlayButton). Any other page, a failed read or an
 * unexpected shape gets Steam's button untouched.
 */
export function WowPlayButton({
  appId,
  tree,
  remote,
  steamEntryRunning,
  openMenu,
}: {
  appId: number;
  tree: ReactNode;
  /** A stream target is selected. */
  remote: boolean;
  /** Steam is starting or running the entry (Battle.net), not necessarily WoW. */
  steamEntryRunning: boolean;
  /** Opens Steam's "Play from…" menu with our rows, fixed to this launch state. */
  openMenu: (event: unknown, state: LaunchState) => void;
}) {
  const { data } = useLaunchState(appId);
  const css = steamPlayClasses();
  if (!data || !css) return tree;
  const { target } = data;

  const start = async () => {
    const view = launchControl(data, steamLaunch.canStartSteam(), steamEntryRunning);
    if (view?.reason) {
      pluginToast(`Couldn't launch ${target.shortName}`, view.reason);
      return;
    }
    try {
      await steamLaunch.start(appId);
    } catch (caught) {
      toastError(`Couldn't launch ${target.shortName}`, caught);
    } finally {
      steamLaunchState.invalidate((key) => key === String(appId));
    }
  };

  const patched = patchPlayButton(tree, {
    classes: buttonClasses(css),
    ...playButtonView(data, { remote, steamEntryRunning }),
    icon: <TargetIcon key={target.id} appId={appId} targetId={target.id} />,
    shortName: target.shortName,
    // Steam's own chevron markup, for a page where Steam draws none.
    chevron: (
      <Focusable
        key="wowdeck-play-from"
        className={`${css.StreamingSelector} ${css.ButtonChild}`}
        noFocusRing
        aria-label="Play from…"
        onActivate={(event: unknown) => openMenu(event, data)}
        onClick={(event: unknown) => openMenu(event, data)}
      >
        <SteamChevronDown fallback={<FaChevronDown aria-hidden />} />
      </Focusable>
    ),
    onChevron: (event) => openMenu(event, data),
    onPlay:
      target.kind === "wow"
        ? (event) => {
            const e = steamEvent(event);
            e.stopPropagation();
            e.preventDefault();
            void start();
          }
        : undefined,
  });
  if (!patched) warnPlayButton("unexpected Play button");
  return patched ?? tree;
}

/** WoWDeck's rows in the "Play from…" menu, live while it is open. */
function WowPlayRows({
  appId,
  initial,
  localClientId,
  localSelected,
}: {
  appId: number;
  initial: LaunchState;
  localClientId: unknown;
  localSelected: boolean;
}) {
  const { data, refresh } = useLaunchState(appId);
  const state = data ?? initial;
  const css = steamPlayClasses();

  // Picking only chooses what Play starts: My Addons keeps its installation.
  const pick = async (client: LaunchClient) => {
    setSteamStreamingClient(appId, localClientId);
    try {
      await steamLaunch.select(appId, client.id);
    } catch (caught) {
      toastError(`Couldn't choose ${client.shortName}`, caught);
    } finally {
      await refresh();
    }
  };

  return state.clients.map((client) => (
    <MenuItem
      key={`wowdeck-${client.id}`}
      {...{ className: css?.StreamingContextMenuItem }}
      onSelected={() => void pick(client)}
    >
      <span className={css?.CheckContainer}>
        {localSelected && client.id === state.target.id && <SteamMenuCheck />}
      </span>
      <span className={css?.StreamingTargetLabel}>{client.name}</span>
    </MenuItem>
  ));
}

/**
 * Steam's "Play from…" menu (`steamMenu` renders Steam's own) with its
 * "Play on this Steam Deck" row replaced by Battle.net and a row each for
 * Retail, Classic and Forever. Stream rows stay Steam's. Picking a row only selects it, as
 * Steam's rows do, and points Steam's Play back at this device.
 *
 * The menu itself is built once, from the launch state when the chevron
 * was pressed, as Steam builds its own. Live updates stay inside
 * `WowPlayRows`, so Steam's menu component never updates while open:
 * other plugins patch that component's updates (SteamGridDB adds "Change
 * Artwork..." to any menu of Steam's class that updates).
 */
export function WowPlayMenu({
  appId,
  state,
  steamMenu,
  localSelected,
}: {
  appId: number;
  /** The launch state when the menu opened. */
  state: LaunchState;
  steamMenu: () => ReactNode;
  /** Steam's Play targets this device rather than a stream. */
  localSelected: boolean;
}) {
  // Steam's menu first and unconditionally: it may use hooks.
  const menu = steamMenu();
  const patched = replaceLocalPlayRow(menu, (localClientId) => [
    <WowPlayRows
      key="wowdeck-play-rows"
      appId={appId}
      initial={state}
      localClientId={localClientId}
      localSelected={localSelected}
    />,
  ]);
  if (!patched) warnPlayButton("unexpected Play from menu");
  return patched ?? menu;
}
