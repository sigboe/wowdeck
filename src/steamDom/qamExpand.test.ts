import { describe, expect, test } from "bun:test";
import {
  DECKY_QAM_TAB,
  QamExpandState,
  sharedQamExpandState,
  showsDeckyTab,
  takesExpanded,
  withExpanded,
  wrapExpandable,
  type QamViewClasses,
  type TreeNode,
} from "./qamExpand";

/** Steam's QAM CSS module, values as measured (DEVICE 2026-10-31). */
const classes: QamViewClasses = {
  ViewPlaceholder: "_2orc8-PBheKd3BvuGXV6ZL",
  Expanded: "O_8CAFWLuCw8vwTgsYBIb",
  QuickAccessMenuEmbeddedContainer: "oMpcwfzZp3uWO6proiiHy",
};

const Wrapper = "Wrapper";
const wrap = (element: TreeNode): TreeNode => ({
  type: Wrapper,
  key: element.key,
  props: { element },
});

describe("which QAM nodes take Expanded", () => {
  test("Steam's view placeholder and the embedded container, by class token", () => {
    expect(takesExpanded(`${classes.ViewPlaceholder} _3ud27`, classes)).toBe(true);
    expect(takesExpanded(classes.QuickAccessMenuEmbeddedContainer, classes)).toBe(true);
    expect(takesExpanded(`${classes.ViewPlaceholder}x`, classes)).toBe(false);
    expect(takesExpanded(undefined, classes)).toBe(false);
  });

  test("without an embedded container class only the placeholder matches", () => {
    const browserViewOnly = { ViewPlaceholder: "a", Expanded: "b" };
    expect(takesExpanded("a", browserViewOnly)).toBe(true);
    expect(takesExpanded("", browserViewOnly)).toBe(false);
  });

  test("Expanded is added once, also when Friends added it already", () => {
    expect(withExpanded("p", classes)).toBe(`p ${classes.Expanded}`);
    expect(withExpanded(`p ${classes.Expanded}`, classes)).toBe(`p ${classes.Expanded}`);
  });
});

describe("wrapping the renderer's tree", () => {
  test("the BrowserView placeholder is wrapped in place, keeping its key", () => {
    // QuickAccessMenuBrowserView: <Backdrop>[<Placeholder browser className/>, portal]</Backdrop>
    const placeholder = {
      type: "BrowserViewHost",
      key: "v",
      props: { className: classes.ViewPlaceholder, browser: {} },
    };
    const tree = { type: "Backdrop", props: { children: [placeholder, "portal"] } };
    expect(wrapExpandable(tree, classes, wrap)).toBe(1);
    const node = tree.props.children[0] as TreeNode;
    expect(node.type).toBe(Wrapper);
    expect(node.key).toBe("v");
    expect((node.props!.element as TreeNode).type).toBe("BrowserViewHost");
    expect((node.props!.element as TreeNode).props!.browser).toEqual({});
  });

  test("the embedded QAM gets both nodes, the inner one inside the wrapped container", () => {
    const inner = {
      type: "div",
      props: { className: `${classes.ViewPlaceholder} Embedded`, children: "tabs" },
    };
    const tree = {
      type: "div",
      props: { className: classes.QuickAccessMenuEmbeddedContainer, children: inner },
    };
    expect(wrapExpandable(tree, classes, wrap)).toBe(2);
    expect(tree.type).toBe(Wrapper);
    const container = (tree.props as Record<string, unknown>).element as TreeNode;
    const wrappedInner = container.props!.children as TreeNode;
    expect(wrappedInner.type).toBe(Wrapper);
    expect((wrappedInner.props!.element as TreeNode).props!.children).toBe("tabs");
  });

  test("a tree without Steam's view nodes is left alone", () => {
    const tree = { type: "div", props: { className: "other", children: [null, false, "x"] } };
    expect(wrapExpandable(tree, classes, wrap)).toBe(0);
    expect(tree.type).toBe("div");
  });

  test("an already wrapped node is not wrapped again", () => {
    const tree = {
      type: "div",
      props: { children: { type: "x", props: { className: classes.ViewPlaceholder } } },
    };
    wrapExpandable(tree, classes, wrap);
    expect(wrapExpandable(tree, classes, wrap)).toBe(0);
  });
});

