import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act, type ReactElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { LinkedGame, LinkedGames, SteamGameLink } from "../backend/src/api/contracts";
import { defaultSettings } from "../backend/src/wow/storage/settings";
import { deckyUiStub } from "./deckyUiStub";
import { connectEngine } from "./engineLink";
import { createFakeEngine, engineFailure, settle, type FakeEngine } from "./testSupport/fakeEngine";

/**
 * Options › Steam library (#290, #291): one row with a status line, opening
 * a modal that lists the linked games (A removes one), Add a game (the
 * picker, stacked on top), Find games, and the toggles for Steam's pages.
 * Rendered over a fake engine with the real stores.
 */

const toasts: string[] = [];
mock.module("@decky/api", () => ({
  toaster: { toast: ({ title }: { title: string }) => toasts.push(title) },
}));

let shown: ReactElement | null = null;
let closed = 0;
type Row = {
  label?: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  onOKActionDescription?: string;
  children?: ReactNode;
};
mock.module("@decky/ui", () => ({
  ...deckyUiStub,
  // A row as the player reads it: label, description, A's footer action.
  Field: ({ label, description, disabled, onClick, onOKActionDescription, children }: Row) => (
    <div data-row data-disabled={disabled ? "true" : undefined} onClick={onClick}>
      <b>{label}</b>
      <i>{description}</i>
      {children}
      {onOKActionDescription && <footer>A: {onOKActionDescription}</footer>}
    </div>
  ),
  ToggleField: ({
    label,
    description,
    disabled,
    checked,
    onChange,
  }: Row & { checked?: boolean; onChange?: (on: boolean) => void }) => (
    <div data-row data-disabled={disabled ? "true" : undefined}>
      <b>{label}</b>
      <i>{description}</i>
      <input
        type="checkbox"
        aria-label={String(label)}
        checked={checked ?? false}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.checked)}
      />
    </div>
  ),
  showModal: (element: ReactElement) => {
    shown = element;
    return { Close: () => closed++ };
  },
}));

const { SteamLibrarySection } = await import("./components/settings/SteamLibrarySection");
const { settingsStore } = await import("./settings");
const { linkedGamesStore } = await import("./linkedGames");
const { rememberedFocus } = await import("./focusMemory");

const WOW: LinkedGame = { appId: 42, name: "World of Warcraft", source: "found" };
const BNET: LinkedGame = { appId: 43, name: "Battle.net", source: "added" };
const LUTRIS: SteamGameLink = { appId: 44, name: "Lutris" };
const MARIO: SteamGameLink = { appId: 45, name: "Super Mario 64" };

const env = globalThis as {
  window?: unknown;
  IS_REACT_ACT_ENVIRONMENT?: boolean;
  appStore?: unknown;
};

/** Steam's library: these non-Steam games, and one Steam game. */
function steamHas(games: SteamGameLink[]) {
  env.appStore = {
    allApps: [
      ...games.map(({ appId, name }) => ({
        appid: appId,
        display_name: name,
        app_type: 1073741824,
      })),
      { appid: 570, display_name: "Dota 2", app_type: 1 },
    ],
  };
}
const oldWindow = env.window;
let dom: JSDOM;
let root: Root;
let fake: FakeEngine;
let disconnect: () => void;

beforeEach(() => {
  dom = new JSDOM('<div id="root"></div>');
  env.window = dom.window;
  env.IS_REACT_ACT_ENVIRONMENT = true;
  fake = createFakeEngine();
  disconnect = connectEngine(fake);
  root = createRoot(dom.window.document.getElementById("root")!);
  toasts.splice(0);
  shown = null;
  closed = 0;
  steamHas([]);
});

afterEach(async () => {
  await act(async () => root.unmount());
  disconnect();
  dom.window.close();
  env.window = oldWindow;
  delete env.IS_REACT_ACT_ENVIRONMENT;
  delete env.appStore;
});

