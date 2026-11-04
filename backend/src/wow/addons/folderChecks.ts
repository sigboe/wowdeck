/**
 * Read-only checks of places in an installation's AddOns folder, shared by
 * the addon transaction (AddonTransaction), its recovery
 * (TransactionRecovery) and the recovery details (RecoveryDetails), so the
 * three never disagree about what a link, a folder or the same folder is.
 * None of them create, change or read file contents.
 */

import { lstatSync, statSync } from "node:fs";
import { join } from "node:path";

/** Whether anything (a link included, followed or not) is at `path`. */
export function pathPresent(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

/** Whether `path` is a folder, links followed (the game folder, which may be a link). */
export function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** Whether `path` is a folder and not a link to one. */
export function isPlainDir(path: string): boolean {
  try {
    const info = lstatSync(path);
    return info.isDirectory() && !info.isSymbolicLink();
  } catch {
    return false;
  }
}

/** The physical identity of the folder at `path` (`dev:ino`, links followed); throws when absent. */
export function identity(path: string): string {
  const info = statSync(path, { bigint: true });
  return `${info.dev}:${info.ino}`;
}

/**
 * Why the thing at `path` can't take part in a move: a link, not a folder,
 * or on another drive than AddOns (`addonsDev`). Null when it is a plain
 * folder on AddOns' drive, or when nothing is there.
 */
export function placeProblem(path: string, addonsDev: bigint): string | null {
  let info;
  try {
    info = lstatSync(path, { bigint: true });
  } catch {
    return null;
  }
  if (info.isSymbolicLink()) {
    return "Is a link to another folder.";
  }
  if (!info.isDirectory()) {
    return "Isn't a folder.";
  }
  if (info.dev !== addonsDev) {
    return "Is on another drive.";
  }
  return null;
}

/**
 * The first place on the way from AddOns to the AddOns-relative `rel`
 * (`rel` itself included) that `placeProblem` refuses, with its problem;
 * null when every place there is fine.
 */
export function pathProblem(addonsPath: string, rel: string, addonsDev: bigint): { at: string; problem: string } | null {
  const parts = rel.split("/");
  for (let i = 1; i <= parts.length; i++) {
    const at = parts.slice(0, i).join("/");
    const problem = placeProblem(join(addonsPath, ...at.split("/")), addonsDev);
    if (problem) {
      return { at, problem };
    }
  }
  return null;
}

/** The drive (`dev`) AddOns is on. */
export function deviceOf(path: string): bigint {
  return statSync(path, { bigint: true }).dev;
}

/** Whether `path` is `dir` or beneath it ("/"-separated, AddOns-relative). */
export function within(path: string, dir: string): boolean {
  return path === dir || path.startsWith(`${dir}/`);
}

/** An AddOns-relative path as the player sees it. */
export function shown(rel: string): string {
  return `AddOns/${rel}`;
}

/** An AddOns-relative path that stays inside AddOns. */
export function safeRelative(rel: unknown): rel is string {
  return (
    typeof rel === "string" &&
    rel !== "" &&
    !rel.startsWith("/") &&
    !rel.includes("\\") &&
    rel.split("/").every((part) => part !== "" && part !== "." && part !== "..")
  );
}
