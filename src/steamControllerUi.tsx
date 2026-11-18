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

/**
 * Steam's "Configure Controller" icon, copied from the game page's controller
 * button (DEVICE 2026-11-18). The Controller Layouts destination uses it so
 * WoWDeck's entry point matches the one players already know.
 */
export function ConfigureControllerIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
      <path
        fill="currentColor"
        d="M213.771,68.659c-4.108-7.066-46.007-7.231-49.293-7.231H128H91.522c-3.286,0-45.186,0.165-49.293,7.231 c-19.555,29.248-27.385,100.263-27.276,104.01c0.238,8.294,2.11,24.583,16.595,35.162c9.201,6.72,22.183,8.709,29.083,3.614 c4.989-3.682,11.995-19.224,19.061-32.204c7.064-12.981,9.202-11.174,12.98-12.159c3.78-0.986,36.066-0.74,36.066-0.74 s30.809-0.247,34.588,0.74c3.777,0.985,5.915-0.822,12.98,12.159c7.064,12.98,14.07,28.522,19.061,32.204 c6.9,5.095,19.882,3.106,29.083-3.614c14.485-10.58,16.356-26.868,16.595-35.162C241.154,168.922,233.325,97.906,213.771,68.659z M67.251,128.14c-14.974,0-27.112-12.137-27.112-27.111c0-14.975,12.137-27.112,27.112-27.112 c14.973,0,27.111,12.137,27.111,27.112C94.362,116.003,82.224,128.14,67.251,128.14z M188.749,128.14 c-14.974,0-27.111-12.137-27.111-27.111c0-14.975,12.138-27.112,27.111-27.112c14.973,0,27.111,12.137,27.111,27.112 C215.86,116.003,203.722,128.14,188.749,128.14z"
      />
    </svg>
  );
}

const ICONS = {
  downloaded:
    '<path d="M31.09 4.38L13 22.46L5.41 14.88L1.88 18.41L13 29.54L34.62 7.91L31.09 4.38Z" fill="currentColor"></path>',
  notDownloaded:
    '<path fill-rule="evenodd" clip-rule="evenodd" d="M29 23V27H7V23H2V32H34V23H29Z" fill="currentColor"></path><svg x="0" y="0" width="32" height="25"><path class="DownloadArrow" d="M20 14.1716L24.5858 9.58578L27.4142 12.4142L18 21.8284L8.58582 12.4142L11.4142 9.58578L16 14.1715V2H20V14.1716Z" fill="currentColor"></path></svg>',
  likes:
    '<path d="M13.1279 16.06L20.1616 2.48999L22.5621 3.74599C23.4622 4.21691 24.1493 5.01262 24.4842 5.97166C24.819 6.93069 24.7765 7.9812 24.3651 8.90999L21.1988 16.06H33.875L30.865 32.05H13L13.1279 16.06ZM9 16.05H3V32.05H9V16.05Z" fill="currentColor"></path>',
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
  GetPublishedFile(id: string): { file?: { vote_data?: { votes_up?: number } } } | undefined;
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

/** Workshop likes for the source item. Steam's playtime field has unverified units. */
export function useWorkshopLikes(publishedFileId: string | undefined): number | undefined {
  const [likes, setLikes] = useState<number>();
  useEffect(() => {
    const store = workshopStore();
    if (!store || !publishedFileId || !/^[0-9]+$/.test(publishedFileId)) return;
    let live = true;
    const read = () => {
      const file = store.GetPublishedFile(publishedFileId)?.file;
      if (!file) return false;
      setLikes(file.vote_data?.votes_up);
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
  return likes;
}
