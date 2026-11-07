import { holdBrowseSessionForModal, popupOpening } from "./browseSessionState";
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
 *
 * The picker also holds the session until it settles: closing a menu inside
 * it (the sort order) shows the QAM and hides it again 9 ms later, which
 * clears popupOpening's mark, so that hide would end the session and
 * collapse the pane the result lands in (DEVICE 2026-11-07).
 */
export function browseArchive(
  openPicker: typeof import("@decky/api").openFilePicker,
  inspect: Parameters<typeof pickArchive>[1],
  view: string,
): Promise<void> {
  popupOpening();
  return pickArchive(
    async () => {
      const release = holdBrowseSessionForModal();
      try {
        return await openPicker(
          0 /* FileSelectionType.FILE */,
          pickerStartPath(),
          true,
          true,
          undefined,
          ["zip", "rar", "7z"],
          false,
          false,
        );
      } finally {
        release();
      }
    },
    inspect,
    (key) => requestFocus(view, key),
  );
}
