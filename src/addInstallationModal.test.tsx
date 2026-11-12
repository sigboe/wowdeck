import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { deckyUiStub } from "./deckyUiStub";
import type { AddInstallationParams } from "./addWowFolder";

mock.module("@decky/ui", () => deckyUiStub);

const { AddInstallationModal } = await import("./components/AddInstallationModal");

const dom = new JSDOM('<div id="root"></div>');
const env = globalThis as {
  window?: unknown;
  document?: unknown;
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
const old = { window: env.window, document: env.document };
beforeAll(() => {
  env.window = dom.window;
  env.document = dom.window.document;
  env.IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  env.window = old.window;
  env.document = old.document;
  delete env.IS_REACT_ACT_ENVIRONMENT;
  dom.window.close();
});

type GameTypeOrNull = AddInstallationParams["clientType"] | null;

/** Render the modal; returns the container, what Add sent and how often it closed. */
async function render(gameType: GameTypeOrNull, addSucceeds = true) {
  const sent: AddInstallationParams[] = [];
  let closed = 0;
  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  await act(async () =>
    root.render(
      <AddInstallationModal
        path="/games/World of Warcraft/_retail_"
        displayName="Retail"
        gameType={gameType}
        onAdd={async (params) => {
          sent.push(params);
          return addSucceeds;
        }}
        closeModal={() => closed++}
      />,
    ),
  );
  const button = (text: string) =>
    [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === text)!;
  return {
    container,
    sent,
    closed: () => closed,
    button,
    click: (text: string) => act(async () => button(text).click()),
    unmount: () => act(async () => root.unmount()),
  };
}

describe("Add installation modal", () => {
  test("shows the picked folder as text, the name field and the game versions without Auto", async () => {
    const m = await render("retail");
    const text = m.container.textContent ?? "";
    expect(text).toContain("/games/World of Warcraft/_retail_");
    // Read-only: the folder is no input.
    const inputs = [...m.container.querySelectorAll("input")].map((i) => i.ariaLabel);
    expect(inputs).toEqual(["Display name"]);
    const options = [...m.container.querySelectorAll("option")].map((o) => o.textContent);
    expect(options).toContain("Retail");
    expect(options).not.toContain("Auto");
    await m.unmount();
  });

  test("Add submits the path, name and version, then closes", async () => {
    const m = await render("retail");
    await m.click("Add");
    expect(m.sent).toEqual([
      { path: "/games/World of Warcraft/_retail_", displayName: "Retail", clientType: "retail" },
    ]);
    expect(m.closed()).toBe(1);
    await m.unmount();
  });

  test("an unrecognised folder keeps Add disabled until a game version is chosen", async () => {
    const m = await render(null);
    expect(m.button("Add").disabled).toBe(true);
    await m.unmount();
  });

  test("a failed add keeps the modal open", async () => {
    const m = await render("retail", false);
    await m.click("Add");
    expect(m.sent).toHaveLength(1);
    expect(m.closed()).toBe(0);
    await m.unmount();
  });

  test("Cancel closes without adding", async () => {
    const m = await render("retail");
    await m.click("Cancel");
    expect(m.sent).toEqual([]);
    expect(m.closed()).toBe(1);
    await m.unmount();
  });
});