/** What the engine holds: Show in Steam, the linked games, the removed ones and who owns Play. */
async function engineHas(
  held: Omit<LinkedGames, "removed" | "playOwner"> &
    Partial<Pick<LinkedGames, "removed" | "playOwner">>,
) {
  const linked: LinkedGames = { removed: [], playOwner: "wowdeck", ...held };
  fake.answers["settings.get"] = {
    settings: { ...defaultSettings(), steamEnabled: linked.enabled },
  };
  fake.answers["linkedGames.get"] = linked;
  await act(async () => {
    await settingsStore.load();
    await linkedGamesStore.load();
  });
}

/** Every heading and row, in order: "label · description", "(disabled)", "A: action". */
function read(): string[] {
  const doc = dom.window.document;
  return [...doc.querySelectorAll("#root h2, #root h3, #root [data-row]")].map((el) => {
    if (!el.hasAttribute("data-row")) return el.textContent ?? "";
    const label = el.querySelector(":scope > b")?.textContent ?? "";
    const description = el.querySelector(":scope > i")?.textContent ?? "";
    const action = el.querySelector(":scope > footer")?.textContent;
    return [
      description ? `${label} · ${description}` : label,
      el.getAttribute("data-disabled") ? "(disabled)" : "",
      action ?? "",
    ]
      .filter(Boolean)
      .join(" ");
  });
}

const optionsRow = async () => {
  await act(async () => root.render(<SteamLibrarySection />));
  return read();
};

async function openModal() {
  await act(async () => root.render(<SteamLibrarySection />));
  const row = dom.window.document.querySelector<HTMLElement>("#root [data-row]")!;
  await act(async () => row.click());
  await act(async () => root.render(shown!));
}

const row = (label: string) =>
  [...dom.window.document.querySelectorAll<HTMLElement>("#root [data-row]")].find(
    (el) => el.querySelector(":scope > b")?.textContent === label,
  )!;

test("the Options row says where things stand: one game, several, none, or off", async () => {
  await engineHas({ enabled: true, games: [WOW] });
  expect(await optionsRow()).toEqual(["Steam library", "Steam library · On · World of Warcraft"]);
  await engineHas({ enabled: true, games: [WOW, BNET] });
  expect(await optionsRow()).toEqual(["Steam library", "Steam library · On · 2 games"]);
  await engineHas({ enabled: true, games: [] });
  expect(await optionsRow()).toEqual(["Steam library", "Steam library · On · No games"]);
  await engineHas({ enabled: false, games: [WOW] });
  expect(await optionsRow()).toEqual(["Steam library", "Steam library · Off"]);
});

/** Settings loaded, and the linked games never read: as a fresh plugin load. */
async function nothingReadYet() {
  linkedGamesStore.reset();
  fake.answers["settings.get"] = { settings: defaultSettings() };
  await act(async () => settingsStore.load());
}

test("while the first read runs, the Options row and the list say Loading…", async () => {
  await nothingReadYet();
  void linkedGamesStore.load();
  expect(await optionsRow()).toEqual(["Steam library", "Steam library · Loading…"]);
  await openModal();
  expect(read().slice(2, 4)).toEqual(["Linked games", "Loading…"]);
});

test("a failed read is an error with Retry, never an empty list; Retry reads again", async () => {
  await nothingReadYet();
  fake.answers["linkedGames.get"] = engineFailure("io_error", "disk full");
  await act(async () => linkedGamesStore.load());
  expect(await optionsRow()).toEqual([
    "Steam library",
    "Steam library · Couldn't load linked games",
  ]);
  await openModal();
  expect(read().slice(2, 4)).toEqual([
    "Linked games",
    "Couldn't load linked games · disk full A: Retry",
  ]);
  expect(read()).not.toContain("No games linked");

  fake.answers["linkedGames.get"] = {
    enabled: true,
    games: [WOW],
    removed: [],
    playOwner: "wowdeck",
  };
  await act(async () => row("Couldn't load linked games").click());
  await settle();
  expect(read().slice(2, 4)).toEqual([
    "Linked games",
    "World of Warcraft · Found automatically A: Remove",
  ]);
  // The Retry row is gone: focus goes to the first game (S36).
  expect(rememberedFocus("modal.steamLibrary")).toBe(`game:${WOW.appId}`);
});

