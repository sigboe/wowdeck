import type { WtfImportResult, WtfJobSnapshot } from "./types";

/**
 * Which installations' backup lists and copy sources a Settings backup change
 * touched (ADR 0007), as predicates over installation ids. An omitted
 * predicate means every installation's.
 */
export interface Affected {
  listChanged?: (installationId: string) => boolean;
  sourcesChanged?: (installationId: string) => boolean;
}

/** Every list and every copy-source list: the change can't be placed. */
export const EVERYTHING: Affected = {};

/**
 * A change to one version's stored backups or current settings: its own list,
 * and every other installation's copy sources, which list this version. A null
 * installation is a version that isn't installed: it has no list to refresh.
 */
export const changedIn = (installationId: string | null): Affected =>
  installationId === null
    ? { listChanged: () => false }
    : {
        listChanged: (id) => id === installationId,
        sourcesChanged: (id) => id !== installationId,
      };

/**
 * A copy into `destination`. Both ends change: the destination's safety backup
 * and settings, and the source's backup of its current settings; copy sources
 * list both. `source`: null when not installed, undefined when unknown.
 */
export const copied = (destination: string, source: string | null | undefined): Affected =>
  source === undefined ? EVERYTHING : { listChanged: (id) => id === destination || id === source };

/**
 * An import started in `installationId`: filed under the version the zip was
 * made for, which may be another. `installationOf` finds that version's
 * installation (null: not installed, undefined: unknown). A lost answer
 * (`result` undefined) names no version.
 */
export function imported(
  installationId: string,
  result: WtfImportResult | undefined,
  installationOf: (flavor: string) => string | null | undefined,
): Affected {
  if (result === undefined) {
    return EVERYTHING;
  }
  const filedUnder = result.otherVersion
    ? installationOf(result.otherVersion.flavor)
    : installationId;
  return filedUnder === undefined ? EVERYTHING : changedIn(filedUnder);
}

/**
 * A job that ended without a recorded start (another caller, a plugin reload).
 * A failed restore may leave its safety backup, so every kind counts; a copy
 * names no source, so every list may have changed.
 */
export const unrecordedJob = (kind: WtfJobSnapshot["kind"], installationId: string): Affected =>
  kind === "copy" ? EVERYTHING : changedIn(installationId);
