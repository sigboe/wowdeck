import * as DeckyUi from "@decky/ui";
import { useEffect, useState, type ReactNode } from "react";
import { FaGamepad } from "react-icons/fa";

/**
 * Steam's own pieces of the "Load new Layout" community list (DEVICE
 * 2026-11-17, Steam UI modules 70456, 69385 and 63272): its row classes, its
 * ControllerType glyph and its workshop store. Each lookup is guarded; a
 * missing piece falls back and never throws into the pane.
 */

type RowClasses = Record<
  | "ConfigurationButton"
  | "IconContainer"
  | "TextRows"
  | "TextRow"
  | "Author"
  | "Stretch"
  | "InfoSection"
  | "ConfigTitleRow"
  | "Title"
  | "Description",
  string
>;

let rowClasses: RowClasses | null | undefined;
/** Steam's community-layout row classes, or null when this Steam has none. */
export function layoutRowClasses(): RowClasses | null {
  if (rowClasses === undefined) {
    try {
      rowClasses =
        (DeckyUi.findClassModule?.(
          (m: Record<string, unknown>) =>
            !!m.ConfigurationButton && !!m.InfoSection && !!m.IconContainer,
        ) as RowClasses | undefined) ?? null;
    } catch {
      rowClasses = null;
    }
  }
  return rowClasses;
}

type GlyphComponent = (props: { controllerType: number; controllerStyle?: number }) => ReactNode;
let glyph: GlyphComponent | null | undefined;
function steamGlyph(): GlyphComponent | null {
  if (glyph === undefined) {
    try {
      glyph =
        (DeckyUi.findModuleChild?.((m: Record<string, unknown>) =>
          typeof m?.ControllerType === "function" && typeof m?.Caution === "function"
            ? m.ControllerType
            : undefined,
        ) as GlyphComponent | undefined) ?? null;
    } catch {
      glyph = null;
    }
  }
  return glyph;
}

/** Steam's EControllerType numbers for configset names (Steam's own string table). */
const CONTROLLER_TYPES: Record<string, number> = {
  controller_steamcontroller_gordon: 2,
  controller_gordon: 2,
  controller_steamcontroller_neptune: 4,
  controller_neptune: 4,
  controller_steamcontroller_triton: 10,
  controller_triton: 10,
  controller_xbox360: 31,
  controller_xboxone: 32,
  controller_ps3: 33,
  controller_ps4: 34,
  controller_switch_pro: 38,
  controller_ps5: 45,
};
export const STEAM_CONTROLLER_TYPE = 2;
export function controllerTypeNumber(name: string): number {
  return CONTROLLER_TYPES[name] ?? 1;
}

/** Steam's glyph for a controller type; the original Steam Controller is type 2. */
export function ControllerGlyph({ type }: { type: number }) {
  const Glyph = steamGlyph();
  if (!Glyph) return <FaGamepad />;
  try {
    return <Glyph controllerType={type} />;
  } catch {
    return <FaGamepad />;
  }
}

const ICONS = {
  downloaded:
    '<path d="M31.09 4.38L13 22.46L5.41 14.88L1.88 18.41L13 29.54L34.62 7.91L31.09 4.38Z" fill="currentColor"></path>',
  notDownloaded:
    '<path fill-rule="evenodd" clip-rule="evenodd" d="M29 23V27H7V23H2V32H34V23H29Z" fill="currentColor"></path><svg x="0" y="0" width="32" height="25"><path class="DownloadArrow" d="M20 14.1716L24.5858 9.58578L27.4142 12.4142L18 21.8284L8.58582 12.4142L11.4142 9.58578L16 14.1715V2H20V14.1716Z" fill="currentColor"></path></svg>',
  likes:
    '<path d="M13.1279 16.06L20.1616 2.48999L22.5621 3.74599C23.4622 4.21691 24.1493 5.01262 24.4842 5.97166C24.819 6.93069 24.7765 7.9812 24.3651 8.90999L21.1988 16.06H33.875L30.865 32.05H13L13.1279 16.06ZM9 16.05H3V32.05H9V16.05Z" fill="currentColor"></path>',
  hours:
    '<path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" d="M18 33C26.2843 33 33 26.2843 33 18C33 9.71573 26.2843 3 18 3C9.71573 3 3 9.71573 3 18C3 26.2843 9.71573 33 18 33ZM20.2092 10.9908H14.8092V19.3092L21 25.5L24.8184 21.6816L20.2092 17.0724V10.9908Z"></path>',
} as const;
/** Steam's info-line icons, copied from its community-layout row. */
export function InfoIcon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 36 36"
      fill="none"
      dangerouslySetInnerHTML={{ __html: ICONS[name] }}
    />
  );
}

interface WorkshopStore {
  LoadPublishedFiles(ids: string[]): Promise<void>;
  GetPublishedFile(
    id: string,
  ): { file?: { vote_data?: { votes_up?: number }; lifetime_playtime?: string } } | undefined;
}
let workshop: WorkshopStore | null | undefined;
function workshopStore(): WorkshopStore | null {
  if (workshop === undefined) {
    try {
      workshop =
        (DeckyUi.findModuleChild?.((m: Record<string, unknown>) => {
          for (const value of Object.values(m ?? {})) {
            const store = value as Partial<WorkshopStore> | null;
            if (
              store &&
              typeof store.LoadPublishedFiles === "function" &&
              typeof store.GetPublishedFile === "function"
            )
              return store;
          }
          return undefined;
        }) as WorkshopStore | undefined) ?? null;
    } catch {
      workshop = null;
    }
  }
  return workshop;
}

export interface WorkshopStats {
  likes?: number;
  /** INFERRED: lifetime_playtime is seconds; Steam showed "0" for a new item. */
  hours?: number;
}
/** Likes and collective playtime from Steam's own workshop store, signed in as the player. */
export function useWorkshopStats(publishedFileId: string | undefined): WorkshopStats | null {
  const [stats, setStats] = useState<WorkshopStats | null>(null);
  useEffect(() => {
    const store = workshopStore();
    if (!store || !publishedFileId || !/^[0-9]+$/.test(publishedFileId)) return;
    let live = true;
    const read = () => {
      const file = store.GetPublishedFile(publishedFileId)?.file;
      if (!file) return false;
      const seconds = Number(file.lifetime_playtime);
      setStats({
        likes: file.vote_data?.votes_up,
        hours: Number.isFinite(seconds) ? Math.round(seconds / 3600) : undefined,
      });
      return true;
    };
    if (!read())
      store
        .LoadPublishedFiles([publishedFileId])
        .then(() => live && read())
        .catch(() => {});
    return () => {
      live = false;
    };
  }, [publishedFileId]);
  return stats;
}
