/**
 * Manual Install's From a file: the pick → preview → install flow's state,
 * kept at module scope like the browse destinations (browseDestinations.ts)
 * and the WTF job state (wtfLifecycle.ts).
 *
 * It must live outside the component: Steam's file picker is its own popup,
 * and opening it unmounts the whole plugin panel (guide G4) — the flow's
 * where-was-I has to survive that round trip, and the picker's answer and
 * the inspection that follows land after the remount. Actions take their
 * picker/RPC calls injected, so the machine stays a pure state machine
 * (tests drive it without either).
 */
import type { ArchivePreview, OperationResult } from "./types";
import { providerLabel } from "./addonRow";
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

/** The file flow's focus-memory keys (FocusSlot ids in the pane). */
export const FILE_FOCUS = {
  browse: "file:browse",
  install: "file:install",
  /** Remove on a conflict card's row (#130), one per conflicting addon. */
  conflictRemove: (addonId: string) => `file:conflict:${addonId}:remove`,
} as const;

/**
 * Where focus belongs once a pick (or a conflict card's re-check) has
 * settled into `view` (spec #131 stories 23-25): the preview card's
 * Install, so A installs; on a conflict card, where Install is disabled,
 * the first row's Remove. Everything else (a cancelled pick, a failed
 * inspection) stays on Browse….
 */
export function fileImportFocusKey(view: FileImportView): string {
  if (view.phase !== "ready" || !view.preview) {
    return FILE_FOCUS.browse;
  }
  const { match } = view.preview;
  return match.kind === "conflict" && match.records[0]
    ? FILE_FOCUS.conflictRemove(match.records[0].addonId)
    : FILE_FOCUS.install;
}

/** Install can't succeed on a conflict card: the engine refuses it too. */
export function installBlocked(preview: ArchivePreview): boolean {
  return preview.match.kind === "conflict";
}

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
  focus: (key: string) => void = () => {},
): Promise<void> {
  const id = ++turn;
  const settle = settler(focus);
  fileImport.set({ phase: "picking", preview: null, error: null });
  let path: string;
  try {
    ({ path } = await pick());
  } catch {
    if (id === turn) {
      settle(initial());
    }
    return;
  }
  if (id !== turn) {
    return;
  }
  fileImport.patch({ phase: "inspecting" });
  await inspectInto(id, path, inspect, settle);
}

type Inspect = Parameters<typeof pickArchive>[1];

/**
 * The focus key the last settled turn still owes the pane, until
 * takeOwedFocus reads it. The settle asks for focus at once, before the
 * card has rendered its answer; the pane asks again after that render
 * (FileImportSection), when Install is enabled and a conflict's rows are
 * gone (#132: after a confirmed Remove, the first ask alone left nothing
 * focused on the device).
 */
let owedFocus: string | null = null;

/** The focus the last settled turn owes, once; null when it was taken already. */
export function takeOwedFocus(): string | null {
  const key = owedFocus;
  owedFocus = null;
  return key;
}

/** A turn's last state, and the focus that goes with it. */
function settler(focus: (key: string) => void): (view: FileImportView) => void {
  return (view) => {
    const key = fileImportFocusKey(view);
    owedFocus = key;
    fileImport.set(view);
    focus(key);
  };
}

/** Inspect `path` for turn `id` and settle its answer (a superseded turn's is dropped). */
async function inspectInto(
  id: number,
  path: string,
  inspect: Inspect,
  settle: (view: FileImportView) => void,
): Promise<void> {
  let inspected: Awaited<ReturnType<Inspect>>;
  try {
    inspected = await inspect(path);
  } catch (e) {
    if (id === turn) {
      settle({ phase: "error", preview: null, error: errorText(e) });
    }
    return;
  }
  if (id !== turn) {
    return;
  }
  if (inspected.error) {
    settle({ phase: "error", preview: null, error: friendlyArchiveError(inspected.error) });
    return;
  }
  settle({ phase: "ready", preview: inspected.result, error: null });
}

