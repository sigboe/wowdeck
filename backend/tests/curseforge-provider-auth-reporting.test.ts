/**
 * CurseForgeProvider's optional 3rd constructor param
 * (`reportOutcome`) — verifies every authenticated method reports
 * success/failure, without needing the full CurseForgeAuthService
 * wired in (a plain recording callback is enough to prove the wiring
 * itself is correct; CurseForgeAuthService's own decision logic is
 * covered separately in curseforge-key-auth.test.ts).
 */

import { describe, expect, test } from "bun:test";
import { CurseForgeProvider } from "../src/wow/providers/curseforge/CurseForgeProvider";
import { NetworkClient, NetworkError } from "../src/wow/net/network";
import { WowClientType } from "../src/wow/types";
import type { WowInstallation } from "../src/wow/models";

const retail: WowInstallation = {
  id: "retail",
  clientType: WowClientType.Retail,
  location: "/x/_retail_",
  label: "_retail_",
  displayName: "Retail",
  selected: false,
  defaultAddonChannelType: 0,
  source: "detected",
};

function recorder(): { outcomes: (unknown | null)[]; report: (err: unknown | null) => void } {
  const outcomes: (unknown | null)[] = [];
  return { outcomes, report: (err) => outcomes.push(err) };
}

describe("CurseForgeProvider reportOutcome wiring", () => {
  test("a successful search reports a null (ok) outcome", async () => {
    const net = { getJson: async <T>() => ({ data: [] }) as T } as unknown as NetworkClient;
    const { outcomes, report } = recorder();
    const provider = new CurseForgeProvider(net, () => "key", undefined, report);

    await provider.searchByQuery("x", retail);
    expect(outcomes).toEqual([null]);
  });

  test("a failed search reports the thrown error", async () => {
    const boom = new NetworkError("GET x failed: HTTP 403", 403, "x");
    const net = {
      getJson: async () => {
        throw boom;
      },
    } as unknown as NetworkClient;
    const { outcomes, report } = recorder();
    const provider = new CurseForgeProvider(net, () => "key", undefined, report);

    await expect(provider.searchByQuery("x", retail)).rejects.toThrow();
    expect(outcomes).toEqual([boom]);
  });

  test("getCategories reports success, and caching never fires a second report", async () => {
    const net = {
      getJson: async <T>() => ({ data: [] }) as T,
    } as unknown as NetworkClient;
    const { outcomes, report } = recorder();
    const provider = new CurseForgeProvider(net, () => "key", undefined, report);

    await provider.getCategories(retail);
    await provider.getCategories(retail); // cached — no second network call, no second report
    expect(outcomes).toEqual([null]);
  });

  test("getAll reports success even with an empty id list (no network call made at all)", async () => {
    const net = {} as unknown as NetworkClient;
    const { outcomes, report } = recorder();
    const provider = new CurseForgeProvider(net, () => "key", undefined, report);

    await provider.getAll(retail, []);
    // short-circuits before any request — nothing to report either way
    expect(outcomes).toEqual([]);
  });

  test("getAll reports failure on a thrown error", async () => {
    const boom = new NetworkError("POST x failed: HTTP 401", 401, "x");
    const net = {
      postJson: async () => {
        throw boom;
      },
    } as unknown as NetworkClient;
    const { outcomes, report } = recorder();
    const provider = new CurseForgeProvider(net, () => "key", undefined, report);

    await expect(provider.getAll(retail, ["1"])).rejects.toThrow();
    expect(outcomes).toEqual([boom]);
  });

  test("getDescription reports success", async () => {
    const net = { getJson: async <T>() => ({ data: "<p>hi</p>" }) as T } as unknown as NetworkClient;
    const { outcomes, report } = recorder();
    const provider = new CurseForgeProvider(net, () => "key", undefined, report);

    await provider.getDescription("1");
    expect(outcomes).toEqual([null]);
  });

  test("the default reportOutcome (omitted) is a safe no-op", async () => {
    const net = { getJson: async <T>() => ({ data: [] }) as T } as unknown as NetworkClient;
    const provider = new CurseForgeProvider(net, () => "key");
    await expect(provider.searchByQuery("x", retail)).resolves.toEqual([]);
  });
});
