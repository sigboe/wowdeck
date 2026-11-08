import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  mock,
  test,
} from "bun:test";
import type { ReactElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { deckyUiStub } from "./deckyUiStub";

let modal: ReactElement | null = null;
let search: ((e: { target: { value: string } }) => void) | undefined;
mock.module("@decky/ui", () => ({
  ...deckyUiStub,
  TextField: ({ onChange }: { onChange: (e: { target: { value: string } }) => void }) => {
    search = onChange;
    return null;
  },
  showModal: (element: ReactElement) => {
    modal = element;
    return { Close: () => {} };
  },
}));

const { openSteamGamePicker } = await import("./components/SteamGamePicker");

const SHORTCUT = 1073741824;
const WOW_LUTRIS = { appId: 3141592653, name: "World of Warcraft" };
const WOW_BNET = { appId: 2718281828, name: "World of Warcraft" };
const BNET = { appId: 1414213562, name: "Battle.net" };
const MARIO = { appId: 1732050807, name: "Super Mario 64" };

const dom = new JSDOM('<div id="root"></div>');
const env = globalThis as {
  window?: unknown;
  IS_REACT_ACT_ENVIRONMENT?: boolean;
  appStore?: unknown;
};
const oldWindow = env.window;
let root: Root | null = null;
/** Steam's icon data, as `GetIconURLForApp` turns it into a URL: PNG and ICO custom icons. */
const ICONS: Record<number, { format: string; data: string }> = {
  [WOW_LUTRIS.appId]: { format: "png", data: "TFVUUklT" },
  [BNET.appId]: { format: "ico", data: "Qk5FVA==" },
};

/**
 * A stand-in for Steam's app store. Like Steam, an icon not loaded yet reads
 * as null and asks for it; the answer arrives as a new overview object, so
 * only a fresh `GetAppOverviewByAppID` sees it. `lazy` holds the app ids whose
 * icon data is still to load; `lookups` logs each `GetIconURLForApp` call's
 * app id, `reads` counts reads of `allApps`.
 */
function stubAppStore(
  lazy: number[] = [],
  icons = ICONS,
  extra: { appId: number; name: string }[] = [],
) {
  const pending = new Set(lazy);
  const overview = (g: { appId: number; name: string }) => {
    const icon = pending.has(g.appId) ? undefined : icons[g.appId];
    return {
      appid: g.appId,
      display_name: g.name,
      app_type: SHORTCUT,
      ...(icon ? { icon_data: icon.data, icon_data_format: icon.format } : {}),
    };
  };
  let apps = [
    ...[WOW_LUTRIS, WOW_BNET, BNET, MARIO, ...extra].map(overview),
    { appid: 570, display_name: "Dota 2", app_type: 1 },
  ];
  const store = {
    reads: 0,
    lookups: [] as number[],
    get allApps() {
      store.reads++;
      return apps;
    },
    GetAppOverviewByAppID(appId: number) {
      return apps.find((a) => a.appid === appId) ?? null;
    },
    GetIconURLForApp(app: { appid: number; icon_data?: string; icon_data_format?: string }) {
      store.lookups.push(app.appid);
      if (app.icon_data) return `data:image/${app.icon_data_format};base64,${app.icon_data}`;
      if (pending.delete(app.appid)) {
        apps = apps.map((a) =>
          a.appid === app.appid ? overview({ appId: app.appid, name: a.display_name }) : a,
        );
      }
      return null;
    },
  };
  return store;
}

beforeAll(() => {
  env.window = dom.window;
  env.IS_REACT_ACT_ENVIRONMENT = true;
});
beforeEach(() => {
  env.appStore = stubAppStore();
});
afterAll(() => {
  env.window = oldWindow;
  delete env.IS_REACT_ACT_ENVIRONMENT;
  delete env.appStore;
  dom.window.close();
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  modal = null;
  search = undefined;
  jest.useRealTimers();
});

type Links = Parameters<typeof openSteamGamePicker>[0];

/** Open the picker the way Options does, render it, and read each shortcut row as "name — description". */
async function openPicker(links: Links): Promise<string[]> {
  openSteamGamePicker(links, () => {});
  root = createRoot(dom.window.document.getElementById("root")!);
  await act(async () => root!.render(modal!));
  return rows();
}

function rows(): string[] {
  return [...dom.window.document.querySelectorAll("#root div")]
    .filter((row) => row.querySelector(":scope > b")?.textContent !== "Search your non-Steam games")
    .map((row) => {
      // A shortcut row stacks its name and description inside the label.
      const name = row.querySelector(":scope > b [data-row-name]");
      const label = name?.textContent ?? row.querySelector(":scope > b")?.textContent ?? "";
      const description =
        (name
          ? row.querySelector(":scope > b [data-row-description]")
          : row.querySelector(":scope > i")
        )?.textContent ?? "";
      return `${label} — ${description}`;
    })
    .filter((row) => row !== " — ");
}

async function type(query: string): Promise<string[]> {
  await act(async () => search!({ target: { value: query } }));
  return rows();
}

describe("Steam library picker rows (#151)", () => {
  test("the manual link says Currently linked; every other row shows its app id", async () => {
    expect(await openPicker({ manual: BNET, detected: [], autoLinkOn: true })).toEqual([
      "Battle.net — App 1414213562 · Currently linked",
      "World of Warcraft — App 3141592653",
      "World of Warcraft — App 2718281828",
      "Super Mario 64 — App 1732050807",
    ]);
  });

  test("a detected link says Linked automatically only while automatic linking is on", async () => {
    expect(await openPicker({ manual: null, detected: [WOW_BNET], autoLinkOn: true })).toEqual([
      "Battle.net — App 1414213562",
      "World of Warcraft — App 3141592653",
      "World of Warcraft — App 2718281828 · Linked automatically",
      "Super Mario 64 — App 1732050807",
    ]);
    await act(async () => root!.unmount());
    expect(await openPicker({ manual: null, detected: [WOW_BNET], autoLinkOn: false })).toEqual([
      "Battle.net — App 1414213562",
      "World of Warcraft — App 3141592653",
      "World of Warcraft — App 2718281828",
      "Super Mario 64 — App 1732050807",
    ]);
  });

  test("an entry both linked by hand and detected says Currently linked, the link Unlink removes", async () => {
    const shown = await openPicker({
      manual: WOW_LUTRIS,
      detected: [WOW_LUTRIS, BNET],
      autoLinkOn: true,
    });
    expect(shown).toEqual([
      "Battle.net — App 1414213562 · Linked automatically",
      "World of Warcraft — App 3141592653 · Currently linked",
      "World of Warcraft — App 2718281828",
      "Super Mario 64 — App 1732050807",
    ]);
  });

  test("Currently linked shows in green; Linked automatically keeps the description colour", async () => {
    await openPicker({ manual: WOW_LUTRIS, detected: [BNET], autoLinkOn: true });
    const marker = (text: string) =>
      [...dom.window.document.querySelectorAll("[data-row-description] span")].find(
        (span) => span.textContent === text,
      ) as HTMLElement | undefined;
    expect(marker("Currently linked")?.style.color).toBe("rgb(89, 191, 64)");
    expect(marker("Linked automatically")?.style.color).toBe("");
  });

  test("search matches names and initials, not app ids", async () => {
    await openPicker({ manual: null, detected: [], autoLinkOn: true });
    expect(await type("wow")).toEqual([
      "World of Warcraft — App 3141592653",
      "World of Warcraft — App 2718281828",
    ]);
    expect(await type("mario")).toEqual(["Super Mario 64 — App 1732050807"]);
    expect(await type("3141")).toEqual(["Nothing matches “3141” — "]);
  });
});

/** Each shortcut row's icon slot: "icon <url>" when it shows an image, "blank" otherwise. */
function iconSlots(): string[] {
  return [...dom.window.document.querySelectorAll("[data-icon-slot]")].map((slot) => {
    const img = slot.querySelector("img");
    return img ? `icon ${img.getAttribute("src")}` : "blank";
  });
}

describe("Steam library picker icons (#152)", () => {
  test("a row shows its shortcut's icon; a row without one keeps a blank slot of the same size", async () => {
    await openPicker({ manual: null, detected: [], autoLinkOn: true });
    expect(iconSlots()).toEqual([
      "icon data:image/ico;base64,Qk5FVA==",
      "icon data:image/png;base64,TFVUUklT",
      "blank",
      "blank",
    ]);
    const slots = [...dom.window.document.querySelectorAll<HTMLElement>("[data-icon-slot]")];
    const sizes = new Set(slots.map((s) => `${s.style.width}x${s.style.height}`));
    expect(sizes.size).toBe(1);
    expect([...sizes][0]).not.toBe("x");
  });

  test("the icon is hidden from screen readers, so a row reads as its name and description", async () => {
    const shown = await openPicker({ manual: null, detected: [], autoLinkOn: true });
    expect(shown[1]).toBe("World of Warcraft — App 3141592653");
    const slots = [...dom.window.document.querySelectorAll("[data-icon-slot]")];
    expect(slots).toHaveLength(4);
    expect(slots.every((s) => s.getAttribute("aria-hidden") === "true")).toBe(true);
  });

  test("an icon that fails to load leaves the blank slot", async () => {
    await openPicker({ manual: null, detected: [], autoLinkOn: true });
    const img = dom.window.document.querySelector('img[src^="data:image/png"]')!;
    await act(async () => {
      img.dispatchEvent(new dom.window.Event("error"));
    });
    expect(iconSlots()).toEqual(["icon data:image/ico;base64,Qk5FVA==", "blank", "blank", "blank"]);
  });

  test("icons Steam is still loading appear after one re-read of the rows without one", async () => {
    jest.useFakeTimers();
    const store = stubAppStore([WOW_LUTRIS.appId]);
    env.appStore = store;
    await openPicker({ manual: null, detected: [], autoLinkOn: true });
    expect(iconSlots()).toEqual(["icon data:image/ico;base64,Qk5FVA==", "blank", "blank", "blank"]);
    const atOpen = store.lookups.length;
    await act(async () => {
      jest.advanceTimersByTime(499);
    });
    expect(store.lookups.length).toBe(atOpen);
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(iconSlots()).toEqual([
      "icon data:image/ico;base64,Qk5FVA==",
      "icon data:image/png;base64,TFVUUklT",
      "blank",
      "blank",
    ]);
    expect(store.lookups.slice(atOpen).sort()).toEqual(
      [WOW_LUTRIS.appId, WOW_BNET.appId, MARIO.appId].sort(),
    );
    const afterRetry = store.lookups.length;
    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });
    expect(store.lookups.length).toBe(afterRetry);
  });

  test("icons are looked up only for the rows shown", async () => {
    jest.useFakeTimers();
    const extra = Array.from({ length: 50 }, (_, i) => ({
      appId: 1000 + i,
      name: `Game ${String(i + 1).padStart(2, "0")}`,
    }));
    const store = stubAppStore([], ICONS, extra);
    env.appStore = store;
    const shown = await openPicker({ manual: null, detected: [], autoLinkOn: true });
    expect(shown).toHaveLength(41); // 40 rows, then "13 more"
    expect(new Set(store.lookups).size).toBe(40);
    expect(store.lookups).not.toContain(MARIO.appId);
    expect(store.lookups).not.toContain(1049);
    await type("mario");
    expect(store.lookups).toContain(MARIO.appId);
    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });
    expect(store.lookups).not.toContain(1049);
    expect(store.lookups.filter((id) => id === MARIO.appId)).toHaveLength(2);
  });

  test("closing the picker before the re-read cancels it", async () => {
    jest.useFakeTimers();
    const store = stubAppStore([WOW_LUTRIS.appId]);
    env.appStore = store;
    await openPicker({ manual: null, detected: [], autoLinkOn: true });
    await act(async () => root!.unmount());
    root = null;
    const atClose = store.lookups.length;
    jest.advanceTimersByTime(60_000);
    expect(store.lookups.length).toBe(atClose);
  });

  test("with every icon loaded, the picker reads the library and each icon only once", async () => {
    jest.useFakeTimers();
    const icon = { format: "png", data: "SUNPTg==" };
    const store = stubAppStore([], {
      [WOW_LUTRIS.appId]: icon,
      [WOW_BNET.appId]: icon,
      [BNET.appId]: icon,
      [MARIO.appId]: icon,
    });
    env.appStore = store;
    await openPicker({ manual: null, detected: [], autoLinkOn: true });
    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });
    expect(store.reads).toBe(1);
    expect(store.lookups.sort()).toEqual(
      [WOW_LUTRIS.appId, WOW_BNET.appId, BNET.appId, MARIO.appId].sort(),
    );
  });
});
