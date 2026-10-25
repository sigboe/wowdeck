/**
 * Wording for the Folders dialog (WF-20). Pure so it can be unit-tested;
 * tested in addonFolders.test.ts.
 */

import type { AddonFolders } from "./types";

/**
 * The Show row: named after the running file manager ("Show in Dolphin").
 * With none running it stays, muted and generic, its description saying
 * what it needs, so whoever wants it knows what to look for.
 */
export function showRow(fileManager: AddonFolders["fileManager"]): {
  label: string;
  muted: boolean;
  description: string;
} {
  if (fileManager.running) {
    return {
      label: `Show in ${fileManager.name ?? "file manager"}`,
      muted: false,
      description: "Opens this addon's folders in your running file manager.",
    };
  }
  return {
    label: "Show in file manager",
    muted: true,
    description:
      "Requires a file manager that is already running. Tip: You can launch one, such as Dolphin, as a non-Steam game or in a nested desktop session.",
  };
}

/** Toast when Show found no file manager listening (none open, or it closed since). */
export const NO_FILE_MANAGER_HINT = {
  title: "No file manager found",
  body: "Launch a file manager, such as Dolphin, as a non-Steam game or in a nested desktop session, then try again.",
};
