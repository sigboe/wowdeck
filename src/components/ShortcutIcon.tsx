import { useEffect, useRef, useState } from "react";
import { steamShortcutIcon } from "../steamLibrary";

/**
 * Steam loads a shortcut's icon only when asked, and answers in about 200 ms
 * (spike #152): an app id that came up without an icon is looked up once
 * more after this long. Shortcuts with no icon never get one, so there is no
 * second retry.
 */
const ICON_REREAD_MS = 500;

/**
 * Icon URLs for the shown shortcuts, by app id. Each app id is looked up when
 * it first shows, and once more `ICON_REREAD_MS` later if it had none. Only
 * the URLs are kept, never Steam's overview objects, and they are never
 * logged or stored; timers stop on unmount.
 */
export function useShortcutIcons(appIds: readonly number[]): ReadonlyMap<number, string> {
  const [icons, setIcons] = useState<ReadonlyMap<number, string>>(() => new Map());
  const lookedUp = useRef(new Set<number>());
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const shownKey = appIds.join(",");
  useEffect(() => {
    const lookUp = (ids: number[]) => {
      const found = new Map<number, string>();
      const missing: number[] = [];
      for (const id of ids) {
        const url = steamShortcutIcon(id);
        if (url) found.set(id, url);
        else missing.push(id);
      }
      if (found.size) setIcons((prev) => new Map([...prev, ...found]));
      return missing;
    };
    const fresh = shownKey
      .split(",")
      .filter(Boolean)
      .map(Number)
      .filter((id) => !lookedUp.current.has(id));
    fresh.forEach((id) => lookedUp.current.add(id));
    const missing = lookUp(fresh);
    if (missing.length === 0) return;
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      lookUp(missing);
    }, ICON_REREAD_MS);
    timers.current.add(timer);
  }, [shownKey]);
  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);
  return icons;
}
