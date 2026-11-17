import { expect, mock, test } from "bun:test";

const toasts: string[] = [];
mock.module("@decky/api", () => ({
  toaster: { toast: (t: { body: string }) => toasts.push(t.body) },
}));
mock.module("@decky/ui", async () => (await import("./deckyUiStub")).deckyUiStub);
const { interceptNativeApply } = await import("./nativeLayoutPreview");

test("X on Steam's preview reaches Steam unchanged except for WoWDeck-approved layouts", async () => {
  const calls: string[] = [];
  const input = {
    SetSelectedConfigForApp: async (_appid: number, _index: number, url: string) => {
      calls.push(url);
      return "steam";
    },
  };
  const saved = Object.getOwnPropertyDescriptor(globalThis, "SteamClient");
  Object.assign(globalThis, { SteamClient: { Input: input } });
  try {
    const original = input.SetSelectedConfigForApp;
    const stop = interceptNativeApply();
    expect(await input.SetSelectedConfigForApp(42, 15, "workshop://1")).toBe("steam");
    expect(
      await input.SetSelectedConfigForApp(42, 15, "usercloud://wowdeck-approved/" + "a".repeat(64)),
    ).toBeUndefined();
    expect(calls).toEqual(["workshop://1"]);
    // No WoWDeck preview was opened, so nothing is applied.
    expect(toasts).toEqual(["Couldn't apply this layout. Preview it again from WoWDeck."]);
    stop();
    expect(input.SetSelectedConfigForApp).toBe(original);
  } finally {
    if (saved) Object.defineProperty(globalThis, "SteamClient", saved);
    else Reflect.deleteProperty(globalThis, "SteamClient");
  }
});

test("a locked Steam object never breaks plugin load", () => {
  const saved = Object.getOwnPropertyDescriptor(globalThis, "SteamClient");
  const input = {};
  Object.defineProperty(input, "SetSelectedConfigForApp", {
    value: async () => {},
    writable: false,
    configurable: false,
  });
  Object.assign(globalThis, { SteamClient: { Input: input } });
  try {
    expect(() => interceptNativeApply()()).not.toThrow();
  } finally {
    if (saved) Object.defineProperty(globalThis, "SteamClient", saved);
    else Reflect.deleteProperty(globalThis, "SteamClient");
  }
});

test("leaving Steam's preview by X pushes the player's page back and reopens WoWDeck", async () => {
  const { returnAfterPreviewForTest } = await import("./nativeLayoutPreview");
  let path = "/library/home";
  const pushed: string[] = [];
  let listener: (l: { pathname?: string }) => void = () => {};
  const history = {
    get location() {
      return { pathname: path };
    },
    push: (p: string) => {
      pushed.push(p);
      path = p;
    },
    listen: (l: typeof listener) => {
      listener = l;
      return () => {};
    },
  };
  returnAfterPreviewForTest(history, "layout-a");
  path = "/app/42/controllerconfigurator/sharedlayout";
  listener({ pathname: path });
  // X: Steam's NavigateHistory(-2) lands one page earlier.
  path = "/library";
  listener({ pathname: path });
  await new Promise((r) => setTimeout(r, 350));
  expect(pushed).toEqual(["/library/home"]);
});
