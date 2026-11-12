/**
 * Add WoW folder (spec #183): the one flow behind Options › WoW installations
 * and the first-run Find WoW widget. It opens the folder picker at once and
 * decides by the recognised installations the folder holds that are not
 * added yet.
 */

import type { rpc as backendRpc } from "./services/backend";
import type { GameType, Installation } from "./types";

/** What the Add installation modal opens with. */
export interface AddInstallationRequest {
  path: string;
  displayName: string;
  /** The detected game version; null when the folder isn't recognised. */
  gameType: GameType | null;
}

export interface AddWowFolderDeps {
  /** The picked folder, or null when the player backed out. */
  pickFolder: () => Promise<string | null>;
  rpc: typeof backendRpc;
  openModal: (request: AddInstallationRequest) => void;
  toast: (title: string, body?: string) => void;
  toastError: (title: string, e: unknown) => void;
  /** The installations added before this pick. */
  installations: Installation[];
  /** Reload the installation list and active installation after an add. */
  onAdded: () => Promise<void>;
}

export async function addWowFolder(deps: AddWowFolderDeps): Promise<void> {
  const path = await deps.pickFolder();
  if (path === null) {
    return;
  }
  const found = await inspect(deps, path);
  if (found.length === 0) {
    deps.openModal({ path, displayName: folderName(path), gameType: null });
    return;
  }
  // The decision counts the new installations, not all the folder holds.
  const fresh = found.filter((f) => !isAdded(f.gameType, path, deps.installations));
  if (fresh.length === 0) {
    deps.toast(`Already added: ${names(found)}`);
    return;
  }
  if (fresh.length === 1) {
    const [one] = fresh as [(typeof fresh)[0]];
    deps.openModal({ path, displayName: one.displayName, gameType: one.gameType });
    return;
  }
  let added: Installation[];
  try {
    ({ installations: added } = await deps.rpc("installations.add", { path }));
  } catch (e) {
    deps.toastError("Couldn't add installations", e);
    return;
  }
  // The engine answers with every installation the folder holds; the ones
  // already added stay as they were.
  const newOnes = newInstallations(added, deps.installations);
  if (fresh.length === found.length) {
    deps.toast(`Added ${newOnes.length} installations`, names(newOnes));
  } else {
    deps.toast(`Added ${names(newOnes)}`);
  }
  await deps.onAdded();
}

function newInstallations(added: Installation[], before: Installation[]): Installation[] {
  const known = new Set(before.map((i) => i.id));
  return added.filter((i) => !known.has(i.id));
}

const trimSlashes = (path: string) => path.replace(/\/+$/, "");

const names = (list: { displayName: string }[]) => list.map((i) => i.displayName).join(", ");

/**
 * Whether an installation of `gameType` in the picked folder is added
 * already: one of that version at the folder itself or below it. `inspect`
 * names no paths, so the version and place are what tell them apart.
 */
function isAdded(gameType: GameType, picked: string, installations: Installation[]): boolean {
  const root = trimSlashes(picked);
  return installations.some(
    (i) =>
      i.gameType === gameType &&
      (trimSlashes(i.path) === root || trimSlashes(i.path).startsWith(`${root}/`)),
  );
}

/** What the folder holds; an unreadable folder holds nothing recognised. */
async function inspect(deps: AddWowFolderDeps, path: string) {
  try {
    return (await deps.rpc("installations.inspect", { path })).found;
  } catch {
    return [];
  }
}

/** The last part of a path: the name an unrecognised folder is offered under. */
function folderName(path: string): string {
  return trimSlashes(path).split("/").pop() || path;
}

/** What the Add installation modal submits. */
export interface AddInstallationParams {
  path: string;
  displayName: string;
  clientType: GameType;
}

/**
 * The modal's Add. True when the installation was added and the modal may
 * close; on failure the error is toasted and the modal stays open.
 */
export async function addInstallation(
  deps: Pick<AddWowFolderDeps, "rpc" | "toast" | "toastError" | "onAdded" | "installations">,
  params: AddInstallationParams,
): Promise<boolean> {
  let added: Installation[];
  try {
    ({ installations: added } = await deps.rpc("installations.add", params));
  } catch (e) {
    deps.toastError("Couldn't add installation", e);
    return false;
  }
  // A parent folder answers with its other, already added installations too.
  deps.toast(`Added ${names(newInstallations(added, deps.installations)) || params.displayName}`);
  await deps.onAdded();
  return true;
}
