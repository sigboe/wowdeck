/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import {
  AUTO_CHECK_EVERY_MS,
  linkedSteamGames,
  autoUpdateText,
  badgeState,
  filterSteamGames,
  likelyWowFirst,
  pickerRowMarker,
  shouldAutoCheck,
  shortcutIconUrl,
  shortcutsFrom,
  updateSummaryText,
} from "./steamLibrary";

describe("shortcutsFrom (BEYOND-05)", () => {
  test("only non-Steam shortcuts, trimmed, A-Z", () => {
    expect(
      shortcutsFrom([
        { appid: 4221385996, display_name: "World of Warcraft ", app_type: 1073741824 },
        { appid: 570, display_name: "Dota 2", app_type: 1 },
        { appid: 3056841011, display_name: "Firefox Web Browser", app_type: 1073741824 },
        { appid: "x", display_name: "Broken", app_type: 1073741824 },
      ]),
    ).toEqual([
      { appId: 3056841011, name: "Firefox Web Browser" },
      { appId: 4221385996, name: "World of Warcraft" },
    ]);
  });
});

describe("filterSteamGames", () => {
  const games = [
    { appId: 1, name: "World of Warcraft" },
    { appId: 2, name: "WoW Classic (Lutris)" },
    { appId: 3, name: "Super Mario 64" },
  ];
  test("by name, ignoring case, and by initials", () => {
    expect(filterSteamGames(games, "warcraft").map((g) => g.appId)).toEqual([1]);
    expect(filterSteamGames(games, "wow").map((g) => g.appId)).toEqual([1, 2]);
    expect(filterSteamGames(games, "  ")).toBe(games);
  });
});

describe("updateSummaryText", () => {
  test("total with per-installation parts when there are several", () => {
    expect(
      updateSummaryText([
        { displayName: "Forever", updates: 2 },
        { displayName: "Classic Era", updates: 1 },
        { displayName: "Retail", updates: 0 },
      ]),
    ).toBe("3 addon updates: Forever 2 · Classic Era 1");
    expect(updateSummaryText([{ displayName: "Forever", updates: 1 }])).toBe("1 addon update");
    expect(
      updateSummaryText([
        { displayName: "Forever", updates: 1 },
        { displayName: "Classic Era", updates: 0 },
      ]),
    ).toBe("1 addon update in Forever");
    expect(updateSummaryText([{ displayName: "Forever", updates: 0 }])).toBe(
      "All addons are up to date",
    );
  });
});

describe("likelyWowFirst", () => {
  test("WoW and Battle.net entries lead, the rest keep their order", () => {
    const names = [
      "Dolphin",
      "Battle.net",
      "Minecraft",
      "World of Warcraft",
      "Blizzard App",
      "Battlenet Launcher",
    ];
    expect(
      likelyWowFirst(names.map((name, i) => ({ appId: i + 1, name }))).map((g) => g.name),
    ).toEqual([
      "Battle.net",
      "World of Warcraft",
      "Blizzard App",
      "Battlenet Launcher",
      "Dolphin",
      "Minecraft",
    ]);
  });
});

describe("badgeState", () => {
  test("checking wins; then updates or current; nothing known, no badge", () => {
    expect(badgeState(null, true)).toBe("checking");
    expect(badgeState(null, false)).toBeNull();
    expect(badgeState([{ updates: 0 }, { updates: 2 }], false)).toBe("updates");
    expect(badgeState([{ updates: 0 }], false)).toBe("current");
  });
});

describe("shouldAutoCheck (background check)", () => {
  test("only when enabled and the last check is at least 15 minutes old", () => {
    const now = 10 * AUTO_CHECK_EVERY_MS;
    expect(shouldAutoCheck(true, 0, now)).toBe(true);
    expect(shouldAutoCheck(true, now - AUTO_CHECK_EVERY_MS + 1, now)).toBe(false);
    expect(shouldAutoCheck(true, now - AUTO_CHECK_EVERY_MS, now)).toBe(true);
    expect(shouldAutoCheck(false, 0, now)).toBe(false);
  });
});

