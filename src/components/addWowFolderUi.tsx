import { FileSelectionType, openFilePicker } from "@decky/api";
import { engine } from "../engineLink";
import { pluginToast, toastError } from "../toast";
import { rememberFocus, requestFocus } from "../focusMemory";
import { pickerStartPath } from "../pickerStart";
import type { Installation } from "../types";
import type { AddonSession } from "../addonSession";
import { addInstallation, addWowFolder, type AddWowFolderDeps } from "../addWowFolder";
import { openAddInstallationModal } from "./AddInstallationModal";

/**
 * Run Add WoW folder from the button at `view`/`key` with its real
 * collaborators: the Steam folder picker, the Add installation modal and
 * plugin toasts. The add itself goes through the addon session, which owns
 * the installation writes and reads the lists again. The picker and modal
 * unmount the panel (G4); focus memory brings the button back when the
 * player backs out (guide S21). `overrides` swap collaborators in tests.
 */
export function runAddWowFolder(
  view: string,
  key: string,
  installations: Installation[],
  session: Pick<AddonSession, "addInstallation">,
  overrides: Partial<AddWowFolderDeps> = {},
): Promise<void> {
  const deps: AddWowFolderDeps = {
    inspect: (path) => engine.rpc("installations.inspect", { path }).then((r) => r.found),
    add: (params) => session.addInstallation(params),
    toast: pluginToast,
    toastError,
    installations,
    pickFolder: async () => {
      rememberFocus(view, key);
      try {
        const picked = await openFilePicker(
          FileSelectionType.FOLDER,
          pickerStartPath(),
          false,
          true,
        );
        return picked.path;
      } catch {
        // Backed out of the picker.
        requestFocus(view, key);
        return null;
      }
    },
    openModal: (request) =>
      openAddInstallationModal(request, (params) => addInstallation(deps, params)),
    ...overrides,
  };
  return addWowFolder(deps);
}
