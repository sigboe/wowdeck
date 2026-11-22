import { Component, createElement, type ComponentType, type ReactNode } from "react";
import { steamLookup } from "./steamLookup";
import { FaCheck } from "react-icons/fa";

/**
 * Steam's own icons for what WoWDeck adds to its Play button and "Play
 * from…" menu, so they look like Valve's (G13; docs/ui/device-notes.md
 * §8.4e). Both are exported function components, found by their source
 * (LIVE, Steam Deck 2026-11-18):
 * - the menu check: Steam's "Play from…" menu draws its selected row with
 *   the component whose source names `SVGIcon_DialogCheck` (a blue gradient
 *   check, props `highlightColor`, `color`);
 * - the Play button chevron: the arrow component taking `direction`, whose
 *   "down" path is Steam's filled triangle (`M17.98 26.54`).
 * A missing component, or one that throws, draws the given fallback.
 */

type Lookup = ComponentType<Record<string, unknown>> | null;
const found = new Map<string, Lookup>();

function steamComponent(marker: string, also: string): Lookup {
  if (!found.has(marker)) {
    let component: Lookup = null;
    try {
      component =
        (steamLookup.findExport((e: unknown) => {
          if (typeof e !== "function") return false;
          const source = Function.prototype.toString.call(e);
          return source.includes(marker) && source.includes(also);
        }) as Lookup | undefined) ?? null;
    } catch {
      component = null;
    }
    found.set(marker, component);
  }
  return found.get(marker) ?? null;
}

class IconBoundary extends Component<{ fallback: ReactNode; children: ReactNode }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function SteamIcon({
  marker,
  also,
  props,
  fallback,
}: {
  marker: string;
  also: string;
  props: Record<string, unknown>;
  fallback: ReactNode;
}) {
  const icon = steamComponent(marker, also);
  if (!icon) return fallback;
  return <IconBoundary fallback={fallback}>{createElement(icon, props)}</IconBoundary>;
}

/** The check Steam's "Play from…" menu marks the selected row with. */
export function SteamMenuCheck() {
  return (
    <SteamIcon
      marker="SVGIcon_DialogCheck"
      also="highlightColor"
      props={{}}
      fallback={<FaCheck aria-hidden />}
    />
  );
}

/** Steam's filled down triangle, as on its own Play button chevron. */
export function SteamChevronDown({ fallback }: { fallback: ReactNode }) {
  return (
    <SteamIcon
      marker="M17.98 26.54"
      also="direction"
      props={{ direction: "down", "aria-hidden": true }}
      fallback={fallback}
    />
  );
}
