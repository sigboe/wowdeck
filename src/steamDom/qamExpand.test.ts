import { describe, expect, test } from "bun:test";
import {
  isQamViewClasses,
  QamExpandState,
  sharedQamExpandState,
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

  test("finds the class module by its readable keys", () => {
    expect(isQamViewClasses({ ViewPlaceholder: "x", Expanded: "y", Open: "z" })).toBe(true);
    expect(isQamViewClasses({ ViewPlaceholder: "x" })).toBe(false);
    expect(isQamViewClasses(null)).toBe(false);
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
