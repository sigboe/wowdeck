/**
 * The engine's handler table: every domain's handlers merged into one
 * object typed HandlerTable, so a contract method without a handler fails
 * the typecheck. Its keys are the engine's method list (`--methods`).
 */

import type { MethodName } from "../contracts";
import type { HandlerTable } from "../../bridge/jsonl";
import type { HandlerDeps } from "./deps";
import { aboutHandlers } from "./about";
import { addonsHandlers } from "./addons";
import { installationsHandlers } from "./installations";
import { launchHandlers } from "./launch";
import { linkedGamesHandlers } from "./linkedGames";
import { notificationsHandlers } from "./notifications";
import { providersHandlers } from "./providers";
import { settingsHandlers } from "./settings";
import { systemHandlers } from "./system";
import { wtfHandlers } from "./wtf";

export function handlerTable(deps: HandlerDeps): HandlerTable {
  return {
    ...systemHandlers(deps),
    ...installationsHandlers(deps),
    ...launchHandlers(deps),
    ...linkedGamesHandlers(deps),
    ...addonsHandlers(deps),
    ...providersHandlers(deps),
    ...settingsHandlers(deps),
    ...wtfHandlers(deps),
    ...notificationsHandlers(deps),
    ...aboutHandlers(deps),
  };
}

/**
 * The methods the engine serves, in table order. Building the table only
 * closes over its deps (no handler module reads one before a request), so
 * empty deps list the keys without wiring an engine.
 */
export function methodNames(): MethodName[] {
  return Object.keys(handlerTable({} as HandlerDeps)) as MethodName[];
}
