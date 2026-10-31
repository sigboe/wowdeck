/**
 * The QAM expand rule, Steam-free: which nodes of the Quick Access Menu
 * renderer take Steam's `Expanded` class, and the small store that says
 * whether they should. `qamExpandHook.tsx` binds it to Steam; this file holds
 * everything that can be tested without Steam.
 *
 * How Steam widens the QAM (sp.js, `QuickAccessMenuBrowserView` and
 * `QuickAccessMenuEmbedded`; DEVICE 2026-10-31, Steam arm64 on DroidDeck):
 *
 *     se = useStore(() => friendsStore.qamFriendsExpanded) && activeTab == Friends
 *     className = classNames(Q().ViewPlaceholder, …, se && Q().Expanded, …)
 *
 * The BrowserView variant hands that className to the native view's
 * placeholder, which measures its own box on every render and calls
 * `browser.SetBounds` to match, sliding with its `animateIn`/`animateOut`
 * when x changes. `Expanded` moves the box (`translateX(506px)` -> `0`), so a
 * placeholder rendered with it IS the widened QAM, with Steam's own slide and
 * Steam's own re-layouts (keyboard, modals). The embedded variant puts the
 * same class on `QuickAccessMenuEmbeddedContainer` and its inner placeholder.
 *
 * Only Friends (and VoiceChat with a menu open) may set it on its own. A
 * plugin tab that wants the wide QAM adds `Expanded` to those same nodes
 * itself: that is this rule.
 */

/** The `Q()` CSS module of Steam's QAM: readable keys, hashed values. */
export interface QamViewClasses {
  ViewPlaceholder: string;
  Expanded: string;
  /** Only the embedded QAM has it. */
  QuickAccessMenuEmbeddedContainer?: string;
}

/** The `@decky/ui` `findClassModule` filter for that module. */
export function isQamViewClasses(m: unknown): m is QamViewClasses {
  if (!m || typeof m !== "object") {
    return false;
  }
  const c = m as Partial<Record<keyof QamViewClasses, unknown>>;
  return typeof c.ViewPlaceholder === "string" && typeof c.Expanded === "string";
}

function hasToken(className: unknown, token: string | undefined): boolean {
  return !!token && typeof className === "string" && className.split(/\s+/).includes(token);
}

/** A node Steam gives `Expanded` when it widens the QAM itself. */
export function takesExpanded(className: unknown, classes: QamViewClasses): boolean {
  return (
    hasToken(className, classes.ViewPlaceholder) ||
    hasToken(className, classes.QuickAccessMenuEmbeddedContainer)
  );
}

/** The className with `Expanded` added once (Friends may have added it already). */
export function withExpanded(className: string, classes: QamViewClasses): string {
  return hasToken(className, classes.Expanded) ? className : `${className} ${classes.Expanded}`;
}

/** A React element as the renderer returns it, seen structurally. */
export interface TreeNode {
  type?: unknown;
  key?: unknown;
  props?: { className?: unknown; children?: unknown } & Record<string, unknown>;
}

/**
 * Replace, in place, every node of a rendered tree that takes `Expanded`
 * with `wrap(copy of the node)`. Children first, so the embedded QAM's inner
 * placeholder is wrapped inside its wrapped container. Walks element children
 * only (what the renderer itself returned), never into other components.
 * Returns how many nodes were wrapped.
 */
export function wrapExpandable(
  tree: unknown,
  classes: QamViewClasses,
  wrap: (element: TreeNode) => TreeNode,
): number {
  let count = 0;
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== "object") {
      return;
    }
    const el = node as TreeNode;
    visit(el.props?.children);
    if (takesExpanded(el.props?.className, classes)) {
      const { type, key, props } = wrap({ ...el });
      Object.assign(el, { type, key, props });
      count++;
    }
  };
  visit(tree);
  return count;
}

/**
 * Whether the QAM should be expanded, for the wrapped nodes to subscribe to
 * (`useSyncExternalStore`), and how many of them are mounted: none mounted
 * means nothing on screen can widen, whatever the store says.
 */
export class QamExpandState {
  private expandedNow = false;
  private mountedCount = 0;
  private readonly listeners = new Set<() => void>();

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): boolean => this.expandedNow;

  setExpanded(expanded: boolean): void {
    if (this.expandedNow === expanded) {
      return;
    }
    this.expandedNow = expanded;
    for (const listener of [...this.listeners]) {
      listener();
    }
  }

  /** A wrapped node mounted; returns its unmount. */
  mounted(): () => void {
    this.mountedCount++;
    return () => {
      this.mountedCount--;
    };
  }

  /** A wrapped node is on screen, so `setExpanded` moves the QAM. */
  get live(): boolean {
    return this.mountedCount > 0;
  }
}

const SHARED_STATE = Symbol.for("wowdeck.qamExpandState");

/**
 * The expand state, one per Steam session rather than one per plugin load.
 * A plugin reload with the QAM open leaves Steam's rendered QAM tree alone
 * until Steam renders it again (closing the QAM), so the wrapper the
 * previous load mounted stays on screen (DEVICE 2026-10-31, SteamOS 3.9.5).
 * Sharing the state lets that wrapper follow the new load and count as
 * mounted for it; Steam's next render swaps in the new wrapper.
 */
export function sharedQamExpandState(store: object = globalThis): QamExpandState {
  const slot = store as { [SHARED_STATE]?: QamExpandState };
  slot[SHARED_STATE] ??= new QamExpandState();
  return slot[SHARED_STATE];
}
