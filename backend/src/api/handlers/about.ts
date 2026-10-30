/** RPC handlers: Options › About. */

import type { JsonlServer } from "../../bridge/jsonl";
import type { HandlerDeps } from "./deps";

export function register(server: JsonlServer, { about }: HandlerDeps): void {
  server.on("about.get", async () => about.get());
}
