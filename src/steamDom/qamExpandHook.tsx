/**
 * Depends on: the Quick Access Menu renderers (`QuickAccessMenuBrowserView`,
 * `QuickAccessMenuEmbedded`, found by their names the way Decky's TabsHook
 * finds them: exported on the webpack Steam client, in module scope on the
 * Vite one) and the QAM CSS module (`ViewPlaceholder`, `Expanded`: found by
 * its readable keys on webpack, from Decky 4's `quickAccessMenuClasses` on
 * Vite). Both lookups: `steamLookup.ts`.
 * Fails as: either missing -> `init` false, `live` stays false and Get Addons
 * keeps its collapsed layout (qamWidening), one console warning. Never throws.
 * Kill switch: the automatic fallback above; there is no user setting.
 */

import { cloneElement, useLayoutEffect, useSyncExternalStore, type ReactElement } from "react";
import { flushSync } from "react-dom";
import { afterPatch, getReactRoot } from "@decky/ui";
import { steamLookup } from "../steamLookup";
import {
  sharedQamExpandState,
  type QamExpandState,
  withExpanded,
  wrapExpandable,
  type QamViewClasses,
  type TreeNode,
} from "./qamExpand";

/**
 * Expands Steam's Quick Access Menu for a plugin tab exactly the way Friends
 * & Chat expands it: the QAM renderer's view nodes get Steam's `Expanded`
 * class, and Steam's own placeholder slides the native view (rule and
 * measurements: qamExpand.ts). Built like Decky's TabsHook
 * (decky-loader frontend/src/tabs-hook.tsx): the renderers are found by name,
 * `afterPatch`ed on `type`, and the already mounted QAM fiber is pointed at
 * the patched type. Self-contained on purpose, so Decky could lift it.
 *
 *     const hook = new QamExpandHook();
 *     hook.init();             // at plugin load
 *     hook.setExpanded(true);  // the QAM slides wide; false slides it back
 *     hook.deinit();           // at unload
 *
 * Each wrapped node subscribes to the expand state on its own, so
 * `setExpanded` re-renders just the placeholder, and every render Steam does
 * for its own reasons keeps the class. A Steam build that renders the QAM
 * differently mounts no wrapped node: `live` stays false and the caller keeps
 * its collapsed layout.
 */
export class QamExpandHook {
  private readonly state = sharedQamExpandState();
  private renderers: Renderer[] = [];
  private patches: { unpatch(): void }[] = [];

  /** Patch the QAM renderers. True when the mechanism was found. */
  init(): boolean {
    try {
      const classes: QamViewClasses | undefined = steamLookup.findClasses(
        QAM_CLASS_KEYS,
        "quickAccessMenuClasses",
      );
      const qamModule = steamLookup.findModuleWith((e: unknown) => isRenderer(e, BROWSER_VIEW));
      const renderers = qamModule
        ? Object.values(qamModule).filter(
            (e): e is Renderer => isRenderer(e, BROWSER_VIEW) || isRenderer(e, EMBEDDED),
          )
        : [];
      if (!classes || renderers.length === 0) {
        warn(!classes ? "no QAM class module" : "no QAM renderer");
        return false;
      }
      const state = this.state;
      const wrap = (element: TreeNode): TreeNode =>
        (
          <ExpandableView
            element={element as ReactElement<{ className: string }>}
            state={state}
            classes={classes}
            key={element.key as string}
          />
        ) as TreeNode;
      this.renderers = renderers;
      this.patches = renderers.map((renderer) =>
        afterPatch(renderer, "type", (_args: unknown[], ret: unknown) => {
          try {
            wrapExpandable(ret, classes, wrap);
          } catch (err) {
            warn("wrap failed", err);
          }
          return ret;
        }),
      );
      const mounted = this.repointMountedQam();
      if (mounted && !state.live) {
        refreshQamRenderer(mounted);
      }
      return true;
    } catch (err) {
      warn("init failed", err);
      return false;
    }
  }

  /** Unpatch; the QAM collapses first so nothing is left slid out. */
  deinit(): void {
    this.state.setExpanded(false);
    for (const patch of this.patches) {
      try {
        patch.unpatch();
      } catch (err) {
        warn("unpatch failed", err);
      }
    }
    this.patches = [];
    this.repointMountedQam();
    this.renderers = [];
  }

  setExpanded(expanded: boolean): void {
    this.state.setExpanded(expanded);
  }

  /** A wrapped view node is mounted: `setExpanded` moves the QAM. */
  get live(): boolean {
    return this.state.live;
  }

