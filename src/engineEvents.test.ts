/// <reference types="bun-types" />
/**
 * Engine events reach the module-scope stores through the one router the
 * plugin connects at load, with no panel mounted: nothing here renders.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Addon, Installation } from "./types";
import { connectEngine } from "./engineLink";
import { createFakeEngine, settle, type FakeEngine } from "./testSupport/fakeEngine";

const toasts: string[] = [];
mock.module("@decky/api", () => ({
  toaster: { toast: ({ title }: { title: string }) => toasts.push(title) },
}));

const addon = (id: string) => ({ id, name: id, installationId: "i1" }) as Addon;
const retail = { id: "i1", displayName: "Retail", selected: true } as Installation;

let fake: FakeEngine;
beforeEach(() => {
  toasts.length = 0;
  fake = createFakeEngine({
    "installations.list": { installations: [retail] },
    "addons.list": { addons: [addon("a1")] },
    "installations.recoveryStatus": { installations: [], stateFile: { status: "readable" } },
  });
  connectEngine(fake);
});

const { addonSession } = await import("./session");
const { engineChanges } = await import("./engineChanges");
const { steamUpdates } = await import("./steamUpdates");

describe("engine events with the panel closed", () => {
  test("a change event reaches the addon list", async () => {
    await addonSession.reloadAll();
    expect(addonSession.get().addons.map((a) => a.id)).toEqual(["a1"]);

    fake.answers["addons.list"] = { addons: [addon("a1"), addon("a2")] };
    fake.emit({ event: "addons.changed", params: { addonIds: [] } });
    await settle();

    expect(addonSession.get().addons.map((a) => a.id)).toEqual(["a1", "a2"]);
  });

  test("a change event moves the change count views reload on", () => {
    const before = engineChanges.get()["tradeskillmaster.changed"];
    fake.emit({ event: "tradeskillmaster.changed", params: {} });
    expect(engineChanges.get()["tradeskillmaster.changed"]).toBe(before + 1);
  });

  test("an automatic update says what it did and refreshes the Steam summary", async () => {
    const summary = [{ installationId: "i1", displayName: "Retail", updates: 0 }];
    fake.answers["addons.updateSummary"] = { installations: summary };
    fake.emit({
      event: "addons.autoUpdated",
      params: { result: { at: 0, updated: ["Details"], failed: [], skipped: null } },
    });
    await settle();
    expect(toasts.length).toBe(1);
    expect(steamUpdates.get().summary).toEqual(summary);
  });
});