test("a failed read after the engine answered keeps the list it showed", async () => {
  await engineHas({ enabled: true, games: [WOW] });
  fake.answers["linkedGames.get"] = engineFailure("io_error", "disk full");
  await act(async () => linkedGamesStore.load());
  expect(await optionsRow()).toEqual(["Steam library", "Steam library · On · World of Warcraft"]);
});

test("the modal lists the master switch, each linked game and the toggles for Steam's pages", async () => {
  await engineHas({ enabled: true, games: [WOW, BNET] });
  await openModal();
  expect(read()).toEqual([
    "Steam library",
    "Show in Steam · Addon updates on game pages and tiles",
    "Linked games",
    "World of Warcraft · Found automatically A: Remove",
    "Battle.net · Added by you A: Remove",
    "Add a game · Pick one of your non-Steam games",
    "Find games · Look for WoW and Battle.net in your library",
    "On these pages",
    "Check for updates · When the page or tile appears, at most every 15 minutes",
    "Tile badge · Green when updates are waiting",
    "Play starts WoW · Pick the version with the arrow beside it",
  ]);
});

test("with nothing linked the list says so", async () => {
  await engineHas({ enabled: true, games: [] });
  await openModal();
  expect(read().slice(2, 4)).toEqual(["Linked games", "No games linked"]);
});

test("A on a game row removes it and says so", async () => {
  await engineHas({ enabled: true, games: [WOW, BNET] });
  fake.answers["linkedGames.remove"] = ({ appId }) => ({
    enabled: true,
    games: [WOW, BNET].filter((game) => game.appId !== appId),
    removed: [],
    playOwner: "wowdeck",
  });
  await openModal();
  await act(async () => row("Battle.net").click());
  await settle();
  expect(fake.paramsOf("linkedGames.remove")).toEqual([{ appId: BNET.appId }]);
  expect(toasts).toEqual(["Removed Battle.net"]);
  expect(read()).not.toContain("Battle.net · Added by you A: Remove");
});

test("a remove the engine refuses keeps the game and says it couldn't", async () => {
  await engineHas({ enabled: true, games: [WOW] });
  await openModal();
  const removing = act(async () => row("World of Warcraft").click());
  await fake.next("linkedGames.remove").reject("io_error", "disk full");
  await removing;
  expect(toasts).toEqual(["Couldn't remove World of Warcraft"]);
  expect(read()).toContain("World of Warcraft · Found automatically A: Remove");
});

test("Show in Steam off greys out the three page rows in place", async () => {
  await engineHas({ enabled: false, games: [WOW] });
  await openModal();
  expect(read().slice(-4)).toEqual([
    "On these pages",
    "Check for updates · When the page or tile appears, at most every 15 minutes (disabled)",
    "Tile badge · Green when updates are waiting (disabled)",
    "Play starts WoW · Pick the version with the arrow beside it (disabled)",
  ]);
  expect(read()).toContain("World of Warcraft · Found automatically A: Remove");
});

test("flipping Show in Steam saves it, and the page rows follow at once", async () => {
  await engineHas({ enabled: true, games: [WOW] });
  await openModal();
  const toggle = row("Show in Steam").querySelector("input")!;
  await act(async () => toggle.click());
  expect(fake.paramsOf("settings.set")).toEqual([{ settings: { steamEnabled: false } }]);
  expect(row("Tile badge").getAttribute("data-disabled")).toBe("true");
});

const DROIDDECK_LINE = "Not available on DroidDeck. DroidDeck launches game directly";

test("on DroidDeck, Play starts WoW is greyed out with DroidDeck's line, the other rows work", async () => {
  await engineHas({ enabled: true, games: [WOW], playOwner: "droiddeck" });
  await openModal();
  expect(read().slice(-4)).toEqual([
    "On these pages",
    "Check for updates · When the page or tile appears, at most every 15 minutes",
    "Tile badge · Green when updates are waiting",
    `Play starts WoW · ${DROIDDECK_LINE} (disabled)`,
  ]);
  // Disabled as Show in Steam off greys out a row, so the controller skips
  // it; the setting itself stays as it was.
  const play = row("Play starts WoW").querySelector("input")!;
  expect(play.disabled).toBe(true);
  expect(play.checked).toBe(true);
  expect(fake.paramsOf("settings.set")).toEqual([]);
});

