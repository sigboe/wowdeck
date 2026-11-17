import { expect, test } from "bun:test";
import type { ControllerLayout, ControllerLayoutCatalogue } from "../backend/src/api/contracts";
import {
  catalogueView,
  createControllerLayoutsModule,
  layoutRow,
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
  [
    "empty",
    { state: "ready", layouts: [] },
    { kind: "notice", label: "No controller layouts yet" },
  ],
  [
    "unavailable",
    { state: "unavailable" },
    { kind: "retry", message: "Couldn't load controller layouts. Try again later." },
  ],
  [
    "malformed",
    { state: "malformed" },
    { kind: "retry", message: "Couldn't read the controller layouts list." },
  ],
  [
    "unsupported",
    { state: "unsupported", schemaVersion: 2 },
    { kind: "notice", label: "Update WoWDeck", text: "This list needs a newer WoWDeck." },
  ],
  ["disabled", { state: "disabled" }, { kind: "off" }],
])("the engine's %s catalogue is its own state", async (_name, answer, expected) => {
  const { view } = await viewAfter(answer);

  expect(view).toEqual(expected);
});

test("an engine failure is an error, never an empty catalogue", async () => {
  const { view } = await viewAfter(engineFailure("not_ready", "Engine not ready"));

  expect(view).toEqual({ kind: "retry", message: "Couldn't load controller layouts." });
});

test("an available layout's row shows its title, author, controller and description", () => {
  expect(
    layoutRow({ ...LAYOUT, controllerType: "controller_triton", description: "Healer layout." }),
  ).toEqual({
    title: "Fixture layout A",
    facts: ["by WoWDeck fixtures", "Steam Controller"],
    description: "Healer layout.",
    note: null,
    inactive: false,
  });
});

test("a controller type this client can't name shows as the catalogue gives it", () => {
  expect(layoutRow({ ...LAYOUT, controllerType: "controller_future_thing" }).facts).toEqual([
    "by WoWDeck fixtures",
    "controller_future_thing",
  ]);
  expect(layoutRow({ ...LAYOUT, controllerType: "constructor" }).facts).toEqual([
    "by WoWDeck fixtures",
    "constructor",
  ]);
  expect(layoutRow(LAYOUT).facts).toEqual(["by WoWDeck fixtures", "Steam Deck"]);
});

test.each<[ControllerLayout["offer"], string]>([
  ["withdrawn", "Withdrawn by the WoWDeck maintainers"],
  ["unsupported", "Needs a newer WoWDeck"],
])("a %s layout is explained and shown inactive", (offer, note) => {
  const row = layoutRow({ ...LAYOUT, offer, revision: null });

  expect(row.note).toBe(note);
  expect(row.inactive).toBe(true);
});
