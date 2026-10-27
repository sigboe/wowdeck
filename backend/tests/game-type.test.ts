import { describe, expect, test } from "bun:test";
import { WowClientType } from "../src/wow/types";
import { getClientTypeForGameType, getGameTypeForClientType } from "../src/wow/utils/gametype";

// The wire GameType of every client, exactly as main.ts's gameTypeWire table
// had it before RF-05. WTF flavor keys are derived from these values
// (main.ts wtfJobTarget, flavorKeyFor), so none may change.
const WIRE: Array<[WowClientType, string]> = [
  [WowClientType.Retail, "retail"],
  [WowClientType.Classic, "classic"],
  [WowClientType.RetailPtr, "ptr"],
  [WowClientType.ClassicPtr, "classic"],
  [WowClientType.Beta, "beta"],
  [WowClientType.ClassicBeta, "classic_beta"],
  [WowClientType.ClassicEra, "classic_era"],
  [WowClientType.ClassicEraPtr, "classic_era"],
  [WowClientType.RetailXPtr, "ptr"],
  [WowClientType.Anniversary, "classic_era"],
  [WowClientType.Forever, "forever"],
  [WowClientType.None, "retail"],
];

describe("wire game types", () => {
  test.each(WIRE)("client %p is %p on the wire", (client, wire) => {
    expect(getGameTypeForClientType(client)).toBe(wire as never);
  });

  test("a manually added game type maps back to its client", () => {
    expect(getClientTypeForGameType("retail")).toBe(WowClientType.Retail);
    expect(getClientTypeForGameType("classic")).toBe(WowClientType.Classic);
    expect(getClientTypeForGameType("classic_era")).toBe(WowClientType.ClassicEra);
    expect(getClientTypeForGameType("forever")).toBe(WowClientType.Forever);
    expect(getClientTypeForGameType("classic_beta")).toBe(WowClientType.ClassicBeta);
    expect(getClientTypeForGameType("ptr")).toBe(WowClientType.RetailPtr);
    expect(getClientTypeForGameType("beta")).toBe(WowClientType.Beta);
    expect(getClientTypeForGameType("nope")).toBe(WowClientType.None);
  });
});

describe("manual-add game types (api/gameTypes)", () => {
  test("named with the engine's client names", async () => {
    const { MANUAL_GAME_TYPES, gameTypeLabel } = await import("../src/api/gameTypes");
    expect(MANUAL_GAME_TYPES.map((t) => [t, gameTypeLabel(t)])).toEqual([
      ["retail", "Retail"],
      ["classic_era", "Classic Era"],
      ["classic", "Classic"],
      ["forever", "Forever"],
      ["classic_beta", "Forever Beta"],
      ["beta", "Retail Beta"],
      ["ptr", "Retail PTR"],
    ]);
  });
});
