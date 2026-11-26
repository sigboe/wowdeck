/** RPC handlers: the linked games (LinkedGameList). */

import type { HandlerTable } from "../../bridge/jsonl";
import type { HandlerDeps } from "./deps";

export function linkedGamesHandlers({
  linkedGames,
  installationService,
  homeDir,
}: Pick<HandlerDeps, "linkedGames" | "installationService" | "homeDir">) {
  return {
    "linkedGames.get": async () => linkedGames.get(),
    "linkedGames.add": async ({ appId, name }) => linkedGames.add({ appId, name }),
    "linkedGames.remove": async ({ appId }) => linkedGames.remove(appId),
    // The automatic scan (removed installations stay out), then the removed games list cleared.
    "linkedGames.find": async () => linkedGames.find(() => installationService.scan(homeDir)),
  } satisfies Partial<HandlerTable>;
}
