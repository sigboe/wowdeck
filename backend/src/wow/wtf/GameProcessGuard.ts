/**
 * "Is World of Warcraft running?" (project-owned, best effort).
 *
 * WoW rewrites WTF when the player logs out or reloads, so restoring while
 * it runs would be overwritten (or half-overwritten). Under Proton the game
 * is a Wine process whose `comm` (truncated to 15 chars) and/or command
 * line carries the Windows executable name. /proc is readable across
 * processes for the `deck` user (checked on a real Deck, spike S4).
 *
 * Returns "unknown" — never "not_running" — when /proc can't be read at
 * all, so callers can warn instead of falsely reassuring.
 * Spike S2 (matching under a live Proton session) is still open.
 */

import { readFile, readdir } from "node:fs/promises";
import { WOW_EXECUTABLE_NAMES } from "../installation/InstallationDetector";

import type { GameRunning } from "../../api/contracts";

export type { GameRunning };

export interface ProcReader {
  /** Numeric process ids, or null when /proc is not readable. */
  pids(): Promise<string[] | null>;
  /** Contents of /proc/<pid>/<file>, or null when unreadable (process exited, another user's environ). */
  read(pid: string, file: "comm" | "cmdline" | "environ"): Promise<string | null>;
}

export const fsProcReader: ProcReader = {
  async pids() {
    try {
      return (await readdir("/proc")).filter((n) => /^\d+$/.test(n));
    } catch {
      return null;
    }
  },
  async read(pid, file) {
    try {
      return await readFile(`/proc/${pid}/${file}`, "utf8");
    } catch {
      return null;
    }
  },
};

const COMM_MAX = 15;

function matchesComm(comm: string, names: string[]): boolean {
  const c = comm.trim().toLowerCase();
  return c !== "" && names.some((n) => n === c || n.slice(0, COMM_MAX) === c);
}

function matchesCmdline(cmdline: string, names: string[]): boolean {
  return cmdline
    .split("\0")
    .some((arg) => {
      const base = arg.split(/[\\/]/).pop()?.trim().toLowerCase() ?? "";
      return base !== "" && names.includes(base);
    });
}

export async function detectGameRunning(
  reader: ProcReader = fsProcReader,
  executableNames: readonly string[] = WOW_EXECUTABLE_NAMES,
): Promise<GameRunning> {
  const pids = await reader.pids();
  if (!pids || pids.length === 0) {
    return "unknown";
  }
  const names = executableNames.map((n) => n.toLowerCase());
  let readable = 0;
  for (const pid of pids) {
    const comm = await reader.read(pid, "comm");
    if (comm !== null) {
      readable += 1;
      if (matchesComm(comm, names)) {
        return "running";
      }
    }
    const cmdline = await reader.read(pid, "cmdline");
    if (cmdline !== null && matchesCmdline(cmdline, names)) {
      return "running";
    }
  }
  return readable === 0 ? "unknown" : "not_running";
}
