import { afterPatch, appDetailsClasses, createReactTreePatcher, findInReactTree } from "@decky/ui";
import { routerHook } from "@decky/api";
import { WowGameSection } from "./components/WowGameSection";
import { settingsStore } from "./settings";
import { useSyncExternalStore } from "react";
import { isShownLinkedGame, linkedGamesStore } from "./linkedGames";
import { createSteamLaunchSwitch, type AttachLaunch } from "./steamLaunchPatch";
import { createWarnOnce } from "./warnOnce";

/** The section, on a linked game's page only (`isShownLinkedGame`). */
export function LinkedWowGameSection({
  appId,
  attachLaunch,
}: {
  appId: number;
  attachLaunch: AttachLaunch;
}) {
  const settings = useSyncExternalStore(settingsStore.subscribe, settingsStore.get);
  const linked = useSyncExternalStore(linkedGamesStore.subscribe, linkedGamesStore.get);
  return isShownLinkedGame(appId, settings, linked) ? (
    <WowGameSection appId={appId} attachLaunch={attachLaunch} />
  ) : null;
}

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

const warnOnce = createWarnOnce("game page section not shown");

/* eslint-disable @typescript-eslint/no-explicit-any -- Steam's React tree is untyped */
export function patchGamePage(): () => void {
  let active = true;
  // Steam's Play button gets WoWDeck's only while Options says so (#286).
  const launchSwitch = createSteamLaunchSwitch();
  const renderPatches = new Map<object, ReturnType<typeof afterPatch>>();
  const patch = routerHook.addPatch(GAME_PAGE_ROUTE, (tree: any) => {
    try {
      const routeProps = findInReactTree(tree, (x: any) => x?.renderFunc);
      if (!routeProps) {
        warnOnce("no renderFunc");
        return tree;
      }
      if (renderPatches.has(routeProps)) {
        return tree;
      }
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
            if (!active || typeof appId !== "number") {
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
            const section = (
              <LinkedWowGameSection
                key={SECTION_KEY}
                appId={appId}
                attachLaunch={launchSwitch.attach}
              />
            );
            const index = children.findIndex((c) => c?.key === SECTION_KEY);
            if (index < 0) children.splice(1, 0, section);
            else children[index] = section;
          } catch (err) {
            warnOnce("insert failed", err);
          }
          return ret;
        },
        "wowdeck-game-page",
      );
      renderPatches.set(routeProps, afterPatch(routeProps, "renderFunc", handler));
    } catch (err) {
      warnOnce("patch failed", err);
    }
    return tree;
  });
  return () => {
    active = false;
    routerHook.removePatch(GAME_PAGE_ROUTE, patch);
    for (const installed of renderPatches.values()) installed.unpatch();
    renderPatches.clear();
    launchSwitch.dispose();
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