/**
 * Remove on a conflict card's row (#130), once the user confirmed it:
 * `remove` is the normal Remove flow (its toast included), then the same
 * file is inspected again. With one match left the card becomes "Updates
 * <name>" and focus moves to Install; a removal that failed or changed
 * nothing leaves the conflict card, focus on its first Remove. A `remove`
 * that rejects rejects this too, after the re-check.
 */
export async function removeConflicting(
  remove: () => Promise<void>,
  inspect: Inspect,
  focus: (key: string) => void = () => {},
): Promise<void> {
  const { phase, preview } = fileImport.get();
  if (phase !== "ready" || !preview || !installBlocked(preview)) {
    return;
  }
  const id = ++turn;
  // The card stays while the addon goes and the file is checked again,
  // its buttons disabled.
  fileImport.set({ phase: "inspecting", preview, error: null });
  // A rejected remove may or may not have removed the addon: the file is
  // checked again either way, so the card never stays disabled, and the
  // error goes on to the caller to report.
  let failure: { error: unknown } | null = null;
  try {
    await remove();
  } catch (error) {
    failure = { error };
  }
  if (id === turn) {
    await inspectInto(id, preview.externalId, inspect, settler(focus));
  }
  if (failure) {
    throw failure.error;
  }
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
  canInstall: () => boolean,
): Promise<void> {
  const { phase, preview } = fileImport.get();
  if (phase !== "ready" || !preview) {
    return;
  }
  if (installBlocked(preview) || !canInstall()) {
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

/**
 * The preview card's Install button: what pressing it does to the installed
 * addons (the engine's match rule, `ArchivePreview.match`).
 */
export function installLabel(preview: ArchivePreview): string {
  switch (preview.match.kind) {
    case "update":
      return `Updates ${preview.match.name}`;
    case "reinstall":
      return "Reinstall";
    default:
      return "Install";
  }
}

/** The card's line once Install succeeded: an update names the addon it updated. */
export function installedLabel(preview: ArchivePreview): string {
  const { match } = preview;
  return match.kind === "update" || match.kind === "takeover"
    ? `Updated ${match.name}`
    : "Installed";
}

/**
 * The preview card's warning before Install (ticket #129, guide S38): a
 * file that updates an addon from a catalogue switches its source, so it
 * stops getting updates from there. Install stays enabled; this only says so.
 */
export function takeoverWarning(
  preview: ArchivePreview,
): { heading: string; detail: string } | null {
  const { match } = preview;
  if (match.kind !== "takeover") {
    return null;
  }
  const source = providerLabel(match.providerId);
  return {
    heading: `This replaces ${match.name} from ${source}`,
    detail: `${match.name} will stop updating from ${source}`,
  };
}

/** The folder list under a conflict row: three names, then "+n more". */
const SHOWN_FOLDERS = 3;

/**
 * The conflict card's words (ticket #130, guide S38): what is happening,
 * how to resolve it, and a row per conflicting addon with the folders it
 * shares with the file. Null for any other preview.
 */
export function conflictWarning(preview: ArchivePreview): {
  heading: string;
  detail: string;
  rows: { addonId: string; name: string; uses: string }[];
} | null {
  const { match } = preview;
  if (match.kind !== "conflict") {
    return null;
  }
  const count = match.records.length;
  return {
    heading: `This file matches ${count} installed addons`,
    detail:
      count === 2
        ? "Remove one, and the file will update the other"
        : "Remove all but one, and the file will update the one left",
    rows: match.records.map(({ addonId, name, folders }) => {
      const hidden = folders.length - SHOWN_FOLDERS;
      const shown = folders.slice(0, SHOWN_FOLDERS).join(", ");
      return { addonId, name, uses: `Uses ${shown}${hidden > 0 ? ` +${hidden} more` : ""}` };
    }),
  };
}

/** Back to the start (another installation, or the pane's next Browse). */
export function resetFileImport(): void {
  turn++;
  owedFocus = null;
  fileImport.set(initial());
}
