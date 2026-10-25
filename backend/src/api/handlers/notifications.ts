/** RPC handlers: The daily update check behind the SteamOS toast. */

import type { JsonlServer } from "../../bridge/jsonl";
import type { HandlerDeps } from "./deps";

export function register(server: JsonlServer, { updateToastGate }: HandlerDeps): void {
  server.on("notifications.checkUpdateToast", async () => updateToastGate.checkNow());
}
