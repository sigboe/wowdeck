import { afterEach, expect, mock, test } from "bun:test";
import { previewLayout } from "./controllerLayoutPreview";
import model from "../backend/tests/fixtures/controller-layouts/decoded-approved.json";
class Decoder {
  getClassName() {
    return "CMsgControllerConfiguration";
  }
  static deserializeBinary() {
    return { toObject: () => ({ ...model, binding_handle: 91 }) };
  }
}
mock.module("@decky/ui", () => ({
  findModuleExport: (match: (value: unknown) => boolean) => (match(Decoder) ? Decoder : undefined),
}));
const { nativeControllerLayouts } = await import("./nativeControllerLayouts");
const saved = ["SteamClient", "appStore", "controllerConfiguratorStore"].map(
  (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
);
afterEach(() => {
  for (const [key, descriptor] of saved) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});
const approved = {
  accountId: 123,
  url: "usercloud://wowdeck-approved/" + "a".repeat(64),
  title: "Approved",
  sha256: "a".repeat(64),
  mappings: { "4": "7580191d0c2d91371f278d5743f7bc406c0fffd80c13ed51f662ca95fd0c4ffb" },
};
function steam(disappear = false, syncError = false) {
  const freed: number[] = [];
  const input = {
    GetConfigForAppAndController: async () => ({
      accountID: 0,
      nControllerType: 4,
      unControllerIndex: 15,
      URL: "",
      eSelectionType: 0,
    }),
    PreviewConfigForAppAndController: () => {
      if (syncError) {
        syncError = false;
        throw Error("Capability interrupted");
      }
      if (disappear) Reflect.deleteProperty(input, "GetConfigForAppAndController");
      return Promise.resolve(new Uint8Array());
    },
    FreeControllerConfig: (handle: number) => {
      freed.push(handle);
    },
  };
  Object.assign(globalThis, {
    SteamClient: { User: { GetSteamID: () => "76561197960265851" }, Input: input },
    appStore: { allApps: [{ appid: 42, display_name: "World of Warcraft", app_type: 1073741824 }] },
    controllerConfiguratorStore: { EditingConfigurationControllerIndex: 15 },
  });
  return { freed, input, adapter: nativeControllerLayouts() };
}
test("guarded adapter uses logged-in account for inherited controls and releases its own handle", async () => {
  const app = steam();
  expect(await previewLayout(app.adapter, approved, 42)).toEqual({
    state: "ready",
    model,
  });
  expect(app.freed).toEqual([91]);
});
test("capability removal during native preview refuses success and still frees the handle", async () => {
  const app = steam(true);
  expect((await previewLayout(app.adapter, approved, 42)).state).toBe("error");
  expect(app.freed).toEqual([91]);
});
test("a synchronous native exception does not leave the adapter permanently busy", async () => {
  const app = steam(false, true);
  expect((await previewLayout(app.adapter, approved, 42)).state).toBe("error");
  expect((await previewLayout(app.adapter, approved, 42)).state).toBe("ready");
  expect(app.freed).toEqual([91]);
});

test("appID zero callbacks invalidate only and are disposed by their owner", () => {
  const app = steam();
  let callback: (...args: unknown[]) => void = () => {};
  let invalidations = 0;
  let disposed = 0;
  Object.assign(app.input, {
    RegisterForConfigSelectionChanges: (listener: typeof callback) => {
      callback = listener;
      return {
        unregister: () => {
          disposed++;
        },
      };
    },
  });
  const unsubscribe = app.adapter.subscribe(() => {
    invalidations++;
  });
  callback(0, 15);
  expect(invalidations).toBe(1);
  unsubscribe();
  unsubscribe();
  callback(0, 15);
  expect(invalidations).toBe(1);
  expect(disposed).toBe(1);
});
