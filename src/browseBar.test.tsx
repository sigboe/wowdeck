/// <reference types="bun-types" />
import { afterAll, expect, mock, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { deckyUiStub } from "./deckyUiStub";
import type { ProviderInfo } from "./types";

/**
 * The browse bar's Source and Category menus (#278): icons are the layout
 * target dropdown's alone, so these menus render no icon slot, closed or open.
 */

mock.module("@decky/ui", () => deckyUiStub);

const dom = new JSDOM('<div id="root"></div>');
const env = globalThis as unknown as {
  window?: unknown;
  document?: unknown;
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
const old = { window: env.window, document: env.document };
env.window = dom.window;
env.document = dom.window.document;
env.IS_REACT_ACT_ENVIRONMENT = true;
afterAll(() => {
  env.window = old.window;
  env.document = old.document;
  delete env.IS_REACT_ACT_ENVIRONMENT;
  dom.window.close();
});
const { createRoot } = await import("react-dom/client");
const { BrowseBar } = await import("./components/BrowseBar");

const source = (id: string): ProviderInfo => ({
  id,
  name: id,
  enabled: true,
  available: true,
  requiresApiKey: false,
  configured: true,
  allowEdit: true,
  catalogSearch: true,
  discovers: true,
});

test("the Source and Category menus show no icon slot, closed or open", async () => {
  const doc = dom.window.document;
  const root = createRoot(doc.getElementById("root")!);
  await act(async () =>
    root.render(
      <BrowseBar
        destination="popular"
        providers={[source("Curse"), source("WowUpHub")]}
        sourceId="Curse"
        categoryId={null}
        categories={[{ id: "7", name: "Bags" }]}
        onSource={() => {}}
        onCategory={() => {}}
      />,
    ),
  );
  const menuButton = (label: string) =>
    doc.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  expect(menuButton("Source")).not.toBeNull();
  expect(menuButton("Category")).not.toBeNull();
  expect(doc.querySelectorAll("[data-icon-slot]")).toHaveLength(0);

  const entries = () =>
    [...doc.querySelectorAll("button[aria-label]")]
      .map((b) => b.getAttribute("aria-label"))
      .filter((l) => l !== "Source" && l !== "Category");
  for (const [label, shown] of [
    ["Source", ["CurseForge", "WowUp Hub"]],
    ["Category", ["All categories", "Bags"]],
  ] as const) {
    await act(async () => menuButton(label).click());
    expect(entries()).toEqual([...shown]);
    expect(doc.querySelectorAll("[data-icon-slot]")).toHaveLength(0);
    await act(async () => menuButton(label).click());
  }
  await act(async () => root.unmount());
});
