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
const saved = ["SteamClient", "SteamUIStore", "appStore", "controllerConfiguratorStore"].map(
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
    controllerConfiguratorStore: {
      m_controllerList: [{ nControllerIndex: 15, eControllerType: 4 }],
    },
  });
  return { freed, input, adapter: nativeControllerLayouts() };
}
test("guarded adapter uses logged-in account for inherited controls and releases its own handle", async () => {
  const app = steam();
  expect(await previewLayout(app.adapter, approved, 42)).toMatchObject({
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

test("production adapter reads active mappings without a preview URL", async () => {
  const app = steam();
  let reads = 0;
  Object.assign(app.input, {
    StartEditingControllerConfigurationForAppIDAndControllerIndex: async () => {
      reads++;
      return new Uint8Array();
    },
  });
  const context = await app.adapter.operationContext(42, "retail");
  expect(await app.adapter.readback(context)).toEqual(model);
  expect(reads).toBe(1);
  expect(app.freed).toEqual([91]);
});

test("production adapter previews a safe personal export but rejects traversal and foreign schemes", async () => {
  const app = steam();
  const context = await app.adapter.context(42);
  const loaded = await app.adapter.preview(context, "usercloud://personal/WoWDeck recovery export");
  expect(loaded.model).toEqual(model);
  loaded.release();
  for (const url of [
    "usercloud://personal/../other",
    "usercloud:///absolute",
    "file:///tmp/layout",
    "usercloud://personal/a?key=secret",
    "usercloud://personal//other",
  ]) {
    await expect(app.adapter.preview(context, url)).rejects.toThrow();
  }
  expect(app.freed).toEqual([91]);
});

test("preview uses the connected built-in inventory and current account without an open editor", async () => {
  const app = steam();
  Object.assign(globalThis, {
    controllerConfiguratorStore: {
      m_controllerList: [{ nControllerIndex: 15, eControllerType: 4 }],
    },
    friendStore: { currentUserSteamID: { ConvertTo64BitString: () => "76561197960265851" } },
  });
  Reflect.deleteProperty(
    (globalThis as unknown as { SteamClient: { User: object } }).SteamClient.User,
    "GetSteamID",
  );
  try {
    expect((await previewLayout(app.adapter, approved, 42)).state).toBe("ready");
    expect(app.freed).toEqual([91]);
  } finally {
    Reflect.deleteProperty(globalThis, "friendStore");
  }
});

const AUTOSAVE =
  "autosave:///home/deck/.local/share/Steam/steamapps/common/Steam Controller Configs/123/config/world of warcraft/controller_neptune.vdf";
function scoped(
  winners: Record<number, { URL: string; eSelectionType: number }>,
  names: [number, string][],
) {
  const app = steam();
  Object.assign(app.input, {
    GetConfigForAppAndController: async (target: number) => ({
      accountID: 0,
      nControllerType: 4,
      unControllerIndex: 15,
      ...(winners[target] ?? { URL: AUTOSAVE, eSelectionType: 0 }),
    }),
  });
  Object.assign(globalThis, {
    appStore: {
      allApps: names.map(([appid, display_name]) => ({
        appid,
        display_name,
        app_type: 1073741824,
      })),
    },
    controllerConfiguratorStore: {
      m_controllerList: [
        { nControllerIndex: 15, eControllerType: 4, strSerialNumber: "SERIAL", strChipID: "CHIP" },
      ],
    },
  });
  return app;
}

test("layer-0 scope covers case variants of the name and nothing else", async () => {
  const app = scoped({}, [
    [42, "World of Warcraft"],
    [43, "world of warcraft"],
    [44, "World of Warcraft Classic"],
  ]);
  const context = await app.adapter.operationContext(42, "retail");
  expect(context.scope.state).toBe("established");
  expect(context.scope.selectionType).toBe(0);
  expect(context.scope.targets.map((t) => t.appId)).toEqual([42, 43]);
  expect(context.controllerIdentity).toMatch(/^[0-9a-f]{64}$/);
  expect(context.controllerIdentity).not.toContain("SERIAL");
});

test("scope stays unknown for a winning layer-1 override, unsupported sources and names", async () => {
  for (const [winners, names] of [
    [{ 42: { URL: AUTOSAVE, eSelectionType: 1 } }, [[42, "WoW"]]],
    [{ 42: { URL: "template://controller_neptune_wasd.vdf", eSelectionType: 0 } }, [[42, "WoW"]]],
    [{ 42: { URL: "default://wow", eSelectionType: 0 } }, [[42, "WoW"]]],
    [{}, [[42, "WoW ’"]]],
    [
      { 43: { URL: "usercloud://wow/other", eSelectionType: 0 } },
      [
        [42, "WoW"],
        [43, "wow"],
      ],
    ],
  ] as [Record<number, { URL: string; eSelectionType: number }>, [number, string][]][]) {
    const app = scoped(winners, names);
    expect((await app.adapter.operationContext(42, "retail")).scope.state).toBe("unknown");
  }
});

test("preservation records the archivable layer-0 source and layer-1 absence", async () => {
  const app = scoped({}, [[42, "World of Warcraft"]]);
  const stopped: number[] = [];
  Object.assign(app.input, {
    StartEditingControllerConfigurationForAppIDAndControllerIndex: async () => new Uint8Array(),
    StopEditingControllerConfiguration: (controller: number) => stopped.push(controller),
  });
  const context = await app.adapter.operationContext(42, "retail");
  const snapshot = await app.adapter.preservationState({
    id: "op",
    phase: "preserving",
    context,
    approved,
  } as never);
  expect(snapshot.sourceURL).toBe(AUTOSAVE);
  expect(snapshot.selections).toEqual([
    { target: 42, selectionType: 0, present: true, url: AUTOSAVE },
    { target: 42, selectionType: 1, present: false },
  ]);
  expect(stopped).toEqual([15]);
  expect(app.freed).toEqual([91]);
});

test("export runs inside an editing session and closes it", async () => {
  const app = scoped({}, [[42, "World of Warcraft"]]);
  const calls: string[] = [];
  Object.assign(app.input, {
    StartEditingControllerConfigurationForAppIDAndControllerIndex: async () => {
      calls.push("edit");
      return new Uint8Array();
    },
    ExportCurrentControllerConfiguration: async () => {
      calls.push("export");
      return { result: 1 };
    },
    StopEditingControllerConfiguration: () => calls.push("stop"),
  });
  const context = await app.adapter.operationContext(42, "retail");
  let exported = false;
  Object.assign(app.input, {
    GetConfigForAppAndController: async () => ({
      accountID: 0,
      nControllerType: 4,
      unControllerIndex: 15,
      eSelectionType: 0,
      URL: exported ? "usercloud://world of warcraft/wowdeck recovery op_0" : AUTOSAVE,
    }),
  });
  const original = (
    app.input as unknown as { ExportCurrentControllerConfiguration: () => Promise<unknown> }
  ).ExportCurrentControllerConfiguration;
  Object.assign(app.input, {
    ExportCurrentControllerConfiguration: async () => {
      const result = await original();
      exported = true;
      return result;
    },
  });
  expect(
    await app.adapter.exportLocal({ id: "op", phase: "preserving", context, approved } as never),
  ).toBe("usercloud://world of warcraft/wowdeck recovery op_0");
  expect(calls).toEqual(["edit", "export", "stop"]);
  expect(app.freed).toEqual([91]);
});

test("the default preview decodes Steam's default selection for the lowercased name", async () => {
  const app = steam();
  const urls: string[] = [];
  Object.assign(app.input, {
    PreviewConfigForAppAndController: (_t: number, _c: number, url: string) => {
      urls.push(url);
      return Promise.resolve(new Uint8Array());
    },
  });
  const context = await app.adapter.context(42);
  const loaded = await app.adapter.previewDefault!(context);
  loaded.release();
  expect(urls).toEqual(["default://world of warcraft"]);
  expect(app.freed).toEqual([91]);
});

test("only this operation's own export is deleted", async () => {
  const app = scoped({}, [[42, "World of Warcraft"]]);
  const deleted: string[] = [];
  Object.assign(app.input, {
    DeletePersonalControllerConfiguration: (url: string) => deleted.push(url),
  });
  const context = await app.adapter.operationContext(42, "retail");
  const op = {
    id: "41a76010-e568-4fb9-9a31-5283f583ffc6",
    phase: "preserving",
    context,
    approved,
  } as never;
  const own =
    "usercloud://world of warcraft/wowdeck recovery 41a76010-e568-4fb9-9a31-5283f583ffc6_0";
  await app.adapter.discardExport!(op, own);
  for (const other of [
    "usercloud://world of warcraft/my layout_0",
    "usercloud://world of warcraft/wowdeck recovery 00000000-0000-4000-8000-000000000000_0",
    "autosave:///x/wowdeck recovery 41a76010-e568-4fb9-9a31-5283f583ffc6_0",
  ])
    await expect(app.adapter.discardExport!(op, other)).rejects.toThrow();
  expect(deleted).toEqual([own]);
});

test("preview uses Steam’s active controller while Apply still refuses multiple controllers", async () => {
  const app = steam();
  Object.assign(globalThis, {
    controllerConfiguratorStore: {
      m_controllerList: [
        { nControllerIndex: 15, eControllerType: 4 },
        { nControllerIndex: 16, eControllerType: 31 },
      ],
    },
  });
  Object.assign(globalThis, { SteamUIStore: { MostRecentlyActiveControllerIndex: 16 } });
  Object.assign(app.input, {
    GetConfigForAppAndController: async (_target: number, index: number) => ({
      accountID: 0,
      nControllerType: 31,
      unControllerIndex: index,
      URL: "",
      eSelectionType: 0,
    }),
  });
  const context = await app.adapter.context(42);
  expect(context).toMatchObject({ controllerIndex: 16, controllerType: 31 });
  const preview = mock(app.input.PreviewConfigForAppAndController);
  app.input.PreviewConfigForAppAndController = preview;
  (await app.adapter.preview(context, approved.url)).release();
  expect(preview).toHaveBeenCalledWith(42, 16, approved.url);
  await expect(app.adapter.operationContext(42, "retail")).rejects.toThrow(
    "only with the built-in controller connected",
  );
});
