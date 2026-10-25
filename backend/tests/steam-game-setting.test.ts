import { describe, expect, test } from "bun:test";
import { normalizeSteamGame } from "../src/wow/storage/settings";

describe("normalizeSteamGame (BEYOND-05)", () => {
  test("keeps a real app id and a trimmed name", () => {
    expect(normalizeSteamGame({ appId: 4221385996, name: "  World of Warcraft " })).toEqual({
      appId: 4221385996,
      name: "World of Warcraft",
    });
  });
  test("anything else unlinks", () => {
    for (const bad of [null, undefined, "x", { appId: -1, name: "a" }, { appId: 1.5, name: "a" }, { appId: "1", name: "a" }, { appId: 1 }]) {
      expect(normalizeSteamGame(bad)).toBeNull();
    }
  });
});
