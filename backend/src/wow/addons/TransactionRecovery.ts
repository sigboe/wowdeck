/**
 * Retry recovery's plan (ADR 0006, #108): from a stopped addon
 * transaction's marker and what is on disk now, work out how to put the
 * original arrangement back, or why that isn't safe. Read-only: it never
 * moves, writes, deletes or creates anything (RecoveryActions carries the
 * plan out).
 *
 * A transaction runs its planned moves in order and an undo runs them back
 * newest first, stopping at the first that fails. So what a stopped
 * transaction leaves is the first `p` moves done and the rest not. The plan
 * finds that `p` from what exists where (a model of every place the moves
 * touch, after 0..n moves), then checks content: every place the marker
 * holds evidence for must, once the done moves are run back, hold exactly
 * the bytes it held before the transaction (folderEvidence, with the parts
 * that moved elsewhere mounted back in place). A path, a folder's identity
 * or a TOC version can't show that; the digest can.
 *
 * Anything else refuses: a game folder or AddOns folder that is missing or
 * not the one the transaction began in (never recreated), a link or another
 * drive anywhere on the way, a place that holds something the model doesn't
 * expect, changed bytes, or a marker this build can't read.
 *
 * Verify recovery's check (`checkRepair`, #109) shares the marker and root
 * checks but asks a narrower question: after a manual repair, is every
 * place outside the work folder back to exactly what its evidence says?
 */

import { dirname, join } from "node:path";
import type { WowInstallation } from "../models";
import type { StageFs } from "../fs/StageFs";
import { getAddonsPath } from "../installation/InstallationDetector";
import { markerOwner } from "./AddonRecords";
import { folderEvidence, sameEvidence, type FolderEvidence } from "./FolderEvidence";
import { deviceOf, identity, isDir, isPlainDir, pathPresent, placeProblem, shown, within } from "./folderChecks";
import { STAGING_DIR_NAME } from "./RollbackCache";
import { isUnreadableState, readMarker, type AddonTransactionMarker, type PlannedMove } from "./TransactionMarker";

export interface RecoveryConflict {
  /** AddOns-relative display text ("AddOns/Suite"). */
  location: string;
  reason: string;
}

/** Why a retry isn't safe, and what the player can do. */
export interface RecoveryRefusal {
  reason: string;
  nextStep: string;
  conflicts: RecoveryConflict[];
}

export type RestorePlan =
  | {
      ok: true;
      marker: AddonTransactionMarker;
      addonsPath: string;
      /** The renames that put the original arrangement back, in order (absolute paths). */
      undo: { from: string; to: string }[];
    }
  | ({ ok: false } & RecoveryRefusal);

const CHANGED_NEXT_STEP =
  "Put the files listed here back as they were, then try again. WoWDeck Addon Manager doesn't overwrite or delete files it didn't expect";

/** Why nothing can be recovered while the state file can't be read, and what the player does. */
export const UNREADABLE_STATE_FILE = {
  reason: "WoWDeck Addon Manager can't read its saved state file, so it can't tell what to put back",
  nextStep:
    "Repair or restore state.json in the plugin's data folder, then restart Steam. Until then the file is kept as it is, addon changes stay paused in every installation, and settings changes aren't saved",
} as const;

/**
 * Why Retry recovery can't even be planned for this stored marker (it can't
 * be read, or it names no installation), or null when it can be.
 */
export function retryUnavailable(stored: unknown): RecoveryRefusal | null {
  if (isUnreadableState(stored)) {
    return { ...UNREADABLE_STATE_FILE, conflicts: [] };
  }
  if (readMarker(stored)) {
    return null;
  }
  return {
    reason:
      markerOwner(stored) !== undefined
        ? "WoWDeck Addon Manager can't read the recovery information this addon change left"
        : "An addon change left recovery information that doesn't say which installation it belongs to",
    nextStep:
      "Put the original files kept under AddOns/.wowdeck back by hand. Without readable recovery information, WoWDeck Addon Manager can't check or put them back itself",
    conflicts: [],
  };
}

