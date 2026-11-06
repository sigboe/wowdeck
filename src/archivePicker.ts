import { popupOpening } from "./browseSessionState";
import { requestFocus } from "./focusMemory";
import { pickArchive } from "./fileImportState";
import { pickerStartPath } from "./pickerStart";

/**
 * Open Steam's archive picker without ending the browse session. The
 * picker's popup unmounts the panel (G4) and the remount restores Browse…;
 * once the pick settles, focus in `view` moves to where the result asks
 * (fileImportFocusKey: Install after a preview, Browse… otherwise).
 * requestFocus keeps a row that has not rendered yet pending until it can
 * take focus.
 */
export function browseArchive(
  openPicker: typeof import("@decky/api").openFilePicker,
  inspect: Parameters<typeof pickArchive>[1],
  view: string,
): Promise<void> {
  popupOpening();
  return pickArchive(
    () =>
      openPicker(
        0 /* FileSelectionType.FILE */,
        pickerStartPath(),
        true,
        true,
        undefined,
        ["zip", "rar", "7z"],
        false,
        false,
      ),
    inspect,
    (key) => requestFocus(view, key),
  );
}
