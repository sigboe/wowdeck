/**
 * Who owns Play on this machine (contracts.ts PlayOwner). On DroidDeck,
 * Steam's start of a Battle.net game goes to DroidDeck's store launcher,
 * which runs DroidDeck's Battle.net driver (`droiddeck-battlenet`); the
 * driver asks Battle.net for the shortcut's own version until a game runs.
 * Nothing outside DroidDeck can stop that ask, so WoWDeck leaves Play to
 * DroidDeck (docs/steam-launch-targets.md, "DroidDeck").
 */

import { accessSync, constants, statSync } from "node:fs";
import { join } from "node:path";
import type { PlayOwner } from "../../api/contracts";

/** DroidDeck's store launcher, relative to the system root. */
const DROIDDECK_STORE_LAUNCHER = "usr/local/bin/droiddeck-store-launch";

/**
 * "droiddeck" when DroidDeck's store launcher is an executable file under
 * `systemRoot` (`/` outside tests), else "wowdeck". The engine reads it once
 * at startup and keeps it for the session.
 */
export function detectPlayOwner(systemRoot: string): PlayOwner {
  const launcher = join(systemRoot, DROIDDECK_STORE_LAUNCHER);
  try {
    if (!statSync(launcher).isFile()) return "wowdeck";
    accessSync(launcher, constants.X_OK);
    return "droiddeck";
  } catch {
    return "wowdeck";
  }
}
