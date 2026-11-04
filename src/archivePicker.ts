import { popupOpening } from "./browseSessionState";
import { pickArchive } from "./fileImportState";

/** Open Steam's archive picker without ending the browse session. */
export function browseArchive(
  openPicker: typeof import("@decky/api").openFilePicker,
  inspect: Parameters<typeof pickArchive>[1],
): Promise<void> {
  popupOpening();
  return pickArchive(
    () =>
      openPicker(
        0 /* FileSelectionType.FILE */,
        "/home/deck",
        true,
        true,
        undefined,
        ["zip", "rar", "7z"],
        false,
        false,
      ),
    inspect,
  );
}