test("on DroidDeck, Show in Steam off greys out all three, Play keeping DroidDeck's line", async () => {
  await engineHas({ enabled: true, games: [WOW], playOwner: "droiddeck" });
  await openModal();
  const showInSteam = () => row("Show in Steam").querySelector("input")!;
  await act(async () => showInSteam().click());
  expect(read().slice(-4)).toEqual([
    "On these pages",
    "Check for updates · When the page or tile appears, at most every 15 minutes (disabled)",
    "Tile badge · Green when updates are waiting (disabled)",
    `Play starts WoW · ${DROIDDECK_LINE} (disabled)`,
  ]);
  await act(async () => showInSteam().click());
  expect(read().slice(-4)).toEqual([
    "On these pages",
    "Check for updates · When the page or tile appears, at most every 15 minutes",
    "Tile badge · Green when updates are waiting",
    `Play starts WoW · ${DROIDDECK_LINE} (disabled)`,
  ]);
});

test("until the linked games answer, Play starts WoW can't be flipped, nor after a failed read", async () => {
  linkedGamesStore.reset();
  fake.answers["settings.get"] = { settings: { ...defaultSettings(), steamEnabled: true } };
  await act(async () => settingsStore.load());
  // Who owns Play isn't known yet: on DroidDeck this row must never work.
  const reading = linkedGamesStore.load();
  await openModal();
  const play = () => row("Play starts WoW").querySelector("input")!;
  expect(play().disabled).toBe(true);
  expect(row("Tile badge").getAttribute("data-disabled")).toBeNull();

  await act(async () => {
    await fake.next("linkedGames.get").reject("io_error", "disk full");
    await reading;
  });
  expect(read()).toContain("Couldn't load linked games · disk full A: Retry");
  expect(play().disabled).toBe(true);
  expect(fake.paramsOf("settings.set")).toEqual([]);
});

test("without DroidDeck, Play starts WoW is a working toggle that follows Show in Steam", async () => {
  await engineHas({ enabled: true, games: [WOW] });
  await openModal();
  const play = () => row("Play starts WoW").querySelector("input")!;
  expect(play().disabled).toBe(false);
  await act(async () => play().click());
  expect(fake.paramsOf("settings.set")).toEqual([{ settings: { steamLaunchMenu: false } }]);
  await act(async () => row("Show in Steam").querySelector("input")!.click());
  expect(read().slice(-1)).toEqual([
    "Play starts WoW · Pick the version with the arrow beside it (disabled)",
  ]);
});

/** Open the picker from the modal's Add a game row. */
async function openPicker() {
  await openModal();
  await act(async () => row("Add a game").click());
  await act(async () => root.render(shown!));
}

/** The picker's game rows: "name — description". */
const pickerRows = () =>
  [...dom.window.document.querySelectorAll("#root [data-row-name]")].map(
    (name) =>
      `${name.textContent} — ${name.parentElement?.querySelector("[data-row-description]")?.textContent ?? ""}`,
  );

const pickerRow = (name: string) =>
  [...dom.window.document.querySelectorAll<HTMLElement>("#root [data-row]")].find(
    (el) => el.querySelector("[data-row-name]")?.textContent === name,
  )!;

test("Add a game lists only unlinked non-Steam games, removed ones first and marked", async () => {
  steamHas([BNET, LUTRIS, MARIO, WOW]);
  await engineHas({
    enabled: true,
    games: [WOW],
    removed: [{ appId: BNET.appId, name: BNET.name }],
  });
  await openPicker();
  expect(dom.window.document.querySelector("#root h2")?.textContent).toBe("Add a game");
  expect(pickerRows()).toEqual([
    "Battle.net — App 43 · Removed",
    "Lutris — App 44",
    "Super Mario 64 — App 45",
  ]);
  expect(pickerRow("Lutris").querySelector("footer")?.textContent).toBe("A: Add");
});

