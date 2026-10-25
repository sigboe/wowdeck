/**
 * Depends on: Steam's library tiles showing `customimages/<appid>.png` (or
 * `p.png`) and the element that frames that image, in the window `findSP()`
 * returns.
 * Fails as: no tile found -> no badge; nothing else changes.
 * Kill switch: Options -> Steam library -> "Show a badge on its tile"
 * (settings.steamBadge).
 */

import { findSP } from "@decky/ui";
import { STEAM } from "../steamTheme";
import { badgeState, type BadgeState } from "../steamLibrary";
import { settingsStore } from "../settings";
import { getSteamUpdates, onSteamSurfaceShown, subscribeSteamUpdates } from "../steamUpdates";

/**
 * A small badge on the linked game's tile in Steam's library (home screen
 * and grid): green with a download arrow when addon updates are waiting,
 * dark with a check when all are current, blue while checking (BEYOND-05;
 * owner, 2026-10-16: glyphs and colours only). A newly seen tile also starts
 * the throttled background check (steamUpdates.onSteamSurfaceShown).
 *
 * No Decky plugin patches home tiles, so this works on the DOM: a tile is
 * found by its image, `customimages/<appid>.png` (or `p.png`, the portrait
 * in the grid; DEVICE spike S8, 2026-10-16), and the badge is pinned to the
 * element that frames that image exactly, like ProtonDB Badges' home-tile
 * dots (PC-05). Everything is guarded: when Steam changes
 * its markup the badge just does not appear. Options can turn it off.
 */
const BADGE_CLASS = "wowdeck-tile-badge";
// ProtonDB Badges' proportions on the same tiles (DEVICE, 2026-10-20): a 24 px
// dot 4 px in from the corner of a 113 x 170 tile.
const SIZE = 24;
const INSET = 4;
/** Layout rounding between an image and the elements that frame it. */
const SAME_BOX_PX = 2;

// Glyphs (16 px viewBox, stroked), drawn in the badge's foreground colour.
const GLYPH: Record<BadgeState, string> = {
  updates: '<path d="M8 2.5v8M4.5 7.5 8 11l3.5-3.5M3.5 13.5h9"/>',
  current: '<path d="M3.5 8.5 6.5 11.5 12.5 4.5"/>',
  checking: '<path d="M13 8a5 5 0 1 1-1.5-3.5M13 2.5v3h-3"/>',
};
const LOOK: Record<BadgeState, { bg: string; fg: string; label: string }> = {
  updates: { bg: STEAM.positive, fg: "#ffffff", label: "WoW addon updates available" },
  current: { bg: "rgba(14, 20, 27, 0.85)", fg: STEAM.textMuted, label: "WoW addons up to date" },
  checking: { bg: STEAM.primary, fg: "#ffffff", label: "Checking WoW addons for updates" },
};

let warned = false;
function warnOnce(what: string, err?: unknown): void {
  if (!warned) {
    warned = true;
    console.warn(`wowdeck: home tile badge not shown (${what})`, err ?? "");
  }
}

/**
 * The elements framing the game's tile images: of the ancestors whose box is
 * still the image's own box (DEVICE, 2026-10-20: four of them), the outermost
 * one Steam already positions; that is the one ProtonDB Badges uses, and it
 * zooms with the focused tile. The earlier "about the image's size" walk
 * reached the 124 x 215 Panel around the art, so the badge sat off the art's
 * corner (PC-05).
 */
function findTiles(doc: Document, appId: number): HTMLElement[] {
  const pattern = new RegExp(`/customimages/${appId}p?\\.(png|jpe?g|webp)(\\?|$)`);
  const tiles: HTMLElement[] = [];
  for (const img of Array.from(
    doc.querySelectorAll<HTMLImageElement>(`img[src*="/customimages/${appId}"]`),
  )) {
    if (!pattern.test(img.src)) {
      continue; // hero, logo
    }
    const r = img.getBoundingClientRect();
    if (r.width < 40 || r.height < 40) {
      continue;
    }
    const view = doc.defaultView;
    let tile: HTMLElement = img.parentElement ?? img;
    let positioned: HTMLElement | null = null;
    for (let e: HTMLElement | null = tile; e && e !== doc.body; e = e.parentElement) {
      const b = e.getBoundingClientRect();
      if (
        Math.abs(b.left - r.left) > SAME_BOX_PX ||
        Math.abs(b.top - r.top) > SAME_BOX_PX ||
        Math.abs(b.width - r.width) > SAME_BOX_PX ||
        Math.abs(b.height - r.height) > SAME_BOX_PX
      ) {
        break;
      }
      tile = e;
      if (view && view.getComputedStyle(e).position !== "static") {
        positioned = e;
      }
    }
    tile = positioned ?? tile;
    if (!tiles.includes(tile)) {
      tiles.push(tile);
    }
  }
  return tiles;
}

