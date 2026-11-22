/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { connectEngine, createEventRouter, engine } from "./engineLink";
import { createFakeEngine, engineFailure, settle } from "./testSupport/fakeEngine";

describe("the typed fake engine", () => {
  test("an immediate answer is the method's result; a function answer sees the params", async () => {
    const fake = createFakeEngine({
      "settings.get": { settings: { autoUpdate: true } as never },
      "addons.folders": ({ addonId }) => ({
        addonsPath: "/AddOns",
        folders: [{ name: addonId, path: `/AddOns/${addonId}`, present: true }],
        fileManager: null as never,
      }),
    });
    expect((await fake.rpc("settings.get")).settings.autoUpdate).toBe(true);
    const { folders } = await fake.rpc("addons.folders", { installationId: "i1", addonId: "a1" });
    expect(folders.map((f) => f.path)).toEqual(["/AddOns/a1"]);
    expect(fake.log).toEqual([
      "settings.get",
      'addons.folders {"installationId":"i1","addonId":"a1"}',
    ]);
  });

  test("a call with no answer waits until the test answers it", async () => {
    const fake = createFakeEngine();
    let answered: unknown = null;
    void fake.rpc("system.diagnostics").then((d) => (answered = d));
    await settle();
    expect(answered).toBeNull();
    await fake.next("system.diagnostics").resolve({ companionInstalled: true } as never);
    expect(answered).toEqual({ companionInstalled: true });
  });

  test("an engine failure arrives as the envelope and is thrown with the engine's words", async () => {
    const fake = createFakeEngine({ "about.get": engineFailure("not_ready", "Engine not ready") });
    const error = await fake.rpc("about.get").catch((e: Error & { code?: string }) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error & { code?: string }).code).toBe("not_ready");
    expect((error as Error).message).toBe("Engine not ready");
  });

  test("bridge answers are typed by main.py's own methods", async () => {
    const fake = createFakeEngine(
      {},
      { read_text_file: (path) => ({ ok: true, content: path, message: "" }) },
    );
    expect((await fake.bridge("read_text_file", "/a.txt")).content).toBe("/a.txt");
  });
});

describe("the event router", () => {
  test("a handler hears only its event, and stops after unsubscribing", () => {
    const router = createEventRouter();
    const heard: string[][] = [];
    const off = router.on("addons.changed", ({ addonIds }) => heard.push(addonIds));
    router.dispatch({ event: "tradeskillmaster.changed", params: {} });
    router.dispatch({ event: "addons.changed", params: { addonIds: ["a1"] } });
    off();
    router.dispatch({ event: "addons.changed", params: { addonIds: ["a2"] } });
    expect(heard).toEqual([["a1"]]);
  });

  test("a failing handler does not keep the event from the next", () => {
    const router = createEventRouter();
    const heard: string[] = [];
    router.on("tradeskillmaster.changed", () => {
      throw new Error("boom");
    });
    router.on("tradeskillmaster.changed", () => heard.push("second"));
    const quiet = console.error;
    console.error = () => {};
    try {
      router.dispatch({ event: "tradeskillmaster.changed", params: {} });
    } finally {
      console.error = quiet;
    }
    expect(heard).toEqual(["second"]);
  });
});

describe("the connected engine", () => {
  test("handlers registered before connecting hear the link's events, once per event", () => {
    const heard: string[][] = [];
    engine.events.on("addons.changed", ({ addonIds }) => heard.push(addonIds));
    const first = createFakeEngine();
    connectEngine(first);
    const second = createFakeEngine();
    const disconnect = connectEngine(second);
    first.emit({ event: "addons.changed", params: { addonIds: ["old"] } });
    second.emit({ event: "addons.changed", params: { addonIds: ["new"] } });
    disconnect();
    second.emit({ event: "addons.changed", params: { addonIds: ["after"] } });
    expect(heard).toEqual([["new"]]);
  });

  test("rpc and bridge go to the link connected when the call is made", async () => {
    connectEngine(createFakeEngine({ "about.get": { version: "1" } as never }));
    expect(await engine.rpc("about.get")).toEqual({ version: "1" } as never);
    connectEngine(createFakeEngine({ "about.get": { version: "2" } as never }));
    expect(await engine.rpc("about.get")).toEqual({ version: "2" } as never);
  });
});
