import { describe, expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import {
  createPanelShoulderNavigation,
  nextSectionIndex,
  type SteamClientInput,
} from "./shoulderNav";

const LEFT = 5;
const RIGHT = 6;

type InputCallback = Parameters<SteamClientInput["RegisterForControllerInputMessages"]>[0];

function withPanel(run: (panel: ReturnType<typeof panelFixture>) => void, native = true): void {
  const saved = Object.getOwnPropertyDescriptor(globalThis, "window");
  const panel = panelFixture(native);
  try {
    run(panel);
  } finally {
    panel.stop();
    panel.dom.window.close();
    if (saved) Object.defineProperty(globalThis, "window", saved);
    else Reflect.deleteProperty(globalThis, "window");
  }
}

function panelFixture(native: boolean) {
  const dom = new JSDOM(
    '<button id="title">Back</button><div id="panel"><button>My Addons</button></div>',
  );
  const root = dom.window.document.getElementById("panel")!;
  let mounted: HTMLElement | null = root;
  let index = 0;
  let activeTree: string | null = "QuickAccess-NA";
  let replaceOnStep = false;
  let callback: InputCallback | null = null;
  const input: SteamClientInput = {
    RegisterForControllerInputMessages: (cb) => {
      callback = cb;
      return {
        unregister: () => {
          callback = null;
        },
      };
    },
  };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: native ? { SteamClient: { Input: input } } : {},
  });
  const navigation = createPanelShoulderNavigation({
    getRoot: () => mounted,
    step: (direction) => {
      index = nextSectionIndex(index, direction, 3);
      if (replaceOnStep) root.replaceChildren(dom.window.document.createElement("button"));
    },
    buttons: { left: LEFT, right: RIGHT },
    activeTreeId: () => activeTree,
  });
  const listener = (event: Event) =>
    navigation.onButtonDown(event as CustomEvent<{ button: number }>);
  root.addEventListener("vgp_onbuttondown", listener);
  const unsubscribe = navigation.subscribe();
  const focused = (button = RIGHT) => {
    const event = new dom.window.CustomEvent("vgp_onbuttondown", {
      bubbles: true,
      cancelable: true,
      detail: { button },
    });
    root.querySelector("button")!.dispatchEvent(event);
    return event;
  };
  return {
    dom,
    root,
    focused,
    raw: (code = 31, pressed = true) => callback?.(0, code, pressed),
    index: () => index,
    activeTree: (id: string | null) => {
      activeTree = id;
    },
    replaceOnStep: () => {
      replaceOnStep = true;
    },
    unmount: () => {
      mounted = null;
      root.remove();
    },
    stop: () => {
      unsubscribe();
      root.removeEventListener("vgp_onbuttondown", listener);
    },
  };
}

describe("panel shoulder input", () => {
  for (const order of ["focused-first", "raw-first"]) {
    test(`one R1 advances one tab when DOM focus is BODY (${order})`, () =>
      withPanel((panel) => {
        // Steam's gamepad tree can target our button while browser focus stays on BODY.
        expect(panel.dom.window.document.activeElement).toBe(panel.dom.window.document.body);
        if (order === "focused-first") {
          panel.focused();
          panel.raw();
        } else {
          panel.raw();
          panel.focused();
        }
        panel.raw(31, false);
        expect(panel.index()).toBe(1);
      }));
  }

  test("a tab render removing the focused control cannot process R1 twice", () =>
    withPanel((panel) => {
      panel.root.querySelector("button")!.focus();
      panel.replaceOnStep();
      panel.focused();
      panel.raw();
      expect(panel.dom.window.document.activeElement).toBe(panel.dom.window.document.body);
      expect(panel.index()).toBe(1);
    }));

  test("keyboard and other active trees own bumpers while the panel remains mounted", () =>
    withPanel((panel) => {
      for (const tree of ["virtual keyboard", "GamepadUI_Full_Root", "ModalDialogOverlay_1"]) {
        panel.activeTree(tree);
        panel.raw();
        panel.focused();
        expect(panel.index()).toBe(0);
      }
      panel.activeTree("QuickAccess-NA");
      panel.raw();
      expect(panel.index()).toBe(1);
    }));

  test("a missing navigation-tree lookup uses the focused path without doubling", () =>
    withPanel((panel) => {
      panel.activeTree(null);
      panel.focused();
      panel.raw();
      expect(panel.index()).toBe(1);
    }));

  test("R1 works on the title bar and clamps at the ends without suppressing rapid presses", () =>
    withPanel((panel) => {
      panel.dom.window.document.getElementById("title")!.focus();
      for (let i = 0; i < 3; i++) {
        panel.raw();
        panel.raw(31, false);
      }
      expect(panel.index()).toBe(2);
      for (let i = 0; i < 3; i++) {
        panel.raw(30);
        panel.raw(30, false);
      }
      expect(panel.index()).toBe(0);
    }));

  test("releases, unrelated buttons and events after unmount do not change tabs", () =>
    withPanel((panel) => {
      panel.raw(31, false);
      panel.raw(1);
      expect(panel.focused(1).defaultPrevented).toBe(false);
      panel.unmount();
      panel.raw();
      expect(panel.index()).toBe(0);
    }));

  test("unsubscribing stops native input", () =>
    withPanel((panel) => {
      panel.stop();
      panel.raw();
      expect(panel.index()).toBe(0);
    }));

  test("the focused handler still works when Steam's native input bridge is unavailable", () =>
    withPanel((panel) => {
      expect(panel.focused().defaultPrevented).toBe(true);
      expect(panel.index()).toBe(1);
    }, false));
});