function draw(doc: Document, tile: HTMLElement, state: BadgeState): void {
  let badge = tile.querySelector<HTMLElement>(`:scope > .${BADGE_CLASS}`);
  if (!badge) {
    if (doc.defaultView?.getComputedStyle(tile).position === "static") {
      tile.style.position = "relative";
    }
    badge = doc.createElement("div");
    badge.className = BADGE_CLASS;
    badge.setAttribute("role", "img");
    Object.assign(badge.style, {
      position: "absolute",
      top: `${INSET}px`,
      right: `${INSET}px`,
      width: `${SIZE}px`,
      height: `${SIZE}px`,
      borderRadius: "50%",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      boxShadow: "0 1px 4px rgba(0, 0, 0, 0.5)",
      pointerEvents: "none",
      zIndex: "10",
    });
    tile.appendChild(badge);
  }
  if (badge.dataset.state === state) {
    return;
  }
  const look = LOOK[state];
  badge.dataset.state = state;
  badge.style.background = look.bg;
  badge.setAttribute("aria-label", look.label);
  badge.innerHTML = `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="${look.fg}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${GLYPH[state]}</svg>`;
}

export function startHomeBadge(): () => void {
  let doc: Document | null = null;
  let observer: MutationObserver | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let seen = new WeakSet<Element>();

  const render = () => {
    timer = null;
    try {
      doc ??= findSP()?.document ?? null;
      if (!doc) {
        return;
      }
      const { steamGame: game, steamBadge: badge } = settingsStore.get().settings;
      const tiles = game && badge ? findTiles(doc, game.appId) : [];
      const { summary, checking } = getSteamUpdates();
      const state = tiles.length ? badgeState(summary, checking) : null;
      for (const old of Array.from(doc.querySelectorAll(`.${BADGE_CLASS}`))) {
        if (!state || !tiles.includes(old.parentElement as HTMLElement)) {
          old.remove();
        }
      }
      let appeared = false;
      for (const tile of tiles) {
        if (!seen.has(tile)) {
          seen.add(tile);
          appeared = true;
        }
        if (state) {
          draw(doc, tile, state);
        }
      }
      if (appeared) {
        onSteamSurfaceShown();
      }
    } catch (err) {
      warnOnce("render failed", err);
    }
  };
  // Steam's library re-renders a lot; coalesce into one pass.
  const schedule = () => {
    timer ??= setTimeout(render, 250);
  };

  try {
    doc = findSP()?.document ?? null;
    if (doc?.body) {
      observer = new MutationObserver(schedule);
      observer.observe(doc.body, { childList: true, subtree: true });
    } else {
      warnOnce("no Steam window");
    }
  } catch (err) {
    warnOnce("observer failed", err);
  }
  // A new game or a badge switched on counts its tiles as appearing again;
  // any other setting leaves them alone.
  const steamKey = () => {
    const { steamGame, steamBadge } = settingsStore.get().settings;
    return `${steamGame?.appId ?? ""}:${steamBadge}`;
  };
  let lastSteamKey = steamKey();
  const offSettings = settingsStore.subscribe(() => {
    if (steamKey() === lastSteamKey) {
      return;
    }
    lastSteamKey = steamKey();
    seen = new WeakSet();
    schedule();
  });
  const offUpdates = subscribeSteamUpdates(schedule);
  schedule();

  return () => {
    observer?.disconnect();
    offSettings();
    offUpdates();
    if (timer) {
      clearTimeout(timer);
    }
    try {
      doc?.querySelectorAll(`.${BADGE_CLASS}`).forEach((b) => b.remove());
    } catch {
      // nothing left to clean
    }
  };
}
