import type { Addon } from "./types";
import { CHANNEL_LABEL } from "./releaseChannel";
import { providerDisplayName } from "../backend/src/api/providers";

/**
 * Listed so people see why it is never touched, but with no actions: a git
 * checkout, or a folder Raider.IO's own client keeps up to date.
 */
export function isNeverTouched(addon: Addon): boolean {
  return addon.ignoreReason === "git_repo" || addon.ignoreReason === "raiderio_client";
}

/** The short "action needed" reason on a row (guide S16 description line). */
export function addonProblemText(addon: Addon): string | null {
  switch (addon.problem) {
    case "folders_missing":
      return "files missing";
    case "not_on_provider":
      return `not on ${providerLabel(addon.providerId)}`;
    default:
      if (addon.missingDependencies?.length) {
        // WF-22: the addon does not load without them.
        return `missing ${addon.missingDependencies.join(", ")}`;
      }
      // An older engine only sends `broken`.
      return addon.broken ? "action needed" : null;
  }
}

/** Installed only to satisfy another addon (WF-22); tagged LIBRARY and hideable. */
/**
 * Installed by hand, not by an addon source: never updated here (owner,
 * 2026-10-17: tag it, grey it out, let it be hidden). A never-touched folder
 * has its own tag (Ignored) and is not counted.
 */
export function isUnmanaged(addon: Addon): boolean {
  return !addon.providerId && !isNeverTouched(addon);
}

export function isLibrary(addon: Addon): boolean {
  return !!addon.installedAsDependency;
}

/** "needed by DBM - Dungeons" / "needed by A +2": why a library is there. */
export function neededByText(addon: Addon): string | null {
  const names = addon.neededBy ?? [];
  if (!isLibrary(addon) || names.length === 0) {
    return null;
  }
  return `needed by ${names[0]}${names.length > 1 ? ` +${names.length - 1}` : ""}`;
}

/**
 * Libraries that go along when `addon` is removed: installed only as a
 * dependency and needed by nothing else (the engine's autoremove, WF-22).
 */
export function removedAlong(addon: Addon, all: Addon[]): string[] {
  return all
    .filter(
      (a) =>
        a.id !== addon.id &&
        isLibrary(a) &&
        (a.neededBy ?? []).length > 0 &&
        (a.neededBy ?? []).every((n) => n === addon.name),
    )
    .map((a) => a.name);
}

export function providerLabel(providerId: string | null | undefined): string {
  if (!providerId) {
    return "Installed manually";
  }
  return providerDisplayName(providerId);
}

/** The description line of a My Addons row, split so the new version can be coloured. */
export function addonRowDescription(addon: Addon): {
  base: string;
  newVersion: string | null;
  flags: string;
} {
  const base =
    addon.ignoreReason === "git_repo"
      ? "Git checkout, not managed"
      : addon.ignoreReason === "raiderio_client"
        ? "Raider.IO client, not managed"
        : addon.providerId
          ? [providerLabel(addon.providerId), addon.version, neededByText(addon)]
              .filter(Boolean)
              .join(" · ")
          : providerLabel(null);
  const newVersion = addon.updateAvailable ? (addon.availableVersion ?? "new version") : null;
  // "Ignored" is not repeated here: the row shows it as a status tag (guide S23).
  const flags = addonProblemText(addon) ?? "";
  return { base, newVersion, flags };
}

/**
 * S15: after a rollback the kept version is the newer one the user rolled
 * back from, so the update on offer returns to it.
 */
export function isUndoRollback(addon: Addon): boolean {
  return (
    !!addon.previousVersion &&
    !!addon.updateAvailable &&
    addon.availableVersion === addon.previousVersion
  );
}

export type AddonActionId =
  | "update"
  | "reinstall"
  | "details"
  | "channel"
  | "rollback"
  | "pauseAuto"
  | "resumeAuto"
  | "ignore"
  | "unignore"
  | "findSource"
  | "changeSource"
  | "folders"
  | "remove";

export interface AddonAction {
  id: AddonActionId;
  label: string;
  tone?: "emphasis" | "destructive";
  disabled?: boolean;
}

/**
 * The context-menu actions for one My Addons row, in Steam's order: the
 * primary action first, destructive last. A managed addon can move to
 * another source (WF-12); an unmanaged folder can be given an online source
 * (WF-23) or removed. A never-touched folder gets none: a git checkout may hold unpushed
 * work, and Raider.IO's client would only download a removed folder again.
 */
