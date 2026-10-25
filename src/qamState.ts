/**
 * Quick Access Menu panel state that must outlive the panel component: the
 * panel unmounts whenever a modal, a dropdown menu or the file picker opens
 * (guide G4). Reset only by a plugin reload.
 */

export type QamTab = "installed" | "browse" | "settings";

export const QAM_TABS: QamTab[] = ["installed", "browse", "settings"];

export const qamState: { tab: QamTab } = { tab: "installed" };

/** Focus-memory view names (focusMemory.ts), one per QAM tab. */
export const QAM_VIEW: Record<QamTab, string> = {
  installed: "qam.installed",
  browse: "qam.browse",
  settings: "qam.settings",
};