/** Work out the restoration of `stored` in `installation`, touching nothing. */
export async function planRestore(fs: StageFs, installation: WowInstallation, stored: unknown): Promise<RestorePlan> {
  const unavailable = retryUnavailable(stored);
  if (unavailable) {
    return { ok: false, ...unavailable };
  }
  const marker = stored as AddonTransactionMarker;
  const refuse = (reason: string, nextStep: string, conflicts: RecoveryConflict[] = []): RestorePlan => ({
    ok: false,
    reason,
    nextStep,
    conflicts,
  });
  const root = checkRoot(installation, marker);
  if (!root.ok) {
    return root;
  }
  const { addonsPath, addonsDev } = root;
  const abs = (rel: string) => join(addonsPath, ...rel.split("/"));

  // Which prefix of the moves is done: the one model that agrees with disk.
  const models = [initialModel(marker)];
  for (const move of marker.moves) {
    models.push(applyMove(models.at(-1)!, move));
  }
  const universe = new Set(models.flatMap((m) => [...m.keys()]));
  const real = new Map([...universe].map((rel) => [rel, pathPresent(abs(rel))]));
  const mismatches = models.map((model) =>
    [...universe].flatMap((rel): RecoveryConflict[] => {
      const want = expected(model, rel);
      if (want === undefined || want === real.get(rel)) {
        return [];
      }
      return [{ location: shown(rel), reason: want ? "Is missing." : "Wasn't expected here. Something else put it there." }];
    }),
  );
  const matching = mismatches.flatMap((m, p) => (m.length === 0 ? [p] : []));
  if (matching.length !== 1) {
    const closest = mismatches.reduce((best, m) => (m.length < best.length ? m : best));
    return refuse("Folders were moved or added since the addon change stopped", CHANGED_NEXT_STEP, closest);
  }
  const p = matching[0]!;
  const now = models[p]!;

  // Links and other drives anywhere a move reaches.
  const conflicts: RecoveryConflict[] = [];
  const seen = new Set<string>();
  for (const rel of universe) {
    const parts = rel.split("/");
    for (let i = 1; i <= parts.length; i++) {
      const at = parts.slice(0, i).join("/");
      if (seen.has(at)) {
        continue;
      }
      seen.add(at);
      const problem = placeProblem(abs(at), addonsDev);
      if (problem) {
        conflicts.push({ location: shown(at), reason: problem });
      }
    }
  }
  if (conflicts.length) {
    return refuse("Something in the way isn't a plain folder on this drive", CHANGED_NEXT_STEP, conflicts);
  }

  // Content: each place with evidence, as it will be once the done moves are run back.
  const back = (rel: string) => {
    let at = rel;
    for (let j = p - 1; j >= 0; j--) {
      const move = marker.moves[j]!;
      if (within(at, move.to)) {
        at = move.from + at.slice(move.to.length);
      }
    }
    return at;
  };
  const present = [...now].filter(([, v]) => v).map(([rel]) => rel);
  for (const [place, recorded] of Object.entries(marker.evidence)) {
    if (recorded.kind === "absent") {
      continue; // the model already holds it absent, or the content now there belongs elsewhere
    }
    const base = present.find((c) => back(c) === place);
    if (!base) {
      conflicts.push({ location: shown(place), reason: "Is missing." });
      continue;
    }
    const parts = present
      .filter((c) => c !== base && within(back(c), place) && back(c) !== place)
      .map((c) => ({ cur: c, orig: back(c) }));
    const mounts: Record<string, string> = {};
    for (const part of parts) {
      const inPlace = [{ cur: base, orig: place }, ...parts].some(
        (outer) => outer !== part && within(part.cur, outer.cur) && part.orig === outer.orig + part.cur.slice(outer.cur.length),
      );
      if (!inPlace) {
        mounts[part.orig.slice(place.length + 1)] = abs(part.cur);
      }
    }
    let found: FolderEvidence | null = null;
    try {
      found = await folderEvidence(fs, abs(base), mounts);
    } catch {
      found = null;
    }
    if (!found || !sameEvidence(recorded, found)) {
      conflicts.push({
        location: shown(base),
        reason:
          base === place
            ? "Its files changed since the addon change stopped."
            : `Its files changed since the addon change stopped. They belong at ${shown(place)}.`,
      });
    }
  }
  if (conflicts.length) {
    return refuse("Files changed since the addon change stopped", CHANGED_NEXT_STEP, conflicts);
  }

  const undo: { from: string; to: string }[] = [];
  for (let j = p - 1; j >= 0; j--) {
    const move = marker.moves[j]!;
    undo.push({ from: abs(move.to), to: abs(move.from) });
  }
  return { ok: true, marker, addonsPath, undo };
}

/**
 * The installation the marker began in, as it is now: its own, with the
 * same game folder and AddOns folder (never recreated), or why not.
 */
function checkRoot(
  installation: WowInstallation,
  marker: AddonTransactionMarker,
): { ok: true; addonsPath: string; addonsDev: bigint } | ({ ok: false } & RecoveryRefusal) {
  const refuse = (reason: string, nextStep: string, conflicts: RecoveryConflict[] = []) => ({
    ok: false as const,
    reason,
    nextStep,
    conflicts,
  });
  if (marker.installationId !== installation.id) {
    return refuse("This addon change belongs to another installation", "Open recovery from that installation");
  }
  // The game folder must be the one the transaction began in; it is never recreated.
  if (!isDir(installation.location)) {
    return refuse(
      `${installation.displayName}'s game folder isn't available`,
      "Insert the SD card or connect the drive it's on, then try again. WoWDeck Addon Manager never recreates a missing game folder",
      [{ location: "Game folder", reason: "Isn't available. Is the SD card inserted?" }],
    );
  }
  const addonsPath = getAddonsPath(installation);
  if (
    identity(installation.location) !== marker.root.locationId ||
    addonsPath !== marker.root.addonsPath ||
    !isPlainDir(addonsPath) ||
    identity(addonsPath) !== marker.root.addonsId
  ) {
    return refuse(
      "This isn't the game folder the addon change started in",
      "Connect the original drive or put the original game folder back, then try again",
      [{ location: "Game folder", reason: "Isn't the folder this addon change started in." }],
    );
  }
  return { ok: true, addonsPath, addonsDev: deviceOf(addonsPath) };
}