export function addonActions(addon: Addon, busy: boolean, autoUpdate = false): AddonAction[] {
  if (isNeverTouched(addon)) {
    return [];
  }
  if (!addon.providerId) {
    return [
      { id: "findSource", label: "Find online source…", disabled: busy },
      FOLDERS_ACTION,
      { id: "remove", label: "Remove folder…", tone: "destructive", disabled: busy },
    ];
  }
  const actions: AddonAction[] = [];
  // Missing files: reinstalling is the fix, so it leads (WF-05).
  const repair = !!addon.canReinstall && addon.problem === "folders_missing";
  if (repair) {
    actions.push({
      id: "reinstall",
      label: "Reinstall to repair",
      tone: "emphasis",
      disabled: busy,
    });
  }
  if (addon.updateAvailable) {
    actions.push({
      id: "update",
      label: `Update to ${addon.availableVersion ?? "the new version"}`,
      tone: repair ? undefined : "emphasis",
      disabled: busy,
    });
  }
  actions.push({ id: "details", label: "Details" });
  // Otherwise offered only when no update is: Update already installs fresh files.
  if (addon.canReinstall && !repair && !addon.updateAvailable) {
    actions.push({ id: "reinstall", label: "Reinstall", disabled: busy });
  }
  if (addon.canChangeChannel) {
    // Names the current channel, like a settings row shows its value (WF-03).
    actions.push({
      id: "channel",
      label: `Release channel: ${CHANNEL_LABEL[addon.channel ?? "stable"]}`,
      disabled: busy,
    });
  }
  if (addon.previousVersion) {
    // Next to the channel choice (owner, 2026-10-16): both pick which release is installed.
    actions.push({
      id: "rollback",
      label: isUndoRollback(addon)
        ? `Undo rollback (${addon.previousVersion})`
        : `Roll back to ${addon.previousVersion}`,
      disabled: busy,
    });
  }
  if (autoUpdate) {
    // Per-addon pause (WF-02): a rollback to an older version sets it.
    actions.push(
      addon.autoUpdatePaused
        ? { id: "resumeAuto", label: "Resume automatic updates", disabled: busy }
        : { id: "pauseAuto", label: "Pause automatic updates", disabled: busy },
    );
  }
  actions.push(
    addon.ignored
      ? { id: "unignore", label: "Stop ignoring updates", disabled: busy }
      : { id: "ignore", label: "Ignore updates", disabled: busy },
  );
  // Another provider's copy of the addon (WF-12): an escape hatch, not a daily choice.
  actions.push({ id: "changeSource", label: "Change source…", disabled: busy });
  actions.push(FOLDERS_ACTION);
  actions.push({ id: "remove", label: "Remove…", tone: "destructive", disabled: busy });
  return actions;
}

/** Where the addon's files are (WF-20): read-only, so never disabled while busy. */
const FOLDERS_ACTION: AddonAction = { id: "folders", label: "Folders…" };

/** Whether X (Update) does anything on this row: the engine's update rule decides (`updateAvailable`). */
export function canQuickUpdate(addon: Addon): boolean {
  return addon.updateAvailable;
}

/**
 * What X does on a My Addons row and its footer legend: Update when one is
 * on offer, Find online source on an unmanaged folder (WF-23), else nothing.
 */
export function rowQuickAction(addon: Addon): { id: AddonActionId; label: string } | null {
  if (canQuickUpdate(addon)) {
    return { id: "update", label: "Update" };
  }
  if (isUnmanaged(addon)) {
    return { id: "findSource", label: "Find online source" };
  }
  return null;
}

/**
 * My Addons text filter (WF-06): case-insensitive, on what a row shows or
 * what people remember an addon by (name, folder, author, provider). Blank
 * shows everything.
 */
export function filterAddons(addons: Addon[], query: string): Addon[] {
  const q = query.trim().toLocaleLowerCase();
  if (!q) {
    return addons;
  }
  return addons.filter((a) =>
    [a.name, a.folderName, a.author ?? "", providerLabel(a.providerId)].some((text) =>
      text.toLocaleLowerCase().includes(q),
    ),
  );
}

/**
 * My Addons order (WF-06): what needs a press first. Updates offered, then
 * newly updated ones, to see what just changed (PC-07), then addons that need
 * attention, then the rest, then ignored ones; by name within each group.
 * Scrolling 100 rows on a thumbstick is slow, so the actionable rows must not
 * be buried alphabetically.
 */
export function sortAddons(addons: Addon[]): Addon[] {
  const rank = (a: Addon) =>
    a.ignored || isUnmanaged(a)
      ? 4
      : canQuickUpdate(a)
        ? 0
        : a.newlyUpdated
          ? 1
          : addonProblemText(a) !== null
            ? 2
            : 3;
  return [...addons].sort(
    (a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
}
