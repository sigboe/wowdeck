import { afterPatch, appDetailsClasses, createReactTreePatcher, findInReactTree } from "@decky/ui";
import { routerHook } from "@decky/api";
import { WowGameSection } from "./components/WowGameSection";
import { settingsStore } from "./settings";

/**
 * Puts the WoW addons section on the linked game's page in Steam's library
 * (BEYOND-05). The pattern of two other Decky plugins (protondb-decky,
 * game-glance): patch the app route's renderFunc, find the page's
 * InnerContainer (hero, then the Play block) and insert between the two.
 * This lives on Steam's React internals, so every step is guarded: a Steam
 * update that moves things makes the section disappear, never the page
 * break, and logs once why.
 */
const GAME_PAGE_ROUTE = "/library/app/:appid";
const SECTION_KEY = "wowdeck-game-section";
const PATCHED = Symbol.for("wowdeck.gamePage");

let warned = false;
function warnOnce(what: string, err?: unknown): void {
  if (!warned) {
    warned = true;
    console.warn(`wowdeck: game page section not shown (${what})`, err ?? "");
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any -- Steam's React tree is untyped */
export function patchGamePage(): () => void {
  const patch = routerHook.addPatch(GAME_PAGE_ROUTE, (tree: any) => {
    try {
      const routeProps = findInReactTree(tree, (x: any) => x?.renderFunc);
      if (!routeProps) {
        warnOnce("no renderFunc");
        return tree;
      }
      if (routeProps[PATCHED]) {
        return tree;
      }
      routeProps[PATCHED] = true;
      let appId: unknown;
      const handler = createReactTreePatcher(
        [
          (t: any) => {
            const node = findInReactTree(t, (x: any) => x?.props?.children?.props?.overview);
            appId = node?.props?.children?.props?.overview?.appid;
            return node?.props?.children;
          },
        ],
        (_args: unknown[], ret: any) => {
          try {
            const linked = settingsStore.get().settings.steamGame;
            if (!linked || appId !== linked.appId) {
              return ret;
            }
            const container = findInReactTree(
              ret,
              (x: any) =>
                Array.isArray(x?.props?.children) &&
                typeof x?.props?.className === "string" &&
                x.props.className.includes(appDetailsClasses.InnerContainer),
            );
            if (!container) {
              warnOnce("no InnerContainer");
              return ret;
            }
            const children = container.props.children as any[];
            if (!children.some((c) => c?.key === SECTION_KEY)) {
              children.splice(1, 0, <WowGameSection key={SECTION_KEY} />);
            }
          } catch (err) {
            warnOnce("insert failed", err);
          }
          return ret;
        },
        "wowdeck-game-page",
      );
      afterPatch(routeProps, "renderFunc", handler);
    } catch (err) {
      warnOnce("patch failed", err);
    }
    return tree;
  });
  return () => routerHook.removePatch(GAME_PAGE_ROUTE, patch);
}
/* eslint-enable @typescript-eslint/no-explicit-any */
