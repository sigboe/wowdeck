/// <reference types="bun-types" />
import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act, type ReactNode, type Ref } from "react";
import { createRoot, type Root } from "react-dom/client";
import { deckyUiStub } from "./deckyUiStub";
import { connectEngine } from "./engineLink";
import { createFakeEngine } from "./testSupport/fakeEngine";
import type { SearchResult } from "./types";

mock.module("@decky/api", () => ({ toaster: { toast: () => {} }, openFilePicker: () => {} }));

type Props = {
  children?: ReactNode;
  ref?: Ref<HTMLDivElement>;
  className?: string;
  label?: ReactNode;
  onClick?: () => void;
  onGamepadFocus?: () => void;
  onButtonDown?: (event: unknown) => void;
};
let press: Props["onButtonDown"];
function Focusable(p: Props) {
  if (p.className === "wowdeck-list-zone") press = p.onButtonDown;
  return (
    <div ref={p.ref} className={p.className} onFocus={p.onGamepadFocus}>
      {p.children}
    </div>
  );
}
mock.module("@decky/ui", () => ({
  ...deckyUiStub,
  QuickAccessTab: {},
  GamepadButton: { DIR_RIGHT: 12, DIR_LEFT: 11 },
  Focusable,
  Field: (p: Props) => (
    <div
      ref={p.ref}
      className={`Focusable ${p.className ?? ""}`}
      tabIndex={-1}
      onFocus={p.onGamepadFocus}
      onClick={p.onClick}
    >
      {p.label}
    </div>
  ),
}));
let applied = true;
let applyLayout: (wide: boolean) => void = () => {};
mock.module("./steamDom/qamWidening", () => ({
  attachQamWidening: () => true,
  detachQamWidening: () => {},
  qamWideningStatus: () => ({ applied }),
  subscribeQamLayout: (listener: (wide: boolean) => void) => {
    applyLayout = (wide) => {
      applied = wide;
      listener(wide);
    };
    return () => {};
  },
}));
mock.module("./steamDom/qamBars", () => ({ usePaneBarInsets: () => {} }));
mock.module("./components/BrowseBar", () => ({
  BrowseBar: () => (
    <div className="wowdeck-browse-bar">
      <button className="Focusable">Source</button>
    </div>
  ),
  SEGMENT_FOCUS: {},
  segmentOfFocusKey: () => null,
}));
mock.module("./sourcesStore", () => {
  const state = {
    providers: [
      {
        id: "Curse",
        name: "CurseForge",
        enabled: true,
        available: true,
        configured: true,
        discovers: true,
        catalogSearch: true,
        allowEdit: true,
        requiresApiKey: false,
      },
    ],
    loaded: true,
    categories: {},
  };
  return {
    sourcesStore: {
      get: () => state,
      subscribe: () => () => {},
      load: async () => {},
      loadCategories: async () => {},
    },
  };
});
connectEngine(
  createFakeEngine({
    "discover.latest": () => new Promise(() => {}),
    "discover.popular": () => new Promise(() => {}),
  }),
);
const { listDestination } = await import("./browseDestinations");
const { GetAddonsTab } = await import("./components/GetAddonsTab");
const { resetBrowseSessionState, browseZone } = await import("./browseSessionState");
const { resetFocusMemory, rememberFocus } = await import("./focusMemory");
let root: Root;
let doc: Document;
const render = () =>
  root.render(
    <GetAddonsTab
      installations={[]}
      selectedId={null}
      onExitToNav={() => {}}
      onOpenSources={() => {}}
      onOpenInstallations={() => {}}
    />,
  );
const flush = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
};
beforeEach(async () => {
  const dom = new JSDOM("<div id='root'></div>");
  doc = dom.window.document;
  Object.assign(globalThis, {
    window: dom.window,
    document: doc,
    HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  applied = true;
  resetBrowseSessionState();
  resetFocusMemory();
  root = createRoot(doc.getElementById("root")!);
  await act(async () => render());
});
afterEach(async () => {
  await act(async () => root.unmount());
});
for (const destination of ["Popular", "Latest"]) {
  test(`${destination}: one Right reaches results when the first load settles`, async () => {
    const row = [...doc.querySelectorAll<HTMLElement>("[tabindex]")].find(
      (el) => el.textContent === destination,
    )!;
    await act(async () => row.focus());
    expect(browseZone.zone).toBe("list");
    await act(async () =>
      press!({ detail: { button: 12 }, preventDefault() {}, stopPropagation() {} }),
    );
    await flush();
    await act(async () =>
      listDestination(destination === "Popular" ? "popular" : "latest").patch({
        loading: false,
        loaded: true,
        results: [{ providerId: "Curse", externalId: "1", name: "Addon" } as SearchResult],
      }),
    );
    await flush();
    expect(doc.activeElement?.classList.contains("wowdeck-result-row")).toBe(true);
  });
}

const destinationRow = (label: string) =>
  [...doc.querySelectorAll<HTMLElement>("[tabindex]")].find((el) => el.textContent === label)!;
const right = async () => {
  await act(async () =>
    press!({ detail: { button: 12 }, preventDefault() {}, stopPropagation() {} }),
  );
  await flush();
};
const results = [
  { providerId: "Curse", externalId: "1", name: "Addon" },
  { providerId: "Curse", externalId: "2", name: "Second addon" },
] as SearchResult[];
const finish = async () => {
  await act(async () =>
    listDestination("popular").patch({ loaded: true, loading: false, results }),
  );
  await flush();
};
test("a warm list restores the previously focused addon with one Right", async () => {
  await finish();
  rememberFocus("qam.browse.popular", "Curse:2");
  await act(async () => destinationRow("Popular").focus());
  await right();
  expect(doc.activeElement?.textContent).toBe("Second addon");
});
test("Left cancels an entry while results are still loading", async () => {
  await act(async () => destinationRow("Popular").focus());
  await right();
  await act(async () =>
    press!({ detail: { button: 11 }, preventDefault() {}, stopPropagation() {} }),
  );
  await finish();
  expect(doc.activeElement?.textContent).toBe("Popular");
  expect(browseZone.zone).toBe("list");
});
test("switching destination cancels the old pending entry", async () => {
  await act(async () => destinationRow("Popular").focus());
  await right();
  await act(async () => destinationRow("Latest").focus());
  await finish();
  expect(doc.activeElement?.textContent).toBe("Latest");
});
test("an empty list still offers its browse bar", async () => {
  await act(async () => destinationRow("Popular").focus());
  await right();
  await act(async () => listDestination("popular").patch({ loaded: true, loading: false }));
  await flush();
  expect(doc.activeElement?.textContent).toBe("Source");
});
test("a failed first load lands on Retry", async () => {
  await act(async () => destinationRow("Popular").focus());
  await right();
  await act(async () =>
    listDestination("popular").patch({ loading: false, error: "Couldn't load addons" }),
  );
  await flush();
  expect(doc.activeElement?.textContent).toBe("Retry");
});

test("one Right survives the widened pane mounting later", async () => {
  await act(async () => applyLayout(false));
  await finish();
  await act(async () => destinationRow("Popular").focus());
  await right();
  expect(doc.activeElement?.textContent).toBe("Popular");
  await act(async () => applyLayout(true));
  await flush();
  expect(doc.activeElement?.classList.contains("wowdeck-result-row")).toBe(true);
});

test("A also enters a list whose first results arrive later", async () => {
  await act(async () => destinationRow("Popular").click());
  await flush();
  await finish();
  expect(doc.activeElement?.classList.contains("wowdeck-result-row")).toBe(true);
});
