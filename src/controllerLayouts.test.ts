import { expect, test } from "bun:test";
import type { ControllerLayout, ControllerLayoutCatalogue } from "../backend/src/api/contracts";
import {
  catalogueView,
  createControllerLayoutsModule,
  type CatalogueView,
} from "./controllerLayouts";
import { createFakeEngine, engineFailure } from "./testSupport/fakeEngine";
import { createManualClock } from "./testSupport/manualClock";

/** A synthetic test layout, not a production entry. */
const LAYOUT: ControllerLayout = {
  id: "fixture-synthetic-a",
  title: "Fixture layout A",
  author: "WoWDeck fixtures",
  controllerType: "controller_neptune",
  publishedFileId: "1000000000000000001",
  offer: "available",
  revision: { number: 1, sha256: "1".repeat(64), contentFormat: 1, withdrawn: false },
  revisions: [{ number: 1, sha256: "1".repeat(64), contentFormat: 1, withdrawn: false }],
};

async function viewAfter(answer: ControllerLayoutCatalogue | ReturnType<typeof engineFailure>) {
  const fake = createFakeEngine({ "controllerLayouts.catalogue": answer });
  const module = createControllerLayoutsModule({ rpc: fake.rpc, clock: createManualClock() });
  const off = module.catalogue.subscribe(module.KEY, () => {});
  expect(catalogueView(module.catalogue.get(module.KEY))).toEqual({ kind: "loading" });
  await module.catalogue.refresh(module.KEY);
  off();
  return { view: catalogueView(module.catalogue.get(module.KEY)) };
}

test("a loaded catalogue shows its layouts in the maintainers' order", async () => {
  const second = { ...LAYOUT, id: "fixture-synthetic-b", title: "Fixture layout B" };
  const { view } = await viewAfter({ state: "ready", layouts: [LAYOUT, second] });

  expect(view).toEqual({ kind: "ready", layouts: [LAYOUT, second] });
});

test.each<[string, ControllerLayoutCatalogue, CatalogueView]>([
  ["empty", { state: "ready", layouts: [] }, { kind: "empty" }],
  ["unavailable", { state: "unavailable" }, { kind: "unavailable" }],
  ["malformed", { state: "malformed" }, { kind: "malformed" }],
  ["unsupported", { state: "unsupported", schemaVersion: 2 }, { kind: "unsupported" }],
])("the engine's %s catalogue is its own state", async (_name, answer, expected) => {
  const { view } = await viewAfter(answer);

  expect(view).toEqual(expected);
});

test("an engine failure is an error, never an empty catalogue", async () => {
  const { view } = await viewAfter(engineFailure("not_ready", "Engine not ready"));

  expect(view).toEqual({ kind: "error", message: "Couldn't load controller layouts" });
});
