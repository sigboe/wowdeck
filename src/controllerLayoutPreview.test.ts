import { expect, test } from "bun:test";
import { previewLayout, type NativeLayoutAdapter } from "./controllerLayoutPreview";
import model from "../backend/tests/fixtures/controller-layouts/decoded-approved.json";
import fallbackModel from "../backend/tests/fixtures/controller-layouts/decoded-fallback.json";
const digest = "7580191d0c2d91371f278d5743f7bc406c0fffd80c13ed51f662ca95fd0c4ffb";
test("silent native fallback is rejected even when the preview request resolves", async () => {
  let released = false;
  const adapter: NativeLayoutAdapter = {
    context: async () => ({
      accountId: 123,
      controllerIndex: 15,
      controllerType: 4,
      selection: "previous",
      target: 42,
    }),
    preview: async () => ({
      model: fallbackModel,
      release: () => {
        released = true;
      },
    }),
  };
  const result = await previewLayout(
    adapter,
    {
      accountId: 123,
      url: "usercloud://wowdeck-approved/test",
      title: "Test",
      sha256: "a".repeat(64),
      mappings: { "4": digest },
    },
    42,
  );
  expect(result.state).toBe("error");
  expect(released).toBe(true);
});

const expectedHash = "7580191d0c2d91371f278d5743f7bc406c0fffd80c13ed51f662ca95fd0c4ffb";
function fixture(change?: "selection" | "account" | "controller" | "missing" | "mappings") {
  let reads = 0;
  let released = false;
  const native: NativeLayoutAdapter = {
    context: async () => {
      reads++;
      if (reads > 1 && change === "missing") throw Error("API removed");
      return {
        accountId: reads > 1 && change === "account" ? 456 : 123,
        controllerIndex: reads > 1 && change === "controller" ? 16 : 15,
        controllerType: 4,
        target: 42,
        selection: reads > 1 && change === "selection" ? "personal edit" : "inherited default",
      };
    },
    preview: async () => ({
      model: change === "mappings" ? { ...model, modes: [{ button: 4 }] } : model,
      release: () => {
        released = true;
      },
    }),
  };
  return { native, released: () => released };
}
const approved = {
  accountId: 123,
  url: "usercloud://wowdeck-approved/" + "a".repeat(64),
  title: "Approved",
  sha256: "a".repeat(64),
  mappings: { "4": expectedHash },
};
test("reviewed native mappings preview without replacing inherited selection", async () => {
  const app = fixture();
  expect(await previewLayout(app.native, approved, 42)).toEqual({
    state: "ready",
    context: await app.native.context(42),
    model,
    fingerprint: expectedHash,
  });
  expect(app.released()).toBe(true);
});
for (const change of ["selection", "account", "controller", "missing", "mappings"] as const) {
  test(`preview refuses ${change} changes and releases its native data`, async () => {
    const app = fixture(change);
    expect((await previewLayout(app.native, approved, 42)).state).toBe("error");
    expect(app.released()).toBe(true);
  });
}

const unreviewed = { ...approved, mappings: {} };
function withDefaults(defaults: typeof model) {
  const app = fixture();
  const freed: string[] = [];
  app.native.preview = async () => ({ model, release: () => freed.push("layout") });
  app.native.previewDefault = async () => ({
    model: defaults,
    release: () => freed.push("default"),
  });
  return { app, freed };
}
test("without a published fingerprint, a decode that differs from Steam's defaults is ready", async () => {
  const { app, freed } = withDefaults(fallbackModel);
  expect(await previewLayout(app.native, unreviewed, 42)).toEqual({
    state: "ready",
    context: await app.native.context(42),
    model,
    fingerprint: expectedHash,
  });
  expect(freed).toEqual(["layout", "default"]);
});
test("without a published fingerprint, a decode equal to Steam's defaults is refused", async () => {
  const { app, freed } = withDefaults(model);
  expect((await previewLayout(app.native, unreviewed, 42)).state).toBe("error");
  expect(freed).toEqual(["layout", "default"]);
});
test("without a published fingerprint or a defaults preview, nothing is ready", async () => {
  const app = fixture();
  expect((await previewLayout(app.native, unreviewed, 42)).state).toBe("error");
  expect(app.released()).toBe(true);
});
test("fingerprints for other controllers only refuse this controller", async () => {
  const { app } = withDefaults(fallbackModel);
  expect(
    (await previewLayout(app.native, { ...approved, mappings: { "3": expectedHash } }, 42)).state,
  ).toBe("error");
});