export type RepairCheck = { ok: true; marker: AddonTransactionMarker; addonsPath: string } | ({ ok: false } & RecoveryRefusal);

const REPAIR_NEXT_STEP =
  "Put the original files back where they belong and move out what wasn't there before, then verify again. WoWDeck Addon Manager doesn't change files to make them match";

/**
 * Verify recovery's check (#109): whether a manual repair put the original
 * arrangement of `stored` back in `installation`. Every place the marker
 * holds evidence for outside its own work folder must hold exactly the
 * bytes it held before the transaction, and every place that was absent
 * must be absent again; the work folder is the plugin's own and doesn't
 * count. Read-only, and the evidence is only compared, never updated.
 */
export async function checkRepair(fs: StageFs, installation: WowInstallation, stored: unknown): Promise<RepairCheck> {
  const unavailable = retryUnavailable(stored);
  if (unavailable) {
    return { ok: false, ...unavailable };
  }
  const marker = stored as AddonTransactionMarker;
  const root = checkRoot(installation, marker);
  if (!root.ok) {
    return root;
  }
  const { addonsPath, addonsDev } = root;
  const abs = (rel: string) => join(addonsPath, ...rel.split("/"));
  const places = Object.entries(marker.evidence).filter(([rel]) => !within(rel, marker.workDir));

  const conflicts: RecoveryConflict[] = [];
  const seen = new Set<string>();
  for (const [rel] of places) {
    const parts = rel.split("/");
    for (let i = 1; i <= parts.length; i++) {
      const at = parts.slice(0, i).join("/");
      if (seen.has(at)) {
        continue;
      }
      seen.add(at);
      const problem = placeProblem(abs(at), addonsDev);
      if (problem) {
        conflicts.push({ location: shown(at), reason: problem });
      }
    }
  }
  if (conflicts.length) {
    return { ok: false, reason: "Something in the way isn't a plain folder on this drive", nextStep: REPAIR_NEXT_STEP, conflicts };
  }

  for (const [rel, recorded] of places) {
    let found: FolderEvidence | null = null;
    try {
      found = await folderEvidence(fs, abs(rel));
    } catch {
      found = null;
    }
    const reason = !found
      ? "Couldn't be read."
      : recorded.kind === "absent"
        ? found.kind === "absent"
          ? null
          : "Wasn't there before this addon change. Move it out of AddOns."
        : found.kind === "absent"
          ? "Is missing. The original files belong here."
          : sameEvidence(recorded, found)
            ? null
            : "Its files differ from the original.";
    if (reason) {
      conflicts.push({ location: shown(rel), reason });
    }
  }
  if (conflicts.length) {
    return { ok: false, reason: "The original files aren't all back yet", nextStep: REPAIR_NEXT_STEP, conflicts };
  }
  return { ok: true, marker, addonsPath };
}

/**
 * What is where before the first move, for every place the moves touch:
 * true present, false absent. The plugin folder, the work folder and its
 * stage and backup folders exist (the transaction made them); every place
 * a move fills inside the work folder starts empty; every place with
 * evidence is as the evidence says.
 */
function initialModel(marker: AddonTransactionMarker): Map<string, boolean> {
  const model = new Map<string, boolean>([
    [STAGING_DIR_NAME, true],
    [marker.workDir, true],
    [`${marker.workDir}/stage`, true],
    [`${marker.workDir}/backup`, true],
  ]);
  for (const [rel, e] of Object.entries(marker.evidence)) {
    model.set(rel, e.kind === "folder");
  }
  for (const move of marker.moves) {
    if (within(move.to, marker.workDir) && !model.has(move.to)) {
      model.set(move.to, false);
    }
  }
  return model;
}

/** The model after one rename: what was under `from` is under `to`, `from` is gone. */
function applyMove(model: Map<string, boolean>, move: PlannedMove): Map<string, boolean> {
  const next = new Map<string, boolean>();
  for (const [rel, present] of model) {
    if (within(rel, move.to)) {
      continue;
    }
    next.set(within(rel, move.from) ? move.to + rel.slice(move.from.length) : rel, present);
  }
  next.set(move.from, false);
  next.set(move.to, true);
  return next;
}

/** Whether the model says `rel` exists; undefined when it can't say (inside a folder it doesn't list). */
function expected(model: Map<string, boolean>, rel: string): boolean | undefined {
  if (model.has(rel)) {
    return model.get(rel);
  }
  for (let at = parentOf(rel); at !== null; at = parentOf(at)) {
    if (model.has(at)) {
      return model.get(at) ? undefined : false;
    }
  }
  return undefined;
}

function parentOf(rel: string): string | null {
  const parent = dirname(rel);
  return parent === "." ? null : parent;
}