  /**
   * A mounted QAM keeps rendering the type it was created with. Point it at
   * the current one, as TabsHook does: `elementType` is the memo, `type` the
   * (mobx-wrapped) function it renders. Return the open renderer, if any.
   */
  private repointMountedQam(): Fiber | undefined {
    const rootEl = document.getElementById("root");
    const root = rootEl ? (getReactRoot(rootEl) as Fiber | undefined) : undefined;
    const stack: (Fiber | null | undefined)[] = [root?.stateNode?.current ?? root];
    let active: Fiber | undefined;
    while (stack.length > 0) {
      const fiber = stack.pop();
      if (!fiber) {
        continue;
      }
      const renderer = this.renderers.find((r) => fiber.elementType === r);
      if (renderer) {
        fiber.type = renderer.type;
        if (fiber.alternate) {
          fiber.alternate.type = renderer.type;
        }
        if (fiber.memoizedProps?.active === true) {
          active = fiber;
        }
      }
      stack.push(fiber.sibling, fiber.child);
    }
    return active;
  }
}

/**
 * Repointing alone leaves an unchanged, open QAM memoized. Schedule one
 * render with an identity state update. Temporarily hide the eager reducer
 * during dispatch and mark the previous props to bypass React's two bailouts.
 * No Steam state value or incoming prop changes. See the UI guide under QAM widening measurements.
 */
function refreshQamRenderer(fiber: Fiber): void {
  const props = fiber.memoizedProps;
  if (!props || typeof flushSync !== "function") return;

  let hook = fiber.memoizedState;
  while (hook) {
    const queue = hook.queue;
    const reducer = queue?.lastRenderedReducer;
    const dispatch = queue?.dispatch;
    if (
      queue &&
      typeof dispatch === "function" &&
      typeof reducer === "function" &&
      isBasicStateReducer(reducer)
    ) {
      const previousProps = { ...props, __wowdeckRefresh: true };
      try {
        flushSync(() => {
          fiber.memoizedProps = previousProps;
          queue.lastRenderedReducer = null;
          try {
            dispatch((value) => value);
          } finally {
            queue.lastRenderedReducer = reducer;
          }
        });
      } catch (err) {
        warn("could not refresh the open QAM", err);
      } finally {
        if (fiber.memoizedProps === previousProps) {
          fiber.memoizedProps = props;
        }
      }
      return;
    }
    hook = hook.next;
  }
}

/** A useReducer queue could interpret the identity function as an action. */
function isBasicStateReducer(reducer: (state: unknown, action: unknown) => unknown): boolean {
  const source = Function.prototype.toString.call(reducer);
  const signature = /^function\s+[\w$]+\(\s*([\w$]+)\s*,\s*([\w$]+)\s*\)/.exec(source);
  if (!signature) return false;
  const [, state, action] = signature;
  const body = source
    .slice(signature[0].length)
    .replace(/\s/g, "")
    .replace(/['`]/g, '"')
    .replace(/===/g, "==")
    .replace(/;}/g, "}");
  return (
    body === `{returntypeof${action}=="function"?${action}(${state}):${action}}` ||
    body === `{return"function"==typeof${action}?${action}(${state}):${action}}`
  );
}

/** A Steam renderer: a memo (`{ type }`) whose source names it. */
interface Renderer {
  type: unknown;
}

interface Fiber {
  elementType: unknown;
  type: unknown;
  alternate: Fiber | null;
  child: Fiber | null;
  sibling: Fiber | null;
  stateNode?: { current?: Fiber };
  memoizedProps?: { active?: boolean };
  memoizedState?: FiberHook | null;
}

interface FiberHook {
  queue?: {
    dispatch?: (update: (value: unknown) => unknown) => void;
    lastRenderedReducer?: ((state: unknown, action: unknown) => unknown) | null;
  };
  next?: FiberHook | null;
}

const BROWSER_VIEW = "QuickAccessMenuBrowserView";
const QAM_CLASS_KEYS = ["ViewPlaceholder", "Expanded"] as const;
const EMBEDDED = "QuickAccessMenuEmbedded";

function isRenderer(e: unknown, name: string): e is Renderer {
  const type = (e as Partial<Renderer> | null)?.type;
  // Decky's patcher forwards toString, so a renderer stays findable patched.
  return typeof type === "function" && type.toString().includes(name);
}

/** Steam's view node, with `Expanded` while the state says so. */
function ExpandableView({
  element,
  state,
  classes,
}: {
  element: ReactElement<{ className: string }>;
  state: QamExpandState;
  classes: QamViewClasses;
}) {
  const expanded = useSyncExternalStore(state.subscribe, state.getSnapshot);
  // Layout effect: counted before any tab content's effects ask for `live`.
  useLayoutEffect(() => state.mounted(), [state]);
  return expanded
    ? cloneElement(element, { className: withExpanded(element.props.className, classes) })
    : element;
}

let warned = false;
function warn(what: string, err?: unknown): void {
  if (!warned) {
    warned = true;
    console.warn(`wowdeck: QAM expand unavailable (${what})`, err ?? "");
  }
}
