import { describe, expect, test } from "bun:test";
import { WOW_CLIENTS, wowClient, wowClientForFolder } from "../src/wow/clients";
import { WowClientType } from "../src/wow/types";
import { getClientTypeForGameType } from "../src/wow/utils/gametype";

const clientTypes = Object.values(WowClientType).filter(
  (value): value is WowClientType => typeof value === "number" && value !== WowClientType.None,
);

describe("client table", () => {
  test("every client type has a complete record", () => {
    for (const clientType of clientTypes) {
      const client = wowClient(clientType);
      expect(client, WowClientType[clientType]).toBeDefined();
      expect(client!.folder).toMatch(/^_[a-z_]+_$/);
      expect(client!.gameType).not.toBe("");
      expect(client!.wowGameType).not.toBe("");
      expect(client!.shortName).not.toBe("");
      expect(client!.fullName).not.toBe("");
      expect(Array.isArray(client!.formerNames)).toBe(true);
    }
    expect(WOW_CLIENTS).toHaveLength(clientTypes.length);
    expect(wowClient(WowClientType.None)).toBeUndefined();
  });

  test("folders and client types are unique", () => {
    expect(new Set(WOW_CLIENTS.map((c) => c.folder)).size).toBe(WOW_CLIENTS.length);
    expect(new Set(WOW_CLIENTS.map((c) => c.clientType)).size).toBe(WOW_CLIENTS.length);
  });

  test("each game type maps back to one client that carries it", () => {
    // Several clients share a game type (the PTRs, Classic Era and
    // Anniversary); the reverse lookup names the main one.
    for (const { gameType } of WOW_CLIENTS) {
      expect(wowClient(getClientTypeForGameType(gameType))?.gameType).toBe(gameType);
    }
    expect(getClientTypeForGameType("ptr")).toBe(WowClientType.RetailPtr);
    expect(getClientTypeForGameType("classic_era")).toBe(WowClientType.ClassicEra);
    expect(getClientTypeForGameType("classic")).toBe(WowClientType.Classic);
  });

  test("folders resolve to their client", () => {
    expect(wowClientForFolder("_forever_")?.clientType).toBe(WowClientType.Forever);
    expect(wowClientForFolder("_classic_beta_")?.clientType).toBe(WowClientType.ClassicBeta);
    expect(wowClientForFolder("_nope_")).toBeUndefined();
    expect(wowClientForFolder("hasOwnProperty")).toBeUndefined();
  });

  test("Play menu rows follow docs/steam-launch-targets.md", () => {
    expect(wowClient(WowClientType.Retail)!.launch).toEqual({ code: "WoW" });
    expect(wowClient(WowClientType.Forever)!.launch).toEqual({ code: "WoWF" });
    // Mists, Classic Era and Anniversary share one Classic row: WoWC starts
    // the Classic version Battle.net has active.
    for (const type of [WowClientType.Classic, WowClientType.ClassicEra, WowClientType.Anniversary]) {
      expect(wowClient(type)!.launch).toEqual({ code: "WoWC", row: "classic" });
    }
    const rows = WOW_CLIENTS.filter((client) => client.launch).map((client) => client.folder);
    expect(rows).toEqual(["_retail_", "_classic_", "_classic_era_", "_anniversary_", "_forever_"]);
  });
});
