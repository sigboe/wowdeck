import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { hideOnScreenKeyboard } from "./virtualKeyboard";

// Bun has no `window`: stand one in for each test.
const win: { SteamUIStore?: unknown } = {};
const global = globalThis as { window?: unknown };

beforeEach(() => {
  global.window = win;
});

function keyboard(showing: boolean) {
  const calls: string[] = [];
  win.SteamUIStore = {
    ActiveWindowInstance: {
      VirtualKeyboardManager: {
        IsShowingVirtualKeyboard: { Value: showing },
        SetVirtualKeyboardHidden: () => calls.push("hide"),
      },
    },
  };
  return calls;
}

afterEach(() => {
  delete win.SteamUIStore;
  delete global.window;
});

describe("hideOnScreenKeyboard", () => {
  test("closes an open keyboard", () => {
    const calls = keyboard(true);
    hideOnScreenKeyboard();
    expect(calls).toEqual(["hide"]);
  });

  test("leaves a closed keyboard alone", () => {
    const calls = keyboard(false);
    hideOnScreenKeyboard();
    expect(calls).toEqual([]);
  });

  test("does nothing when Steam's store is missing or changed", () => {
    delete global.window;
    expect(() => hideOnScreenKeyboard()).not.toThrow();
    global.window = win;
    expect(() => hideOnScreenKeyboard()).not.toThrow();
    win.SteamUIStore = { ActiveWindowInstance: null };
    expect(() => hideOnScreenKeyboard()).not.toThrow();
    win.SteamUIStore = {
      ActiveWindowInstance: {
        VirtualKeyboardManager: {
          SetVirtualKeyboardHidden: () => {
            throw new Error("changed");
          },
        },
      },
    };
    expect(() => hideOnScreenKeyboard()).not.toThrow();
  });
});