describe("autoUpdateText (WF-02)", () => {
  test("says what was updated or failed, or that it waited", () => {
    expect(
      autoUpdateText({ updated: ["DBM", "Plater", "Bagnon"], failed: [], skipped: null }),
    ).toEqual({
      title: "3 addons updated automatically",
      body: "Updated DBM, Plater +1",
    });
    expect(autoUpdateText({ updated: [], failed: ["X"], skipped: null })?.title).toBe(
      "Couldn't update automatically",
    );
    expect(autoUpdateText({ updated: [], failed: [], skipped: "WoW was running" })?.title).toBe(
      "Automatic updates postponed",
    );
    expect(autoUpdateText({ updated: [], failed: [], skipped: null })).toBeNull();
  });
});

describe("automatic Steam attachments", () => {
  const wow = { appId: 42, name: "WoW" };
  const battle = { appId: 43, name: "Battle.net" };
  const installs = [{ steamGames: [wow, battle] }, { steamGames: [wow] }, {}];
  test("every detected entry is attached once, alongside an explicit manual choice", () => {
    expect(linkedSteamGames(installs, { appId: 9, name: "Manual" })).toEqual([
      { appId: 9, name: "Manual" },
      wow,
      battle,
    ]);
  });
  test("turning off automatic attachment keeps only the explicit manual choice", () => {
    expect(linkedSteamGames(installs, wow, false)).toEqual([wow]);
    expect(linkedSteamGames(installs, null, false)).toEqual([]);
  });
});

describe("pickerRowMarker (#151)", () => {
  const wow = { appId: 42, name: "World of Warcraft" };
  const bnet = { appId: 43, name: "Battle.net" };
  test("the manual link is Currently linked", () => {
    expect(pickerRowMarker(wow, { manual: wow, detected: [], autoLinkOn: true })).toBe(
      "Currently linked",
    );
  });
  test("a detected link is Linked automatically only while automatic linking is on", () => {
    expect(pickerRowMarker(bnet, { manual: null, detected: [bnet], autoLinkOn: true })).toBe(
      "Linked automatically",
    );
    expect(pickerRowMarker(bnet, { manual: null, detected: [bnet], autoLinkOn: false })).toBeNull();
  });
  test("an entry both linked by hand and detected is Currently linked", () => {
    expect(pickerRowMarker(wow, { manual: wow, detected: [wow], autoLinkOn: true })).toBe(
      "Currently linked",
    );
  });
  test("an unlinked entry has no marker", () => {
    expect(pickerRowMarker(bnet, { manual: wow, detected: [wow], autoLinkOn: true })).toBeNull();
  });
});

describe("shortcutIconUrl (#152)", () => {
  const overview = { appid: 42, icon_data: "UE5H", icon_data_format: "png" };
  const store = (url: string | null) => ({
    GetAppOverviewByAppID: (id: number) => (id === 42 ? overview : null),
    GetIconURLForApp: (app: unknown) => (app === overview ? url : "wrong overview"),
  });
  test("Steam's icon URL for the entry with that app id", () => {
    expect(shortcutIconUrl(store("data:image/png;base64,UE5H"), 42)).toBe(
      "data:image/png;base64,UE5H",
    );
  });
  test("no icon yet, no entry, an empty URL or no store: undefined (a blank slot)", () => {
    expect(shortcutIconUrl(store(null), 42)).toBeUndefined();
    expect(shortcutIconUrl(store(""), 42)).toBeUndefined();
    expect(shortcutIconUrl(store("data:x"), 7)).toBeUndefined();
    expect(shortcutIconUrl(undefined, 42)).toBeUndefined();
    expect(shortcutIconUrl({}, 42)).toBeUndefined();
  });
  test("a store that throws gives undefined", () => {
    const broken = {
      GetAppOverviewByAppID: () => {
        throw new Error("gone");
      },
      GetIconURLForApp: () => "data:x",
    };
    expect(shortcutIconUrl(broken, 42)).toBeUndefined();
  });
});