test("picking a game adds it, says so, and focus goes back to Add a game", async () => {
  steamHas([LUTRIS, WOW]);
  await engineHas({ enabled: true, games: [WOW] });
  fake.answers["linkedGames.add"] = ({ appId, name }) => ({
    enabled: true,
    games: [WOW, { appId, name, source: "added" }],
    removed: [],
    playOwner: "wowdeck",
  });
  await openPicker();
  await act(async () => pickerRow("Lutris").click());
  await settle();
  expect(fake.paramsOf("linkedGames.add")).toEqual([LUTRIS]);
  expect(toasts).toEqual(["Added Lutris"]);
  expect(closed).toBe(1);
  expect(rememberedFocus("modal.steamLibrary")).toBe("addGame");
});

test("picking a removed game asks the engine to add it back", async () => {
  steamHas([BNET, WOW]);
  await engineHas({
    enabled: true,
    games: [WOW],
    removed: [{ appId: BNET.appId, name: BNET.name }],
  });
  fake.answers["linkedGames.add"] = {
    enabled: true,
    games: [WOW, { ...BNET, source: "found" }],
    removed: [],
    playOwner: "wowdeck",
  };
  await openPicker();
  await act(async () => pickerRow("Battle.net").click());
  await settle();
  expect(fake.paramsOf("linkedGames.add")).toEqual([{ appId: BNET.appId, name: BNET.name }]);
  expect(toasts).toEqual(["Added Battle.net"]);
});

test("B on the picker puts focus back on Add a game", async () => {
  steamHas([LUTRIS]);
  await engineHas({ enabled: true, games: [] });
  await openPicker();
  await act(async () => (shown!.props as { closeModal: () => void }).closeModal());
  expect(closed).toBe(1);
  expect(rememberedFocus("modal.steamLibrary")).toBe("addGame");
  expect(fake.paramsOf("linkedGames.add")).toEqual([]);
});

test("with every non-Steam game linked, the picker says so", async () => {
  steamHas([WOW]);
  await engineHas({ enabled: true, games: [WOW] });
  await openPicker();
  expect(pickerRows()).toEqual([]);
  expect(read()).toContain("Every non-Steam game is linked");
});

/** Press Find games with the engine answering `found`. */
async function findGames(found: LinkedGame[]) {
  fake.answers["linkedGames.find"] = {
    enabled: true,
    games: [WOW, ...found],
    removed: [],
    playOwner: "wowdeck",
    found,
  };
  await openModal();
  await act(async () => row("Find games").click());
  await settle();
}

test("Find games names what came back", async () => {
  await engineHas({ enabled: true, games: [WOW] });
  await findGames([{ ...BNET, source: "found" }]);
  expect(fake.paramsOf("linkedGames.find")).toHaveLength(1);
  expect(toasts).toEqual(["Found Battle.net"]);
  expect(read()).toContain("Battle.net · Found automatically A: Remove");
});

test("Find games names two games, and counts more", async () => {
  await engineHas({ enabled: true, games: [] });
  await findGames([WOW, { ...BNET, source: "found" }]);
  expect(toasts).toEqual(["Found World of Warcraft and Battle.net"]);
  toasts.splice(0);
  await findGames([WOW, { ...BNET, source: "found" }, { ...LUTRIS, source: "found" }]);
  expect(toasts).toEqual(["Found 3 games"]);
});

test("Find games with nothing new says so", async () => {
  await engineHas({ enabled: true, games: [WOW] });
  await findGames([]);
  expect(toasts).toEqual(["No new games found"]);
});

test("Find games the engine can't finish says it couldn't", async () => {
  await engineHas({ enabled: true, games: [WOW] });
  await openModal();
  const finding = act(async () => row("Find games").click());
  await fake.next("linkedGames.find").reject("io_error", "disk full");
  await finding;
  expect(toasts).toEqual(["Couldn't look for games"]);
});
