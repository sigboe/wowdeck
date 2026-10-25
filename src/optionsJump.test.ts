/// <reference types="bun-types" />
import { beforeEach, describe, expect, test } from "bun:test";
import {
  clearSourceJump,
  sourceJump,
  sourceRowKey,
  startSourceJump,
  subscribeSourceJump,
} from "./optionsJump";
import { rememberFocus, rememberedFocus, resetFocusMemory } from "./focusMemory";
import { QAM_VIEW } from "./qamState";
import type { ProviderInfo } from "./types";

function provider(id: string, overrides: Partial<ProviderInfo> = {}): ProviderInfo {
  return {
    id,
    name: id,
    enabled: true,
    available: true,
    requiresApiKey: false,
    configured: true,
    allowEdit: true,
    catalogSearch: true,
    discovers: true,
    ...overrides,
  };
}

beforeEach(() => {
  clearSourceJump();
  resetFocusMemory();
});

describe("the Options jump", () => {
  test("carries the marked provider ids and lands on the first focusable marked row", () => {
    startSourceJump(["Curse", "WowUpHub"], [provider("Curse"), provider("WowUpHub")], "curseKey");
    const jump = sourceJump();
    expect(jump).not.toBeNull();
    expect([...jump!.marked]).toEqual(["Curse", "WowUpHub"]);
    expect(jump!.landingKey).toBe(sourceRowKey("Curse"));
    expect(rememberedFocus(QAM_VIEW.settings)).toBe(sourceRowKey("Curse"));
  });

  test("falls back when no marked row can take focus (a source still needs its key)", () => {
    startSourceJump(
      ["Curse"],
      [provider("Curse", { requiresApiKey: true, configured: false })],
      "curseKey",
    );
    expect(sourceJump()!.landingKey).toBe("curseKey");
    expect(rememberedFocus(QAM_VIEW.settings)).toBe("curseKey");
  });

  test("marks rows without touching any provider setting", () => {
    const providers = [provider("Curse", { enabled: false, available: false })];
    startSourceJump(["Curse"], providers, "curseKey");
    expect(sourceJump()!.marked.has("Curse")).toBe(true);
    // The jump read the caller's list; nothing was enabled or disabled.
    expect(providers[0]).toMatchObject({ enabled: false, available: false });
  });

  test("focus moving on to an unrelated settings row ends the highlight", () => {
    startSourceJump(["Curse"], [provider("Curse")], "curseKey");
    rememberFocus(QAM_VIEW.settings, "browse");
    expect(sourceJump()).toBeNull();
  });

  test("focus staying on a marked row or the landing row keeps it", () => {
    startSourceJump(["Curse", "WowUpHub"], [provider("Curse"), provider("WowUpHub")], "curseKey");
    rememberFocus(QAM_VIEW.settings, sourceRowKey("WowUpHub"));
    expect(sourceJump()).not.toBeNull();
    rememberFocus(QAM_VIEW.settings, sourceRowKey("Curse"));
    expect(sourceJump()).not.toBeNull();
  });

  test("the fallback landing row keeps it too", () => {
    startSourceJump(
      ["Curse"],
      [provider("Curse", { requiresApiKey: true, configured: false })],
      "curseKey",
    );
    rememberFocus(QAM_VIEW.settings, "curseKey");
    expect(sourceJump()).not.toBeNull();
  });

  test("focus in another view does not end it", () => {
    startSourceJump(["Curse"], [provider("Curse")], "curseKey");
    rememberFocus(QAM_VIEW.browse, "result:Curse:1");
    expect(sourceJump()).not.toBeNull();
  });

  test("clearing notifies subscribers and is idempotent", () => {
    let notified = 0;
    const unsubscribe = subscribeSourceJump(() => notified++);
    startSourceJump(["Curse"], [provider("Curse")], "curseKey");
    clearSourceJump();
    clearSourceJump();
    unsubscribe();
    expect(notified).toBe(2);
    expect(sourceJump()).toBeNull();
  });

  test("an empty jump with nothing to land on is not a jump", () => {
    startSourceJump([], [], undefined);
    expect(sourceJump()).toBeNull();
    expect(rememberedFocus(QAM_VIEW.settings)).toBeUndefined();
  });
});
