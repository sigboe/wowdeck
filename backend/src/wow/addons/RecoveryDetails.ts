/**
 * Recovery details (ADR 0006, #107): what a recovery-required
 * installation's stopped addon transactions left, pre-digested for the
 * shared details view so the frontend never reads the move ledger or
 * touches paths. Read-only: it looks at what is where (lstat), never
 * repairs, creates or reads file contents. Whether a found folder still
 * matches its evidence is Verify recovery's question (#109), not this one.
 *
 * Where a folder's original copy is now follows from the marker's planned
 * moves: a folder moved aside (`Suite` → `tx-…/backup/Suite`) and maybe on
 * with its parent (`tx-…/backup` → `rollback/<id>`). An undo runs those
 * renames back and stops at the first that fails, so the copy sits at
 * exactly one place on that chain: the last one that exists.
 */

import { join } from "node:path";
import type { InstallationRecoveryDetails, RecoveryOperationDetails } from "../../api/contracts";
import type { WowInstallation } from "../models";
import { getAddonsPath } from "../installation/InstallationDetector";
import { markerId } from "./AddonRecords";
import { identity, isDir, pathPresent, shown, within } from "./folderChecks";
import { addonName, readMarker } from "./TransactionMarker";

/** The details of one installation, given its unresolved markers as stored. */
export function recoveryDetails(
  installation: Pick<WowInstallation, "id" | "displayName" | "location" | "clientType">,
  markers: readonly unknown[],
): Omit<InstallationRecoveryDetails, "retry" | "verify"> {
  return {
    installationId: installation.id,
    installationName: installation.displayName,
    status: markers.length > 0 ? "recoveryRequired" : "ready",
    operations: markers.map((marker) => operationDetails(installation, marker)),
  };
}

function operationDetails(
  installation: Pick<WowInstallation, "location" | "clientType">,
  stored: unknown,
): RecoveryOperationDetails {
  const marker = readMarker(stored);
  const base = {
    transactionId: markerId(stored) ?? "",
    addonName: marker ? addonName(marker) : "An addon",
    originalVersion: marker?.originalRecord?.installedVersion ?? null,
    operation: marker?.operation ?? ("unknown" as const),
    startedAt: marker?.startedAt ?? null,
    preserved: [],
  };
  if (!marker) {
    return { ...base, conflicts: [{ location: "Recovery information", reason: "WoWDeck can't read it." }] };
  }
  if (!isDir(installation.location)) {
    return { ...base, conflicts: [{ location: "Game folder", reason: "Isn't available. Is the SD card inserted?" }] };
  }
  if (identity(installation.location) !== marker.root.locationId) {
    return {
      ...base,
      conflicts: [{ location: "Game folder", reason: "Isn't the folder this addon change started in." }],
    };
  }
  const addonsPath = getAddonsPath(installation as WowInstallation);
  const present = (rel: string) => pathPresent(join(addonsPath, ...rel.split("/")));
  const live = Object.keys(marker.evidence).filter((p) => !within(p, marker.workDir));

  const preserved: { location: string; belongsAt: string }[] = [];
  const conflicts: { location: string; reason: string }[] = [];
  for (const path of live.filter((p) => marker.evidence[p]?.kind === "folder")) {
    const kept = chain(path, marker.moves).reverse().find(present);
    if (kept) {
      preserved.push({ location: shown(kept), belongsAt: shown(path) });
      if (present(path)) {
        conflicts.push({ location: shown(path), reason: "Holds the files this addon change put here. Retry recovery moves them aside. To repair by hand, move them out, then put the original files back." });
      }
    }
  }
  const keptAt = preserved.map((p) => p.location);
  for (const path of live.filter((p) => marker.evidence[p]?.kind === "absent")) {
    // A folder that holds preserved copies (the Roll back cache) is not in the way.
    if (present(path) && !keptAt.some((k) => within(k, `AddOns/${path}`))) {
      conflicts.push({ location: shown(path), reason: "Wasn't there before this addon change." });
    }
  }
  return { ...base, preserved, conflicts };
}

/** The places the planned moves take `path` to, in order (`path` itself excluded). */
function chain(path: string, moves: readonly { from: string; to: string }[]): string[] {
  const places: string[] = [];
  let at = path;
  for (const move of moves) {
    if (within(at, move.from)) {
      at = move.to + at.slice(move.from.length);
      places.push(at);
    }
  }
  return places;
}
