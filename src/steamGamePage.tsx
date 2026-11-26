import { afterPatch, findInReactTree } from "@decky/ui";
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
 * (BEYOND-05), inside Steam's Play section right under the Play bar: the
 * place Steam gives its own feedback box ("Valve's testing indicates…"),
 * which a non-Steam game never shows (#252).
 *
 * How (DEVICE 2026-11-26, Steam client of that date): the app route's
 * renderFunc returns a context provider whose child is the page, and whose
 * `value` is the component that draws the Play section (Play bar, cloud
 * status, feedback slot, tabs); the page renders it through
 * `useContext`. We patch renderFunc, the pattern of protondb-decky and
 * game-glance, and hand the provider a wrapper that adds our section to
 * that component's children. The page body between them can't be patched:
 * it is a MobX observer class, which renders from an instance property
 * after its first render and so bypasses a patched prototype.
 *
 * Every step is found by the props Steam passes (`overview`, a function
 * `value`), never by minified names, and guarded: a Steam update that
 * moves things makes the section disappear, never the page break, and logs
 * once why.
 */
const GAME_PAGE_ROUTE = "/library/app/:appid";
const SECTION_KEY = "wowdeck-game-section";

const warnOnce = createWarnOnce("game page section not shown");

/* eslint-disable @typescript-eslint/no-explicit-any -- Steam's React tree is untyped */

/**
 * Put our section into the Play section's children, after Steam's leading
 * ones (Play bar and cloud status, which take the game's `overview`), or
 * replace the one an earlier render put there. False, changing nothing,
 * when the children don't start with the Play bar.
 */
export function insertAfterPlayBar(children: unknown, section: any): boolean {
  if (!Array.isArray(children) || !(children[0] as any)?.props?.overview) return false;
  const at = children.findIndex((c) => c?.key === SECTION_KEY);
  if (at >= 0) {
    children[at] = section;
    return true;
  }
  let index = 0;
  while (index < children.length && (children[index] as any)?.props?.overview) index++;
  children.splice(index, 0, section);
  return true;
}

type PlaySection = (props: any) => any;

/**
 * The Play section component with our section added, one wrapper per
 * Steam component so the provider's value keeps its identity across
 * renders. `section(appId)` returns null to add nothing.
 */
export function createPlaySectionWrapper(section: (appId: number) => any) {
  const wrappers = new WeakMap<PlaySection, PlaySection>();
  return (steam: PlaySection): PlaySection => {
    let wrapper = wrappers.get(steam);
    if (!wrapper) {
      wrapper = (props: any) => {
        // Steam's component runs as part of this one: same hooks, same order.
        const ret = steam(props);
        try {
          const appId = props?.overview?.appid;
          const added = typeof appId === "number" ? section(appId) : null;
          if (added && !insertAfterPlayBar(ret?.props?.children, added)) {
            warnOnce("no Play bar");
          }
        } catch (err) {
          warnOnce("insert failed", err);
        }
        return ret;
      };
      wrappers.set(steam, wrapper);
    }
    return wrapper;
  };
}

/** A function component (not a class) Steam provides for the Play section. */
const isFunctionComponent = (v: unknown): v is PlaySection =>
  typeof v === "function" &&
  !(v as { prototype?: { isReactComponent?: unknown } }).prototype?.isReactComponent;

export function patchGamePage(): () => void {
  let active = true;
  // Steam's Play button gets WoWDeck's only while Options says so (#286).
  const launchSwitch = createSteamLaunchSwitch();
  const withSection = createPlaySectionWrapper((appId) =>
    active ? (
      <LinkedWowGameSection key={SECTION_KEY} appId={appId} attachLaunch={launchSwitch.attach} />
    ) : null,
  );
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
      const handler = (_args: unknown[], ret: any) => {
        try {
          if (!active) return ret;
          // The provider whose child is the page.
          const provider = findInReactTree(
            ret,
            (x: any) => x?.props?.children?.props?.overview && "value" in (x?.props ?? {}),
          );
          if (!provider) {
            warnOnce("no Play section provider");
          } else if (!isFunctionComponent(provider.props.value)) {
            warnOnce("Play section is not a function component");
          } else {
            provider.props.value = withSection(provider.props.value);
          }
        } catch (err) {
          warnOnce("patch step failed", err);
        }
        return ret;
      };
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