describe("the expand state", () => {
  test("notifies subscribers on a change only", () => {
    const state = new QamExpandState();
    let calls = 0;
    const off = state.subscribe(() => calls++);
    state.setExpanded(true);
    state.setExpanded(true);
    expect(state.getSnapshot()).toBe(true);
    state.setExpanded(false);
    expect(calls).toBe(2);
    off();
    state.setExpanded(true);
    expect(calls).toBe(2);
  });

  test("is live while a wrapped node is mounted", () => {
    const state = new QamExpandState();
    expect(state.live).toBe(false);
    const unmountA = state.mounted();
    const unmountB = state.mounted();
    unmountA();
    expect(state.live).toBe(true);
    unmountB();
    expect(state.live).toBe(false);
  });

  test("renders expanded only while the owner's page shows, read on every render", () => {
    // Valve: `qamFriendsExpanded && activeTab == Friends`.
    const state = new QamExpandState();
    let page = "browse";
    let left = 0;
    state.setOwner({ showing: () => page === "browse", left: () => left++ });
    expect(state.getRendered()).toBe(false);
    state.setExpanded(true);
    expect(state.getRendered()).toBe(true);
    page = "installed";
    expect(state.getSnapshot()).toBe(true);
    expect(state.getRendered()).toBe(false);
    state.ownerLeft();
    expect(left).toBe(1);
  });

  test("without an owner, or with one that throws, renders what is wanted", () => {
    const state = new QamExpandState();
    state.setExpanded(true);
    expect(state.getRendered()).toBe(true);
    state.setOwner({
      showing: () => {
        throw new Error("reach changed");
      },
      left: () => {},
    });
    expect(state.getRendered()).toBe(true);
  });

  test("setting the owner re-renders the wrapped nodes", () => {
    const state = new QamExpandState();
    let calls = 0;
    state.subscribe(() => calls++);
    state.setOwner(null);
    expect(calls).toBe(1);
  });

  test("a wrapper mounted before a plugin reload follows the reloaded plugin", () => {
    // Steam keeps the QAM's rendered tree across a reload while the QAM is
    // open, so the wrapper the old plugin mounted stays on screen (DEVICE
    // 2026-10-31, SteamOS 3.9.5).
    const store = {};
    const before = sharedQamExpandState(store);
    let expanded = before.getSnapshot();
    before.subscribe(() => (expanded = before.getSnapshot()));
    before.mounted();
    before.setExpanded(false); // the old plugin's deinit

    const after = sharedQamExpandState(store);
    expect(after.live).toBe(true);
    after.setExpanded(true);
    expect(expanded).toBe(true);
  });
});

/** QamExpandState as 1.3.0 shipped it: what a Decky update without a Steam restart finds. */
class ReleasedQamExpandState {
  private expandedNow = false;
  private mountedCount = 0;
  private readonly listeners = new Set<() => void>();
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  readonly getSnapshot = (): boolean => this.expandedNow;
  setExpanded(expanded: boolean): void {
    if (this.expandedNow === expanded) return;
    this.expandedNow = expanded;
    for (const listener of [...this.listeners]) listener();
  }
  mounted(): () => void {
    this.mountedCount++;
    return () => {
      this.mountedCount--;
    };
  }
  get live(): boolean {
    return this.mountedCount > 0;
  }
}

describe("the shared state after an update without a Steam restart", () => {
  test("the previous build's object gains this build's methods and keeps its wrapper", () => {
    // DEVICE 2026-11-25: `setOwner is not a function` stopped the plugin load.
    const store = { [Symbol.for("wowdeck.qamExpandState")]: new ReleasedQamExpandState() };
    const before = store[Symbol.for("wowdeck.qamExpandState")]!;
    let seen = before.getSnapshot();
    before.subscribe(() => (seen = before.getSnapshot()));
    const unmountOld = before.mounted();
    before.setExpanded(false); // the old plugin's deinit

    const after = sharedQamExpandState(store);
    expect(after as unknown).toBe(before);
    expect(after.live).toBe(true);
    let page = "browse";
    after.setOwner({ showing: () => page === "browse", left: () => {} });
    after.setExpanded(true);
    expect(seen).toBe(true);
    expect(after.getRendered()).toBe(true);
    page = "installed";
    expect(after.getRendered()).toBe(false);
    unmountOld();
    expect(after.live).toBe(false);
    expect(sharedQamExpandState(store)).toBe(after);
  });

  test("an object of an unknown shape is replaced", () => {
    const store = { [Symbol.for("wowdeck.qamExpandState")]: { expandedNow: "yes" } };
    const state = sharedQamExpandState(store);
    expect(state).toBeInstanceOf(QamExpandState);
    expect(state.getRendered()).toBe(false);
  });
});

describe("Steam's QAM tab", () => {
  test("Decky's tab, or an unreadable one, may show the wide QAM", () => {
    expect(showsDeckyTab(DECKY_QAM_TAB)).toBe(true);
    expect(showsDeckyTab(undefined)).toBe(true);
    expect(showsDeckyTab(3)).toBe(false); // Friends
    expect(showsDeckyTab(4)).toBe(false); // Settings
  });
});
