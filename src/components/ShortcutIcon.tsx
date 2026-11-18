import { useEffect, useRef, useState, type CSSProperties } from "react";
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

/**
 * A shortcut's icon in a square slot of `size`. Decorative: hidden from
 * screen readers, and blank when there is no icon or it fails to load, so
 * names beside it line up either way.
 */
export function ShortcutIconSlot({
  icon,
  size,
  style,
}: {
  icon?: string;
  size: string;
  style?: CSSProperties;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <span
      data-icon-slot
      aria-hidden="true"
      style={{ ...style, width: size, height: size, flex: "none" }}
    >
      {icon && icon !== failed && (
        <img
          src={icon}
          alt=""
          decoding="async"
          style={{ width: "100%", height: "100%", display: "block", objectFit: "contain" }}
          onError={() => setFailed(icon)}
        />
      )}
    </span>
  );
}
