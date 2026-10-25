/**
 * Manual Install's From a file: the pick → preview → install flow's state,
 * kept at module scope like the browse destinations (browseDestinations.ts)
 * and the WTF job state (wtfBackupState.ts).
 *
 * It must live outside the component: Steam's file picker is its own popup,
 * and opening it unmounts the whole plugin panel (guide G4) — the flow's
 * where-was-I has to survive that round trip, and the picker's answer and
 * the inspection that follows land after the remount. Actions take their
 * picker/RPC calls injected, so the machine stays a pure state machine
 * (tests drive it without either).
 */
import type { ArchivePreview, OperationResult } from "./types";
import { friendlyArchiveError } from "./archiveImportErrors";
import { errorText } from "./errors";
import { createStore } from "./store";

export type FileImportPhase =
  "idle" | "picking" | "inspecting" | "ready" | "installing" | "success" | "error";

export interface FileImportView {
  phase: FileImportPhase;
  /** The inspected archive between the pick and the Install press; the install pair with it. */
  preview: ArchivePreview | null;
  /** A sentence for phase "error"; null otherwise. */
  error: string | null;
}

const initial = (): FileImportView => ({ phase: "idle", preview: null, error: null });

export const fileImport = createStore<FileImportView>(initial());

/** Only the latest turn's answer applies, whatever remounts happened on the way. */
let turn = 0;

/**
 * One full pick: Steam's file picker, then the engine's inspection of what
 * it returned. A cancelled picker is nothing (back to idle, no error); a
 * file that cannot be inspected is the picker's honest answer, shown
 * inline from the envelope's stable code.
 */
export async function pickArchive(
  pick: () => Promise<{ path: string }>,
  inspect: (path: string) => Promise<{
    result: ArchivePreview | null;
    error: { code: string; message: string } | null;
  }>,
): Promise<void> {
  const id = ++turn;
  fileImport.set({ phase: "picking", preview: null, error: null });
  let path: string;
  try {
    ({ path } = await pick());
  } catch {
    if (id === turn) {
      fileImport.set(initial());
    }
    return;
  }
  if (id !== turn) {
    return;
  }
  fileImport.patch({ phase: "inspecting" });
  let inspected: Awaited<ReturnType<typeof inspect>>;
  try {
    inspected = await inspect(path);
  } catch (e) {
    if (id === turn) {
      fileImport.set({ phase: "error", preview: null, error: errorText(e) });
    }
    return;
  }
  if (id !== turn) {
    return;
  }
  if (inspected.error) {
    fileImport.set({ phase: "error", preview: null, error: friendlyArchiveError(inspected.error) });
    return;
  }
  fileImport.set({ phase: "ready", preview: inspected.result, error: null });
}

/**
 * The Install press on a preview: `addons.install` with the preview's
 * provider/path pair. Both error shapes the engine can answer with — a
 * failed operation (the pipeline caught it) and a thrown RPC error (the
 * provider refused the path, e.g. the file is gone since the preview) —
 * land in the same inline error state.
 */
export async function installArchive(
  install: (pair: { providerId: string; externalId: string }) => Promise<{
    operation: OperationResult;
  }>,
): Promise<void> {
  const { phase, preview } = fileImport.get();
  if (phase !== "ready" || !preview) {
    return;
  }
  const id = ++turn;
  fileImport.patch({ phase: "installing", error: null });
  let outcome: Awaited<ReturnType<typeof install>>;
  try {
    outcome = await install({
      providerId: preview.providerId,
      externalId: preview.externalId,
    });
  } catch (e) {
    if (id === turn) {
      fileImport.set({ phase: "error", preview, error: errorText(e) });
    }
    return;
  }
  if (id !== turn) {
    return;
  }
  const operation = outcome.operation;
  if (operation.status === "failed") {
    fileImport.set({
      phase: "error",
      preview,
      error: operation.error ?? "The install failed. Nothing was changed",
    });
    return;
  }
  fileImport.set({ phase: "success", preview, error: null });
}

/** Back to the start (another installation, or the pane's next Browse). */
export function resetFileImport(): void {
  turn++;
  fileImport.set(initial());
}
