/** The SteamOS update toast's words: the same text the frontend built before the engine did. */

import { describe, expect, test } from "bun:test";
import { updateToastText } from "../src/wow/notifications/UpdateToastText";

describe("updateToastText", () => {
  test("one update in one installation", () => {
    expect(updateToastText([{ displayName: "Retail", updates: 1 }])).toEqual({
      title: "1 addon update available",
      body: "Open WoWDeck Manager to update",
    });
  });

  test("several updates in one installation", () => {
    expect(updateToastText([{ displayName: "Retail", updates: 4 }])).toEqual({
      title: "4 addon updates available",
      body: "Open WoWDeck Manager to update",
    });
  });

  test("two installations are named", () => {
    expect(
      updateToastText([
        { displayName: "Retail", updates: 2 },
        { displayName: "Classic Era", updates: 1 },
      ]),
    ).toEqual({ title: "3 addon updates available", body: "In Retail and Classic Era" });
  });

  test("three installations are listed in order", () => {
    expect(
      updateToastText([
        { displayName: "Retail", updates: 1 },
        { displayName: "Classic Era", updates: 1 },
        { displayName: "Cataclysm Classic", updates: 1 },
      ]),
    ).toEqual({ title: "3 addon updates available", body: "In Retail, Classic Era and Cataclysm Classic" });
  });

  test("only installations with updates are named or counted", () => {
    expect(
      updateToastText([
        { displayName: "Retail", updates: 2 },
        { displayName: "PTR", updates: 0 },
        { displayName: "Classic Era", updates: 1 },
      ]),
    ).toEqual({ title: "3 addon updates available", body: "In Retail and Classic Era" });
    expect(
      updateToastText([
        { displayName: "Retail", updates: 0 },
        { displayName: "Classic Era", updates: 2 },
      ]),
    ).toEqual({ title: "2 addon updates available", body: "Open WoWDeck Manager to update" });
  });

  test("no updates, no toast", () => {
    expect(updateToastText([])).toBeNull();
    expect(updateToastText([{ displayName: "Retail", updates: 0 }])).toBeNull();
  });
});
