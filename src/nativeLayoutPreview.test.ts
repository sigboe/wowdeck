import { expect, mock, test } from "bun:test";

const toasts: string[] = [];
mock.module("@decky/api", () => ({
  toaster: { toast: (t: { body: string }) => toasts.push(t.body) },
}));
mock.module("@decky/ui", async () => (await import("./deckyUiStub")).deckyUiStub);
const { interceptNativeApply } = await import("./nativeLayoutPreview");

test("X on Steam's preview reaches Steam unchanged except for WoWDeck-approved layouts", async () => {
  const calls: string[] = [];
  class Store {
    SetActiveConfigForApp(_appid: number, _index: number, url: string) {
      calls.push(url);
      return "steam";
    }
  }
  const store = new Store();
  Object.assign(globalThis, { controllerConfiguratorStore: store });
  try {
    const stop = interceptNativeApply();
    expect(store.SetActiveConfigForApp(42, 15, "workshop://1")).toBe("steam");
    expect(
      store.SetActiveConfigForApp(42, 15, "usercloud://wowdeck-approved/" + "a".repeat(64)),
    ).toBeUndefined();
    expect(calls).toEqual(["workshop://1"]);
    // No WoWDeck preview was opened, so nothing is applied.
    await Promise.resolve();
    expect(toasts).toEqual(["Couldn't apply this layout. Preview it again from WoWDeck."]);
    stop();
    expect(Object.prototype.hasOwnProperty.call(store, "SetActiveConfigForApp")).toBe(false);
    store.SetActiveConfigForApp(42, 15, "usercloud://wowdeck-approved/x");
    expect(calls).toEqual(["workshop://1", "usercloud://wowdeck-approved/x"]);
  } finally {
    Reflect.deleteProperty(globalThis, "controllerConfiguratorStore");
  }
});
