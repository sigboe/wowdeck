import { FileSelectionType, openFilePicker } from "@decky/api";
import type { TradeSkillMasterLedger } from "../backend/src/api/contracts";
import { holdBrowseSessionForModal, popupOpening } from "./browseSessionState";
import { engine } from "./engineLink";
import { pickerStartPath } from "./pickerStart";
import { createStore } from "./store";
import { pluginToast, toastError } from "./toast";

/**
 * Whether an export is running. Module scope (P6): the folder picker
 * unmounts the panel (G4), and the Export button shows the export it
 * started when the panel comes back.
 */
export const ledgerExport = createStore({ exporting: false });

/** A press while the picker or an export is still open does nothing. */
let running = false;

export function resetLedgerExport(): void {
  running = false;
  ledgerExport.set({ exporting: false });
}

/**
 * Export the shown account's records for the shown realm (or every realm):
 * Decky's folder picker starts where the engine says (the last export's
 * folder, else ~/Documents), the engine writes the ZIP there, and a toast
 * says where it went or why it failed. Character and Period don't apply.
 * `pickerClosed` runs once the picker is gone, to put focus back on Export
 * (S36). A cancelled picker exports nothing.
 */
export async function exportLedger(
  installationId: string,
  ledger: Pick<TradeSkillMasterLedger, "account" | "realm">,
  pickerClosed: () => void,
): Promise<void> {
  const account = ledger.account;
  if (account === null || running) {
    return;
  }
  running = true;
  try {
    await pickAndExport(installationId, account, ledger.realm, pickerClosed);
  } finally {
    running = false;
  }
}

async function pickAndExport(
  installationId: string,
  account: string,
  realm: string | null,
  pickerClosed: () => void,
): Promise<void> {
  let folder: string;
  const release = holdBrowseSessionForModal();
  try {
    let start: string;
    try {
      ({ folder: start } = await engine.rpc("tradeskillmaster.ledgerExportFolder", {}));
    } catch (e) {
      // The picker still opens, where every picker starts.
      console.warn("wowdeck: couldn't get Export's start folder", e);
      start = pickerStartPath();
    }
    popupOpening();
    try {
      ({ path: folder } = await openFilePicker(FileSelectionType.FOLDER, start, false, true));
    } catch {
      return; // cancelled
    }
  } finally {
    release();
    pickerClosed();
  }
  ledgerExport.set({ exporting: true });
  try {
    const { path } = await engine.rpc("tradeskillmaster.ledgerExport", {
      installationId,
      account,
      ...(realm !== null ? { realm } : {}),
      folder,
    });
    pluginToast("Exported TradeSkillMaster records", `Saved to ${path}`);
  } catch (e) {
    toastError("Couldn't export TradeSkillMaster records", e);
  } finally {
    ledgerExport.set({ exporting: false });
  }
}
